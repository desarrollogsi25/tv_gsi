// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Device Authentication & Cryptography (RSK-025)
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PREFIX = 'nxdt_';

/**
 * Genera un token criptográficamente seguro para un dispositivo TV.
 * Retorna una cadena con prefijo 'nxdt_' y 32 bytes de entropía en hex (64 hex chars).
 */
function generateDeviceToken() {
    return `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Calcula el hash criptográfico SHA-256 de un token de dispositivo para persistencia segura.
 * Nunca se almacena el token en texto plano en la base de datos.
 */
function hashDeviceToken(token) {
    if (!token || typeof token !== 'string') return null;
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Verifica un token de dispositivo contra el hash persistido usando comparación en tiempo constante.
 */
function verifyDeviceToken(token, expectedHash) {
    if (!token || !expectedHash || typeof token !== 'string' || typeof expectedHash !== 'string') {
        return false;
    }

    const computedHash = hashDeviceToken(token);
    if (!computedHash || computedHash.length !== expectedHash.length) {
        return false;
    }

    try {
        const computedBuf = Buffer.from(computedHash, 'utf8');
        const expectedBuf = Buffer.from(expectedHash, 'utf8');
        return crypto.timingSafeEqual(computedBuf, expectedBuf);
    } catch (_err) {
        return false;
    }
}

/**
 * Valida el formato de un UUID de pantalla.
 */
function isValidUuid(uuid) {
    return typeof uuid === 'string' && UUID_REGEX.test(uuid.trim());
}

/**
 * Valida si una cadena cumple con el formato aceptable de credencial de dispositivo.
 */
function isValidDeviceTokenFormat(token) {
    if (!token || typeof token !== 'string') return false;
    const trimmed = token.trim();
    // Acepta formato nxdt_<64 hex> o 64 hex directo
    return /^(nxdt_[0-9a-f]{64}|[0-9a-f]{64})$/i.test(trimmed);
}

module.exports = {
    generateDeviceToken,
    hashDeviceToken,
    verifyDeviceToken,
    isValidUuid,
    isValidDeviceTokenFormat,
    TOKEN_PREFIX
};
