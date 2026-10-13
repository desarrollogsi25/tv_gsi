// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Secure Media Content Validator (AUD-004)
// Magic bytes signature inspection, strict allowlist & video probe
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const ffmpeg = require('fluent-ffmpeg');
const cp = require('child_process');

const ALLOWED_MIME_TO_EXT = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
    'video/mp4': ['.mp4', '.m4v'],
    'video/quicktime': ['.mov'],
    'video/webm': ['.webm'],
    'video/x-matroska': ['.mkv']
};

const DANGEROUS_PREFIXES = [
    Buffer.from([0x4D, 0x5A]), // Windows PE (EXE / DLL / SYS)
    Buffer.from([0x7F, 0x45, 0x4C, 0x46]), // Linux ELF executable
    Buffer.from('#!'), // Unix shell script
    Buffer.from('<?php'), // PHP script
    Buffer.from('PK\x03\x04'), // ZIP / JAR / APK
    Buffer.from('7z\xBC\xAF\x27\x1C'), // 7-Zip
    Buffer.from('Rar!\x1A\x07') // RAR archive
];

/**
 * Inspects binary magic bytes to determine the true content type.
 */
async function detectFileSignature(filePath) {
    let fd;
    try {
        fd = await fs.promises.open(filePath, 'r');
        const buffer = Buffer.alloc(256);
        const { bytesRead } = await fd.read(buffer, 0, 256, 0);

        if (bytesRead < 4) return null;

        // 1. Explicitly check for known dangerous executable / script headers
        for (const prefix of DANGEROUS_PREFIXES) {
            if (bytesRead >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix)) {
                return { dangerous: true };
            }
        }

        // 2. Prohibit SVG, HTML, XML (no SVG allowed per policy)
        const sampleText = buffer.subarray(0, Math.min(bytesRead, 128)).toString('utf8').toLowerCase();
        if (sampleText.includes('<svg') || sampleText.includes('<?xml') || sampleText.includes('<html') || sampleText.includes('<script')) {
            return { dangerous: true };
        }

        // 3. Image signatures
        // JPEG: FF D8 FF
        if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
            return { mime: 'image/jpeg', type: 'image' };
        }

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (bytesRead >= 8 &&
            buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
            buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
            return { mime: 'image/png', type: 'image' };
        }

        // GIF: GIF87a or GIF89a
        if (bytesRead >= 6) {
            const gifSig = buffer.subarray(0, 6).toString('ascii');
            if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
                return { mime: 'image/gif', type: 'image' };
            }
        }

        // WebP: RIFF at offset 0, WEBP at offset 8
        if (bytesRead >= 12 &&
            buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
            buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
            return { mime: 'image/webp', type: 'image' };
        }

        // 4. Video signatures
        // WebM / Matroska: EBML header (1A 45 DF A3)
        if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
            const ebmlStr = buffer.subarray(0, bytesRead).toString('latin1');
            if (ebmlStr.includes('webm')) {
                return { mime: 'video/webm', type: 'video' };
            }
            return { mime: 'video/x-matroska', type: 'video' };
        }

        // MP4 / MOV / M4V (ISO Base Media File Format: offset 4 'ftyp' or 'moov' / 'mdat')
        if (bytesRead >= 8) {
            const boxType = buffer.subarray(4, 8).toString('ascii');
            if (boxType === 'ftyp') {
                const majorBrand = bytesRead >= 12 ? buffer.subarray(8, 12).toString('ascii').trim() : '';
                if (majorBrand.startsWith('qt')) {
                    return { mime: 'video/quicktime', type: 'video' };
                }
                return { mime: 'video/mp4', type: 'video' };
            }
            if (['moov', 'mdat', 'wide'].includes(boxType)) {
                return { mime: 'video/quicktime', type: 'video' };
            }
        }

        return null;
    } catch {
        return null;
    } finally {
        if (fd) await fd.close().catch(() => {});
    }
}

/**
 * Parses and verifies the structural integrity of PNG files beyond magic bytes.
 * Requires valid IHDR with non-zero dimensions, consistent chunk CRCs,
 * at least one IDAT chunk with decompressible deflate stream, and IEND.
 */
function validatePngBuffer(buf) {
    if (buf.length < 8) return false;
    if (buf.readUInt32BE(0) !== 0x89504E47 || buf.readUInt32BE(4) !== 0x0D0A1A0A) return false;

    let offset = 8;
    let hasIhdr = false;
    let hasIdat = false;
    let hasIend = false;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks = [];

    while (offset < buf.length) {
        if (offset + 8 > buf.length) return false;
        const len = buf.readUInt32BE(offset);
        const type = buf.toString('ascii', offset + 4, offset + 8);
        if (offset + 8 + len + 4 > buf.length) return false; // Truncated chunk

        const chunkData = buf.subarray(offset + 8, offset + 8 + len);
        const crc = buf.readUInt32BE(offset + 8 + len);
        const calcCrc = (zlib.crc32(buf.subarray(offset + 4, offset + 8 + len))) >>> 0;
        if (crc !== calcCrc) return false;

        if (offset === 8) {
            if (type !== 'IHDR' || len < 13) return false;
            width = chunkData.readUInt32BE(0);
            height = chunkData.readUInt32BE(4);
            bitDepth = chunkData[8];
            colorType = chunkData[9];
            if (width === 0 || height === 0) return false;
            hasIhdr = true;
        }
        if (type === 'IDAT') {
            hasIdat = true;
            idatChunks.push(chunkData);
        }
        if (type === 'IEND') {
            hasIend = true;
            break;
        }
        offset += 8 + len + 4;
    }

    if (!hasIhdr || !hasIdat || !hasIend) return false;

    try {
        const fullIdat = Buffer.concat(idatChunks);
        const uncompressed = zlib.inflateSync(fullIdat);

        // Calculate expected uncompressed raster scanlines
        let channels = 1;
        if (colorType === 2) channels = 3; // RGB
        else if (colorType === 4) channels = 2; // Gray + Alpha
        else if (colorType === 6) channels = 4; // RGBA
        else if (colorType === 0 || colorType === 3) channels = 1; // Grayscale or Palette

        const bytesPerLine = Math.ceil((width * channels * bitDepth) / 8);
        const expectedTotal = height * (1 + bytesPerLine);
        if (uncompressed.length !== expectedTotal) {
            return false;
        }

        // Validate that filter bytes of all scanlines are valid PNG filters [0..4]
        const stride = 1 + bytesPerLine;
        for (let row = 0; row < height; row++) {
            const filterType = uncompressed[row * stride];
            if (filterType > 4) return false;
        }
    } catch {
        return false;
    }
    return true;
}

/**
 * Validates the LZW bitstream of a GIF image sub-block chain without external dependencies.
 * Verifies variable-length code sizes, table resets, boundary codes, and EOI marker.
 */
function validateGifLzw(subblocksBuffer, minCodeSize, expectedPixels = 1) {
    if (minCodeSize < 2 || minCodeSize > 8) return false;
    let clearCode = 1 << minCodeSize;
    let eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let maxTable = 1 << codeSize;
    let nextCode = eoiCode + 1;

    let bitPos = 0;
    const totalBits = subblocksBuffer.length * 8;

    function readCode() {
        if (bitPos + codeSize > totalBits) {
            if (bitPos < totalBits) {
                let remaining = totalBits - bitPos;
                let bytePos = Math.floor(bitPos / 8);
                let bitOffset = bitPos % 8;
                let raw = (subblocksBuffer[bytePos] || 0) | ((subblocksBuffer[bytePos + 1] || 0) << 8);
                let code = (raw >> bitOffset) & ((1 << remaining) - 1);
                bitPos = totalBits;
                return code;
            }
            return -1;
        }
        let bytePos = Math.floor(bitPos / 8);
        let bitOffset = bitPos % 8;
        let raw = (subblocksBuffer[bytePos] || 0) |
            ((subblocksBuffer[bytePos + 1] || 0) << 8) |
            ((subblocksBuffer[bytePos + 2] || 0) << 16);
        let code = (raw >> bitOffset) & ((1 << codeSize) - 1);
        bitPos += codeSize;
        return code;
    }

    let pixels = 0;
    while (bitPos < totalBits) {
        let code = readCode();
        if (code === -1) break;
        if (code === clearCode) {
            codeSize = minCodeSize + 1;
            maxTable = 1 << codeSize;
            nextCode = eoiCode + 1;
            continue;
        }
        if (code === eoiCode) {
            return true;
        }
        if (code > nextCode) {
            return false;
        }
        pixels++;
        if (pixels >= expectedPixels) {
            return true;
        }
        if (nextCode < 4096) {
            nextCode++;
            if (nextCode >= maxTable && codeSize < 12) {
                codeSize++;
                maxTable = 1 << codeSize;
            }
        }
    }
    return pixels >= expectedPixels;
}

/**
 * Parses and verifies the structural integrity of JPEG files beyond magic bytes.
 * Requires SOI, valid marker segments without truncation, SOF frame with non-zero
 * dimensions, SOS scan header, and EOI marker.
 */
function validateJpegBuffer(buf) {
    if (buf.length < 4) return false;
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return false; // SOI

    let offset = 2;
    let hasSof = false;
    let hasSos = false;
    let hasEoi = false;

    while (offset < buf.length) {
        if (buf[offset] !== 0xFF) {
            // Inside entropy-coded scan data (after SOS), search forward for next 0xFF marker
            if (hasSos) {
                while (offset < buf.length && buf[offset] !== 0xFF) {
                    offset++;
                }
                if (offset >= buf.length) break;
            } else {
                return false;
            }
        }

        while (offset < buf.length && buf[offset] === 0xFF) {
            offset++;
        }
        if (offset >= buf.length) break;

        const marker = buf[offset];
        offset++;

        // Standalone markers
        if (marker === 0xD9) { // EOI
            hasEoi = true;
            break;
        }
        if (marker === 0x00 || (marker >= 0xD0 && marker <= 0xD7)) {
            // Byte stuffing 0xFF 0x00 or restart marker
            continue;
        }

        // Markers with length
        if (offset + 2 > buf.length) return false;
        const segmentLen = buf.readUInt16BE(offset);
        if (segmentLen < 2 || offset + segmentLen > buf.length) return false;

        // SOF0 (Baseline), SOF1 (Extended), SOF2 (Progressive)
        if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
            if (segmentLen < 8) return false;
            const h = buf.readUInt16BE(offset + 3);
            const w = buf.readUInt16BE(offset + 5);
            const comps = buf[offset + 7];
            if (h === 0 || w === 0 || comps === 0) return false;
            hasSof = true;
        }

        if (marker === 0xDA) { // SOS
            hasSos = true;
            offset += segmentLen;
            continue;
        }

        offset += segmentLen;
    }

    return hasSof && hasSos && hasEoi;
}

/**
 * Parses and verifies structural integrity and LZW decompressed data of GIF files.
 */
function validateGifBuffer(buf) {
    if (buf.length < 13) return false;
    const sig = buf.toString('ascii', 0, 6);
    if (sig !== 'GIF87a' && sig !== 'GIF89a') return false;

    const w = buf.readUInt16LE(6);
    const h = buf.readUInt16LE(8);
    if (w === 0 || h === 0) return false;

    const packed = buf[10];
    let offset = 13;
    if (packed & 0x80) { // Global Color Table
        const gctSize = 3 * (1 << ((packed & 0x07) + 1));
        if (offset + gctSize > buf.length) return false;
        offset += gctSize;
    }

    let hasImage = false;
    let hasTrailer = false;

    while (offset < buf.length) {
        const blockType = buf[offset];
        if (blockType === 0x3B) { // Trailer
            hasTrailer = true;
            break;
        }
        if (blockType === 0x21) { // Extension
            offset++;
            if (offset >= buf.length) return false;
            offset++; // Skip extension label
            // Read sub-blocks
            while (offset < buf.length) {
                const subLen = buf[offset];
                offset++;
                if (subLen === 0) break;
                if (offset + subLen > buf.length) return false;
                offset += subLen;
            }
            continue;
        }
        if (blockType === 0x2C) { // Image Descriptor
            if (offset + 10 > buf.length) return false;
            const imgW = buf.readUInt16LE(offset + 5);
            const imgH = buf.readUInt16LE(offset + 7);
            if (imgW === 0 || imgH === 0) return false;
            const imgPacked = buf[offset + 9];
            offset += 10;
            if (imgPacked & 0x80) { // Local Color Table
                const lctSize = 3 * (1 << ((imgPacked & 0x07) + 1));
                if (offset + lctSize > buf.length) return false;
                offset += lctSize;
            }
            if (offset >= buf.length) return false;
            const lzwMinCodeSize = buf[offset++];
            const lzwSubblocks = [];
            // Read LZW sub-blocks
            while (offset < buf.length) {
                const subLen = buf[offset];
                offset++;
                if (subLen === 0) break;
                if (offset + subLen > buf.length) return false;
                lzwSubblocks.push(buf.subarray(offset, offset + subLen));
                offset += subLen;
            }
            const fullLzwData = Buffer.concat(lzwSubblocks);
            if (!validateGifLzw(fullLzwData, lzwMinCodeSize, imgW * imgH)) {
                return false;
            }
            hasImage = true;
            continue;
        }
        return false; // Unknown block type
    }

    return hasImage && hasTrailer;
}

/**
 * Parses and verifies the structural integrity of WebP files beyond magic bytes.
 * Validates RIFF container size, WEBP fourcc, and VP8/VP8L/VP8X chunk payloads.
 */
function validateWebpBuffer(buf) {
    if (buf.length < 20) return false;
    if (buf.toString('ascii', 0, 4) !== 'RIFF') return false;
    if (buf.toString('ascii', 8, 12) !== 'WEBP') return false;

    const fileSize = buf.readUInt32LE(4) + 8;
    if (fileSize > buf.length + 1) return false; // Truncated RIFF

    let offset = 12;
    let hasChunk = false;

    while (offset + 8 <= buf.length) {
        const fourcc = buf.toString('ascii', offset, offset + 4);
        const chunkSize = buf.readUInt32LE(offset + 4);
        offset += 8;
        if (offset + chunkSize > buf.length) return false; // Truncated chunk

        if (fourcc === 'VP8 ') {
            if (chunkSize < 10) return false;
            const tag = buf.readUInt32LE(offset) & 0x00FFFFFF;
            if ((tag & 0x01) !== 0) return false; // 0 = keyframe
            // Check start code 9D 01 2A
            if (buf[offset + 3] !== 0x9D || buf[offset + 4] !== 0x01 || buf[offset + 5] !== 0x2A) return false;
            const w = buf.readUInt16LE(offset + 6) & 0x3FFF;
            const h = buf.readUInt16LE(offset + 8) & 0x3FFF;
            if (w === 0 || h === 0) return false;
            hasChunk = true;
        } else if (fourcc === 'VP8L') {
            if (chunkSize < 5) return false;
            if (buf[offset] !== 0x2F) return false; // VP8L signature
            hasChunk = true;
        } else if (fourcc === 'VP8X') {
            if (chunkSize < 10) return false;
            const w = 1 + ((buf[offset + 4] | (buf[offset + 5] << 8) | (buf[offset + 6] << 16)));
            const h = 1 + ((buf[offset + 7] | (buf[offset + 8] << 8) | (buf[offset + 9] << 16)));
            if (w === 0 || h === 0) return false;
            hasChunk = true;
        }

        offset += chunkSize + (chunkSize & 1); // Pad byte if odd
    }

    return hasChunk;
}

/**
 * Validates structural integrity of an image file based on detected MIME.
 */
async function validateImageIntegrity(filePath, mime) {
    let buf;
    try {
        buf = await fs.promises.readFile(filePath);
    } catch {
        return false;
    }

    switch (mime) {
        case 'image/png':
            return validatePngBuffer(buf);
        case 'image/jpeg':
            return validateJpegBuffer(buf);
        case 'image/gif':
            return validateGifBuffer(buf);
        case 'image/webp':
            return validateWebpBuffer(buf);
        default:
            return false;
    }
}

/**
 * Validates that an uploaded file matches allowlisted formats, has no type/extension discrepancies,
 * possesses a valid binary signature, and has complete, decodable structural integrity.
 */
async function validateMediaFile(file) {
    if (!file || !file.path) {
        return { valid: false, code: 'FILE_MISSING', message: 'Archivo no proporcionado.' };
    }

    const ext = path.extname(file.originalname || file.filename || '').toLowerCase();
    if (!ext) {
        return { valid: false, code: 'EXTENSION_MISSING', message: 'El archivo carece de extensión.' };
    }

    const detected = await detectFileSignature(file.path);
    if (!detected) {
        return {
            valid: false,
            code: 'FORMAT_UNRECOGNIZED_OR_CORRUPTED',
            message: 'El formato o firma binaria del archivo no es válido o no está permitido.'
        };
    }

    if (detected.dangerous) {
        return {
            valid: false,
            code: 'DANGEROUS_FILE_SIGNATURE',
            message: 'El archivo contiene una firma binaria peligrosa o no permitida.'
        };
    }

    const allowedExts = ALLOWED_MIME_TO_EXT[detected.mime];
    if (!allowedExts || !allowedExts.includes(ext)) {
        return {
            valid: false,
            code: 'MEDIA_EXTENSION_MISMATCH',
            message: 'Discrepancia entre la extensión y el contenido real del archivo.'
        };
    }

    // Verify client declared mimetype against detected type
    if (file.mimetype) {
        const declaredLower = file.mimetype.toLowerCase();
        const isImage = detected.type === 'image';
        const isVideo = detected.type === 'video';

        if (isImage && !declaredLower.startsWith('image/')) {
            return { valid: false, code: 'MEDIA_MIME_MISMATCH', message: 'Discrepancia entre el tipo MIME declarado y la firma del archivo.' };
        }
        if (isVideo && !declaredLower.startsWith('video/')) {
            return { valid: false, code: 'MEDIA_MIME_MISMATCH', message: 'Discrepancia entre el tipo MIME declarado y la firma del archivo.' };
        }
    }

    // Perform deep content and structural integrity check for images
    if (detected.type === 'image') {
        const isIntegral = await validateImageIntegrity(file.path, detected.mime);
        if (!isIntegral) {
            return {
                valid: false,
                code: 'IMAGE_CORRUPTED_OR_TRUNCATED',
                message: 'El archivo de imagen está truncado, malformado o no se puede decodificar.'
            };
        }
    }

    return {
        valid: true,
        detectedMime: detected.mime,
        contentType: detected.type,
        canonicalExtension: ext
    };
}

/**
 * Extracts exact duration using ffprobe with deterministic timeout and resource boundaries.
 * Fails deterministically if ffprobe encounters an error, broken stream, missing video stream,
 * non-positive duration, or timeout.
 */
function probeVideoDuration(filePath, ffprobeFn = ffmpeg.ffprobe, options = {}) {
    const timeoutMs = options.timeoutMs ?? 5000;

    return new Promise((resolve, reject) => {
        let settled = false;
        let timer = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
        };

        timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('VIDEO_PROBE_TIMEOUT: ffprobe excedió el tiempo máximo de procesamiento.'));
        }, timeoutMs);
        if (timer.unref) timer.unref();

        try {
            ffprobeFn(filePath, (err, metadata) => {
                if (settled) return;
                settled = true;
                cleanup();

                if (err) {
                    return reject(new Error('No se pudo procesar el archivo de video con ffprobe: ' + (err.message || 'error')));
                }
                if (!metadata || !metadata.format || typeof metadata.format.duration !== 'number' || metadata.format.duration <= 0 || !Number.isFinite(metadata.format.duration)) {
                    return reject(new Error('Duración de video no válida o formato multimedia corrupto.'));
                }
                if (!metadata.streams || !Array.isArray(metadata.streams) || metadata.streams.length === 0 || !metadata.streams.some(s => s.codec_type === 'video')) {
                    return reject(new Error('El archivo no contiene streams de video válidos.'));
                }

                resolve(Math.max(1, Math.round(metadata.format.duration)));
            });
        } catch (callErr) {
            if (settled) return;
            settled = true;
            cleanup();
            reject(callErr);
        }
    });
}

/**
 * Decodes media file content using FFmpeg via execFile with strict argument separation,
 * bounded time limits, and stdout/stderr inspection for decoding errors.
 */
function decodeMediaContent(filePath, isVideo = false, options = {}) {
    const ffmpegPath = options.ffmpegPath || 'ffmpeg';
    const timeoutMs = options.timeoutMs ?? 5000;
    const maxBuffer = options.maxBuffer ?? (1024 * 1024);

    return new Promise((resolve, reject) => {
        const args = ['-v', 'error', '-err_detect', 'explode', '-xerror', '-i', filePath];
        if (isVideo) {
            // For videos, decode a sample of the initial 2 seconds to verify stream decodability
            args.push('-t', '2');
        }
        args.push('-f', 'null', '-');

        cp.execFile(ffmpegPath, args, { timeout: timeoutMs, maxBuffer }, (err, stdout, stderr) => {
            if (err) {
                const isTimeout = err.killed || err.signal === 'SIGTERM' || err.message?.includes('timed out');
                const decodeErr = new Error(isTimeout ? 'MEDIA_DECODE_TIMEOUT' : ('MEDIA_DECODE_FAILED: ' + (err.message || '')));
                decodeErr.code = isTimeout ? 'MEDIA_DECODE_TIMEOUT' : 'MEDIA_DECODE_FAILED';
                return reject(decodeErr);
            }
            if (stderr && stderr.trim().length > 0) {
                const decodeErr = new Error('MEDIA_DECODE_CORRUPT: ' + stderr.trim());
                decodeErr.code = 'MEDIA_DECODE_CORRUPT';
                return reject(decodeErr);
            }
            resolve(true);
        });
    });
}

/**
 * Decodes a sample of the video stream packets to ensure the stream is truly decodable.
 */
function decodeVideoSample(filePath, options = {}) {
    return decodeMediaContent(filePath, true, options);
}

/**
 * Generates high-entropy filename avoiding original names.
 */
function generateSecureMediaFilename(ext) {
    return `${crypto.randomUUID()}${ext.toLowerCase()}`;
}

/**
 * Safely removes a file from disk if it exists.
 */
async function safeUnlink(filePath) {
    if (!filePath) return;
    try {
        await fs.promises.unlink(filePath);
    } catch (_err) {
        // Silently ignore if already removed
    }
}

/**
 * Checks if ffmpeg executable is available on the system PATH.
 */
function hasSystemFfmpeg(ffmpegPath = 'ffmpeg') {
    try {
        const check = cp.spawnSync(ffmpegPath, ['-version'], { stdio: 'ignore' });
        return check.status === 0;
    } catch {
        return false;
    }
}

module.exports = {
    ALLOWED_MIME_TO_EXT,
    detectFileSignature,
    validatePngBuffer,
    validateJpegBuffer,
    validateGifBuffer,
    validateWebpBuffer,
    validateGifLzw,
    validateImageIntegrity,
    validateMediaFile,
    probeVideoDuration,
    decodeMediaContent,
    decodeVideoSample,
    generateSecureMediaFilename,
    safeUnlink,
    hasSystemFfmpeg
};

