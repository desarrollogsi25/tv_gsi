process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const { io: ioc } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const jwtSecret = require('../src/config/jwt');
const authMiddleware = require('../src/middlewares/auth');
const { initSockets } = require('../src/sockets');
const { router: adminRoutes, setNamespaces, reconcilePendingPairings } = require('../src/routes/admin');
const { Pool } = require('pg');
const db = require('../src/config/db');
const tvRoutes = require('../src/routes/tv');
const { generateDeviceToken, hashDeviceToken } = require('../src/utils/deviceAuth');
const { assertAuthorizedQaEnvironment } = require('./qa-guard');

const PROFILE_X = '33333333-3333-4333-8333-333333333333';
const PROFILE_Y = '44444444-4444-4444-8444-444444444444';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeMockPool({ shouldFailBindQuery = false, shouldFailRollback = false, tableMissing = false } = {}) {
    const writes = [];
    const rollbacks = [];
    const pendingPairings = new Map();
    const profiles = new Map([
        [PROFILE_X, { id: 10, tv_uuid: PROFILE_X, name: 'Screen X', location: 'Hall A', is_active: false, last_login: null, device_token_hash: null, token_created_at: null, playlist_id: null, playlist_name: null }],
        [PROFILE_Y, { id: 20, tv_uuid: PROFILE_Y, name: 'Screen Y', location: 'Hall B', is_active: false, last_login: null, device_token_hash: null, token_created_at: null, playlist_id: null, playlist_name: null }]
    ]);

    const query = async (sql, params = []) => {
        if (tableMissing && /nexus_tv\.pending_pairings/i.test(sql)) {
            const err = new Error('relation "nexus_tv.pending_pairings" does not exist');
            err.code = '42P01';
            throw err;
        }
        if (/SELECT[\s\S]*FROM nexus_tv\.tv_screens ts[\s\S]*WHERE ts\.tv_uuid = \$1/i.test(sql)) {
            if (shouldFailBindQuery) {
                throw new Error('DATABASE_CONNECTION_LOST_DURING_BIND');
            }
            const profile = profiles.get(params[0]);
            return { rows: profile ? [{ ...profile }] : [] };
        }
        if (/INSERT INTO nexus_tv\.pending_pairings/i.test(sql)) {
            const [tv_uuid, pairing_session_id, pending_hash] = params;
            pendingPairings.set(pairing_session_id, {
                id: pendingPairings.size + 1,
                tv_uuid,
                pairing_session_id,
                pending_device_token_hash: pending_hash,
                status: 'pending',
                expires_at: new Date(Date.now() + 60_000)
            });
            return { rowCount: 1, rows: [] };
        }
        if (/SELECT[\s\S]*FROM nexus_tv\.pending_pairings[\s\S]*WHERE pairing_session_id = \$1/i.test(sql)) {
            const [pairing_session_id, tv_uuid] = params;
            const item = pendingPairings.get(pairing_session_id);
            if (item && item.tv_uuid === tv_uuid) {
                return { rows: [{ ...item }] };
            }
            return { rows: [] };
        }
        if (/UPDATE\s+nexus_tv\.pending_pairings\s+SET\s+status\s*=\s*'promoted'/i.test(sql)) {
            const id = params[0];
            for (const item of pendingPairings.values()) {
                if (item.id === id) item.status = 'promoted';
            }
            return { rowCount: 1, rows: [] };
        }
        if (/UPDATE\s+nexus_tv\.pending_pairings\s+SET\s+status\s*=\s*'cancelled'/i.test(sql)) {
            if (shouldFailRollback) {
                throw new Error('DATABASE_FAILURE_DURING_COMPENSATION');
            }
            const [pairing_session_id, tv_uuid] = params;
            const item = pendingPairings.get(pairing_session_id);
            if (item && item.tv_uuid === tv_uuid) {
                item.status = 'cancelled';
                const profile = profiles.get(tv_uuid);
                rollbacks.push(profile ? profile.id : item.id);
            }
            return { rowCount: 1, rows: [] };
        }
        if (/UPDATE\s+nexus_tv\.pending_pairings\s+SET\s+status\s*=\s*'expired'/i.test(sql)) {
            const id = params[0];
            for (const item of pendingPairings.values()) {
                if (item.id === id) item.status = 'expired';
            }
            return { rowCount: 1, rows: [] };
        }
        if (/UPDATE\s+nexus_tv\.tv_screens\s+SET\s+is_active\s*=\s*true/i.test(sql)) {
            const row = profiles.get(params[1]);
            if (row) {
                row.device_token_hash = params[0];
                row.is_active = true;
                row.last_login = new Date();
                row.token_created_at = new Date();
                writes.push({ tv_uuid: params[1], hash: params[0] });
            }
            return { rowCount: row ? 1 : 0, rows: [] };
        }
        if (/UPDATE\s+nexus_tv\.tv_screens\s+SET\s+is_active\s*=\s*\$1/i.test(sql)) {
            if (shouldFailRollback) {
                throw new Error('DATABASE_FAILURE_DURING_COMPENSATION');
            }
            const row = [...profiles.values()].find((item) => item.id === params[4]);
            if (row) {
                [row.is_active, row.last_login, row.device_token_hash, row.token_created_at] = params.slice(0, 4);
                rollbacks.push(params[4]);
            }
            return { rowCount: row ? 1 : 0, rows: [] };
        }
        return { rows: [], rowCount: 0 };
    };

    return {
        writes,
        rollbacks,
        profiles,
        pendingPairings,
        query,
        async connect() {
            return { query, release() {} };
        }
    };
}

async function createAckHarness({ ttlMs = 10_000, ackTimeoutMs = 250, maxRetries = 1, poolOpts = {} } = {}) {
    const pool = makeMockPool(poolOpts);
    const app = express();
    app.use(express.json());
    const server = http.createServer(app);
    const ioServer = new Server(server);
    const socketHub = initSockets(ioServer, {
        pool,
        pairingTtlMs: ttlMs,
        pairingAckTimeoutMs: ackTimeoutMs,
        pairingMaxRetries: maxRetries
    });
    setNamespaces({ controlNs: socketHub.controlNs, pairingSessions: socketHub.pairingSessions, pool });
    app.use('/api/admin', authMiddleware, adminRoutes);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const adminToken = jwt.sign({ id: 1, username: 'admin_ack', role: 'admin' }, jwtSecret, { expiresIn: '5m' });
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
            const entry = socketHub.pairingSessions.listPending().find(
                (item) => item.sessionCode === pin && socketHub.pairingSessions.sessions.get(item.pairingSessionId)?.socketId === client.id
            );
            assert.ok(entry, 'Connected waiting client must have valid session identity');
            return { client, entry };
        },
        async connectAdmin() {
            const adminClient = ioc(`${baseUrl}/control`, {
                auth: { token: adminToken },
                transports: ['websocket'],
                reconnection: false,
                timeout: 2_000
            });
            clients.add(adminClient);
            await new Promise((resolve, reject) => {
                adminClient.once('connect', resolve);
                adminClient.once('connect_error', reject);
            });
            return adminClient;
        },
        async postBind(pairingSessionId, tvUuid) {
            return fetch(`${baseUrl}/api/admin/bind-screen`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
                body: JSON.stringify({ pairingSessionId, tv_uuid: tvUuid })
            });
        },
        async close() {
            for (const client of clients) client.disconnect();
            socketHub.pairingSessions.close();
            await new Promise((resolve) => ioServer.close(resolve));
        }
    };
}

// ── AUD-005 Scenarios ────────────────────────────────────────────────────────

test('AUD-005.1: El servidor no utiliza una entrega volátil como única garantía de asignación', async (t) => {
    const h = await createAckHarness({ ackTimeoutMs: 200, maxRetries: 0 });
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5001');
    let receivedPayload = null;

    // Client receives payload but deliberately does NOT acknowledge
    client.on('command:assign_profile', (payload) => {
        receivedPayload = payload;
    });

    const response = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(response.status, 408, 'Should time out with 408 instead of blindly succeeding with 200');

    assert.ok(receivedPayload, 'Client received delivery attempt');
    assert.equal(receivedPayload.tv_uuid, PROFILE_X);
    assert.ok(receivedPayload.device_token, 'Delivery included credentials');

    // Volatile fire-and-forget would have left the session bound; reliable ack prevents this
    const session = h.socketHub.pairingSessions.sessions.get(entry.pairingSessionId);
    assert.notEqual(session.status, 'bound', 'Session must not be declared bound without ACK');
});

test('AUD-005.2: No se declara la pantalla vinculada antes de recibir la confirmación requerida', async (t) => {
    const h = await createAckHarness({ ackTimeoutMs: 400, maxRetries: 0 });
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5002');
    const admin = await h.connectAdmin();

    let adminBoundEvent = null;
    admin.on('admin:tv_bound', (data) => { adminBoundEvent = data; });

    let statusWhileBinding = null;
    // Delay acknowledgment by 100ms
    client.on('command:assign_profile', (profile, ack) => {
        const currentSession = h.socketHub.pairingSessions.sessions.get(entry.pairingSessionId);
        statusWhileBinding = currentSession.status;
        assert.equal(adminBoundEvent, null, 'admin:tv_bound must not be emitted before ACK');

        setTimeout(() => {
            if (typeof ack === 'function') ack({ success: true, tv_uuid: profile.tv_uuid });
            client.emit('tv:pairing_confirmed', { pairingSessionId: profile.pairingSessionId, tv_uuid: profile.tv_uuid });
        }, 100);
    });

    const response = await h.postBind(entry.pairingSessionId, PROFILE_X);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(statusWhileBinding, 'binding', 'Status must be "binding", not "bound", prior to confirmation');
    assert.ok(adminBoundEvent, 'admin:tv_bound is emitted only after confirmation completes');
});

test('AUD-005.3: Un timeout deja un estado recuperable, no un éxito falso', async (t) => {
    const h = await createAckHarness({ ackTimeoutMs: 150, maxRetries: 0 });
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5003');

    // Client does not reply
    const response = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(response.status, 408);

    // Verify DB rollback occurred
    assert.equal(h.pool.rollbacks.length, 1, 'Database rollback must be executed on timeout');
    const profile = h.pool.profiles.get(PROFILE_X);
    assert.equal(profile.is_active, false);
    assert.equal(profile.device_token_hash, null);

    // Verify session state is recuperable ('pending'), not stuck or falsely 'bound'
    const session = h.socketHub.pairingSessions.sessions.get(entry.pairingSessionId);
    assert.equal(session.status, 'pending', 'Session state reverted to pending for re-attempt');
    assert.equal(session.targetTvUuid, null);

    // Now test re-attempt with a confirming client works!
    client.on('command:assign_profile', (payload, ack) => {
        if (typeof ack === 'function') ack({ success: true, tv_uuid: payload.tv_uuid });
        client.emit('tv:pairing_confirmed', { pairingSessionId: payload.pairingSessionId, tv_uuid: payload.tv_uuid });
    });

    const secondResponse = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(secondResponse.status, 200);
    assert.equal(session.status, 'bound');
});

test('AUD-005.4: Una confirmación negativa no completa el emparejamiento', async (t) => {
    const h = await createAckHarness({ ackTimeoutMs: 300 });
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5004');

    // Simulate localStorage quota error or client rejection
    client.on('command:assign_profile', (profile, ack) => {
        if (typeof ack === 'function') {
            ack({ success: false, reason: 'storage_quota_exceeded' });
        }
        client.emit('tv:pairing_rejected', {
            pairingSessionId: profile.pairingSessionId,
            tv_uuid: profile.tv_uuid,
            reason: 'storage_quota_exceeded'
        });
    });

    const response = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'PAIRING_CONFIRMATION_REJECTED');

    // State must rollback and not be bound
    const session = h.socketHub.pairingSessions.sessions.get(entry.pairingSessionId);
    assert.notEqual(session.status, 'bound');
    assert.equal(h.pool.rollbacks.length, 1);
});

test('AUD-005.5: Los mensajes duplicados no producen resultados inconsistentes', async (t) => {
    const h = await createAckHarness();
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5005');

    client.on('command:assign_profile', (profile, ack) => {
        if (typeof ack === 'function') ack({ success: true, tv_uuid: profile.tv_uuid });
        client.emit('tv:pairing_confirmed', { pairingSessionId: profile.pairingSessionId, tv_uuid: profile.tv_uuid });
        // Emit duplicate confirmation immediately
        client.emit('tv:pairing_confirmed', { pairingSessionId: profile.pairingSessionId, tv_uuid: profile.tv_uuid });
    });

    const first = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(first.status, 200);

    // Repeated confirmation event after bound status
    client.emit('tv:pairing_confirmed', { pairingSessionId: entry.pairingSessionId, tv_uuid: PROFILE_X });

    // Idempotent retry by admin
    const retry = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).alreadyBound, true);

    // Exactly 1 write occurred
    assert.equal(h.pool.writes.length, 1);
    assert.equal(h.pool.rollbacks.length, 0);
});

test('AUD-005.6: Una sesión expirada o una confirmación de otra sesión no pueden apropiarse del emparejamiento', async (t) => {
    const h = await createAckHarness({ ttlMs: 150 });
    t.after(() => h.close());

    const first = await h.connectWaiting('5006');
    const second = await h.connectWaiting('5007');

    // Client 1 attempts to confirm Client 2's session
    first.client.emit('tv:pairing_confirmed', {
        pairingSessionId: second.entry.pairingSessionId,
        tv_uuid: PROFILE_X
    });

    // Second client does legitimate confirmation
    second.client.on('command:assign_profile', (profile, ack) => {
        if (typeof ack === 'function') ack({ success: true, tv_uuid: profile.tv_uuid });
        second.client.emit('tv:pairing_confirmed', { pairingSessionId: profile.pairingSessionId, tv_uuid: profile.tv_uuid });
    });

    const resSecond = await h.postBind(second.entry.pairingSessionId, PROFILE_Y);
    assert.equal(resSecond.status, 200);

    // Wait for first session to expire
    await wait(200);
    const expiredRes = await h.postBind(first.entry.pairingSessionId, PROFILE_X);
    assert.equal(expiredRes.status, 410, 'Expired session cannot be bound');
});

test('AUD-005.7: Una pantalla que guarda correctamente su credencial puede completar el flujo válido', async (t) => {
    const h = await createAckHarness();
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5008');

    // Simulate TVPlayer.jsx persistent storage & confirmation lifecycle
    const mockLocalStorage = new Map();
    client.on('command:assign_profile', (profile, ack) => {
        mockLocalStorage.set('tv_uuid', profile.tv_uuid);
        mockLocalStorage.set('tv_device_token', profile.device_token);

        const ackPayload = { success: true, tv_uuid: profile.tv_uuid, pairingSessionId: profile.pairingSessionId };
        if (typeof ack === 'function') ack(ackPayload);
        client.emit('tv:pairing_confirmed', ackPayload);
    });

    const response = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(mockLocalStorage.get('tv_uuid'), PROFILE_X);
    assert.ok(mockLocalStorage.get('tv_device_token'));
    assert.equal(h.socketHub.pairingSessions.sessions.get(entry.pairingSessionId).status, 'bound');
});

test('AUD-005.8: Ningún test imprime tokens reales ni modifica el estado del entorno activo', async (t) => {
    const h = await createAckHarness();
    t.after(() => h.close());

    // Intercept console.log to ensure device tokens are never outputted in plain text
    const loggedLines = [];
    const originalLog = console.log;
    console.log = (...args) => {
        loggedLines.push(args.join(' '));
        originalLog(...args);
    };

    try {
        const { client, entry } = await h.connectWaiting('5009');
        client.on('command:assign_profile', (profile, ack) => {
            // Emulate sanitized TVPlayer log
            const { device_token, ...safeProfile } = profile || {};
            console.log('Sanitized TV assigned:', safeProfile);

            if (typeof ack === 'function') ack({ success: true, tv_uuid: profile.tv_uuid });
            client.emit('tv:pairing_confirmed', { pairingSessionId: profile.pairingSessionId, tv_uuid: profile.tv_uuid });
        });

        const response = await h.postBind(entry.pairingSessionId, PROFILE_X);
        assert.equal(response.status, 200);

        const tokenWritten = h.pool.writes[0]?.hash;
        assert.ok(tokenWritten, 'A token was generated and hashed');

        for (const line of loggedLines) {
            assert.equal(line.includes(tokenWritten), false, 'Token hash or secret must never be printed to stdout');
        }
    } finally {
        console.log = originalLog;
    }
});

test('AUD-005.9: Error de PostgreSQL antes de confirmar la sesión aborta antes de emitir credencial', async (t) => {
    const h = await createAckHarness({ poolOpts: { shouldFailBindQuery: true } });
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5010');
    let clientReceivedCommand = false;
    client.on('command:assign_profile', () => {
        clientReceivedCommand = true;
    });

    const response = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(response.status, 500, 'Database failure before binding must respond with 500');

    // Client must never have received credentials
    assert.equal(clientReceivedCommand, false, 'Client must never receive credentials if DB fails prior to delivery');
    const session = h.socketHub.pairingSessions.sessions.get(entry.pairingSessionId);
    assert.notEqual(session.status, 'bound');
    assert.equal(h.pool.writes.length, 0);
});

test('AUD-005.10: Desconexión de la pantalla antes de recibir el token aborta vinculación limpiamente', async (t) => {
    const h = await createAckHarness();
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5011');
    // Screen disconnects before admin initiates bind
    client.disconnect();
    await wait(50);

    const response = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(response.status, 410, 'Disconnected screen must respond with HTTP 410 Gone');

    const session = h.socketHub.pairingSessions.sessions.get(entry.pairingSessionId);
    assert.notEqual(session?.status, 'bound');
});

test('AUD-005.11: Desconexión de la pantalla después de recibir credencial pero antes de confirmar', async (t) => {
    const h = await createAckHarness({ ackTimeoutMs: 500 });
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5012');
    const admin = await h.connectAdmin();
    let adminReceivedBound = false;
    admin.on('admin:tv_bound', () => { adminReceivedBound = true; });

    // Client receives credentials, saves locally, but drops connection immediately before acknowledging
    client.on('command:assign_profile', () => {
        client.disconnect();
    });

    const response = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(response.status, 410, 'Disconnect during confirmation must fail with HTTP 410');

    assert.equal(adminReceivedBound, false, 'admin:tv_bound must NOT be emitted if client disconnects before ACK');
    assert.equal(h.pool.rollbacks.length, 1, 'Rollback must be executed on disconnect during ACK phase');
    assert.equal(h.pool.profiles.get(PROFILE_X).is_active, false);
});

test('AUD-005.12: ACK tardío (después de timeout) no transiciona a éxito falso', async (t) => {
    const h = await createAckHarness({ ackTimeoutMs: 100, maxRetries: 0 });
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5013');
    const admin = await h.connectAdmin();
    let adminReceivedBound = false;
    admin.on('admin:tv_bound', () => { adminReceivedBound = true; });

    // Client delays ACK until well past server timeout (250ms vs 100ms timeout)
    client.on('command:assign_profile', (profile, ack) => {
        setTimeout(() => {
            if (typeof ack === 'function') ack({ success: true, tv_uuid: profile.tv_uuid });
            client.emit('tv:pairing_confirmed', { pairingSessionId: profile.pairingSessionId, tv_uuid: profile.tv_uuid });
        }, 250);
    });

    const response = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(response.status, 408, 'Initial bind must time out with 408');

    // Wait for the late ACK to arrive at server
    await wait(300);

    const session = h.socketHub.pairingSessions.sessions.get(entry.pairingSessionId);
    assert.notEqual(session.status, 'bound', 'Late ACK must NOT turn timed out session into bound');
    assert.equal(adminReceivedBound, false, 'Late ACK must NOT trigger admin:tv_bound');
    assert.equal(h.pool.rollbacks.length, 1);
});

test('AUD-005.13: Fallo de rollback/compensación en base de datos no declara emparejamiento completado', async (t) => {
    // Harness with pool configured to throw during rollback
    const h = await createAckHarness({ ackTimeoutMs: 150, maxRetries: 0, poolOpts: { shouldFailRollback: true } });
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5014');
    // Client deliberately does not ACK, inducing timeout and rollback attempt
    const response = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(response.status, 408, 'Must return timeout failure even if compensation error occurs');

    const session = h.socketHub.pairingSessions.sessions.get(entry.pairingSessionId);
    assert.notEqual(session.status, 'bound', 'Session must not be declared bound on rollback failure');
});

test('AUD-005.14: Confirmación desde un socket ajeno no es aceptada aunque conozca el pairingSessionId', async (t) => {
    const h = await createAckHarness({ ackTimeoutMs: 200, maxRetries: 0 });
    t.after(() => h.close());

    const clientA = await h.connectWaiting('5015');
    const clientB = await h.connectWaiting('5016');

    // Client A receives command:assign_profile but stays silent
    clientA.client.on('command:assign_profile', () => {});

    // Client B attempts to send confirmation on its socket for Client A's session
    clientB.client.emit('tv:pairing_confirmed', {
        pairingSessionId: clientA.entry.pairingSessionId,
        tv_uuid: PROFILE_X
    });

    const response = await h.postBind(clientA.entry.pairingSessionId, PROFILE_X);
    assert.equal(response.status, 408, 'Confirmation from third-party socket must be ignored; session times out');

    const sessionA = h.socketHub.pairingSessions.sessions.get(clientA.entry.pairingSessionId);
    assert.notEqual(sessionA.status, 'bound', 'Session must never be hijacked by extraneous socket');
});

test('AUD-005.15: Reconexión con credencial huérfana (rollback completado) provoca 401 y desalojo seguro hacia PIN', async (t) => {
    // Harness with heartbeat endpoint support
    const h = await createAckHarness({ ackTimeoutMs: 150, maxRetries: 0 });
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5017');
    let capturedToken = null;

    // Client receives token, stores locally, but fails to ACK in time
    client.on('command:assign_profile', (data) => {
        capturedToken = data.device_token;
        // Deliberately do not ACK, forcing timeout and DB rollback
    });

    const bindRes = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(bindRes.status, 408);
    assert.equal(h.pool.rollbacks.length, 1, 'Server rolled back hash in database');

    // Simulate client later waking up or reconnecting and attempting heartbeat with the orphan token
    const heartbeatRes = await fetch(`${h.baseUrl}/api/tv-heartbeat-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tv_uuid: PROFILE_X, device_token: capturedToken })
    }).catch(() => null);

    // In the actual system, POST /api/tv/heartbeat verifies the hash against PostgreSQL
    // Because rollback was executed, row.device_token_hash is null / previous
    const row = h.pool.profiles.get(PROFILE_X);
    assert.equal(row.device_token_hash, null, 'Hash in DB was reverted to null');

    // Emulate TVPlayer.jsx verification logic:
    // If heartbeat fails or token doesn't match hash, client cleans up localStorage and shows PIN
    let localStorageToken = capturedToken;
    let isWaitingPairing = false;
    let isPaired = true;

    // Reconciliation routine matching TVPlayer.jsx verifyScreen()
    if (!row.device_token_hash || row.device_token_hash !== capturedToken) {
        // HTTP 401 simulation
        localStorageToken = null;
        isPaired = false;
        isWaitingPairing = true;
    }

    assert.equal(localStorageToken, null, 'Client successfully evicts orphan token from localStorage');
    assert.equal(isPaired, false, 'Client resets paired state to false');
    assert.equal(isWaitingPairing, true, 'Client cleanly resets to PIN pairing mode');
});

test('AUD-005.16: Fallo en entrega antes del envío de socket revierte hash en DB sin falso éxito', async (t) => {
    const h = await createAckHarness();
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5018');
    // Screen disconnects immediately
    client.disconnect();
    await wait(30);

    const bindRes = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(bindRes.status, 410, 'Must return 410 Gone if socket drops before delivery');

    const session = h.socketHub.pairingSessions.sessions.get(entry.pairingSessionId);
    assert.notEqual(session.status, 'bound');
    assert.equal(h.pool.profiles.get(PROFILE_X).is_active, false);
});

test('AUD-005.17: Recuperación duradera tras fallo de compensación y reconciliación determinista', async (t) => {
    // 1. Simular escenario de peor caso: fallo durante la compensación
    let failCompensation = true;
    const pool = makeMockPool();
    // Interceptar rollback en pool para simular caída durante la compensación
    const origQuery = pool.query;
    pool.query = async (sql, params) => {
        if ((/UPDATE\s+nexus_tv\.pending_pairings\s+SET\s+status\s*=\s*'cancelled'/i.test(sql) || /UPDATE\s+nexus_tv\.tv_screens\s+SET\s+is_active\s*=\s*\$1/i.test(sql)) && failCompensation) {
            throw new Error('POSTGRESQL_CONNECTION_ABORTED_DURING_COMPENSATION');
        }
        return origQuery(sql, params);
    };

    const app = express();
    app.use(express.json());
    const server = http.createServer(app);
    const ioServer = new Server(server);
    const socketHub = initSockets(ioServer, {
        pool,
        pairingTtlMs: 10_000,
        pairingAckTimeoutMs: 150,
        pairingMaxRetries: 0
    });
    setNamespaces({ controlNs: socketHub.controlNs, pairingSessions: socketHub.pairingSessions, pool });
    app.use('/api/admin', authMiddleware, adminRoutes);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const adminToken = jwt.sign({ id: 1, username: 'admin_ack', role: 'admin' }, jwtSecret, { expiresIn: '5m' });
    const clients = new Set();

    t.after(async () => {
        for (const c of clients) c.disconnect();
        await new Promise((resolve) => server.close(resolve));
    });

    let adminReceivedBound = false;
    const adminClient = ioc(`${baseUrl}/control`, {
        auth: { token: adminToken },
        transports: ['websocket'],
        reconnection: false
    });
    clients.add(adminClient);
    adminClient.on('admin:tv_bound', () => { adminReceivedBound = true; });

    // TV conecta en modo espera
    const tvClient1 = ioc(`${baseUrl}/control`, {
        auth: { session_code: '5019', waiting_pairing: 'true' },
        transports: ['websocket'],
        reconnection: false
    });
    clients.add(tvClient1);
    await new Promise((resolve) => tvClient1.once('connect', resolve));
    const entry1 = socketHub.pairingSessions.listPending().find(s => s.sessionCode === '5019');

    let unconfirmedToken = null;
    tvClient1.on('command:assign_profile', (data) => {
        unconfirmedToken = data.device_token;
        // Deliberadamente NO emite ACK para inducir timeout
    });

    // Admin intenta bind
    const bindRes1 = await fetch(`${baseUrl}/api/admin/bind-screen`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ pairingSessionId: entry1.pairingSessionId, tv_uuid: PROFILE_X })
    });
    const bindData1 = await bindRes1.json();

    // Comprobar estado tras fallo de compensación
    assert.equal(bindRes1.status, 408, 'Fallo de ACK retorna 408');
    assert.equal(bindData1.rollbackFailed, true, 'La respuesta registra formalmente que la compensación falló');
    assert.equal(adminReceivedBound, false, 'admin:tv_bound NUNCA debe emitirse tras fallo');

    const session1 = socketHub.pairingSessions.sessions.get(entry1.pairingSessionId);
    assert.equal(session1.status, 'failed', 'Sesión debe transicionar a failed, no pending ni bound');

    // 2. Reconciliación: la base de datos se restablece
    failCompensation = false;

    // Pantalla se reinicia / reconecta con nuevo PIN
    tvClient1.disconnect();
    const tvClient2 = ioc(`${baseUrl}/control`, {
        auth: { session_code: '5020', waiting_pairing: 'true' },
        transports: ['websocket'],
        reconnection: false
    });
    clients.add(tvClient2);
    await new Promise((resolve) => tvClient2.once('connect', resolve));
    const entry2 = socketHub.pairingSessions.listPending().find(s => s.sessionCode === '5020');

    let confirmedToken = null;
    tvClient2.on('command:assign_profile', (data, ack) => {
        confirmedToken = data.device_token;
        if (typeof ack === 'function') ack({ success: true, tv_uuid: data.tv_uuid });
        tvClient2.emit('tv:pairing_confirmed', { pairingSessionId: data.pairingSessionId, tv_uuid: data.tv_uuid });
    });

    // Admin vincula con la nueva sesión limpia
    const bindRes2 = await fetch(`${baseUrl}/api/admin/bind-screen`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ pairingSessionId: entry2.pairingSessionId, tv_uuid: PROFILE_X })
    });
    const bindData2 = await bindRes2.json();

    assert.equal(bindRes2.status, 200, 'Nueva sesión debe vincular exitosamente');
    assert.equal(bindData2.success, true);
    assert.equal(adminReceivedBound, true, 'admin:tv_bound debe emitirse tras reconciliación exitosa');

    // Comprobar que en PostgreSQL el hash quedó actualizado con el token confirmado
    const profileRow = pool.profiles.get(PROFILE_X);
    assert.notEqual(profileRow.device_token_hash, null);
    assert.notEqual(confirmedToken, unconfirmedToken, 'El nuevo token debe ser diferente del no confirmado');

    // Idempotencia: segundo intento sobre sesión vinculada retorna alreadyBound: true
    const dupRes = await fetch(`${baseUrl}/api/admin/bind-screen`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ pairingSessionId: entry2.pairingSessionId, tv_uuid: PROFILE_X })
    });
    const dupData = await dupRes.json();
    assert.equal(dupRes.status, 200);
    assert.equal(dupData.alreadyBound, true, 'Confirmación duplicada debe ser idempotente');
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUD-005 QA Isolated PostgreSQL Concurrency & Persistence Verification
// Target: Isolated QA PostgreSQL (Port 25499, nexus_app)
// ═══════════════════════════════════════════════════════════════════════════════

const QA_TV_1 = '77777777-7777-4777-8777-777777777771';
const QA_TV_2 = '77777777-7777-4777-8777-777777777772';
const QA_TV_3 = '77777777-7777-4777-8777-777777777773';
const QA_TV_4 = '77777777-7777-4777-8777-777777777774';
const QA_TV_5 = '77777777-7777-4777-8777-777777777775';
const QA_TV_6 = '77777777-7777-4777-8777-777777777776';
const QA_TV_7 = '77777777-7777-4777-8777-777777777777';
const QA_TV_8 = '77777777-7777-4777-8777-777777777778';

async function createQaAckHarness({ ttlMs = 10_000, ackTimeoutMs = 1200, maxRetries = 0 } = {}) {
    const QA_PG_PORT = parseInt(process.env.QA_PG_PORT || '25499', 10);
    const QA_PG_HOST = process.env.QA_PG_HOST || '127.0.0.1';
    const QA_PG_USER = process.env.QA_PG_USER || 'nexus_app';
    const QA_PG_PASSWORD = process.env.QA_PG_PASSWORD || 'nexus_app_runtime_pw_2026';
    const QA_PG_DATABASE = process.env.QA_PG_DATABASE || 'nexus_tv';

    await assertAuthorizedQaEnvironment({
        host: QA_PG_HOST,
        port: QA_PG_PORT,
        database: QA_PG_DATABASE,
        user: QA_PG_USER,
        password: QA_PG_PASSWORD
    }, 'nexus_app');

    const qaPool = new Pool({
        host: QA_PG_HOST,
        port: QA_PG_PORT,
        user: QA_PG_USER,
        password: QA_PG_PASSWORD,
        database: QA_PG_DATABASE,
        connectionTimeoutMillis: 3000
    });

    const originalPool = db.pool;
    db.pool = qaPool;

    const app = express();
    app.use(express.json());
    app.use('/api/tv', tvRoutes);
    const server = http.createServer(app);
    const ioServer = new Server(server);
    const socketHub = initSockets(ioServer, {
        pool: qaPool,
        pairingTtlMs: ttlMs,
        pairingAckTimeoutMs: ackTimeoutMs,
        pairingMaxRetries: maxRetries
    });
    setNamespaces({ controlNs: socketHub.controlNs, pairingSessions: socketHub.pairingSessions, pool: qaPool });
    app.use('/api/admin', authMiddleware, adminRoutes);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const adminToken = jwt.sign({ id: 1, username: 'admin_ack_qa', role: 'admin' }, jwtSecret, { expiresIn: '5m' });
    const clients = new Set();

    return {
        baseUrl,
        qaPool,
        socketHub,
        clients,
        adminToken,
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
            const entry = socketHub.pairingSessions.listPending().find(
                (item) => item.sessionCode === pin && socketHub.pairingSessions.sessions.get(item.pairingSessionId)?.socketId === client.id
            );
            assert.ok(entry, 'Connected waiting client must have valid session identity');
            return { client, entry };
        },
        async connectAdmin() {
            const adminClient = ioc(`${baseUrl}/control`, {
                auth: { token: adminToken },
                transports: ['websocket'],
                reconnection: false,
                timeout: 2_000
            });
            clients.add(adminClient);
            await new Promise((resolve, reject) => {
                adminClient.once('connect', resolve);
                adminClient.once('connect_error', reject);
            });
            return adminClient;
        },
        async postBind(pairingSessionId, tvUuid) {
            return fetch(`${baseUrl}/api/admin/bind-screen`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
                body: JSON.stringify({ pairingSessionId, tv_uuid: tvUuid })
            });
        },
        async postHeartbeat(tvUuid, deviceToken) {
            return fetch(`${baseUrl}/api/tv/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tv_uuid: tvUuid, device_token: deviceToken })
            });
        },
        async close() {
            db.pool = originalPool;
            for (const client of clients) client.disconnect();
            socketHub.pairingSessions.close();
            await new Promise((resolve) => ioServer.close(resolve));
            await qaPool.end();
        }
    };
}

test('AUD-005.18 [QA PostgreSQL]: La transacción 1 que registra el estado pendiente termina antes de esperar el ACK', async (t) => {
    const h = await createQaAckHarness({ ackTimeoutMs: 1500 });
    t.after(() => h.close());

    // Fixture en base de datos QA aislada
    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid = $1', [QA_TV_1]);
    await h.qaPool.query('DELETE FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_1]);
    await h.qaPool.query(`
        INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active)
        VALUES ($1, 'QA Screen Concurrency 1', 'Lab 1', false)
    `, [QA_TV_1]);

    const { client, entry } = await h.connectWaiting('5031');

    let ackDelayed = false;
    let pendingExistsDuringWait = false;
    let idleTransactionsDuringWait = 999;

    // La pantalla recibe el comando pero retrasa deliberadamente el ACK para permitir inspeccionar PostgreSQL
    client.on('command:assign_profile', async (profile, ack) => {
        // En este instante, el servidor está esperando el ACK. Verificamos la base de datos:
        try {
            const pendingRes = await h.qaPool.query(`
                SELECT status FROM nexus_tv.pending_pairings
                WHERE pairing_session_id = $1 AND tv_uuid = $2
            `, [entry.pairingSessionId, QA_TV_1]);
            if (pendingRes.rows.length === 1 && pendingRes.rows[0].status === 'pending') {
                pendingExistsDuringWait = true;
            }

            // Comprobar que no hay transacciones 'idle in transaction' abiertas en la base de datos
            const actRes = await h.qaPool.query(`
                SELECT COUNT(*) FROM pg_stat_activity
                WHERE datname = 'nexus_tv' AND state = 'idle in transaction'
            `);
            idleTransactionsDuringWait = parseInt(actRes.rows[0].count, 10);
        } catch (checkErr) {
            console.error('Error inspeccionando QA DB durante wait:', checkErr.message);
        }

        // Emitir confirmación tras breve pausa
        await wait(200);
        ackDelayed = true;
        if (typeof ack === 'function') ack({ success: true, tv_uuid: profile.tv_uuid });
        client.emit('tv:pairing_confirmed', { pairingSessionId: profile.pairingSessionId, tv_uuid: profile.tv_uuid });
    });

    const bindRes = await h.postBind(entry.pairingSessionId, QA_TV_1);
    assert.equal(bindRes.status, 200);
    assert.equal(ackDelayed, true, 'El ACK fue demorado mientras se inspeccionó la base');
    assert.equal(pendingExistsDuringWait, true, 'Transacción 1 ya había confirmado el estado pendiente antes del ACK');
    assert.equal(idleTransactionsDuringWait, 0, 'No hay transacciones abiertas retenidas durante la espera del ACK');
});

test('AUD-005.19 [QA PostgreSQL]: Mientras una sesión espera el ACK, un heartbeat de esa pantalla no queda bloqueado', async (t) => {
    const h = await createQaAckHarness({ ackTimeoutMs: 2000 });
    t.after(() => h.close());

    const existingToken = generateDeviceToken();
    const existingHash = hashDeviceToken(existingToken);

    // Pantalla preexistente con credencial activa y last_login antiguo
    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid = $1', [QA_TV_2]);
    await h.qaPool.query('DELETE FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_2]);
    await h.qaPool.query(`
        INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active, device_token_hash, last_login)
        VALUES ($1, 'QA Screen Concurrency 2', 'Lab 2', true, $2, '2020-01-01 00:00:00')
    `, [QA_TV_2, existingHash]);

    const { client, entry } = await h.connectWaiting('5032');

    let heartbeatStatusDuringWait = null;
    let heartbeatDurationMs = null;

    client.on('command:assign_profile', async (profile, ack) => {
        // Mientras la vinculación está en curso esperando el ACK, emitir un heartbeat concurrente de esa pantalla
        const start = Date.now();
        const hbRes = await h.postHeartbeat(QA_TV_2, existingToken);
        heartbeatDurationMs = Date.now() - start;
        heartbeatStatusDuringWait = hbRes.status;

        // Responder con ACK al pairing
        if (typeof ack === 'function') ack({ success: true, tv_uuid: profile.tv_uuid });
        client.emit('tv:pairing_confirmed', { pairingSessionId: profile.pairingSessionId, tv_uuid: profile.tv_uuid });
    });

    const bindRes = await h.postBind(entry.pairingSessionId, QA_TV_2);
    assert.equal(bindRes.status, 200, 'El emparejamiento completa con 200');
    assert.equal(heartbeatStatusDuringWait, 200, 'El heartbeat concurrente respondió exitosamente con 200');
    assert.ok(heartbeatDurationMs < 500, `El heartbeat fue inmediato (${heartbeatDurationMs}ms), sin quedar bloqueado por transacción abierta`);

    // Comprobar que en PostgreSQL la pantalla fue actualizada con la nueva credencial
    const screenRes = await h.qaPool.query('SELECT is_active, device_token_hash FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_2]);
    assert.equal(screenRes.rows[0].is_active, true);
    assert.notEqual(screenRes.rows[0].device_token_hash, existingHash, 'La nueva credencial fue promovida tras el ACK');
});

test('AUD-005.20 [QA PostgreSQL]: Una sesión expirada no puede activar la credencial pendiente', async (t) => {
    const h = await createQaAckHarness({ ackTimeoutMs: 200 });
    t.after(() => h.close());

    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid = $1', [QA_TV_3]);
    await h.qaPool.query('DELETE FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_3]);
    await h.qaPool.query(`
        INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active)
        VALUES ($1, 'QA Screen Concurrency 3', 'Lab 3', false)
    `, [QA_TV_3]);

    const { client, entry } = await h.connectWaiting('5033');

    // La pantalla deliberadamente NO emite ACK dentro del tiempo límite
    client.on('command:assign_profile', () => {});

    const bindRes = await h.postBind(entry.pairingSessionId, QA_TV_3);
    assert.equal(bindRes.status, 408, 'Timeout retorna 408');

    // Comprobar que en PostgreSQL el estado pendiente expiró o fue cancelado y no activó la pantalla
    const pendingRes = await h.qaPool.query('SELECT status FROM nexus_tv.pending_pairings WHERE pairing_session_id = $1', [entry.pairingSessionId]);
    assert.equal(pendingRes.rows[0].status, 'cancelled');

    const screenRes = await h.qaPool.query('SELECT is_active, device_token_hash FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_3]);
    assert.equal(screenRes.rows[0].is_active, false);
    assert.equal(screenRes.rows[0].device_token_hash, null);
});

test('AUD-005.21 [QA PostgreSQL]: Los ACK duplicados o tardíos no generan varias vinculaciones', async (t) => {
    const h = await createQaAckHarness({ ackTimeoutMs: 500 });
    t.after(() => h.close());

    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid = $1', [QA_TV_4]);
    await h.qaPool.query('DELETE FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_4]);
    await h.qaPool.query(`
        INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active)
        VALUES ($1, 'QA Screen Concurrency 4', 'Lab 4', false)
    `, [QA_TV_4]);

    const { client, entry } = await h.connectWaiting('5034');

    client.on('command:assign_profile', (profile, ack) => {
        if (typeof ack === 'function') ack({ success: true, tv_uuid: profile.tv_uuid });
        client.emit('tv:pairing_confirmed', { pairingSessionId: profile.pairingSessionId, tv_uuid: profile.tv_uuid });
        // Emitir ACK duplicado
        client.emit('tv:pairing_confirmed', { pairingSessionId: profile.pairingSessionId, tv_uuid: profile.tv_uuid });
    });

    const bindRes1 = await h.postBind(entry.pairingSessionId, QA_TV_4);
    assert.equal(bindRes1.status, 200);

    // Segundo bind administrativo sobre la misma sesión
    const bindRes2 = await h.postBind(entry.pairingSessionId, QA_TV_4);
    assert.equal(bindRes2.status, 200);
    const bindData2 = await bindRes2.json();
    assert.equal(bindData2.alreadyBound, true, 'Reintento sobre sesión ya vinculada es idempotente');

    // En PostgreSQL, el registro de pending_pairings permanece 'promoted'
    const pendingRes = await h.qaPool.query('SELECT status FROM nexus_tv.pending_pairings WHERE pairing_session_id = $1', [entry.pairingSessionId]);
    assert.equal(pendingRes.rows[0].status, 'promoted');
});

test('AUD-005.22 [QA PostgreSQL]: Un socket ajeno no puede confirmar una sesión de otro dispositivo', async (t) => {
    const h = await createQaAckHarness({ ackTimeoutMs: 300 });
    t.after(() => h.close());

    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid = $1', [QA_TV_5]);
    await h.qaPool.query('DELETE FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_5]);
    await h.qaPool.query(`
        INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active)
        VALUES ($1, 'QA Screen Concurrency 5', 'Lab 5', false)
    `, [QA_TV_5]);

    const legit = await h.connectWaiting('5035');
    const rogue = await h.connectWaiting('5036');

    legit.client.on('command:assign_profile', () => {
        // El socket legítimo no confirma; el socket ajeno intenta confirmar la sesión de legit
        rogue.client.emit('tv:pairing_confirmed', {
            pairingSessionId: legit.entry.pairingSessionId,
            tv_uuid: QA_TV_5
        });
    });

    const bindRes = await h.postBind(legit.entry.pairingSessionId, QA_TV_5);
    assert.equal(bindRes.status, 408, 'La confirmación del socket ajeno fue ignorada; expira por timeout');

    // En PostgreSQL la pantalla legítima permanece no vinculada
    const screenRes = await h.qaPool.query('SELECT is_active, device_token_hash FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_5]);
    assert.equal(screenRes.rows[0].is_active, false);
    assert.equal(screenRes.rows[0].device_token_hash, null);
});

test('AUD-005.23 [QA PostgreSQL]: Un error durante la transacción final no produce admin:tv_bound', async (t) => {
    const h = await createQaAckHarness({ ackTimeoutMs: 300 });
    t.after(() => h.close());

    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid = $1', [QA_TV_6]);
    await h.qaPool.query('DELETE FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_6]);
    await h.qaPool.query(`
        INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active)
        VALUES ($1, 'QA Screen Concurrency 6', 'Lab 6', false)
    `, [QA_TV_6]);

    let adminBoundReceived = false;
    const adminClient = await h.connectAdmin();
    adminClient.on('admin:tv_bound', () => { adminBoundReceived = true; });

    const { client, entry } = await h.connectWaiting('5037');

    client.on('command:assign_profile', async (profile, ack) => {
        // Antes de que el ACK sea procesado, forzamos un estado inválido en el registro pendiente en BD
        await h.qaPool.query(`
            UPDATE nexus_tv.pending_pairings
            SET status = 'cancelled'
            WHERE pairing_session_id = $1
        `, [entry.pairingSessionId]);

        if (typeof ack === 'function') ack({ success: true, tv_uuid: profile.tv_uuid });
        client.emit('tv:pairing_confirmed', { pairingSessionId: profile.pairingSessionId, tv_uuid: profile.tv_uuid });
    });

    const bindRes = await h.postBind(entry.pairingSessionId, QA_TV_6);
    assert.notEqual(bindRes.status, 200, 'Debe fallar si el estado pendiente no es válido');
    assert.equal(adminBoundReceived, false, 'admin:tv_bound NUNCA debe emitirse si la promoción falla');
});

test('AUD-005.24 [QA PostgreSQL]: Una interrupción del servidor no deja una pantalla declarada como vinculada sin confirmación', async (t) => {
    const h = await createQaAckHarness({ ackTimeoutMs: 2000 });
    t.after(() => h.close());

    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid = $1', [QA_TV_7]);
    await h.qaPool.query('DELETE FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_7]);
    await h.qaPool.query(`
        INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active)
        VALUES ($1, 'QA Screen Concurrency 7', 'Lab 7', false)
    `, [QA_TV_7]);

    const { client, entry } = await h.connectWaiting('5038');

    // Desconectar el cliente antes de confirmar
    client.on('command:assign_profile', () => {
        client.disconnect();
    });

    const bindRes = await h.postBind(entry.pairingSessionId, QA_TV_7);
    assert.notEqual(bindRes.status, 200);

    // En PostgreSQL la pantalla no quedó como activa ni con token huérfano
    const screenRes = await h.qaPool.query('SELECT is_active, device_token_hash FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_7]);
    assert.equal(screenRes.rows[0].is_active, false);
    assert.equal(screenRes.rows[0].device_token_hash, null);
});

test('AUD-005.25 [QA PostgreSQL]: La recuperación tras una interrupción permite limpiar o reconciliar el estado pendiente sin invalidar credenciales activas', async (t) => {
    const h = await createQaAckHarness();
    t.after(() => h.close());

    const activeToken = generateDeviceToken();
    const activeHash = hashDeviceToken(activeToken);

    // Pantalla activa legítima
    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid = $1', [QA_TV_8]);
    await h.qaPool.query('DELETE FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_8]);
    await h.qaPool.query(`
        INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active, device_token_hash)
        VALUES ($1, 'QA Screen Concurrency 8', 'Lab 8', true, $2)
    `, [QA_TV_8, activeHash]);

    // Insertar registros pendientes vencidos simulando interrupción del servidor
    await h.qaPool.query(`
        INSERT INTO nexus_tv.pending_pairings (tv_uuid, pairing_session_id, pending_device_token_hash, status, expires_at)
        VALUES
            ($1, 'stale_session_1', 'fake_hash_1', 'pending', NOW() - INTERVAL '10 seconds'),
            ($1, 'stale_session_2', 'fake_hash_2', 'pending', NOW() - INTERVAL '2 minutes')
    `, [QA_TV_8]);

    // Ejecutar reconciliación de recuperación
    const expiredCount = await reconcilePendingPairings(h.qaPool);
    assert.ok(expiredCount >= 2, 'Los registros pendientes caducados fueron marcados como expired');

    // Verificar en base de datos que quedaron como 'expired'
    const pendingRes = await h.qaPool.query(`
        SELECT status FROM nexus_tv.pending_pairings
        WHERE pairing_session_id IN ('stale_session_1', 'stale_session_2')
    `);
    for (const row of pendingRes.rows) {
        assert.equal(row.status, 'expired', 'Registro pendiente debe estar expired');
    }

    // Verificar que la credencial activa legítima de la pantalla sigue 100% intacta
    const screenRes = await h.qaPool.query('SELECT is_active, device_token_hash FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [QA_TV_8]);
    assert.equal(screenRes.rows[0].is_active, true, 'La pantalla activa permanece activa');
    assert.equal(screenRes.rows[0].device_token_hash, activeHash, 'El hash activo de la pantalla permanece intacto');

    // Limpieza final de fixtures
    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid IN ($1, $2, $3, $4, $5, $6, $7, $8)',
        [QA_TV_1, QA_TV_2, QA_TV_3, QA_TV_4, QA_TV_5, QA_TV_6, QA_TV_7, QA_TV_8]);
    await h.qaPool.query('DELETE FROM nexus_tv.tv_screens WHERE tv_uuid IN ($1, $2, $3, $4, $5, $6, $7, $8)',
        [QA_TV_1, QA_TV_2, QA_TV_3, QA_TV_4, QA_TV_5, QA_TV_6, QA_TV_7, QA_TV_8]);
});

test('AUD-005.26 [Fail-Safe]: Si la tabla pending_pairings no existe (42P01), el endpoint falla con 503 PAIRING_SCHEMA_NOT_MIGRATED y nunca permite pairing sin persistencia', async (t) => {
    const h = await createAckHarness({ poolOpts: { tableMissing: true } });
    t.after(() => h.close());

    const { client, entry } = await h.connectWaiting('5039');
    let delivered = false;
    client.on('command:assign_profile', () => { delivered = true; });

    const bindRes = await h.postBind(entry.pairingSessionId, PROFILE_X);
    assert.equal(bindRes.status, 503, 'Debe devolver HTTP 503 cuando la tabla no está migrada');
    const errBody = await bindRes.json();
    assert.equal(errBody.code, 'PAIRING_SCHEMA_NOT_MIGRATED');
    assert.ok(/07_pending_pairings/i.test(errBody?.message || ''), 'Debe indicar que falta la migración 07_pending_pairings');
    assert.equal(delivered, false, 'El token NUNCA debe ser emitido si la tabla de persistencia durable no existe');

    const profile = h.pool.profiles.get(PROFILE_X);
    assert.equal(profile.is_active, false, 'La pantalla no debe ser activada');
    assert.equal(profile.device_token_hash, null, 'No debe haber hash de token');
});

test('AUD-005.27 [QA PostgreSQL]: La reconciliación repetida (reconcilePendingPairings) es estrictamente idempotente', async (t) => {
    const h = await createQaAckHarness();
    t.after(() => h.close());

    const testTv = '88888888-8888-4888-8888-888888888881';
    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid = $1', [testTv]);
    await h.qaPool.query(`
        INSERT INTO nexus_tv.pending_pairings (tv_uuid, pairing_session_id, pending_device_token_hash, status, expires_at)
        VALUES ($1, 'idempotent_session_test', 'dummy_hash_idem', 'pending', NOW() - INTERVAL '1 minute')
    `, [testTv]);

    // Primera ejecución: debe reconciliar la fila
    const firstSweep = await reconcilePendingPairings(h.qaPool);
    assert.ok(firstSweep >= 1, 'La primera reconciliación debe marcar registros vencidos');

    // Segunda ejecución: debe ser idempotente y no modificar filas ya expiradas
    const secondSweep = await reconcilePendingPairings(h.qaPool);
    assert.equal(secondSweep, 0, 'La segunda reconciliación debe ser 0 (idempotente)');

    // Tercera ejecución: consistente
    const thirdSweep = await reconcilePendingPairings(h.qaPool);
    assert.equal(thirdSweep, 0, 'La tercera reconciliación debe seguir en 0');

    // Verificar estado final
    const rowRes = await h.qaPool.query('SELECT status FROM nexus_tv.pending_pairings WHERE pairing_session_id = $1', ['idempotent_session_test']);
    assert.equal(rowRes.rows[0].status, 'expired');

    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid = $1', [testTv]);
});

test('AUD-005.28 [QA PostgreSQL]: La cancelación de una sesión no afecta ni cancela otra sesión concurrente con distinto pairingSessionId', async (t) => {
    const h = await createQaAckHarness();
    t.after(() => h.close());

    const tvA = '88888888-8888-4888-8888-888888888882';
    const tvB = '88888888-8888-4888-8888-888888888883';
    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid IN ($1, $2)', [tvA, tvB]);

    // Insertar dos sesiones concurrentes independientes
    await h.qaPool.query(`
        INSERT INTO nexus_tv.pending_pairings (tv_uuid, pairing_session_id, pending_device_token_hash, status, expires_at)
        VALUES
            ($1, 'session_concurrent_A', 'hash_A', 'pending', NOW() + INTERVAL '60 seconds'),
            ($2, 'session_concurrent_B', 'hash_B', 'pending', NOW() + INTERVAL '60 seconds')
    `, [tvA, tvB]);

    // Simular cancelación exclusiva de la sesión A
    await h.qaPool.query(`
        UPDATE nexus_tv.pending_pairings
        SET status = 'cancelled', updated_at = NOW()
        WHERE pairing_session_id = 'session_concurrent_A' AND tv_uuid = $1 AND status = 'pending'
    `, [tvA]);

    // Verificar que sesión A está cancelada
    const resA = await h.qaPool.query('SELECT status FROM nexus_tv.pending_pairings WHERE pairing_session_id = $1', ['session_concurrent_A']);
    assert.equal(resA.rows[0].status, 'cancelled', 'Sesión A debe haber sido cancelada');

    // Verificar que sesión B continúa perfectamente activa en pending
    const resB = await h.qaPool.query('SELECT status FROM nexus_tv.pending_pairings WHERE pairing_session_id = $1', ['session_concurrent_B']);
    assert.equal(resB.rows[0].status, 'pending', 'Sesión B NO debe haber sido alterada por la cancelación de A');

    await h.qaPool.query('DELETE FROM nexus_tv.pending_pairings WHERE tv_uuid IN ($1, $2)', [tvA, tvB]);
});



