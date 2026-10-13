# Registro de despliegue — 2026-10-13

**Ventana operativa:** DEV-RUN-005 v1.1 — *Release hardening and go-live*
**Runbook fuente:** `docs/07-operations/runbooks/DEV-RUN-005-release-hardening-and-go-live.md` (v1.1, 14 correcciones C1–C14)
**Entorno:** Nexus TV (`tv_gsi`) — stack operativo `tv-backend`, `tv-frontend`, `tv-db`
**Resultado de la ventana:** ✅ **COMPLETADA** — despliegue aplicado y verificado en campo; sin commits, sin pushes, sin cambios de rama.

> Nota de reloj: el nombre del dump usa la hora local del host; los logs de contenedores y `docker inspect` usan UTC. En esta sesión el reloj UTC marcaba ≈2 h por debajo de la hora local. Los tiempos marcados con ≈ son estimaciones de orden; los demás son timestamps observados directamente en la salida de las herramientas.

---

## 1. Preflight (solo lectura) — estado pre-despliegue

Verificado en crudo antes de ejecutar cualquier operación activa:

| Comprobación | Resultado pre-despliegue |
|---|---|
| Contenedores | `tv-backend`, `tv-frontend`, `tv-db` — los 3 **healthy** |
| Node en imagen backend | v20.20.2; sin `src/utils/signedMediaUrl.js`; `grep 'query string is rejected'` = **0** |
| Directiva nginx `nexus_safe_query` | **0** (ausente en `frontend/nginx.conf`) |
| Roles DB | `tv`, `nx_tv`, `tv_user` → `super=true`; **`nexus_app` ausente** |
| `nexus_tv.pending_pairings` | **ausente** (migración 07 no aplicada) |
| Media anónimo (archivo real) | **HTTP 200** en `:23002` y `:28080` → exposición confirmada (AUD-007) |
| Puerto `tv-db` | **`0.0.0.0:25432` + `[::]:25432`** → expuesto en todas las interfaces (AUD-008) |
| `pg_hba.conf` | `local/loopback` con `trust`; `host` con `scram-sha-256` |
| `docker compose config -q` | exit **0** |
| `.env` | 801 bytes legacy; `PG_ADMIN_USER`, `PG_APP_PASSWORD`, `MEDIA_URL_SIGNING_KEY` **ausentes** (conteos 0) |
| Git (previo) | `git diff --check` = 0; 30 archivos rastreados modificados + artefactos sin seguimiento |

## 2. Fase A — Retiro de la pila de pruebas MISIÓN 5B (≈15:52 local)

Ejecutado a petición del usuario antes de tocar el entorno activo:

- Contenedores eliminados: `nginx-integration-test`, `backend-integration-test`, `db-integration-test`
- Red eliminada: `tv_gsi_test-network`
- Imagen desetiquetada y eliminada: `tv_gsi-backend-test` (`sha256:c0bb082d…`)

Stack operativo `tv-*` no afectado (verificado healthy tras el retiro).

## 3. Fase B — Preparación de `.env` y gates

- `PG_ADMIN_USER=tv` añadido (la línea llegó pegada a otra durante la escritura; corregida antes de continuar).
- `PG_APP_PASSWORD` → 48 hex; `MEDIA_URL_SIGNING_KEY` → 64 hex. Generados con `RNGCryptoServiceProvider` (el método estático `RandomNumberGenerator.GetBytes` no existe en PowerShell 5.1) y escritos con códec ISO-8859-1 byte-safe.
- **Gates de salida (todos exit 0):**
  - `PG_ADMIN_USER=tv` → 1/1
  - `PG_APP_PASSWORD` formato 48-hex → 1/1
  - `MEDIA_URL_SIGNING_KEY` formato 64-hex → 1/1
  - Variables vacías → 0
  - `docker compose config -q` → exit 0
- Los valores **no se registran** en este documento (conteos/formatos únicamente).

## 4. Fase C — Respaldo y verificación de restauración

| Campo | Valor |
|---|---|
| Nombre del dump | `backups/nexus_tv_20261013_161056.dump` (16:10:56 hora local del host) |
| Tamaño | **24.424 bytes** |
| SHA-256 | `ACE8954697FE43881C8557219D4C48EEE10C8B6302E4DAA8C4C01A2CA8FC9018` |
| Origen (conteos) | `48\|4\|8\|10\|132` (content / playlists / screens / users / playlist_content) |
| Verificación de restauración | Instancia QA efímera `127.0.0.1:25497` (PostgreSQL con `trust` local): restauración con `--clean --if-exists --no-owner --no-acl` → **OK en el intento 1** |
| Post-restauración | `RESTAURADO` = `48\|4\|8\|10\|132` idéntico al origen → **`BACKUP_VERIFIED_OK`** |
| Limpieza QA | Contenedor y volumen QA eliminados; el dump temporal copiado dentro de `tv-db` fue borrado |
| DB marcador QA | `127.0.0.1:25499` (contexto `tests/qa-guard.js`) **no** se usó para la prueba de restauración |

## 5. Fase D — Migraciones 06 y 07 (orden 06 → 07, corrección C2 del runbook)

| Paso | Comando/objeto | Resultado |
|---|---|---|
| Migración 06 | `migrations/06_runtime_user.sql` | exit **0** — `CREATE ROLE nexus_app`, `ALTER ROLE` (login, NOINHERIT), 12× `GRANT`, 2× `REVOKE` |
| Migración 07 | `migrations/07_pending_pairings.sql` | exit **0** — `CREATE TABLE nexus_tv.pending_pairings`, 2× `CREATE INDEX`, bloque `DO` de grants |
| D5 — flags del rol | `pg_roles` | `nexus_app` → `super=false`, `login=true` |
| D5 — objeto | `to_regclass('nexus_tv.pending_pairings')` | **presente** |
| D5 — grants | recuento sobre `information_schema` | **25** (mínimo exigido ≥7) |
| D6 — login por socket | `pending_pairings` con `nexus_app` vía socket | **0** (esperado: sin acceso por socket) |
| D7 — login scram por red | `psql` contra `127.0.0.1:25432` vía red `tv_gsi_tv_network` como `nexus_app` | **OK** — autenticación `scram-sha-256` aceptada *(corrección D7 aplicada en caliente: `PGAPPASSWORD` debe mapearse desde `PG_APP_PASSWORD` de la sesión antes de `docker run -e`)* |
| D8 — DDL denegado | `CREATE TABLE` de prueba como `nexus_app` | exit **1**, `ERROR: permission denied for schema nexus_tv` (SQLSTATE 42501) ✅ |

## 6. Fase E — Build y despliegue

| Paso | Resultado |
|---|---|
| E1 — Etiquetado previo | `tv_gsi-backend:pre-v2.2.0` y `tv_gsi-frontend:pre-v2.2.0` creadas; `docker-compose.yml` copiado a `backups/docker-compose.yml.pre-deploy` |
| E2 — Build | exit **0**; manifiesto backend `sha256:29e0640af875…` |
| E3 — Gate de clave | **`KEY_OK`** (`MEDIA_URL_SIGNING_KEY` presente, 64 hex, sin placeholder) |
| E4 — Backend | Recreado → **healthy** |
| E5 — Verificación cruda backend | `PG_APP_USER=nexus_app` · `ALLOW_QUERY_DEVICE_TOKEN=false` · `OBSERVE_QUERY_DEVICE_TOKEN=false` · `PG_APP_PASSWORD_LEN=48` · `KEY_LEN=64` · `SIGNED_URL_MODULE=present` · `grep 'query string is rejected'` = **1** · Node **v24.21.0** |
| E6 — Frontend | Recreado → **healthy** |
| E7 — nginx | `nginx -t` → **test successful** (solo el warning estándar `user` al ejecutar como no-root; log `2026/10/13 14:18:40` reloj del contenedor) · directiva `nexus_safe_query` = **2** ocurrencias · `proxy_pass http://backend:3002` = **4** |

## 7. Fase F — Recreación de `tv-db` en loopback (con incidente)

### 7.1 Incidente F3 — primera recreación NO aplicada

La primera ejecución del paso `docker compose up -d --force-recreate db` quedó **interrumpida/incompleta** (salida de shell corrupta en esa tanda; el intento terminó con `compose failed: no such service: db`). La verificación posterior en crudo demostró que **el contenedor no se había recreado**:

```
created=2026-10-08T15:27:48.97905288Z   started=2026-10-10T14:56:43.6407288Z
PortBindings = {"5432/tcp":[{"HostIp":"","HostPort":"25432"}]}   ← 0.0.0.0, pre-ventana
printenv PG_APP_USER → (vacío)                                   ← compose antiguo
.env: menciones de HOST_DB_BIND = 0                               ← Compose usa default 127.0.0.1
```

**El gate de campo atrapó la regresión:** AUD-008 seguía sin aplicarse pese a que la ejecución interrumpida había dado señales contradictorias. Los datos de la DB estaban intactos (`48|4|8|10|132`, `pending_pairings` presente, `nexus_app` no-superuser, 1 sesión activa de `nexus_app` → el corte del backend en E4 sí estaba vigente).

### 7.2 Recreación efectiva (aprobada en la ventana)

`docker compose up -d --force-recreate db` re-ejecutado con verificación posterior:

```
Container tv-db Recreated / Started
tv-db estado=healthy intentos=2
created=2026-10-13T14:37:21.880793576Z
PortBindings = {"5432/tcp":[{"HostIp":"127.0.0.1","HostPort":"25432"}]}
docker port tv-db 5432/tcp → 127.0.0.1:25432
printenv PG_APP_USER → nexus_app     printenv POSTGRES_USER → tv
```

- Volumen **`tv_gsi_tv_pgdata` preservado** (sin `down -v`, sin borrado, sin re-init; los scripts init no re-ejecutan sobre volumen existente).

### 7.3 Verificación post-recreación

| Comprobación | Resultado |
|---|---|
| Datos (conteos) | `48\|4\|8\|10\|132` ✅ intactos |
| `pending_pairings` | presente ✅ |
| `nexus_app` | `super=false` ✅ |
| API | `{"status":"online",...,"version":"2.0.0"}` ✅ |
| Pool del backend | Sonda de login con uuid inexistente → **HTTP 401** (no 5xx) = la pool consultó la DB y rechazó; **1 sesión** de `nexus_app` en `pg_stat_activity` ✅ |
| `pg_isready` | `accepting connections` ✅ |
| Media anónimo post-recreación | **HTTP 403** ✅ |

*Nota de sonda:* el primer intento de login devolvió **400** con `SyntaxError ... JSON at position 1` en los logs — artefacto del bug de PowerShell 5.1 que elimina comillas incrustadas en argumentos de procesos nativos (el JSON llegó sin comillas). Repetido con payload en fichero (`-d "@archivo"`), devolvió **401**. No es un defecto de la aplicación.

## 8. Fase G — Verificación post-despliegue (resumen; detalle en `POST-DEPLOY-VERIFICATION-2026-10-13.md`)

Ejecutada en crudo tras la recuperación del shell de la sesión:

| Probe | Resultado |
|---|---|
| `GET /media/<archivo real>` sin firma — `:28080` (frontend) | **403** (pre-despliegue: 200) |
| `GET /media/<archivo real>` sin firma — `:23002` (backend) | **403** (pre-despliegue: 200) |
| `GET /media/<archivo>?token=00&exp=…&purpose=tv_playback` (firma inválida) | **403** |
| `GET /api/status` | `{"status":"online","message":"Nexus TV API v2 is running.","version":"2.0.0"}` |
| `docker port tv-db 5432/tcp` | **`127.0.0.1:25432`** exclusivamente (recreación efectiva §7.2) |

## 9. Regresión final (por suite, ejecución en crudo)

| Suite | pass | fail |
|---|---:|---:|
| `device-auth` | 32 | 0 |
| `nginx-safe-logging` | 4 | 0 |
| `signed-media-url` | 20 | 0 |
| `pairing-session` | 5 | 0 |
| `pairing-ack` | 28 | 0 |
| `auth` | 4 | 0 |
| `rbac` | 14 | 0 |
| `playlist-auth` | 6 | 0 |
| `playlist-playback` | 5 | 0 |
| `tv-heartbeat` | 11 | 0 |
| `schedule-window` | 5 | 0 |
| `normalize-days` | 4 | 0 |
| `media-upload` | 15 | 0 |
| **TOTAL** | **153** | **0** |

- SMU: **20/20** (incluye SMU-19/SMU-20 del hardening de `getSigningKey()`).
- Validaciones offline: `node --check` OK; `nginx -t` OK (ambas configs); `git diff --check` = **0** (múltiples ejecuciones en sesión).
- **Nota N1:** el runner `node --test` del host (Node 20.18.0) produjo en ejecuciones intermedias fallos de transporte IPC con **0 fallos de aserción**; clasificado como artefacto del runner, no del código. La ejecución guardada final es 153/153 exit 0.

## 10. Gates de la ventana — códigos de salida

| Gate | Salida |
|---|---|
| A0 — pila de pruebas retirada | exit 0 (5 recursos eliminados) |
| B — `PG_ADMIN_USER` / password 48-hex / key 64-hex / vacías=0 | 1/1, 1/1, 1/1, 0 |
| B — `docker compose config -q` | exit 0 |
| C — `pg_dump` | exit 0 (`DUMP_OK`) |
| C — restauración QA | `BACKUP_VERIFIED_OK` (intento 1) |
| D — migración 06 | exit 0 |
| D — migración 07 | exit 0 |
| D8 — DDL denegado | exit 1 con 42501 (comportamiento esperado) |
| E2 — build | exit 0 |
| E3 — `KEY_OK` | gate en verde |
| F — recreación `tv-db` | `healthy` en 2 intentos + binding `127.0.0.1` verificado |
| G — probes HTTP | 403 / 403 / 403 + API online |
| Regresión final | 153 pass / 0 fail |
| `git diff --check` | exit 0 |

## 11. Incidentes y desviaciones (todos documentados)

1. **D7 (en caliente):** `PGAPPASSWORD` no se propagaba a `docker run -e` — runbook corregido en v1.1 (mapeo explícito desde `PG_APP_PASSWORD`).
2. **PS 5.1:** `curl` es alias de Invoke-WebRequest (usar `curl.exe`); no hay `&&`; las comillas incrustadas en argumentos de procesos nativos se eliminan (payloads JSON vía fichero); `RandomNumberGenerator.GetBytes` estático no existe (usar `RNGCryptoServiceProvider`).
3. **F3 no aplicado (§7.1):** primera recreación de `tv-db` interrumpida; detectada por verificación en crudo (`docker inspect .Created` + `docker port`) y resuelta re-ejecutando la recreación (§7.2). **Lección incorporada al runbook:** verificar además del estado `healthy` que `.Created` corresponde a un contenedor nuevo de la ventana.
4. **Nota N1:** flake IPC del runner de pruebas del host (sin fallos de aserción).

## 12. Artefactos y etiquetas conservados

- `backups/nexus_tv_20261013_161056.dump` + SHA-256 (§4)
- `backups/docker-compose.yml.pre-deploy`
- Etiquetas de rollback: `tv_gsi-backend:pre-v2.2.0`, `tv_gsi-frontend:pre-v2.2.0` (además de `:latest` post-build)
- Retención: decisión de purga de `backups/` y de las etiquetas `pre-v2.2.0` → **pendiente de sign-off** (no se purga nada en esta ventana)

## 13. Restricciones respetadas

- ❌ Sin `git commit` / `git push` / cambio de rama — todos los cambios quedan **sin commitear** en el workspace.
- ❌ Sin `docker compose down -v`, sin borrado de volúmenes, sin re-init de PostgreSQL — `tv_gsi_tv_pgdata` preservado y con datos íntegros.
- ❌ Sin secretos impresos: solo nombres de variable, formatos y conteos.
- ❌ Sin `|| true` ni fallos ocultos: todos los gates con `$LASTEXITCODE` y `throw`.
- ⏳ **Bloqueado por falta de credenciales reales** (asignado a Operaciones): reproducción en TV real (GET/HEAD/Range), preview de admin, heartbeat y pairing E2E. Ver `POST-DEPLOY-VERIFICATION-2026-10-13.md` §9.

> **Nota de la MISIÓN FINAL (2026-10-13, tarde):** la restricción de commits/pushes de §13 correspondía a la ventana y fue **levantada explícitamente** por el mandato de cierre (commits y publicación autorizados). Las operaciones de cierre se registran en §14.

## 14. Operaciones de la MISIÓN FINAL (2026-10-13, tarde)

| Hora (UTC aprox.) | Operación | Resultado |
|---|---|---|
| ~15:15 | Respaldo previo a cambios: `backups/nexus_tv_20261013_171557.dump` (29.925 bytes), SHA-256 `EDB0F0D8…A6A9FE7`, `pg_restore --list` 86 | exit 0 |
| ~15:17 | Restauración en QA efímero 127.0.0.1:25497 (incidencia: gap de init del entrypoint + `docker exec` sin `PGUSER`; resuelto con espera y `PGUSER=qa_restore`) | `RESTORE_OK`, conteos `48\|4\|8\|10\|132`, `BACKUP_VERIFIED_OK`, QA destruido |
| ~15:19 | Ensayo de cambios de roles en QA + simulacro de recuperación (`ALTER ROLE francisco SUPERUSER LOGIN` como `tv`) | estado objetivo + recuperación reversible |
| ~15:21 | **AUD-001 aplicado en activo:** `nx_tv`/`tv_user`/`ronald`/`nxtv`/`francisco` → `NOSUPERUSER NOLOGIN`; `tv` → `NOCREATEDB NOCREATEROLE NOBYPASSRLS` (conserva `SUPERUSER LOGIN` como DBA único justificado) | ALTER exit; verificación: propiedad intacta, DML 48 ok, `INSERT/CREATE/ALTER ROLE` denegados, sonda 401, `pg_dump` 86 |
| 15:25:28 | `OBSERVE_QUERY_DEVICE_TOKEN=true` en `.env` + `docker compose up -d --force-recreate backend` | healthy intento 1; `ALLOW=false OBSERVE=true KEY_LEN=64` |
| ~15:30–15:40 | Fixtures E2E (`E2E-MISSION-DEV`, `e2e_mission_*`, `E2E-MISSION-PLAYLIST`) + batería E2E-1 | **38/38 PASS** |
| ~15:41 | E2E-2 (sockets/pairing/rotación) | **13/13 PASS** |
| ~15:46 | Expiración de sesión de pairing en vivo (TTL real 5 min; primer intento de 75 s insuficiente — error de guion) | `pairing:expired` a **301 s** |
| ~15:50 | Regresión completa + auditorías + `node --check` | 187 tests: 184 pass/0 fail/3 skip (1er intento con flake IPC del runner, no reproducido); `npm audit` 0/0; `nginx -t` OK |
| ~15:55 | **Recuperación tras reinicio:** fila `pending` vencida → `docker compose restart backend` | `expired` + log `[Boot Reconciliation] 1…`; API online, sonda 401, media 403 |
| ~16:00 | **Medición del gap de logging Nginx:** sonda con `device_token` en query vía `:28080` | backend rechaza **pero** el access log registró `device_token=…` (1 línea) |
| 16:02 | **Despliegue del Nginx endurecido:** `frontend/nginx.conf` ← `nginx.conf.hardened`, `docker compose build frontend` + `--force-recreate` | healthy intento 2; `nginx -t` OK; `nexus_safe_query` 2→4; hash contenedor==local |
| ~16:04 | Verificación después: misma sonda | rechazo intacto (observación #5), **0 líneas sensibles** en logs nuevos, handshake válido por Nginx → `connect` |
| ~16:05 | E2E-1 y E2E-2 repetidos post-despliegue | **38/38** y **13/13** PASS |
| ~16:07 | Limpieza de fixtures + ficheros temporales de token | residuos E2E = 0; conteos finales `48\|4\|8\|10\|132` = respaldo |
| ~16:10+ | Documentación (`FINAL-CLOSURE-2026-10-13.md`, addenda §27/§11/§14/§11, DEV-RUN-004 actualizado) y publicación | ver §13 de `FINAL-CLOSURE-2026-10-13.md` |

**Incidentes de la misión (todos en `FINAL-CLOSURE-2026-10-13.md` §10):** interrupción del primer restore QA (entrypoint + `PGUSER`), dos fallos propios del guion E2E (formato de token y body de login), aserción de `Content-Range`, flake IPC del runner, gap de logging de Nginx (cerrado), rollback de transacción multistatement en fixtures, bug npm de opcionales en build local. Ninguno oculto; ninguno afectó datos reales.
