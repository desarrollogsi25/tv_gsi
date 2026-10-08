// ═══════════════════════════════════════════════════════════
// Nexus TV v2 — Entry Point (Modularizado + Dual-Hub)
// ═══════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Config
const { pool, mediaDirectory, port } = require('./src/config/db');

// Sockets
const { initSockets } = require('./src/sockets/index');

// Routes
const tvRoutes = require('./src/routes/tv');
const { router: adminRoutes, setNamespaces } = require('./src/routes/admin');
const { router: mediaRoutes, mediaDirectory: mediaDirFromRoute } = require('./src/routes/media');

// Services
const { initCronJobs } = require('./src/services/cron');

// ═══════════════════════════════════════
// Express + HTTP Server
// ═══════════════════════════════════════
const app = express();
const server = http.createServer(app);

// Socket.IO con soporte dual-hub
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Inicializar hub de control con auto-descubrimiento y contenido temporal
const { controlNs, waitingScreens, bindWaitingScreen, setTemporaryContent, clearTemporaryContent, getTemporaryState } = initSockets(io);

// Inyectar namespaces y vinculador en las rutas admin
setNamespaces({ controlNs, waitingScreens, bindWaitingScreen, setTemporaryContent, clearTemporaryContent, getTemporaryState });

// ═══════════════════════════════════════
// Middleware
// ═══════════════════════════════════════
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '300mb' }));
app.use(express.urlencoded({ extended: true, limit: '300mb' }));

// Crear directorio de media si no existe
if (!fs.existsSync(mediaDirectory)) {
    fs.mkdirSync(mediaDirectory, { recursive: true });
}

// ═══════════════════════════════════════
// Servir archivos de media con fallback
// ═══════════════════════════════════════
const mediaStatic = express.static(mediaDirectory, {
    etag: false,
    lastModified: false,
    cacheControl: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
    }
});

app.use('/media', (req, res, next) => {
    const requestedFile = req.path.replace(/^\//, '');
    const decodedFile = decodeURIComponent(requestedFile);
    const filePath = path.join(mediaDirectory, decodedFile);

    if (!decodedFile || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Not found', path: filePath });
    }
    
    req.url = '/' + decodedFile;
    return mediaStatic(req, res, next);
});

// ═══════════════════════════════════════
// Rutas
// ═══════════════════════════════════════
app.get('/api/status', (req, res) => {
    res.json({ status: 'online', message: 'Nexus TV API v2 is running.', version: '2.0.0' });
});

app.use('/api/tv', tvRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tv-content', mediaRoutes);

// ═══════════════════════════════════════
// Iniciar servidor
// ═══════════════════════════════════════
server.listen(port, () => {
    console.log(`\n═══════════════════════════════════════`);
    console.log(`  ✅ Nexus TV Enterprise — Server Ready`);
    console.log(`  🌐 HTTP:    http://localhost:${port}`);
    console.log(`  🎮 Hub:     /control (Control Remoto & Broadcast Temporal)`);
    console.log(`═══════════════════════════════════════\n`);
});

// Inicializar cron jobs
initCronJobs();