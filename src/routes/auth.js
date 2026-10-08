const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const authMiddleware = require('../middlewares/auth');

const JWT_SECRET = require('../config/jwt');

// Iniciar sesión (Login)
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Usuario y contraseña requeridos.'
        });
    }

    try {
        const query = 'SELECT id, username, email, role, password_hash FROM nexus_tv.users WHERE username = $1;';
        const result = await pool.query(query, [username]);

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas.'
            });
        }

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas.'
            });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    } catch (err) {
        console.error('❌ Error en /api/auth/login:', err.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor.'
        });
    }
});

// Perfil de usuario actual (Protegido)
router.get('/me', authMiddleware, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

module.exports = router;
