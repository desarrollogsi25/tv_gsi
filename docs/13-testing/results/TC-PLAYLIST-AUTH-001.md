# TC-PLAYLIST-AUTH-001 — Autenticación de consultas de playlist

**Fecha:** 2026-10-09
**Resultado:** Aprobado: 63/63 pruebas automatizadas.
**Entorno:** Integración HTTP/Express y CORS en proceso, con pool PostgreSQL simulado. No se alteró la base de datos activa. Los tokens fueron fixtures efímeros y no se registraron ni documentaron.

## Casos de aceptación

| Caso | Evidencia automatizada | Resultado |
| --- | --- | --- |
| TC-PLAYLIST-01 — sin `X-Device-Token` | `tests/playlist-auth.test.js`: respuesta 401; la consulta que devuelve playlist no se ejecuta. | PASS |
| TC-PLAYLIST-02 — token inválido | `tests/playlist-auth.test.js`: respuesta 401; sin consulta de playlist. | PASS |
| TC-PLAYLIST-03 — token de B contra UUID de A | `tests/playlist-auth.test.js`: respuesta 401; sin consulta de playlist. | PASS |
| TC-PLAYLIST-04 — UUID y token legítimos emparejados | `tests/playlist-auth.test.js`: respuesta 200 con el contenido de fixture esperado. | PASS |
| Pantalla inactiva | `tests/playlist-auth.test.js`: token correcto para el fixture inactivo recibe 401; sin consulta de playlist. | PASS |
| Preflight CORS | `OPTIONS` con origen permitido y `Access-Control-Request-Headers: x-device-token`: respuesta 204 y `Access-Control-Allow-Headers` incluye `X-Device-Token`. | PASS |
| TC-PLAYLIST-05 — regresión login y WebSocket de control | `tests/device-auth.test.js`: login sin token rechazado y con token válido aceptado (#19–20); handshake, token cruzado, reconexión autenticada y acceso por rol de admin cubiertos por #1–18. | PASS |

## Ejecución de suite y build

- `NODE_ENV=test`, `NODE_OPTIONS=--require=dotenv/config`, `node --test`: **63/63 PASS**, 0 fallos, 0 omitidas. Los 57 casos preexistentes permanecieron aprobados y se añadieron seis pruebas de playlist/CORS.
- `npm run build` en `frontend/`: Vite compiló 126 módulos y terminó con código 0. Node 20.18 mostró el aviso de versión mínima 20.19+ requerida por Vite.

## Alcance de la evidencia

Las pruebas HTTP usan un pool simulado y no ejercitan una base de datos ni servicio desplegado. La validación criptográfica real de los fixtures usa `verifyDeviceToken` y hashes SHA-256 generados por `deviceAuth.js`. El build verifica el cliente; no se ejecutó una pantalla física.
