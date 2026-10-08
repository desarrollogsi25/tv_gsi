// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Administration API & Device Management
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

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

        // Emitir evento por WebSocket a la TV correspondiente
        if (bindWaitingScreenFn) {
            bindWaitingScreenFn(sessionCode, profile);
        }

        // Actualizar último acceso y asegurar que esté activa
        await pool.query('UPDATE nexus_tv.tv_screens SET is_active = true, last_login = NOW() WHERE tv_uuid = $1', [tv_uuid]);

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

    try {
        const updateScreenQuery = `
            UPDATE nexus_tv.tv_screens 
            SET name = COALESCE($1, name),
                location = COALESCE($2, location),
                is_active = COALESCE($3, is_active)
            WHERE tv_uuid = $4
            RETURNING id;
        `;
        const updateRes = await pool.query(updateScreenQuery, [name, location, is_active, uuid]);
        if (updateRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Pantalla no encontrada.' });
        }

        const tvId = updateRes.rows[0].id;

        // Si se especificó playlist_id, actualizar la relación
        if (playlist_id !== undefined) {
            await pool.query('DELETE FROM nexus_tv.tv_playlist WHERE tv_id = $1', [tvId]);
            if (playlist_id) {
                await pool.query(
                    'INSERT INTO nexus_tv.tv_playlist (tv_id, playlist_id, is_primary) VALUES ($1, $2, true)',
                    [tvId, playlist_id]
                );
            }

            // Notificar a la pantalla que su playlist cambió
            if (controlNamespace) {
                controlNamespace.to(`tv:${uuid}`).emit('command:execute', {
                    command: 'playlist_changed',
                    payload: { playlist_id }
                });
            }
        }

        res.json({ success: true, message: 'Pantalla actualizada con éxito.' });
    } catch (err) {
        console.error('❌ Error actualizando pantalla:', err.message);
        res.status(500).json({ success: false, message: 'Error al actualizar la pantalla.' });
    }
});

// Enviar comando de control remoto a una pantalla
router.post('/screens/:uuid/control', (req, res) => {
    const { uuid } = req.params;
    const { command, payload } = req.body;

    if (!command) {
        return res.status(400).json({ success: false, message: 'Comando requerido.' });
    }

    if (!controlNamespace) {
        return res.status(503).json({ success: false, message: 'Hub de control no inicializado.' });
    }

    if (uuid === 'all') {
        controlNamespace.emit('command:execute', { command, payload: payload || {} });
    } else {
        controlNamespace.to(`tv:${uuid}`).emit('command:execute', { command, payload: payload || {} });
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
            controlNamespace.to(`tv:${uuid}`).emit('command:execute', { command: 'approved', payload: {} });
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
                pc.playlist_id,
                pc.content_id,
                pc.start_time,
                pc.end_time,
                pc.days_of_week,
                c.title,
                c.source_url,
                c.source_type,
                c.content_type,
                c.duration_seconds
            FROM nexus_tv.playlist_content pc
            JOIN nexus_tv.content c ON pc.content_id = c.id
            WHERE pc.playlist_id = $1
            ORDER BY pc.start_time ASC;
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

// Función auxiliar para normalizar días de la semana
const canonicalDayMap = {
    'lunes': 'lunes',
    'martes': 'martes',
    'miercoles': 'miércoles',
    'miércoles': 'miércoles',
    'jueves': 'jueves',
    'viernes': 'viernes',
    'sabado': 'sábado',
    'sábado': 'sábado',
    'domingo': 'domingo'
};

function normalizeDaysOfWeek(inputDays) {
    if (!Array.isArray(inputDays) || inputDays.length === 0) {
        return ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    }
    const normalized = inputDays.map(d => {
        const clean = String(d).trim().toLowerCase();
        return canonicalDayMap[clean] || clean;
    });
    return Array.from(new Set(normalized));
}

// Asignar contenido a una playlist con horario
router.post('/playlists/:id/items', async (req, res) => {
    const { id } = req.params;
    const { content_id, start_time, end_time, days_of_week } = req.body;

    if (!content_id || !start_time || !end_time) {
        return res.status(400).json({ success: false, message: 'content_id, start_time y end_time requeridos.' });
    }

    const days = normalizeDaysOfWeek(days_of_week);

    try {
        const query = `
            INSERT INTO nexus_tv.playlist_content (playlist_id, content_id, start_time, end_time, days_of_week)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (playlist_id, content_id, start_time, end_time) DO UPDATE
            SET days_of_week = EXCLUDED.days_of_week;
        `;
        await pool.query(query, [id, content_id, start_time, end_time, days]);
        res.json({ success: true, message: 'Contenido asignado a la playlist exitosamente.' });
    } catch (err) {
        console.error('❌ Error asignando contenido a playlist:', err.message);
        res.status(500).json({ success: false, message: 'Error al asignar contenido.' });
    }
});

// Eliminar contenido de una playlist
router.delete('/playlists/:id/items/:contentId', async (req, res) => {
    const { id, contentId } = req.params;
    try {
        await pool.query('DELETE FROM nexus_tv.playlist_content WHERE playlist_id = $1 AND content_id = $2', [id, contentId]);
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

    if (!action) {
        return res.status(400).json({ success: false, message: 'action es requerida (play, pause, mute, unmute, volume).' });
    }

    if (!controlNamespace) {
        return res.status(503).json({ success: false, message: 'Hub de control no inicializado.' });
    }

    console.log(`🎮 [Control Hub] Acción '${action}' sobre contenido temporal en [${target}]`);

    if (target === 'all') {
        controlNamespace.emit('command:temporary_action', { action, payload });
    } else {
        controlNamespace.to(`tv:${target}`).emit('command:temporary_action', { action, payload });
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
    setNamespaces
};
