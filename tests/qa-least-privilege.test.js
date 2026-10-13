process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const { assertAuthorizedQaEnvironment } = require('./qa-guard');
const authRoutes = require('../src/routes/auth');
const db = require('../src/config/db');

const QA_PG_PORT = parseInt(process.env.QA_PG_PORT || '25499', 10);
const QA_PG_HOST = process.env.QA_PG_HOST || '127.0.0.1';
const QA_PG_USER = process.env.QA_PG_USER || 'nexus_app';
const QA_PG_PASSWORD = process.env.QA_PG_PASSWORD || 'nexus_app_runtime_pw_2026';
const QA_PG_DATABASE = process.env.QA_PG_DATABASE || 'nexus_tv';

const QA_ADMIN_USER = process.env.QA_ADMIN_USER || 'qa_admin';
const QA_ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD || 'qa_secure_password_2026';

function httpRequest(server, options, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            host: '127.0.0.1',
            port: server.address().port,
            headers: {
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...options.headers
            },
            ...options
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, rawBody: data });
                }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

test('PostgreSQL Least Privilege & Functional Validation on Isolated QA Database', async (t) => {
    // 1. Strict QA environment guard for runtime user nexus_app
    await assertAuthorizedQaEnvironment({
        host: QA_PG_HOST,
        port: QA_PG_PORT,
        database: QA_PG_DATABASE,
        user: QA_PG_USER,
        password: QA_PG_PASSWORD
    }, 'nexus_app');

    // 2. Strict QA environment guard for bootstrap admin role before fixture seeding
    await assertAuthorizedQaEnvironment({
        host: QA_PG_HOST,
        port: QA_PG_PORT,
        database: QA_PG_DATABASE,
        user: QA_ADMIN_USER,
        password: QA_ADMIN_PASSWORD
    }, 'qa_admin');

    // 3. Seed synthetic test user using bootstrap role qa_admin (only when necessary)
    const adminPool = new Pool({
        host: QA_PG_HOST,
        port: QA_PG_PORT,
        user: QA_ADMIN_USER,
        password: QA_ADMIN_PASSWORD,
        database: QA_PG_DATABASE,
        connectionTimeoutMillis: 3000
    });

    const testPassword = 'QAPassword2026!';
    const passwordHash = await bcrypt.hash(testPassword, 10);
    const testUsername = 'qa_runtime_test_user';

    try {
        await adminPool.query(`
            INSERT INTO nexus_tv.users (username, email, role, password_hash)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (username) DO UPDATE
            SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role;
        `, [testUsername, 'qa_test@nexustv.local', 'admin', passwordHash]);
    } finally {
        await adminPool.end();
    }

    // 4. Runtime pool strictly as nexus_app
    const appPool = new Pool({
        host: QA_PG_HOST,
        port: QA_PG_PORT,
        user: QA_PG_USER,
        password: QA_PG_PASSWORD,
        database: QA_PG_DATABASE,
        connectionTimeoutMillis: 3000
    });

    // Wire up runtime pool to db config for route testing
    const originalPool = db.pool;
    db.pool = appPool;

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
        await t.test('1. Role attributes: nexus_app is strictly non-superuser, non-admin', async () => {
            const res = await appPool.query(`
                SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication
                FROM pg_roles
                WHERE rolname = current_user
            `);
            assert.equal(res.rows.length, 1);
            const r = res.rows[0];
            assert.equal(r.rolname, 'nexus_app');
            assert.equal(r.rolsuper, false);
            assert.equal(r.rolcreaterole, false);
            assert.equal(r.rolcreatedb, false);
            assert.equal(r.rolreplication, false);
        });

        await t.test('2. Real backend route /api/auth/login works end-to-end under nexus_app', async () => {
            // Valid credentials
            const loginRes = await httpRequest(server, {
                path: '/api/auth/login',
                method: 'POST'
            }, {
                username: testUsername,
                password: testPassword
            });

            assert.equal(loginRes.status, 200);
            assert.equal(loginRes.body.success, true);
            assert.ok(loginRes.body.token, 'Must return JWT token');
            assert.equal(loginRes.body.user.username, testUsername);
            assert.equal(loginRes.body.user.role, 'admin');

            const token = loginRes.body.token;

            // Access protected /api/auth/me using issued JWT
            const meRes = await httpRequest(server, {
                path: '/api/auth/me',
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` }
            });

            assert.equal(meRes.status, 200);
            assert.equal(meRes.body.success, true);
            assert.equal(meRes.body.user.username, testUsername);

            // Invalid credentials rejected
            const badRes = await httpRequest(server, {
                path: '/api/auth/login',
                method: 'POST'
            }, {
                username: testUsername,
                password: 'WrongPassword!'
            });
            assert.equal(badRes.status, 401);
            assert.equal(badRes.body.success, false);
        });

        await t.test('3. Functional CRUD operations succeed for business tables', async () => {
            const client = await appPool.connect();
            try {
                await client.query('BEGIN');

                // Screen CRUD
                const screenRes = await client.query(`
                    INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active)
                    VALUES ('99999999-9999-4999-8999-999999999999', 'QA Least Priv Screen', 'Lab', true)
                    RETURNING id
                `);
                const screenId = screenRes.rows[0].id;
                assert.ok(screenId > 0);

                const screenUpdate = await client.query(`
                    UPDATE nexus_tv.tv_screens SET name = 'QA Renamed' WHERE id = $1
                `, [screenId]);
                assert.equal(screenUpdate.rowCount, 1);

                // Playlist CRUD
                const plRes = await client.query(`
                    INSERT INTO nexus_tv.playlists (name, is_public) VALUES ('QA LP Playlist', false) RETURNING id
                `);
                const plId = plRes.rows[0].id;
                assert.ok(plId > 0);

                // Content CRUD
                const cRes = await client.query(`
                    INSERT INTO nexus_tv.content (title, content_type, source_type, source_url, duration_seconds)
                    VALUES ('QA LP Content', 'video', 'external_url', 'https://example.com/lp.mp4', 30)
                    RETURNING id
                `);
                const cId = cRes.rows[0].id;
                assert.ok(cId > 0);

                // M2M Relations
                const tvPlRes = await client.query(`
                    INSERT INTO nexus_tv.tv_playlist (tv_id, playlist_id, is_primary)
                    VALUES ($1, $2, true)
                `, [screenId, plId]);
                assert.equal(tvPlRes.rowCount, 1);

                const plCRes = await client.query(`
                    INSERT INTO nexus_tv.playlist_content (playlist_id, content_id, position)
                    VALUES ($1, $2, 0)
                `, [plId, cId]);
                assert.equal(plCRes.rowCount, 1);

                // Cleanup in transaction
                await client.query('DELETE FROM nexus_tv.playlist_content WHERE playlist_id = $1', [plId]);
                await client.query('DELETE FROM nexus_tv.tv_playlist WHERE tv_id = $1', [screenId]);
                await client.query('DELETE FROM nexus_tv.content WHERE id = $1', [cId]);
                await client.query('DELETE FROM nexus_tv.playlists WHERE id = $1', [plId]);
                await client.query('DELETE FROM nexus_tv.tv_screens WHERE id = $1', [screenId]);

                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        });

        await t.test('4. Read-only access to users table is granted for legitimate auth queries', async () => {
            const res = await appPool.query('SELECT count(*) FROM nexus_tv.users');
            assert.ok(parseInt(res.rows[0].count, 10) >= 1);
        });

        await t.test('5. Mutation on users table is strictly denied (least privilege protection)', async () => {
            await assert.rejects(
                () => appPool.query("INSERT INTO nexus_tv.users (username, password_hash, role) VALUES ('evil_user', 'x', 'admin')"),
                (err) => err.code === '42501' && /permission denied for table users/i.test(err.message)
            );

            await assert.rejects(
                () => appPool.query("UPDATE nexus_tv.users SET role = 'admin' WHERE username = 'qa_runtime_test_user'"),
                (err) => err.code === '42501' && /permission denied for table users/i.test(err.message)
            );

            await assert.rejects(
                () => appPool.query("DELETE FROM nexus_tv.users WHERE username = 'qa_runtime_test_user'"),
                (err) => err.code === '42501' && /permission denied for table users/i.test(err.message)
            );
        });

        await t.test('6. TRUNCATE on business tables is strictly denied', async () => {
            await assert.rejects(
                () => appPool.query("TRUNCATE TABLE nexus_tv.tv_screens"),
                (err) => err.code === '42501' && /permission denied for table tv_screens/i.test(err.message)
            );
        });

        await t.test('7. DDL schema operations are strictly denied', async () => {
            await assert.rejects(
                () => appPool.query("CREATE TABLE nexus_tv.hacked_table (id serial)"),
                (err) => err.code === '42501' && /permission denied for schema nexus_tv/i.test(err.message)
            );

            await assert.rejects(
                () => appPool.query("DROP TABLE nexus_tv.content"),
                (err) => /must be owner of table content/i.test(err.message)
            );
        });

        await t.test('8. Administrative role alterations are strictly denied', async () => {
            await assert.rejects(
                () => appPool.query("ALTER ROLE nexus_app SUPERUSER"),
                (err) => /permission denied to alter role/i.test(err.message)
            );
        });

        await t.test('9. Sequence users_id_seq mutation is strictly denied', async () => {
            await assert.rejects(
                () => appPool.query("SELECT nextval('nexus_tv.users_id_seq')"),
                (err) => err.code === '42501' && /permission denied for sequence users_id_seq/i.test(err.message)
            );
        });

    } finally {
        await new Promise((resolve) => server.close(resolve));
        db.pool = originalPool;
        await appPool.end();
    }
});
