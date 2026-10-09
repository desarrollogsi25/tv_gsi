function createApiCorsOptions(allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:28080,http://127.0.0.1:28080')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)) {
    return {
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error('Bloqueado por política CORS de Nexus TV'));
        },
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Token']
    };
}

module.exports = { createApiCorsOptions };
