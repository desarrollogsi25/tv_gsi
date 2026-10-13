// ═══════════════════════════════════════════════════════════
// Suite de Pruebas de Seguridad: Autenticación de Dispositivos TV (RSK-025)
// Cubre los 18 escenarios de seguridad obligatorios de Socket.IO /control
// ═══════════════════════════════════════════════════════════

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');
// Determinismo AUD-006: el hub global del archivo debe construirse con el valor
// predeterminado seguro, independientemente del entorno donde se ejecute la suite.
process.env.ALLOW_QUERY_DEVICE_TOKEN = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Server } = require('socket.io');
const { io: ioc } = require('socket.io-client');
const jwt = require('jsonwebtoken');

const JWT_SECRET = require('../src/config/jwt');
const { initSockets } = require('../src/sockets/index');
const {
    generateDeviceToken,
    hashDeviceToken,
    verifyDeviceToken,
    isValidUuid,
    isValidDeviceTokenFormat
} = require('../src/utils/deviceAuth');

// Fixtures aislados
const TV_A_UUID = '11111111-1111-4111-8111-111111111111';
const TV_B_UUID = '22222222-2222-4222-8222-222222222222';
const TV_INACTIVE_UUID = '33333333-3333-4333-8333-333333333333';
const TV_REVOKED_UUID = '44444444-4444-4444-8444-444444444444';

const TOKEN_A = generateDeviceToken();
const TOKEN_B = generateDeviceToken();
const TOKEN_INACTIVE = generateDeviceToken();

let server;
let ioServer;
let socketHub;
let serverPort;
let screensDb;
const clientSockets = new Set();

function createMockPool() {
    return {
        async query(sql, params) {
            if (/SELECT.*FROM nexus_tv\.tv_screens WHERE tv_uuid = \$1/i.test(sql)) {
                const screen = screensDb.get(params[0]);
                return { rows: screen ? [{ ...screen }] : [] };
            }
            if (/UPDATE nexus_tv\.tv_screens SET.*device_token_hash = \$1/i.test(sql)) {
                const screen = screensDb.get(params[1]);
                if (screen) {
                    screen.device_token_hash = params[0];
                    screen.is_active = true;
                }
                return { rowCount: 1 };
            }
            return { rows: [] };
        }
    };
}

function connectClient(options = {}) {
    return new Promise((resolve) => {
        const client = ioc(`http://127.0.0.1:${serverPort}/control`, {
            transports: ['websocket'],
            reconnection: false,
            autoConnect: true,
            ...options
        });
        clientSockets.add(client);

        let resolved = false;
        client.on('connect', () => {
            if (!resolved) {
                resolved = true;
                resolve({ client, error: null });
            }
        });
        client.on('connect_error', (err) => {
            if (!resolved) {
                resolved = true;
                resolve({ client, error: { message: err.message } });
            }
        });
    });
}

function closeClient(client) {
    if (!client) return Promise.resolve();

    return new Promise((resolve) => {
        const engine = client.io.engine;
        const serverSocket = client.id
            ? ioServer?.of('/control').sockets.get(client.id)
            : null;
        let settled = false;
        let clientClosed = !engine || engine.readyState === 'closed';
        let serverClosed = !serverSocket || !serverSocket.connected;
        const finish = () => {
            if (settled || !clientClosed || !serverClosed) return;
            settled = true;
            clientSockets.delete(client);
            resolve();
        };

        if (!clientClosed) {
            engine.once('close', () => {
                clientClosed = true;
                finish();
            });
        }
        if (!serverClosed) {
            serverSocket.once('disconnect', () => {
                serverClosed = true;
                finish();
            });
        }

        client.disconnect();
        if (engine && engine.readyState !== 'closed') engine.close();
        finish();
    });
}

test.before(async () => {
    screensDb = new Map();
    screensDb.set(TV_A_UUID, {
        id: 1,
        tv_uuid: TV_A_UUID,
        name: 'Pantalla Sala A',
        location: 'Piso 1',
        is_active: true,
        device_token_hash: hashDeviceToken(TOKEN_A)
    });
    screensDb.set(TV_B_UUID, {
        id: 2,
        tv_uuid: TV_B_UUID,
        name: 'Pantalla Sala B',
        location: 'Piso 2',
        is_active: true,
        device_token_hash: hashDeviceToken(TOKEN_B)
    });
    screensDb.set(TV_INACTIVE_UUID, {
        id: 3,
        tv_uuid: TV_INACTIVE_UUID,
        name: 'Pantalla Inactiva',
        location: 'Depósito',
        is_active: false,
        device_token_hash: hashDeviceToken(TOKEN_INACTIVE)
    });
    screensDb.set(TV_REVOKED_UUID, {
        id: 4,
        tv_uuid: TV_REVOKED_UUID,
        name: 'Pantalla Revocada',
        location: 'Piso 3',
        is_active: true,
        device_token_hash: null // Credencial revocada/sin asignar
    });

    server = http.createServer();
    ioServer = new Server(server, { cors: { origin: '*' } });
    socketHub = initSockets(ioServer, { pool: createMockPool() });

    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            serverPort = server.address().port;
            resolve();
        });
    });
});

test.after(async () => {
    await Promise.all([...clientSockets].map(closeClient));

    socketHub?.pairingSessions.close();

    if (ioServer) {
        await new Promise((resolve) => ioServer.close(resolve));
    }

    if (server?.listening) {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
                else resolve();
            });
        });
    }
});

// ─────────────────────────────────────────────────────────────
// 1. Conexión de TV sin UUID y sin credencial: no se registra como TV
// ─────────────────────────────────────────────────────────────
test('1. Conexión de TV sin UUID y sin credencial: no se registra como TV', async () => {
    const { client, error } = await connectClient({});
    assert.ok(error, 'La conexión sin credenciales debe ser rechazada');
    assert.match(error.message, /Authentication required/i);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 2. Conexión con UUID conocido y sin credencial: rechazada (Vulnerabilidad RSK-025 corregida)
// ─────────────────────────────────────────────────────────────
test('2. Conexión con UUID conocido y sin credencial: rechazada', async () => {
    const { client, error } = await connectClient({
        auth: { tv_uuid: TV_A_UUID }
    });
    assert.ok(error, 'Debe rechazar la conexión que sólo declara tv_uuid');
    assert.match(error.message, /device_token is required/i);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 3. Conexión con UUID y credencial inexistente / vacía: rechazada
// ─────────────────────────────────────────────────────────────
test('3. Conexión con UUID y credencial vacía: rechazada', async () => {
    const { client, error } = await connectClient({
        auth: { tv_uuid: TV_A_UUID, device_token: '' }
    });
    assert.ok(error, 'Debe rechazar token vacío');
    assert.match(error.message, /device_token is required/i);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 4. Credencial malformada: rechazada
// ─────────────────────────────────────────────────────────────
test('4. Credencial malformada: rechazada', async () => {
    const { client, error } = await connectClient({
        auth: { tv_uuid: TV_A_UUID, device_token: 'not-a-valid-token-format' }
    });
    assert.ok(error, 'Debe rechazar credencial malformada');
    assert.match(error.message, /malformed device_token/i);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 5. Credencial de TV A utilizada con UUID de TV B: rechazada
// ─────────────────────────────────────────────────────────────
test('5. Credencial de TV A utilizada con UUID de TV B: rechazada', async () => {
    const { client, error } = await connectClient({
        auth: { tv_uuid: TV_B_UUID, device_token: TOKEN_A }
    });
    assert.ok(error, 'Debe rechazar credencial cruzada de otra TV');
    assert.match(error.message, /invalid device credentials/i);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 6. Credencial revocada: rechazada
// ─────────────────────────────────────────────────────────────
test('6. Credencial revocada: rechazada', async () => {
    const fakeToken = generateDeviceToken();
    const { client, error } = await connectClient({
        auth: { tv_uuid: TV_REVOKED_UUID, device_token: fakeToken }
    });
    assert.ok(error, 'Debe rechazar conexión en pantalla con credencial revocada (hash null)');
    assert.match(error.message, /pairing required/i);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 7. Pantalla inactiva: no puede autenticarse como pantalla operativa
// ─────────────────────────────────────────────────────────────
test('7. Pantalla inactiva: no puede autenticarse como pantalla operativa', async () => {
    const { client, error } = await connectClient({
        auth: { tv_uuid: TV_INACTIVE_UUID, device_token: TOKEN_INACTIVE }
    });
    assert.ok(error, 'Debe rechazar pantalla inactiva');
    assert.match(error.message, /screen is inactive/i);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 8. Credencial válida de TV A: aceptada para TV A
// ─────────────────────────────────────────────────────────────
test('8. Credencial válida de TV A: aceptada para TV A', async () => {
    const { client, error } = await connectClient({
        auth: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
    });
    assert.equal(error, null, 'Credencial legítima debe ser aceptada');
    assert.equal(socketHub.onlineScreens.has(TV_A_UUID), true);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 9. Credencial válida después de una reconexión: aceptada si sigue autorizada
// ─────────────────────────────────────────────────────────────
test('9. Credencial válida después de una reconexión: aceptada si sigue autorizada', async () => {
    const c1 = await connectClient({
        auth: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
    });
    assert.equal(c1.error, null);
    await closeClient(c1.client);

    // Pequeña pausa para desconexión
    await new Promise((r) => setTimeout(r, 50));

    const c2 = await connectClient({
        auth: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
    });
    assert.equal(c2.error, null, 'Reconexión con credencial legítima debe conectarse exitosamente');
    await closeClient(c2.client);
});

// ─────────────────────────────────────────────────────────────
// 10. Nueva vinculación: credencial anterior invalidada
// ─────────────────────────────────────────────────────────────
test('10. Nueva vinculación: credencial anterior invalidada', async () => {
    const oldToken = TOKEN_B;
    const newToken = generateDeviceToken();
    const newHash = hashDeviceToken(newToken);

    // Simular que el admin rotó/revinculó la pantalla B en BD
    screensDb.get(TV_B_UUID).device_token_hash = newHash;

    // Intentar conectar con la credencial antigua
    const { client: oldClient, error: oldError } = await connectClient({
        auth: { tv_uuid: TV_B_UUID, device_token: oldToken }
    });
    assert.ok(oldError, 'El token previo debe ser rechazado tras una revinculación');
    assert.match(oldError.message, /invalid device credentials/i);
    await closeClient(oldClient);

    // Conectar con la nueva credencial
    const { client: newClient, error: newError } = await connectClient({
        auth: { tv_uuid: TV_B_UUID, device_token: newToken }
    });
    assert.equal(newError, null, 'La nueva credencial debe ser aceptada');
    await closeClient(newClient);
});

// ─────────────────────────────────────────────────────────────
// 11. PIN duplicado o sesión pendiente inexistente: no puede transferir un perfil ajeno
// ─────────────────────────────────────────────────────────────
test('11. Una identidad de sesión inexistente no puede vincular un perfil', async () => {
    await assert.rejects(
        socketHub.pairingSessions.bind('00000000-0000-4000-8000-000000000000', TV_A_UUID, async () => {
            assert.fail('No debe ejecutarse el binder para una sesión inexistente');
        }),
        (error) => error.code === 'PAIRING_SESSION_NOT_FOUND' && error.status === 404
    );
});

// ─────────────────────────────────────────────────────────────
// 12. TV pendiente: puede solicitar pairing sin adquirir permisos administrativos
// ─────────────────────────────────────────────────────────────
test('12. TV pendiente: puede solicitar pairing sin adquirir permisos administrativos', async () => {
    const { client, error } = await connectClient({
        auth: { session_code: '5566', waiting_pairing: 'true' }
    });
    assert.equal(error, null, 'TV en espera de pairing debe ser admitida');
    const waiting = socketHub.pairingSessions.listPending().find((item) => item.sessionCode === '5566');
    assert.ok(waiting, 'La sesión del cliente debe aparecer en la lista pendiente');
    assert.equal(socketHub.pairingSessions.sessions.get(waiting.pairingSessionId).socketId, client.id);

    // Verificar que un intento de emitir comando administrativo desde este socket no tiene efecto
    let commandReceived = false;
    socketHub.controlNs.on('command:execute', () => { commandReceived = true; });
    client.emit('admin:send_command', { tv_uuid: 'all', command: 'reload' });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(commandReceived, false, 'TV en espera no tiene permisos administrativos');
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 13. Socket administrativo sin token: rechazado
// ─────────────────────────────────────────────────────────────
test('13. Socket administrativo sin token: rechazado', async () => {
    const { client, error } = await connectClient({});
    assert.ok(error);
    assert.match(error.message, /Authentication required/i);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 14. Socket administrativo con rol viewer: rechazado
// ─────────────────────────────────────────────────────────────
test('14. Socket administrativo con rol viewer: rechazado', async () => {
    const viewerToken = jwt.sign({ id: 10, username: 'viewer_user', role: 'viewer' }, JWT_SECRET);
    const { client, error } = await connectClient({
        auth: { token: viewerToken }
    });
    assert.ok(error, 'Usuario viewer debe ser rechazado en /control');
    assert.match(error.message, /Administrator access required/i);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 15. Socket administrativo con rol editor: rechazado
// ─────────────────────────────────────────────────────────────
test('15. Socket administrativo con rol editor: rechazado', async () => {
    const editorToken = jwt.sign({ id: 11, username: 'editor_user', role: 'editor' }, JWT_SECRET);
    const { client, error } = await connectClient({
        auth: { token: editorToken }
    });
    assert.ok(error, 'Usuario editor debe ser rechazado en /control');
    assert.match(error.message, /Administrator access required/i);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 16. Socket administrativo con rol admin: aceptado
// ─────────────────────────────────────────────────────────────
test('16. Socket administrativo con rol admin: aceptado', async () => {
    const adminToken = jwt.sign({ id: 1, username: 'admin_user', role: 'admin' }, JWT_SECRET);
    const { client, error } = await connectClient({
        auth: { token: adminToken }
    });
    assert.equal(error, null, 'Usuario admin con token válido debe ser admitido');
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 17. Desconexión de un socket antiguo: no elimina la presencia del socket actual (RSK-026)
// ─────────────────────────────────────────────────────────────
test('17. Desconexión de un socket antiguo: no elimina la presencia del socket actual', async () => {
    // Conectar socket primario de TV A
    const s1 = await connectClient({
        auth: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
    });
    assert.equal(s1.error, null);

    // Conectar socket secundario de TV A (reconexión / nueva pestaña)
    const s2 = await connectClient({
        auth: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
    });
    assert.equal(s2.error, null);

    // Desconectar el primer socket (antiguo)
    await closeClient(s1.client);
    await new Promise((r) => setTimeout(r, 60));

    // La TV debe seguir ONLINE en onlineScreens porque el socket 2 continúa conectado
    assert.equal(socketHub.onlineScreens.has(TV_A_UUID), true, 'La presencia debe mantenerse mientras haya un socket activo');
    assert.equal(socketHub.onlineScreens.get(TV_A_UUID), s2.client.id);

    await closeClient(s2.client);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(socketHub.onlineScreens.has(TV_A_UUID), false, 'Debe marcarse offline solo al desconectar todos los sockets');
});

// ─────────────────────────────────────────────────────────────
// 18. Limpieza de solicitudes pendientes al desconectar
// ─────────────────────────────────────────────────────────────
test('18. Limpieza de solicitudes pendientes al desconectar', async () => {
    const { client, error } = await connectClient({
        auth: { session_code: '7788', waiting_pairing: 'true' }
    });
    assert.equal(error, null);
    const waiting = socketHub.pairingSessions.listPending().find((item) => item.sessionCode === '7788');
    assert.ok(waiting);
    const session = socketHub.pairingSessions.sessions.get(waiting.pairingSessionId);
    assert.equal(session.socketId, client.id);

    await closeClient(client);
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(session.status, 'cancelled', 'La sesión debe consumirse al desconectar');
    assert.equal(socketHub.pairingSessions.listPending().some((item) => item.pairingSessionId === waiting.pairingSessionId), false);
});

// ─────────────────────────────────────────────────────────────
// 19. HTTP POST /api/tv/login: Rechaza peticiones sin credencial de dispositivo
// ─────────────────────────────────────────────────────────────
test('19. HTTP POST /api/tv/login: Rechaza peticiones que declaran solo tv_uuid sin token', async () => {
    const tvRoutes = require('../src/routes/tv');
    const loginHandler = tvRoutes.stack.find((layer) => layer.route && layer.route.path === '/login').route.stack[0].handle;

    let resStatus = null;
    let resData = null;
    const req = {
        body: { tv_uuid: TV_A_UUID },
        headers: {}
    };
    const res = {
        status(code) { resStatus = code; return this; },
        json(data) { resData = data; return this; }
    };

    // Crear mock pool temporal para test unitario
    const origDb = require('../src/config/db');
    const origPoolQuery = origDb.pool.query;
    origDb.pool.query = async (sql, params) => {
        if (/SELECT[\s\S]*FROM nexus_tv\.tv_screens[\s\S]*WHERE tv_uuid = \$1/i.test(sql)) {
            const screen = screensDb.get(params[0]);
            return { rows: screen ? [screen] : [] };
        }
        return { rows: [] };
    };

    try {
        await loginHandler(req, res);
        assert.equal(resStatus, 401, 'Debe responder HTTP 401');
        assert.equal(resData.success, false);
        assert.match(resData.message, /Credencial de dispositivo requerida/i);
    } finally {
        origDb.pool.query = origPoolQuery;
    }
});

// ─────────────────────────────────────────────────────────────
// 20. HTTP POST /api/tv/login: Admite peticiones con token legítimo
// ─────────────────────────────────────────────────────────────
test('20. HTTP POST /api/tv/login: Admite peticiones con credencial de dispositivo válida', async () => {
    const tvRoutes = require('../src/routes/tv');
    const loginHandler = tvRoutes.stack.find((layer) => layer.route && layer.route.path === '/login').route.stack[0].handle;

    let resStatus = 200;
    let resData = null;
    const req = {
        body: { tv_uuid: TV_A_UUID, device_token: TOKEN_A },
        headers: {}
    };
    const res = {
        status(code) { resStatus = code; return this; },
        json(data) { resData = data; return this; }
    };

    const origDb = require('../src/config/db');
    const origPoolQuery = origDb.pool.query;
    origDb.pool.query = async (sql, params) => {
        if (/SELECT[\s\S]*FROM nexus_tv\.tv_screens[\s\S]*WHERE tv_uuid = \$1/i.test(sql)) {
            const screen = screensDb.get(params[0]);
            return { rows: screen ? [screen] : [] };
        }
        if (/UPDATE nexus_tv\.tv_screens SET last_login/i.test(sql)) {
            return { rowCount: 1 };
        }
        return { rows: [] };
    };

    try {
        await loginHandler(req, res);
        assert.equal(resStatus, 200);
        assert.equal(resData.success, true);
        assert.equal(resData.screen.tv_uuid, TV_A_UUID);
    } finally {
        origDb.pool.query = origPoolQuery;
    }
});

// ─────────────────────────────────────────────────────────────
// 21. Handshake vía cabecera HTTP x-device-token: aceptada
// ─────────────────────────────────────────────────────────────
test('21. Handshake vía cabecera HTTP x-device-token: aceptada', async () => {
    const { client, error } = await connectClient({
        auth: { tv_uuid: TV_A_UUID },
        extraHeaders: { 'x-device-token': TOKEN_A }
    });
    assert.equal(error, null, 'Credencial por cabecera x-device-token debe ser aceptada');
    assert.equal(socketHub.onlineScreens.has(TV_A_UUID), true);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 22. AUD-006: Credencial proporcionada exclusivamente en query string: rechazada por defecto
// ─────────────────────────────────────────────────────────────
test('22. AUD-006: Credencial en query string: rechazada por defecto (ALLOW_QUERY_DEVICE_TOKEN=false)', async () => {
    const { client, error } = await connectClient({
        query: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
    });
    assert.ok(error, 'Debe rechazar token de dispositivo en query string por defecto');
    assert.match(error.message, /device_token in query string is rejected/i);
    assert.equal(socketHub.onlineScreens.has(TV_A_UUID), false);
    await closeClient(client);
});

// ─────────────────────────────────────────────────────────────
// 23. AUD-006: Fallback de compatibilidad explícito (allowQueryDeviceToken = true): admitido con warning seguro
// ─────────────────────────────────────────────────────────────
test('23. AUD-006: Fallback de compatibilidad (allowQueryDeviceToken = true): admitido con advertencia sin fugar token', async () => {
    const tempServer = http.createServer();
    const tempIo = new Server(tempServer, { cors: { origin: '*' } });
    const tempHub = initSockets(tempIo, { pool: createMockPool(), allowQueryDeviceToken: true });

    await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
    const tempPort = tempServer.address().port;

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args.join(' '));
    };

    try {
        const client = ioc(`http://127.0.0.1:${tempPort}/control`, {
            transports: ['websocket'],
            reconnection: false,
            query: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
        });

        const connectResult = await new Promise((resolve) => {
            client.once('connect', () => resolve({ error: null }));
            client.once('connect_error', (err) => resolve({ error: err }));
        });

        assert.equal(connectResult.error, null, 'Debe permitir conexión por query string cuando la bandera está activa');
        assert.equal(tempHub.onlineScreens.has(TV_A_UUID), true);

        // Verificar advertencia de deprecación
        const deprecationWarn = warnings.find((w) => w.includes('Deprecation Warning AUD-006'));
        assert.ok(deprecationWarn, 'Debe emitir advertencia de obsolescencia');
        assert.match(deprecationWarn, new RegExp(TV_A_UUID));
        assert.equal(deprecationWarn.includes(TOKEN_A), false, 'La advertencia NUNCA debe contener el token en texto plano');

        client.disconnect();
    } finally {
        console.warn = origWarn;
        tempHub.pairingSessions.close();
        await new Promise((resolve) => tempIo.close(resolve));
        await new Promise((resolve) => tempServer.close(resolve));
    }
});

// ─────────────────────────────────────────────────────────────
// 24. AUD-006: Con fallback activo, tokens inválidos o cruzados en query string siguen siendo rechazados
// ─────────────────────────────────────────────────────────────
test('24. AUD-006: Con fallback activo, tokens inválidos o cruzados en query string siguen rechazados', async () => {
    const tempServer = http.createServer();
    const tempIo = new Server(tempServer, { cors: { origin: '*' } });
    const tempHub = initSockets(tempIo, { pool: createMockPool(), allowQueryDeviceToken: true });

    await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
    const tempPort = tempServer.address().port;

    try {
        // A. Token cruzado (Token de TV A con UUID de TV B)
        const crossClient = ioc(`http://127.0.0.1:${tempPort}/control`, {
            transports: ['websocket'],
            reconnection: false,
            query: { tv_uuid: TV_B_UUID, device_token: TOKEN_A }
        });
        const crossResult = await new Promise((resolve) => {
            crossClient.once('connect', () => resolve({ error: null }));
            crossClient.once('connect_error', (err) => resolve({ error: err }));
        });
        assert.ok(crossResult.error, 'Token cruzado en query string debe ser rechazado');
        assert.match(crossResult.error.message, /invalid device credentials/i);
        crossClient.disconnect();

        // B. Token malformado
        const malformedClient = ioc(`http://127.0.0.1:${tempPort}/control`, {
            transports: ['websocket'],
            reconnection: false,
            query: { tv_uuid: TV_A_UUID, device_token: 'not-a-valid-token' }
        });
        const malformedResult = await new Promise((resolve) => {
            malformedClient.once('connect', () => resolve({ error: null }));
            malformedClient.once('connect_error', (err) => resolve({ error: err }));
        });
        assert.ok(malformedResult.error, 'Token malformado en query string debe ser rechazado');
        assert.match(malformedResult.error.message, /malformed device_token/i);
        malformedClient.disconnect();
    } finally {
        tempHub.pairingSessions.close();
        await new Promise((resolve) => tempIo.close(resolve));
        await new Promise((resolve) => tempServer.close(resolve));
    }
});

// ─────────────────────────────────────────────────────────────
// 25. AUD-006: Verificación de que el servidor no incluye tokens en mensajes de error ni métricas
// ─────────────────────────────────────────────────────────────
test('25. AUD-006: Verificación de que los errores no exponen el valor del token', async () => {
    const errors = [];
    const testCases = [
        { auth: { tv_uuid: TV_A_UUID, device_token: 'invalid-token-1234' } },
        { auth: { tv_uuid: TV_B_UUID, device_token: TOKEN_A } },
        { query: { tv_uuid: TV_A_UUID, device_token: TOKEN_A } }
    ];

    for (const opts of testCases) {
        const { client, error } = await connectClient(opts);
        if (error) {
            errors.push(error.message);
            assert.equal(error.message.includes(TOKEN_A), false, 'El mensaje de error no debe contener TOKEN_A');
            assert.equal(error.message.includes('invalid-token-1234'), false, 'El mensaje de error no debe contener el token malformado');
        }
        await closeClient(client);
    }
    assert.equal(errors.length, 3, 'Todos los intentos no autorizados deben generar errores sin fugar secretos');
});

// ─────────────────────────────────────────────────────────────
// 26. AUD-006: La telemetría de retiro detecta el token en query aunque el cliente también use auth
// ─────────────────────────────────────────────────────────────
test('26. AUD-006: La telemetría de retiro detecta el token en query aunque el cliente también envíe auth', async () => {
    const tempServer = http.createServer();
    const tempIo = new Server(tempServer, { cors: { origin: '*' } });
    const tempHub = initSockets(tempIo, { pool: createMockPool(), allowQueryDeviceToken: true });

    await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
    const tempPort = tempServer.address().port;

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args.join(' '));
    };

    try {
        const client = ioc(`http://127.0.0.1:${tempPort}/control`, {
            transports: ['websocket'],
            reconnection: false,
            auth: { tv_uuid: TV_A_UUID, device_token: TOKEN_A },
            query: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
        });

        const connectResult = await new Promise((resolve) => {
            client.once('connect', () => resolve({ error: null }));
            client.once('connect_error', (err) => resolve({ error: err }));
        });

        assert.equal(connectResult.error, null, 'La credencial auth válida debe ser aceptada');
        const deprecationWarn = warnings.find((w) => w.includes('Deprecation Warning AUD-006'));
        assert.ok(deprecationWarn, 'Debe advertir sobre el uso de query string incluso cuando auth también viaja');
        assert.equal(deprecationWarn.includes(TOKEN_A), false, 'La advertencia NUNCA debe contener el token');

        client.disconnect();
    } finally {
        console.warn = origWarn;
        tempHub.pairingSessions.close();
        await new Promise((resolve) => tempIo.close(resolve));
        await new Promise((resolve) => tempServer.close(resolve));
    }
});

// ─────────────────────────────────────────────────────────────
// 27. AUD-006: La configuración explícita prevalece sobre el entorno
// ─────────────────────────────────────────────────────────────
test('27. AUD-006: allowQueryDeviceToken=false explícito prevalece aunque el entorno esté en true', async () => {
    const prevEnv = process.env.ALLOW_QUERY_DEVICE_TOKEN;
    process.env.ALLOW_QUERY_DEVICE_TOKEN = 'true';

    const tempServer = http.createServer();
    const tempIo = new Server(tempServer, { cors: { origin: '*' } });
    const tempHub = initSockets(tempIo, { pool: createMockPool(), allowQueryDeviceToken: false });

    await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
    const tempPort = tempServer.address().port;

    try {
        const client = ioc(`http://127.0.0.1:${tempPort}/control`, {
            transports: ['websocket'],
            reconnection: false,
            query: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
        });

        const connectResult = await new Promise((resolve) => {
            client.once('connect', () => resolve({ error: null }));
            client.once('connect_error', (err) => resolve({ error: err }));
        });

        assert.ok(connectResult.error, 'La opción explícita false debe rechazar el token en query');
        assert.match(connectResult.error.message, /device_token in query string is rejected/i);
        client.disconnect();
    } finally {
        if (prevEnv === undefined) delete process.env.ALLOW_QUERY_DEVICE_TOKEN;
        else process.env.ALLOW_QUERY_DEVICE_TOKEN = prevEnv;
        tempHub.pairingSessions.close();
        await new Promise((resolve) => tempIo.close(resolve));
        await new Promise((resolve) => tempServer.close(resolve));
    }
});

// ─────────────────────────────────────────────────────────────
// 28. AUD-006: Observación sin aceptación — detecta query token rechazado (fallback=false)
// ─────────────────────────────────────────────────────────────
test('28. AUD-006: observeQueryDeviceToken detecta intentos rechazados manteniendo el fallback deshabilitado', async () => {
    const tempServer = http.createServer();
    const tempIo = new Server(tempServer, { cors: { origin: '*' } });
    // Observación ACTIVADA, fallback SIGUE deshabilitado: no acepta la query.
    const tempHub = initSockets(tempIo, { pool: createMockPool(), observeQueryDeviceToken: true });

    await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
    const tempPort = tempServer.address().port;

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };

    try {
        const client = ioc(`http://127.0.0.1:${tempPort}/control`, {
            transports: ['websocket'],
            reconnection: false,
            query: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
        });

        const connectResult = await new Promise((resolve) => {
            client.once('connect', () => resolve({ error: null }));
            client.once('connect_error', (err) => resolve({ error: err }));
        });

        assert.ok(connectResult.error, 'El token en query debe seguir siendo rechazado');
        assert.match(connectResult.error.message, /device_token in query string is rejected/i);

        const obsWarn = warnings.find((w) => w.includes('Observación AUD-006'));
        assert.ok(obsWarn, 'Debe registrar observación del intento rechazado');
        assert.equal(obsWarn.includes(TOKEN_A), false, 'La observación no debe contener el token');
        assert.equal(tempHub.onlineScreens.has(TV_A_UUID), false, 'La pantalla no debe quedar registrada');

        client.disconnect();
    } finally {
        console.warn = origWarn;
        tempHub.pairingSessions.close();
        await new Promise((resolve) => tempIo.close(resolve));
        await new Promise((resolve) => tempServer.close(resolve));
    }
});

// ─────────────────────────────────────────────────────────────
// 29. AUD-006: Observación no activa el fallback por sí misma
// ─────────────────────────────────────────────────────────────
test('29. AUD-006: observeQueryDeviceToken=true NO habilita el fallback de query string', async () => {
    const prevEnv = process.env.ALLOW_QUERY_DEVICE_TOKEN;
    process.env.ALLOW_QUERY_DEVICE_TOKEN = 'false';

    const tempServer = http.createServer();
    const tempIo = new Server(tempServer, { cors: { origin: '*' } });
    // Sólo observación, sin allowQueryDeviceToken
    const tempHub = initSockets(tempIo, { pool: createMockPool(), observeQueryDeviceToken: true });

    await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
    const tempPort = tempServer.address().port;

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };

    try {
        const client = ioc(`http://127.0.0.1:${tempPort}/control`, {
            transports: ['websocket'],
            reconnection: false,
            query: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
        });

        const connectResult = await new Promise((resolve) => {
            client.once('connect', () => resolve({ error: null }));
            client.once('connect_error', (err) => resolve({ error: err }));
        });

        assert.ok(connectResult.error, 'La observación no debe aceptar credencial por query');
        assert.match(connectResult.error.message, /device_token in query string is rejected/i);
        assert.equal(tempHub.onlineScreens.has(TV_A_UUID), false);

        const deprecationWarn = warnings.find((w) => w.includes('Observación AUD-006'));
        assert.ok(deprecationWarn, 'Debe observar aunque no acepte');
        client.disconnect();
    } finally {
        if (prevEnv === undefined) delete process.env.ALLOW_QUERY_DEVICE_TOKEN;
        else process.env.ALLOW_QUERY_DEVICE_TOKEN = prevEnv;
        console.warn = origWarn;
        tempHub.pairingSessions.close();
        await new Promise((resolve) => tempIo.close(resolve));
        await new Promise((resolve) => tempServer.close(resolve));
    }
});

// ─────────────────────────────────────────────────────────────
// 30. AUD-006: Observación no registra tokens ni URIs completas
// ─────────────────────────────────────────────────────────────
test('30. AUD-006: las advertencias de observación no contienen tokens ni URLs', async () => {
    const tempServer = http.createServer();
    const tempIo = new Server(tempServer, { cors: { origin: '*' } });
    const tempHub = initSockets(tempIo, { pool: createMockPool(), observeQueryDeviceToken: true });

    await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
    const tempPort = tempServer.address().port;

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };

    try {
        const client = ioc(`http://127.0.0.1:${tempPort}/control`, {
            transports: ['websocket'],
            reconnection: false,
            query: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
        });

        await new Promise((resolve) => {
            client.once('connect', () => resolve());
            client.once('connect_error', () => resolve());
        });

        for (const w of warnings) {
            assert.equal(w.includes(TOKEN_A), false, 'Ninguna advertencia debe contener TOKEN_A');
            assert.equal(/http:\/\/127\.0\.0\.1/.test(w), false, 'Ninguna advertencia debe contener la URL del host');
        }
        client.disconnect();
    } finally {
        console.warn = origWarn;
        tempHub.pairingSessions.close();
        await new Promise((resolve) => tempIo.close(resolve));
        await new Promise((resolve) => tempServer.close(resolve));
    }
});

// ─────────────────────────────────────────────────────────────
// 31. AUD-006: Observación requiere tv_uuid válido — no se acepta UUID arbitrario
// ─────────────────────────────────────────────────────────────
test('31. AUD-006: la observación no registra ni considera auténtico un tv_uuid no validado', async () => {
    const tempServer = http.createServer();
    const tempIo = new Server(tempServer, { cors: { origin: '*' } });
    const tempHub = initSockets(tempIo, { pool: createMockPool(), observeQueryDeviceToken: true });

    await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
    const tempPort = tempServer.address().port;

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };

    try {
        const client = ioc(`http://127.0.0.1:${tempPort}/control`, {
            transports: ['websocket'],
            reconnection: false,
            query: { tv_uuid: 'not-a-uuid', device_token: 'bad' }
        });

        const connectResult = await new Promise((resolve) => {
            client.once('connect', () => resolve({ error: null }));
            client.once('connect_error', (err) => resolve({ error: err }));
        });

        assert.ok(connectResult.error, 'Debe rechazar tv_uuid malformado');
        assert.equal(warnings.some((w) => w.includes('Observación AUD-006')), false,
            'No debe observar cuando el tv_uuid no supera el filtro de formato');
        client.disconnect();
    } finally {
        console.warn = origWarn;
        tempHub.pairingSessions.close();
        await new Promise((resolve) => tempIo.close(resolve));
        await new Promise((resolve) => tempServer.close(resolve));
    }
});

// ─────────────────────────────────────────────────────────────
// 32. AUD-006: Integración env-driven — OBSERVE_QUERY_DEVICE_TOKEN registra sin aceptar
// ─────────────────────────────────────────────────────────────
test('32. AUD-006: la observación via entorno registra intentos rechazados (env-driven)', async () => {
    const prevAllow = process.env.ALLOW_QUERY_DEVICE_TOKEN;
    const prevObserve = process.env.OBSERVE_QUERY_DEVICE_TOKEN;
    process.env.ALLOW_QUERY_DEVICE_TOKEN = 'false';
    process.env.OBSERVE_QUERY_DEVICE_TOKEN = 'true';

    const tempServer = http.createServer();
    const tempIo = new Server(tempServer, { cors: { origin: '*' } });
    // initSockets lee ALLOW_QUERY_DEVICE_TOKEN directamente, igual que lo hace nx_tv.js
    const tempHub = initSockets(tempIo, { pool: createMockPool(), observeQueryDeviceToken: true });

    await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
    const tempPort = tempServer.address().port;

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };

    try {
        const client = ioc(`http://127.0.0.1:${tempPort}/control`, {
            transports: ['websocket'],
            reconnection: false,
            query: { tv_uuid: TV_A_UUID, device_token: TOKEN_A }
        });

        const connectResult = await new Promise((resolve) => {
            client.once('connect', () => resolve({ error: null }));
            client.once('connect_error', (err) => resolve({ error: err }));
        });

        assert.ok(connectResult.error, 'Debe rechazar el token en query con fallback=false');
        assert.match(connectResult.error.message, /device_token in query string is rejected/i);

        const obsWarn = warnings.find((w) => w.includes('Observación AUD-006'));
        assert.ok(obsWarn, 'Debe registrar la observación env-driven');
        assert.equal(obsWarn.includes(TOKEN_A), false);
        client.disconnect();
    } finally {
        if (prevAllow === undefined) delete process.env.ALLOW_QUERY_DEVICE_TOKEN;
        else process.env.ALLOW_QUERY_DEVICE_TOKEN = prevAllow;
        if (prevObserve === undefined) delete process.env.OBSERVE_QUERY_DEVICE_TOKEN;
        else process.env.OBSERVE_QUERY_DEVICE_TOKEN = prevObserve;
        console.warn = origWarn;
        tempHub.pairingSessions.close();
        await new Promise((resolve) => tempIo.close(resolve));
        await new Promise((resolve) => tempServer.close(resolve));
    }
});
