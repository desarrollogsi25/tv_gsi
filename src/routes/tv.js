// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — TV Screen Endpoints (Playback & Auth)
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyDeviceToken } = require('../utils/deviceAuth');
const { generateSignedMediaUrl, SIGNED_URL_PURPOSE } = require('../utils/signedMediaUrl');

// Autenticación de Pantalla por UUID y Credencial de Dispositivo (RSK-025)
router.post('/login', async (req, res) => {
    const { tv_uuid, device_token } = req.body;
    if (!tv_uuid) {
        return res.status(400).json({ success: false, message: 'UUID de TV requerido.' });
    }

    const tokenHeader = req.headers['x-device-token'] ||
        (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    const token = device_token || tokenHeader;

    try {
        const query = `
            SELECT id, name, location, is_active, device_token_hash
            FROM nexus_tv.tv_screens
            WHERE tv_uuid = $1
        `;
        const result = await db.pool.query(query, [tv_uuid]);

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Dispositivo no registrado o UUID inválido.' });
        }

        const screen = result.rows[0];
        if (!screen.is_active) {
            return res.status(403).json({
                success: false,
                message: 'La pantalla está pendiente de aprobación por el administrador o inactiva.',
                pending: true
            });
        }

        // Si la pantalla tiene credencial activa en BD, verificarla obligatoriamente
        if (screen.device_token_hash) {
            if (!token) {
                return res.status(401).json({
                    success: false,
                    message: 'Credencial de dispositivo requerida.',
                    requires_credentials: true
                });
            }
            if (!verifyDeviceToken(token, screen.device_token_hash)) {
                return res.status(401).json({
                    success: false,
                    message: 'Credencial de dispositivo inválida o revocada.'
                });
            }
        } else {
            // Pantalla sin credencial configurada (dispositivo antiguo o desvinculado)
            return res.status(401).json({
                success: false,
                message: 'Pantalla sin credenciales activas. Se requiere revinculación administrativa por PIN.',
                requires_pairing: true
            });
        }

        // Actualizar último login
        await db.pool.query('UPDATE nexus_tv.tv_screens SET last_login = NOW() WHERE tv_uuid = $1', [tv_uuid]);

        res.json({
            success: true,
            message: 'Autenticación exitosa.',
            screen: {
                id: screen.id,
                name: screen.name,
                location: screen.location,
                tv_uuid
            }
        });
    } catch (err) {
        console.error('❌ Error en login TV:', err.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// Playlist activa para la pantalla (Bucle Infinito + Filtro por Día)
router.get('/:tv_uuid/playlist', async (req, res) => {
    const { tv_uuid } = req.params;

    if (!tv_uuid) {
        return res.status(400).json({ success: false, message: 'UUID de TV requerido.' });
    }

    // Cabeceras estrictas anti-caché
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        const deviceToken = req.get('X-Device-Token');
        if (!deviceToken) {
            return res.status(401).json({ success: false, message: 'Credencial de dispositivo requerida o inválida.' });
        }

        const screenRes = await db.pool.query(
            'SELECT device_token_hash, is_active FROM nexus_tv.tv_screens WHERE tv_uuid = $1',
            [tv_uuid]
        );
        const screen = screenRes.rows[0];
        if (!screen || !screen.is_active || !verifyDeviceToken(deviceToken, screen.device_token_hash)) {
            return res.status(401).json({ success: false, message: 'Credencial de dispositivo requerida o inválida.' });
        }

        const query = `
            SELECT
                c.id AS content_id,
                c.title,
                c.source_url,
                c.source_type,
                c.content_type,
                c.duration_seconds,
                pc.position,
                pc.start_time,
                pc.end_time,
                pc.days_of_week
            FROM nexus_tv.tv_screens AS ts
            JOIN nexus_tv.tv_playlist AS tp ON ts.id = tp.tv_id
            JOIN nexus_tv.playlists AS p ON tp.playlist_id = p.id
            JOIN nexus_tv.playlist_content AS pc ON p.id = pc.playlist_id
            JOIN nexus_tv.content AS c ON pc.content_id = c.id
            WHERE ts.tv_uuid = $1
              AND ts.is_active = true
              AND (
                (pc.start_time IS NULL OR pc.end_time IS NULL)
                OR (LOCALTIME BETWEEN pc.start_time AND pc.end_time)
              )
              AND (
                pc.days_of_week IS NULL
                OR pc.days_of_week && (
                  CASE EXTRACT(ISODOW FROM CURRENT_DATE)
                    WHEN 1 THEN ARRAY['lunes']
                    WHEN 2 THEN ARRAY['martes']
                    WHEN 3 THEN ARRAY['miércoles', 'miercoles']
                    WHEN 4 THEN ARRAY['jueves']
                    WHEN 5 THEN ARRAY['viernes']
                    WHEN 6 THEN ARRAY['sábado', 'sabado']
                    WHEN 7 THEN ARRAY['domingo']
                  END
                )::text[]
              )
            ORDER BY pc.position ASC, pc.start_time ASC NULLS FIRST, c.id ASC;
        `;

        const result = await db.pool.query(query, [tv_uuid]);
        res.json({
            success: true,
            playlist: result.rows,
            total: result.rows.length,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('❌ Error al obtener playlist TV:', err.message);
        res.status(500).json({ success: false, message: 'Error al consultar la playlist.' });
    }
});

// Endpoint para obtener URL firmada de reproducción (TV autenticada)
// La TV solicita una URL firmada para un contenido específico que tenga autorizado.
router.get('/:tv_uuid/playback-url/:contentId', async (req, res) => {
    const { tv_uuid, contentId } = req.params;

    if (!tv_uuid || !contentId) {
        return res.status(400).json({ success: false, message: 'tv_uuid y contentId son requeridos.' });
    }

    // Autenticación de la TV (reutiliza la lógica existente)
    const deviceToken = req.get('X-Device-Token');
    if (!deviceToken) {
        return res.status(401).json({ success: false, message: 'Credencial de dispositivo requerida.' });
    }

    try {
        // Verificar que la TV existe, está activa y el token es válido
        const screenRes = await db.pool.query(
            'SELECT id, device_token_hash, is_active FROM nexus_tv.tv_screens WHERE tv_uuid = $1',
            [tv_uuid]
        );
        const screen = screenRes.rows[0];
        if (!screen || !screen.is_active || !verifyDeviceToken(deviceToken, screen.device_token_hash)) {
            return res.status(401).json({ success: false, message: 'Credencial de dispositivo inválida.' });
        }

        // Verificar que el contenido existe y es un archivo local
        const contentRes = await db.pool.query(
            'SELECT id, source_url, source_type, content_type, duration_seconds FROM nexus_tv.content WHERE id = $1',
            [contentId]
        );
        const content = contentRes.rows[0];
        if (!content) {
            return res.status(404).json({ success: false, message: 'Contenido no encontrado.' });
        }
        if (content.source_type !== 'local_file') {
            return res.status(400).json({ success: false, message: 'Solo se pueden firmar URLs de archivos locales.' });
        }

        // Verificar que la TV tiene este contenido en su playlist activa
        const playlistCheck = await db.pool.query(`
            SELECT 1
            FROM nexus_tv.tv_screens AS ts
            JOIN nexus_tv.tv_playlist AS tp ON ts.id = tp.tv_id
            JOIN nexus_tv.playlists AS p ON tp.playlist_id = p.id
            JOIN nexus_tv.playlist_content AS pc ON p.id = pc.playlist_id
            JOIN nexus_tv.content AS c ON pc.content_id = c.id
            WHERE ts.tv_uuid = $1
              AND ts.is_active = true
              AND c.id = $2
              AND (
                (pc.start_time IS NULL OR pc.end_time IS NULL)
                OR (LOCALTIME BETWEEN pc.start_time AND pc.end_time)
              )
              AND (
                pc.days_of_week IS NULL
                OR pc.days_of_week && (
                  CASE EXTRACT(ISODOW FROM CURRENT_DATE)
                    WHEN 1 THEN ARRAY['lunes']
                    WHEN 2 THEN ARRAY['martes']
                    WHEN 3 THEN ARRAY['miércoles', 'miercoles']
                    WHEN 4 THEN ARRAY['jueves']
                    WHEN 5 THEN ARRAY['viernes']
                    WHEN 6 THEN ARRAY['sábado', 'sabado']
                    WHEN 7 THEN ARRAY['domingo']
                  END
                )::text[]
              )
        `, [tv_uuid, contentId]);

        if (playlistCheck.rows.length === 0) {
            return res.status(403).json({ success: false, message: 'La TV no tiene autorizado este contenido en su playlist actual.' });
        }

        // Extraer solo el nombre del archivo de la source_url
        const filename = content.source_url.replace(/^\/media\//, '');
        if (!filename || filename === content.source_url) {
            return res.status(400).json({ success: false, message: 'Ruta de archivo local inválida.' });
        }

        // TTL: duración del contenido + buffer (mínimo 1 hora, máximo 4 horas)
        // Para videos, el TTL debe cubrir la reproducción completa + buffering
        const contentDuration = content.duration_seconds || 3600;
        const ttlSeconds = Math.max(3600, Math.min(contentDuration + 1800, 14400)); // 1h a 4h

        // Generar URL firmada
        const signedUrl = generateSignedMediaUrl({
            filename,
            purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
            tvUuid: tv_uuid,
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
        console.error('❌ Error generando URL firmada de reproducción:', err.message);
        res.status(500).json({ success: false, message: 'Error interno al generar URL de reproducción.' });
    }
});

// Registro de nueva pantalla (solicitud de emparejamiento)
router.post('/register', async (req, res) => {
    const { tv_uuid, name, location } = req.body;

    if (!tv_uuid || !name) {
        return res.status(400).json({ success: false, message: 'UUID y Nombre son requeridos.' });
    }

    try {
        const checkQuery = 'SELECT id, is_active FROM nexus_tv.tv_screens WHERE tv_uuid = $1';
        const existing = await db.pool.query(checkQuery, [tv_uuid]);

        if (existing.rows.length > 0) {
            return res.json({
                success: true,
                message: 'El dispositivo ya existe.',
                is_active: existing.rows[0].is_active
            });
        }

        const insertQuery = `
            INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active, created_at)
            VALUES ($1, $2, $3, false, NOW())
            RETURNING id, tv_uuid, name, location, is_active
        `;
        const inserted = await db.pool.query(insertQuery, [tv_uuid, name, location || 'Sin asignar']);

        res.status(201).json({
            success: true,
            message: 'Solicitud de emparejamiento enviada al administrador.',
            screen: inserted.rows[0]
        });
    } catch (err) {
        console.error('❌ Error registrando pantalla:', err.message);
        res.status(500).json({ success: false, message: 'Error al registrar la pantalla.' });
    }
});

// Heartbeat de telemetría de pantalla
router.post('/heartbeat', async (req, res) => {
    const { tv_uuid, device_token } = req.body;
    const token = device_token || req.headers['x-device-token'] ||
        (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

    if (!tv_uuid) {
        return res.status(400).json({ success: false, message: 'Credenciales de pantalla requeridas.' });
    }

    try {
        const screenRes = await db.pool.query(
            'SELECT device_token_hash, is_active FROM nexus_tv.tv_screens WHERE tv_uuid = $1',
            [tv_uuid]
        );
        const screen = screenRes.rows[0];

        if (!screen?.is_active || !screen.device_token_hash || !token ||
            !verifyDeviceToken(token, screen.device_token_hash)) {
            return res.status(401).json({ success: false, message: 'Credenciales de pantalla inválidas.' });
        }

        // Recheck activity and hash at write time to avoid recording a heartbeat
        // if the screen was disabled or its credential revoked after the SELECT.
        const update = await db.pool.query(
            `UPDATE nexus_tv.tv_screens
             SET last_login = NOW()
             WHERE tv_uuid = $1 AND is_active = true AND device_token_hash = $2`,
            [tv_uuid, screen.device_token_hash]
        );

        if (update.rowCount !== 1) {
            return res.status(401).json({ success: false, message: 'Credenciales de pantalla inválidas.' });
        }

        return res.json({ success: true, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('❌ Error procesando heartbeat TV:', err.message);
        return res.status(500).json({ success: false, message: 'No se pudo procesar el heartbeat.' });
    }
});

module.exports = router;
