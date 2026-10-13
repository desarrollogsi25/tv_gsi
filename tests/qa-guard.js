// ═══════════════════════════════════════════════════════════
// Nexus TV — Strict QA Target Identification & Isolation Guard
// Hardened per MISIÓN 2C Specification
// ═══════════════════════════════════════════════════════════

const { Pool } = require('pg');

const EXPECTED_QA_HOST = '127.0.0.1';
const EXPECTED_QA_PORT = 25499;
const EXPECTED_QA_DATABASE = 'nexus_tv';
const EXPECTED_MARKER = 'QA_ISOLATED_DB_25499_VALIDATED';

/**
 * Validates that connection parameters strictly match the authorized QA database
 * AND executes a read-only probe verifying the database identity marker in pg_shdescription.
 * Aborts immediately BEFORE any mutation if ANY parameter or identity marker fails.
 */
async function assertAuthorizedQaEnvironment(poolConfig, expectedRole = 'nexus_app') {
    const host = poolConfig.host || process.env.QA_PG_HOST || '127.0.0.1';
    const port = parseInt(poolConfig.port || process.env.QA_PG_PORT || '25499', 10);
    const database = poolConfig.database || process.env.QA_PG_DATABASE || 'nexus_tv';
    const user = poolConfig.user || process.env.QA_PG_USER || 'nexus_app';

    // 1. Strict destination checks
    if (host !== EXPECTED_QA_HOST) {
        throw new Error(`SECURITY ABORT: Host '${host}' is not the authorized QA host ('${EXPECTED_QA_HOST}')!`);
    }
    if (port !== EXPECTED_QA_PORT) {
        throw new Error(`SECURITY ABORT: Port ${port} is not the authorized QA port (${EXPECTED_QA_PORT})! Never target production (25432) or unauthorized ports.`);
    }
    if (database !== EXPECTED_QA_DATABASE) {
        throw new Error(`SECURITY ABORT: Database '${database}' is not the authorized QA database ('${EXPECTED_QA_DATABASE}')!`);
    }
    if (expectedRole && user !== expectedRole) {
        throw new Error(`SECURITY ABORT: User '${user}' does not match expected role '${expectedRole}' for this test suite!`);
    }

    // 2. Reject default dev/prod credentials
    const forbiddenUsers = ['tv', 'postgres', 'nexus_admin'];
    if (forbiddenUsers.includes(user.toLowerCase())) {
        throw new Error(`SECURITY ABORT: Production/dev user '${user}' cannot be used for QA tests!`);
    }

    // 3. Probe database identity marker BEFORE allowing any write or test query
    const probePool = new Pool({
        host,
        port,
        database,
        user,
        password: poolConfig.password,
        connectionTimeoutMillis: 3000
    });

    try {
        const res = await probePool.query(`
            SELECT pg_database.datname, pg_shdescription.description
            FROM pg_database
            LEFT JOIN pg_shdescription ON pg_database.oid = pg_shdescription.objoid
            WHERE pg_database.datname = current_database();
        `);

        if (res.rows.length === 0) {
            throw new Error(`SECURITY ABORT: Could not query current database record in pg_database.`);
        }

        const marker = res.rows[0].description;
        if (marker !== EXPECTED_MARKER) {
            throw new Error(
                `SECURITY ABORT: Target database '${database}' on ${host}:${port} is missing the required QA identity marker!\n` +
                `Expected comment: '${EXPECTED_MARKER}', but got: '${marker || '<empty>'}'.\n` +
                `Execution aborted to prevent accidental writes to production or unverified databases.`
            );
        }

        // Verify effective user matches
        const userRes = await probePool.query('SELECT current_user');
        const effectiveUser = userRes.rows[0].current_user;
        if (effectiveUser !== user) {
            throw new Error(`SECURITY ABORT: Connected session current_user '${effectiveUser}' does not match expected user '${user}'.`);
        }
    } finally {
        await probePool.end();
    }

    return true;
}

module.exports = {
    EXPECTED_QA_HOST,
    EXPECTED_QA_PORT,
    EXPECTED_QA_DATABASE,
    EXPECTED_MARKER,
    assertAuthorizedQaEnvironment
};
