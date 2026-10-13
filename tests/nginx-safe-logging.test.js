// ═══════════════════════════════════════════════════════════
// Nexus TV — Validación offline de configuración de logging seguro (AUD-006 / MISIÓN 4C)
// Verifica que la configuración de Nginx evita registrar tokens en la query string,
// SIN necesidad de desplegar ni reiniciar servicios.
// ═══════════════════════════════════════════════════════════

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const NGINX_CONF = path.resolve(__dirname, '../frontend/nginx.conf');
const NGINX_HARDENED = path.resolve(__dirname, '../frontend/nginx.conf.hardened');

test('NGINX-1: nginx.conf principal no registra query string en log_format', async () => {
    const content = fs.readFileSync(NGINX_CONF, 'utf8');
    // Extraer solo directivas log_format (no comentarios) y verificar que no
    // incluyan $request_uri ni $query_string que filtrarían tokens.
    const matches = content.match(/log_format\s+\w+\s+([\s\S]*?);/g) || [];
    for (const m of matches) {
        assert.equal(/\$request_uri\b/.test(m), false,
            `log_format no debe usar $request_uri: ${m.slice(0, 40)}`);
        assert.equal(/\$query_string/.test(m), false,
            'log_format no debe usar $query_string');
    }
});

test('NGINX-2: la config hardened declara un log_format seguro sin args', async () => {
    // Extraer solo la directiva log_format (no los comentarios) para validar el contenido real.
    const content = fs.readFileSync(NGINX_HARDENED, 'utf8');
    // Capturar el bloque log_format ... ; aunque abarre varias líneas
    const logFormatMatch = content.match(/log_format\s+nexus_safe_query\s+([\s\S]*?);/);
    assert.ok(logFormatMatch, 'debe declarar log_format nexus_safe_query');
    const logFormatBody = logFormatMatch[0];
    assert.equal(/\$request_uri\b/.test(logFormatBody), false,
        'nexus_safe_query no debe usar $request_uri (con args)');
    assert.equal(/\$query_string/.test(logFormatBody), false,
        'nexus_safe_query no debe usar $query_string');
    assert.match(logFormatBody, /\$uri\b/, 'debe usar $uri (sin args) en lugar de $request_uri');
});

test('NGINX-3: la config hardened asigna el log seguro a las rutas de Socket.IO', async () => {
    const content = fs.readFileSync(NGINX_HARDENED, 'utf8');
    assert.match(content, /location\s+\/control\/socket\.io\/\s*\{[^}]*access_log.*\bnexus_safe_query\b/ms,
        'debe aplicar nexus_safe_query a /control/socket.io/');
    assert.match(content, /location\s+\/socket\.io\/\s*\{[^}]*access_log.*\bnexus_safe_query\b/ms,
        'debe aplicar nexus_safe_query a /socket.io/');
});

test('NGINX-4: la config hardened no desactiva access_log global ni logs de error', async () => {
    const content = fs.readFileSync(NGINX_HARDENED, 'utf8');
    // No debe contener directivas globales access_log off fuera de location
    assert.equal(/^\s*access_log\s+off\s*;$/m.test(content), false,
        'no se permite "access_log off" global — mantiene auditoría selectiva');
    assert.match(content, /error_log/, 'debe conservar error_log por ruta');
});
