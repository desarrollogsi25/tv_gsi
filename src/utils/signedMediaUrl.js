// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Signed Media URLs (AUD-007 / MISIÓN 5)
// HMAC-SHA256 signed URLs for temporary access to local media files
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

/**
 * Clave secreta para firmar URLs de medios.
 * DEBE configurarse via variable de entorno MEDIA_URL_SIGNING_KEY.
 * Longitud mínima recomendada: 32 bytes (256 bits).
 * Nunca usar un valor por defecto en código.
 */
function getSigningKey() {
    const key = process.env.MEDIA_URL_SIGNING_KEY;
    if (!key || key.trim() === '') {
        throw new Error('MEDIA_URL_SIGNING_KEY environment variable is required but not set. Configure a secure random key (min 32 bytes) before deployment.');
    }
    const trimmed = key.trim();
    // El placeholder documentado en .env.example no es una clave válida: rechazarlo
    // evita firmar URLs con un valor conocido/previsto (firma forjeable).
    if (/^REPLACE_WITH/i.test(trimmed)) {
        throw new Error('MEDIA_URL_SIGNING_KEY is still the .env.example placeholder. Generate a real key with: openssl rand -hex 32');
    }
    if (Buffer.byteLength(trimmed, 'utf8') < 32) {
        throw new Error('MEDIA_URL_SIGNING_KEY must be at least 32 bytes of secure random material.');
    }
    return trimmed;
}

/**
 * Propósitos válidos para URLs firmadas.
 * Cada propósito tiene su propio espacio de firma para evitar confusión.
 */
const SIGNED_URL_PURPOSE = {
    TV_PLAYBACK: 'tv_playback',      // Reproducción por TV autenticada
    ADMIN_PREVIEW: 'admin_preview'   // Preview en panel administrativo
};

/**
 * Genera una URL firmada para acceso temporal a un archivo multimedia.
 *
 * @param {Object} params
 * @param {string} params.filename - Nombre del archivo (ej: 'abc-uuid.mp4')
 * @param {string} params.purpose - Uno de SIGNED_URL_PURPOSE
 * @param {string} [params.tvUuid] - UUID de la TV (requerido para TV_PLAYBACK)
 * @param {number} [params.ttlSeconds] - Tiempo de vida en segundos (default: 3600 = 1h)
 * @param {number} [params.contentId] - ID del contenido en BD (opcional, para auditoría)
 * @returns {string} URL firmada completa: `/media/filename?token=...&exp=...&purpose=...`
 */
function generateSignedMediaUrl({ filename, purpose, tvUuid, ttlSeconds = 3600, contentId }) {
    if (!filename || typeof filename !== 'string') {
        throw new Error('filename is required');
    }
    if (!purpose || !Object.values(SIGNED_URL_PURPOSE).includes(purpose)) {
        throw new Error('valid purpose is required');
    }
    if (purpose === SIGNED_URL_PURPOSE.TV_PLAYBACK && (!tvUuid || typeof tvUuid !== 'string')) {
        throw new Error('tvUuid is required for TV_PLAYBACK purpose');
    }

    const key = getSigningKey();
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

    // Payload que se firma: propósito|archivo|expiración|tvUuid|contentId
    // El tvUuid se incluye en el payload para TV_PLAYBACK para ligar la URL a la pantalla.
    const payloadParts = [
        purpose,
        filename,
        String(expiresAt)
    ];

    if (purpose === SIGNED_URL_PURPOSE.TV_PLAYBACK) {
        payloadParts.push(tvUuid);
    }
    if (contentId) {
        payloadParts.push(String(contentId));
    }

    const payload = payloadParts.join('|');
    const signature = crypto.createHmac('sha256', key).update(payload).digest('hex');

    // Construir query string
    const params = new URLSearchParams();
    params.set('token', signature);
    params.set('exp', String(expiresAt));
    params.set('purpose', purpose);
    if (purpose === SIGNED_URL_PURPOSE.TV_PLAYBACK) {
        params.set('tv', tvUuid);
    }
    if (contentId) {
        params.set('cid', String(contentId));
    }

    return `/media/${encodeURIComponent(filename)}?${params.toString()}`;
}

/**
 * Verifica una URL firmada y extrae sus parámetros si es válida.
 *
 * @param {Object} params
 * @param {string} params.filename - Nombre del archivo solicitado
 * @param {string} params.token - Firma HMAC de la query string
 * @param {string} params.exp - Timestamp de expiración (Unix seconds)
 * @param {string} params.purpose - Propósito declarado
 * @param {string} [params.tv] - UUID de TV (para TV_PLAYBACK)
 * @param {string} [params.cid] - Content ID (opcional)
 * @returns {Object} { valid: boolean, error?: string, expired?: boolean, payload?: Object }
 */
function verifySignedMediaUrl({ filename, token, exp, purpose, tv, cid }) {
    if (!filename || !token || !exp || !purpose) {
        return { valid: false, error: 'Missing required signed URL parameters (token, exp, purpose)' };
    }

    // Validar propósito
    if (!Object.values(SIGNED_URL_PURPOSE).includes(purpose)) {
        return { valid: false, error: 'Invalid purpose' };
    }

    // Validar expiración
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = parseInt(exp, 10);
    if (isNaN(expiresAt)) {
        return { valid: false, error: 'Invalid expiration timestamp' };
    }
    if (now > expiresAt) {
        return { valid: false, error: 'Signed URL expired', expired: true };
    }

    // Reconstruir payload para verificación
    const key = getSigningKey();
    const payloadParts = [purpose, filename, String(expiresAt)];
    if (purpose === SIGNED_URL_PURPOSE.TV_PLAYBACK) {
        if (!tv) {
            return { valid: false, error: 'TV UUID required for TV_PLAYBACK purpose' };
        }
        payloadParts.push(tv);
    }
    if (cid) {
        payloadParts.push(String(cid));
    }

    const expectedPayload = payloadParts.join('|');
    const expectedSignature = crypto.createHmac('sha256', key).update(expectedPayload).digest('hex');

    // Comparación en tiempo constante
    const tokenBuf = Buffer.from(token, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
        return { valid: false, error: 'Invalid signature' };
    }

    return {
        valid: true,
        payload: {
            filename,
            purpose,
            expiresAt,
            tvUuid: tv,
            contentId: cid ? parseInt(cid, 10) : null
        }
    };
}

/**
 * Middleware Express para validar URLs firmadas en `/media/*`.
 * Rechaza peticiones sin firma válida, caducada o con propósito incorrecto.
 * No registra firmas ni query strings completas en logs.
 */
function signedMediaUrlMiddleware(req, res, next) {
    // Solo validar GET y HEAD (lectura de medios)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next(); // Dejar que otras rutas manejen otros métodos
    }

    const { token, exp, purpose, tv, cid } = req.query;
    // Extraer solo el nombre del archivo (sin prefijo /media/)
    const pathWithoutPrefix = req.path.replace(/^\/media\//, '');
    const filename = pathWithoutPrefix.replace(/^\//, '');
    const decodedFilename = decodeURIComponent(filename);

    // Verificar firma
    const verification = verifySignedMediaUrl({
        filename: decodedFilename,
        token,
        exp,
        purpose,
        tv,
        cid
    });

    if (!verification.valid) {
        // Log sin información sensible (solo propósito, archivo, tipo de error)
        const logMeta = {
            path: req.path,
            purpose: purpose || 'missing',
            error: verification.error,
            expired: verification.expired === true,
            ip: req.ip
        };
        console.warn('⚠️ [Media Access Denied] Signed URL validation failed', logMeta);

        // No revelar si el archivo existe realmente (evitar enumeration)
        return res.status(403).json({
            success: false,
            code: verification.expired ? 'SIGNED_URL_EXPIRED' : 'INVALID_SIGNED_URL',
            message: verification.expired
                ? 'El enlace de acceso ha caducado. Solicita una nueva URL de reproducción.'
                : 'Acceso no autorizado. Se requiere una URL firmada válida.'
        });
    }

    // Adjuntar info verificada para uso posterior (logging, auditoría)
    req.signedMedia = verification.payload;
    next();
}

module.exports = {
    SIGNED_URL_PURPOSE,
    generateSignedMediaUrl,
    verifySignedMediaUrl,
    signedMediaUrlMiddleware,
    getSigningKey
};