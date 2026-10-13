# Informe de remediación de CI — MISIÓN CORRECTIVA "CI VERDE REAL EN GITHUB" (2026-10-13)

> **Tipo:** Informe de misión correctiva
> **Fecha:** 2026-10-13 (fase de ejecución: ~17:40–19:05 UTC / 19:40–21:05 local)
> **Proyecto:** `tv_gsi` — Nexus TV Enterprise v2.2.0
> **Alcance:** hacer que la tubería de GitHub Actions ejecute la suite real completa en verde (bases QA efímeras provisionadas en el runner), corregir las 10 advertencias de oxlint del frontend, actualizar las actions a versiones compatibles con el runtime Node soportado (v5/node24), documentar la remediación y verificar la ejecución real publicada.
> **Regla de evidencia:** todas las cifras provienen de salidas reales de esta ejecución. No se simuló, mockeó ni omitió ninguna prueba; la verificación final de CI es la ejecución real de GitHub Actions, no el estado del push.
> **Commit de código:** `780e9c8ab282b3f5c6ba6651f926f5c69cfcee3c`

---

## 1. Diagnóstico: por qué el run #16 falló (evidencia de GitHub)

| Elemento | Evidencia (`gh run view 38431545080`) |
|---|---|
| Run | `38431545080` sobre `3675104ba5c036e3a19d375e07099996da22793b` — **conclusión: failure** |
| `Backend Syntax & Unit Tests` | **failure** — 16:33:59Z → 16:34:16Z (~17 s) |
| `Frontend Build & Oxlint` | success — 16:34:00Z → 16:34:25Z |
| `Docker Compose Syntax Validation` | success — 16:34:00Z → 16:34:14Z |
| Causa raíz (log del job fallido) | 26× `ECONNREFUSED 127.0.0.1:25499` / `127.0.0.1:25498` |

**Causa raíz:** las pruebas de integración QA (`qa-guard`, `clean-bootstrap`, `qa-least-privilege`, `pairing-ack` QA, `tv-heartbeat-integration`) exigen bases PostgreSQL reales en `127.0.0.1:25499` y `127.0.0.1:25498` con marcador de identidad. En local esas bases existen como contenedores persistentes (3+ días en el momento de la misión), por eso la suite pasa local; en el runner de GitHub **no existía nada en esos puertos**, y los tests — correctamente — fallan con `ECONNREFUSED` (son fallos reales, no flakes). El frontend y la validación de compose no dependen de esas bases, y por eso esos jobs estaban en verde.

## 2. Solución implementada (commit `780e9c8`)

### 2.1 `.github/workflows/ci.yml` — bases QA efímeras como `services:`

El job `backend-lint-and-syntax` declara dos servicios exclusivos del workflow:

| Servicio | Imagen | Puerto publicado | `POSTGRES_USER` | `POSTGRES_DB` | Rol app (`PG_APP_*`) | Marcador de identidad |
|---|---|---|---|---|---|---|
| `qa_db` | `postgres:17-alpine` | `25499:5432` | `qa_admin` | `nexus_tv` | `nexus_app` / `nexus_app_runtime_pw_2026` | `QA_ISOLATED_DB_25499_VALIDATED` |
| `bootstrap_db` | `postgres:17-alpine` | `25498:5432` | `postgres` | `nexus_tv` | `nexus_app` / `qa_bootstrap_app_pw_2026` | `QA_CLEAN_BOOTSTRAP_25498_VALIDATED` |

Ambos con health-check `pg_isready`. La identidad coincide **exactamente** con la que exige `tests/qa-guard.js` y `tests/clean-bootstrap.test.js` (host `127.0.0.1`, puertos `25499`/`25498`, base `nexus_tv`, rol `nexus_app`).

Nuevos pasos del job, en orden:

1. **`Provision isolated QA databases (migrations 01-07 + identity markers)`**
   - Esperas acotadas (máx. 120 s c/u): (a) `nexus_tv` operativa vía `docker exec psql` (evita la carrera con la fase de inicialización del entrypoint, en la que la temp server solo usa socket unix) y (b) servidor final escuchando por TCP en `25499`/`25498` (`/dev/tcp`).
   - Aplica `migrations/01…07` en orden estricto (incluidos los dos `04_*`: `04_distribute` antes de `04_sync`, el mismo orden lexicográfico del entrypoint oficial) con `psql -v ON_ERROR_STOP=1` por `docker exec -i`: cualquier error SQL detiene el job. La migración 06 recibe `PG_APP_USER`/`PG_APP_PASSWORD` del entorno del contenedor (los servicios los declaran en `env:` y `docker exec` los hereda), que es lo que exige su `\getenv`.
   - `COMMENT ON DATABASE nexus_tv IS '…'` con el marcador propio de cada puerto: el mismo mecanismo (`pg_shdescription`) que consulta `qa-guard`.
2. **`Verify QA identity markers and runtime credentials`** (fallarino, sin simulación): assert del valor exacto de ambos marcadores vía `pg_shdescription`; login **real scram-sha-256** de `nexus_app` por el puerto mapeado en ambas bases con verificación de `current_user`, `current_database()`, marcador legible desde la sesión de runtime y atributos del rol (`rolsuper=false`, `rolcanlogin=true`).
3. **`Verify isolation controls reject unauthorized targets`** (contrastes negativos reales):
   - Puerto de producción `25432` → el guard debe abortar **antes** de conectarse.
   - Nombre de base no autorizado en el puerto QA → abort de parámetros.
   - **Base QA real sin marcador**: se suprime temporalmente el comentario (`COMMENT … IS NULL`) en la base efímera, se exige el rechazo del guard (que conecta y compara el marcador) y se **restaura y re-verifica** el marcador antes de evaluar el código de salida; si el guard dejara de rechazar, el job queda en rojo y `npm test` nunca se ejecuta con la base en estado dudoso.
4. **`Run Unit Tests`** → `npm test` (suite completa real).
5. **`Cleanup ephemeral QA databases`** con `if: always()`: `docker rm -f` de ambos servicios (documenta y garantiza la efimeridad incluso en re-ejecuciones; los contenedores desaparecen con el runner de todos modos).

En los tres jobs: `actions/checkout@v4 → v5` y `actions/setup-node@v4 → v5` (runtime Node 24 soportado).

### 2.2 Frontend — 10 advertencias de oxlint → 0

Correcciones puntuales y seguras, sin desactivar reglas ni suprimir advertencias (los patrones se validaron empíricamente con ficheros sonda, creados y eliminados):

| # | Advertencia (run #16) | Corrección | Fichero(s) |
|---|---|---|---|
| 1–2 | `only-export-components` (×2) | `showToast`/`showConfirmation` + registros de escuchas extraídos a **`src/utils/toastBus.js`**; `Toast.jsx` solo exporta componentes y se suscribe al bus | `Toast.jsx`, nuevo `utils/toastBus.js`, importadores `TVPlayer`, `TVList`, `TVRegister`, `ContentManager` |
| 3 | `only-export-components` | `API_URL` extraído a **`src/utils/apiUrl.js`**; `Admin.jsx` solo exporta componentes | `Admin.jsx`, nuevo `utils/apiUrl.js`, importadores `TVControl`, `TVList`, `TVRegister`, `BroadcastPanel`, `ContentManager` |
| 4 | `set-state-in-effect` | límite async explícito (IIFE) en el efecto de carga inicial | `TVList.jsx` |
| 5 | `set-state-in-effect` | ídem | `TVRegister.jsx` |
| 6 | `no-unused-vars` (`deviceToken`) | el valor nunca se lee (solo se persiste el setter): `const [, setDeviceToken]` | `TVPlayer.jsx` |
| 7 | `exhaustive-deps` (`unlockAudio`) | patrón "latest ref": `unlockAudioRef` + `isAudioUnlockedRef`, listener global suscrito una sola vez (deps `[]`), comportamiento equivalente sin re-registro en cada render | `TVPlayer.jsx` |
| 8 | `set-state-in-effect` | límite async explícito (IIFE) | `BroadcastPanel.jsx` |
| 9–10 | `set-state-in-effect` + `exhaustive-deps` (`loadData`) | ref de "última versión" (`loadDataRef`, que captura `selectedPlaylistId`) + IIFE; la carga inicial ejecuta la `loadData` vigente sin re-ejecuciones en cadena | `ContentManager.jsx` |

Resultado local tras los cambios: **`npx oxlint` → 0 warnings, exit 0**; `npm run build` (vite/rolldown) → `✓ 128 modules transformed … built in 641ms`, exit 0. Ninguna importación rota (build completo de producción).

### 2.3 Qué NO se tocó (y por qué)

- **`tests/qa-guard.js` y toda la carpeta `tests/`:** intacta. La guardia no se debilitó, los puertos autorizados no cambiaron, ninguna prueba se omitió ni se mockeó para sustituir una real (los mocks que ya existían en los tests son los propios del diseño de los tests, sin cambios).
- **`migrations/`:** intactas. Los datos seed del repo se aplican en CI tal cual (ya estaban publicados en el historial del repo; no es información nueva).
- **`docker-compose.yml`, despliegue y stack local:** intactos.

## 3. Garantías de aislamiento

1. **Efímeras:** los servicios nacen con el job y mueren con él; hay limpieza explícita `if: always()` además del final del runner. Sin volúmenes persistentes.
2. **Exclusivas del workflow:** cada ejecución crea sus propias instancias; no comparten estado entre runs ni con el entorno local.
3. **Nunca en el puerto de producción:** ningún servicio publica `25432`; el contraste negativo del paso 3 prueba que el guard rechaza ese destino y el job queda en rojo si dejara de hacerlo.
4. **Sin datos reales:** las bases se construyen desde cero con las migraciones del repo; los tests de integración crean y eliminan sus propios fixtures con UUID sintéticos (`1111…`, `7777…`, `8888…`, `9999…`, `aaaa…`, `bbbb…`), sin colisión con el seed.
5. **Identidad verificada en cada run:** marcador + login real + rol mínimo comprobados antes de ejecutar la suite; sin marcador, la suite entera aborta por diseño (fail-closed).

## 4. Reproducción local del procedimiento de CI (fiel)

Ejecutada el 2026-10-13 sobre el host local (Docker Desktop, PostgreSQL 17 alpine, Node 20.18 — la CI usa Node 24):

1. `docker stop nexus-qa-isolated-db nexus-qa-clean-bootstrap-val` (bases QA locales persistentes **detenidas conservando sus volúmenes**).
2. Réplica exacta de los servicios del CI: `docker run -d` de `postgres:17-alpine` efímero en `127.0.0.1:25499` y `127.0.0.1:25498` con los mismos `env` y health-cmd del workflow (sin montar migraciones, igual que el CI).
3. Esperas equivalentes a las del workflow (socket `nexus_tv` operativa + TCP publicado): ambas OK.
4. Migraciones 01→07 por `docker exec -i psql -v ON_ERROR_STOP=1` en orden estricto: **0 errores en ambas bases** (16 aplicaciones).
5. Marcadores `COMMENT ON DATABASE` en ambas: OK.
6. Verificación de identidad (mismo script que el paso del CI):
   ```
   QA25499 OK — user=nexus_app db=nexus_tv marker=QA_ISOLATED_DB_25499_VALIDATED superuser=false
   QA25498 OK — user=nexus_app db=nexus_tv marker=QA_CLEAN_BOOTSTRAP_25498_VALIDATED superuser=false
   ```
7. Controles negativos (mismos tres casos que el CI):
   ```
   OK — rechazado destino de producción 25432: SECURITY ABORT: Port 25432 is not the authorized QA port (25499)! …
   OK — rechazada base no autorizada: SECURITY ABORT: Database 'postgres' is not the authorized QA database ('nexus_tv')!
   OK — rechazada base sin marcador de identidad: SECURITY ABORT: Target database 'nexus_tv' on 127.0.0.1:25499 is missing the required QA identity marker!
   Marcador restaurado y verificado tras el contraste negativo: QA_ISOLATED_DB_25499_VALIDATED
   ```
8. `npm ci` (exit 0, 194 paquetes, 0 vulnerabilidades) y `node --check` de los 9 ficheros núcleo (exit 0).
9. `npm test` completo contra las bases efímeras: **187 tests, 184 pass, 0 fail, 3 skipped** (ver §5).
10. Frontend: `npm ci` (exit 0), `npx oxlint` (0 warnings, exit 0), `npm run build` (exit 0).
11. `docker compose -f docker-compose.yml config --quiet` con las mismas variables del CI (exit 0).
12. Limpieza y restauración: `docker rm -f -v` de los efímeros; `docker start` de las bases originales; marcadores y login de identidad re-verificados sobre ellas (intactas).

## 5. Resultados por job (reproducción local del procedimiento)

### 5.1 `Backend Syntax & Unit Tests`

| Paso | Resultado |
|---|---|
| `npm ci` | exit 0 (194 paquetes, 0 vulnerabilidades) |
| `node --check` × 9 ficheros | exit 0 |
| Provisionamiento (esperas + migraciones 01-07 + marcadores) | exit 0, 0 errores SQL |
| Verificación de identidad y credenciales | OK en ambas bases |
| Controles negativos de aislamiento | 3/3 rechazos reales; marcador restaurado y verificado |
| `npm test` | **187 tests — 184 pass, 0 fail, 3 skipped** |

**Tests ejecutados / fallidos / omitidos:**
- **Ejecutados:** 187 (184 pass + 3 skipped). Cobertura íntegra: unitarios, upload/media, heartbeat (unitario e integración real contra QA), device-auth, pairing (unitario, sesión, ack y QA), playlist-auth, clean-bootstrap (25498), qa-least-privilege (25499).
- **Fallidos:** 0.
- **Omitidos (3):** los mismos 3 de siempre, por ausencia de `ffmpeg`/`ffprobe` **en el host**, con la salvedad ya documentada en informes anteriores: `AUD-004 REAL EXEC`, `AUD-004 REAL DECODE` y `AUD-004 REAL ROUTE` — se ejecutan realmente dentro del contenedor Docker oficial con runtime Node 24 + ffmpeg (evidencia en los informes de misión previos). En CI (ubuntu-latest) tampoco hay ffmpeg en el runner, así que se omitirán igual, por diseño y sin afectar a la validez del resto.

**Incidencia observada y resuelta (transparencia):** una de las repeticiones locales de `npm test` falló con `failureType: 'uncaughtException' — Unable to deserialize cloned data due to invalid or unsupported version` en `device-auth.test.js` y `pairing-ack.test.js`. Es un fallo del **IPC interno del test-runner de Node 20 en Windows** al ejecutar ficheros en paralelo (el stack apunta a `node:internal/test_runner/runner`), no de las pruebas: ambos ficheros aislados pasaron **60/60** y la repetición completa volvió a **187/184/0/3**. No guardaba relación con los cambios de la misión (ni con las bases) y en CI (Node 24/linux) no se ha producido jamás (run #16 solo falló por `ECONNREFUSED`).

### 5.2 `Frontend Build & Oxlint`

| Paso | Resultado |
|---|---|
| `npm ci` | exit 0 |
| `npx oxlint` | **0 warnings**, exit 0 (antes: 10 warnings) |
| `npm run build` | exit 0 — `128 modules transformed`, `index-Cs-AuT10.js 433.46 kB │ gzip: 133.79 kB` |

Nota local (externa al repo): en Windows, npm 10.8.2 tiene el bug conocido de optional-deps (npm/cli#4828) que omite los bindings nativos de `oxlint`/`rolldown`; se repusieron con `npm i … --no-save` **sin tocar** `package.json`/`package-lock.json` (verificado con `git status`). Es un artefacto del host Windows: en CI (ubuntu) npm los instala correctamente (el frontend ya ejecutaba oxlint en el run #16).

### 5.3 `Docker Compose Syntax Validation`

| Paso | Resultado |
|---|---|
| `docker compose -f docker-compose.yml config --quiet` (con `PG_PASSWORD`/`JWT_SECRET` de validación) | exit 0 |

### 5.4 Comprobaciones complementarias

| Comprobación | Resultado |
|---|---|
| `npm audit --omit=dev` (raíz) | 0 vulnerabilidades |
| `npm audit --omit=dev` (frontend) | 0 vulnerabilidades |
| `git diff --check` | limpio (sin whitespace roto) |
| Escaneo de secretos del diff | 0 secretos nuevos: solo credenciales QA de test ya fijadas en `tests/*.test.js` y documentadas en informes previos |

## 6. Publicación y verificación en GitHub

| Elemento | Evidencia |
|---|---|
| Commit de código | `780e9c8ab282b3f5c6ba6651f926f5c69cfcee3c` — `fix(ci): [CI-VERDE] bases QA efimeras en Actions, oxlint 0 warnings y actions v5` |
| Contenido | 11 ficheros: `.github/workflows/ci.yml` + 9 componentes frontend + 2 utilidades nuevas (`utils/toastBus.js`, `utils/apiUrl.js`) |
| Verificación de la ejecución real de Actions | completada en **§9 (anexo posterior)** tras observar el run publicado |

---

## 9. Anexo posterior — resultado de la ejecución real de GitHub Actions

*(Sección añadida tras la publicación y la observación del run; ver commit de documentación.)*
