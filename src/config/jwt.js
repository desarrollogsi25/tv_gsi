const DEVELOPMENT_SECRET = 'nexus-tv-jwt-secret-key-2026';
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : DEVELOPMENT_SECRET);

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production.');
}

module.exports = JWT_SECRET;
