import { io } from 'socket.io-client';

export function createNextSessionPin(previousPin) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    let nextPin;
    do {
        nextPin = String(1000 + (values[0] % 9000));
        if (nextPin === previousPin) globalThis.crypto.getRandomValues(values);
    } while (nextPin === previousPin);
    return nextPin;
}

export function createWaitingPairingSocket({
    apiBase,
    sessionPin,
    onSessionPinChange,
    onSocket,
    socketFactory = io,
    storage = globalThis.sessionStorage
}) {
    let active = true;
    let currentPin = sessionPin;
    let currentSocket = null;

    const connect = (pin) => {
        const socket = socketFactory(`${apiBase}/control`, {
            auth: { session_code: pin, waiting_pairing: 'true' },
            query: { session_code: pin, waiting_pairing: 'true' },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000
        });
        currentSocket = socket;
        onSocket(socket);

        let rejected = false;
        let renewed = false;
        const renewAfterExpiry = () => {
            if (!active || renewed || currentSocket !== socket) return;
            renewed = true;
            currentPin = createNextSessionPin(currentPin);
            storage?.setItem('tv_session_pin', currentPin);
            onSessionPinChange(currentPin);
            socket.disconnect();
            connect(currentPin);
        };

        socket.on('command:rejected', () => { rejected = true; });
        socket.once('pairing:expired', renewAfterExpiry);
        socket.on('disconnect', (reason) => {
            // Socket.IO does not reconnect after a server-initiated disconnect.
            // The TTL event is the primary signal; this is its delivery fallback.
            if (reason === 'io server disconnect' && !rejected) renewAfterExpiry();
        });
    };

    connect(currentPin);

    return {
        disconnect() {
            active = false;
            currentSocket?.disconnect();
        },
        get socket() {
            return currentSocket;
        }
    };
}
