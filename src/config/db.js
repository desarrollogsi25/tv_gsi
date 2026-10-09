// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Database & Global Configuration
// ═══════════════════════════════════════════════════════════

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const port = parseInt(process.env.PORT, 10) || 3002;
const databasePassword = process.env.PG_PASSWORD || (process.env.NODE_ENV === 'production' ? null : '');
if (process.env.NODE_ENV === 'production' && !databasePassword) {
    throw new Error('PG_PASSWORD must be set when NODE_ENV=production.');
}

// Pool de conexiones PostgreSQL
const pool = new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT, 10) || 5432,
    user: process.env.PG_USER || 'tv',
    password: databasePassword,
    database: process.env.PG_DATABASE || 'nexus_tv',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('⚠️ [DB Pool Error]:', err.message);
});

// Directorio de almacenamiento de media
const defaultMediaDir = (process.platform !== 'win32' && fs.existsSync('/app'))
    ? '/app/media'
    : path.join(__dirname, '..', '..', 'media');

const mediaDirectory = process.env.MEDIA_DIR || defaultMediaDir;

try {
    if (!fs.existsSync(mediaDirectory)) {
        fs.mkdirSync(mediaDirectory, { recursive: true });
    }
} catch (err) {
    // Silently continue in restricted/CI environments without write access to root
    if (process.env.NODE_ENV !== 'production') {
        console.warn('⚠️ [Media Dir Warning]: Could not create media directory:', err.message);
    }
}

module.exports = {
    pool,
    mediaDirectory,
    port
};
