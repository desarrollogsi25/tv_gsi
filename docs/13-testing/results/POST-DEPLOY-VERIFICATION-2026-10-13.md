# Verificación post-despliegue — 2026-10-13

**Ventana:** DEV-RUN-005 v1.1 — *Release hardening and go-live*
**Objeto verificado:** stack Nexus TV v2.2.0 endurecida en el entorno activo (`tv-backend`, `tv-frontend`, `tv-db`)
**Compañero de evidencia:** `DEPLOY-LOG-2026-10-13.md` (cronología, gates y códigos de salida)
**Método:** solo verificación real en crudo — probes HTTP contra los puertos expuestos, `docker inspect`/`docker port`, `psql` contra la DB activa y suites de pruebas ejecutadas. Sin simulación; los ítems que exigen credenciales reales quedan marcados como **BLOQUEADO** y asignados a Operaciones.

---

## 1. Estado del entorno verificado

| Elemento | Estado observado |
|---|---|
| `tv-backend` | healthy · Node **v24.21.0** · imagen post-build (`sha256:29e0640af875…`) |
| `tv-frontend` | healthy · `nginx -t` **test successful** |
| `tv-db` | healthy · contenedor `created=2026-10-13T14:37:21.880793576Z` (recreado en la ventana) · volumen `tv_gsi_tv_pgdata` preservado |
| API | `GET /api/status` → `{"status":"online","message":"Nexus TV API v2 is running.","version":"2.0.0"}` |

## 2. Exposición de medios (AUD-007 — mitigación aplicada)

Archivo real de `media/`: `1790102952871-623597520-image_779738258736djec454.png`

| Probe | Antes (preflight) | Después (post-despliegue) |
|---|---|---|
| `GET /media/<file>` sin firma — frontend `:28080` | **200** | **403** |
| `GET /media/<file>` sin firma — backend `:23002` | **200** | **403** |
| `GET /media/<file>?token=00&exp=9999999999&purpose=tv_playback` (firma inválida) — `:28080` | (no aplicable) | **403** |

Logs del backend correspondientes (fail-safe operando):
- `error: 'Missing required signed URL parameters (token, exp, purpose)'`
- `error: 'TV UUID required for TV_PLAYBACK purpose'`

Re-probe tras la recreación de `tv-db`: anon media = **403** ✅ (la mitigación no depende de la DB y sigue activa).

## 3. Superficie de red de PostgreSQL (AUD-008 — aplicación verificada en campo)

| Comprobación | Preflight | Post-ventana |
|---|---|---|
| `docker port tv-db 5432/tcp` | `0.0.0.0:25432` + `[::]:25432` | **`127.0.0.1:25432`** (solo loopback) |
| `HostConfig.PortBindings` | `{"HostIp":"","HostPort":"25432"}` | `{"HostIp":"127.0.0.1","HostPort":"25432"}` |
| `.Created` del contenedor | `2026-10-08T15:27:48Z` (pre-ventana) | `2026-10-13T14:37:21.880793576Z` (nuevo) |
| Env del contenedor | sin `PG_APP_USER` (compose antiguo) | `PG_APP_USER=nexus_app`, `POSTGRES_USER=tv` |

⚠️ **Incidencia de ventana (detectada y resuelta):** la primera recreación de `tv-db` quedó interrumpida y **no se aplicó**; la verificación en crudo (`docker inspect .Created` + `docker port`) la detectó y se re-ejecutó la recreación (ver `DEPLOY-LOG` §7). El binding loopback anterior a la ventana **no** estaba vigente hasta `14:37:21Z`.

## 4. Migraciones aplicadas en la DB activa (06 → 07)

| Objeto/evidencia | Resultado |
|---|---|
| `migrations/06_runtime_user.sql` | exit **0** — `CREATE ROLE nexus_app`, grants/revokes aplicados |
| `migrations/07_pending_pairings.sql` | exit **0** — `CREATE TABLE nexus_tv.pending_pairings` + 2 índices |
| `pg_roles.nexus_app` | `super=false`, `login=true` |
| `to_regclass('nexus_tv.pending_pairings')` | **presente** |
| Grants totales de `nexus_app` | **25** (mínimo ≥7) |
| Login por socket como `nexus_app` | **0** (denegado) |
| Login `scram-sha-256` por red (`127.0.0.1:25432`) | **OK** |
| DDL como `nexus_app` | exit **1** — `permission denied for schema nexus_tv` (42501) ✅ |

## 5. Corte de identidad de la aplicación (AUD-001 — aplicación en DB activa)

| Comprobación | Resultado |
|---|---|
| `backend` conecta como | `nexus_app` — **1 sesión** en `pg_stat_activity` tras forzar consulta |
| Sonda de pool post-recreación | `POST /api/tv/login` con uuid inexistente → **HTTP 401** (≠ 5xx) = pool reconectada y consultando ✅ |
| `ALLOW_QUERY_DEVICE_TOKEN` | **false** (env del contenedor) |
| `OBSERVE_QUERY_DEVICE_TOKEN` | **false** |
| `PG_APP_PASSWORD_LEN` | 48 |
| `MEDIA_URL_SIGNING_KEY_LEN` | 64 (sin placeholder `REPLACE_WITH*`) |
| Módulo de firma | `src/utils/signedMediaUrl.js` **presente** en la imagen |
| Rechazo de credencial en query | `grep 'query string is rejected'` = **1** |

*Sonda 400 descartada:* el primer intento de login devolvió 400 con `SyntaxError` de JSON por el bug de comillas de PowerShell 5.1 en argv (JSON sin comillas); repetido con payload en fichero → 401 correcto. Artefacto de la sonda, no de la app.

## 6. Endurecimiento del frontend

| Comprobación | Preflight | Post-despliegue |
|---|---|---|
| Directiva `nexus_safe_query` en `frontend/nginx.conf` | 0 | **2** |
| `proxy_pass http://backend:3002` | (upstreams legacy) | **4** |
| `nginx -t` | OK | **test successful** (solo warning estándar `user` como no-root; log `2026/10/13 14:18:40` reloj del contenedor) |

## 7. Regresión de pruebas (ejecución final en crudo)

**153 pass / 0 fail** (13 suites, ejecutadas por separado):

`device-auth` 32 · `nginx-safe-logging` 4 · `signed-media-url` **20** · `pairing-session` 5 · `pairing-ack` 28 · `auth` 4 · `rbac` 14 · `playlist-auth` 6 · `playlist-playback` 5 · `tv-heartbeat` 11 · `schedule-window` 5 · `normalize-days` 4 · `media-upload` 15

- SMU **20/20** (SMU-19/SMU-20: rechazo de placeholder y clave <32 bytes en `getSigningKey()`).
- Validaciones offline: `node --check` OK · `git diff --check` = **0** · `nginx -t` OK ambas configs.
- Nota N1: fallos de transporte IPC intermedios del runner del host (Node 20.18.0) con **0 fallos de aserción** — artefacto del runner.

## 8. Respaldo y rollback disponibles

| Artefacto | Valor |
|---|---|
| Dump | `backups/nexus_tv_20261013_161056.dump` · 24.424 bytes |
| SHA-256 | `ACE8954697FE43881C8557219D4C48EEE10C8B6302E4DAA8C4C01A2CA8FC9018` |
| Restauración verificada | QA efímera `127.0.0.1:25497` → `BACKUP_VERIFIED_OK` (conteos idénticos) |
| Rollback de imágenes | `tv_gsi-backend:pre-v2.2.0`, `tv_gsi-frontend:pre-v2.2.0` |
| Rollback de compose | `backups/docker-compose.yml.pre-deploy` |

## 9. Checklist de aceptación post-despliegue

| # | Ítem | Estado |
|---|---|---|
| 9.1 | Media anónimo sin firma → 403 en frontend `:28080` y backend `:23002` | ✅ VERIFICADO (crudo) |
| 9.2 | Firma inválida → 403 | ✅ VERIFICADO (crudo) |
| 9.3 | API responde `online` v2.0.0 | ✅ VERIFICADO |
| 9.4 | `tv-db` escucha solo en `127.0.0.1:25432` | ✅ VERIFICADO (`docker port` + `HostConfig.PortBindings`, contenedor nuevo) |
| 9.5 | Migración 06 aplicada: `nexus_app` existe, `super=false`, `login=true` | ✅ VERIFICADO |
| 9.6 | Migración 07 aplicada: `pending_pairings` presente | ✅ VERIFICADO |
| 9.7 | Grants de `nexus_app` ≥ 7 (observados: 25) y DDL denegado (42501) | ✅ VERIFICADO |
| 9.8 | Backend conecta como `nexus_app` (sesión en `pg_stat_activity` + 401 de sonda de login) | ✅ VERIFICADO |
| 9.9 | `ALLOW/OBSERVE_QUERY_DEVICE_TOKEN=false`, `KEY_LEN=64`, módulo de firma presente en imagen | ✅ VERIFICADO |
| 9.10 | `nginx -t` OK, `nexus_safe_query=2`, upstreams `backend:3002` | ✅ VERIFICADO |
| 9.11 | Volumen `tv_gsi_tv_pgdata` preservado con datos íntegros (`48\|4\|8\|10\|132`) | ✅ VERIFICADO |
| 9.12 | Regresión 153/153 pass, 0 fail | ✅ VERIFICADO |
| 9.13 | Respaldo + verificación de restauración (`BACKUP_VERIFIED_OK`) | ✅ VERIFICADO |
| 9.14 | Reproducción de playback firmado en **TV real** (GET/HEAD/Range con credenciales reales) — G4c | ⏳ **BLOQUEADO** — requiere dispositivo/credenciales reales → **Operaciones** |
| 9.15 | Preview de contenido en **admin real** con sesión autenticada — G4d | ⏳ **BLOQUEADO** — requiere credenciales de admin reales → **Operaciones** |
| 9.16 | Heartbeat con **dispositivo real** (comportamiento completo en activo) — G5a | ⏳ **BLOQUEADO** — requiere dispositivo real → **Operaciones** |
| 9.17 | Emparejamiento E2E con **admin + TV reales** — G5b | ⏳ **BLOQUEADO** — requiere credenciales reales → **Operaciones** |
| 9.18 | Verificación de campo de **AUD-006** (campaña de observación con `ALLOW_QUERY_DEVICE_TOKEN=false`) | ⏳ **PENDIENTE** — DEV-RUN-004; `ALLOW_QUERY_DEVICE_TOKEN` **no** se habilita durante la observación |
| 9.19 | Retiro de los roles superusuario legacy `tv` / `nx_tv` / `tv_user` (fase 2 de AUD-001) | ⏳ **PENDIENTE** — DBA, requiere procedimiento de recuperación documentado |

## 10. Pendientes tras la ventana

1. **Operaciones:** ítems 9.14–9.17 (pruebas con credenciales/dispositivos reales).
2. **DEV-RUN-004:** campaña de verificación de campo de AUD-006 (ítem 9.18) — `ALLOW_QUERY_DEVICE_TOKEN=false` se mantiene **deshabilitado** durante toda la observación.
3. **DBA:** retiro de `tv`/`nx_tv`/`tv_user` con runbook de recuperación (ítem 9.19).
4. **Sign-off:** retención/purga de `backups/` y de las etiquetas `pre-v2.2.0`.
5. Los hallazgos **AUD-001…AUD-008** conservan sus IDs; cambios de estado solo con evidencia real (AUD-007/AUD-008 actualizados aquí por evidencia de campo de esta ventana; AUD-006 permanece en estado de observación pendiente).

---

## 11. Re-verificación final — MISIÓN FINAL (2026-10-13, tarde)

> Actualiza los estados de §9 cuando la misión de cierre aportó evidencia nueva. Evidencia completa: [`FINAL-CLOSURE-2026-10-13.md`](./FINAL-CLOSURE-2026-10-13.md).

### 11.1 Ítems de §9 con estado actualizado

| Ítem | Estado tras la misión de cierre | Evidencia |
|---|---|---|
| 9.9 | **ACTUALIZADO:** `ALLOW_QUERY_DEVICE_TOKEN=false` (sin cambios) · `OBSERVE_QUERY_DEVICE_TOKEN=true` desde 2026-10-13T15:25:28Z (fase V3 de DEV-RUN-004) · `KEY_LEN=64` | `docker exec tv-backend printenv ALLOW_QUERY_DEVICE_TOKEN OBSERVE_QUERY_DEVICE_TOKEN` → `false` / `true` |
| 9.10 | **ACTUALIZADO:** `nginx -t` OK · `nexus_safe_query`=**4** (config endurecido desplegado: `frontend/nginx.conf` ← `nginx.conf.hardened`, imagen reconstruida y frontend recreado 16:02:15Z) | `docker exec tv-frontend nginx -t` → test successful; hash contenedor == hash local |
| 9.14/9.15/9.16 | **Mitigados con E2E sintético:** playback firmado GET/HEAD/Range 200/200/206 (directo y vía Nginx), preview admin 200/206, heartbeat válido 200 con `last_login` actualizado — **38/38 PASS pre y post despliegue**. La prueba con **hardware físico** sigue externa (Operaciones). | `FINAL-CLOSURE-2026-10-13.md` §6 |
| 9.17 | **Mitigado con E2E completo:** pairing vivo espera → `bind-screen` 200 con ACK → `assign_profile` → `promoted` → `admin:tv_bound`; **rotación** (original 401 / nuevo 200); **expiración** `pairing:expired` a 301 s; **recuperación tras reinicio** (`pending` → `expired` + `[Boot Reconciliation] 1…`). 13/13 PASS pre y post despliegue. El pairing con **admin + TV reales** sigue externo (Operaciones). | `FINAL-CLOSURE-2026-10-13.md` §7 |
| 9.18 | **EN OBSERVACIÓN (V3 desplegada):** telemetría activa con logs sin secretos (5 observaciones, 0 hex64, 0 tokens); canal legacy rechazado en vivo; **gap de logging de Nginx medido y cerrado** (antes: token en access log; después: 0 líneas sensibles). Cierre definitivo = V4 con dispositivos físicos reales (Operaciones, DEV-RUN-004 §13.2). | `DEV-RUN-004` §9.1, `DEPLOY-LOG` §14 |
| 9.19 | **RESUELTO (con decisión técnica):** `nx_tv`, `tv_user`, `ronald`, `nxtv`, `francisco` → `NOSUPERUSER NOLOGIN` (inertes, ensayo + simulacro de recuperación previos en QA); `tv` **conserva `SUPERUSER LOGIN`** como única cuenta DBA intencional (`POSTGRES_USER`, healthcheck, respaldos, migraciones, recuperación; no existe rol `postgres` en el volumen) con `NOCREATEDB NOCREATEROLE NOBYPASSRLS`. El **borrado definitivo** queda como paso del DBA. | `FINAL-CLOSURE-2026-10-13.md` §3 |

### 11.2 Ítems verificados de nuevo tras los cambios de la misión

| Verificación | Resultado |
|---|---|
| Roles: solo `tv` super+login; legacy `NOLOGIN NOSUPERUSER`; `nexus_app` intacto | ✅ VERIFICADO |
| `nexus_app`: `SELECT` 48 ok; `INSERT users` / `CREATE TABLE` / `ALTER ROLE` → denegados (42501) | ✅ VERIFICADO |
| `pg_dump` post-cambio → 86 entradas (`pg_restore --list`) | ✅ VERIFICADO |
| Backend `healthy` con `nexus_app` (sonda `tv-login`=401 tras recreación y tras reinicio de prueba) | ✅ VERIFICADO |
| Media anónimo 403 (directo y vía Nginx) tras recrear frontend | ✅ VERIFICADO |
| Logs de Nginx sin tokens/firmas tras despliegue endurecido (0 líneas sensibles) | ✅ VERIFICADO |
| Regresión completa post-todos-los-cambios | ✅ **187 tests: 184 pass / 0 fail / 3 skipped** (ffprobe/ffmpeg host), exit 0 |
| `npm audit --omit=dev` backend 0 · frontend 0 · build `vite` exit 0 · `node --check` exit 0 | ✅ VERIFICADO |
| Datos: fixtures E2E creados/usados/eliminados; conteos finales `48\|4\|8\|10\|132` = respaldo; residuos E2E = 0 | ✅ VERIFICADO |
| `tv-db` y volumen `tv_gsi_tv_pgdata` sin tocar durante toda la misión (única DB en loopback) | ✅ VERIFICADO |
