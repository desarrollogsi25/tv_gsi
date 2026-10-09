process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
process.env.JWT_SECRET = JWT_SECRET;
const { authMiddleware, requireRole } = require('../src/middlewares/auth');

function createMockReqRes({ authHeader, user } = {}) {
    const req = {
        headers: authHeader !== undefined ? { authorization: authHeader } : {},
        user: user || null
    };

    let statusCode = null;
    let jsonPayload = null;
    let nextCalled = false;

    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(data) {
            jsonPayload = data;
            return this;
        }
    };

    const next = () => {
        nextCalled = true;
    };

    return {
        req,
        res,
        next,
        getStatus: () => statusCode,
        getJson: () => jsonPayload,
        isNextCalled: () => nextCalled
    };
}

// ─────────────────────────────────────────────────────────────
// Bloque 1: Escenarios mínimos obligatorios (1 a 12)
// ─────────────────────────────────────────────────────────────

test('1. RBAC - Petición anónima a ruta protegida responde 401', (t) => {
    const ctx = createMockReqRes({ authHeader: undefined });
    authMiddleware(ctx.req, ctx.res, ctx.next);

    assert.strictEqual(ctx.getStatus(), 401);
    assert.strictEqual(ctx.getJson().success, false);
    assert.match(ctx.getJson().message, /Token no proporcionado/i);
    assert.strictEqual(ctx.isNextCalled(), false);
});

test('2. RBAC - Petición con token inválido responde 401', (t) => {
    const badToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature';
    const ctx = createMockReqRes({ authHeader: `Bearer ${badToken}` });
    authMiddleware(ctx.req, ctx.res, ctx.next);

    assert.strictEqual(ctx.getStatus(), 401);
    assert.strictEqual(ctx.getJson().success, false);
    assert.match(ctx.getJson().message, /Token inválido o expirado/i);
    assert.strictEqual(ctx.isNextCalled(), false);
});

test('3. RBAC - Petición con token expirado responde 401', (t) => {
    const expiredToken = jwt.sign(
        { id: 99, username: 'expired_user', role: 'admin' },
        JWT_SECRET,
        { expiresIn: '-1s' }
    );
    const ctx = createMockReqRes({ authHeader: `Bearer ${expiredToken}` });
    authMiddleware(ctx.req, ctx.res, ctx.next);

    assert.strictEqual(ctx.getStatus(), 401);
    assert.strictEqual(ctx.getJson().success, false);
    assert.match(ctx.getJson().message, /Token inválido o expirado/i);
    assert.strictEqual(ctx.isNextCalled(), false);
});

test('4. RBAC - Token válido de viewer intentando leer ruta permitida avanza a next()', (t) => {
    const viewerToken = jwt.sign({ id: 10, username: 'auditor_viewer', role: 'viewer' }, JWT_SECRET, { expiresIn: '1h' });
    const ctx = createMockReqRes({ authHeader: `Bearer ${viewerToken}` });

    authMiddleware(ctx.req, ctx.res, () => {
        const guard = requireRole('admin', 'editor', 'viewer');
        guard(ctx.req, ctx.res, ctx.next);
    });

    assert.strictEqual(ctx.isNextCalled(), true);
    assert.strictEqual(ctx.getStatus(), null);
});

test('5. RBAC - Token válido de viewer intentando crear/modificar datos responde 403 Forbidden', (t) => {
    const viewerToken = jwt.sign({ id: 10, username: 'auditor_viewer', role: 'viewer' }, JWT_SECRET, { expiresIn: '1h' });
    const ctx = createMockReqRes({ authHeader: `Bearer ${viewerToken}` });

    authMiddleware(ctx.req, ctx.res, () => {
        const guard = requireRole('admin', 'editor'); // Endpoint de mutación
        guard(ctx.req, ctx.res, ctx.next);
    });

    assert.strictEqual(ctx.isNextCalled(), false);
    assert.strictEqual(ctx.getStatus(), 403);
    assert.strictEqual(ctx.getJson().success, false);
    assert.match(ctx.getJson().message, /Permisos insuficientes/i);
});

test('6. RBAC - Token válido de viewer intentando operación destructiva responde 403 Forbidden', (t) => {
    const viewerToken = jwt.sign({ id: 10, username: 'auditor_viewer', role: 'viewer' }, JWT_SECRET, { expiresIn: '1h' });
    const ctx = createMockReqRes({ authHeader: `Bearer ${viewerToken}` });

    authMiddleware(ctx.req, ctx.res, () => {
        const guard = requireRole('admin'); // Eliminación de pantalla
        guard(ctx.req, ctx.res, ctx.next);
    });

    assert.strictEqual(ctx.isNextCalled(), false);
    assert.strictEqual(ctx.getStatus(), 403);
    assert.strictEqual(ctx.getJson().success, false);
    assert.match(ctx.getJson().message, /Permisos insuficientes/i);
});

test('7. RBAC - Token válido de editor administrando contenido avanza a next()', (t) => {
    const editorToken = jwt.sign({ id: 5, username: 'content_editor', role: 'editor' }, JWT_SECRET, { expiresIn: '1h' });
    const ctx = createMockReqRes({ authHeader: `Bearer ${editorToken}` });

    authMiddleware(ctx.req, ctx.res, () => {
        const guard = requireRole('admin', 'editor');
        guard(ctx.req, ctx.res, ctx.next);
    });

    assert.strictEqual(ctx.isNextCalled(), true);
    assert.strictEqual(ctx.getStatus(), null);
});

test('8. RBAC - Token válido de editor intentando vincular TV responde 403 Forbidden', (t) => {
    const editorToken = jwt.sign({ id: 5, username: 'content_editor', role: 'editor' }, JWT_SECRET, { expiresIn: '1h' });
    const ctx = createMockReqRes({ authHeader: `Bearer ${editorToken}` });

    authMiddleware(ctx.req, ctx.res, () => {
        const guard = requireRole('admin'); // /bind-screen es exclusivo admin
        guard(ctx.req, ctx.res, ctx.next);
    });

    assert.strictEqual(ctx.isNextCalled(), false);
    assert.strictEqual(ctx.getStatus(), 403);
    assert.strictEqual(ctx.getJson().success, false);
    assert.match(ctx.getJson().message, /Permisos insuficientes/i);
});

test('9. RBAC - Token válido de editor intentando emitir broadcast responde 403 Forbidden', (t) => {
    const editorToken = jwt.sign({ id: 5, username: 'content_editor', role: 'editor' }, JWT_SECRET, { expiresIn: '1h' });
    const ctx = createMockReqRes({ authHeader: `Bearer ${editorToken}` });

    authMiddleware(ctx.req, ctx.res, () => {
        const guard = requireRole('admin'); // /temporary-content es exclusivo admin
        guard(ctx.req, ctx.res, ctx.next);
    });

    assert.strictEqual(ctx.isNextCalled(), false);
    assert.strictEqual(ctx.getStatus(), 403);
    assert.strictEqual(ctx.getJson().success, false);
    assert.match(ctx.getJson().message, /Permisos insuficientes/i);
});

test('10. RBAC - Token válido de admin accediendo a operaciones privilegiadas avanza a next()', (t) => {
    const adminToken = jwt.sign({ id: 1, username: 'super_admin', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    const ctx = createMockReqRes({ authHeader: `Bearer ${adminToken}` });

    authMiddleware(ctx.req, ctx.res, () => {
        const guard = requireRole('admin');
        guard(ctx.req, ctx.res, ctx.next);
    });

    assert.strictEqual(ctx.isNextCalled(), true);
    assert.strictEqual(ctx.getStatus(), null);
});

test('11. RBAC - Usuario autenticado sin propiedad role responde 403 Forbidden', (t) => {
    const noRoleToken = jwt.sign({ id: 99, username: 'norole_user' }, JWT_SECRET, { expiresIn: '1h' });
    const ctx = createMockReqRes({ authHeader: `Bearer ${noRoleToken}` });

    authMiddleware(ctx.req, ctx.res, () => {
        const guard = requireRole('admin', 'editor', 'viewer');
        guard(ctx.req, ctx.res, ctx.next);
    });

    assert.strictEqual(ctx.isNextCalled(), false);
    assert.strictEqual(ctx.getStatus(), 403);
    assert.strictEqual(ctx.getJson().success, false);
    assert.match(ctx.getJson().message, /Rol de usuario no asignado/i);
});

test('12. RBAC - Usuario con rol desconocido fuera del modelo responde 403 Forbidden', (t) => {
    const alienToken = jwt.sign({ id: 101, username: 'hacker', role: 'superuser_root' }, JWT_SECRET, { expiresIn: '1h' });
    const ctx = createMockReqRes({ authHeader: `Bearer ${alienToken}` });

    authMiddleware(ctx.req, ctx.res, () => {
        const guard = requireRole('admin', 'editor', 'viewer');
        guard(ctx.req, ctx.res, ctx.next);
    });

    assert.strictEqual(ctx.isNextCalled(), false);
    assert.strictEqual(ctx.getStatus(), 403);
    assert.strictEqual(ctx.getJson().success, false);
    assert.match(ctx.getJson().message, /Rol de usuario no reconocido/i);
});

// ─────────────────────────────────────────────────────────────
// Bloque 2: Pruebas de integración sobre routers y grupos de rutas
// ─────────────────────────────────────────────────────────────

test('13. Router Integration - router admin intercepta con 403 antes de mutar base de datos', (t) => {
    const { router } = require('../src/routes/admin');
    const deleteRoute = router.stack.find((layer) => layer.route && layer.route.path === '/screens/:uuid' && layer.route.methods.delete);
    assert.ok(deleteRoute, 'Ruta DELETE /screens/:uuid debe existir en el router admin');

    // Comprobar que requireRole está registrado como middleware previo en la pila del router
    const handlers = deleteRoute.route.stack;
    assert.ok(handlers.length >= 2, 'Debe haber middleware de guardia antes del controlador');

    const req = {
        headers: {},
        params: { uuid: 'PT101' },
        user: { id: 2, username: 'viewer_user', role: 'viewer' }
    };

    let returnedStatus = null;
    let returnedJson = null;
    const res = {
        status(code) {
            returnedStatus = code;
            return this;
        },
        json(data) {
            returnedJson = data;
            return this;
        }
    };

    // Invocar el primer middleware de la ruta (requireRole)
    handlers[0].handle(req, res, () => {
        assert.fail('El middleware requireRole no debió permitir avanzar a un rol viewer en DELETE');
    });

    assert.strictEqual(returnedStatus, 403);
    assert.strictEqual(returnedJson.success, false);
});

test('14. Router Integration - router media protege /upload ante rol viewer antes de procesar multer', (t) => {
    const { router } = require('../src/routes/media');
    const uploadRoute = router.stack.find((layer) => layer.route && layer.route.path === '/upload' && layer.route.methods.post);
    assert.ok(uploadRoute, 'Ruta POST /upload debe existir en router media');

    const handlers = uploadRoute.route.stack;
    const req = {
        headers: {},
        user: { id: 3, username: 'viewer_user', role: 'viewer' }
    };

    let returnedStatus = null;
    let returnedJson = null;
    const res = {
        status(code) {
            returnedStatus = code;
            return this;
        },
        json(data) {
            returnedJson = data;
            return this;
        }
    };

    // El primer middleware registrado debe ser requireRole
    handlers[0].handle(req, res, () => {
        assert.fail('requireRole no debió permitir avanzar a viewer en POST /upload');
    });

    assert.strictEqual(returnedStatus, 403);
    assert.strictEqual(returnedJson.success, false);
});
