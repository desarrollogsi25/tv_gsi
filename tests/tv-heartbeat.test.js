const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const db = require('../src/config/db');
const tvRoutes = require('../src/routes/tv');
const { generateDeviceToken, hashDeviceToken } = require('../src/utils/deviceAuth');

const TV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(response) }));
        });
        req.on('error', reject);
        req.end(payload);
    });
}

test('POST /api/tv/heartbeat authenticates each HTTP request before updating last_login', async (t) => {
    const tokenA = generateDeviceToken();
    const tokenB = generateDeviceToken();
    const screens = new Map([
        [TV_A, { device_token_hash: hashDeviceToken(tokenA), is_active: true, last_login: 'before-a' }],
        [TV_B, { device_token_hash: hashDeviceToken(tokenB), is_active: true, last_login: 'before-b' }]
    ]);
    let failureMode = null;
    const originalQuery = db.pool.query;

    db.pool.query = async (sql, params = []) => {
        if (failureMode === 'select' && /^\s*SELECT/i.test(sql)) throw new Error('synthetic database failure');
        if (failureMode === 'update' && /^\s*UPDATE/i.test(sql)) throw new Error('synthetic database failure');
        if (/^\s*SELECT device_token_hash, is_active FROM nexus_tv\.tv_screens WHERE tv_uuid = \$1/i.test(sql)) {
            const screen = screens.get(params[0]);
            return { rows: screen ? [{ device_token_hash: screen.device_token_hash, is_active: screen.is_active }] : [] };
        }
        if (/^\s*UPDATE nexus_tv\.tv_screens/i.test(sql)) {
            const [uuid, expectedHash] = params;
            const screen = screens.get(uuid);
            if (!screen || !screen.is_active || screen.device_token_hash !== expectedHash) return { rowCount: 0 };
            screen.last_login = 'updated';
            return { rowCount: 1 };
        }
        throw new Error('Unexpected query in heartbeat test');
    };

    const app = express();
    app.use(express.json());
    app.use('/api/tv', tvRoutes);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const unchanged = (uuid, expected) => assert.equal(screens.get(uuid)?.last_login, expected);
    try {
        await t.test('unknown screen is rejected without changing activity', async () => {
            const response = await request(port, { tv_uuid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', device_token: tokenA });
            assert.equal(response.status, 401);
            unchanged(TV_A, 'before-a');
        });

        await t.test('inactive screen is rejected without changing activity', async () => {
            screens.get(TV_A).is_active = false;
            const response = await request(port, { tv_uuid: TV_A, device_token: tokenA });
            screens.get(TV_A).is_active = true;
            assert.equal(response.status, 401);
            unchanged(TV_A, 'before-a');
        });

        await t.test('NULL device hash rejects UUID-only and credential attempts', async () => {
            const screen = screens.get(TV_A);
            const hash = screen.device_token_hash;
            screen.device_token_hash = null;
            const anonymous = await request(port, { tv_uuid: TV_A });
            const supplied = await request(port, { tv_uuid: TV_A, device_token: tokenA });
            screen.device_token_hash = hash;
            assert.equal(anonymous.status, 401);
            assert.equal(supplied.status, 401);
            unchanged(TV_A, 'before-a');
        });

        await t.test('missing credential is rejected without changing activity', async () => {
            const response = await request(port, { tv_uuid: TV_A });
            assert.equal(response.status, 401);
            unchanged(TV_A, 'before-a');
        });

        await t.test('invalid credential is rejected without changing activity', async () => {
            const response = await request(port, { tv_uuid: TV_A, device_token: generateDeviceToken() });
            assert.equal(response.status, 401);
            unchanged(TV_A, 'before-a');
        });

        await t.test('credential for another screen is rejected without changing activity', async () => {
            const response = await request(port, { tv_uuid: TV_A, device_token: tokenB });
            assert.equal(response.status, 401);
            unchanged(TV_A, 'before-a');
            unchanged(TV_B, 'before-b');
        });

        await t.test('valid credential updates only its matching screen', async () => {
            const response = await request(port, { tv_uuid: TV_A, device_token: tokenA });
            assert.equal(response.status, 200);
            assert.equal(response.body.success, true);
            assert.equal(screens.get(TV_A).last_login, 'updated');
            unchanged(TV_B, 'before-b');
        });

        await t.test('database read failure returns generic 500 and does not update activity', async () => {
            failureMode = 'select';
            const response = await request(port, { tv_uuid: TV_B, device_token: tokenB });
            failureMode = null;
            assert.equal(response.status, 500);
            assert.equal(JSON.stringify(response.body).includes('synthetic'), false);
            unchanged(TV_B, 'before-b');
        });

        await t.test('database write failure returns generic 500', async () => {
            failureMode = 'update';
            const response = await request(port, { tv_uuid: TV_B, device_token: tokenB });
            failureMode = null;
            assert.equal(response.status, 500);
            assert.equal(JSON.stringify(response.body).includes('synthetic'), false);
            unchanged(TV_B, 'before-b');
        });

        await t.test('missing UUID is a client error', async () => {
            const response = await request(port, {});
            assert.equal(response.status, 400);
        });
    } finally {
        db.pool.query = originalQuery;
        await new Promise((resolve) => server.close(resolve));
    }
});
