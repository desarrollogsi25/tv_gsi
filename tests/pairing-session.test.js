require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const { io: ioc } = require('../frontend/node_modules/socket.io-client');
const jwt = require('jsonwebtoken');
const jwtSecret = require('../src/config/jwt');
const authMiddleware = require('../src/middlewares/auth');
const { initSockets } = require('../src/sockets');
const { router: adminRoutes, setNamespaces } = require('../src/routes/admin');

const PROFILE_A = '11111111-1111-4111-8111-111111111111';
const PROFILE_B = '22222222-2222-4222-8222-222222222222';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makePool({ updateDelayMs = 0 } = {}) {
    const writes = [];
    const profiles = new Map([
        [PROFILE_A, { id: 1, tv_uuid: PROFILE_A, name: 'Profile A', location: 'Test A', is_active: false, last_login: null, device_token_hash: null, token_created_at: null, playlist_id: null, playlist_name: null }],
        [PROFILE_B, { id: 2, tv_uuid: PROFILE_B, name: 'Profile B', location: 'Test B', is_active: false, last_login: null, device_token_hash: null, token_created_at: null, playlist_id: null, playlist_name: null }]
    ]);
    const query = async (sql, params = []) => {
        if (/SELECT[\s\S]*FROM nexus_tv\.tv_screens ts[\s\S]*WHERE ts\.tv_uuid = \$1/i.test(sql)) {
            const profile = profiles.get(params[0]);
            return { rows: profile ? [{ ...profile }] : [] };
        }
        if (/UPDATE nexus_tv\.tv_screens SET is_active = true/i.test(sql)) {
            await wait(updateDelayMs);
            const row = profiles.get(params[1]);
            if (row) {
                row.device_token_hash = params[0];
                row.is_active = true;
                row.last_login = new Date();
                row.token_created_at = new Date();
                writes.push(params[1]);
            }
            return { rowCount: row ? 1 : 0, rows: [] };
        }
        if (/UPDATE nexus_tv\.tv_screens SET is_active=\$1/i.test(sql)) {
            const row = [...profiles.values()].find((item) => item.id === params[4]);
            if (row) {
                [row.is_active, row.last_login, row.device_token_hash, row.token_created_at] = params.slice(0, 4);
            }
            return { rowCount: row ? 1 : 0, rows: [] };
        }
        return { rows: [], rowCount: 0 };
    };
    return {
        writes,
        profiles,
        query,
        async connect() {
            return { query, release() {} };
        }
    };
}

async function createHarness({ ttlMs = 5_000, updateDelayMs = 0 } = {}) {
    const pool = makePool({ updateDelayMs });
    const app = express();
    app.use(express.json());
    const server = http.createServer(app);
    const ioServer = new Server(server);
    const socketHub = initSockets(ioServer, { pool, pairingTtlMs: ttlMs });
    setNamespaces({ controlNs: socketHub.controlNs, pairingSessions: socketHub.pairingSessions, pool });
    app.use('/api/admin', authMiddleware, adminRoutes);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const adminToken = jwt.sign({ id: 2, username: 'admin_nexus', role: 'admin' }, jwtSecret, { expiresIn: '5m' });
    const clients = new Set();

    return {
        baseUrl,
        pool,
        socketHub,
        clients,
        async connectWaiting(pin) {
            const client = ioc(`${baseUrl}/control`, {
                auth: { session_code: pin, waiting_pairing: 'true' },
                transports: ['websocket'],
                reconnection: false,
                timeout: 2_000
            });
            clients.add(client);
            await new Promise((resolve, reject) => {
                client.once('connect', resolve);
                client.once('connect_error', reject);
            });
            const entry = socketHub.pairingSessions.listPending().find((item) => item.sessionCode === pin && socketHub.pairingSessions.sessions.get(item.pairingSessionId)?.socketId === client.id);
            assert.ok(entry, 'Connected waiting client should have a server-issued session identity');
            return { client, entry };
        },
        async post(path, body) {
            return fetch(`${baseUrl}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
                body: JSON.stringify(body)
            });
        },
        async close() {
            for (const client of clients) client.disconnect();
            socketHub.pairingSessions.close();
            await new Promise((resolve) => ioServer.close(resolve));
        }
    };
}

test('pairing PIN collision: exact session ID selects the requested socket', async (t) => {
    const h = await createHarness();
    t.after(() => h.close());
    const first = await h.connectWaiting('4444');
    const second = await h.connectWaiting('4444');
    assert.notEqual(first.entry.pairingSessionId, second.entry.pairingSessionId);
    let firstAssignments = 0;
    let secondAssignment;
    first.client.on('command:assign_profile', () => { firstAssignments += 1; });
    second.client.once('command:assign_profile', (profile) => { secondAssignment = profile; });

    const response = await h.post('/api/admin/bind-screen', { pairingSessionId: second.entry.pairingSessionId, tv_uuid: PROFILE_B });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    await wait(30);
    assert.equal(firstAssignments, 0);
    assert.equal(secondAssignment.tv_uuid, PROFILE_B);
    assert.equal(h.socketHub.pairingSessions.sessions.get(second.entry.pairingSessionId).status, 'bound');
    assert.equal(h.socketHub.pairingSessions.sessions.get(first.entry.pairingSessionId).status, 'pending');
});

test('pairing session is consumed once and same-target retries are idempotent', async (t) => {
    const h = await createHarness();
    t.after(() => h.close());
    const { client, entry } = await h.connectWaiting('4555');
    let assignments = 0;
    client.on('command:assign_profile', () => { assignments += 1; });

    const first = await h.post('/api/admin/bind-screen', { pairingSessionId: entry.pairingSessionId, tv_uuid: PROFILE_A });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    const retry = await h.post('/api/admin/bind-screen', { pairingSessionId: entry.pairingSessionId, tv_uuid: PROFILE_A });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).alreadyBound, true);
    const otherProfile = await h.post('/api/admin/bind-screen', { pairingSessionId: entry.pairingSessionId, tv_uuid: PROFILE_B });
    assert.equal(otherProfile.status, 409);
    const unknown = await h.post('/api/admin/bind-screen', { pairingSessionId: '00000000-0000-4000-8000-000000000000', tv_uuid: PROFILE_A });
    assert.equal(unknown.status, 404);
    await wait(30);

    assert.equal(firstBody.success, true);
    assert.equal(h.pool.writes.length, 1);
    assert.deepEqual(h.pool.writes, [PROFILE_A]);
    assert.equal(assignments, 1);
});

test('pairing expires after TTL, disconnects the waiting socket, and cannot bind', async (t) => {
    const h = await createHarness({ ttlMs: 100 });
    t.after(() => h.close());
    const { client, entry } = await h.connectWaiting('4666');
    const expiredEvent = new Promise((resolve) => client.once('pairing:expired', resolve));
    const disconnected = new Promise((resolve) => client.once('disconnect', resolve));

    const expiry = await expiredEvent;
    const reason = await disconnected;
    const expiredEntry = h.socketHub.pairingSessions.sessions.get(entry.pairingSessionId);
    assert.equal(expiry.pairingSessionId, entry.pairingSessionId);
    assert.equal(reason, 'io server disconnect');
    assert.equal(expiredEntry.status, 'expired');
    assert.equal(h.socketHub.pairingSessions.listPending().some((item) => item.pairingSessionId === entry.pairingSessionId), false);
    const response = await h.post('/api/admin/bind-screen', { pairingSessionId: entry.pairingSessionId, tv_uuid: PROFILE_A });
    assert.equal(response.status, 410);
    assert.equal(h.pool.writes.length, 0);
});

test('concurrent double-click requests produce one bind and return correct HTTP results', async (t) => {
    const h = await createHarness({ updateDelayMs: 80 });
    t.after(() => h.close());
    const { client, entry } = await h.connectWaiting('4777');
    let assignments = 0;
    client.on('command:assign_profile', () => { assignments += 1; });

    const [first, second] = await Promise.all([
        h.post('/api/admin/bind-screen', { pairingSessionId: entry.pairingSessionId, tv_uuid: PROFILE_A }),
        h.post('/api/admin/bind-screen', { pairingSessionId: entry.pairingSessionId, tv_uuid: PROFILE_A })
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 200]);
    const conflicting = await h.post('/api/admin/bind-screen', { pairingSessionId: entry.pairingSessionId, tv_uuid: PROFILE_B });
    assert.equal(conflicting.status, 409);
    await wait(30);
    assert.equal(h.pool.writes.length, 1);
    assert.equal(assignments, 1);
});

test('TVPlayer waiting-socket controller reconnects with a fresh PIN and server session after TTL', async (t) => {
    const { createWaitingPairingSocket } = await import('../frontend/src/utils/waitingPairingSocket.js');
    const h = await createHarness({ ttlMs: 150 });
    t.after(() => h.close());
    const storageValues = new Map([['tv_session_pin', '4888']]);
    const storage = { setItem: (key, value) => storageValues.set(key, value) };
    const connected = [];
    const pinChanges = [];
    let connection;

    connection = createWaitingPairingSocket({
        apiBase: h.baseUrl,
        sessionPin: '4888',
        storage,
        onSessionPinChange: (pin) => pinChanges.push(pin),
        onSocket: (socket) => {
            h.clients.add(socket);
            socket.on('connect', () => {
                const entry = h.socketHub.pairingSessions.listPending().find((item) => h.socketHub.pairingSessions.sessions.get(item.pairingSessionId)?.socketId === socket.id);
                if (entry) connected.push({ pin: entry.sessionCode, pairingSessionId: entry.pairingSessionId, socketId: socket.id });
            });
        }
    });

    const deadline = Date.now() + 3_000;
    while (connected.length < 2 && Date.now() < deadline) await wait(20);
    connection.disconnect();
    assert.ok(connected.length >= 2, `Expected a second waiting registration after TTL; observed ${connected.length}`);
    assert.notEqual(connected[1].pin, connected[0].pin);
    assert.notEqual(connected[1].pairingSessionId, connected[0].pairingSessionId);
    assert.equal(pinChanges[0], connected[1].pin);
    assert.equal(storageValues.get('tv_session_pin'), connected[1].pin);
    assert.equal(h.socketHub.pairingSessions.sessions.get(connected[0].pairingSessionId).status, 'expired');
    assert.equal(h.socketHub.pairingSessions.sessions.get(connected[1].pairingSessionId).status, 'pending');
});
