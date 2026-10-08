const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../src/middlewares/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'nexus-tv-jwt-secret-key-2026';

test('authMiddleware - responde 401 si falta header Authorization', (t, done) => {
    const req = { headers: {} };
    const res = {
        statusCode: null,
        jsonData: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.jsonData = data;
            assert.strictEqual(this.statusCode, 401);
            assert.strictEqual(this.jsonData.success, false);
            assert.match(this.jsonData.message, /Token no proporcionado/i);
            done();
        }
    };
    const next = () => {
        assert.fail('next() no debería ser llamado');
    };

    authMiddleware(req, res, next);
});

test('authMiddleware - responde 401 si token no inicia con Bearer', (t, done) => {
    const req = { headers: { authorization: 'Basic 123456' } };
    const res = {
        statusCode: null,
        jsonData: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.jsonData = data;
            assert.strictEqual(this.statusCode, 401);
            assert.strictEqual(this.jsonData.success, false);
            assert.match(this.jsonData.message, /Token no proporcionado/i);
            done();
        }
    };
    const next = () => {
        assert.fail('next() no debería ser llamado');
    };

    authMiddleware(req, res, next);
});

test('authMiddleware - responde 401 si token está firmado con clave incorrecta o expirado', (t, done) => {
    const badToken = jwt.sign({ id: 1, username: 'test' }, 'wrong-secret-key');
    const req = { headers: { authorization: `Bearer ${badToken}` } };
    const res = {
        statusCode: null,
        jsonData: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.jsonData = data;
            assert.strictEqual(this.statusCode, 401);
            assert.strictEqual(this.jsonData.success, false);
            assert.match(this.jsonData.message, /Token inválido o expirado/i);
            done();
        }
    };
    const next = () => {
        assert.fail('next() no debería ser llamado');
    };

    authMiddleware(req, res, next);
});

test('authMiddleware - inyecta req.user y llama a next() con token válido', (t, done) => {
    const validPayload = { id: 1, username: 'p1_principal', role: 'editor' };
    const validToken = jwt.sign(validPayload, JWT_SECRET, { expiresIn: '8h' });
    const req = { headers: { authorization: `Bearer ${validToken}` } };
    const res = {
        status() {
            assert.fail('res.status() no debería ser llamado');
        }
    };
    const next = () => {
        assert.ok(req.user);
        assert.strictEqual(req.user.id, 1);
        assert.strictEqual(req.user.username, 'p1_principal');
        assert.strictEqual(req.user.role, 'editor');
        done();
    };

    authMiddleware(req, res, next);
});
