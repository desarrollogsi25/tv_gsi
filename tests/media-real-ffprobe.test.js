process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ffmpeg = require('fluent-ffmpeg');
const { probeVideoDuration } = require('../src/utils/mediaValidator');

// Real 1-second synthetic MP4 video (h264, 64x64, 25fps, 1.0s duration)
const VALID_SYNTHETIC_MP4_B64 = Buffer.from(
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

function hasSystemFfprobe() {
    try {
        const check = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' });
        return check.status === 0;
    } catch {
        return false;
    }
}

function hasSystemFfmpeg() {
    try {
        const check = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        return check.status === 0;
    } catch {
        return false;
    }
}

test('AUD-004 REAL EXEC: Verificación del ejecutable real ffprobe en entorno con runtime soportado', async (t) => {
    if (!hasSystemFfprobe()) {
        t.skip('ffprobe no disponible en este host; la verificación del binario real se ejecuta dentro del contenedor Docker con runtime Node 24 + ffmpeg');
        return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-real-probe-'));
    const validFile = path.join(tempDir, 'valid.mp4');
    const truncFile = path.join(tempDir, 'trunc.mp4');

    fs.writeFileSync(validFile, VALID_SYNTHETIC_MP4_B64);
    fs.writeFileSync(truncFile, VALID_SYNTHETIC_MP4_B64.subarray(0, 32));

    t.after(() => {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    });

    // 1. Probar video valido sintético con el ffprobe REAL
    const duration = await probeVideoDuration(validFile, ffmpeg.ffprobe);
    assert.equal(duration, 1, 'El ejecutable real ffprobe debe identificar 1s en el video sintético');

    // 2. Probar video truncado (solo caja ftyp inicial) con el ffprobe REAL
    let truncRejected = false;
    try {
        await probeVideoDuration(truncFile, ffmpeg.ffprobe);
    } catch (err) {
        truncRejected = true;
        assert.match(err.message, /ffprobe|duración|stream/i);
    }
    assert.equal(truncRejected, true, 'El ejecutable real ffprobe debe fallar ante un video MP4 truncado sin moov');
});

test('AUD-004 REAL DECODE: Verificación de decodificación real con ffmpeg sobre imágenes y vídeo', async (t) => {
    if (!hasSystemFfmpeg()) {
        t.skip('ffmpeg no disponible en este host; la decodificación real se ejecuta en el contenedor Docker oficial con runtime Node 24 + ffmpeg');
        return;
    }

    const { decodeMediaContent, decodeVideoSample } = require('../src/utils/mediaValidator');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-real-decode-'));

    t.after(() => {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    });

    // 1. Decodificar video sintético real válido
    const validVideoFile = path.join(tempDir, 'real_valid.mp4');
    fs.writeFileSync(validVideoFile, VALID_SYNTHETIC_MP4_B64);
    const videoOk = await decodeVideoSample(validVideoFile);
    assert.equal(videoOk, true, 'El decodificador real ffmpeg debe procesar el flujo del video sintético válido');

    // 2. Decodificar imagen JPEG válida
    const validJpgFile = path.join(tempDir, 'real_valid.jpg');
    fs.writeFileSync(validJpgFile, Buffer.from(
        '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAABAAEDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z',
        'base64'
    ));
    const jpgOk = await decodeMediaContent(validJpgFile, false);
    assert.equal(jpgOk, true, 'El decodificador real ffmpeg debe procesar la imagen JPEG válida');

    // 3. Rechazar JPEG con scan data corrupto
    const corruptJpgFile = path.join(tempDir, 'real_corrupt.jpg');
    fs.writeFileSync(corruptJpgFile, Buffer.from([
        0xFF, 0xD8,
        0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
        0xFF, 0xDB, 0x00, 0x43, 0x00, ...new Array(64).fill(1),
        0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x0A, 0x00, 0x0A, 0x01, 0x01, 0x11, 0x00,
        0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,
        0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
        0xFF, 0xFF, 0xAA, 0xBB, 0xCC, 0xDD,
        0xFF, 0xD9
    ]));
    let jpgCorruptRejected = false;
    try {
        await decodeMediaContent(corruptJpgFile, false);
    } catch (err) {
        jpgCorruptRejected = true;
        assert.match(err.message, /DECODE|error|corrupt/i);
    }
    assert.equal(jpgCorruptRejected, true, 'El decodificador real debe rechazar JPEG con escaneo corrupto');

    // 4. Decodificar imagen WebP sintética válida
    const validWebpFile = path.join(tempDir, 'real_valid.webp');
    const VALID_WEBP_BUFFER = Buffer.from(
        'UklGRjgAAABXRUJQVlA4ICwAAADQAQCdASoBAAEAAgA0JaACdLoB+AADsAD+8Oj3/yC5YXXI1/5sCua5+agAAA==',
        'base64'
    );
    fs.writeFileSync(validWebpFile, VALID_WEBP_BUFFER);
    const webpOk = await decodeMediaContent(validWebpFile, false);
    assert.equal(webpOk, true, 'El decodificador real ffmpeg debe procesar la imagen WebP válida');

    // 5. Rechazar WebP con cabecera válida pero payload VP8 corrupto
    const corruptWebpFile = path.join(tempDir, 'real_corrupt.webp');
    fs.writeFileSync(corruptWebpFile, Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
        0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x9D, 0x01, 0x2A, 0x02, 0x00, 0x02, 0x00,
        0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD
    ]));
    let webpCorruptRejected = false;
    try {
        await decodeMediaContent(corruptWebpFile, false);
    } catch (err) {
        webpCorruptRejected = true;
        assert.match(err.message, /DECODE|error|corrupt/i);
    }
    assert.equal(webpCorruptRejected, true, 'El decodificador real debe rechazar WebP con payload corrupto');

    // 6. Rechazar WebP truncado
    const truncWebpFile = path.join(tempDir, 'real_trunc.webp');
    fs.writeFileSync(truncWebpFile, VALID_WEBP_BUFFER.subarray(0, 18));
    let webpTruncRejected = false;
    try {
        await decodeMediaContent(truncWebpFile, false);
    } catch (err) {
        webpTruncRejected = true;
        assert.match(err.message, /DECODE|error|corrupt/i);
    }
    assert.equal(webpTruncRejected, true, 'El decodificador real debe rechazar WebP truncado');
});

test('AUD-004 REAL ROUTE: Rechazo en ruta HTTP /upload con decodificador real y limpieza en disco', async (t) => {
    if (!hasSystemFfmpeg()) {
        t.skip('ffmpeg no disponible en este host; validación ejecutada en contenedor Docker');
        return;
    }

    const express = require('express');
    const http = require('node:http');
    const jwt = require('jsonwebtoken');
    const jwtSecret = require('../src/config/jwt');
    const authMiddleware = require('../src/middlewares/auth');
    const { router: mediaRouter } = require('../src/routes/media');

    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-real-route-'));
    t.after(() => {
        try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch {}
    });

    // Mock pool para verificar que NO se inserta nada
    let dbInserts = 0;
    const mockPool = {
        query: async (sql, params) => {
            if (/INSERT INTO nexus_tv\.content/i.test(sql)) {
                dbInserts++;
                return { rows: [{ id: 999, title: params[0] }] };
            }
            return { rows: [], rowCount: 0 };
        }
    };

    const app = express();
    app.locals.mediaDirectory = uploadDir;
    app.locals.dbPool = mockPool;
    app.use('/api/tv-content', authMiddleware, mediaRouter);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ id: 1, username: 'admin_test', role: 'admin' }, jwtSecret, { expiresIn: '5m' });

    // Subir WebP corrupto
    const corruptWebpBuf = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
        0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x9D, 0x01, 0x2A, 0x02, 0x00, 0x02, 0x00,
        0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD
    ]);

    const formData = new FormData();
    formData.append('mediaFile', new Blob([corruptWebpBuf], { type: 'image/webp' }), 'corrupt.webp');
    formData.append('title', 'Corrupt WebP');

    const res = await fetch(`${baseUrl}/api/tv-content/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
    });

    assert.equal(res.status, 400, 'Ruta debe rechazar archivo con datos de imagen corruptos con HTTP 400');
    assert.equal(dbInserts, 0, 'No debe registrarse fila en base de datos');
    const remainingFiles = fs.readdirSync(uploadDir);
    assert.equal(remainingFiles.length, 0, 'Archivo temporal debe eliminarse de disco (cero huérfanos)');
});

