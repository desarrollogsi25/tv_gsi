# INFORME FINAL DE ACEPTACIÓN TÉCNICA — TV_GSI (Nexus TV Enterprise v2.2.0)

**Fecha:** 2026-10-13  
**Repositorio:** `tv_gsi`  
**Tag base:** `v2.2.0` (commit `43e8590a19388bb23f738b604c33d352b36e6aeb`)  
**Estado:** **ACEPTADO Y DESPLEGADO** — Ventana DEV-RUN-005 v1.1 ejecutada el 2026-10-13; despliegue aplicado y verificado en campo (ver §10)

---

## 1. Resumen ejecutivo

El proyecto `tv_gsi` (Nexus TV Enterprise) ha completado la fase de desarrollo y auditoría de seguridad mediante 5 misiones encadenadas, y la ventana de despliegue DEV-RUN-005 v1.1 se ejecutó y verificó el 2026-10-13. Todas las pruebas automatizadas pasan (**153/153**), los hallazgos de seguridad críticos han sido corregidos en código y aplicados al entorno activo.

**Estado general:** El sistema está **desplegado y verificado en el entorno activo**. Quedan pendientes: pruebas con credenciales/dispositivos reales (Operaciones), la campaña de verificación de campo de AUD-006 (DEV-RUN-004), el retiro de los roles superusuario legacy (DBA) y el sign-off de retención de respaldos.

---

## 2. Matriz final de hallazgos (consolidada)

| Hallazgo | Severidad | Estado final | Observación |
|---|---|---|---|
| **AUD-001** — Roles superusuario PostgreSQL | P1 Crítica | **Aplicado en DB activa / retiro legacy pendiente** | Migración 06 aplicada a producción el 2026-10-13: `nexus_app` con `super=false login=true`, 25 grants, DDL denegado (42501); backend conecta como `nexus_app` (sesión en `pg_stat_activity`). Pendiente: retirar `SUPERUSER` de `tv`/`nx_tv`/`tv_user` (DBA, con recuperación documentada) |
| **AUD-002** — Heartbeat anónimo | P1 Crítica | **Corregido y verificado en QA** | Autenticación criptográfica obligatoria vía `X-Device-Token`; 19 tests unitarios + integración QA pasan |
| **AUD-003** — `source-map-js` advisory | P1 Crítica | **Corregido y verificado** | Override a `1.2.2` en `package.json`; `npm audit` 0 vulnerabilidades; Node 24 LTS en Dockerfiles |
| **AUD-004** — Upload multimedia | P2 Alta | **Corregido y verificado** | Validación binaria multi-nivel + FFmpeg (`-err_detect explode`); 15 tests pasan (imágenes, video, truncados, corruptos, MIME mismatch, tamaño, limpieza huérfanos) |
| **AUD-005** — Pairing sin ACK | P2 Alta | **Corregido y desplegado en activo** | Migración 07 (`pending_pairings`) aplicada a producción el 2026-10-13, transacciones cortas, ACK explícito, reconciliación automática; 28 tests pasan |
| **AUD-006** — Token en query string WS | P2 Media | **Desplegado con rechazo por defecto / Pendiente de verificación de campo** | Backend desplegado con `ALLOW_QUERY_DEVICE_TOKEN=false` y `OBSERVE_QUERY_DEVICE_TOKEN=false` verificados en el contenedor activo; telemetría sin secretos; 32 tests; campaña de campo en DEV-RUN-004 — la clave **no** se habilita durante la observación |
| **AUD-007** — Multimedia pública | P2 Media | **Corregido y verificado en campo** | URLs firmadas HMAC-SHA256 desplegadas (middleware activo en `/media/*`): sin firma → **403** (antes 200) y firma inválida → **403** verificados en crudo en `:28080` y `:23002`; `nexus_safe_query` en Nginx; 20 tests SMU + regresión total 153/153 |
| **AUD-008** — Puerto PostgreSQL expuesto | P2 Operacional | **Aplicado y verificado en campo** | `tv-db` recreado el 2026-10-13T14:37:21Z con compose endurecido: `docker port tv-db 5432/tcp` → **solo `127.0.0.1:25432`** (antes `0.0.0.0` + `[::]`); volumen `tv_gsi_tv_pgdata` preservado con datos íntegros |

---

## 3. Evidencia de pruebas (cifras reales del runner)

| Suite | Tests | Pass | Fail | Skipped | Duración |
|---|---|---|---|---|---|
| `device-auth.test.js` (AUD-006) | 32 | 32 | 0 | 0 | ~1.1s |
| `signed-media-url.test.js` (AUD-007) | 20 | 20 | 0 | 0 | ~0.3s |
| `nginx-safe-logging.test.js` | 4 | 4 | 0 | 0 | ~0.1s |
| `pairing-session.test.js` | 5 | 5 | 0 | 0 | ~0.1s |
| `pairing-ack.test.js` | 28 | 28 | 0 | 0 | ~1.5s |
| `auth.test.js` | 4 | 4 | 0 | 0 | — |
| `rbac.test.js` | 14 | 14 | 0 | 0 | — |
| `playlist-auth.test.js` | 6 | 6 | 0 | 0 | — |
| `playlist-playback.test.js` | 5 | 5 | 0 | 0 | — |
| `tv-heartbeat.test.js` | 11 | 11 | 0 | 0 | — |
| `schedule-window.test.js` | 5 | 5 | 0 | 0 | — |
| `normalize-days.test.js` | 4 | 4 | 0 | 0 | — |
| `media-upload.test.js` (AUD-004) | 15 | 15 | 0 | 0 | ~1.0s |
| **TOTAL** | **153** | **153** | **0** | **0** | **~4.5s** |

*Cifras re-verificadas por suite en la ejecución final post-ventana (13 suites, 153/153, 0 fallos), sustituyendo al recuento previo a la ventana.*

**Validaciones offline adicionales:**
- `node --check` en todos los archivos modificados: **OK**
- `git diff --check`: **clean** (exit 0)
- `nginx -t` (producción y hardened): **syntax OK / test successful**
- `npm audit` backend/frontend: **0 vulnerabilidades**

---

## 4. Arquitectura de seguridad implementada

### 4.1 Autenticación de dispositivos (AUD-002, AUD-006)
- **Canal principal:** `socket.handshake.auth.device_token` / header `X-Device-Token`
- **Rechazo por defecto:** `ALLOW_QUERY_DEVICE_TOKEN=false` — credencial en query string rechazada con error explícito
- **Telemetría sin aceptación:** `OBSERVE_QUERY_DEVICE_TOKEN` registra intentos rechazados sin aceptar credencial ni registrar token/URI
- **Fallback explícito:** `ALLOW_QUERY_DEVICE_TOKEN=true` solo con aprobación, emite advertencia censurada (`tv_uuid` + canal)
- **Validación criptográfica:** `verifyDeviceToken` (HMAC-SHA256 timing-safe) contra hash en BD

### 4.2 Multimedia segura (AUD-007)
- **Middleware HMAC:** `signedMediaUrlMiddleware` en Express (`/media/*`) valida HMAC-SHA256 antes de `express.static()`
- **Propósitos:** `tv_playback` (TTL 1–4h, binding `tv_uuid`) + `admin_preview` (TTL 30 min, sin binding)
- **Endpoints emisores:** `/api/tv/:tv_uuid/playback-url/:contentId` (TV) + `/api/admin/media/preview-url/:contentId` (Admin RBAC)
- **Nginx:** Proxy `/media/` → backend; `log_format nexus_safe_query` usa `$uri` (sin query string); access log seguro en `/var/log/nginx/media_access.log`
- **Streaming:** `GET` + `HEAD` + `Range` + `206 Partial Content` preservados nativamente

### 4.3 Pairing seguro (AUD-005)
- Migración `07_pending_pairings.sql`: tabla `pending_pairings` con TTL 60s, estado `pending/promoted/expired/cancelled`
- Transacción 1 (corta): registra hash pendiente → COMMIT → emite `command:assign_profile` por Socket.IO
- Transacción 2 (corta): tras ACK (`tv:pairing_confirmed`), promueve hash a `tv_screens.device_token_hash`
- Reconciliación automática cada 1 min + al arranque: limpia `pending` vencidos
- Fail-safe: si falta tabla → HTTP 503 `PAIRING_SCHEMA_NOT_MIGRATED`

### 4.4 Mínimo privilegio PostgreSQL (AUD-001)
- Migración `06_runtime_user.sql`: rol `nexus_app` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`)
- Grants: DML sobre tablas de negocio, SELECT en `users`, USAGE en secuencias
- Denegado: DDL, TRUNCATE, ALTER ROLE, mutación secuencias admin
- Validado en QA aislado (puerto 25499): 11 subtests pasan (CRUD OK, DDL/TRUNCATE denegados con 42501)

---

## 5. Riesgos residuales y pasos operativos pendientes

| Riesgo | Estado | Acción requerida |
|---|---|---|
| **AUD-001**: Rol `tv` sigue `SUPERUSER` en producción | **Parcialmente cerrado** | `nexus_app` ya opera en producción (2026-10-13); pendiente: revocar `SUPERUSER` de `tv`/`nx_tv`/`tv_user` con runbook de recuperación (DBA) |
| **AUD-006**: Compatibilidad hardware físico no verificada | **Pendiente** | Inventario físico + ventana de observación DEV-RUN-004 con `OBSERVE_QUERY_DEVICE_TOKEN`; `ALLOW_QUERY_DEVICE_TOKEN=false` se mantiene durante toda la observación |
| **AUD-007**: Clave HMAC / Nginx | **Cerrado en ventana** | `MEDIA_URL_SIGNING_KEY` (64 hex) provisionada y gate `KEY_OK`; `frontend/nginx.conf` desplegado; 403 verificados en campo |
| **AUD-008**: Contenedor `tv-db` publica en `0.0.0.0:25432` | **Cerrado en ventana** | `tv-db` recreado (2026-10-13T14:37:21Z); solo `127.0.0.1:25432` verificado con `docker port` |
| **AUD-006/007**: Logging Nginx endurecido | **Cerrado en ventana** | `nexus_safe_query` desplegado (2 ocurrencias), `nginx -t` test successful |

---

## 6. Procedimiento de despliegue consolidado (resumen DEV-RUN-005)

Ver runbook completo: [`docs/07-operations/runbooks/DEV-RUN-005-release-hardening-and-go-live.md`](../../07-operations/runbooks/DEV-RUN-005-release-hardening-and-go-live.md)

**Resumen de pasos:**
1. Respaldo PostgreSQL verificable (`pg_dump` + `pg_restore` test)
2. Generar `MEDIA_URL_SIGNING_KEY` (`openssl rand -hex 32`) → provisionar en secret manager
3. Aplicar migraciones 06 + 07 en orden (psql directo sobre contenedor DB)
4. Build imágenes Docker (Node 24, FFmpeg) → deploy backend → frontend
5. Verificar healthchecks, conectividad, puerto DB loopback
6. Pruebas funcionales: TV playback, admin preview, signed URLs, Range, heartbeat, pairing
7. Validar logs sin firmas/tokens, puerto DB loopback
8. Rollback plan documentado (restauración DB + imágenes previas)

---

## 7. Documentación generada (trazabilidad completa)

| Archivo | Descripción |
|---|---|
| `docs/13-testing/results/AUDIT-FULL-2026-10-09.md` | Informe maestro consolidado (secciones 1–26, addendum post-ventana en §26) |
| `docs/13-testing/results/FINAL-ACCEPTANCE-REPORT-2026-10-13.md` | **Este informe** |
| `docs/13-testing/results/DEPLOY-LOG-2026-10-13.md` | **Registro del despliegue (ventana 2026-10-13)** |
| `docs/13-testing/results/POST-DEPLOY-VERIFICATION-2026-10-13.md` | **Verificación post-despliegue (checklist §9)** |
| `docs/13-testing/results/MISSION-5-VERIFICATION-REPORT-2026-10-13.md` | Verificación detallada AUD-007 |
| `docs/01-architecture/decisions/ADR-006-media-access-policy.md` | Política multimedia (Opción B aprobada) |
| `docs/07-operations/runbooks/DEV-RUN-004-aud006-query-token-retirement.md` | Retirada AUD-006 v1.1 |
| `docs/07-operations/runbooks/DEV-RUN-005-release-hardening-and-go-live.md` | **Runbook consolidado de despliegue** |
| `src/utils/signedMediaUrl.js` | HMAC-SHA256 signing/validation middleware |
| `tests/signed-media-url.test.js` | 20 tests unitarios AUD-007 |
| `tests/nginx-safe-logging.test.js` | 4 tests validación offline Nginx |

---

## 8. Verificación final de integridad

> **Alcance:** verificación de la fase de desarrollo/aceptación previa a la ventana, actualizada con la ejecución final post-ventana (cifras de §3 y resultados de §10).

- [x] **153/153 tests PASS** (ejecución final post-ventana, desglosada por suite en §3)
- [x] `git diff --check`: **clean** (exit 0)
- [x] `node --check` en todos los archivos modificados: **OK**
- [x] `nginx -t` (producción + hardened): **syntax OK / test successful**
- [x] `npm audit` backend/frontend: **0 vulnerabilidades**
- [x] `git diff --check`: **clean**
- [x] **Sin secretos en diffs** (claves documentadas como `REPLACE_WITH_...`)
- [x] **Cero commits, pushes, cambios de rama**
- [x] **Cero escrituras/alteraciones en PostgreSQL activo ni volúmenes** *(fase previa a la ventana; la ventana ejecutó las migraciones 06/07 de forma controlada y preservó el volumen)*
- [x] **Cero reinicios/recreaciones de contenedores operativos** *(fase previa a la ventana; la ventana recreó `tv-backend`, `tv-frontend` y `tv-db` según runbook aprobado)*

---

## 9. Dictamen final

> **ACEPTACIÓN TÉCNICA CONCEDIDA — DESPLIEGUE COMPLETADO Y VERIFICADO**
>
> El código de `tv_gsi` (Nexus TV Enterprise v2.2.0) ha superado todas las validaciones técnicas, de seguridad y de regresión requeridas (153/153). Los 8 hallazgos de auditoría conservan sus IDs: **7 de ellos aplicados o verificados en el entorno activo** (AUD-001 aplicación parcial con retiro legacy pendiente, AUD-002, AUD-003, AUD-004, AUD-005, AUD-007, AUD-008) y **AUD-006 desplegado con verificación de campo pendiente** (campaña DEV-RUN-004).
>
> La ventana `DEV-RUN-005` v1.1 se ejecutó el **2026-10-13**: respaldo verificado, migraciones 06 → 07, build y despliegue, recreación de `tv-db` en loopback y verificación completa en crudo. Evidencia en `DEPLOY-LOG-2026-10-13.md` y `POST-DEPLOY-VERIFICATION-2026-10-13.md`.
>
> **Quedan como pendientes explícitos** (no bloquean la aceptación): pruebas con credenciales/dispositivos reales a cargo de Operaciones (playback TV, preview admin, heartbeat, pairing E2E), la campaña de campo de AUD-006, el retiro de los roles superusuario legacy (DBA) y el sign-off de retención de `backups/` y etiquetas `pre-v2.2.0`.

---

## 10. Resultados de la ventana operativa (2026-10-13)

Ejecutada según `DEV-RUN-005` v1.1. Evidencia completa: [`DEPLOY-LOG-2026-10-13.md`](./DEPLOY-LOG-2026-10-13.md) y [`POST-DEPLOY-VERIFICATION-2026-10-13.md`](./POST-DEPLOY-VERIFICATION-2026-10-13.md).

| Hito | Resultado |
|---|---|
| Respaldo verificado | `backups/nexus_tv_20261013_161056.dump` (24.424 bytes), SHA-256 `ACE8954697FE43881C8557219D4C48EEE10C8B6302E4DAA8C4C01A2CA8FC9018`; restauración en QA efímera → `BACKUP_VERIFIED_OK` |
| Migraciones 06 → 07 | exit 0 / exit 0: `nexus_app` (`super=false login=true`, 25 grants, DDL 42501 denegado) + `pending_pairings` presente |
| Despliegue backend/frontend | Build exit 0; backend Node v24.21.0 como `nexus_app`, `ALLOW/OBSERVE_QUERY_DEVICE_TOKEN=false`, `KEY_LEN=64`; `nginx -t` OK, `nexus_safe_query=2` |
| AUD-007 en campo | Media sin firma → **403** (antes 200) en `:28080` y `:23002`; firma inválida → **403** |
| AUD-008 en campo | `tv-db` recreado (2026-10-13T14:37:21Z): **solo `127.0.0.1:25432`**; volumen `tv_gsi_tv_pgdata` preservado, datos `48\|4\|8\|10\|132` íntegros |
| Pool / identidad de app | Sonda de login → **401** (≠ 5xx); **1 sesión** `nexus_app` en `pg_stat_activity` |
| Regresión final | **153/153 pass, 0 fail** (SMU 20/20); `git diff --check` = 0 |
| Restricciones | Sin commits/pushes/cambios de rama; sin `down -v` ni borrado de volúmenes; sin secretos impresos |
| ⏳ Bloqueados (Operaciones) | Playback TV real (GET/HEAD/Range), preview admin, heartbeat y pairing E2E con credenciales reales |

---

## 11. Cierre de la MISIÓN FINAL (2026-10-13, tarde)

> Evidencia completa: [`FINAL-CLOSURE-2026-10-13.md`](./FINAL-CLOSURE-2026-10-13.md) · matriz definitiva en [`AUDIT-FULL-2026-10-09.md`](./AUDIT-FULL-2026-10-09.md) §27.

### 11.1 Estados definitivos AUD-001 … AUD-008

| Hallazgo | Estado definitivo | Síntesis de la evidencia de cierre |
|---|---|---|
| **AUD-001** | **CERRADO — corregido y verificado en DB activa** | 5 roles legacy → `NOSUPERUSER NOLOGIN` (ensayo + recuperación en QA previos); `tv` única cuenta DBA justificada con flags reducidos; `nexus_app` con SELECT ok y `INSERT/CREATE/ALTER ROLE` denegados; sonda real 401; `pg_dump` post-cambio OK |
| **AUD-002** | **CERRADO — verificado en producción** | Heartbeat válido 200 (+`last_login`), inválido 401, ausente 401; doble verificación en código |
| **AUD-003** | **CERRADO — verificado** | `npm audit` backend y frontend: **0 vulnerabilidades** |
| **AUD-004** | **CERRADO — verificado** | Suite de upload en regresión sin fallos; ffprobe/ffmpeg reales en contenedor |
| **AUD-005** | **CERRADO — verificado en producción** | Pairing E2E completo + rotación (401/200) + expiración 301 s + reconciliación al arranque (`[Boot Reconciliation] 1…`) + fail-safe 503 sin esquema |
| **AUD-006** | **DESPLEGADO Y OBSERVADO — pendiente de verificación externa** | `ALLOW=false` permanente; `OBSERVE=true` desde 15:25:28Z (5 observaciones sin secretos); cliente oficial sin query; **logging de Nginx medido, cerrado y verificado** (antes: token en access log; después: 0 líneas sensibles, `nexus_safe_query` 2→4). Cierre = campaña de campo con hardware real (Operaciones) |
| **AUD-007** | **CERRADO en lo verificable** | E2E **38/38 pre y post despliegue**: GET/HEAD/Range 200/200/206 directo y vía Nginx, negativos 403, preview admin, autorización por playlist (403 fuera de playlist), logs sin firmas. Pendiente externo: TV física + credenciales reales |
| **AUD-008** | **CERRADO — verificado en campo** | `127.0.0.1:25432` único, YAML == contenedor, volumen intacto |

### 11.2 Pruebas y gates de cierre (cifras reales de esta ejecución)

- **Regresión completa:** `npm test` → 187 tests, **184 pass / 0 fail / 3 skipped** (ffprobe/ffmpeg host), exit 0. (Primer intento con 1 fallo de runner IPC no reproducible; documentado como flake en el informe de cierre.)
- **E2E vivo:** 38 (HTTP) + 13 (sockets/pairing) + expiración 301 s + reconciliación post-reinicio — todos en verde, repetidos tras el despliegue del Nginx endurecido.
- **Auditorías:** `npm audit` 0/0 · build `vite` exit 0 · `nginx -t` OK · `node --check` OK · escaneo de secretos 0.
- **Respaldo de la misión:** `backups/nexus_tv_20261013_171557.dump` (29.925 bytes), SHA-256 `EDB0F0D80D55371086F51C8DF6EB5C64A82C194E3F56890B7B0EA40F8A6A9FE7`, restauración en QA → `BACKUP_VERIFIED_OK`.
- **Datos:** fixtures E2E creados, usados y eliminados; conteos finales **idénticos al respaldo** `48|4|8|10|132`.
- **Despliegues de la misión:** backend recreado con `OBSERVE=true` (15:25:28Z); frontend reconstruido con `frontend/nginx.conf` endurecido (16:02Z); `tv-db` y volumen sin tocar.

### 11.3 Publicación

Los commits y la verificación remota quedan registrados en [`FINAL-CLOSURE-2026-10-13.md`](./FINAL-CLOSURE-2026-10-13.md) §13: 4 commits publicados en `origin/main` (`8700535`, `85fd098`, `2661b97`, `e150f66`), SHA remoto verificado == local, etiquetas intactas, árbol limpio.

---

**Firma de aceptación técnica:** _________________________  
**Fecha:** 2026-10-13  
**Responsable:** Senior Software, Security & QA Engineer