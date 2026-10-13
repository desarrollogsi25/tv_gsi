// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Media Storage & Content Management
// Hardened with Magic Bytes & Secure File Validation (AUD-004)
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const db = require('../config/db');
const { requireRole } = require('../middlewares/auth');
const {
    validateMediaFile,
    probeVideoDuration,
    decodeMediaContent,
    decodeVideoSample,
    generateSecureMediaFilename,
    safeUnlink,
    hasSystemFfmpeg
} = require('../utils/mediaValidator');

const mediaDirectory = db.mediaDirectory;

// Configuración de almacenamiento Multer con nombres criptográficos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dest = req.app?.locals?.mediaDirectory || mediaDirectory;
        cb(null, dest);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, generateSecureMediaFilename(ext || '.bin'));
    }
});

function handleUploadMiddleware(req, res, next) {
    const limits = req.app?.locals?.uploadLimits || { fileSize: 500 * 1024 * 1024 };
    const uploadInstance = multer({ storage, limits });
    uploadInstance.single('mediaFile')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ success: false, message: 'El archivo excede el tamaño máximo permitido (500MB).' });
                }
                return res.status(400).json({ success: false, message: 'Error al procesar la subida del archivo.' });
            }
            return res.status(400).json({ success: false, message: 'Error en la petición de carga.' });
        }
        next();
    });
}

// Listar todos los contenidos de la biblioteca
router.get('/', requireRole('admin', 'editor', 'viewer'), async (req, res) => {
    const activePool = req.app.locals?.dbPool || db.pool;
    try {
        const query = `
            SELECT id, title, description, source_url, source_type, content_type, duration_seconds, created_at
            FROM nexus_tv.content
            ORDER BY created_at DESC;
        `;
        const result = await activePool.query(query);
        res.json({ success: true, content: result.rows });
    } catch (err) {
        console.error('❌ Error listando contenidos:', err.message);
        res.status(500).json({ success: false, message: 'Error interno al consultar la biblioteca de medios.' });
    }
});

// Subir archivo local (Video o Imagen) con validación estricta de firma binaria
router.post('/upload', requireRole('admin', 'editor'), handleUploadMiddleware, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No se ha subido ningún archivo.' });
    }

    const activePool = req.app.locals?.dbPool || db.pool;
    const uploadedFilePath = req.file.path;

    // 1. Validación exhaustiva de formato, MIME y firma mágica
    const validation = await validateMediaFile(req.file);
    if (!validation.valid) {
        await safeUnlink(uploadedFilePath);
        return res.status(400).json({ success: false, code: validation.code, message: validation.message });
    }

    const publicUrl = `/media/${req.file.filename}`;
    const title = (req.body.title && req.body.title.trim()) || req.file.originalname;

    // 2. Procesamiento de Imagen
    if (validation.contentType === 'image') {
        const imageDecoder = req.app.locals?.imageDecoderFn !== undefined
            ? req.app.locals.imageDecoderFn
            : (hasSystemFfmpeg() ? decodeMediaContent : null);
        if (imageDecoder) {
            try {
                await imageDecoder(uploadedFilePath, false, req.app.locals?.imageDecoderOptions || {});
            } catch (decodeErr) {
                await safeUnlink(uploadedFilePath);
                return res.status(400).json({
                    success: false,
                    code: 'IMAGE_CORRUPTED_OR_TRUNCATED',
                    message: 'El archivo de imagen no se puede decodificar o contiene datos corruptos.'
                });
            }
        }

        const duration = parseInt(req.body.duration_seconds, 10) || 15;
        try {
            const insertQuery = `
                INSERT INTO nexus_tv.content (title, description, source_url, source_type, content_type, duration_seconds, created_at)
                VALUES ($1, $2, $3, 'local_file', 'image', $4, NOW())
                RETURNING *;
            `;
            const result = await activePool.query(insertQuery, [title, req.body.description || '', publicUrl, duration]);
            return res.status(201).json({ success: true, content: result.rows[0] });
        } catch (err) {
            await safeUnlink(uploadedFilePath);
            console.error('❌ Error guardando imagen en DB:', err.message);
            return res.status(500).json({ success: false, message: 'Error al registrar en base de datos.' });
        }
    }

    // 3. Procesamiento de Video con ffprobe determinista y decodificación de stream
    const ffprobeFn = req.app.locals?.ffprobeFn || ffmpeg.ffprobe;
    const ffprobeOptions = req.app.locals?.ffprobeOptions || {};
    let duration;
    try {
        duration = await probeVideoDuration(uploadedFilePath, ffprobeFn, ffprobeOptions);
    } catch (probeErr) {
        await safeUnlink(uploadedFilePath);
        const isTimeout = probeErr.message?.includes('VIDEO_PROBE_TIMEOUT');
        return res.status(400).json({
            success: false,
            code: isTimeout ? 'VIDEO_PROBE_TIMEOUT' : 'VIDEO_PROBE_FAILED',
            message: isTimeout
                ? 'Tiempo de espera agotado al analizar el video.'
                : 'El archivo de video es inválido, está corrupto o no se pudo determinar su duración.'
        });
    }

    // 3b. Verificación de decodificación real de paquetes del stream de video
    const videoDecoder = req.app.locals?.videoDecoderFn !== undefined
        ? req.app.locals.videoDecoderFn
        : (hasSystemFfmpeg() ? decodeVideoSample : null);
    if (videoDecoder) {
        try {
            await videoDecoder(uploadedFilePath, req.app.locals?.videoDecoderOptions || {});
        } catch (streamErr) {
            await safeUnlink(uploadedFilePath);
            const isTimeout = streamErr.code === 'MEDIA_DECODE_TIMEOUT' || streamErr.message?.includes('TIMEOUT');
            return res.status(400).json({
                success: false,
                code: isTimeout ? 'VIDEO_DECODE_TIMEOUT' : 'VIDEO_STREAM_CORRUPT',
                message: isTimeout
                    ? 'Tiempo de espera agotado al decodificar la muestra del flujo de video.'
                    : 'El flujo de video está corrupto o no se puede decodificar.'
            });
        }
    }

    try {
        const insertQuery = `
            INSERT INTO nexus_tv.content (title, description, source_url, source_type, content_type, duration_seconds, created_at)
            VALUES ($1, $2, $3, 'local_file', 'video', $4, NOW())
            RETURNING *;
        `;
        const result = await activePool.query(insertQuery, [title, req.body.description || '', publicUrl, duration]);
        return res.status(201).json({ success: true, content: result.rows[0] });
    } catch (dbErr) {
        await safeUnlink(uploadedFilePath);
        console.error('❌ Error guardando video en DB:', dbErr.message);
        return res.status(500).json({ success: false, message: 'Error al registrar en base de datos.' });
    }
});

// Registrar URL Externa (Power BI, YouTube, Dashboard Web)
router.post('/external', requireRole('admin', 'editor'), async (req, res) => {
    const activePool = req.app.locals?.dbPool || db.pool;
    const { title, source_url, content_type, duration_seconds, description } = req.body;

    if (!title || !source_url) {
        return res.status(400).json({ success: false, message: 'Título y URL requeridos.' });
    }

    const type = ['video', 'image', 'power_bi', 'url'].includes(content_type) ? content_type : 'url';
    const duration = parseInt(duration_seconds, 10) || 60;

    try {
        const query = `
            INSERT INTO nexus_tv.content (title, description, source_url, source_type, content_type, duration_seconds, created_at)
            VALUES ($1, $2, $3, 'external_url', $4, $5, NOW())
            RETURNING *;
        `;
        const result = await activePool.query(query, [title, description || 'Contenido Externo', source_url, type, duration]);
        res.status(201).json({ success: true, content: result.rows[0] });
    } catch (err) {
        console.error('❌ Error registrando URL externa:', err.message);
        res.status(500).json({ success: false, message: 'Error al registrar contenido externo.' });
    }
});

// Eliminar contenido de la biblioteca y disco
router.post('/delete', requireRole('admin', 'editor'), async (req, res) => {
    const activePool = req.app.locals?.dbPool || db.pool;
    const { content_id, fileUrl } = req.body;

    try {
        let targetUrl = fileUrl;

        if (content_id) {
            const rowRes = await activePool.query('SELECT source_url, source_type FROM nexus_tv.content WHERE id = $1', [content_id]);
            if (rowRes.rows.length > 0) {
                targetUrl = rowRes.rows[0].source_url;
                await activePool.query('DELETE FROM nexus_tv.playlist_content WHERE content_id = $1', [content_id]);
                await activePool.query('DELETE FROM nexus_tv.content WHERE id = $1', [content_id]);
            }
        }

        // Si es archivo local, eliminar del disco asegurando contención en mediaDirectory
        if (targetUrl && targetUrl.startsWith('/media/')) {
            const fileName = path.basename(targetUrl);
            const filePath = path.join(mediaDirectory, fileName);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        res.json({ success: true, message: 'Contenido eliminado exitosamente.' });
    } catch (err) {
        console.error('❌ Error eliminando contenido:', err.message);
        res.status(500).json({ success: false, message: 'Error interno al eliminar el contenido.' });
    }
});

module.exports = {
    router,
    mediaDirectory
};
