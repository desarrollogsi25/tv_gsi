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
    const ackTimeoutMs = options.ackTimeoutMs ?? 5000;
    const maxRetries = options.maxRetries ?? 1;
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

    async function deliverWithConfirmation(socket, session, bindingResult) {
        const payload = {
            ...bindingResult.profile,
            device_token: bindingResult.deviceToken,
            pairingSessionId: session.pairingSessionId
        };
        const attemptTimeoutMs = Math.max(50, Math.floor(ackTimeoutMs / (maxRetries + 1)));

        const attemptDelivery = (attemptNumber) => new Promise((resolve, reject) => {
            let settled = false;
            let ackTimer = null;

            const cleanup = () => {
                if (ackTimer) cancel(ackTimer);
                socket.off('tv:pairing_confirmed', onConfirmed);
                socket.off('tv:pairing_rejected', onRejected);
                socket.off('disconnect', onDisconnectHandler);
            };

            const settleSuccess = (data) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(data);
            };

            const settleFailure = (err) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(err);
            };

            const onConfirmed = (data) => {
                if (!data || data.pairingSessionId !== session.pairingSessionId) return;
                if (data.tv_uuid && data.tv_uuid !== session.targetTvUuid) {
                    return settleFailure(new PairingSessionError(
                        'PAIRING_CONFIRMATION_MISMATCH',
                        'Confirmación no coincide con el perfil asignado.',
                        400
                    ));
                }
                settleSuccess(data);
            };

            const onRejected = (data) => {
                if (!data || data.pairingSessionId !== session.pairingSessionId) return;
                settleFailure(new PairingSessionError(
                    'PAIRING_CONFIRMATION_REJECTED',
                    data.reason || data.message || 'La pantalla rechazó la asignación del perfil.',
                    422
                ));
            };

            const onDisconnectHandler = () => {
                settleFailure(new PairingSessionError(
                    'PAIRING_SESSION_DISCONNECTED',
                    'La pantalla se desconectó durante la confirmación.',
                    410
                ));
            };

            socket.on('tv:pairing_confirmed', onConfirmed);
            socket.on('tv:pairing_rejected', onRejected);
            socket.once('disconnect', onDisconnectHandler);

            ackTimer = schedule(() => {
                settleFailure(new PairingSessionError(
                    'PAIRING_CONFIRMATION_TIMEOUT',
                    `Tiempo de espera agotado esperando confirmación de la pantalla (intento ${attemptNumber}).`,
                    408
                ));
            }, attemptTimeoutMs);
            ackTimer.unref?.();

            try {
                socket.emit('command:assign_profile', payload, (response) => {
                    if (response && response.success === false) {
                        settleFailure(new PairingSessionError(
                            'PAIRING_CONFIRMATION_REJECTED',
                            response.error || response.reason || 'La pantalla no pudo almacenar las credenciales.',
                            422
                        ));
                    } else if (response && (response.success === true || response.tv_uuid === session.targetTvUuid)) {
                        settleSuccess(response);
                    }
                });
            } catch (emitErr) {
                settleFailure(emitErr);
            }
        });

        let lastErr = null;
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            if (!socket.connected) {
                throw new PairingSessionError('PAIRING_SESSION_DISCONNECTED', 'La pantalla se desconectó.', 410);
            }
            if (now() >= session.deadline) {
                throw new PairingSessionError('PAIRING_SESSION_EXPIRED', 'La sesión expiró antes de la confirmación.', 410);
            }

            try {
                await attemptDelivery(attempt);
                return;
            } catch (err) {
                lastErr = err;
                if (err.code === 'PAIRING_CONFIRMATION_REJECTED' ||
                    err.code === 'PAIRING_SESSION_DISCONNECTED' ||
                    err.code === 'PAIRING_CONFIRMATION_MISMATCH') {
                    throw err;
                }
            }
        }
        throw lastErr;
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

                await deliverWithConfirmation(socket, session, bindingResult);

                // ── Promover credencial pendiente (Segunda transacción corta) ──
                if (typeof bindingResult.promote === 'function') {
                    await bindingResult.promote();
                } else if (typeof bindingResult.commit === 'function') {
                    await bindingResult.commit();
                }

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
                let rollbackError = null;
                if (session.status !== 'bound') {
                    const cancelFn = bindingResult?.cancel || bindingResult?.rollback;
                    if (typeof cancelFn === 'function') {
                        try {
                            await cancelFn();
                            session.rollbackCompleted = true;
                        } catch (rollbackErr) {
                            rollbackError = rollbackErr;
                            session.rollbackCompleted = false;
                            session.rollbackFailed = true;
                            session.rollbackError = rollbackErr.message || String(rollbackErr);
                            console.error('❌ Error cancelando vinculación pendiente:', rollbackErr.message);
                        }
                    }
                }
                if (session.status === 'binding') {
                    session.targetTvUuid = null;
                    session.operationPromise = null;
                    if (rollbackError) {
                        session.status = 'failed';
                        expire(session, 'rollback_failed');
                    } else if (socket.connected && now() < session.deadline) {
                        session.status = 'pending';
                        session.timer = schedule(() => expire(session), session.deadline - now());
                        session.timer.unref?.();
                    } else {
                        expire(session, socket.connected ? 'expired' : 'disconnected');
                    }
                }
                if (rollbackError) {
                    error.rollbackFailed = true;
                    error.rollbackError = rollbackError;
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
