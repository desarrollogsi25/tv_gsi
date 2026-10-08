// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Database & Global Configuration
// ═══════════════════════════════════════════════════════════

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const port = parseInt(process.env.PORT, 10) || 3002;

// Pool de conexiones PostgreSQL
const pool = new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT, 10) || 5432,
    user: process.env.PG_USER || 'tv',
    password: process.env.PG_PASSWORD || 'Gs1$2099Dr#24zXcv',
    database: process.env.PG_DATABASE || 'nexus_tv',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('⚠️ [DB Pool Error]:', err.message);
});

// Directorio de almacenamiento de media
const defaultMediaDir = process.platform === 'win32'
    ? path.join(__dirname, '..', '..', 'media')
    : '/app/media';

const mediaDirectory = process.env.MEDIA_DIR || defaultMediaDir;

if (!fs.existsSync(mediaDirectory)) {
    fs.mkdirSync(mediaDirectory, { recursive: true });
}

module.exports = {
    pool,
    mediaDirectory,
    port
};
