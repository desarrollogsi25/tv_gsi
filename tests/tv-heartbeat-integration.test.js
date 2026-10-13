const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { Pool } = require('pg');
const tvRoutes = require('../src/routes/tv');
const db = require('../src/config/db');
const { generateDeviceToken, hashDeviceToken } = require('../src/utils/deviceAuth');

const QA_PG_PORT = parseInt(process.env.QA_PG_PORT || '25499', 10);
const QA_PG_HOST = process.env.QA_PG_HOST || '127.0.0.1';
const QA_PG_USER = process.env.QA_PG_USER || 'nexus_app';
const QA_PG_PASSWORD = process.env.QA_PG_PASSWORD || 'nexus_app_runtime_pw_2026';
const QA_PG_DATABASE = process.env.QA_PG_DATABASE || 'nexus_tv';

function request(port, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: '/api/tv/heartbeat',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers }
        }, (res) => {
            let response = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { response += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(response) });
                } catch {
                    resolve({ status: res.statusCode, rawBody: response });
                }
            });
        });
        req.on('error', reject);
        req.end(payload);
    });
}

const { assertAuthorizedQaEnvironment } = require('./qa-guard');

test('POST /api/tv/heartbeat integration against isolated QA PostgreSQL', async (t) => {
    // 1. Strict QA environment & identity marker assertion before ANY connection/mutation
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
        connectionTimeoutMillis: 2000
    });

    const TV_1 = '11111111-1111-4111-8111-111111111111';
    const TV_2 = '22222222-2222-4222-8222-222222222222';
    const TV_INACTIVE = '33333333-3333-4333-8333-333333333333';
    const TV_NULL_HASH = '44444444-4444-4444-8444-444444444444';

    const token1 = generateDeviceToken();
    const token2 = generateDeviceToken();
    const tokenInactive = generateDeviceToken();

    // Clean up any leftovers and insert synthetic fixtures
    await qaPool.query('DELETE FROM nexus_tv.tv_screens WHERE tv_uuid IN ($1, $2, $3, $4)', [TV_1, TV_2, TV_INACTIVE, TV_NULL_HASH]);

    await qaPool.query(`
        INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active, device_token_hash, last_login)
        VALUES
            ($1, 'QA Screen 1', 'Lab A', true, $2, '2020-01-01 00:00:00'),
            ($3, 'QA Screen 2', 'Lab B', true, $4, '2020-01-01 00:00:00'),
            ($5, 'QA Inactive', 'Lab C', false, $6, '2020-01-01 00:00:00'),
            ($7, 'QA Null Hash', 'Lab D', true, NULL, '2020-01-01 00:00:00')
    `, [TV_1, hashDeviceToken(token1), TV_2, hashDeviceToken(token2), TV_INACTIVE, hashDeviceToken(tokenInactive), TV_NULL_HASH]);

    // Temporarily replace db.pool with qaPool for the route handler
    const originalPool = db.pool;
    db.pool = qaPool;

    const app = express();
    app.use(express.json());
    app.use('/api/tv', tvRoutes);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const getLastLogin = async (uuid) => {
        const res = await qaPool.query('SELECT last_login FROM nexus_tv.tv_screens WHERE tv_uuid = $1', [uuid]);
        return res.rows[0]?.last_login ? new Date(res.rows[0].last_login).toISOString() : null;
    };

    const BASELINE_DATE = new Date('2020-01-01 00:00:00').toISOString();

    try {
        await t.test('1. Pantalla inexistente: rechazada con 401 y sin cambios en base de datos', async () => {
            const res = await request(port, { tv_uuid: '00000000-0000-4000-8000-000000000000', device_token: token1 });
            assert.equal(res.status, 401);
            assert.equal(res.body.success, false);
            assert.equal(await getLastLogin(TV_1), BASELINE_DATE);
        });

        await t.test('2. Pantalla inactiva: rechazada con 401 y last_login inalterado en base de datos', async () => {
            const res = await request(port, { tv_uuid: TV_INACTIVE, device_token: tokenInactive });
            assert.equal(res.status, 401);
            assert.equal(res.body.success, false);
            assert.equal(await getLastLogin(TV_INACTIVE), BASELINE_DATE);
        });

        await t.test('3. Pantalla con device_token_hash nulo: rechazada con 401 tanto sin token como con token', async () => {
            const resNoToken = await request(port, { tv_uuid: TV_NULL_HASH });
            assert.equal(resNoToken.status, 401);
            assert.equal(resNoToken.body.success, false);
            assert.equal(await getLastLogin(TV_NULL_HASH), BASELINE_DATE);

            const resWithToken = await request(port, { tv_uuid: TV_NULL_HASH, device_token: token1 });
            assert.equal(resWithToken.status, 401);
            assert.equal(resWithToken.body.success, false);
            assert.equal(await getLastLogin(TV_NULL_HASH), BASELINE_DATE);
        });

        await t.test('4. Ausencia del token en pantalla activa: rechazada con 401 y last_login inalterado', async () => {
            const res = await request(port, { tv_uuid: TV_1 });
            assert.equal(res.status, 401);
            assert.equal(res.body.success, false);
            assert.equal(await getLastLogin(TV_1), BASELINE_DATE);
        });

        await t.test('5. Token incorrecto: rechazado con 401 y last_login inalterado', async () => {
            const res = await request(port, { tv_uuid: TV_1, device_token: generateDeviceToken() });
            assert.equal(res.status, 401);
            assert.equal(res.body.success, false);
            assert.equal(await getLastLogin(TV_1), BASELINE_DATE);
        });

        await t.test('6. Token perteneciente a otra pantalla: rechazado con 401 y ninguna pantalla actualizada', async () => {
            const res = await request(port, { tv_uuid: TV_1, device_token: token2 });
            assert.equal(res.status, 401);
            assert.equal(res.body.success, false);
            assert.equal(await getLastLogin(TV_1), BASELINE_DATE);
            assert.equal(await getLastLogin(TV_2), BASELINE_DATE);
        });

        await t.test('7. Token válido: actualiza exitosamente last_login en PostgreSQL real para su pantalla', async () => {
            const res = await request(port, { tv_uuid: TV_1, device_token: token1 });
            assert.equal(res.status, 200);
            assert.equal(res.body.success, true);
            assert.ok(res.body.timestamp);

            const dbCheck = await qaPool.query(`
                SELECT 
                    (last_login > '2020-01-01 00:00:00'::timestamp) AS was_updated,
                    (NOW() - last_login < interval '10 seconds') AS is_fresh
                FROM nexus_tv.tv_screens 
                WHERE tv_uuid = $1
            `, [TV_1]);

            assert.equal(dbCheck.rows[0].was_updated, true);
            assert.equal(dbCheck.rows[0].is_fresh, true);

            // Confirm screen 2 remains unchanged
            assert.equal(await getLastLogin(TV_2), BASELINE_DATE);
        });

        await t.test('8. Ausencia de tv_uuid: rechazada con 400 Bad Request', async () => {
            const res = await request(port, { device_token: token1 });
            assert.equal(res.status, 400);
            assert.equal(res.body.success, false);
        });

        await t.test('9. Error de base de datos: responde 500 genérico sin filtrar detalles internos', async () => {
            // Point db.pool to a dead mock pool
            db.pool = {
                query: async () => { throw new Error('connection closed violently'); }
            };

            const res = await request(port, { tv_uuid: TV_2, device_token: token2 });
            assert.equal(res.status, 500);
            assert.equal(res.body.success, false);
            assert.equal(res.body.message, 'No se pudo procesar el heartbeat.');
            assert.equal(JSON.stringify(res.body).includes('connection closed'), false);

            // Restore db.pool to qaPool
            db.pool = qaPool;
            assert.equal(await getLastLogin(TV_2), BASELINE_DATE);
        });

    } finally {
        // Cleanup synthetic rows and close connections
        try {
            await qaPool.query('DELETE FROM nexus_tv.tv_screens WHERE tv_uuid IN ($1, $2, $3, $4)', [TV_1, TV_2, TV_INACTIVE, TV_NULL_HASH]);
        } catch { /* best effort */ }
        db.pool = originalPool;
        await new Promise((resolve) => server.close(resolve));
        await qaPool.end();
    }
});
