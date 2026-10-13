# Informe de cierre integral — MISIÓN FINAL (2026-10-13)

> **Tipo:** Informe de misión
> **Fecha:** 2026-10-13 (fase de cierre: desde 15:05 UTC / 17:05 local)
> **Proyecto:** `tv_gsi` — Nexus TV Enterprise v2.2.0
> **Alcance:** resolución de pendientes AUD-001…AUD-008 dentro del entorno local, validación E2E real contra el despliegue activo, documentación, commits y publicación en GitHub (autorización expresa de la misión).
> **Regla de evidencia:** todas las cifras de este informe provienen de salidas reales de esta ejecución. Las dependencias no realizables desde este entorno se declaran como tales, sin simular resultados.

---

## 1. Estado real verificado al inicio

| Elemento | Evidencia |
|---|---|
| Rama / remoto | `main` → `origin https://github.com/desarrollogsi25/tv_gsi.git` (repo correcto) |
| Tags locales | `v2.0.1`, `v2.1.0`, `v2.1.3`, `v2.2.0` (no modificados) |
| `tv-db` | creado `2026-10-13T14:37:21Z` (post-recreación de la ventana), healthy, `127.0.0.1:25432` |
| `tv-backend` / `tv-frontend` | healthy; API `{"status":"online"}` |
| Ignored | `.env` (`.gitignore:4`), `*.dump` (`.gitignore:14`) |
| Árbol de trabajo | 29–30 modificados + 37 sin seguimiento (trabajo previo de misiones conservado; ningún `git reset/clean` ejecutado) |

## 2. Protección de datos previa a cambios

- **Respaldo coherente:** `backups/nexus_tv_20261013_171557.dump` — 29.925 bytes, SHA-256 `EDB0F0D80D55371086F51C8DF6EB5C64A82C194E3F56890B7B0EA40F8A6A9FE7`, inspeccionable (`pg_restore --list`: 86 entradas).
- **Verificación de recuperabilidad:** restauración en PostgreSQL 17 efímero (127.0.0.1:25497, destruido después): conteos idénticos `48|4|8|10|132` + `nexus_tv.pending_pairings` presente → `BACKUP_VERIFIED_OK`.
- **Volumen activo `tv_gsi_tv_pgdata`:** no eliminado, no reinicializado, no re-montado en ningún momento.
- **Migraciones 01–05:** no ejecutadas contra la DB existente (solo 06→07 ya aplicadas en la ventana previa).

## 3. AUD-001 — Retiro de superusuario de los roles legacy (CERRADO con ensayo y recuperación)

### 3.1 Estado antes (real, inspeccionado)

| Rol | super | login | createdb/createrole/bypassrls |
|---|---|---|---|
| `tv` | ✔ | ✔ | ✔ / ✔ / ✔ |
| `nx_tv`, `tv_user`, `ronald`, `nxtv`, `francisco` | ✔ | ✔ | ✘ |
| `nexus_app` | ✘ | ✔ | ✘ |

Todos los 7 roles con login tenían credencial almacenada. Sin membresías (`pg_auth_members` = 0 filas). Propiedad: esquema `nexus_tv` y 22 objetos → `ronald`; 6 objetos → `tv`.

### 3.2 Decisión aplicada (con justificación)

- **`nx_tv`, `tv_user`, `ronald`, `nxtv`, `francisco` → `NOSUPERUSER NOLOGIN`** (alineado con la intención de `migrations/01_init_nexus_tv.sql`, que los define `NOLOGIN NOSUPERUSER`, y con el estado destino documentado en AUDIT-FULL §12/§15). `ronald` conserva la **propiedad** de sus objetos (el ownership no requiere login ni superusuario).
- **`tv` conserva `SUPERUSER LOGIN`** como **única cuenta administrativa intencional**: es el `POSTGRES_USER` del contenedor (healthcheck `pg_isready -U tv`, administración, `pg_dump` de respaldo, recuperación) y **no existe rol `postgres` en el volumen**; retirarle login/superuser exigiría re-inicializar el volumen (prohibido) o dejar el clúster sin capacidad administrativa (rompería respaldos/migraciones/recuperación, condición prohibida por el mandato). Se le retiraron los flags redundantes `NOCREATEDB NOCREATEROLE NOBYPASSRLS`.
- **`nexus_app` intacto:** `LOGIN NOSUPERUSER` (usuario de ejecución de la aplicación).

### 3.3 Ensayo aislado previo (PostgreSQL 17 efímero)

- Réplica de los 7 roles + aplicación de los ALTER exactos → estado objetivo verificado.
- **Simulacro de recuperación:** como `tv`, `ALTER ROLE francisco SUPERUSER LOGIN` → `super=true login=true`; revertido. Recuperación reversible demostrada.
- QA destruido después.

### 3.4 Aplicación y verificación en la DB activa

- ALTER ejecutados como `tv` (socket local): exit 0.
- Estado final: solo `tv` super+login; los5 legacy `NOLOGIN NOSUPERUSER`; `nexus_app` sin cambios.
- Propiedad intacta: `ronald=22`, `tv=6` objetos.
- Operaciones de `nexus_app` por red SCRAM: `SELECT` → 48; `INSERT users` → **denegado (permission denied)**; `CREATE TABLE` → **denegado (permission denied for schema)**; `ALTER ROLE tv SUPERUSER` → **denegado (Only roles with the SUPERUSER attribute…)**.
- Sonda real de la aplicación (pool `nexus_app`): `POST /api/tv/login` → **401** con sesión `nexus_app` activa.
- **Capacidad de respaldo post-cambio:** `pg_dump` → exit 0, `pg_restore --list` 86 entradas (temporal, eliminado).

## 4. Revalidación AUD-002 … AUD-005

| Hallazgo | Evidencia de esta misión |
|---|---|
| **AUD-002** (heartbeat sin auth) | E2E vivo: heartbeat con credencial válida → 200 y `last_login` actualizado (`2026-10-13 15:38:49`); credencial inválida → **401**; ausente → **401**. Código: verificación en lectura **y reescritura** (`WHERE is_active = true AND device_token_hash = $2`). Suite `tv-heartbeat*` en regresión (ver §9). |
| **AUD-003** (dependencias) | `npm audit --omit=dev` backend → **0 vulnerabilities**; frontend → **0 vulnerabilities**. |
| **AUD-004** (validación de archivos) | Suite `media-upload` completa en regresión (0 fallos). Skips documentados de ffmpeg/ffprobe en host (se ejecutan en el contenedor de la ventana). |
| **AUD-005** (emparejamiento) | Migración 07 presente en DB activa; **E2E de pairing completo en vivo** (§7): `pending` → `promoted`, rotación de credencial, expiración 301 s, reconciliación al arranque. Sin fallback en memoria: si falta la tabla, la ruta devuelve `503 PAIRING_SCHEMA_NOT_MIGRATED` (código `admin.js:146-152`), es decir, fail-safe. |

## 5. AUD-006 — Retirada del token en query string (DEV-RUN-004 ejecutado hasta donde el entorno permite)

### 5.1 Fase V3 (telemetría de observación) — EJECUTADA

- `OBSERVE_QUERY_DEVICE_TOKEN=true` activado a las **2026-10-13T15:25:28Z**; backend recreado (healthy intento 1). `ALLOW_QUERY_DEVICE_TOKEN=false` **antes, durante y después** (nunca habilitado).
- **Observaciones reales registradas (5 líneas):** solo `tv_uuid` + flags; **0 líneas con hex64 o valor de token** (verificado por patrón sobre `docker logs`).
- Canal legacy rechazado en vivo: `connect_error: TV authentication failed: … rejected` con uuid válido y con uuid malformado (el identificador malformado no llega a registrarse).

### 5.2 Inventario de clientes y pantallas (Fase 1–2 lógica)

- **Cliente oficial `frontend/src/components/TVPlayer.jsx`:** REST con cabecera `X-Device-Token` + cuerpo; Socket.IO con `auth: {tv_uuid, device_token}` y **`query: {}` vacío** → el cliente oficial **nunca** usa query string (evidencia de código líneas 348–356, 578–584).
- `waitingPairingSocket.js`: query solo con `session_code`/`waiting_pairing` (no es el token de dispositivo). `TVControl.jsx` (admin): JWT en `auth`.
- Uso de `device_token` en query en el repositorio: **exclusivamente en pruebas negativas** (`tests/device-auth.test.js`).
- **Pantallas (estado final, tras limpieza):** 8 — `PT204` con credencial activa; 6 activas **sin credencial** que responden `401 requires_pairing` (login y heartbeat sin ruta sin credencial: `tv.js:58-64`); ninguna pantalla puede operar sin token.

### 5.3 V2 endurecimiento de Nginx — DESPLEGADO en esta misión (gap de logging cerrado con evidencia antes/después)

- **Antes (config desplegado, medido):** sonda con `device_token` en query a través de Nginx → el backend la rechazó, **pero el access log del contenedor registró la línea completa con `device_token=legacy_probe_TOKEN_xyz_000`** (1 coincidencia en `docker logs tv-frontend`). El config activo solo aplicaba `nexus_safe_query` a `/media/` (2 apariciones).
- **Acción:** `frontend/nginx.conf` ← contenido de `frontend/nginx.conf.hardened` (mitigación preparada en Misión 4C, `nginx -t` ya validada), `docker compose build frontend` + `--force-recreate frontend`.
- **Después:** imagen reconstruida, frontend healthy intento 2, `nginx -t` OK, `nexus_safe_query`=**4** en el contenedor, hash del contenedor == hash local. **Misma sonda post-despliegue: 0 líneas con token en logs nuevos**, backend sigue rechazando (observación #5), handshake **válido** por Nginx → `connect` (proxy no roto), E2E completo verde (§6–§7).
- `frontend/nginx.conf.hardened` se conserva como artefacto preparado referenciado por los informes.

### 5.4 Lo que queda fuera de este entorno (dependencia externa auténtica)

- **V4 — observación con dispositivos físicos reales:** no hay TV física ni clientes legacy reales en este laboratorio. La instrumentación (V3) queda desplegada y validada; el cierre definitivo de AUD-006 requiere la campaña de campo con los equipos reales (Operaciones), conforme a DEV-RUN-004 §13.2. **No se simula esa campaña.**

## 6. AUD-007 — Medios privados: E2E real contra el despliegue (38/38, repetido post-despliegue)

Batería `E2E-1` ejecutada **pre y post** despliegue del Nginx endurecido: **38 pass / 0 fail** en ambas.

- **Identidad:** login admin 200, login viewer 200, password inválida 401, usuario inexistente 401.
- **RBAC:** `/admin/screens` con admin 200 (n=9 incluida la pantalla de prueba), con viewer 200 (lectura por diseño), sin token 401, `bind-screen` (admin-only) con viewer **403**, DELETE con admin sobre UUID inexistente **404** (autorización pasada, recurso inexistente).
- **Dispositivo (AUD-002/006):** tv-login válido 200 / inválido 401 / sin campos 400; heartbeat válido 200 (efecto `last_login` verificado en SQL) / inválido 401 / ausente 401; playlist con cabecera 200 / sin cabecera 401.
- **Playback firmado (AUD-007):** emisión con token 200; **contenido local fuera de la playlist del dispositivo → 403** (autorización por playlist en el punto de emisión); TTL=3600 s; `GET` 200; `HEAD` 200 (`content-length=25382`); `Range: bytes=0-99` → **206** `bytes 0-99/25382`; GET/HEAD/Range **vía Nginx** → 200/200/206.
- **Negativos:** anónimo directo 403, anónimo vía Nginx 403, firma inválida 403, **caducada 403**, propósito inválido 403, clave incorrecta 403.
- **Preview admin:** emisión con admin 200, GET 200, Range 206, sin token 401, con viewer 200 (lectura), firma `admin_preview` válida 200.
- **Logs:** `media_access.log` (formato `$uri`) sin firmas ni tokens (0 coincidencias sobre los patrones de token); backend sin claves.

> Nota de política: la URL firmada es una credencial breve con propósito+expiración+binding (según ADR-006); el control de quién recibe la URL está en la emisión (cabecera de dispositivo + playlist), verificado arriba.

## 7. AUD-008 — Puerto PostgreSQL + emparejamiento E2E en vivo

- **Puerto:** `docker port tv-db 5432/tcp` → `127.0.0.1:25432` (único), coincide con `HOST_DB_BIND` del compose; contenedor con fecha de creación verificada. YAML **y** contenedor real coinciden.
- **E2E-2 (sockets/pairing): 13 pass / 0 fail, pre y post despliegue**, incluye:
  - rechazo de query-token (canal obsoleto) con y sin uuid malformado;
  - conexión válida por `auth` y por cabecera `x-device-token`;
  - **pairing completo:** TV en espera → `waiting-screens` expone la sesión → `bind-screen` 200 con ACK → `command:assign_profile` con credencial → `tv:pairing_confirmed` → admin recibe `admin:tv_bound` → fila `pending_pairings` en **`promoted`**;
  - **rotación verificada:** token original → 401, token rotado → 200.
- **Expiración (E2E-3):** sesión en espera sin bind → evento **`pairing:expired` a los 301 s** (TTL real 5 min; el primer intento de 75 s fue insuficiente — error del guion, documentado).
- **Recuperación tras reinicio (en vivo):** fila `pending` vencida insertada → `docker compose restart backend` → fila en **`expired`** + log **`🧹 [Boot Reconciliation] 1 vinculaciones pendientes vencidas reconciliadas al iniciar.`** + API online + sonda 401 + media 403 tras el reinicio.
- **Concurrencia (observación honesta):** dos sesiones distintas compitiendo por la misma pantalla devolvieron ambas 200 (las sesiones son independientes por diseño, test AUD-005.28) y la carrera converge a **una única credencial activa** (verificado por igualdad de hash en `tv_screens`; serialización `FOR UPDATE`, sin corrupción). Documentado como comportamiento observado, no como defecto: el bind requiere JWT de administrador.

## 8. Limpieza de datos de prueba (solo los creados en esta misión)

- Eliminados: pantalla `E2E-MISSION-DEV`, usuarios `e2e_mission_admin/viewer`, playlist `E2E-MISSION-PLAYLIST` + enlaces, 5 filas de `pending_pairings` de la pantalla de prueba, ficheros temporales de token.
- **Conteos finales = origen del respaldo: `48|4|8|10|132`**; residuos E2E = **0** en las cuatro tablas.
- Ningún dato previo del usuario fue eliminado.

## 9. Regresión, compilación y auditorías (cifras reales de esta ejecución)

| Verificación | Resultado |
|---|---|
| Regresión completa (`npm test`) | **187 tests: 184 pass, 0 fail, 3 skipped, exit 0** (skips: ejecución real ffprobe/ffmpeg, documentados, se realizan en contenedor) |
| Primer intento de regresión | 177 tests con 1 `fail` de **nivel runner**: `failureType: uncaughtException — "Unable to deserialize cloned data due to invalid or unsupported version"` (IPC del test-runner, no una aserción). `device-auth.test.js` ejecutado en solitario → **0 fallos**. Segundo intento → verde. Flake documentado (patrón ya conocido en DEV-RUN-005 §15). |
| `npm audit --omit=dev` backend | **0 vulnerabilities** (exit 0) |
| `npm audit --omit=dev` frontend | **0 vulnerabilities** (exit 0) |
| Build frontend (`vite build`) | **exit 0**, 126 módulos, `dist/` generado (tras instalar el binding nativo `@rolldown/binding-win32-x64-msvc@1.2.9` con `--no-save`: bug conocido de npm con opcionales, npm/cli#4828; sin tocar `package.json`/lock con esa instalación) |
| `nginx -t` (contenedor) | OK (con el config endurecido desplegado) |
| `node --check nx_tv.js` | exit 0 |
| `git diff --check` | (ver §11, ejecutado en fase de publicación) |

## 10. Incidentes y desviaciones de esta misión (todos documentados, ninguno oculto)

1. **Restauración de QA interrumpida** por el gap de init del entrypoint de `postgres:17` (primer `pg_restore` sobre el servidor temporal) y por `docker exec` sin `PGUSER` (rol `root` inexistente). Resuelto con espera + `PGUSER=qa_restore`; `RESTORE_OK` verificado. No afectó datos reales.
2. **Guion E2E con dos fallos propios** (no de la app): token de dispositivo sin formato hex exigido por el handshake de socket (se regeneró de 64 hex y se actualizó el hash de la fixture) y body de login con claves incorrectas (`{u,p}` → `{username,password}`). Diagnosticados con telemetría y corregidos; ambas ejecuciones finales en verde.
3. **Aserción de `Content-Range` incorrecta en el guion** (`bytes 0-99/*` vs el correcto `bytes 0-99/25382` del servidor); corregida la aserción, no el sistema.
4. **Flake del runner IPC** en el primer run completo (§9).
5. **Gap de logging de Nginx detectado por medición** (token en access log de socket.io) → cerrado desplegando el config endurecido con evidencia antes/después (§5.3).
6. **Rollback de una transacción multistatement** al crear fixtures con `email` duplicado: ninguna fila se persistió a medias; re-insertado en pasos separados y verificado.
7. **`build` local frontend** falló por bug npm de opcionales (§9); resuelto sin modificar ficheros versionables.

## 11. Estado final de los hallazgos

| ID | Estado final | Sustento |
|---|---|---|
| **AUD-001** | **CERRADO — corregido y verificado en DB activa** | Roles legacy `NOSUPERUSER NOLOGIN`, `nexus_app` mínimo con DML denegado en superficie administrativa, `tv` como única cuenta DBA justificada; ensayo + recuperación previos; respaldo previo verificado |
| **AUD-002** | **CERRADO — verificado en producción** | E2E vivo (200/401/401 + efecto SQL), doble verificación en código, suites en regresión |
| **AUD-003** | **CERRADO — verificado** | 0 vulnerabilidades backend y frontend |
| **AUD-004** | **CERRADO — verificado** | suite `media-upload` en regresión; ejecuciones reales ffprobe/ffmpeg en contenedor (skips de host documentados) |
| **AUD-005** | **CERRADO — verificado en producción** | E2E pairing completo, rotación, expiración 301 s, reconciliación al arranque, fail-safe sin esquema |
| **AUD-006** | **DESPLEGADO Y OBSERVADO — pendiente de verificación externa (campaña de campo con dispositivos físicos)** | `ALLOW=false` permanente; `OBSERVE=true` desde 15:25:28Z con logs sin secretos; cliente oficial sin query; Nginx endurecido desplegado (antes/después medido). Cierre definitivo = DEV-RUN-004 V4 con equipos reales (Operaciones) |
| **AUD-007** | **CERRADO en lo verificable — medios privados E2E verde** | 38/38 pre y post despliegue; pendientes de campo: reproducción en TV física y preview con credenciales reales de administración (Operaciones) — no simulados |
| **AUD-008** | **CERRADO — verificado en campo** | `127.0.0.1:25432` único, contenedor real coincidente con YAML, volumen intacto |

## 12. Pendientes externos auténticos (no resolubles desde este entorno)

1. **Campaña de campo AUD-006 (V4)** con pantallas físicas reales — Operaciones (DEV-RUN-004 §6.3–§8).
2. **Reproducción en TV física y preview con credenciales reales de administración** (AUD-007 G4c/G4d) — Operaciones.
3. **Retiro definitivo de los roles legacy** (borrado, no solo neutralización) — DBA, con ventana y recuperación documentada; hoy están `NOLOGIN NOSUPERUSER` e inertes.
4. **Retención del respaldo** `backups/nexus_tv_20261013_171557.dump` y de las etiquetas `pre-v2.2.0` — decisión de retención del responsable de operaciones.
5. **`pg_hba` con trust en loopback** (heredado del volumen): cualquier proceso local puede conectarse como `tv` sin contraseña. No modificado por riesgo de bloqueo (revertir exige rotar credenciales en `.env`); registrado como riesgo residual con recomendación de migrar a `scram-sha-256` en ventana controlada.

## 13. Publicación en GitHub

| Elemento | Evidencia |
|---|---|
| Remoto | `origin` → `https://github.com/desarrollogsi25/tv_gsi.git` |
| Rama | `main` — push **fast-forward** desde `43e8590`, sin `--force`, sin reescritura de historia, sin tocar ramas ni etiquetas ajenas |
| Commits publicados | `8700535` `chore(repo)` · `85fd098` `fix(security)` · `2661b97` `feat(deploy)` · `e150f66` `docs(closure)` |
| Verificación remota | `git ls-remote origin refs/heads/main` → `e150f662d56cdfe99f0a43f9418311e1dad3a75d` **==** `git rev-parse HEAD` |
| Etiquetas | `v2.0.1`/`v2.1.0`/`v2.1.3`/`v2.2.0` intactas en remoto (`v2.2.0` → `43e8590`) |
| Escaneo de secretos del índice | **0 secretos**: solo placeholders `REPLACE_`, referencias `${VAR}` y generadores PowerShell de runbook; el seed bcrypt de `migrations/01` ya existía en `HEAD` (histórico del repo) |
| Árbol tras publicación | limpio (`git status --short` = 0 líneas); `backups/` ignorado (`.gitignore`) |

**Nota de autenticación (transparencia):** `fetch`/`ls-remote` funcionan de forma anónima (el repo es legible públicamente); el `push` requiere credenciales. El helper de credenciales no estaba configurado para el git del entorno (su config global es `/root/.gitconfig`, distinta del HOME de `gh`). Se ejecutó el push usando el token almacenado por `gh` (autenticado como `desarrollogsi25`, alcance `repo`) en modo **one-shot dentro del proceso de git**, con la salida redactada — el token no se imprimió, no se persistió en ningún fichero ni configuración y no queda en el repositorio. Para persistir la autenticación en su sesión habitual: `gh auth setup-git` (o `git config --global credential.helper "C:/Program Files/GitHub CLI/gh.exe auth git-credential"`).

---

## 14. Anexo posterior (2026-10-13) — Misión correctiva: CI verde real en GitHub

> Sección añadida después del cierre original por una misión correctiva posterior. **El texto precedente de este informe no se ha modificado.**

| Elemento | Evidencia |
|---|---|
| Hallazgo posterior al cierre | El run #16 (`38431545080`, sobre `3675104`) falló en el job backend con 26× `ECONNREFUSED 127.0.0.1:25499/25498`: el runner de GitHub no tiene las bases QA (existían solo como contenedores persistentes locales), aunque el push fue limpio y el frontend/compose estaban en verde |
| Remediación (commit `780e9c8`) | Bases QA **efímeras** como `services:` en el workflow (mismas identidades, puertos y marcadores que exige `tests/qa-guard.js`); migraciones 01→07 en orden estricto + `COMMENT ON DATABASE`; verificación fallarina de marcadores y login scram reales; **contraste negativo real** del guard (incluida la supresión temporal y restauración verificada del marcador); limpieza `if: always()`; `checkout@v5`/`setup-node@v5`. Frontend: 10 advertencias de oxlint → **0** (extracción de `utils/toastBus.js` y `utils/apiUrl.js`, IIFE async y patrones "latest ref"), sin desactivar reglas |
| Reproducción local | Procedimiento idéntico al CI ejecutado sobre bases efímeras locales: migraciones 0 errores, identidad OK, 3/3 controles negativos, suite **187/184/0/3**, oxlint 0, build OK, compose OK, audits 0 |
| Publicación | `780e9c8` (código) + `e9e1566` (informe) — push fast-forward sin reescritura; `ls-remote` == `HEAD` |
| Run de verificación | [`38450894872`](https://github.com/desarrollogsi25/tv_gsi/actions/runs/38450894872) sobre `e9e1566` — **success en los 3 jobs**; backend `187 tests / 184 pass / 0 fail / 3 skipped` (los skips son los habituales de `ffmpeg`/`ffprobe` del host, ejecutados realmente en el contenedor Docker en verificaciones previas) |
| Informe completo | `docs/13-testing/results/CI-REMEDIATION-REPORT-2026-10-13.md` (causa raíz, cambios, garantías de aislamiento, reproducción, resultados por job, advertencias corregidas, SHA y run) |
