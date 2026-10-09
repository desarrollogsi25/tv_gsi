// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — WebSocket Control & Broadcast Hub (Hardened RSK-025)
// ═══════════════════════════════════════════════════════════

const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../config/jwt');
const defaultDb = require('../config/db');
const { verifyDeviceToken, isValidUuid, isValidDeviceTokenFormat } = require('../utils/deviceAuth');
const { createPairingSessionManager } = require('../services/pairingSessionManager');

const onlineScreens = new Map(); // tv_uuid -> active primary socket.id
const screenSockets = new Map(); // tv_uuid -> Set<socket.id> (RSK-026: multi-socket safe presence)

// Estado de Contenido Temporal en Vivo (Override de Playlist)
let globalTemporaryContent = null;
const screenTemporaryContent = new Map(); // tv_uuid -> content

function initSockets(io, opts = {}) {
    const activePool = opts?.pool || defaultDb.pool;

    // ─────────────────────────────────────────────────────────
    // Namespace: /control (Comandos, Broadcast y Auto-Detección)
    // ─────────────────────────────────────────────────────────
    const controlNs = io.of('/control');
    const pairingSessions = createPairingSessionManager(controlNs, { ttlMs: opts.pairingTtlMs });

    controlNs.use(async (socket, next) => {
        try {
            const auth = socket.handshake.auth || {};
            const query = socket.handshake.query || {};

            // 1. Extraer identificadores y credenciales
            const tvUuid = auth.tv_uuid || query.tv_uuid;
            const deviceToken = auth.device_token || query.device_token || socket.handshake.headers?.['x-device-token'];
            const isWaiting = auth.waiting_pairing === 'true' || query.waiting_pairing === 'true';
            const sessionCode = auth.session_code || query.session_code;
            const adminToken = auth.token;

            // Parámetros incompatibles: no se permite solicitar pairing declarando un tv_uuid registrado
            if (tvUuid && isWaiting) {
                return next(new Error('Conflicting handshake parameters: cannot request pairing while declaring tv_uuid'));
            }

            // CASO A: Televisión Registrada (Declara tv_uuid)
            if (tvUuid) {
                if (!deviceToken) {
                    return next(new Error('TV authentication failed: device_token is required'));
                }
                if (!isValidUuid(tvUuid)) {
                    return next(new Error('TV authentication failed: malformed tv_uuid'));
                }
                if (!isValidDeviceTokenFormat(deviceToken)) {
                    return next(new Error('TV authentication failed: malformed device_token'));
                }

                // Consultar en PostgreSQL
                const screenRes = await activePool.query(
                    'SELECT id, tv_uuid, name, location, is_active, device_token_hash FROM nexus_tv.tv_screens WHERE tv_uuid = $1',
                    [tvUuid]
                );

                if (screenRes.rows.length === 0) {
                    return next(new Error('TV authentication failed: screen not found'));
                }

                const screen = screenRes.rows[0];
                if (!screen.is_active) {
                    return next(new Error('TV authentication failed: screen is inactive'));
                }

                if (!screen.device_token_hash) {
                    return next(new Error('TV authentication failed: screen has no active credentials, pairing required'));
                }

                const isValid = verifyDeviceToken(deviceToken, screen.device_token_hash);
                if (!isValid) {
                    return next(new Error('TV authentication failed: invalid device credentials'));
                }

                socket.data.clientType = 'tv';
                socket.data.tv = {
                    id: screen.id,
                    tv_uuid: screen.tv_uuid,
                    name: screen.name,
                    location: screen.location
                };
                return next();
            }

            // CASO B: Televisión en espera de vinculación (Pairing por PIN)
            if (isWaiting) {
                if (!sessionCode || typeof sessionCode !== 'string' || !sessionCode.trim()) {
                    return next(new Error('Pairing failed: session_code is required'));
                }
                const cleanCode = sessionCode.trim().toUpperCase();
                if (!/^[A-Z0-9]{4,10}$/.test(cleanCode)) {
                    return next(new Error('Pairing failed: invalid session_code format'));
                }

                socket.data.clientType = 'waiting_tv';
                socket.data.sessionCode = cleanCode;
                return next();
            }

            // CASO C: Consola Administrativa
            if (adminToken) {
                let decoded;
                try {
                    decoded = jwt.verify(adminToken, JWT_SECRET);
                } catch (_err) {
                    return next(new Error('Invalid or expired admin token'));
                }

                if (decoded.role !== 'admin') {
                    return next(new Error('Administrator access required'));
                }

                socket.data.clientType = 'admin';
                socket.data.user = decoded;
                return next();
            }

            // Ningún canal de autenticación válido proporcionado
            return next(new Error('Authentication required: provide valid device credentials or admin token'));
        } catch (err) {
            return next(new Error(err.message || 'Authentication error'));
        }
    });

    controlNs.on('connection', (socket) => {
        const clientType = socket.data.clientType;

        // Caso A: Pantalla sin vincular esperando que el Admin le asigne un perfil
        if (clientType === 'waiting_tv') {
            const screenInfo = pairingSessions.register(socket, socket.data.sessionCode);
            console.log(`📡 [Control Hub] TV en espera detectada: PIN #${screenInfo.sessionCode} (Socket: ${socket.id})`);

            controlNs.to('admins').emit('admin:tv_discovered', pairingSessions.publicView(screenInfo));
        }
        // Caso B: Pantalla vinculada con credenciales verificadas
        else if (clientType === 'tv') {
            const tvUuid = socket.data.tv.tv_uuid;

            let socketsSet = screenSockets.get(tvUuid);
            if (!socketsSet) {
                socketsSet = new Set();
                screenSockets.set(tvUuid, socketsSet);
            }
            socketsSet.add(socket.id);
            onlineScreens.set(tvUuid, socket.id);

            socket.join(`tv:${tvUuid}`);
            socket.join(`screen_${tvUuid}`);
            console.log(`🎮 [Control Hub] TV autenticada: [${tvUuid}] en socket ${socket.id}`);

            controlNs.emit('tv:status_change', { tv_uuid: tvUuid, is_online: true, socket_id: socket.id });

            // Si hay un contenido temporal activo (global o específico para esta TV), enviarlo de inmediato
            const activeOverride = globalTemporaryContent || screenTemporaryContent.get(tvUuid);
            if (activeOverride) {
                console.log(`⚡ [Control Hub] Enviando contenido temporal activo a TV [${tvUuid}]`);
                socket.emit('command:temporary_content', activeOverride);
            }
            socket.emit('screen:registered', { tv_uuid: tvUuid });
        } 
        // Caso C: Consola de Administración
        else if (clientType === 'admin') {
            console.log(`🎮 [Control Hub] Consola de Administración conectada: ${socket.id} (${socket.data.user?.username})`);
            socket.join('admins');
        }

        socket.on('register_screen', ({ tv_uuid: registeredUuid } = {}) => {
            if (socket.data.clientType !== 'tv' || registeredUuid !== socket.data.tv?.tv_uuid) {
                socket.emit('screen:registration_error', { message: 'UUID de pantalla no coincide o cliente no autenticado.' });
                return;
            }
            socket.join(`screen_${socket.data.tv.tv_uuid}`);
            socket.emit('screen:registered', { tv_uuid: socket.data.tv.tv_uuid });
        });

        // Heartbeat de pantalla autenticada
        socket.on('tv:heartbeat', (data) => {
            if (socket.data.clientType !== 'tv') return;
            const authenticatedUuid = socket.data.tv.tv_uuid;

            onlineScreens.set(authenticatedUuid, socket.id);
            controlNs.to('admins').emit('tv:heartbeat_received', {
                tv_uuid: authenticatedUuid,
                current_content: data?.current_content,
                volume: data?.volume,
                is_override: data?.is_override || false,
                is_audio_unlocked: data?.is_audio_unlocked || false,
                timestamp: new Date().toISOString()
            });
        });

        // Enviar comando a pantalla (Exclusivo para administradores)
        socket.on('admin:send_command', ({ tv_uuid, command, payload }) => {
            if (socket.data.clientType !== 'admin' || !socket.data.user || socket.data.user.role !== 'admin') {
                console.warn(`⚠️ [Control Hub] Intento no autorizado de enviar comando '${command}' sin rol de administrador.`);
                return;
            }
            console.log(`📡 [Control Hub] Enviando '${command}' a TV [${tv_uuid}]`);
            if (tv_uuid === 'all') {
                controlNs.emit('command:execute', { command, payload });
            } else {
                controlNs.to(`tv:${tv_uuid}`).to(`screen_${tv_uuid}`).emit('command:execute', { command, payload });
            }
        });

        socket.on('disconnect', () => {
            if (socket.data.clientType === 'waiting_tv') {
                pairingSessions.onDisconnect(socket);
                console.log(`📡 [Control Hub] TV en espera desconectada: PIN #${socket.data.sessionCode}`);
            }

            if (socket.data.clientType === 'tv') {
                const tvUuid = socket.data.tv.tv_uuid;
                const socketsSet = screenSockets.get(tvUuid);
                if (socketsSet) {
                    socketsSet.delete(socket.id);
                    if (socketsSet.size === 0) {
                        screenSockets.delete(tvUuid);
                        if (onlineScreens.get(tvUuid) === socket.id) {
                            onlineScreens.delete(tvUuid);
                        }
                        console.log(`🎮 [Control Hub] TV desconectada (sin sockets activos): [${tvUuid}]`);
                        controlNs.emit('tv:status_change', { tv_uuid: tvUuid, is_online: false });
                    } else {
                        // Sigue habiendo al menos otro socket activo para esta TV (reconexión/multi-tab)
                        const remainingSocketId = socketsSet.values().next().value;
                        onlineScreens.set(tvUuid, remainingSocketId);
                        console.log(`🎮 [Control Hub] Socket secundario desconectado para TV [${tvUuid}], socket principal activo: ${remainingSocketId}`);
                    }
                }
            }
        });
    });

    // Emitir contenido temporal que detiene la playlist
    function setTemporaryContent(target, content) {
        console.log(`🚨 [Control Hub] Emitiendo contenido temporal a [${target}]: ${content.title}`);
        if (target === 'all') {
            globalTemporaryContent = content;
            screenTemporaryContent.clear();
            controlNs.emit('command:temporary_content', content);
        } else {
            screenTemporaryContent.set(target, content);
            controlNs.to(`tv:${target}`).to(`screen_${target}`).emit('command:temporary_content', content);
        }
    }

    // Quitar contenido temporal y reanudar playlist
    function clearTemporaryContent(target) {
        console.log(`⏹️ [Control Hub] Finalizando contenido temporal en [${target}], reanudando playlist.`);
        if (!target || target === 'all') {
            globalTemporaryContent = null;
            screenTemporaryContent.clear();
            controlNs.emit('command:clear_temporary', {});
        } else {
            screenTemporaryContent.delete(target);
            controlNs.to(`tv:${target}`).to(`screen_${target}`).emit('command:clear_temporary', {});
            if (globalTemporaryContent) {
                globalTemporaryContent = null;
                controlNs.emit('command:clear_temporary', {});
            }
        }
        controlNs.to('admins').emit('admin:temporary_cleared', { target });
    }

    function getTemporaryState() {
        return {
            global: globalTemporaryContent,
            byScreen: Object.fromEntries(screenTemporaryContent)
        };
    }

    return {
        controlNs,
        onlineScreens,
        screenSockets,
        pairingSessions,
        setTemporaryContent,
        clearTemporaryContent,
        getTemporaryState
    };
}

module.exports = {
    initSockets,
    onlineScreens,
    screenSockets,
    PAIRING_SESSION_TTL_MS: require('../services/pairingSessionManager').PAIRING_SESSION_TTL_MS
};
