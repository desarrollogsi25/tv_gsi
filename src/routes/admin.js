// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Administration API & Device Management
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { normalizeDaysOfWeek } = require('../utils/dateHelpers');

let controlNamespace = null;
let waitingScreensMap = null;
let bindWaitingScreenFn = null;
let setTemporaryContentFn = null;
let clearTemporaryContentFn = null;
let getTemporaryStateFn = null;

function setNamespaces(opts) {
    if (opts) {
        controlNamespace = opts.controlNs;
        waitingScreensMap = opts.waitingScreens;
        bindWaitingScreenFn = opts.bindWaitingScreen;
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
router.get('/waiting-screens', (req, res) => {
    const list = waitingScreensMap ? Array.from(waitingScreensMap.values()) : [];
    res.json({ success: true, waiting: list });
});

// Listar los perfiles de pantallas preconfigurados en la base de datos (PT101, PT204, etc.)
router.get('/available-profiles', async (req, res) => {
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
router.post('/bind-screen', async (req, res) => {
    const { sessionCode, tv_uuid } = req.body;

    if (!sessionCode || !tv_uuid) {
        return res.status(400).json({ success: false, message: 'sessionCode y tv_uuid requeridos.' });
    }

    const normalizedSessionCode = String(sessionCode).toUpperCase();
    const hasWaitingScreen = Array.from(waitingScreensMap?.values() || [])
        .some((screen) => screen.sessionCode === normalizedSessionCode);
    if (!hasWaitingScreen) {
        return res.status(404).json({ success: false, message: 'Sesión de pantalla pendiente no encontrada.' });
    }

    try {
        const profileRes = await pool.query(`
            SELECT ts.id, ts.tv_uuid, ts.name, ts.location, ts.is_active, p.id AS playlist_id, p.name AS playlist_name
            FROM nexus_tv.tv_screens ts
            LEFT JOIN nexus_tv.tv_playlist tp ON ts.id = tp.tv_id AND tp.is_primary = true
            LEFT JOIN nexus_tv.playlists p ON tp.playlist_id = p.id
            WHERE ts.tv_uuid = $1;
        `, [tv_uuid]);

        if (profileRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Perfil de pantalla no encontrado.' });
        }

        const profile = profileRes.rows[0];

        // Actualizar último acceso y asegurar que esté activa
        await pool.query('UPDATE nexus_tv.tv_screens SET is_active = true, last_login = NOW() WHERE tv_uuid = $1', [tv_uuid]);

        // Emitir después de persistir el perfil para que el primer login no vea el estado pendiente.
        if (bindWaitingScreenFn) bindWaitingScreenFn(normalizedSessionCode, profile);

        res.json({
            success: true,
            message: `Pantalla vinculada exitosamente con el perfil ${profile.name} (${profile.location}).`,
            profile
        });
    } catch (err) {
        console.error('❌ Error vinculando pantalla:', err.message);
        res.status(500).json({ success: false, message: 'Error interno al vincular la pantalla.' });
    }
});

// Rechazar una pantalla que está esperando una vinculación por PIN.
router.post('/waiting-screens/:sessionCode/reject', (req, res) => {
    const socketId = Array.from(waitingScreensMap?.values() || [])
        .find((screen) => screen.sessionCode === String(req.params.sessionCode).toUpperCase())?.socketId;
    if (!socketId || !controlNamespace) {
        return res.status(404).json({ success: false, message: 'Sesión pendiente no encontrada.' });
    }
    const socket = controlNamespace.sockets.get(socketId);
    socket?.emit('command:rejected', {});
    socket?.disconnect(true);
    return res.json({ success: true, message: 'Solicitud de vinculación rechazada.' });
});

// ─────────────────────────────────────────────────────────
// Gestión de Pantallas (Screens)
// ─────────────────────────────────────────────────────────

// Listar todas las pantallas con su playlist asignada
router.get('/screens', async (req, res) => {
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
router.get('/screens/:uuid', async (req, res) => {
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
router.put('/screens/:uuid', async (req, res) => {
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
router.post('/screens/:uuid/unlink', async (req, res) => {
    const { uuid } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            'UPDATE nexus_tv.tv_screens SET is_active = false WHERE tv_uuid = $1 RETURNING id',
            [uuid]
        );
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Pantalla no encontrada.' });
        }
        await client.query('DELETE FROM nexus_tv.tv_playlist WHERE tv_id = $1', [result.rows[0].id]);
        await client.query('COMMIT');
        if (clearTemporaryContentFn) clearTemporaryContentFn(uuid);
        if (controlNamespace) controlNamespace.to(`tv:${uuid}`).to(`screen_${uuid}`).emit('command:execute', { command: 'unlink', payload: {} });
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
router.delete('/screens/:uuid', async (req, res) => {
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
        if (controlNamespace) controlNamespace.to(`tv:${uuid}`).to(`screen_${uuid}`).emit('command:execute', { command: 'unlink', payload: {} });
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
router.post('/screens/:uuid/control', (req, res) => {
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
router.get('/pending', async (req, res) => {
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
router.post('/approve/:uuid', async (req, res) => {
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
router.get('/playlists', async (req, res) => {
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
router.post('/playlists', async (req, res) => {
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

router.put('/playlists/:id', async (req, res) => {
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

router.delete('/playlists/:id', async (req, res) => {
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
router.get('/playlists/:id', async (req, res) => {
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
router.post('/playlists/:id/items', async (req, res) => {
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

router.put('/playlists/:id/items/order', async (req, res) => {
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
router.delete('/playlists/:id/items/:contentId', async (req, res) => {
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
router.post('/temporary-content', async (req, res) => {
    const { target = 'all', content } = req.body;

    if (!content || !content.source_url) {
        return res.status(400).json({ success: false, message: 'content con source_url es requerido.' });
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
        source_url: content.source_url,
        duration_seconds: content.duration_seconds || 0,
        loop: content.loop !== false,
        muted: content.muted === true,
        broadcast_at: new Date().toISOString()
    };

    setTemporaryContentFn(target, payload);

    res.json({
        success: true,
        message: `Contenido temporal emitido a ${target === 'all' ? 'todas las pantallas' : `pantalla [${target}]`}.`,
        content: payload
    });
});

// Finalizar transmisión temporal y reanudar playlist normal
router.post('/clear-temporary', async (req, res) => {
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
router.get('/active-temporary', (req, res) => {
    const state = getTemporaryStateFn ? getTemporaryStateFn() : { global: null, byScreen: {} };
    res.json({ success: true, state });
});

// Acciones remotas sobre el contenido temporal (play, pause, mute, unmute, volume)
router.post('/temporary-control', (req, res) => {
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
router.get('/content', async (req, res) => {
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

// Estadísticas para el panel de control
router.get('/stats', async (req, res) => {
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

module.exports = {
    router,
    setNamespaces,
    normalizeDaysOfWeek
};
