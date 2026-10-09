# BUG-013 — Exposición de playlist sin autenticación de dispositivo

> **Riesgo asociado:** RSK-028
> **Severidad:** Media (P2)
> **Módulo:** TV Engine / Playlist Delivery (`src/routes/tv.js`)
> **Detectado:** 2026-10-09
> **Estado:** 🟢 RESUELTO en backend y cliente; retest live aprobado para rechazos no autenticados.

## Defecto

`GET /api/tv/:tv_uuid/playlist` devolvía configuración, horarios y URLs multimedia basándose solo en el UUID. Una solicitud anónima o con una credencial ajena podía leer la playlist de una pantalla activa.

## Consumidores auditados

El único consumidor de ejecución encontrado fue `frontend/src/components/TVPlayer.jsx`. `loadPlaylist` ya lee `tv_device_token` de `localStorage` y envía `X-Device-Token` cuando existe; la asignación de perfil guarda el token antes de cargar la playlist. No se encontraron consumidores activos del endpoint en scripts, pruebas, `run-local.ps1` ni los lanzadores Kiosk. `run-local.ps1` consulta `/api/status`; el script E2E de auditoría no consulta esta ruta.

## Resolución

La ruta obtiene `X-Device-Token`, consulta `device_token_hash` e `is_active` para el UUID solicitado y valida mediante `verifyDeviceToken` de `src/utils/deviceAuth.js`. Token ausente, inválido, correspondiente a otro UUID, pantalla inactiva o pantalla inexistente reciben HTTP 401 con respuesta genérica. La consulta que revela contenidos solo se ejecuta tras validar la pantalla.

`src/config/cors.js` centraliza la política HTTP y permite explícitamente `X-Device-Token` junto con `Content-Type` y `Authorization`; `nx_tv.js` utiliza esta configuración. `TVPlayer.loadPlaylist` maneja HTTP 401: elimina el token local rechazado, vacía el contenido y cambia al estado de espera/vinculación, donde la pantalla puede recibir nuevas credenciales.

## Retest live en Docker (2026-10-09)

Se reconstruyeron y recrearon backend/frontend sin dependencias ni tocar PostgreSQL. Contra backend activo en `localhost:23002`, playlist sin cabecera y con token falso devolvieron HTTP 401; preflight devolvió 204 e incluyó `X-Device-Token` en `Access-Control-Allow-Headers`. El endpoint de salud devolvió 200. La base activa tiene 7 pantallas y 0 con `device_token_hash`; por eso no había una credencial válida para probar el camino positivo 200 en vivo sin alterar registros. El camino positivo sí está cubierto por fixture en `tests/playlist-auth.test.js`.

## Evidencia

`tests/playlist-auth.test.js` verifica ausencia de token, token inválido, token cruzado, token válido con contenido, pantalla inactiva y preflight CORS. `tests/device-auth.test.js` cubre el login HTTP y el handshake/reconexión de Socket.IO de BUG-012/RSK-025. La suite completa quedó en 63/63 aprobadas. Evidencia de despliegue y retest live: `docs/13-testing/results/TC-LIVE-DEPLOY-2026-10-09.md`; evidencia automatizada: `docs/13-testing/results/TC-PLAYLIST-AUTH-001.md`.
