process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const jwtSecret = require('../src/config/jwt');
const authMiddleware = require('../src/middlewares/auth');
const { router: mediaRouter } = require('../src/routes/media');

// Complete, fully decodable 1x1 image fixtures
const VALID_PNG_BUFFER = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
);

const VALID_JPEG_BUFFER = Buffer.from(
    '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAABAAEDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z',
    'base64'
);

const VALID_GIF_BUFFER = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

const VALID_WEBP_BUFFER = Buffer.from(
    'UklGRjgAAABXRUJQVlA4ICwAAADQAQCdASoBAAEAAgA0JaACdLoB+AADsAD+8Oj3/yC5YXXI1/5sCua5+agAAA==',
    'base64'
);

// Truncated fixtures starting with valid magic signatures
const TRUNCATED_PNG_BUFFER = VALID_PNG_BUFFER.subarray(0, 30);
const TRUNCATED_JPEG_BUFFER = VALID_JPEG_BUFFER.subarray(0, 25);
const TRUNCATED_GIF_BUFFER = VALID_GIF_BUFFER.subarray(0, 18);
const TRUNCATED_WEBP_BUFFER = VALID_WEBP_BUFFER.subarray(0, 22);

// Corrupt internal content fixtures (valid signatures/headers, but corrupt internal stream)
// 1. PNG with valid signature and IHDR but corrupted IDAT deflate stream
const CORRUPT_IDAT_PNG_BUFFER = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
    Buffer.from([0,0,0,1, 0,0,0,1, 8, 6, 0, 0, 0]),
    Buffer.from([0x1F, 0x15, 0xC4, 0x89]),
    Buffer.from([0, 0, 0, 8]), Buffer.from('IDAT'),
    Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03, 0x04]), // Corrupt non-zlib payload
    Buffer.from([0x12, 0x34, 0x56, 0x78]),
    Buffer.from([0, 0, 0, 0]), Buffer.from('IEND'),
    Buffer.from([0xAE, 0x42, 0x60, 0x82])
]);

// 2. GIF with valid header, screen descriptor and subblock, but invalid LZW code stream
const CORRUPT_LZW_GIF_BUFFER = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x02, 0x00, 0x02, 0x00,             // 2x2
    0x80, 0x00, 0x00,                   // GCT present, 2 colors
    0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, // palette
    0x2C, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, // Image Descriptor 2x2
    0x02,                               // LZW min code size = 2
    0x03, 0xFF, 0xFF, 0xFF,             // subblock with 3 bytes of invalid LZW
    0x00,                               // block terminator
    0x3B                                // trailer
]);

// 3. JPEG with valid markers (SOI, DQT, SOF0, DHT, SOS, EOI) but corrupt entropy data
const CORRUPT_SCAN_JPEG_BUFFER = Buffer.from([
    0xFF, 0xD8, // SOI
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
    0xFF, 0xDB, 0x00, 0x43, 0x00, ...new Array(64).fill(1),
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x0A, 0x00, 0x0A, 0x01, 0x01, 0x11, 0x00,
    0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
    0xFF, 0xFF, 0xAA, 0xBB, 0xCC, 0xDD,
    0xFF, 0xD9 // EOI
]);

// 4. WebP with valid RIFF and VP8 tag but corrupt VP8 payload
const CORRUPT_PAYLOAD_WEBP_BUFFER = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x20, 0x00, 0x00, 0x00, // size 32
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20, // VP8_
    0x14, 0x00, 0x00, 0x00, // chunk size 20
    0x00, 0x00, 0x00,       // tag (keyframe)
    0x9D, 0x01, 0x2A,       // start code
    0x02, 0x00, 0x02, 0x00, // 2x2
    0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD
]);

// Real 1-second synthetic MP4 video (h264, 64x64, 25fps, 1.0s duration)
const VALID_MP4_BUFFER = Buffer.from(
    'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAARmbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAA' +
    'AAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAA5B0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAAB' +
    'AAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAA' +
    'AEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAEAAABAAAAAAMIbWRpYQAAACBtZGhk' +
    'AAAAAAAAAAAAAAAAAAAyAAAAMgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRl' +
    'b0hhbmRsZXIAAAACs21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAA' +
    'AQAAAAx1cmwgAAAAAQAAAnNzdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAA' +
    'AAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAA' +
    'GP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UQmwEQAAAMABAAAAwDIPEiWWAEABmjr48siwP34+AAAAAAQ' +
    'cGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAhSAAAAAAAAAAYc3R0cwAAAAAAAAABAAAAGQAAAgAAAAAU' +
    'c3RzcwAAAAAAAAABAAAAAQAAANhjdHRzAAAAAAAAABkAAAABAAAEAAAAAAEAAAoAAAAAAQAABAAAAAAB' +
    'AAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQA' +
    'AAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAAB' +
    'AAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAABxzdHNj' +
    'AAAAAAAAAAEAAAABAAAAGQAAAAEAAAB4c3RzegAAAAAAAAAAAAAAGQAAAtUAAAAOAAAADAAAAAwAAAAM' +
    'AAAAFAAAAA4AAAAMAAAADAAAABQAAAAOAAAADAAAAAwAAAAUAAAADgAAAAwAAAAMAAAAFAAAAA4AAAAM' +
    'AAAADAAAABQAAAAOAAAADAAAAAwAAAAUc3RjbwAAAAAAAAABAAAElgAAAGJ1ZHRhAAAAWm1ldGEAAAAA' +
    'AAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAA' +
    'AQAAAABMYXZmNjIuMTIuMTAyAAAACGZyZWUAAAQxbWRhdAAAAqYGBf//otxF6b3m2Ui3lizYINkj7u94' +
    'MjY0IC0gY29yZSAxNjQgcjMxMDggLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAw' +
    'My0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9' +
    'MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0x' +
    'IHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxp' +
    'cz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zm' +
    'c2V0PS0yIHRocmVhZHM9MiBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBk' +
    'ZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBi' +
    'ZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBv' +
    'cGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50' +
    'cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9' +
    'MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAn' +
    'ZYiEADv//uOr+BTYUFR0TMUo/oW0Y0/PFI9NhQ0tOdQEs6ivQHeBAAAACkGaJGxDv/6pnTQAAAAIQZ5C' +
    'eIX/CbkAAAAIAZ5hdEK/DDgAAAAIAZ5jakK/DDkAAAAQQZpoSahBaJlMCHf//qmdNQAAAApBnoZFESwv' +
    '/wm5AAAACAGepXRCvww5AAAACAGep2pCvww4AAAAEEGarEmoQWyZTAh3//6pnTQAAAAKQZ7KRRUsL/8J' +
    'uQAAAAgBnul0Qr8MOAAAAAgBnutqQr8MOAAAABBBmvBJqEFsmUwIb//+p4+JAAAACkGfDkUVLC//CbkA' +
    'AAAIAZ8tdEK/DDkAAAAIAZ8vakK/DDgAAAAQQZs0SahBbJlMCGf//p4t8AAAAApBn1JFFSwv/wm5AAAA' +
    'CAGfcXRCvww4AAAACAGfc2pCvww4AAAAEEGbeEmoQWyZTAhX//44jcEAAAAKQZ+WRRUsL/8JuAAAAAgB' +
    'n7V0Qr8MOQAAAAgBn7dqQr8MOQ==',
    'base64'
);

// Truncated video holding valid ftyp container header box (first 32 bytes)
const TRUNCATED_MP4_BUFFER = VALID_MP4_BUFFER.subarray(0, 32);

const EXECUTABLE_PE_BUFFER = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const SCRIPT_BUFFER = Buffer.from('#!/bin/bash\necho "malicious"\n');
const SVG_BUFFER = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function createMockPool({ shouldFailInsert = false } = {}) {
    const insertedRows = [];
    const query = async (sql, params = []) => {
        if (/INSERT INTO nexus_tv\.content/i.test(sql)) {
            if (shouldFailInsert) {
                throw new Error('DATABASE_CONNECTION_LOST');
            }
            const record = {
                id: insertedRows.length + 1,
                title: params[0],
                description: params[1],
                source_url: params[2],
                source_type: 'local_file',
                content_type: /'image'/.test(sql) ? 'image' : 'video',
                duration_seconds: params[3]
            };
            insertedRows.push(record);
            return { rows: [record], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    };

    return {
        insertedRows,
        query
    };
}

async function createMediaHarness({
    mockPoolOpts = {},
    ffprobeDuration = 42,
    ffprobeFails = false,
    uploadLimits = null,
    imageDecoderFn = null,
    videoDecoderFn = null,
    videoDecoderOptions = null
} = {}) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-media-test-'));
    const pool = createMockPool(mockPoolOpts);

    const app = express();
    app.use(express.json());

    // Inject isolated test configuration
    app.locals.mediaDirectory = tempDir;
    app.locals.dbPool = pool;
    if (uploadLimits) {
        app.locals.uploadLimits = uploadLimits;
    }
    app.locals.ffprobeFn = (filePath, cb) => {
        if (ffprobeFails) {
            return cb(new Error('ffprobe execution failed: invalid stream'));
        }
        cb(null, {
            format: {
                duration: ffprobeDuration
            },
            streams: [
                { codec_type: 'video', width: 64, height: 64 }
            ]
        });
    };
    app.locals.imageDecoderFn = imageDecoderFn;
    app.locals.videoDecoderFn = videoDecoderFn || (() => Promise.resolve(true));
    if (videoDecoderOptions) {
        app.locals.videoDecoderOptions = videoDecoderOptions;
    }

    app.use('/api/tv-content', authMiddleware, mediaRouter);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const adminToken = jwt.sign({ id: 1, username: 'admin_test', role: 'admin' }, jwtSecret, { expiresIn: '5m' });

    async function uploadFile({ buffer, filename, mimeType, title = 'Test' }) {
        const formData = new FormData();
        formData.append('mediaFile', new Blob([buffer], { type: mimeType }), filename);
        formData.append('title', title);

        const response = await fetch(`${baseUrl}/api/tv-content/upload`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${adminToken}`
            },
            body: formData
        });
        const status = response.status;
        let data;
        try {
            data = await response.json();
        } catch {
            data = null;
        }
        return { status, data };
    }

    function countFilesInTempDir() {
        return fs.readdirSync(tempDir);
    }

    async function close() {
        await new Promise((resolve) => server.close(resolve));
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    }

    return {
        baseUrl,
        tempDir,
        pool,
        uploadFile,
        countFilesInTempDir,
        close
    };
}

// ── AUD-004 Scenarios ────────────────────────────────────────────────────────

test('AUD-004.1: Archivos de imagen válidos y decodificables de todas las familias soportadas', async (t) => {
    const h = await createMediaHarness();
    t.after(() => h.close());

    // 1. PNG completamente válido
    const pngRes = await h.uploadFile({
        buffer: VALID_PNG_BUFFER,
        filename: 'banner.png',
        mimeType: 'image/png',
        title: 'Banner PNG'
    });
    assert.equal(pngRes.status, 201);
    assert.equal(pngRes.data.content.content_type, 'image');

    // 2. JPEG completamente válido
    const jpgRes = await h.uploadFile({
        buffer: VALID_JPEG_BUFFER,
        filename: 'poster.jpg',
        mimeType: 'image/jpeg',
        title: 'Poster JPEG'
    });
    assert.equal(jpgRes.status, 201);
    assert.equal(jpgRes.data.content.content_type, 'image');

    // 3. GIF completamente válido
    const gifRes = await h.uploadFile({
        buffer: VALID_GIF_BUFFER,
        filename: 'clip.gif',
        mimeType: 'image/gif',
        title: 'Animacion GIF'
    });
    assert.equal(gifRes.status, 201);
    assert.equal(gifRes.data.content.content_type, 'image');

    // 4. WebP completamente válido
    const webpRes = await h.uploadFile({
        buffer: VALID_WEBP_BUFFER,
        filename: 'hero.webp',
        mimeType: 'image/webp',
        title: 'Hero WebP'
    });
    assert.equal(webpRes.status, 201);
    assert.equal(webpRes.data.content.content_type, 'image');

    assert.equal(h.pool.insertedRows.length, 4);
    assert.equal(h.countFilesInTempDir().length, 4);
});

test('AUD-004.1b: Imágenes que inician con firma válida pero están truncadas o malformadas', async (t) => {
    const h = await createMediaHarness();
    t.after(() => h.close());

    // 1. PNG truncado (firma válida pero sin IDAT/IEND o cortado)
    const pngTrunc = await h.uploadFile({
        buffer: TRUNCATED_PNG_BUFFER,
        filename: 'truncated.png',
        mimeType: 'image/png'
    });
    assert.equal(pngTrunc.status, 400);
    assert.equal(pngTrunc.data.code, 'IMAGE_CORRUPTED_OR_TRUNCATED');

    // 2. JPEG truncado (SOI presente pero sin SOF/SOS/EOI)
    const jpgTrunc = await h.uploadFile({
        buffer: TRUNCATED_JPEG_BUFFER,
        filename: 'truncated.jpg',
        mimeType: 'image/jpeg'
    });
    assert.equal(jpgTrunc.status, 400);
    assert.equal(jpgTrunc.data.code, 'IMAGE_CORRUPTED_OR_TRUNCATED');

    // 3. GIF truncado (cabecera presente pero sin trailer o bloques incompletos)
    const gifTrunc = await h.uploadFile({
        buffer: TRUNCATED_GIF_BUFFER,
        filename: 'truncated.gif',
        mimeType: 'image/gif'
    });
    assert.equal(gifTrunc.status, 400);
    assert.equal(gifTrunc.data.code, 'IMAGE_CORRUPTED_OR_TRUNCATED');

    // 4. WebP truncado (RIFF presente pero bloque cortado)
    const webpTrunc = await h.uploadFile({
        buffer: TRUNCATED_WEBP_BUFFER,
        filename: 'truncated.webp',
        mimeType: 'image/webp'
    });
    assert.equal(webpTrunc.status, 400);
    assert.equal(webpTrunc.data.code, 'IMAGE_CORRUPTED_OR_TRUNCATED');

    assert.equal(h.pool.insertedRows.length, 0, 'No records should be in DB');
    assert.equal(h.countFilesInTempDir().length, 0, 'No orphaned files in storage');
});

test('AUD-004.1c: Imágenes con firmas y cabeceras válidas pero contenido interno corrupto son rechazadas', async (t) => {
    // Harness with simulated image decoder for deep payload validation
    const h = await createMediaHarness({
        imageDecoderFn: async (filePath) => {
            const buf = fs.readFileSync(filePath);
            // Simulate deep decoder detecting corrupt JPEG scan or corrupt WebP payload
            if (buf.subarray(0, 2).equals(Buffer.from([0xFF, 0xD8]))) {
                if (buf.includes(Buffer.from([0xAA, 0xBB, 0xCC, 0xDD]))) {
                    throw new Error('DECODE_CORRUPT: JPEG scan data invalid');
                }
            }
            if (buf.subarray(0, 4).toString('ascii') === 'RIFF') {
                if (buf.includes(Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]))) {
                    throw new Error('DECODE_CORRUPT: WebP VP8 bitstream invalid');
                }
            }
        }
    });
    t.after(() => h.close());

    // 1. PNG con IDAT corrupto (zlib inflate falla internamente)
    const pngBadIdat = await h.uploadFile({
        buffer: CORRUPT_IDAT_PNG_BUFFER,
        filename: 'bad_idat.png',
        mimeType: 'image/png'
    });
    assert.equal(pngBadIdat.status, 400);
    assert.equal(pngBadIdat.data.code, 'IMAGE_CORRUPTED_OR_TRUNCATED');

    // 2. GIF con sub-bloques LZW corruptos (validateGifLzw falla internamente)
    const gifBadLzw = await h.uploadFile({
        buffer: CORRUPT_LZW_GIF_BUFFER,
        filename: 'bad_lzw.gif',
        mimeType: 'image/gif'
    });
    assert.equal(gifBadLzw.status, 400);
    assert.equal(gifBadLzw.data.code, 'IMAGE_CORRUPTED_OR_TRUNCATED');

    // 3. JPEG con marcadores SOS válidos pero datos de escaneo corruptos
    const jpgBadScan = await h.uploadFile({
        buffer: CORRUPT_SCAN_JPEG_BUFFER,
        filename: 'bad_scan.jpg',
        mimeType: 'image/jpeg'
    });
    assert.equal(jpgBadScan.status, 400);
    assert.equal(jpgBadScan.data.code, 'IMAGE_CORRUPTED_OR_TRUNCATED');

    // 4. WebP con cabecera válida pero bitstream VP8 corrupto
    const webpBadPayload = await h.uploadFile({
        buffer: CORRUPT_PAYLOAD_WEBP_BUFFER,
        filename: 'bad_payload.webp',
        mimeType: 'image/webp'
    });
    assert.equal(webpBadPayload.status, 400);
    assert.equal(webpBadPayload.data.code, 'IMAGE_CORRUPTED_OR_TRUNCATED');

    assert.equal(h.pool.insertedRows.length, 0, 'No corrupt images in DB');
    assert.equal(h.countFilesInTempDir().length, 0, 'Zero orphan files remaining');
});

test('AUD-004.2: Archivo de vídeo válido cuyo formato esté permitido', async (t) => {
    const h = await createMediaHarness({ ffprobeDuration: 15 });
    t.after(() => h.close());

    const result = await h.uploadFile({
        buffer: VALID_MP4_BUFFER,
        filename: 'commercial.mp4',
        mimeType: 'video/mp4',
        title: 'Spot Corporativo'
    });

    assert.equal(result.status, 201);
    assert.equal(result.data.success, true);
    assert.equal(result.data.content.content_type, 'video');
    assert.equal(result.data.content.source_type, 'local_file');
    assert.equal(result.data.content.duration_seconds, 15);
    assert.equal(h.pool.insertedRows.length, 1);

    const files = h.countFilesInTempDir();
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9a-f-]{36}\.mp4$/);
});

test('AUD-004.2b: Archivo de vídeo truncado que contiene firma de contenedor válida', async (t) => {
    // Probe fails because container is cut off after ftyp box with no video streams
    const h = await createMediaHarness({ ffprobeFails: true });
    t.after(() => h.close());

    const result = await h.uploadFile({
        buffer: TRUNCATED_MP4_BUFFER,
        filename: 'truncated_video.mp4',
        mimeType: 'video/mp4',
        title: 'Video Cortado'
    });

    assert.equal(result.status, 400);
    assert.equal(result.data.success, false);
    assert.equal(result.data.code, 'VIDEO_PROBE_FAILED');
    assert.equal(h.pool.insertedRows.length, 0);
    assert.equal(h.countFilesInTempDir().length, 0, 'Truncated video file must be unlinked');
});

test('AUD-004.2c: Timeout o fallo de procesamiento de vídeo limpia archivos temporales', async (t) => {
    // Harness with simulated hanging ffprobe and 100ms timeout threshold
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-timeout-test-'));
    const pool = createMockPool();
    const app = express();
    app.use(express.json());
    app.locals.mediaDirectory = tempDir;
    app.locals.dbPool = pool;
    app.locals.ffprobeOptions = { timeoutMs: 80 };
    // Simulated hanging ffprobe
    app.locals.ffprobeFn = (_filePath, _cb) => {
        // Intentionally never call cb to trigger timeout
    };
    app.use('/api/tv-content', authMiddleware, mediaRouter);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const adminToken = jwt.sign({ id: 1, username: 'admin_test', role: 'admin' }, jwtSecret, { expiresIn: '5m' });

    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    });

    const formData = new FormData();
    formData.append('mediaFile', new Blob([VALID_MP4_BUFFER], { type: 'video/mp4' }), 'hang.mp4');
    formData.append('title', 'Hang Video');

    const response = await fetch(`${baseUrl}/api/tv-content/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: formData
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, 'VIDEO_PROBE_TIMEOUT');
    assert.equal(pool.insertedRows.length, 0);
});

test('AUD-004.2d: Vídeo con contenedor válido pero stream de vídeo corrupto es rechazado', async (t) => {
    // Injected video decoder detecting corrupt stream packets
    const h = await createMediaHarness({
        ffprobeDuration: 10,
        videoDecoderFn: async () => {
            const err = new Error('DECODE_CORRUPT: Invalid NAL unit size or broken stream');
            err.code = 'MEDIA_DECODE_CORRUPT';
            throw err;
        }
    });
    t.after(() => h.close());

    const result = await h.uploadFile({
        buffer: VALID_MP4_BUFFER,
        filename: 'broken_stream.mp4',
        mimeType: 'video/mp4',
        title: 'Corrupt Stream Video'
    });

    assert.equal(result.status, 400);
    assert.equal(result.data.success, false);
    assert.equal(result.data.code, 'VIDEO_STREAM_CORRUPT');
    assert.equal(h.pool.insertedRows.length, 0, 'No database record inserted for corrupt stream');
    assert.equal(h.countFilesInTempDir().length, 0, 'Physical file unlinked after stream decode error');
});

test('AUD-004.2e: Timeout del decodificador de vídeo limpia los recursos temporales', async (t) => {
    // Injected video decoder timing out
    const h = await createMediaHarness({
        ffprobeDuration: 10,
        videoDecoderFn: async () => {
            const err = new Error('MEDIA_DECODE_TIMEOUT: Decoder exceeded 5000ms');
            err.code = 'MEDIA_DECODE_TIMEOUT';
            throw err;
        }
    });
    t.after(() => h.close());

    const result = await h.uploadFile({
        buffer: VALID_MP4_BUFFER,
        filename: 'timeout_stream.mp4',
        mimeType: 'video/mp4',
        title: 'Timeout Stream Video'
    });

    assert.equal(result.status, 400);
    assert.equal(result.data.success, false);
    assert.equal(result.data.code, 'VIDEO_DECODE_TIMEOUT');
    assert.equal(h.pool.insertedRows.length, 0);
    assert.equal(h.countFilesInTempDir().length, 0, 'Temporary file unlinked after video decode timeout');
});

test('AUD-004.3: Archivo ejecutable o script disfrazado con una extensión permitida', async (t) => {
    const h = await createMediaHarness();
    t.after(() => h.close());

    // Executable PE masqueraded as JPG
    const peResult = await h.uploadFile({
        buffer: EXECUTABLE_PE_BUFFER,
        filename: 'trojan.jpg',
        mimeType: 'image/jpeg'
    });
    assert.equal(peResult.status, 400);
    assert.equal(peResult.data.success, false);
    assert.equal(peResult.data.code, 'DANGEROUS_FILE_SIGNATURE');
    assert.equal(h.countFilesInTempDir().length, 0, 'No orphaned file after PE rejection');

    // Bash script masqueraded as PNG
    const scriptResult = await h.uploadFile({
        buffer: SCRIPT_BUFFER,
        filename: 'exploit.png',
        mimeType: 'image/png'
    });
    assert.equal(scriptResult.status, 400);
    assert.equal(scriptResult.data.success, false);
    assert.equal(scriptResult.data.code, 'DANGEROUS_FILE_SIGNATURE');
    assert.equal(h.countFilesInTempDir().length, 0, 'No orphaned file after script rejection');

    // Dangerous SVG rejected by policy
    const svgResult = await h.uploadFile({
        buffer: SVG_BUFFER,
        filename: 'xss.png',
        mimeType: 'image/png'
    });
    assert.equal(svgResult.status, 400);
    assert.equal(svgResult.data.success, false);
    assert.equal(h.countFilesInTempDir().length, 0, 'No orphaned file after SVG rejection');
    assert.equal(h.pool.insertedRows.length, 0);
});

test('AUD-004.4: MIME declarado que contradiga la firma real', async (t) => {
    const h = await createMediaHarness();
    t.after(() => h.close());

    // PNG buffer declared as video/mp4
    const result = await h.uploadFile({
        buffer: VALID_PNG_BUFFER,
        filename: 'picture.png',
        mimeType: 'video/mp4'
    });

    assert.equal(result.status, 400);
    assert.equal(result.data.success, false);
    assert.equal(result.data.code, 'MEDIA_MIME_MISMATCH');
    assert.equal(h.countFilesInTempDir().length, 0, 'Orphaned file cleaned up');
    assert.equal(h.pool.insertedRows.length, 0);
});

test('AUD-004.5: Firma válida con extensión no permitida o contradictoria', async (t) => {
    const h = await createMediaHarness();
    t.after(() => h.close());

    // PNG signature with .mp4 extension
    const result = await h.uploadFile({
        buffer: VALID_PNG_BUFFER,
        filename: 'picture.mp4',
        mimeType: 'image/png'
    });

    assert.equal(result.status, 400);
    assert.equal(result.data.success, false);
    assert.equal(result.data.code, 'MEDIA_EXTENSION_MISMATCH');
    assert.equal(h.countFilesInTempDir().length, 0, 'Orphaned file cleaned up');
    assert.equal(h.pool.insertedRows.length, 0);
});

test('AUD-004.6: Vídeo corrupto o fallo de ffprobe', async (t) => {
    // ffprobe returns error
    const h = await createMediaHarness({ ffprobeFails: true });
    t.after(() => h.close());

    const result = await h.uploadFile({
        buffer: VALID_MP4_BUFFER,
        filename: 'corrupted.mp4',
        mimeType: 'video/mp4'
    });

    assert.equal(result.status, 400);
    assert.equal(result.data.success, false);
    assert.equal(result.data.code, 'VIDEO_PROBE_FAILED');
    assert.equal(h.countFilesInTempDir().length, 0, 'Orphaned file cleaned up on probe error');
    assert.equal(h.pool.insertedRows.length, 0, 'No database record inserted');
});

test('AUD-004.7: Rechazo por exceso de tamaño sin fixtures gigantes', async (t) => {
    // Set 1KB upload limit for deterministic test
    const h = await createMediaHarness({ uploadLimits: { fileSize: 1024 } });
    t.after(() => h.close());

    const oversizedBuffer = Buffer.alloc(2048, 0x41);
    const result = await h.uploadFile({
        buffer: oversizedBuffer,
        filename: 'huge.jpg',
        mimeType: 'image/jpeg'
    });

    assert.equal(result.status, 400);
    assert.equal(result.data.success, false);
    assert.match(result.data.message, /tamaño máximo/i);
    assert.equal(h.countFilesInTempDir().length, 0);
    assert.equal(h.pool.insertedRows.length, 0);
});

test('AUD-004.8: Fallo de inserción en base de datos después de crear el archivo', async (t) => {
    const h = await createMediaHarness({ mockPoolOpts: { shouldFailInsert: true } });
    t.after(() => h.close());

    const result = await h.uploadFile({
        buffer: VALID_PNG_BUFFER,
        filename: 'valid.png',
        mimeType: 'image/png'
    });

    assert.equal(result.status, 500);
    assert.equal(result.data.success, false);
    assert.equal(h.countFilesInTempDir().length, 0, 'Physical file must be deleted upon DB failure');
});

test('AUD-004.9: Ausencia total de archivos huérfanos cuando falla cualquier paso', async (t) => {
    const h = await createMediaHarness();
    t.after(() => h.close());

    // 1. Upload garbage
    await h.uploadFile({
        buffer: Buffer.from('not an image or video'),
        filename: 'bad.png',
        mimeType: 'image/png'
    });

    // 2. Upload dangerous PE
    await h.uploadFile({
        buffer: EXECUTABLE_PE_BUFFER,
        filename: 'bad.jpg',
        mimeType: 'image/jpeg'
    });

    // 3. Upload mismatch
    await h.uploadFile({
        buffer: VALID_PNG_BUFFER,
        filename: 'bad.mp4',
        mimeType: 'image/png'
    });

    assert.equal(h.countFilesInTempDir().length, 0, 'Temp storage directory remains completely clean');
});
