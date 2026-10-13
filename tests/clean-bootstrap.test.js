const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const BOOTSTRAP_PORT = 25498;
const BOOTSTRAP_HOST = '127.0.0.1';
const BOOTSTRAP_DB = 'nexus_tv';
const BOOTSTRAP_APP_USER = 'nexus_app';
const BOOTSTRAP_APP_PASSWORD = 'qa_bootstrap_app_pw_2026';
const EXPECTED_MARKER = 'QA_CLEAN_BOOTSTRAP_25498_VALIDATED';

test('AUD-001 Clean Installation Bootstrap & Least Privilege Validation', async (t) => {
    // 1. Strict identity and destination verification before ANY query
    assert.equal(BOOTSTRAP_PORT, 25498, 'Must strictly target isolated test port 25498');
    assert.equal(BOOTSTRAP_HOST, '127.0.0.1', 'Must strictly target loopback host');
    assert.notEqual(BOOTSTRAP_PORT, 25432, 'Never target production port 25432');
    assert.notEqual(BOOTSTRAP_PORT, 25499, 'Keep separate from main QA port 25499');

    const appPool = new Pool({
        host: BOOTSTRAP_HOST,
        port: BOOTSTRAP_PORT,
        database: BOOTSTRAP_DB,
        user: BOOTSTRAP_APP_USER,
        password: BOOTSTRAP_APP_PASSWORD,
        connectionTimeoutMillis: 3000
    });

    try {
        // Verify database identity marker in catalog
        const markerRes = await appPool.query(`
            SELECT pg_database.datname, pg_shdescription.description
            FROM pg_database
            LEFT JOIN pg_shdescription ON pg_database.oid = pg_shdescription.objoid
            WHERE pg_database.datname = current_database();
        `);
        assert.equal(markerRes.rows.length, 1);
        assert.equal(
            markerRes.rows[0].description,
            EXPECTED_MARKER,
            'Database must carry the validated clean bootstrap QA marker'
        );

        await t.test('1. Clean bootstrap creates nexus_app with valid login and consumes variables', async () => {
            const userRes = await appPool.query('SELECT current_user, current_database()');
            assert.equal(userRes.rows[0].current_user, 'nexus_app');
            assert.equal(userRes.rows[0].current_database, 'nexus_tv');
        });

        await t.test('2. Role attributes: nexus_app is strictly non-superuser, non-admin', async () => {
            const res = await appPool.query(`
                SELECT rolname, rolsuper, rolcanlogin, rolcreaterole, rolcreatedb, rolreplication
                FROM pg_roles
                WHERE rolname = current_user
            `);
            assert.equal(res.rows.length, 1);
            const r = res.rows[0];
            assert.equal(r.rolname, 'nexus_app');
            assert.equal(r.rolcanlogin, true);
            assert.equal(r.rolsuper, false);
            assert.equal(r.rolcreaterole, false);
            assert.equal(r.rolcreatedb, false);
            assert.equal(r.rolreplication, false);
        });

        await t.test('3. Legacy role tv is non-login and non-superuser in clean installation', async () => {
            const res = await appPool.query(`
                SELECT rolname, rolsuper, rolcanlogin
                FROM pg_roles
                WHERE rolname = 'tv'
            `);
            assert.equal(res.rows.length, 1);
            const r = res.rows[0];
            assert.equal(r.rolname, 'tv');
            assert.equal(r.rolsuper, false, 'tv must NOT be superuser');
            assert.equal(r.rolcanlogin, false, 'tv must NOT be allowed to login');
        });

        await t.test('4. Functional CRUD operations succeed on operational tables', async () => {
            const client = await appPool.connect();
            try {
                await client.query('BEGIN');

                // Screen
                const s = await client.query(`
                    INSERT INTO nexus_tv.tv_screens (tv_uuid, name, location, is_active)
                    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Clean Screen', 'Lab', true)
                    RETURNING id
                `);
                const sId = s.rows[0].id;
                assert.ok(sId > 0);

                // Playlist
                const p = await client.query(`
                    INSERT INTO nexus_tv.playlists (name, is_public) VALUES ('Clean PL', false) RETURNING id
                `);
                const pId = p.rows[0].id;
                assert.ok(pId > 0);

                // Content
                const c = await client.query(`
                    INSERT INTO nexus_tv.content (title, content_type, source_type, source_url, duration_seconds)
                    VALUES ('Clean Content', 'video', 'external_url', 'https://example.com/v.mp4', 30)
                    RETURNING id
                `);
                const cId = c.rows[0].id;
                assert.ok(cId > 0);

                // Associations
                const tp = await client.query(`
                    INSERT INTO nexus_tv.tv_playlist (tv_id, playlist_id, is_primary) VALUES ($1, $2, true)
                `, [sId, pId]);
                assert.equal(tp.rowCount, 1);

                const pc = await client.query(`
                    INSERT INTO nexus_tv.playlist_content (playlist_id, content_id, position) VALUES ($1, $2, 0)
                `, [pId, cId]);
                assert.equal(pc.rowCount, 1);

                // Clean up inside transaction
                await client.query('DELETE FROM nexus_tv.playlist_content WHERE playlist_id = $1', [pId]);
                await client.query('DELETE FROM nexus_tv.tv_playlist WHERE tv_id = $1', [sId]);
                await client.query('DELETE FROM nexus_tv.content WHERE id = $1', [cId]);
                await client.query('DELETE FROM nexus_tv.playlists WHERE id = $1', [pId]);
                await client.query('DELETE FROM nexus_tv.tv_screens WHERE id = $1', [sId]);

                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        });

        await t.test('5. Read-only access to users is granted for authentication', async () => {
            const res = await appPool.query('SELECT count(*) FROM nexus_tv.users');
            assert.ok(parseInt(res.rows[0].count, 10) >= 0);
        });

        await t.test('6. Mutations on users table are strictly rejected', async () => {
            await assert.rejects(
                () => appPool.query("INSERT INTO nexus_tv.users (username, password_hash, role) VALUES ('x', 'y', 'admin')"),
                (err) => err.code === '42501' && /permission denied for table users/i.test(err.message)
            );
            await assert.rejects(
                () => appPool.query("UPDATE nexus_tv.users SET role = 'admin'"),
                (err) => err.code === '42501' && /permission denied for table users/i.test(err.message)
            );
            await assert.rejects(
                () => appPool.query("DELETE FROM nexus_tv.users"),
                (err) => err.code === '42501' && /permission denied for table users/i.test(err.message)
            );
        });

        await t.test('7. Unauthorized administrative operations are rejected', async () => {
            await assert.rejects(
                () => appPool.query("TRUNCATE TABLE nexus_tv.tv_screens"),
                (err) => err.code === '42501' && /permission denied for table tv_screens/i.test(err.message)
            );
            await assert.rejects(
                () => appPool.query("CREATE TABLE nexus_tv.forbidden (id int)"),
                (err) => err.code === '42501' && /permission denied for schema nexus_tv/i.test(err.message)
            );
            await assert.rejects(
                () => appPool.query("ALTER ROLE nexus_app SUPERUSER"),
                (err) => /permission denied to alter role/i.test(err.message)
            );
        });

        await t.test('8. Cross-database connection to postgres database is denied', async () => {
            const foreignPool = new Pool({
                host: BOOTSTRAP_HOST,
                port: BOOTSTRAP_PORT,
                database: 'postgres',
                user: BOOTSTRAP_APP_USER,
                password: BOOTSTRAP_APP_PASSWORD,
                connectionTimeoutMillis: 2000
            });
            await assert.rejects(
                () => foreignPool.query('SELECT 1'),
                (err) => /permission denied for database "?postgres"?/i.test(err.message)
            );
            await foreignPool.end().catch(() => {});
        });

        await t.test('9. Migration 07 pending_pairings table and indexes exist in clean installation', async () => {
            const tableRes = await appPool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'nexus_tv' AND table_name = 'pending_pairings'
                );
            `);
            assert.equal(tableRes.rows[0].exists, true, 'nexus_tv.pending_pairings must exist');

            const idxRes = await appPool.query(`
                SELECT indexname FROM pg_indexes
                WHERE schemaname = 'nexus_tv' AND tablename = 'pending_pairings';
            `);
            const idxNames = idxRes.rows.map(r => r.indexname);
            assert.ok(idxNames.includes('idx_pending_pairings_lookup'), 'idx_pending_pairings_lookup must exist');
            assert.ok(idxNames.includes('idx_pending_pairings_status_exp'), 'idx_pending_pairings_status_exp must exist');
        });

        await t.test('10. nexus_app has complete DML privileges on pending_pairings but DDL/TRUNCATE denied', async () => {
            const client = await appPool.connect();
            try {
                await client.query('BEGIN');
                const insertRes = await client.query(`
                    INSERT INTO nexus_tv.pending_pairings (tv_uuid, pairing_session_id, pending_device_token_hash, status, expires_at)
                    VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bootstrap_sess_1', 'dummy_hash_1', 'pending', NOW() + INTERVAL '60 seconds')
                    RETURNING id
                `);
                const rowId = insertRes.rows[0].id;
                assert.ok(rowId > 0);

                const selectRes = await client.query(`
                    SELECT status FROM nexus_tv.pending_pairings WHERE id = $1 FOR UPDATE
                `, [rowId]);
                assert.equal(selectRes.rows[0].status, 'pending');

                const updateRes = await client.query(`
                    UPDATE nexus_tv.pending_pairings SET status = 'promoted', updated_at = NOW() WHERE id = $1
                `, [rowId]);
                assert.equal(updateRes.rowCount, 1);

                const deleteRes = await client.query(`
                    DELETE FROM nexus_tv.pending_pairings WHERE id = $1
                `, [rowId]);
                assert.equal(deleteRes.rowCount, 1);

                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }

            // TRUNCATE must be denied
            await assert.rejects(
                () => appPool.query('TRUNCATE TABLE nexus_tv.pending_pairings'),
                (err) => err.code === '42501' && /permission denied for table pending_pairings/i.test(err.message)
            );
        });

    } finally {
        await appPool.end();
    }
});
