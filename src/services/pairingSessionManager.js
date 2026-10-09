const crypto = require('crypto');

const PAIRING_SESSION_TTL_MS = 5 * 60 * 1000;
const TOMBSTONE_TTL_MS = 5 * 60 * 1000;

class PairingSessionError extends Error {
    constructor(code, message, status) {
        super(message);
        this.name = 'PairingSessionError';
        this.code = code;
        this.status = status;
    }
}

function createPairingSessionManager(controlNs, options = {}) {
    const ttlMs = options.ttlMs ?? PAIRING_SESSION_TTL_MS;
    const now = options.now || Date.now;
    const schedule = options.setTimeout || setTimeout;
    const cancel = options.clearTimeout || clearTimeout;
    const sessions = new Map();

    function clearSessionTimer(session) {
        if (session.timer) cancel(session.timer);
        session.timer = null;
    }

    function purgeLater(session) {
        clearSessionTimer(session);
        session.timer = schedule(() => sessions.delete(session.pairingSessionId), TOMBSTONE_TTL_MS);
        session.timer.unref?.();
    }

    function notifyLost(session, reason) {
        controlNs.to('admins').emit('admin:tv_lost', {
            pairingSessionId: session.pairingSessionId,
            sessionCode: session.sessionCode,
            socketId: session.socketId,
            ip: session.ip,
            connectedAt: session.connectedAt,
            expiresAt: session.expiresAt,
            reason
        });
    }

    function expire(session, reason = 'expired') {
        if (session.status !== 'pending' && session.status !== 'binding') return;
        session.status = reason === 'expired' ? 'expired' : 'cancelled';
        clearSessionTimer(session);
        notifyLost(session, reason);
        if (reason === 'expired') {
            const socket = controlNs.sockets.get(session.socketId);
            socket?.emit('pairing:expired', { pairingSessionId: session.pairingSessionId });
            socket?.disconnect(true);
        }
        purgeLater(session);
    }

    function register(socket, sessionCode) {
        let pairingSessionId;
        do {
            pairingSessionId = crypto.randomUUID();
        } while (sessions.has(pairingSessionId));

        const connectedAt = new Date(now()).toISOString();
        const session = {
            pairingSessionId,
            socketId: socket.id,
            sessionCode,
            ip: socket.handshake.address,
            connectedAt,
            expiresAt: new Date(now() + ttlMs).toISOString(),
            deadline: now() + ttlMs,
            status: 'pending',
            timer: null,
            targetTvUuid: null,
            operationPromise: null,
            result: null
        };
        session.timer = schedule(() => expire(session), ttlMs);
        session.timer.unref?.();
        sessions.set(pairingSessionId, session);
        socket.data.pairingSessionId = pairingSessionId;
        return session;
    }

    function publicView(session) {
        return {
            pairingSessionId: session.pairingSessionId,
            sessionCode: session.sessionCode,
            socketId: session.socketId,
            ip: session.ip,
            connectedAt: session.connectedAt,
            expiresAt: session.expiresAt
        };
    }

    function listPending() {
        const result = [];
        for (const session of sessions.values()) {
            if (session.status === 'pending' && now() >= session.deadline) expire(session);
            if (session.status !== 'pending') continue;
            const socket = controlNs.sockets.get(session.socketId);
            if (!socket?.connected) {
                expire(session, 'disconnected');
                continue;
            }
            result.push({
                pairingSessionId: session.pairingSessionId,
                sessionCode: session.sessionCode,
                ip: session.ip,
                connectedAt: session.connectedAt,
                expiresAt: session.expiresAt
            });
        }
        return result;
    }

    function onDisconnect(socket) {
        const session = sessions.get(socket.data.pairingSessionId);
        if (session && (session.status === 'pending' || session.status === 'binding')) {
            expire(session, 'disconnected');
        }
    }

    async function bind(pairingSessionId, tvUuid, performBinding) {
        const session = sessions.get(pairingSessionId);
        if (!session) throw new PairingSessionError('PAIRING_SESSION_NOT_FOUND', 'Sesión de emparejamiento no encontrada.', 404);

        if ((session.status === 'pending' || session.status === 'binding') && now() >= session.deadline) {
            expire(session);
        }

        if (session.status === 'bound') {
            if (session.targetTvUuid !== tvUuid) {
                throw new PairingSessionError('PAIRING_SESSION_CONFLICT', 'La sesión ya fue consumida por otro perfil.', 409);
            }
            return { ...session.result, alreadyBound: true };
        }
        if (session.status === 'binding') {
            if (session.targetTvUuid !== tvUuid) {
                throw new PairingSessionError('PAIRING_SESSION_CONFLICT', 'La sesión ya está siendo vinculada a otro perfil.', 409);
            }
            return session.operationPromise;
        }
        if (session.status !== 'pending') {
            throw new PairingSessionError('PAIRING_SESSION_EXPIRED', 'La sesión ya no está pendiente o ha vencido.', 410);
        }

        const socket = controlNs.sockets.get(session.socketId);
        if (!socket?.connected) {
            expire(session, 'disconnected');
            throw new PairingSessionError('PAIRING_SESSION_DISCONNECTED', 'La pantalla se desconectó; inicia un nuevo emparejamiento.', 410);
        }

        session.status = 'binding';
        session.targetTvUuid = tvUuid;
        // Keep the original deadline active during the database transaction too.
        // A request claimed just before expiry must not extend the pairing window.
        const isBindingActive = () => session.status === 'binding' && socket.connected && now() < session.deadline;

        session.operationPromise = (async () => {
            let bindingResult;
            try {
                bindingResult = await performBinding(session, isBindingActive);
                if (!isBindingActive()) {
                    throw new PairingSessionError('PAIRING_SESSION_EXPIRED', 'La sesión dejó de estar activa durante la vinculación.', 410);
                }

                socket.volatile.emit('command:assign_profile', {
                    ...bindingResult.profile,
                    device_token: bindingResult.deviceToken
                });
                session.status = 'bound';
                session.result = {
                    success: true,
                    message: `Pantalla vinculada exitosamente con el perfil ${bindingResult.profile.name} (${bindingResult.profile.location}).`,
                    profile: bindingResult.profile
                };
                purgeLater(session);
                controlNs.to('admins').emit('admin:tv_bound', {
                    pairingSessionId,
                    sessionCode: session.sessionCode,
                    profile: bindingResult.profile
                });
                return { ...session.result, alreadyBound: false };
            } catch (error) {
                if (bindingResult?.rollback && session.status !== 'bound') {
                    await bindingResult.rollback();
                }
                if (session.status === 'binding') {
                    session.targetTvUuid = null;
                    session.operationPromise = null;
                    if (socket.connected && now() < session.deadline) {
                        session.status = 'pending';
                        session.timer = schedule(() => expire(session), session.deadline - now());
                        session.timer.unref?.();
                    } else {
                        expire(session, socket.connected ? 'expired' : 'disconnected');
                    }
                }
                throw error;
            }
        })();

        return session.operationPromise;
    }

    function reject(pairingSessionId) {
        const session = sessions.get(pairingSessionId);
        if (!session) throw new PairingSessionError('PAIRING_SESSION_NOT_FOUND', 'Sesión de emparejamiento no encontrada.', 404);
        if (session.status === 'pending' && now() >= session.deadline) expire(session);
        if (session.status === 'binding' || session.status === 'bound') {
            throw new PairingSessionError('PAIRING_SESSION_CONFLICT', 'La sesión ya fue reclamada.', 409);
        }
        if (session.status !== 'pending') {
            throw new PairingSessionError('PAIRING_SESSION_EXPIRED', 'La sesión ya no está pendiente o ha vencido.', 410);
        }

        session.status = 'rejected';
        clearSessionTimer(session);
        const socket = controlNs.sockets.get(session.socketId);
        socket?.emit('command:rejected', {});
        socket?.disconnect(true);
        notifyLost(session, 'rejected');
        purgeLater(session);
        return true;
    }

    function close() {
        for (const session of sessions.values()) clearSessionTimer(session);
        sessions.clear();
    }

    return {
        sessions,
        register,
        publicView,
        listPending,
        onDisconnect,
        bind,
        reject,
        expire,
        close,
        ttlMs
    };
}

module.exports = {
    PAIRING_SESSION_TTL_MS,
    PairingSessionError,
    createPairingSessionManager
};
