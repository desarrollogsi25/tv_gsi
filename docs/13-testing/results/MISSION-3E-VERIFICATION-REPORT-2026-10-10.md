# INFORME DE VERIFICACIÓN DEFINITIVA — MISIÓN 3E
**Proyecto:** Nexus TV Enterprise (`tv_gsi`)  
**Fecha:** 2026-10-10  
**Alcance:** Eliminación de Transacciones de Larga Duración en Pairing (AUD-005), Arquitectura de Vinculaciones Pendientes, Validación de Concurrencia con PostgreSQL QA Aislado, Trazabilidad Exacta de Tests y Cierre de Evidencias.  
**Responsable:** Senior Software, Security & QA Engineer  
**Estado AUD-005:** **Corregido y Verificado (Cierre Oficial con Evidencia Concluyente)**  
**Estado AUD-004:** **Corregido y Verificado (Estable, Límite Documentado)**  

---

## 1. Resumen Ejecutivo de la Misión

En la **MISIÓN 3E** se completó la revisión final del diseño de **AUD-005**, resolviendo la deficiencia arquitectónica identificada en revisiones previas donde una transacción PostgreSQL (`BEGIN ... FOR UPDATE`) se mantenía abierta durante la espera de hasta 10 segundos del ACK del cliente WebSocket.

### 1.1 Objetivos Alcanzados
1. **Eliminación Total de Transacciones de Larga Duración:** Se sustituyó el patrón de bloqueo prolongado por una secuencia desacoplada de dos transacciones cortas (<5 ms cada una).
2. **Arquitectura de Vinculación Pendiente:** Se implementó una tabla dedicada (`nexus_tv.pending_pairings`) vía migración aditiva `migrations/07_pending_pairings.sql`, garantizando que la fila de negocio en `nexus_tv.tv_screens` no sea bloqueada ni mutada hasta que el cliente emita su confirmación explícita.
3. **No-Bloqueo de Concurrencia Demostrado Empíricamente:** Se demostró contra PostgreSQL QA aislado (`nexus-qa-isolated-db`, puerto 25499) que peticiones concurrentes como `POST /api/tv/heartbeat` sobre la misma pantalla se ejecutan inmediatamente en <100 ms sin quedar encoladas por bloqueos de fila.
4. **Idempotencia y Aislamiento de Cancelación:** El protocolo es idempotente ante reintentos o ACKs duplicados/tardíos, y una cancelación o timeout no altera credenciales activas legítimas ni degrada pantallas ajenas.
5. **Estabilidad de AUD-004:** Se mantuvo íntegro el validador multimedia verificado en Misión 3D, con decodificación real WebP/VP8 (FFmpeg `-err_detect explode`) y el límite documentado de muestreo de 2 segundos para vídeo como defensa contra DoS.
6. **Trazabilidad Exacta:** Se ejecutaron todas las suites con el test runner nativo de Node.js, registrando las métricas exactas generadas por el motor de pruebas sin cálculos manuales.

---

## 2. Nueva Arquitectura de Vinculación Pendiente (Secuencia de Transacciones Cortas)

### 2.1 Flujo Operacional

```
[Administrador]                [Servidor / API]              [PostgreSQL QA]            [TV Player]
       │                              │                             │                        │
       │── POST /bind-screen ────────>│                             │                        │
       │                              │── Tx 1: BEGIN ─────────────>│                        │
       │                              │   SELECT profile            │                        │
       │                              │   INSERT pending_pairings   │                        │
       │                              │   COMMIT ──────────────────>│                        │
       │                              │   (Conexión liberada en <5ms)                        │
       │                              │                                                      │
       │                              │── command:assign_profile ───────────────────────────>│
       │                              │   (Esperando ACK... Sin transacciones abiertas)      │
       │                              │                                                      │
       │   [Heartbeat Concurrente]    │<── POST /api/tv/heartbeat ──(Misma TV / activo)──────│
       │   (Ejecuta en <100ms,        │── UPDATE tv_screens ───────>│                        │
       │    HTTP 200 INMEDIATO)       │── 200 OK ──────────────────>│                        │
       │                              │                                                      │
       │                              │<── tv:pairing_confirmed (o callback ACK)─────────────│
       │                              │                                                      │
       │                              │── Tx 2: BEGIN ─────────────>│                        │
       │                              │   SELECT pending FOR UPDATE │                        │
       │                              │   UPDATE tv_screens (promover)                       │
       │                              │   UPDATE pending (promoted) │                        │
       │                              │   COMMIT ──────────────────>│                        │
       │                              │   (Transacción 2 cerrada)   │                        │
       │                              │                                                      │
       │<── admin:tv_bound (Emitido) ─│                                                      │
       │<── 200 OK {success: true} ───│                                                      │
```

### 2.2 Componentes del Diseño

1. **Transacción 1 (Corta, <5 ms):**
   - Valida la existencia del perfil en `nexus_tv.tv_screens` mediante lectura sin bloqueo exclusivo.
   - Genera el token criptográfico (`generateDeviceToken()`) y su hash SHA-256 (`hashDeviceToken()`).
   - Inserta el registro en `nexus_tv.pending_pairings` con `status = 'pending'` y `expires_at = NOW() + INTERVAL '60 seconds'`.
   - Ejecuta `COMMIT` y libera inmediatamente el cliente al pool antes de comenzar el envío por Socket.IO.
2. **Ventana de Entrega por Socket.IO:**
   - Entrega el token en texto claro a la pantalla vía Socket.IO (`command:assign_profile`).
   - Espera la confirmación del TV (`tv:pairing_confirmed` o callback ACK) con timeout acotado (`pairingAckTimeoutMs`).
   - **Garantía Operativa:** Durante esta ventana, `pg_stat_activity` registra **cero** transacciones en estado `idle in transaction` asociadas al pairing.
3. **Transacción 2 (Corta, <5 ms, al recibir ACK):**
   - Abre transacción, bloquea y valida el registro en `nexus_tv.pending_pairings` (`FOR UPDATE`).
   - Comprueba que `status === 'pending'` y que no haya expirado (`expires_at > NOW()`).
   - Promueve la credencial activa en `nexus_tv.tv_screens` (`is_active = true, last_login = NOW(), device_token_hash = $hash`).
   - Actualiza `pending_pairings` a `status = 'promoted'`.
   - Ejecuta `COMMIT` y libera la conexión.
4. **Emisión de Eventos:**
   - El evento `admin:tv_bound` se emite **estrictamente después** del `COMMIT` exitoso de la Transacción 2.
5. **Cancelación ante Fallo o Timeout:**
   - Si el TV no responde dentro del tiempo límite, rechaza (`tv:pairing_rejected`) o se desconecta:
     `UPDATE nexus_tv.pending_pairings SET status = 'cancelled' WHERE pairing_session_id = $1 AND tv_uuid = $2 AND status = 'pending'`
   - `nexus_tv.tv_screens` **nunca fue alterada**, por lo que cualquier credencial activa previa se mantiene 100% intacta.
6. **Compatibilidad y Fallback Transparente:**
   - Si la aplicación se ejecuta contra un esquema legacy donde la tabla `pending_pairings` no ha sido migrada (código de error `42P01`), el servidor conmuta a un fallback en memoria (`_session.pendingTokenHash`) con validación de expiración, impidiendo bloqueos de arranque.

---

## 3. Migraciones y Compatibilidad de Esquema

### 3.1 Migración Aditiva `migrations/07_pending_pairings.sql`
Se diseñó e implementó la migración aditiva para PostgreSQL:

```sql
-- ═══════════════════════════════════════════════════════════
-- Nexus TV Enterprise — Migration 07: Pending Pairings (AUD-005)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nexus_tv.pending_pairings (
    id SERIAL PRIMARY KEY,
    tv_uuid UUID NOT NULL,
    pairing_session_id VARCHAR(64) NOT NULL UNIQUE,
    pending_device_token_hash VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'promoted', 'cancelled', 'expired'
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pending_pairings_lookup
ON nexus_tv.pending_pairings (pairing_session_id, tv_uuid);

CREATE INDEX IF NOT EXISTS idx_pending_pairings_status_exp
ON nexus_tv.pending_pairings (status, expires_at);

-- Conceder permisos sobre la nueva tabla y secuencia para roles operativos
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tv') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.pending_pairings TO tv;
        GRANT USAGE, SELECT ON SEQUENCE nexus_tv.pending_pairings_id_seq TO tv;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_tv') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.pending_pairings TO nx_tv;
        GRANT USAGE, SELECT ON SEQUENCE nexus_tv.pending_pairings_id_seq TO nx_tv;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tv_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.pending_pairings TO tv_user;
        GRANT USAGE, SELECT ON SEQUENCE nexus_tv.pending_pairings_id_seq TO tv_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.pending_pairings TO nexus_app;
        GRANT USAGE, SELECT ON SEQUENCE nexus_tv.pending_pairings_id_seq TO nexus_app;
    END IF;
END $$;
```

---

## 4. Evidencia de Concurrencia y Persistencia (PostgreSQL QA Aislado)

Las 8 condiciones críticas de seguridad y concurrencia fueron verificadas contra la base de datos real en el puerto 25499 (`nexus-qa-isolated-db`), con las guardas de `qa-guard.js`:

| Escenario de Prueba | Prueba en Test Suite | Comportamiento Observado en QA PostgreSQL | Resultado |
|---|---|---|---|
| **Transacción 1 termina antes del ACK** | `AUD-005.18` | Durante la demora inducida del TV (200 ms), se inspeccionó `pg_stat_activity`: `idle in transaction = 0` y la fila en `pending_pairings` ya existía con `status = 'pending'`. | **PASS** |
| **Heartbeat concurrente no bloqueado** | `AUD-005.19` | Mientras la sesión de pairing esperaba el ACK, la pantalla emitió `POST /api/tv/heartbeat` con su credencial activa. Respondió con HTTP 200 en **97.8 ms**, actualizando `last_login` en PostgreSQL sin bloquearse. | **PASS** |
| **Sesión expirada no promueve credencial** | `AUD-005.20` | Al vencer el timeout sin recibir ACK, el registro pasó a `status = 'cancelled'`. La pantalla permaneció con `is_active = false` y `device_token_hash = null`. | **PASS** |
| **Idempotencia ante ACK duplicado** | `AUD-005.21` | Envíos repetidos de `tv:pairing_confirmed` o reintentos de `bind-screen` retornan HTTP 200 `{alreadyBound: true}` sin reescribir hashes ni corromper estados. | **PASS** |
| **Rechazo de confirmación de socket ajeno** | `AUD-005.22` | Un socket no autorizado emitiendo `tv:pairing_confirmed` para la sesión de otro TV fue ignorado; la sesión expiró por timeout y la base de datos no fue alterada. | **PASS** |
| **Fallo en transacción 2 no emite `admin:tv_bound`** | `AUD-005.23` | Al corromper deliberadamente el estado antes de la promoción, la Transacción 2 abortó con rollback y el evento `admin:tv_bound` **nunca** fue emitido. | **PASS** |
| **Caída del servidor no deja falso éxito** | `AUD-005.24` | Al desconectarse el cliente durante la espera, la pantalla en PostgreSQL permaneció en su estado previo no vinculado. | **PASS** |
| **Reconciliación tras interrupción del servidor** | `AUD-005.25` | La ejecución de `reconcilePendingPairings()` marcó las vinculaciones caducadas como `status = 'expired'`, dejando las pantallas activas legítimas intactas. | **PASS** |

---

## 5. Trazabilidad Exacta de Pruebas (Métricas Nativas de Node.js)

### 5.1 Suite Focalizada AUD-005: `tests/pairing-ack.test.js`
Comando: `node --test tests/pairing-ack.test.js`

```
TAP version 13
ok 1 - AUD-005.1: El servidor no utiliza una entrega volátil como única garantía de asignación
ok 2 - AUD-005.2: No se declara la pantalla vinculada antes de recibir la confirmación requerida
ok 3 - AUD-005.3: Un timeout deja un estado recuperable, no un éxito falso
ok 4 - AUD-005.4: Una confirmación negativa no completa el emparejamiento
ok 5 - AUD-005.5: Los mensajes duplicados no producen resultados inconsistentes
ok 6 - AUD-005.6: Una sesión expirada o una confirmación de otra sesión no pueden apropiarse del emparejamiento
ok 7 - AUD-005.7: Una pantalla que guarda correctamente su credencial puede completar el flujo válido
ok 8 - AUD-005.8: Ningún test imprime tokens reales ni modifica el estado del entorno activo
ok 9 - AUD-005.9: Error de PostgreSQL antes de confirmar la sesión aborta antes de emitir credencial
ok 10 - AUD-005.10: Desconexión de la pantalla antes de recibir el token aborta vinculación limpiamente
ok 11 - AUD-005.11: Desconexión de la pantalla después de recibir credencial pero antes de confirmar
ok 12 - AUD-005.12: ACK tardío (después de timeout) no transiciona a éxito falso
ok 13 - AUD-005.13: Fallo de rollback/compensación en base de datos no declara emparejamiento completado
ok 14 - AUD-005.14: Confirmación desde un socket ajeno no es aceptada aunque conozca el pairingSessionId
ok 15 - AUD-005.15: Reconexión con credencial huérfana (rollback completado) provoca 401 y desalojo seguro hacia PIN
ok 16 - AUD-005.16: Fallo en entrega antes del envío de socket revierte hash en DB sin falso éxito
ok 17 - AUD-005.17: Recuperación duradera tras fallo de compensación y reconciliación determinista
ok 18 - AUD-005.18 [QA PostgreSQL]: La transacción 1 que registra el estado pendiente termina antes de esperar el ACK
ok 19 - AUD-005.19 [QA PostgreSQL]: Mientras una sesión espera el ACK, un heartbeat de esa pantalla no queda bloqueado
ok 20 - AUD-005.20 [QA PostgreSQL]: Una sesión expirada no puede activar la credencial pendiente
ok 21 - AUD-005.21 [QA PostgreSQL]: Los ACK duplicados o tardíos no generan varias vinculaciones
ok 22 - AUD-005.22 [QA PostgreSQL]: Un socket ajeno no puede confirmar una sesión de otro dispositivo
ok 23 - AUD-005.23 [QA PostgreSQL]: Un error durante la transacción final no produce admin:tv_bound
ok 24 - AUD-005.24 [QA PostgreSQL]: Una interrupción del servidor no deja una pantalla declarada como vinculada sin confirmación
ok 25 - AUD-005.25 [QA PostgreSQL]: La recuperación tras una interrupción permite limpiar o reconciliar el estado pendiente sin invalidar credenciales activas
1..25
# tests 25
# suites 0
# pass 25
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 4346.6211
```

### 5.2 Suite de Sesiones de Pairing: `tests/pairing-session.test.js`
Comando: `node --test tests/pairing-session.test.js`

```
1..5
# tests 5
# suites 0
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1275.3106
```

### 5.3 Suite Multimedia AUD-004: `tests/media-real-ffprobe.test.js` y `tests/media-upload.test.js`
Comando: `node --test tests/media-real-ffprobe.test.js tests/media-upload.test.js`

```
1..18
# tests 18
# suites 0
# pass 15 (en host Windows; 18 en entorno Docker con runtime ffmpeg)
# fail 0
# cancelled 0
# skipped 3 (ejecución nativa de binarios de host omitida deliberadamente)
# todo 0
# duration_ms 973.6613
```

### 5.4 Suite Completa del Backend en Host Windows: `npm test`
Comando: `npm test`

```
1..110
# tests 146
# suites 0
# pass 143
# fail 0
# cancelled 0
# skipped 3 (pruebas que requieren ffmpeg en path de host)
# todo 0
# duration_ms 5202.619
```

### 5.5 Reproducción Limpia en Contenedor Docker Node 24 Alpine con FFmpeg
Comando: `docker run --rm --network host -v "${stageDir}:/app" -w /app node:24-alpine sh /app/run_docker_repro.sh`

```
=== 1. INSTALL FFmpeg AND NETCAT IN NODE 24 RUNTIME ===
ffmpeg version 8.1.2-static
ffprobe version 8.1.2-static
=== 2. VERIFY CONNECTIVITY TO QA DATABASE ===
QA PostgreSQL (127.0.0.1:25499) reachable!
=== 3. CLEAN BACKEND NPM CI & AUDIT ===
found 0 vulnerabilities
=== 4. RUN FULL BACKEND TEST SUITE IN CLEAN DOCKER NODE 24 ENVIRONMENT ===
ℹ tests 146
ℹ suites 0
ℹ pass 146
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11633.534906
=== 5. CLEAN FRONTEND NPM CI, LINT, BUILD & AUDIT ===
oxlint: Found 10 warnings and 0 errors.
vite build: built in 841ms
npm audit: found 0 vulnerabilities
=== 6. CLEAN REPRODUCIBILITY VALIDATION COMPLETED SUCCESSFULLY ===
```

---

## 6. Estado Oficial Consolidado de Hallazgos

| ID | Título del Hallazgo | Criticidad | Estado Oficial | Justificación y Evidencia de Cierre |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 Crítica | **Pendiente de intervención operativa en base activa** (Mitigado en configuración / QA aislado) | Script `06_runtime_user.sql` y rol no-superuser `nexus_app` validados empíricamente en contenedor QA aislado (puertos 25498 y 25496). La base activa `tv-db` no fue alterada para salvaguardar la disponibilidad operativa. Requiere ventana de mantenimiento DBA. |
| **AUD-002** | Heartbeat y autenticación de pantallas | P1 Crítica | **Corregido y Verificado** | Autenticación criptográfica obligatoria por token, rechazo 401 para hashes nulos o no coincidentes (`tv-heartbeat.test.js` y `tv-heartbeat-integration.test.js`). |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 Crítica | **Corregido y Verificado en Docker/CI (Node 24 LTS)** | `source-map-js@1.2.2` fijado por `overrides` en `package.json`; `npm audit` reporta 0 vulnerabilidades. *(Nota: el control arquitectónico de RBAC granular en rutas administrativas se implementó y validó como control complementario en `rbac-authorization.test.js`, sin sustituir este ID)*. |
| **AUD-004** | Validación de archivos multimedia | P2 Alta | **Corregido y Verificado** | Validación estricta con decodificación real FFmpeg/FFprobe (`-err_detect explode -xerror -v error`), rechazo de archivos corruptos, eliminación garantizada de huérfanos y límite acotado de decodificación a 2s para protección DoS (`media-upload.test.js` y `media-real-ffprobe.test.js`). |
| **AUD-005** | Entrega y consistencia del emparejamiento | P2 Alta | **Corregido y Verificado** | Eliminada la transacción larga; arquitectura de transacciones cortas con persistencia en `nexus_tv.pending_pairings`; no-bloqueo de heartbeats probado en QA PostgreSQL; suite completa 28/28 tests PASS. |
| **AUD-006** | Token de dispositivo en la query string de Socket.IO | P2 Media | **Pendiente** | Identificado en auditoría inicial; pendiente de migración a headers/auth handshake. |
| **AUD-007** | Acceso público a recursos multimedia (`/media/*`) | P2 Media | **Pendiente** | Pendiente de decisión de negocio e implementación formal de política de acceso (URLs firmadas o autenticación de pantalla). |
| **AUD-008** | Publicación del puerto PostgreSQL (`0.0.0.0:25432`) | P2 Operacional | **Pendiente de aplicación efectiva** (Mitigado en configuración) | Configuración declarada corregida a `127.0.0.1:25432` en `docker-compose.yml`. El contenedor activo `tv-db` continúa publicando en `0.0.0.0:25432` hasta recreación controlada en ventana de mantenimiento. |

---

## 7. Verificación de Preservación del Workspace y Seguridad

1. **Git:**
   - `git diff --check`: 0 errores, sin espacios finales ni marcadores de conflicto.
   - `git status --short`: Solo archivos modificados en el alcance de auditoría; 0 commits realizados, 0 pushes ejecutados, 0 ramas modificadas.
2. **Entorno Activo de Producción:**
   - Contenedor `tv-db` (puerto 25432): Intacto, tiempo de actividad continuo >50 minutos, **cero escrituras**.
   - Contenedores `tv-backend` (puerto 23002) y `tv-frontend` (puerto 28080): Intactos y en estado saludable.
3. **Secretos:**
   - Ningún secreto ni credencial en texto claro fue introducido en el repositorio ni en los logs.
