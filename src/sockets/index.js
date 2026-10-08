// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — WebSocket Control & Broadcast Hub
// ═══════════════════════════════════════════════════════════

const onlineScreens = new Map(); // tv_uuid -> socket.id
const waitingScreens = new Map(); // socket.id -> { socketId, sessionCode, connectedAt }

// Estado de Contenido Temporal en Vivo (Override de Playlist)
let globalTemporaryContent = null;
const screenTemporaryContent = new Map(); // tv_uuid -> content

function initSockets(io) {
    // ─────────────────────────────────────────────────────────
    // Namespace: /control (Comandos, Broadcast y Auto-Detección)
    // ─────────────────────────────────────────────────────────
    const controlNs = io.of('/control');

    controlNs.on('connection', (socket) => {
        const tvUuid = socket.handshake.query.tv_uuid;
        const sessionCode = socket.handshake.query.session_code;
        const isWaiting = socket.handshake.query.waiting_pairing === 'true';

        // Caso A: Pantalla sin vincular esperando que el Admin le asigne un usuario
        if (isWaiting && sessionCode) {
            const screenInfo = {
                socketId: socket.id,
                sessionCode: String(sessionCode).toUpperCase(),
                ip: socket.handshake.address,
                connectedAt: new Date().toISOString()
            };
            waitingScreens.set(socket.id, screenInfo);
            socket.join(`session:${screenInfo.sessionCode}`);
            console.log(`📡 [Control Hub] TV en espera detectada: PIN #${screenInfo.sessionCode} (Socket: ${socket.id})`);

            controlNs.to('admins').emit('admin:tv_discovered', screenInfo);
        }
        // Caso B: Pantalla vinculada con su UUID
        else if (tvUuid) {
            onlineScreens.set(tvUuid, socket.id);
            socket.join(`tv:${tvUuid}`);
            console.log(`🎮 [Control Hub] TV conectada: [${tvUuid}] en socket ${socket.id}`);

            controlNs.emit('tv:status_change', { tv_uuid: tvUuid, is_online: true, socket_id: socket.id });

            // Si hay un contenido temporal activo (global o específico para esta TV), enviarlo de inmediato
            const activeOverride = globalTemporaryContent || screenTemporaryContent.get(tvUuid);
            if (activeOverride) {
                console.log(`⚡ [Control Hub] Enviando contenido temporal activo a TV [${tvUuid}]`);
                socket.emit('command:temporary_content', activeOverride);
            }
        } 
        // Caso C: Consola de Administración
        else {
            console.log(`🎮 [Control Hub] Consola de Administración conectada: ${socket.id}`);
            socket.join('admins');
        }

        // Heartbeat de pantalla
        socket.on('tv:heartbeat', (data) => {
            if (data && data.tv_uuid) {
                onlineScreens.set(data.tv_uuid, socket.id);
                controlNs.to('admins').emit('tv:heartbeat_received', {
                    tv_uuid: data.tv_uuid,
                    current_content: data.current_content,
                    volume: data.volume,
                    is_override: data.is_override || false,
                    timestamp: new Date().toISOString()
                });
            }
        });

        // Enviar comando a pantalla
        socket.on('admin:send_command', ({ tv_uuid, command, payload }) => {
            console.log(`📡 [Control Hub] Enviando '${command}' a TV [${tv_uuid}]`);
            if (tv_uuid === 'all') {
                controlNs.emit('command:execute', { command, payload });
            } else {
                controlNs.to(`tv:${tv_uuid}`).emit('command:execute', { command, payload });
            }
        });

        socket.on('disconnect', () => {
            if (waitingScreens.has(socket.id)) {
                const info = waitingScreens.get(socket.id);
                waitingScreens.delete(socket.id);
                controlNs.to('admins').emit('admin:tv_lost', info);
                console.log(`📡 [Control Hub] TV en espera desconectada: PIN #${info.sessionCode}`);
            }

            if (tvUuid) {
                onlineScreens.delete(tvUuid);
                console.log(`🎮 [Control Hub] TV desconectada: [${tvUuid}]`);
                controlNs.emit('tv:status_change', { tv_uuid: tvUuid, is_online: false });
            }
        });
    });

    // Vincular remotamente una TV en espera con un usuario/perfil
    function bindWaitingScreen(sessionCode, profile) {
        const upperCode = String(sessionCode).toUpperCase();
        console.log(`🔗 [Control Hub] Vinculando sesión PIN #${upperCode} con perfil: ${profile.name} (${profile.tv_uuid})`);
        
        controlNs.to(`session:${upperCode}`).emit('command:assign_profile', profile);

        for (const [id, item] of waitingScreens.entries()) {
            if (item.sessionCode === upperCode) {
                waitingScreens.delete(id);
                controlNs.to('admins').emit('admin:tv_bound', { sessionCode: upperCode, profile });
                break;
            }
        }
    }

    // Emitir contenido temporal que detiene la playlist
    function setTemporaryContent(target, content) {
        console.log(`🚨 [Control Hub] Emitiendo contenido temporal a [${target}]: ${content.title}`);
        if (target === 'all') {
            globalTemporaryContent = content;
            screenTemporaryContent.clear();
            controlNs.emit('command:temporary_content', content);
        } else {
            screenTemporaryContent.set(target, content);
            controlNs.to(`tv:${target}`).emit('command:temporary_content', content);
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
            controlNs.to(`tv:${target}`).emit('command:clear_temporary', {});
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
        waitingScreens,
        bindWaitingScreen,
        setTemporaryContent,
        clearTemporaryContent,
        getTemporaryState
    };
}

module.exports = {
    initSockets,
    onlineScreens,
    waitingScreens
};
