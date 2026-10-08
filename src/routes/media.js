// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Media Storage & Content Management
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { pool, mediaDirectory } = require('../config/db');

// Configuración de almacenamiento Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, mediaDirectory);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${cleanName}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
});

// Listar todos los contenidos de la biblioteca
router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT id, title, description, source_url, source_type, content_type, duration_seconds, created_at
            FROM nexus_tv.content
            ORDER BY created_at DESC;
        `;
        const result = await pool.query(query);
        res.json({ success: true, content: result.rows });
    } catch (err) {
        console.error('❌ Error listando contenidos:', err.message);
        res.status(500).json({ success: false, message: 'Error interno al consultar la biblioteca de medios.' });
    }
});

// Subir archivo local (Video o Imagen)
router.post('/upload', upload.single('mediaFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No se ha subido ningún archivo.' });
    }

    const ext = path.extname(req.file.filename).toLowerCase();
    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    const contentType = isImage ? 'image' : 'video';
    const publicUrl = `/media/${req.file.filename}`;
    const title = req.body.title || req.file.originalname;

    if (isImage) {
        const duration = parseInt(req.body.duration_seconds, 10) || 15;
        try {
            const insertQuery = `
                INSERT INTO nexus_tv.content (title, description, source_url, source_type, content_type, duration_seconds, created_at)
                VALUES ($1, $2, $3, 'local_file', 'image', $4, NOW())
                RETURNING *;
            `;
            const result = await pool.query(insertQuery, [title, req.body.description || '', publicUrl, duration]);
            return res.status(201).json({ success: true, content: result.rows[0] });
        } catch (err) {
            console.error('❌ Error guardando imagen en DB:', err.message);
            return res.status(500).json({ success: false, message: 'Error al registrar en base de datos.' });
        }
    }

    // Video: Obtener duración exacta con ffprobe
    ffmpeg.ffprobe(req.file.path, async (err, metadata) => {
        let duration = 30;
        if (!err && metadata && metadata.format && metadata.format.duration) {
            duration = Math.round(metadata.format.duration);
        }

        try {
            const insertQuery = `
                INSERT INTO nexus_tv.content (title, description, source_url, source_type, content_type, duration_seconds, created_at)
                VALUES ($1, $2, $3, 'local_file', 'video', $4, NOW())
                RETURNING *;
            `;
            const result = await pool.query(insertQuery, [title, req.body.description || '', publicUrl, duration]);
            res.status(201).json({ success: true, content: result.rows[0] });
        } catch (dbErr) {
            console.error('❌ Error guardando video en DB:', dbErr.message);
            res.status(500).json({ success: false, message: 'Error al registrar en base de datos.' });
        }
    });
});

// Registrar URL Externa (Power BI, YouTube, Dashboard Web)
router.post('/external', async (req, res) => {
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
        const result = await pool.query(query, [title, description || 'Contenido Externo', source_url, type, duration]);
        res.status(201).json({ success: true, content: result.rows[0] });
    } catch (err) {
        console.error('❌ Error registrando URL externa:', err.message);
        res.status(500).json({ success: false, message: 'Error al registrar contenido externo.' });
    }
});

// Eliminar contenido de la biblioteca y disco
router.post('/delete', async (req, res) => {
    const { content_id, fileUrl } = req.body;

    try {
        let targetUrl = fileUrl;

        if (content_id) {
            const rowRes = await pool.query('SELECT source_url, source_type FROM nexus_tv.content WHERE id = $1', [content_id]);
            if (rowRes.rows.length > 0) {
                targetUrl = rowRes.rows[0].source_url;
                await pool.query('DELETE FROM nexus_tv.playlist_content WHERE content_id = $1', [content_id]);
                await pool.query('DELETE FROM nexus_tv.content WHERE id = $1', [content_id]);
            }
        }

        // Si es archivo local, eliminar del disco
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
