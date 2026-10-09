# TC-LIVE-DEPLOY-2026-10-09 — Despliegue controlado y retest live

**Fecha:** 2026-10-09
**Resultado:** Retest live aprobado para endpoints de seguridad y colisión de identidad. Hay una limitación operativa: la BD activa no contiene hashes de dispositivo, así que no fue posible probar en vivo una playlist legítima con token válido.
**Host:** Compose local, backend `localhost:23002`, frontend `localhost:28080`, PostgreSQL `localhost:25432`.

## Despliegue

Comandos ejecutados:

```text
docker compose build backend
docker compose build frontend
docker compose up -d --no-deps backend frontend
docker compose ps
```

No se ejecutó `docker compose down`, ningún comando destructivo de volúmenes ni se reconstruyó/recreó `db`.

Estado final de `docker compose ps`:

| Servicio | Contenedor | Estado | Puerto |
| --- | --- | --- | --- |
| backend | `tv-backend` | Up, healthy | 23002 → 3002 |
| frontend | `tv-frontend` | Up, healthy | 28080 → 8080 |
| db | `tv-db` | Up, healthy | 25432 → 5432 |

Antes/después, PostgreSQL conservó el mismo ID de contenedor, hora de inicio, volumen nombrado `tv_gsi_tv_pgdata` y `pg_postmaster_start_time()`. Los conteos de `tv_screens/playlists/content/users` permanecieron `8/4/46/4`. No se alteró ninguna fila. Consulta adicional encontró 7 pantallas activas, cero `device_token_hash` configurados.

## Retest live

| Comprobación | Resultado observado | Estado |
| --- | --- | --- |
| `GET /api/status` | HTTP 200 | PASS |
| `GET /` frontend | HTTP 200 | PASS |
| Playlist sin `X-Device-Token` | HTTP 401 | PASS |
| Playlist con token inválido de prueba | HTTP 401 | PASS |
| `OPTIONS` con origen permitido y `Access-Control-Request-Headers: x-device-token` | HTTP 204; `Access-Control-Allow-Headers` incluyó `X-Device-Token` | PASS |
| Socket.IO `/control` sin credencial | Rechazado durante handshake (`connect_error`) | PASS — regresión BUG-012 |
| Login administrativo `/api/auth/login` | HTTP 200; JWT verificado con el `JWT_SECRET` activo y claim `role=admin` | PASS |
| Colisión live BUG-014 | Dos sockets pendientes conectados con el mismo PIN; `/api/admin/waiting-screens` devolvió dos filas con dos `pairingSessionId` distintos | PASS para identidad de registro |

El token de dispositivo legítimo no pudo probarse contra el backend live: no existe ningún `device_token_hash` en la BD actual. Por ello no se afirma un HTTP 200 live para playlist autenticada. El caso positivo 200 con token emparejado está cubierto por fixture en `tests/playlist-auth.test.js`. Será necesario revincular/aprovisionar credenciales antes de que pantallas actuales puedan usar la ruta protegida.

La comprobación de colisión usó solo sockets temporales; se desconectaron al terminar y no se vinculó ningún perfil. No se ejecutó el binding real ni se esperaron los cinco minutos completos de TTL sobre pantallas reales.

## Suite y retest de autenticación

Se ejecutó `node --test` con `NODE_ENV=test` y dotenv precargado: **63/63 PASS**, 0 fallos. Incluye la regresión de login/WebSocket de dispositivo en `tests/device-auth.test.js`.

El login administrativo usó las credenciales E2E ya configuradas en el entorno/local `.env`; ni contraseña ni JWT se imprimieron ni persistieron en el reporte.

Durante un primer intento, el proceso de prueba no conservó la UUID entre sesiones de PowerShell y envió literalmente `undefined`, causando una respuesta 500 por UUID malformada. No fue un resultado de autenticación; se repitieron ambos casos con una UUID válida en la misma ejecución y se obtuvieron los 401 esperados. No se modificó el estado persistente.
