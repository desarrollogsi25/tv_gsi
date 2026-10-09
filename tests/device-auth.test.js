// ═══════════════════════════════════════════════════════════
// Suite de Pruebas de Seguridad: Autenticación de Dispositivos TV (RSK-025)
// Cubre los 18 escenarios de seguridad obligatorios de Socket.IO /control
// ═══════════════════════════════════════════════════════════

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');

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
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clientSockets.delete(client);
            resolve();
        };

        if (engine && engine.readyState !== 'closed') engine.once('close', finish);
        client.disconnect();
        if (engine && engine.readyState !== 'closed') engine.close();
        if (!engine || engine.readyState === 'closed') finish();
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
