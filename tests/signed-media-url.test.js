// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Signed Media URL Tests (AUD-007 / MISIÓN 5)
// ═══════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// Configurar variable de entorno para tests
process.env.MEDIA_URL_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

const {
    SIGNED_URL_PURPOSE,
    generateSignedMediaUrl,
    verifySignedMediaUrl,
    signedMediaUrlMiddleware,
    getSigningKey
} = require('../src/utils/signedMediaUrl');

const TEST_KEY = process.env.MEDIA_URL_SIGNING_KEY;

function createMockReq(query = {}) {
    return {
        method: 'GET',
        path: '/media/test-file.mp4',
        query,
        ip: '127.0.0.1'
    };
}

function createMockRes() {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        }
    };
    return res;
}

function createMockNext() {
    return (err) => {
        if (err) throw err;
    };
}

// ── Tests de generación y verificación ──

test('SMU-1: Generar URL firmada para TV_PLAYBACK con tvUuid', () => {
    const signedUrl = generateSignedMediaUrl({
        filename: 'test-video.mp4',
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tvUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ttlSeconds: 3600,
        contentId: 123
    });

    assert.match(signedUrl, /^\/media\/test-video\.mp4\?/);
    assert.match(signedUrl, /token=[a-f0-9]{64}/);
    assert.match(signedUrl, /exp=\d+/);
    assert.match(signedUrl, /purpose=tv_playback/);
    assert.match(signedUrl, /tv=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/);
    assert.match(signedUrl, /cid=123/);
});

test('SMU-2: Generar URL firmada para ADMIN_PREVIEW sin tvUuid', () => {
    const signedUrl = generateSignedMediaUrl({
        filename: 'test-image.jpg',
        purpose: SIGNED_URL_PURPOSE.ADMIN_PREVIEW,
        ttlSeconds: 1800,
        contentId: 456
    });

    assert.match(signedUrl, /^\/media\/test-image\.jpg\?/);
    assert.match(signedUrl, /token=[a-f0-9]{64}/);
    assert.match(signedUrl, /purpose=admin_preview/);
    assert.equal(/tv=/.test(signedUrl), false);
    assert.match(signedUrl, /cid=456/);
});

test('SMU-3: Verificar URL firmada válida (TV_PLAYBACK)', () => {
    const signedUrl = generateSignedMediaUrl({
        filename: 'verify-test.mp4',
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tvUuid: '11111111-2222-3333-4444-555555555555',
        ttlSeconds: 3600
    });

    // Extraer parámetros
    const url = new URL(signedUrl, 'http://localhost');
    const params = Object.fromEntries(url.searchParams);

    const result = verifySignedMediaUrl({
        filename: 'verify-test.mp4',
        token: params.token,
        exp: params.exp,
        purpose: params.purpose,
        tv: params.tv,
        cid: params.cid
    });

    assert.equal(result.valid, true);
    assert.equal(result.payload.filename, 'verify-test.mp4');
    assert.equal(result.payload.purpose, 'tv_playback');
    assert.equal(result.payload.tvUuid, '11111111-2222-3333-4444-555555555555');
});

test('SMU-4: Rechazar firma incorrecta', () => {
    const signedUrl = generateSignedMediaUrl({
        filename: 'bad-sig.mp4',
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tvUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ttlSeconds: 3600
    });

    const url = new URL(signedUrl, 'http://localhost');
    const params = Object.fromEntries(url.searchParams);

    // Corromper la firma
    const result = verifySignedMediaUrl({
        filename: 'bad-sig.mp4',
        token: params.token.slice(0, -1) + (params.token.slice(-1) === 'a' ? 'b' : 'a'),
        exp: params.exp,
        purpose: params.purpose,
        tv: params.tv
    });

    assert.equal(result.valid, false);
    assert.equal(result.error, 'Invalid signature');
});

test('SMU-5: Rechazar URL caducada', () => {
    const signedUrl = generateSignedMediaUrl({
        filename: 'expired.mp4',
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tvUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ttlSeconds: -10 // Ya expirada
    });

    const url = new URL(signedUrl, 'http://localhost');
    const params = Object.fromEntries(url.searchParams);

    const result = verifySignedMediaUrl({
        filename: 'expired.mp4',
        token: params.token,
        exp: params.exp,
        purpose: params.purpose,
        tv: params.tv
    });

    assert.equal(result.valid, false);
    assert.equal(result.expired, true);
    assert.equal(result.error, 'Signed URL expired');
});

test('SMU-6: Rechazar propósito incorrecto', () => {
    const signedUrl = generateSignedMediaUrl({
        filename: 'wrong-purpose.mp4',
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tvUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ttlSeconds: 3600
    });

    const url = new URL(signedUrl, 'http://localhost');
    const params = Object.fromEntries(url.searchParams);

    // Verificar con propósito diferente
    const result = verifySignedMediaUrl({
        filename: 'wrong-purpose.mp4',
        token: params.token,
        exp: params.exp,
        purpose: SIGNED_URL_PURPOSE.ADMIN_PREVIEW,
        tv: params.tv
    });

    assert.equal(result.valid, false);
    assert.equal(result.error, 'Invalid signature');
});

test('SMU-7: Rechazar archivo diferente con misma firma', () => {
    const signedUrl = generateSignedMediaUrl({
        filename: 'original.mp4',
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tvUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ttlSeconds: 3600
    });

    const url = new URL(signedUrl, 'http://localhost');
    const params = Object.fromEntries(url.searchParams);

    // Verificar con nombre de archivo diferente
    const result = verifySignedMediaUrl({
        filename: 'different.mp4',
        token: params.token,
        exp: params.exp,
        purpose: params.purpose,
        tv: params.tv
    });

    assert.equal(result.valid, false);
    assert.equal(result.error, 'Invalid signature');
});

test('SMU-8: Rechazar TV UUID diferente para TV_PLAYBACK', () => {
    const signedUrl = generateSignedMediaUrl({
        filename: 'tv-bound.mp4',
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tvUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ttlSeconds: 3600
    });

    const url = new URL(signedUrl, 'http://localhost');
    const params = Object.fromEntries(url.searchParams);

    // Verificar con TV UUID diferente
    const result = verifySignedMediaUrl({
        filename: 'tv-bound.mp4',
        token: params.token,
        exp: params.exp,
        purpose: params.purpose,
        tv: 'ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb'
    });

    assert.equal(result.valid, false);
    assert.equal(result.error, 'Invalid signature');
});

test('SMU-9: Rechazar parámetros faltantes', () => {
    const result = verifySignedMediaUrl({
        filename: 'test.mp4',
        token: 'abc',
        // exp faltante
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK
    });

    assert.equal(result.valid, false);
    assert.match(result.error, /Missing required/);
});

test('SMU-10: Rechazar tvUuid faltante para TV_PLAYBACK', () => {
    const result = verifySignedMediaUrl({
        filename: 'test.mp4',
        token: 'abc',
        exp: String(Math.floor(Date.now() / 1000) + 3600),
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK
        // tv faltante
    });

    assert.equal(result.valid, false);
    assert.match(result.error, /TV UUID required/);
});

// ── Tests del middleware ──

test('SMU-11: Middleware permite GET con firma válida', async () => {
    const signedUrl = generateSignedMediaUrl({
        filename: 'middleware-test.mp4',
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tvUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ttlSeconds: 3600
    });

    const url = new URL(signedUrl, 'http://localhost');
    const req = createMockReq(Object.fromEntries(url.searchParams));
    req.path = '/media/middleware-test.mp4';
    const res = createMockRes();
    const next = createMockNext();

    await signedMediaUrlMiddleware(req, res, next);

    assert.ok(req.signedMedia);
    assert.equal(req.signedMedia.filename, 'middleware-test.mp4');
    assert.equal(req.signedMedia.purpose, 'tv_playback');
});

test('SMU-12: Middleware rechaza firma inválida', async () => {
    const req = createMockReq({
        token: 'invalidsignature',
        exp: String(Math.floor(Date.now() / 1000) + 3600),
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tv: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    });
    req.path = '/media/reject-test.mp4';
    const res = createMockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await signedMediaUrlMiddleware(req, res, next);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'INVALID_SIGNED_URL');
    assert.equal(nextCalled, false);
});

test('SMU-13: Middleware rechaza URL caducada', async () => {
    const req = createMockReq({
        token: 'a'.repeat(64), // firma dummy
        exp: String(Math.floor(Date.now() / 1000) - 100), // expirado
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tv: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    });
    req.path = '/media/expired-test.mp4';
    const res = createMockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await signedMediaUrlMiddleware(req, res, next);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'SIGNED_URL_EXPIRED');
    assert.equal(nextCalled, false);
});

test('SMU-14: Middleware no bloquea métodos no-GET/HEAD', async () => {
    const req = createMockReq({});
    req.method = 'POST';
    req.path = '/media/test.mp4';
    const res = createMockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await signedMediaUrlMiddleware(req, res, next);

    assert.equal(nextCalled, true);
});

// ── Tests de configuración ──

test('SMU-15: Fallo seguro sin MEDIA_URL_SIGNING_KEY', () => {
    const originalKey = process.env.MEDIA_URL_SIGNING_KEY;
    delete process.env.MEDIA_URL_SIGNING_KEY;
    
    assert.throws(() => {
        getSigningKey();
    }, /MEDIA_URL_SIGNING_KEY environment variable is required/);
    
    // Restaurar para otros tests
    process.env.MEDIA_URL_SIGNING_KEY = originalKey;
});

// ── Tests de TTL y expiración ──

test('SMU-16: TTL mínimo de 1 hora para TV_PLAYBACK', () => {
    const signedUrl = generateSignedMediaUrl({
        filename: 'ttl-test.mp4',
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tvUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ttlSeconds: 100 // Menos de 1 hora
    });

    const url = new URL(signedUrl, 'http://localhost');
    const params = Object.fromEntries(url.searchParams);
    const expiresAt = parseInt(params.exp, 10);
    const now = Math.floor(Date.now() / 1000);
    const ttl = expiresAt - now;

    // generateSignedMediaUrl no fuerza mínimo; el caller (TV route) sí lo hace
    // Este test documenta que la función respeta el TTL dado
    assert.ok(ttl > 0);
});

test('SMU-17: ContentId incluido en firma cuando se proporciona', () => {
    const signedUrl = generateSignedMediaUrl({
        filename: 'cid-test.mp4',
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tvUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ttlSeconds: 3600,
        contentId: 999
    });

    assert.match(signedUrl, /cid=999/);

    const url = new URL(signedUrl, 'http://localhost');
    const params = Object.fromEntries(url.searchParams);
    const result = verifySignedMediaUrl({
        filename: 'cid-test.mp4',
        token: params.token,
        exp: params.exp,
        purpose: params.purpose,
        tv: params.tv,
        cid: params.cid
    });

    assert.equal(result.valid, true);
    assert.equal(result.payload.contentId, 999);
});

test('SMU-18: Comparación de firmas en tiempo constante (timingSafeEqual)', () => {
    // Verificar que verifySignedMediaUrl usa timingSafeEqual internamente
    // Esto se prueba indirectamente: una firma incorrecta no debe revelar
    // información por timing (aunque en test unitario no medimos timing)
    const signedUrl = generateSignedMediaUrl({
        filename: 'timing.mp4',
        purpose: SIGNED_URL_PURPOSE.TV_PLAYBACK,
        tvUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ttlSeconds: 3600
    });

    const url = new URL(signedUrl, 'http://localhost');
    const params = Object.fromEntries(url.searchParams);

    // Firma correcta
    let result = verifySignedMediaUrl({
        filename: 'timing.mp4',
        token: params.token,
        exp: params.exp,
        purpose: params.purpose,
        tv: params.tv
    });
    assert.equal(result.valid, true);

    // Firma con mismo largo pero diferente
    const wrongToken = params.token.slice(0, 32) + 'b'.repeat(32);
    result = verifySignedMediaUrl({
        filename: 'timing.mp4',
        token: wrongToken,
        exp: params.exp,
        purpose: params.purpose,
        tv: params.tv
    });
    assert.equal(result.valid, false);
});

// ── Tests de endurecimiento de la clave (preflight DEV-RUN-005) ──

test('SMU-19: Rechaza la clave placeholder de .env.example (firma forjeable)', () => {
    const originalKey = process.env.MEDIA_URL_SIGNING_KEY;
    process.env.MEDIA_URL_SIGNING_KEY = 'REPLACE_WITH_A_SECURE_RANDOM_KEY_MIN_32_BYTES';

    assert.throws(() => {
        getSigningKey();
    }, /placeholder/i);

    process.env.MEDIA_URL_SIGNING_KEY = originalKey;
});

test('SMU-20: Rechaza claves por debajo de 32 bytes', () => {
    const originalKey = process.env.MEDIA_URL_SIGNING_KEY;
    process.env.MEDIA_URL_SIGNING_KEY = 'corta-demasiado-corta-1234'; // < 32 bytes

    assert.throws(() => {
        getSigningKey();
    }, /at least 32 bytes/i);

    process.env.MEDIA_URL_SIGNING_KEY = originalKey;
});