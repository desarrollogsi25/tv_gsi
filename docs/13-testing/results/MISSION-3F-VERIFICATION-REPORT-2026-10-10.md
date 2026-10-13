# INFORME DE VERIFICACIÓN TÉCNICA — MISIÓN 3F
## Integridad de Auditoría, Ciclo de Vida de `pending_pairings` y Aceptación del Nuevo Pairing

**Proyecto:** Nexus TV Enterprise (`tv_gsi`)  
**Fecha:** 2026-10-10  
**Evaluador:** Senior Security, Database & QA Engineer  
**Objetivo:** Corregir las discrepancias documentales de MISIÓN 3E, garantizar la estabilidad estricta de identificadores de hallazgos (AUD-001 a AUD-008), validar el ciclo de vida de `nexus_tv.pending_pairings` en instalación limpia sin datos heredados, eliminar el fallback en memoria no persistente, implementar la reconciliación automatizada periódica y verificar la resiliencia y no-bloqueo de la arquitectura de emparejamiento.

---

## 1. Preservación del Workspace y Entorno Activo

Antes de ejecutar cualquier modificación en la auditoría, se inspeccionó el repositorio y el estado de la infraestructura:
- **Git:** Verificado con `git status --short`, `git diff --stat` y `git diff --name-only`. Todos los cambios acumulados de las misiones anteriores fueron preservados íntegramente. Cero commits, cero pushes, cero cambios de rama ejecutados.
- **Base de Datos Activa:** Contenedor `tv-db` (puerto `25432`) se mantuvo intacto, en estado saludable y con **cero operaciones de escritura** durante toda la misión.
- **Servicios de Producción:** `tv-backend` (puerto `23002`) y `tv-frontend` (puerto `28080`) operativos sin alteraciones.
- **Ambiente de Pruebas:** Toda verificación experimental se realizó en contenedores QA aislados:
  - `nexus-qa-isolated-db` (puerto `127.0.0.1:25499`, base `nexus_tv`, rol `nexus_app`, marca `QA_ISOLATED_DB_25499_VALIDATED`).
  - `nexus-qa-clean-bootstrap-val` (puerto `127.0.0.1:25498`, base `nexus_tv`, rol `nexus_app`, marca `QA_CLEAN_BOOTSTRAP_25498_VALIDATED`).
  - `nexus-qa-clean-07-val` (puerto efímero `127.0.0.1:25496`, volumen nuevo `nexus_qa_clean_07_pgdata`, validación de bootstrap limpio 01–07).

---

## 2. Corrección del Registro de Hallazgos y Matriz Oficial

En informes anteriores (notablemente en el resumen tabular de Misión 3E), se produjo un error de clasificación donde el identificador `AUD-003` fue asignado transitoriamente a la implementación de RBAC, alterando la definición original. Asimismo, ciertos estados figuraban como mitigados o cerrados sin reflejar con exactitud la evidencia de infraestructura real.

En cumplimiento estricto de las directivas de auditoría, se corrigen las clasificaciones manteniendo estables los identificadores originales:

### Matriz Oficial y Definitiva de Hallazgos

| ID | Definición Original del Hallazgo | Criticidad | Estado Oficial Verificado | Justificación Técnica y Evidencia Concluyente |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 Crítica | **Pendiente de intervención operativa en base activa** *(Mitigado en configuración y validado en QA)* | Separación formal bootstrap (`postgres`) vs. runtime (`nexus_app` no-superuser) en `migrations/06_runtime_user.sql` y `docker-compose.yml`. Validado al 100% en QA aislado (puertos 25498 y 25496). La base activa `tv-db` no fue alterada para salvaguardar la disponibilidad operativa. Requiere ventana de mantenimiento DBA. |
| **AUD-002** | Heartbeat y autenticación de pantallas | P1 Crítica | **Corregido y Verificado** | Autenticación criptográfica obligatoria vía token/hash SHA-256 en cabeceras HTTP y WebSocket. Rechazo 401 para hashes nulos, tokens incorrectos o pantallas ajenas (`tv-heartbeat.test.js` y `tv-heartbeat-integration.test.js`). |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 Crítica | **Corregido y Verificado en Docker/CI (Node 24 LTS)** | `source-map-js@1.2.2` fijado por `overrides` en `package.json` y lockfiles actualizados. `npm audit` reporta 0 vulnerabilidades. *(Nota: el control de RBAC granular en rutas administrativas se evaluó y validó de forma independiente en `rbac-authorization.test.js`, sin apropiarse de este ID)*. |
| **AUD-004** | Validación de archivos multimedia | P2 Alta | **Corregido y Verificado** | Validación estricta multi-nivel (firmas binarias + decodificación real con FFmpeg/FFprobe `-err_detect explode -xerror -v error`). Rechazo de archivos corruptos, eliminación garantizada de huérfanos y límite acotado de decodificación a 2 segundos para protección anti-DoS en streams de vídeo (`media-upload.test.js` y `media-real-ffprobe.test.js`). |
| **AUD-005** | Entrega y consistencia del emparejamiento | P2 Alta | **Corregido y Verificado** | Eliminada la transacción PostgreSQL de larga duración. Implementada arquitectura de transacciones cortas con persistencia durable en `nexus_tv.pending_pairings` y confirmación explícita (ACK). Reconciliación automática periódica cada 1 minuto y fail-safe HTTP 503 ante ausencia de esquema (`pairing-ack.test.js`: 28/28 tests PASS). |
| **AUD-006** | Token de dispositivo en la query string de Socket.IO | P2 Media | **Pendiente** | Identificado en auditoría inicial; pendiente de migración completa a headers/auth handshake eliminando el fallback por query string. |
| **AUD-007** | Acceso público a recursos multimedia (`/media/*`) | P2 Media | **Pendiente** | Pendiente de definición formal del modelo de negocio (CDN público vs. URLs firmadas temporales o tokens de pantalla) e implementación de la política correspondiente. No se declara mitigado sin política efectiva. |
| **AUD-008** | Publicación del puerto PostgreSQL fuera de loopback | P2 Operacional | **Pendiente de aplicación efectiva** *(Mitigado en configuración declarada)* | `docker-compose.yml` restringe el puerto a `127.0.0.1:25432`. El contenedor activo `tv-db` continúa publicando físicamente en `0.0.0.0:25432` hasta recreación controlada en ventana de mantenimiento. |

---

## 3. Ciclo de Vida de `nexus_tv.pending_pairings` en Instalación Limpia

### 3.1 Integración en el Procedimiento de Inicialización
La migración [migrations/07_pending_pairings.sql](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/migrations/07_pending_pairings.sql) se encuentra integrada en el directorio estándar de migraciones `./migrations`, el cual está mapeado directamente a `/docker-entrypoint-initdb.d` en [docker-compose.yml](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docker-compose.yml).

### 3.2 Despliegue y Validación Empírica en Contenedor Limpio (01–07)
Para comprobar que una instalación limpia ejecuta la totalidad de las migraciones en el orden esperado sin requerir intervención manual ni bloques `COPY` con datos de producción:
1. Se inicializó un contenedor PostgreSQL limpio e independiente (`nexus-qa-clean-07-val`) en el puerto `127.0.0.1:25496` con un volumen exclusivo (`nexus_qa_clean_07_pgdata`).
2. Se cargó el conjunto higienizado de migraciones 01 a 07 sin datos reales (`COPY 0`).
3. El proceso de inicialización (`docker-entrypoint.sh`) ejecutó secuencialmente:
   - `01_init_nexus_tv.sql` -> Creación de esquema y tablas base.
   - `02_playlist_content_24_7.sql` -> Ajustes de horario.
   - `03_playlist_ordering.sql` -> Índices de posición.
   - `04_distribute_library_content.sql` -> Configuración de contenido.
   - `04_sync_screen_id_sequence.sql` -> Sincronización de secuencia.
   - `05_device_auth.sql` -> Campos criptográficos de token.
   - `06_runtime_user.sql` -> Creación del rol `nexus_app` y concesión de permisos mínimos (DML operativo, read-only en `users`, revocación de DDL/TRUNCATE).
   - `07_pending_pairings.sql` -> Creación de `nexus_tv.pending_pairings`, índices de búsqueda y grants para roles existentes.
4. **Verificación de Estructura de Catálogo:**
   - Tabla `nexus_tv.pending_pairings` creada con columnas: `id`, `tv_uuid`, `pairing_session_id`, `pending_device_token_hash`, `status`, `expires_at`, `created_at`, `updated_at`.
   - Índices creados: `pending_pairings_pkey`, `pending_pairings_pairing_session_id_key`, `idx_pending_pairings_lookup`, `idx_pending_pairings_status_exp`.
5. **Verificación de Mínimo Privilegio con `nexus_app`:**
   - Rol `nexus_app`: `rolsuper = false`, `rolcreaterole = false`, `rolcreatedb = false`.
   - Operaciones DML sobre `pending_pairings` (`INSERT`, `SELECT ... FOR UPDATE`, `UPDATE`, `DELETE`) ejecutadas exitosamente bajo `nexus_app`.
   - Operaciones administrativas indebidas denegadas estrictamente con código PostgreSQL `42501`:
     - `TRUNCATE TABLE nexus_tv.pending_pairings` -> Denegado (`42501`).
     - `ALTER TABLE nexus_tv.pending_pairings ...` -> Denegado (`42501`).
     - `ALTER ROLE nexus_app SUPERUSER` -> Denegado.
   - El backend completa el flujo completo de emparejamiento utilizando **exclusivamente el rol de runtime** sin requerir superusuario en ningún momento.

---

## 4. Eliminación del Fallback en Memoria y Comportamiento Fail-Safe

En revisiones preliminares, si la tabla `nexus_tv.pending_pairings` no estaba instalada (error `42P01`), el servidor capturaba el error y continuaba el proceso manteniendo el hash únicamente en la memoria de Node.js (`_session.pendingTokenHash`).

### Evaluación de Riesgo del Fallback en Memoria:
- Si el servidor se reiniciaba, caía o escalaba horizontalmente entre la entrega del token y la recepción del ACK, el estado pendiente se perdía irreversiblemente.
- No existía mecanismo persistente de auditoría ni reconciliación determinista en base de datos.

### Corrección Implementada:
1. **Eliminación Total del Fallback:** Se retiraron las cláusulas en [src/routes/admin.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/admin.js) que permitían promover credenciales desde memoria sin respaldo en base de datos.
2. **Respuesta Explícita Fail-Safe:** Si la consulta `INSERT` o `SELECT FOR UPDATE` sobre `nexus_tv.pending_pairings` arroja `42P01` (tabla no existe), el endpoint aborta la vinculación de forma inmediata, revierte cualquier cambio y responde con:
   - **HTTP Status:** `503 Service Unavailable`.
   - **Código de Error:** `PAIRING_SCHEMA_NOT_MIGRATED`.
   - **Mensaje:** `"La base de datos requiere la migración 07_pending_pairings para emparejar pantallas."`
   - **Garantía de Seguridad:** El token de dispositivo **nunca se entrega** por Socket.IO a la pantalla, previniendo falsos éxitos o estados huérfanos.
3. **Prueba Automatizada:** Verificada mediante la subprueba `AUD-005.26 [Fail-Safe]`.

---

## 5. Expiración, Limpieza y Reconciliación Automatizada

### 5.1 Mecanismo de Reconciliación en Producción
La función `reconcilePendingPairings(pool)` fue integrada en el ciclo de vida del servidor en [src/services/cron.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/services/cron.js):
1. **Al Arranque del Servidor (`Boot Reconciliation`):**
   - Se ejecuta una pasada inmediata para reconciliar cualquier registro pendiente vencido que haya quedado huérfano tras caídas o reinicios del proceso backend.
2. **Cadencia Periódica Programada (`Cron Reconciliation`):**
   - Configurada cada 1 minuto (`* * * * *`) mediante `node-cron`.
   - Limpia de forma determinista cualquier vinculación pendiente con `status = 'pending' AND expires_at <= NOW()`, marcándola como `'expired'`.
3. **Efectos y Garantías Comprobadas:**
   - **Idempotencia:** Ejecutar la reconciliación repetidamente es estrictamente idempotente. Registros ya marcados como `expired` o `promoted` no sufren mutaciones adicionales (probado en `AUD-005.27`).
   - **Inviolabilidad de Credenciales Activas:** La limpieza opera exclusivamente sobre la tabla `nexus_tv.pending_pairings`. La tabla `nexus_tv.tv_screens` y sus tokens activos nunca son alterados ni invalidados durante el barrido (probado en `AUD-005.25`).
   - **Aislamiento por Sesión:** Cancelar o expirar una sesión antigua jamás cancela ni interfiere con otra sesión concurrente que posea un `pairingSessionId` diferente (probado en `AUD-005.28`).
   - **Sin Bloqueo de Concurrencia:** La transacción corta 1 confirma a disco inmediatamente tras registrar la vinculación pendiente. Mientras la sesión espera el ACK (hasta 10s), **no existen transacciones PostgreSQL abiertas**, permitiendo que heartbeats concurrentes de la misma pantalla u otras pantallas se ejecuten en paralelo sin bloqueos (tiempo de respuesta: ~96–115ms, probado en `AUD-005.19`).

---

## 6. Resultados Exactos del Runner de Pruebas

Todas las cifras provienen directamente de las ejecuciones del runner oficial de Node.js (`node --test`).

### 6.1 Suite Especializada de Pairing y ACK (`tests/pairing-ack.test.js`)
Ejecutada contra la base de datos PostgreSQL aislada en puerto `25499` con rol de runtime `nexus_app`:
```
1..28
# tests 28
# suites 0
# pass 28
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 4515.2337
```
**Desglose de subpruebas destacadas:**
- `AUD-005.1` a `AUD-005.17`: Protocolo de entrega con confirmación, detección de desconexión, rechazo de ACK tardío/falso, rollback y auto-sanación.
- `AUD-005.18 [QA PostgreSQL]`: Transacción 1 (registro pendiente) confirma antes de entregar token por WebSocket.
- `AUD-005.19 [QA PostgreSQL]`: Heartbeat concurrente no bloqueado durante espera de ACK (~100ms).
- `AUD-005.20 [QA PostgreSQL]`: Sesión expirada no puede activar la credencial pendiente.
- `AUD-005.21 [QA PostgreSQL]`: ACK duplicado o tardío no genera vinculaciones múltiples.
- `AUD-005.22 [QA PostgreSQL]`: Socket ajeno no puede confirmar sesión de otro dispositivo.
- `AUD-005.23 [QA PostgreSQL]`: Fallo en transacción final no emite `admin:tv_bound`.
- `AUD-005.24 [QA PostgreSQL]`: Interrupción del backend no deja pantallas declaradas como vinculadas.
- `AUD-005.25 [QA PostgreSQL]`: Recuperación tras interrupción reconcilia registros pendientes sin tocar credenciales activas.
- `AUD-005.26 [Fail-Safe]`: Ausencia de tabla `pending_pairings` (42P01) responde HTTP 503 sin permitir pairing en memoria.
- `AUD-005.27 [QA PostgreSQL]`: Reconciliación repetida es estrictamente idempotente.
- `AUD-005.28 [QA PostgreSQL]`: Cancelación de una sesión no afecta otra sesión concurrente con distinto `pairingSessionId`.

### 6.2 Suite de Instalación Limpia y Mínimo Privilegio (`tests/clean-bootstrap.test.js`)
Ejecutada contra el contenedor de clean bootstrap en puerto `25498`:
```
1..1
# tests 11
# suites 0
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 591.2309
```
- Subtest 1–8: Validación de atributos no-superuser, denegación de mutaciones sobre `users`, denegación de `TRUNCATE`/`ALTER ROLE` y denegación de acceso cruzado a base `postgres`.
- Subtest 9: Verificación de presencia de tabla `nexus_tv.pending_pairings` e índices `idx_pending_pairings_lookup` y `idx_pending_pairings_status_exp`.
- Subtest 10: Verificación de permisos DML completos de `nexus_app` sobre `pending_pairings` y denegación de `TRUNCATE`.

### 6.3 Suite Completa de Backend en Host Windows
```
1..113
# tests 151
# suites 0
# pass 148
# fail 0
# cancelled 0
# skipped 3 (pruebas de ffprobe binario en host sin PATH de ffmpeg local)
# todo 0
# duration_ms 11655.3663
```

### 6.4 Reproducción Limpia en Contenedor Docker Node 24 Alpine con FFmpeg
Ejecutada mediante `docker run --rm --network host -v "${stageDir}:/app" -w /app node:24-alpine sh /app/run_docker_repro.sh`:
```
=== 1. INSTALL FFmpeg AND NETCAT IN NODE 24 RUNTIME ===
ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers
ffprobe version 8.1.2 Copyright (c) 2007-2026 the FFmpeg developers
=== 2. VERIFY CONNECTIVITY TO QA DATABASE ===
Connection to 127.0.0.1 25499 port [tcp/*] succeeded!
QA PostgreSQL (127.0.0.1:25499) reachable!
=== 3. CLEAN BACKEND NPM CI & AUDIT ===
found 0 vulnerabilities
=== 4. RUN FULL BACKEND TEST SUITE IN CLEAN DOCKER NODE 24 ENVIRONMENT ===
ℹ tests 151
ℹ suites 0
ℹ pass 151
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11362.50103
=== 5. CLEAN FRONTEND NPM CI, LINT, BUILD & AUDIT ===
oxlint: Found 10 warnings and 0 errors.
vite build: built in 875ms (126 modules transformed)
found 0 vulnerabilities
=== 6. CLEAN REPRODUCIBILITY VALIDATION COMPLETED SUCCESSFULLY ===
```

---

## 7. Archivos Modificados y Riesgos Residuales

### Archivos Modificados en Misión 3F:
1. [src/routes/admin.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/admin.js):
   - Eliminado fallback en memoria ante error `42P01`.
   - Incorporado lanzamiento de `PairingSessionError('PAIRING_SCHEMA_NOT_MIGRATED', ..., 503)` ante ausencia de `nexus_tv.pending_pairings`.
   - Preservado mensaje informativo en respuestas HTTP 503 para el operador.
2. [src/services/cron.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/services/cron.js):
   - Incorporada Tarea 3: reconciliación periódica automática de vinculaciones pendientes caducadas cada 1 minuto (`* * * * *`).
   - Incorporada reconciliación inmediata al arranque del backend (`Boot Reconciliation`) para recuperar registros pendientes tras reinicios.
3. [tests/clean-bootstrap.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/clean-bootstrap.test.js):
   - Incorporados subtests 9 y 10 para verificar la existencia de `pending_pairings`, sus índices y las facultades DML del rol `nexus_app`.
4. [tests/pairing-ack.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/pairing-ack.test.js):
   - Soporte para simular `tableMissing` en el harness.
   - Incorporadas subpruebas 26 (fail-safe 503), 27 (idempotencia de reconciliación) y 28 (aislamiento entre sesiones concurrentes).
5. [tests/pairing-session.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/pairing-session.test.js):
   - Actualizado el mock de pruebas para registrar y resolver las consultas sobre `nexus_tv.pending_pairings`.
6. [docs/13-testing/results/MISSION-3E-VERIFICATION-REPORT-2026-10-10.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/MISSION-3E-VERIFICATION-REPORT-2026-10-10.md):
   - Corregida la tabla oficial de hallazgos restaurando los IDs originales (AUD-001 a AUD-008).

### Riesgos Residuales y Acciones Pendientes de Producción:
1. **AUD-001 (Producción):** El contenedor activo de producción `tv-db` sigue ejecutándose con el superusuario legado `nexus_user` hasta que el DBA aplique la migración de roles en ventana de mantenimiento.
2. **AUD-008 (Producción):** El contenedor activo `tv-db` continúa publicando físicamente en `0.0.0.0:25432` en el host de producción hasta que se ejecute la recreación controlada del contenedor.
3. **AUD-007 (Negocio):** La exposición pública del directorio `/media/*` sigue pendiente de una decisión de arquitectura de negocio (si los recursos deben protegerse mediante URLs prefirmadas o autenticación por pantalla).
4. **AUD-006 (Handshake):** El paso de tokens en query strings de Socket.IO permanece pendiente de migración a headers y handshake de Socket.IO en el backend para retirar la compatibilidad legada.

---

## 8. Conclusión de Aceptación

La nueva arquitectura de emparejamiento con persistencia durable en `nexus_tv.pending_pairings` y confirmación explícita (ACK):
1. **No bloquea operaciones de concurrencia** ni retiene transacciones PostgreSQL mientras espera la respuesta de la pantalla.
2. **Es determinista y segura ante fallos:** no permite éxitos falsos en memoria si falta el esquema de base de datos.
3. **Se reconcilia automáticamente:** tanto al iniciar como cada 1 minuto de forma periódica e idempotente.
4. **Opera con privilegios mínimos:** el usuario de runtime `nexus_app` tiene acceso completo a las operaciones requeridas sin requerir superusuario ni facultades administrativas.
5. **Cero regresiones:** la suite completa de 151 pruebas de backend y la compilación de frontend pasan con 100% de éxito en entorno limpio reproducible Docker Node 24 Alpine.
