const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const cors = require('cors');
const Module = require('node:module');
const { generateDeviceToken, hashDeviceToken } = require('../src/utils/deviceAuth');
const { createApiCorsOptions } = require('../src/config/cors');

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_INACTIVE = '33333333-3333-4333-8333-333333333333';
const tokenA = generateDeviceToken();
const tokenB = generateDeviceToken();
const playlist = [{ content_id: 91, title: 'Fixture content', source_url: '/media/fixture.mp4' }];

const screens = new Map([
    [UUID_A, { device_token_hash: hashDeviceToken(tokenA), is_active: true }],
    [UUID_B, { device_token_hash: hashDeviceToken(tokenB), is_active: true }],
    [UUID_INACTIVE, { device_token_hash: hashDeviceToken(generateDeviceToken()), is_active: false }]
]);

let playlistReads = 0;
let server;
let baseUrl;

const mockPool = {
    async query(sql, params) {
        if (/SELECT device_token_hash, is_active FROM nexus_tv\.tv_screens WHERE tv_uuid = \$1/i.test(sql)) {
            const screen = screens.get(params[0]);
            return { rows: screen ? [{ ...screen }] : [] };
        }
        if (/FROM nexus_tv\.tv_screens AS ts/i.test(sql)) {
            playlistReads += 1;
            return { rows: playlist };
        }
        throw new Error('Unexpected SQL in playlist authentication test.');
    }
};

test.before(async () => {
    const dbPath = require.resolve('../src/config/db');
    const dbStub = new Module(dbPath);
    dbStub.filename = dbPath;
    dbStub.loaded = true;
    dbStub.exports = { pool: mockPool };
    require.cache[dbPath] = dbStub;

    const tvRoutes = require('../src/routes/tv');
    const app = express();
    app.use(cors(createApiCorsOptions(['http://localhost:28080'])));
    app.use('/api/tv', tvRoutes);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
});

test('TC-PLAYLIST-01: missing X-Device-Token returns 401', async () => {
    const readsBefore = playlistReads;
    const response = await fetch(`${baseUrl}/api/tv/${UUID_A}/playlist`);
    assert.equal(response.status, 401);
    assert.equal(playlistReads, readsBefore);
});

test('TC-PLAYLIST-02: invalid X-Device-Token returns 401', async () => {
    const readsBefore = playlistReads;
    const response = await fetch(`${baseUrl}/api/tv/${UUID_A}/playlist`, {
        headers: { 'X-Device-Token': generateDeviceToken() }
    });
    assert.equal(response.status, 401);
    assert.equal(playlistReads, readsBefore);
});

test('TC-PLAYLIST-03: token from screen B cannot read screen A playlist', async () => {
    const readsBefore = playlistReads;
    const response = await fetch(`${baseUrl}/api/tv/${UUID_A}/playlist`, {
        headers: { 'X-Device-Token': tokenB }
    });
    assert.equal(response.status, 401);
    assert.equal(playlistReads, readsBefore);
});

test('TC-PLAYLIST-04: matching active screen UUID and token return playlist', async () => {
    const response = await fetch(`${baseUrl}/api/tv/${UUID_A}/playlist`, {
        headers: { 'X-Device-Token': tokenA }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.total, 1);
    assert.equal(body.playlist[0].content_id, playlist[0].content_id);
});

test('inactive screens are rejected with 401 before playlist query', async () => {
    const inactiveToken = generateDeviceToken();
    const readsBefore = playlistReads;
    const response = await fetch(`${baseUrl}/api/tv/${UUID_INACTIVE}/playlist`, {
        headers: { 'X-Device-Token': inactiveToken }
    });
    assert.equal(response.status, 401);
    assert.equal(playlistReads, readsBefore);
});

test('X-Device-Token is explicitly allowed in CORS preflight', async () => {
    const response = await fetch(`${baseUrl}/api/tv/${UUID_A}/playlist`, {
        method: 'OPTIONS',
        headers: {
            Origin: 'http://localhost:28080',
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'x-device-token'
        }
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-headers'), /x-device-token/i);
});
