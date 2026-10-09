/* End-to-end smoke test for a running local Nexus TV stack.
 * Required: E2E_ADMIN_PASSWORD. Optional: E2E_ADMIN_USERNAME, E2E_BASE_URL,
 * E2E_SCREEN_UUID. Uses Node's http module and the socket.io-client bundled with frontend.
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const path = require('node:path');
const { io } = require(path.join(__dirname, '..', 'frontend', 'node_modules', 'socket.io-client'));

const base = new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:28080');
const adminUser = process.env.E2E_ADMIN_USERNAME || 'admin_nexus';
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const screenUuid = process.env.E2E_SCREEN_UUID || 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
const timeoutMs = 8000;
if (!adminPassword) throw new Error('Set E2E_ADMIN_PASSWORD before running this audit.');

let token;
let adminSocket;
let tvSocket;
let waitingSocket;
let testScreenSocket;
let temporaryActive = false;
let testScreenUuid;
let testPlaylistId;
const uploadedContentIds = [];
let uploadedImageUrl;
const passed = [];

function request(method, pathname, { body, files, auth = true } = {}) {
    return new Promise((resolve, reject) => {
        const transport = base.protocol === 'https:' ? https : http;
        const headers = {};
        let payload;
        if (files) {
            const boundary = `----nexus-${crypto.randomBytes(12).toString('hex')}`;
            const parts = [];
            for (const [name, value] of Object.entries(files.fields || {})) {
                parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
            }
            for (const file of files.items) {
                parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="mediaFile"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
                parts.push(file.data);
                parts.push(Buffer.from('\r\n'));
            }
            parts.push(Buffer.from(`--${boundary}--\r\n`));
            payload = Buffer.concat(parts);
            headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
        } else if (body !== undefined) {
            payload = Buffer.from(JSON.stringify(body));
            headers['Content-Type'] = 'application/json';
        }
        if (auth && token) headers.Authorization = `Bearer ${token}`;
        if (payload) headers['Content-Length'] = payload.length;
        const req = transport.request({
            hostname: base.hostname,
            port: base.port || (base.protocol === 'https:' ? 443 : 80),
            method,
            path: `${base.pathname.replace(/\/$/, '')}${pathname}`,
            headers,
            timeout: 30000
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let data;
                try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
                resolve({ status: res.statusCode, data });
            });
        });
        req.setTimeout(180000, () => req.destroy(new Error(`${method} ${pathname} timed out`)));
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function waitFor(socket, event, predicate = () => true, ms = timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, onEvent);
            reject(new Error(`Timed out waiting for ${event}`));
        }, ms);
        const onEvent = (value) => {
            if (!predicate(value)) return;
            clearTimeout(timer);
            socket.off(event, onEvent);
            resolve(value);
        };
        socket.on(event, onEvent);
    });
}

function connectSocket(options) {
    return new Promise((resolve, reject) => {
        const socket = io(new URL('/control', base).toString(), { transports: ['websocket'], reconnection: false, ...options });
        const timer = setTimeout(() => {
            socket.disconnect();
            reject(new Error('Socket connection timed out'));
        }, timeoutMs);
        socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
        socket.once('connect_error', (error) => { clearTimeout(timer); socket.disconnect(); reject(error); });
    });
}

async function pass(name, fn) {
    await fn();
    passed.push(name);
    process.stdout.write(`PASS ${name}\n`);
}

function assertStatus(response, ...expected) {
    assert.ok(expected.includes(response.status), `Expected HTTP ${expected.join('/')} but received ${response.status}: ${response.data.message || ''}`);
}

async function sendRemoteCommand(command, payload = {}) {
    const event = waitFor(tvSocket, 'command:execute', (data) => data.command === command);
    const response = await request('POST', `/api/admin/screens/${screenUuid}/control`, { body: { command, payload } });
    assertStatus(response, 200);
    await event;
}

const uploadFiles = [
    { name: 'nexus-e2e.png', type: 'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F2sAAAAASUVORK5CYII=', 'base64') },
    { name: 'nexus-e2e.jpg', type: 'image/jpeg', data: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AV//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AV//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IT//2gAMAwEAAgADAAAAEAP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2gAMAwEAAgADAAAAEAf/2Q==', 'base64') },
    { name: 'nexus-e2e.mp4', type: 'video/mp4', data: Buffer.alloc(0) }
];

async function main() {
    await pass('Admin authentication and protected API', async () => {
        const login = await request('POST', '/api/auth/login', { auth: false, body: { username: adminUser, password: adminPassword } });
        assertStatus(login, 200);
        assert.equal(login.data.success, true);
        assert.ok(login.data.token);
        token = login.data.token;
        assertStatus(await request('GET', '/api/admin/screens', { auth: false }), 401);
        assertStatus(await request('GET', '/api/admin/screens'), 200);
    });

    const active = await request('GET', '/api/admin/active-temporary');
    assertStatus(active, 200);
    assert.equal(active.data.state?.global, null, 'Clear an existing global broadcast before running the live audit.');
    assert.equal(active.data.state?.byScreen?.[screenUuid], undefined, 'Clear an existing PT101 broadcast before running the live audit.');
    assert.equal(Object.keys(active.data.state?.byScreen || {}).length, 0, 'Clear existing targeted broadcasts before running the global test.');

    await pass('PT101 registration and protected admin Socket.IO connection', async () => {
        tvSocket = await connectSocket({ query: { tv_uuid: screenUuid } });
        const registered = waitFor(tvSocket, 'screen:registered', (value) => value.tv_uuid === screenUuid);
        tvSocket.emit('register_screen', { tv_uuid: screenUuid });
        await registered;
        adminSocket = await connectSocket({ auth: { token } });
        const rejectedSocket = io(new URL('/control', base).toString(), { transports: ['websocket'], reconnection: false });
        const denied = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Unauthenticated admin socket was not rejected')), timeoutMs);
            rejectedSocket.once('connect_error', () => { clearTimeout(timer); resolve(true); });
            rejectedSocket.once('connect', () => { clearTimeout(timer); rejectedSocket.disconnect(); reject(new Error('Unauthenticated admin socket connected')); });
        });
        assert.equal(denied, true);
    });

    await pass('Remote pause/resume/skip/reload/mute/unmute/chime/volume (8/8)', async () => {
        for (const [command, payload] of [
            ['pause', {}], ['resume', {}], ['skip', {}], ['reload', {}], ['mute', {}],
            ['unmute', {}], ['chime', {}], ['set_volume', { volume: 0.8 }]
        ]) await sendRemoteCommand(command, payload);
        await sendRemoteCommand('resume');
        await sendRemoteCommand('set_volume', { volume: 0.8 });
        for (const command of ['pause', 'resume']) {
            const event = waitFor(tvSocket, 'command:execute', (data) => data.command === command);
            const response = await request('POST', '/api/admin/screens/all/control', { body: { command } });
            assertStatus(response, 200);
            await event;
        }
    });

    await pass('Multipart uploads: PNG, JPG, MP4', async () => {
        for (const file of uploadFiles) {
            const uploaded = await request('POST', '/api/tv-content/upload', {
                files: { fields: { title: `NX-014 ${file.name}`, duration_seconds: '15' }, items: [file] }
            });
            assertStatus(uploaded, 200, 201);
            assert.equal(uploaded.data.success, true);
            uploadedContentIds.push(uploaded.data.content.id);
            if (file.name.endsWith('.png')) uploadedImageUrl = uploaded.data.content.source_url;
        }
        const largeUpload = await request('POST', '/api/tv-content/upload', {
            files: {
                fields: { title: 'NX-014 100MB proxy upload', duration_seconds: '30' },
                items: [{ name: 'nexus-e2e-100mb.mp4', type: 'video/mp4', data: Buffer.alloc(100 * 1024 * 1024) }]
            }
        });
        assertStatus(largeUpload, 200, 201);
        assert.equal(largeUpload.data.success, true);
        uploadedContentIds.push(largeUpload.data.content.id);
    });

    await pass('Global temporary broadcast and cleanup', async () => {
        const targetedStart = waitFor(tvSocket, 'command:temporary_content');
        const targeted = await request('POST', '/api/admin/temporary-content', {
            body: { target: screenUuid, content: { title: 'NX-014 targeted E2E', content_type: 'image', source_url: uploadedImageUrl, duration_seconds: 0, loop: true, muted: true } }
        });
        assertStatus(targeted, 200);
        temporaryActive = true;
        await targetedStart;
        const targetState = await request('GET', '/api/admin/active-temporary');
        assert.equal(targetState.data.state.byScreen[screenUuid].title, 'NX-014 targeted E2E');
        const targetedClear = waitFor(tvSocket, 'command:clear_temporary');
        assertStatus(await request('POST', '/api/admin/clear-temporary', { body: { target: screenUuid } }), 200);
        await targetedClear;
        temporaryActive = false;

        const startEvent = waitFor(tvSocket, 'command:temporary_content');
        const started = await request('POST', '/api/admin/temporary-content', {
            body: { target: 'all', content: { title: 'NX-014 E2E', content_type: 'image', source_url: uploadedImageUrl, duration_seconds: 0, loop: true, muted: true } }
        });
        assertStatus(started, 200);
        temporaryActive = true;
        await startEvent;
        const state = await request('GET', '/api/admin/active-temporary');
        assert.equal(state.data.state.global.title, 'NX-014 E2E');
        const clearEvent = waitFor(tvSocket, 'command:clear_temporary');
        assertStatus(await request('POST', '/api/admin/clear-temporary', { body: { target: 'all' } }), 200);
        await clearEvent;
        temporaryActive = false;
    });

    await pass('Playlist CRUD, schedule/days, and reordering', async () => {
        const created = await request('POST', '/api/admin/playlists', { body: { name: `NX-014 E2E ${Date.now()}` } });
        assertStatus(created, 201);
        testPlaylistId = created.data.playlist.id;
        const schedule = [['00:00', '10:00'], ['10:00', '23:59']];
        for (const [index, contentId] of uploadedContentIds.entries()) {
            const selectedSchedule = schedule[index % schedule.length];
            const result = await request('POST', `/api/admin/playlists/${testPlaylistId}/items`, {
                body: {
                    content_id: contentId,
                    start_time: index === uploadedContentIds.length - 1 ? null : selectedSchedule[0],
                    end_time: index === uploadedContentIds.length - 1 ? null : selectedSchedule[1],
                    days_of_week: ['lunes', 'miércoles', 'sábado']
                }
            });
            assertStatus(result, 200);
        }
        let detail = await request('GET', `/api/admin/playlists/${testPlaylistId}`);
        assertStatus(detail, 200);
        assert.equal(detail.data.items.length, uploadedContentIds.length);
        assert.deepEqual(detail.data.items[0].days_of_week, ['lunes', 'miércoles', 'sábado']);
        const reordered = [...detail.data.items].reverse().map((item) => ({ id: item.id }));
        assertStatus(await request('PUT', `/api/admin/playlists/${testPlaylistId}/items/order`, { body: { items: reordered } }), 200);
        const renamed = await request('PUT', `/api/admin/playlists/${testPlaylistId}`, { body: { name: `NX-014 renamed ${Date.now()}` } });
        assertStatus(renamed, 200);
        detail = await request('GET', `/api/admin/playlists/${testPlaylistId}`);
        assert.equal(detail.data.items[0].id, reordered[0].id);
        assert.equal(detail.data.items.find((item) => item.start_time === null && item.end_time === null) !== undefined, true);
        assertStatus(await request('DELETE', `/api/admin/playlists/${testPlaylistId}`), 200);
        testPlaylistId = null;
    });

    await pass('Pending pairing: list, approve/bind, and reject', async () => {
        const sessionCode = String(Math.floor(1000 + Math.random() * 9000));
        waitingSocket = await connectSocket({ query: { session_code: sessionCode, waiting_pairing: 'true' } });
        const waiting = await request('GET', '/api/admin/waiting-screens');
        assertStatus(waiting, 200);
        assert.ok(waiting.data.waiting.some((screen) => screen.sessionCode === sessionCode));

        testScreenUuid = crypto.randomUUID();
        const registeredScreen = await request('POST', '/api/tv/register', {
            auth: false,
            body: { tv_uuid: testScreenUuid, name: 'NX-014 disposable screen', location: 'E2E' }
        });
        assertStatus(registeredScreen, 201);
        const assigned = waitFor(waitingSocket, 'command:assign_profile');
        const bound = await request('POST', '/api/admin/bind-screen', { body: { sessionCode, tv_uuid: testScreenUuid } });
        assertStatus(bound, 200);
        assert.equal((await assigned).tv_uuid, testScreenUuid);
        assertStatus(await request('PUT', `/api/admin/screens/${testScreenUuid}`, {
            body: { name: 'NX-014 editable', location: 'QA', playlist_id: 5 }
        }), 200);
        const screen = await request('GET', `/api/admin/screens/${testScreenUuid}`);
        assert.equal(screen.data.screen.name, 'NX-014 editable');
        assert.equal(Number(screen.data.screen.playlist_id), 5);

        testScreenSocket = await connectSocket({ query: { tv_uuid: testScreenUuid } });
        const unlinkEvent = waitFor(testScreenSocket, 'command:execute', (data) => data.command === 'unlink');
        assertStatus(await request('POST', `/api/admin/screens/${testScreenUuid}/unlink`), 200);
        await unlinkEvent;
        const deleteEvent = waitFor(testScreenSocket, 'command:execute', (data) => data.command === 'unlink');
        assertStatus(await request('DELETE', `/api/admin/screens/${testScreenUuid}`), 200);
        await deleteEvent;
        testScreenUuid = null;

        const rejectCode = String((Number(sessionCode) + 1) % 10000).padStart(4, '0');
        const rejectSocket = await connectSocket({ query: { session_code: rejectCode, waiting_pairing: 'true' } });
        const rejected = waitFor(rejectSocket, 'command:rejected');
        assertStatus(await request('POST', `/api/admin/waiting-screens/${rejectCode}/reject`), 200);
        await rejected;
        rejectSocket.disconnect();
    });

    await pass('Screen inventory, details, and playlist assignment APIs', async () => {
        assertStatus(await request('GET', '/api/admin/screens'), 200);
        assertStatus(await request('GET', `/api/admin/screens/${screenUuid}`), 200);
        assertStatus(await request('GET', '/api/admin/playlists'), 200);
        const uploaded = await request('GET', '/api/tv-content');
        assertStatus(uploaded, 200);
    });

    process.stdout.write(`\n${passed.length} audit groups PASS.\n`);
}

main().catch((error) => {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
}).finally(async () => {
    if (temporaryActive && token) await request('POST', '/api/admin/clear-temporary', { body: { target: 'all' } }).catch(() => {});
    if (testPlaylistId && token) await request('DELETE', `/api/admin/playlists/${testPlaylistId}`).catch(() => {});
    if (testScreenUuid && token) await request('DELETE', `/api/admin/screens/${testScreenUuid}`).catch(() => {});
    for (const id of uploadedContentIds) {
        if (token) await request('POST', '/api/tv-content/delete', { body: { content_id: id } }).catch(() => {});
    }
    for (const socket of [adminSocket, tvSocket, waitingSocket, testScreenSocket]) socket?.disconnect();
});
