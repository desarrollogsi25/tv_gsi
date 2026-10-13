// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Administration API & Device Management
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { normalizeDaysOfWeek } = require('../utils/dateHelpers');
const { requireRole } = require('../middlewares/auth');
const { generateDeviceToken, hashDeviceToken } = require('../utils/deviceAuth');
const { PairingSessionError } = require('../services/pairingSessionManager');
const { generateSignedMediaUrl, SIGNED_URL_PURPOSE } = require('../utils/signedMediaUrl');

let controlNamespace = null;
let pairingSessions = null;
let adminPool = pool;
let setTemporaryContentFn = null;
let clearTemporaryContentFn = null;
let getTemporaryStateFn = null;

function setNamespaces(opts) {
    if (opts) {
        controlNamespace = opts.controlNs;
        pairingSessions = opts.pairingSessions || null;
        adminPool = opts.pool || pool;
        setTemporaryContentFn = opts.setTemporaryContent;
        clearTemporaryContentFn = opts.clearTemporaryContent;
        getTemporaryStateFn = opts.getTemporaryState;
    }
}

async function notifyPlaylistChanged(playlistId, payload = {}) {
    if (!controlNamespace) return;
    const screens = await pool.query(
        'SELECT ts.tv_uuid FROM nexus_tv.tv_screens ts JOIN nexus_tv.tv_playlist tp ON tp.tv_id = ts.id WHERE tp.playlist_id = $1',
        [playlistId]
    );
    for (const { tv_uuid: uuid } of screens.rows) {
        controlNamespace.to(`tv:${uuid}`).to(`screen_${uuid}`).emit('command:execute', {
            command: 'playlist_changed',
            payload: { playlist_id: playlistId, ...payload }
        });
    }
}

// ─────────────────────────────────────────────────────────
// Detección Automática & Vinculación Remota de Pantallas
// ─────────────────────────────────────────────────────────

// Listar pantallas detectadas en la red esperando que el admin les asigne un perfil
router.get('/waiting-screens', requireRole('admin', 'editor', 'viewer'), (req, res) => {
    const list = pairingSessions ? pairingSessions.listPending() : [];
    res.json({ success: true, waiting: list });
});

// Listar los perfiles de pantallas preconfigurados en la base de datos (PT101, PT204, etc.)
router.get('/available-profiles', requireRole('admin', 'editor', 'viewer'), async (req, res) => {
    try {
        const query = `
            SELECT 
                ts.id,
                ts.tv_uuid,
                ts.name,
                ts.location,
                ts.is_active,
                p.id AS playlist_id,
                p.name AS playlist_name
            FROM nexus_tv.tv_screens ts
            LEFT JOIN nexus_tv.tv_playlist tp ON ts.id = tp.tv_id AND tp.is_primary = true
            LEFT JOIN nexus_tv.playlists p ON tp.playlist_id = p.id
            ORDER BY ts.id ASC;
        `;
        const result = await pool.query(query);
        res.json({ success: true, profiles: result.rows });
    } catch (err) {
        console.error('❌ Error listando perfiles disponibles:', err.message);
        res.status(500).json({ success: false, message: 'Error interno al consultar perfiles.' });
    }
});

// Vincular una pantalla detectada con un perfil elegido por el administrador
router.post('/bind-screen', requireRole('admin'), async (req, res) => {
    const { pairingSessionId, tv_uuid } = req.body;

    if (!pairingSessionId || !tv_uuid) {
        return res.status(400).json({ success: false, code: 'PAIRING_SESSION_ID_REQUIRED', message: 'pairingSessionId y tv_uuid requeridos.' });
    }

    if (typeof pairingSessionId !== 'string' || typeof tv_uuid !== 'string') {
        return res.status(400).json({ success: false, code: 'INVALID_PAIRING_REQUEST', message: 'pairingSessionId y tv_uuid deben ser cadenas.' });
    }

    try {
        const result = await pairingSessions.bind(pairingSessionId, tv_uuid, async (_session, isBindingActive) => {
            // ── Short Transaction 1: Validar perfil y registrar vinculación pendiente ──
            const client = await adminPool.connect();
            let profile;
            let deviceToken;
            let deviceTokenHash;

            try {
                await client.query('BEGIN');
                const profileRes = await client.query(`
                    SELECT ts.id, ts.tv_uuid, ts.name, ts.location, ts.is_active, ts.last_login,
                           ts.device_token_hash, ts.token_created_at,
                           p.id AS playlist_id, p.name AS playlist_name
                    FROM nexus_tv.tv_screens ts
                    LEFT JOIN nexus_tv.tv_playlist tp ON ts.id = tp.tv_id AND tp.is_primary = true
                    LEFT JOIN nexus_tv.playlists p ON tp.playlist_id = p.id
                    WHERE ts.tv_uuid = $1
                `, [tv_uuid]);

                if (profileRes.rows.length === 0) {
                    throw new PairingSessionError('PROFILE_NOT_FOUND', 'Perfil de pantalla no encontrado.', 404);
                }

                const row = profileRes.rows[0];
                profile = {
                    id: row.id,
                    tv_uuid: row.tv_uuid,
                    name: row.name,
                    location: row.location,
                    playlist_id: row.playlist_id,
                    playlist_name: row.playlist_name
                };

                deviceToken = generateDeviceToken();
                deviceTokenHash = hashDeviceToken(deviceToken);

                // Registrar vinculación pendiente (expira en 60 segundos por seguridad)
                _session.pendingTokenHash = deviceTokenHash;
                _session.pendingExpiresAt = Date.now() + 60_000;

                try {
                    await client.query(`
                        INSERT INTO nexus_tv.pending_pairings (tv_uuid, pairing_session_id, pending_device_token_hash, expires_at, status)
                        VALUES ($1, $2, $3, NOW() + INTERVAL '60 seconds', 'pending')
                        ON CONFLICT (pairing_session_id) DO UPDATE
                        SET tv_uuid = EXCLUDED.tv_uuid,
                            pending_device_token_hash = EXCLUDED.pending_device_token_hash,
                            expires_at = EXCLUDED.expires_at,
                            status = 'pending',
                            updated_at = NOW();
                    `, [tv_uuid, pairingSessionId, deviceTokenHash]);
                } catch (pendingErr) {
                    if (pendingErr.code === '42P01') {
                        throw new PairingSessionError(
                            'PAIRING_SCHEMA_NOT_MIGRATED',
                            'La base de datos requiere la migración 07_pending_pairings para emparejar pantallas.',
                            503
                        );
                    }
                    throw pendingErr;
                }

                if (!isBindingActive()) {
                    throw new PairingSessionError('PAIRING_SESSION_DISCONNECTED', 'La pantalla se desconectó durante la vinculación.', 410);
                }

                // Confirmar Transacción 1 de inmediato ANTES de iniciar la entrega por Socket.IO
                await client.query('COMMIT');
            } catch (error) {
                try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
                throw error;
            } finally {
                client.release();
            }

            // Objeto de enlace con handlers para la segunda transacción corta (promoción) y cancelación
            const bindingHandlers = {
                profile,
                deviceToken,
                // ── Short Transaction 2: Promover credencial pendiente a activa tras ACK ──
                promote: async () => {
                    const promoteClient = await adminPool.connect();
                    try {
                        await promoteClient.query('BEGIN');

                        let pendingTokenHashToPromote = null;
                        let pendingRowId = null;

                        let pendingRes;
                        try {
                            pendingRes = await promoteClient.query(`
                                SELECT id, tv_uuid, pending_device_token_hash, status, expires_at
                                FROM nexus_tv.pending_pairings
                                WHERE pairing_session_id = $1 AND tv_uuid = $2
                                FOR UPDATE
                            `, [pairingSessionId, tv_uuid]);
                        } catch (readErr) {
                            if (readErr.code === '42P01') {
                                throw new PairingSessionError(
                                    'PAIRING_SCHEMA_NOT_MIGRATED',
                                    'La base de datos requiere la migración 07_pending_pairings para completar la vinculación.',
                                    503
                                );
                            }
                            throw readErr;
                        }

                        if (!pendingRes || pendingRes.rows.length === 0) {
                            throw new PairingSessionError('PAIRING_PENDING_NOT_FOUND', 'Registro de vinculación pendiente no encontrado en base de datos.', 404);
                        }

                        const pendingRow = pendingRes.rows[0];
                        if (pendingRow.status === 'promoted') {
                            // Operación repetida idempotente
                            await promoteClient.query('COMMIT');
                            return;
                        }

                        if (pendingRow.status !== 'pending') {
                            throw new PairingSessionError('PAIRING_SESSION_INVALID_STATE', `La vinculación pendiente ya no está activa (${pendingRow.status}).`, 409);
                        }

                        if (new Date(pendingRow.expires_at) <= new Date()) {
                            await promoteClient.query(`
                                UPDATE nexus_tv.pending_pairings
                                SET status = 'expired', updated_at = NOW()
                                WHERE id = $1
                            `, [pendingRow.id]);
                            await promoteClient.query('COMMIT');
                            throw new PairingSessionError('PAIRING_SESSION_EXPIRED', 'La vinculación pendiente expiró.', 410);
                        }

                        pendingTokenHashToPromote = pendingRow.pending_device_token_hash;
                        pendingRowId = pendingRow.id;

                        // Promover a activa en tv_screens
                        await promoteClient.query(`
                            UPDATE nexus_tv.tv_screens
                            SET is_active = true, last_login = NOW(), device_token_hash = $1, token_created_at = NOW()
                            WHERE tv_uuid = $2
                        `, [pendingTokenHashToPromote, tv_uuid]);

                        // Marcar registro como promovido si existe tabla
                        if (pendingRowId) {
                            await promoteClient.query(`
                                UPDATE nexus_tv.pending_pairings
                                SET status = 'promoted', updated_at = NOW()
                                WHERE id = $1
                            `, [pendingRowId]);
                        }

                        await promoteClient.query('COMMIT');
                    } catch (promoteError) {
                        try { await promoteClient.query('ROLLBACK'); } catch (_) {}
                        throw promoteError;
                    } finally {
                        promoteClient.release();
                    }
                },
                // ── Cancelación corta si falla ACK o el cliente rechaza ──
                cancel: async () => {
                    _session.pendingTokenHash = null;
                    try {
                        await adminPool.query(`
                            UPDATE nexus_tv.pending_pairings
                            SET status = 'cancelled', updated_at = NOW()
                            WHERE pairing_session_id = $1 AND tv_uuid = $2 AND status = 'pending'
                        `, [pairingSessionId, tv_uuid]);
                    } catch (cancelErr) {
                        if (cancelErr.code !== '42P01') throw cancelErr;
                    }
                },
                // Compatibilidad con contratos anteriores
                commit: async () => bindingHandlers.promote(),
                rollback: async () => bindingHandlers.cancel()
            };

            return bindingHandlers;
        });
        return res.json(result);
    } catch (err) {
        const status = Number.isInteger(err.status) ? err.status : 500;
        if (status >= 500) console.error('❌ Error vinculando pantalla:', err.message);
        return res.status(status).json({
            success: false,
            code: err.code || 'PAIRING_BIND_FAILED',
            rollbackFailed: err.rollbackFailed === true,
            message: status === 500 ? 'Error interno al vincular la pantalla.' : err.message
        });
    }
});

// Rechazar una sesión pendiente por su identidad, nunca por el PIN visible.
router.post('/waiting-screens/:pairingSessionId/reject', requireRole('admin'), (req, res) => {
    if (!pairingSessions || !controlNamespace) {
        return res.status(503).json({ success: false, code: 'PAIRING_UNAVAILABLE', message: 'El servicio de emparejamiento no está disponible.' });
    }
    try {
        pairingSessions.reject(req.params.pairingSessionId);
        return res.json({ success: true, message: 'Solicitud de vinculación rechazada.' });
    } catch (err) {
        const status = Number.isInteger(err.status) ? err.status : 500;
        return res.status(status).json({ success: false, code: err.code || 'PAIRING_REJECT_FAILED', message: err.message });
    }
});

// ─────────────────────────────────────────────────────────
// Gestión de Pantallas (Screens)
// ─────────────────────────────────────────────────────────

// Listar todas las pantallas con su playlist asignada
router.get('/screens', requireRole('admin', 'editor', 'viewer'), async (req, res) => {
    try {
        const query = `
            SELECT 
                ts.id,
                ts.tv_uuid,
                ts.name,
                ts.location,
                ts.is_active,
                ts.last_login,
                ts.created_at,
                p.id AS playlist_id,
                p.name AS playlist_name,
                tp.is_primary
            FROM nexus_tv.tv_screens ts
            LEFT JOIN nexus_tv.tv_playlist tp ON ts.id = tp.tv_id AND tp.is_primary = true
            LEFT JOIN nexus_tv.playlists p ON tp.playlist_id = p.id
            ORDER BY ts.id ASC;
        `;
        const result = await pool.query(query);
        res.json({ success: true, screens: result.rows });
    } catch (err) {
        console.error('❌ Error listando pantallas:', err.message);
        res.status(500).json({ success: false, message: 'Error interno al consultar pantallas.' });
    }
});

// Detalle de una pantalla por UUID
router.get('/screens/:uuid', requireRole('admin', 'editor', 'viewer'), async (req, res) => {
    const { uuid } = req.params;
    try {
        const query = `
            SELECT 
                ts.id,
                ts.tv_uuid,
                ts.name,
                ts.location,
                ts.is_active,
                ts.last_login,
                p.id AS playlist_id,
                p.name AS playlist_name
            FROM nexus_tv.tv_screens ts
            LEFT JOIN nexus_tv.tv_playlist tp ON ts.id = tp.tv_id AND tp.is_primary = true
            LEFT JOIN nexus_tv.playlists p ON tp.playlist_id = p.id
            WHERE ts.tv_uuid = $1;
        `;
        const result = await pool.query(query, [uuid]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Pantalla no encontrada.' });
        }
        res.json({ success: true, screen: result.rows[0] });
    } catch (err) {
        console.error('❌ Error obteniendo pantalla:', err.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// Actualizar pantalla (nombre, ubicación, playlist y estado)
router.put('/screens/:uuid', requireRole('admin'), async (req, res) => {
    const { uuid } = req.params;
    const { name, location, playlist_id, is_active } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const updateScreenQuery = `
            UPDATE nexus_tv.tv_screens 
            SET name = COALESCE($1, name),
                location = COALESCE($2, location),
                is_active = COALESCE($3, is_active)
            WHERE tv_uuid = $4
            RETURNING id;
        `;
        const updateRes = await client.query(updateScreenQuery, [name, location, is_active, uuid]);
        if (updateRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Pantalla no encontrada.' });
        }

        const tvId = updateRes.rows[0].id;

        // Si se especificó playlist_id, actualizar la relación
        if (playlist_id !== undefined) {
            if (playlist_id !== null && playlist_id !== '') {
                const playlistRes = await client.query('SELECT id FROM nexus_tv.playlists WHERE id = $1', [playlist_id]);
                if (playlistRes.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ success: false, message: 'Playlist no encontrada.' });
                }
            }
            await client.query('DELETE FROM nexus_tv.tv_playlist WHERE tv_id = $1', [tvId]);
            if (playlist_id) {
                await client.query(
                    'INSERT INTO nexus_tv.tv_playlist (tv_id, playlist_id, is_primary) VALUES ($1, $2, true)',
                    [tvId, playlist_id]
                );
            }
        }

        await client.query('COMMIT');
        if (playlist_id !== undefined && controlNamespace) {
            controlNamespace.to(`tv:${uuid}`).to(`screen_${uuid}`).emit('command:execute', {
                command: 'playlist_changed',
                payload: { playlist_id }
            });
        }

        res.json({ success: true, message: 'Pantalla actualizada con éxito.' });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('❌ Error actualizando pantalla:', err.message);
        res.status(500).json({ success: false, message: 'Error al actualizar la pantalla.' });
    } finally {
        client.release();
    }
});

// Desvincular una pantalla sin eliminar su perfil de la base de datos.
router.post('/screens/:uuid/unlink', requireRole('admin'), async (req, res) => {
    const { uuid } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            'UPDATE nexus_tv.tv_screens SET is_active = false, device_token_hash = NULL WHERE tv_uuid = $1 RETURNING id',
            [uuid]
        );
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Pantalla no encontrada.' });
        }
        await client.query('DELETE FROM nexus_tv.tv_playlist WHERE tv_id = $1', [result.rows[0].id]);
        await client.query('COMMIT');
        if (clearTemporaryContentFn) clearTemporaryContentFn(uuid);
        if (controlNamespace) {
            controlNamespace.to(`tv:${uuid}`).to(`screen_${uuid}`).emit('command:execute', { command: 'unlink', payload: {} });
            controlNamespace.in(`tv:${uuid}`).disconnectSockets(true);
        }
        return res.json({ success: true, message: 'Pantalla desvinculada y playlist retirada.' });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('❌ Error desvinculando pantalla:', err.message);
        return res.status(500).json({ success: false, message: 'Error al desvincular la pantalla.' });
    } finally {
        client.release();
    }
});

// Eliminar un perfil de pantalla y sus relaciones asociadas de forma atómica.
router.delete('/screens/:uuid', requireRole('admin'), async (req, res) => {
    const { uuid } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('SELECT id FROM nexus_tv.tv_screens WHERE tv_uuid = $1 FOR UPDATE', [uuid]);
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Pantalla no encontrada.' });
        }
        await client.query('DELETE FROM nexus_tv.tv_playlist WHERE tv_id = $1', [result.rows[0].id]);
        await client.query('DELETE FROM nexus_tv.tv_screens WHERE id = $1', [result.rows[0].id]);
        await client.query('COMMIT');
        if (clearTemporaryContentFn) clearTemporaryContentFn(uuid);
        if (controlNamespace) {
            controlNamespace.to(`tv:${uuid}`).to(`screen_${uuid}`).emit('command:execute', { command: 'unlink', payload: {} });
            controlNamespace.in(`tv:${uuid}`).disconnectSockets(true);
        }
        return res.json({ success: true, message: 'Perfil de pantalla eliminado.' });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('❌ Error eliminando pantalla:', err.message);
        return res.status(500).json({ success: false, message: 'Error al eliminar la pantalla.' });
    } finally {
        client.release();
    }
});

// Enviar comando de control remoto a una pantalla
router.post('/screens/:uuid/control', requireRole('admin'), (req, res) => {
    const { uuid } = req.params;
    const { command, payload } = req.body;

    const allowedCommands = new Set(['pause', 'resume', 'play', 'next', 'skip', 'reload', 'mute', 'unmute', 'chime', 'play_sound', 'test_sound', 'volume', 'set_volume']);
    if (!allowedCommands.has(command)) {
        return res.status(400).json({ success: false, message: 'Comando requerido.' });
    }

    if (!controlNamespace) {
        return res.status(503).json({ success: false, message: 'Hub de control no inicializado.' });
    }

    if (uuid === 'all') {
        controlNamespace.emit('command:execute', { command, payload: payload || {} });
    } else {
        controlNamespace.to(`tv:${uuid}`).to(`screen_${uuid}`).emit('command:execute', { command, payload: payload || {} });
    }

    res.json({ success: true, message: `Comando '${command}' enviado correctamente.` });
});

// Listar dispositivos pendientes de aprobación
router.get('/pending', requireRole('admin', 'editor', 'viewer'), async (req, res) => {
    try {
        const query = `
            SELECT id, tv_uuid, name, location, created_at 
            FROM nexus_tv.tv_screens 
            WHERE is_active = false
            ORDER BY created_at DESC;
        `;
        const result = await pool.query(query);
        res.json({ success: true, pending: result.rows });
    } catch (err) {
        console.error('❌ Error listando pendientes:', err.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// Aprobar dispositivo pendiente
router.post('/approve/:uuid', requireRole('admin'), async (req, res) => {
    const { uuid } = req.params;
    const { playlist_id } = req.body;

    try {
        const updateQuery = `
            UPDATE nexus_tv.tv_screens 
            SET is_active = true 
            WHERE tv_uuid = $1 
            RETURNING id;
        `;
        const result = await pool.query(updateQuery, [uuid]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Pantalla no encontrada.' });
        }

        const tvId = result.rows[0].id;
        if (playlist_id) {
            await pool.query(
                'INSERT INTO nexus_tv.tv_playlist (tv_id, playlist_id, is_primary) VALUES ($1, $2, true) ON CONFLICT DO NOTHING',
                [tvId, playlist_id]
            );
        }

        if (controlNamespace) {
            controlNamespace.to(`tv:${uuid}`).to(`screen_${uuid}`).emit('command:execute', { command: 'approved', payload: {} });
        }

        res.json({ success: true, message: 'Pantalla aprobada satisfactoriamente.' });
    } catch (err) {
        console.error('❌ Error aprobando pantalla:', err.message);
        res.status(500).json({ success: false, message: 'Error al aprobar pantalla.' });
    }
});

// ─────────────────────────────────────────────────────────
// Playlists
// ─────────────────────────────────────────────────────────

// Listar playlists con conteo de contenidos
router.get('/playlists', requireRole('admin', 'editor', 'viewer'), async (req, res) => {
    try {
        const query = `
            SELECT 
                p.id, 
                p.name, 
                p.is_public, 
                p.created_at,
                COUNT(pc.content_id) AS item_count
            FROM nexus_tv.playlists p
            LEFT JOIN nexus_tv.playlist_content pc ON p.id = pc.playlist_id
            GROUP BY p.id
            ORDER BY p.id ASC;
        `;
        const result = await pool.query(query);
        res.json({ success: true, playlists: result.rows });
    } catch (err) {
        console.error('❌ Error listando playlists:', err.message);
        res.status(500).json({ success: false, message: 'Error interno al consultar playlists.' });
    }
});

// Crear nueva playlist
router.post('/playlists', requireRole('admin', 'editor'), async (req, res) => {
    const { name, is_public } = req.body;
    if (!name) {
        return res.status(400).json({ success: false, message: 'El nombre de la playlist es obligatorio.' });
    }

    try {
        const query = `
            INSERT INTO nexus_tv.playlists (name, is_public, created_at) 
            VALUES ($1, $2, NOW()) 
            RETURNING id, name, is_public, created_at;
        `;
        const result = await pool.query(query, [name, !!is_public]);
        res.status(201).json({ success: true, playlist: result.rows[0] });
    } catch (err) {
        console.error('❌ Error creando playlist:', err.message);
        res.status(500).json({ success: false, message: 'Error al crear la playlist.' });
    }
});

router.put('/playlists/:id', requireRole('admin', 'editor'), async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'El nombre de la playlist es obligatorio.' });
    try {
        const result = await pool.query(
            'UPDATE nexus_tv.playlists SET name = $1 WHERE id = $2 RETURNING id, name, is_public, created_at',
            [name, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Playlist no encontrada.' });
        return res.json({ success: true, playlist: result.rows[0] });
    } catch (err) {
        console.error('❌ Error renombrando playlist:', err.message);
        return res.status(500).json({ success: false, message: 'Error al renombrar la playlist.' });
    }
});

router.delete('/playlists/:id', requireRole('admin', 'editor'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('SELECT id FROM nexus_tv.playlists WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Playlist no encontrada.' });
        }
        const assignedScreens = await client.query('SELECT tv_uuid FROM nexus_tv.tv_screens ts JOIN nexus_tv.tv_playlist tp ON tp.tv_id = ts.id WHERE tp.playlist_id = $1', [req.params.id]);
        await client.query('DELETE FROM nexus_tv.tv_playlist WHERE playlist_id = $1', [req.params.id]);
        await client.query('DELETE FROM nexus_tv.playlist_content WHERE playlist_id = $1', [req.params.id]);
        await client.query('DELETE FROM nexus_tv.playlists WHERE id = $1', [req.params.id]);
        await client.query('COMMIT');
        for (const { tv_uuid: uuid } of assignedScreens.rows) {
            controlNamespace?.to(`tv:${uuid}`).to(`screen_${uuid}`).emit('command:execute', { command: 'playlist_changed', payload: { playlist_id: null } });
        }
        return res.json({ success: true, message: 'Playlist y sus asociaciones eliminadas.' });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('❌ Error eliminando playlist:', err.message);
        return res.status(500).json({ success: false, message: 'Error al eliminar la playlist.' });
    } finally {
        client.release();
    }
});

// Obtener contenidos programados en una playlist
router.get('/playlists/:id', requireRole('admin', 'editor', 'viewer'), async (req, res) => {
    const { id } = req.params;
    try {
        const playlistInfo = await pool.query('SELECT * FROM nexus_tv.playlists WHERE id = $1', [id]);
        if (playlistInfo.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Playlist no encontrada.' });
        }

        const itemsQuery = `
            SELECT 
                pc.id,
                pc.playlist_id,
                pc.content_id,
                pc.start_time,
                pc.end_time,
                pc.days_of_week,
                pc.position,
                c.title,
                c.source_url,
                c.source_type,
                c.content_type,
                c.duration_seconds
            FROM nexus_tv.playlist_content pc
            JOIN nexus_tv.content c ON pc.content_id = c.id
            WHERE pc.playlist_id = $1
            ORDER BY pc.position ASC, pc.start_time ASC NULLS FIRST, pc.id ASC;
        `;
        const items = await pool.query(itemsQuery, [id]);

        res.json({
            success: true,
            playlist: playlistInfo.rows[0],
            items: items.rows
        });
    } catch (err) {
        console.error('❌ Error obteniendo detalles de playlist:', err.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// Asignar contenido a una playlist con horario
router.post('/playlists/:id/items', requireRole('admin', 'editor'), async (req, res) => {
    const { id } = req.params;
    const { content_id, start_time, end_time, days_of_week } = req.body;

    if (!content_id || (start_time && !end_time) || (!start_time && end_time)) {
        return res.status(400).json({ success: false, message: 'content_id y ambos horarios (o ninguno para 24/7) son requeridos.' });
    }

    const days = normalizeDaysOfWeek(days_of_week);

    try {
        const exists = await pool.query(
            'SELECT (SELECT count(*) FROM nexus_tv.playlists WHERE id = $1) AS playlist_exists, (SELECT count(*) FROM nexus_tv.content WHERE id = $2) AS content_exists',
            [id, content_id]
        );
        if (!Number(exists.rows[0].playlist_exists)) return res.status(404).json({ success: false, message: 'Playlist no encontrada.' });
        if (!Number(exists.rows[0].content_exists)) return res.status(404).json({ success: false, message: 'Contenido no encontrado.' });
        const position = await pool.query('SELECT COALESCE(MAX(position) + 1, 0) AS position FROM nexus_tv.playlist_content WHERE playlist_id = $1', [id]);
        const query = `
            INSERT INTO nexus_tv.playlist_content (playlist_id, content_id, start_time, end_time, days_of_week, position)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (playlist_id, content_id, start_time, end_time) DO UPDATE
            SET days_of_week = EXCLUDED.days_of_week, position = EXCLUDED.position;
        `;
        await pool.query(query, [id, content_id, start_time || null, end_time || null, days, position.rows[0].position]);
        await notifyPlaylistChanged(id);
        res.json({ success: true, message: 'Contenido asignado a la playlist exitosamente.' });
    } catch (err) {
        console.error('❌ Error asignando contenido a playlist:', err.message);
        res.status(500).json({ success: false, message: 'Error al asignar contenido.' });
    }
});

router.put('/playlists/:id/items/order', requireRole('admin', 'editor'), async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || items.some((item) => !Number.isInteger(Number(item.id)))) {
        return res.status(400).json({ success: false, message: 'Se requiere una lista de IDs válida.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query('SELECT id FROM nexus_tv.playlist_content WHERE playlist_id = $1 ORDER BY id FOR UPDATE', [req.params.id]);
        if (current.rows.length !== items.length || current.rows.some((row) => !items.some((item) => String(item.id) === String(row.id)))) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, message: 'La playlist cambió; recarga y vuelve a ordenar.' });
        }
        for (let position = 0; position < items.length; position += 1) {
            const result = await client.query(
                'UPDATE nexus_tv.playlist_content SET position = $1 WHERE id = $2 AND playlist_id = $3',
                [position, items[position].id, req.params.id]
            );
            if (result.rowCount !== 1) throw new Error('No se pudo actualizar el orden de la playlist.');
        }
        await client.query('COMMIT');
        await notifyPlaylistChanged(req.params.id);
        return res.json({ success: true, message: 'Orden de reproducción actualizado.' });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('❌ Error reordenando playlist:', err.message);
        return res.status(500).json({ success: false, message: 'Error al reordenar la playlist.' });
    } finally {
        client.release();
    }
});

// Eliminar contenido de una playlist
router.delete('/playlists/:id/items/:contentId', requireRole('admin', 'editor'), async (req, res) => {
    const { id, contentId } = req.params;
    try {
        await pool.query('DELETE FROM nexus_tv.playlist_content WHERE playlist_id = $1 AND content_id = $2', [id, contentId]);
        await notifyPlaylistChanged(id);
        res.json({ success: true, message: 'Contenido retirado de la playlist.' });
    } catch (err) {
        console.error('❌ Error retirando contenido de playlist:', err.message);
        res.status(500).json({ success: false, message: 'Error al retirar contenido.' });
    }
});

// ─────────────────────────────────────────────────────────
// Broadcast & Contenido Temporal en Vivo (Override de Playlist)
// ─────────────────────────────────────────────────────────

// Emitir contenido temporal a una pantalla específica o a todas ('all')
router.post('/temporary-content', requireRole('admin'), async (req, res) => {
    const { target = 'all', content } = req.body;

    if (!content || !content.source_url) {
        return res.status(400).json({ success: false, message: 'content con source_url es requerido.' });
    }

    if (!setTemporaryContentFn) {
        return res.status(503).json({ success: false, message: 'Servicio de broadcast temporal no disponible.' });
    }

    let finalSourceUrl = content.source_url;
    let signedUrlInfo = null;

    // Si es un archivo local y el target es una TV específica, generar URL firmada
    if (target !== 'all' && content.source_url.startsWith('/media/')) {
        try {
            // Verificar que el contenido existe en BD y es local
            const filename = content.source_url.replace(/^\/media\//, '');
            const contentRes = await pool.query(
                'SELECT id, duration_seconds FROM nexus_tv.content WHERE source_url = $1 AND source_type = \'local_file\'',
                [content.source_url]
            );
            if (contentRes.rows.length > 0) {
                const dbContent = contentRes.rows[0];
                const contentDuration = dbContent.duration_seconds || content.duration_seconds || 3600;
                const ttlSeconds = Math.max(3600, Math.min(contentDuration + 1800, 14400));

                finalSourceUrl = generateSignedMediaUrl({
                    filename,
                    purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
                    tvUuid: target,
                    ttlSeconds,
                    contentId: dbContent.id
                });
                signedUrlInfo = { expires_in: ttlSeconds };
            }
        } catch (signErr) {
            console.warn('⚠️ No se pudo generar URL firmada para contenido temporal, usando URL directa:', signErr.message);
        }
    }
    // Si target es 'all' y es archivo local, generar URL de preview administrativo (sin TV binding)
    else if (target === 'all' && content.source_url.startsWith('/media/')) {
        try {
            const filename = content.source_url.replace(/^\/media\//, '');
            const contentRes = await pool.query(
                'SELECT id FROM nexus_tv.content WHERE source_url = $1 AND source_type = \'local_file\'',
                [content.source_url]
            );
            if (contentRes.rows.length > 0) {
                const dbContent = contentRes.rows[0];
                // TTL más largo para broadcast global (ej. 4 horas)
                finalSourceUrl = generateSignedMediaUrl({
                    filename,
                    purpose: SIGNED_URL_PURPOSE.ADMIN_PREVIEW,
                    ttlSeconds: 14400,
                    contentId: dbContent.id
                });
                signedUrlInfo = { expires_in: 14400 };
            }
        } catch (signErr) {
            console.warn('⚠️ No se pudo generar URL firmada para broadcast global:', signErr.message);
        }
    }

    if (!setTemporaryContentFn) {
        return res.status(503).json({ success: false, message: 'Servicio de broadcast temporal no disponible.' });
    }

    if (target !== 'all') {
        try {
            const screenCheck = await pool.query('SELECT id, is_active FROM nexus_tv.tv_screens WHERE tv_uuid::text = $1', [target]);
            if (screenCheck.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'La pantalla especificada como target no existe.' });
            }
        } catch (err) {
            return res.status(404).json({ success: false, message: 'La pantalla especificada como target no existe.' });
        }
    }

    const payload = {
        title: content.title || 'Transmisión Temporal en Vivo',
        content_type: content.content_type || 'video',
        source_url: finalSourceUrl,
        duration_seconds: content.duration_seconds || 0,
        loop: content.loop !== false,
        muted: content.muted === true,
        broadcast_at: new Date().toISOString()
    };

    setTemporaryContentFn(target, payload);

    res.json({
        success: true,
        message: `Contenido temporal emitido a ${target === 'all' ? 'todas las pantallas' : `pantalla [${target}]`}.`,
        content: payload,
        signed_url: signedUrlInfo ? { expires_in: signedUrlInfo.expires_in } : null
    });
});

// Finalizar transmisión temporal y reanudar playlist normal
router.post('/clear-temporary', requireRole('admin'), async (req, res) => {
    const { target = 'all' } = req.body;

    if (!clearTemporaryContentFn) {
        return res.status(503).json({ success: false, message: 'Servicio de broadcast temporal no disponible.' });
    }

    if (target !== 'all') {
        try {
            const screenCheck = await pool.query('SELECT id, is_active FROM nexus_tv.tv_screens WHERE tv_uuid::text = $1', [target]);
            if (screenCheck.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'La pantalla especificada como target no existe.' });
            }
        } catch (err) {
            return res.status(404).json({ success: false, message: 'La pantalla especificada como target no existe.' });
        }
    }

    clearTemporaryContentFn(target);

    res.json({
        success: true,
        message: `Transmisión temporal finalizada en ${target === 'all' ? 'todas las pantallas' : `pantalla [${target}]`}. Playlist reanudada.`
    });
});

// Consultar transmisiones temporales activas en el sistema
router.get('/active-temporary', requireRole('admin', 'editor', 'viewer'), (req, res) => {
    const state = getTemporaryStateFn ? getTemporaryStateFn() : { global: null, byScreen: {} };
    res.json({ success: true, state });
});

// Acciones remotas sobre el contenido temporal (play, pause, mute, unmute, volume)
router.post('/temporary-control', requireRole('admin'), (req, res) => {
    const { target = 'all', action, payload = {} } = req.body;

    const allowedActions = new Set(['play', 'pause', 'resume', 'mute', 'unmute', 'volume', 'set_volume', 'chime', 'play_sound', 'test_sound']);
    if (!allowedActions.has(action)) {
        return res.status(400).json({ success: false, message: 'action es requerida (play, pause, mute, unmute, volume).' });
    }

    if (!controlNamespace) {
        return res.status(503).json({ success: false, message: 'Hub de control no inicializado.' });
    }

    console.log(`🎮 [Control Hub] Acción '${action}' sobre contenido temporal en [${target}]`);

    if (target === 'all') {
        controlNamespace.emit('command:temporary_action', { action, payload });
    } else {
        controlNamespace.to(`tv:${target}`).to(`screen_${target}`).emit('command:temporary_action', { action, payload });
    }

    res.json({ success: true, message: `Acción '${action}' enviada a ${target}.` });
});

// Alias para listar catálogo de contenidos multimedia desde admin
router.get('/content', requireRole('admin', 'editor', 'viewer'), async (req, res) => {
    try {
        const query = `
            SELECT id, title, description, source_url, source_type, content_type, duration_seconds, created_at
            FROM nexus_tv.content
            ORDER BY created_at DESC;
        `;
        const result = await pool.query(query);
        res.json({ success: true, content: result.rows });
    } catch (err) {
        console.error('❌ Error listando contenidos desde admin:', err.message);
        res.status(500).json({ success: false, message: 'Error al consultar contenidos.' });
    }
});

// Endpoint para obtener URL firmada de preview administrativo
// Requiere autenticación admin/editor/viewer y RBAC sobre el recurso.
router.get('/media/preview-url/:contentId', requireRole('admin', 'editor', 'viewer'), async (req, res) => {
    const { contentId } = req.params;

    if (!contentId) {
        return res.status(400).json({ success: false, message: 'contentId es requerido.' });
    }

    try {
        // Verificar que el contenido existe y es un archivo local
        const contentRes = await pool.query(
            'SELECT id, source_url, source_type, content_type, duration_seconds FROM nexus_tv.content WHERE id = $1',
            [contentId]
        );
        const content = contentRes.rows[0];
        if (!content) {
            return res.status(404).json({ success: false, message: 'Contenido no encontrado.' });
        }
        if (content.source_type !== 'local_file') {
            return res.status(400).json({ success: false, message: 'Solo se pueden generar previews de archivos locales.' });
        }

        // Extraer solo el nombre del archivo
        const filename = content.source_url.replace(/^\/media\//, '');
        if (!filename || filename === content.source_url) {
            return res.status(400).json({ success: false, message: 'Ruta de archivo local inválida.' });
        }

        // TTL para preview administrativo: 30 minutos (suficiente para visualizar)
        const ttlSeconds = 1800;

        // Generar URL firmada con propósito ADMIN_PREVIEW
        const signedUrl = generateSignedMediaUrl({
            filename,
            purpose: SIGNED_URL_PURPOSE.ADMIN_PREVIEW,
            ttlSeconds,
            contentId: content.id
        });

        res.json({
            success: true,
            signed_url: signedUrl,
            expires_in: ttlSeconds,
            content_type: content.content_type,
            duration_seconds: content.duration_seconds
        });
    } catch (err) {
        console.error('❌ Error generando URL firmada de preview:', err.message);
        res.status(500).json({ success: false, message: 'Error interno al generar URL de preview.' });
    }
});

// Estadísticas para el panel de control
router.get('/stats', requireRole('admin', 'editor', 'viewer'), async (req, res) => {
    try {
        const screensRes = await pool.query('SELECT COUNT(*) FROM nexus_tv.tv_screens');
        const activeScreensRes = await pool.query('SELECT COUNT(*) FROM nexus_tv.tv_screens WHERE is_active = true');
        const playlistsRes = await pool.query('SELECT COUNT(*) FROM nexus_tv.playlists');
        const contentRes = await pool.query('SELECT COUNT(*) FROM nexus_tv.content');

        res.json({
            success: true,
            stats: {
                totalScreens: parseInt(screensRes.rows[0].count, 10),
                activeScreens: parseInt(activeScreensRes.rows[0].count, 10),
                totalPlaylists: parseInt(playlistsRes.rows[0].count, 10),
                totalContent: parseInt(contentRes.rows[0].count, 10)
            }
        });
    } catch (err) {
        console.error('❌ Error obteniendo estadísticas:', err.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

async function reconcilePendingPairings(poolToUse = adminPool) {
    if (!poolToUse) return 0;
    try {
        const res = await poolToUse.query(`
            UPDATE nexus_tv.pending_pairings
            SET status = 'expired', updated_at = NOW()
            WHERE status = 'pending' AND expires_at <= NOW()
        `);
        return res.rowCount || 0;
    } catch (err) {
        if (err.code !== '42P01') {
            console.warn('⚠️ [Reconciliation] Error limpiando vinculaciones pendientes:', err.message);
        }
        return 0;
    }
}

module.exports = {
    router,
    setNamespaces,
    normalizeDaysOfWeek,
    reconcilePendingPairings
};
