const jwt = require('jsonwebtoken');

const JWT_SECRET = require('../config/jwt');

const VALID_ROLES = new Set(['admin', 'editor', 'viewer']);

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Acceso no autorizado: Token no proporcionado.'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: 'Token inválido o expirado.'
        });
    }
}

/**
 * Middleware para Control de Acceso Basado en Roles (RBAC).
 * Garantiza el principio de mínimo privilegio validando que el rol
 * del usuario pertenezca a la lista autorizada para la operación.
 *
 * @param {...string} allowedRoles - Roles con permiso para acceder ('admin', 'editor', 'viewer')
 * @returns {Function} Middleware Express (req, res, next)
 */
function requireRole(...allowedRoles) {
    const rolesList = allowedRoles.flat().filter(r => typeof r === 'string');

    return (req, res, next) => {
        // Garantizar que la autenticación previa haya inyectado req.user
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Acceso no autorizado: Usuario no autenticado.'
            });
        }

        const userRole = req.user.role;

        // Rechazar si el rol falta o no es string
        if (!userRole || typeof userRole !== 'string') {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado: Rol de usuario no asignado.'
            });
        }

        // Rechazar si es un rol desconocido fuera del modelo del sistema
        if (!VALID_ROLES.has(userRole)) {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado: Rol de usuario no reconocido.'
            });
        }

        // Rechazar si el rol no tiene privilegios para el endpoint solicitado
        if (!rolesList.includes(userRole)) {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado: Permisos insuficientes para esta operación.'
            });
        }

        next();
    };
}

module.exports = authMiddleware;
module.exports.authMiddleware = authMiddleware;
module.exports.requireRole = requireRole;
module.exports.VALID_ROLES = VALID_ROLES;
