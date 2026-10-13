# INFORME DE REMEDIACIÓN Y VERIFICACIÓN — MISIÓN 3 (2026-10-09)

**Proyecto:** Nexus TV Enterprise (`tv_gsi`)  
**Fecha:** 2026-10-09  
**Rol:** Ingeniero sénior de software, seguridad y QA  
**Estándar Operativo:** Trazabilidad, cambios mínimos, pruebas reproducibles, documentación viva, separación estricta entre corrección, mitigación y verificación.  
**Estado de Git:** 0 commits, 0 pushes, 0 cambios de rama. Entorno activo de producción intacto (volumen `tv_gsi_tv_pgdata` y contenedor `tv-db` preservados sin modificaciones destructivas).

---

## 1. Resumen Ejecutivo y Alcance de Misión 3

La Misión 3 aborda la remediación técnica, verificación automatizada y documentación rigurosa de dos hallazgos de severidad P2 priorizados tras el cierre de las Misiones 2..2D:

1. **AUD-004 (P2) — Validación Segura de Archivos Multimedia Subidos:**
   - **Causa Raíz:** `src/routes/media.js` dependía de extensiones y del MIME provisto por el cliente HTTP, sin validación de firmas binarias (*magic bytes*). `ffprobe` permitía duraciones artificiales o comportamientos indeterminados ante streams de vídeo corruptos, y no existía política garantizada de limpieza transaccional de archivos huérfanos ante fallos de validación o inserción en base de datos.
   - **Remediación:** Implementación del validador de bajo nivel [src/utils/mediaValidator.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/utils/mediaValidator.js) con inspección estricta de *magic bytes*, allowlist exhaustiva de imágenes/vídeos, bloqueo de ejecutables (PE, ELF, scripts, PHP), política restrictiva contra SVG (sin sanitizador), nombres de archivo de alta entropía UUID v4, y limpieza inmediata (*safeUnlink*) ante cualquier error. Refactorización completa de [src/routes/media.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/media.js).
   - **Verificación:** Suite dedicada [tests/media-upload.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/media-upload.test.js) con 9 pruebas exhaustivas (9/9 PASS).
   - **Clasificación Oficial:** **Corregido y verificado**.

2. **AUD-005 (P2) — Entrega Confiable del Token de Emparejamiento (Pairing ACK):**
   - **Causa Raíz:** `src/services/pairingSessionManager.js` ejecutaba `socket.volatile.emit('command:assign_profile', ...)` y marcaba la sesión como vinculada (`status = 'bound'`) de inmediato. Bajo congestión de red, desconexión repentina o fallo del cliente en guardar la credencial en `localStorage`, la base de datos y la sesión quedaban marcadas como vinculadas exitosamente mientras la pantalla física seguía desvinculada.
   - **Remediación:** Sustitución de la emisión volátil por el protocolo determinista `deliverWithConfirmation` en [src/services/pairingSessionManager.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/services/pairingSessionManager.js) con soporte dual de ACK callback y evento `tv:pairing_confirmed`, timeout acotado, 1 reintento seguro e idempotente, compensación transaccional (`rollback()`) ante timeout/rechazo/desconexión, y actualización del cliente [frontend/src/components/TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx) con confirmación post-persistencia, rechazo ante fallos de cuota de disco y ofuscación total de tokens en logs.
   - **Verificación:** Suite dedicada [tests/pairing-ack.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/pairing-ack.test.js) con 8 pruebas deterministas (8/8 PASS) y harness [tests/pairing-session.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/pairing-session.test.js) (5/5 PASS).
   - **Clasificación Oficial:** **Corregido y verificado**.

3. **Aclaración Procedimental de AUD-001 y AUD-008:**
   - Actualización explícita en informes de auditoría sobre la naturaleza de volúmenes persistentes en PostgreSQL y directivas Docker.
   - Clasificación mantenida: **Mitigado en configuración / Corregido y verificado en QA aislado / Pendiente de intervención operativa en el entorno activo**.

---

## 2. Remediación Detallada de AUD-004 (Validación de Archivos Multimedia)

### 2.1 Módulo Criptográfico y Validador Binario ([src/utils/mediaValidator.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/utils/mediaValidator.js))

Se desarrolló una biblioteca especializada de validación binaria sin dependencias no auditadas, implementando:
1. **Detección Determinista de Magic Bytes:**
   - **Imágenes Permitidas:**
     - JPEG: `FF D8 FF`
     - PNG: `89 50 4E 47 0D 0A 1A 0A`
     - GIF: `GIF87a` / `GIF89a`
     - WebP: Contenedor RIFF (`52 49 46 46` en offset 0) + firma `WEBP` (`57 45 42 50` en offset 8)
   - **Vídeos Permitidos:**
     - WebM / Matroska: Cabecera EBML (`1A 45 DF A3`) con tag descriptivo `webm` o `matroska`
     - MP4 / MOV / M4V: ISO Base Media File Format con cajas `ftyp` (marcas `isom`, `iso2`, `mp41`, `mp42`, `qt  `, etc.), `moov`, `mdat` o `wide`
2. **Rechazo Explícito de Cabeceras Peligrosas:**
   - Ejecutables Windows PE (`MZ...` / `4D 5A`)
   - Ejecutables Linux ELF (`\x7fELF` / `7F 45 4C 46`)
   - Scripts Shell Unix (`#!/`)
   - Archivos PHP (`<?php`)
   - Archivos comprimidos ZIP/JAR/APK (`PK\x03\x04`)
   - Prohibición estricta de SVG/HTML/XML (`<svg`, `<?xml`, `<html`, `<script`) por política de prevención de Cross-Site Scripting (XSS).
3. **Comprobación Cruzada de Coherencia:**
   - Verifica que la extensión pertenezca a la allowlist canónica del tipo detectado (`ALLOWED_MIME_TO_EXT`). Si un archivo PNG se renombra como `.jpg` o `.mp4`, se rechaza con código `MEDIA_EXTENSION_MISMATCH`.
   - Verifica que el MIME declarado por el cliente pertenezca a la misma familia que la firma real (`image/*` vs `video/*`). Si se declara `video/mp4` para un PNG, se rechaza con `MEDIA_MIME_MISMATCH`.
4. **Inspección de Vídeo Determinista (`probeVideoDuration`):**
   - Utiliza `ffprobe` sobre el stream binario.
   - Si `ffprobe` falla, encuentra streams dañados o la duración es `<= 0` / no finita, rechaza de inmediato con error `VIDEO_PROBE_FAILED` y elimina el archivo físico.
5. **Generación Segura de Nombres:**
   - `generateSecureMediaFilename(ext)`: Genera nombres mediante `crypto.randomUUID() + ext`, impidiendo cualquier influencia del nombre original en rutas de almacenamiento (*path traversal* o colisiones).

### 2.2 Refactorización de la Ruta de Subida ([src/routes/media.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/media.js))

1. **Almacenamiento Aislable:** Multer almacena archivos con UUIDs criptográficos en `req.app?.locals?.mediaDirectory || mediaDirectory`.
2. **Ciclo de Validación Pre-Persistencia:**
   - La validación binaria `validateMediaFile(req.file)` se ejecuta inmediatamente después de recibir el archivo y **antes de cualquier consulta a PostgreSQL**.
   - Ante cualquier fallo de validación, se ejecuta `await safeUnlink(uploadedFilePath)` y se responde con HTTP 400 y código unívoco.
3. **Manejo Atómico de Base de Datos:**
   - La inserción en `nexus_tv.content` está protegida por bloques `try...catch`.
   - Si la consulta a la base de datos arroja error (caída de conexión, violación de constraint, etc.), se invoca inmediatamente `await safeUnlink(uploadedFilePath)`, garantizando **cero archivos huérfanos** en el almacenamiento físico.
4. **Límites de Carga Protegidos:** Multer intercepta `LIMIT_FILE_SIZE` y responde HTTP 400 (`500MB max`).

### 2.3 Matriz de Verificación AUD-004 ([tests/media-upload.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/media-upload.test.js))

| ID Caso | Escenario | Entrada / Fixture | Resultado Esperado | Resultado Observado | Estado |
|---|---|---|---|---|---|
| **AUD-004.1** | Imagen válida permitida | Buffer PNG sintético con IHDR válido, `banner.png`, `image/png` | HTTP 201, UUID generado, registro en DB | HTTP 201, `source_type: local_file`, `content_type: image`, 1 archivo UUID en disco | **PASS** |
| **AUD-004.2** | Vídeo válido permitido | Buffer MP4 sintético con ftyp box, `commercial.mp4`, `video/mp4`, ffprobe mock 15s | HTTP 201, registro en DB, duración 15s | HTTP 201, `duration_seconds: 15`, 1 archivo UUID en disco | **PASS** |
| **AUD-004.3** | Ejecutable / script camuflado | PE header `MZ...` como `.jpg`, Script Bash `#!/bin/bash` como `.png`, Payload SVG con `<script>` | HTTP 400 `DANGEROUS_FILE_SIGNATURE`, archivo eliminado | HTTP 400, 0 registros en DB, 0 archivos huérfanos en disco | **PASS** |
| **AUD-004.4** | MIME en conflicto con firma | Firma PNG real declarada como `video/mp4` | HTTP 400 `MEDIA_MIME_MISMATCH`, archivo eliminado | HTTP 400, 0 archivos huérfanos | **PASS** |
| **AUD-004.5** | Extensión en conflicto con firma | Firma PNG real con nombre `picture.mp4` | HTTP 400 `MEDIA_EXTENSION_MISMATCH`, archivo eliminado | HTTP 400, 0 archivos huérfanos | **PASS** |
| **AUD-004.6** | Vídeo corrupto o fallo ffprobe | Buffer MP4 con stream no legible o fallo ffprobe | HTTP 400 `VIDEO_PROBE_FAILED`, archivo eliminado | HTTP 400, 0 archivos huérfanos, 0 registros en DB | **PASS** |
| **AUD-004.7** | Exceso de tamaño | Buffer de 2048 bytes con límite configurado en 1024 bytes | HTTP 400 `LIMIT_FILE_SIZE` | HTTP 400, mensaje de tamaño máximo, 0 archivos huérfanos | **PASS** |
| **AUD-004.8** | Fallo de inserción en DB | Inserción en base de datos arroja excepción | HTTP 500, compensación física inmediata | HTTP 500, archivo temporal unlinked de inmediato | **PASS** |
| **AUD-004.9** | Ausencia total de huérfanos | Secuencia de uploads inválidos (basura, binario PE, discrepancias) | Carpeta temporal limpia | `fs.readdirSync().length === 0` | **PASS** |

---

## 3. Remediación Detallada de AUD-005 (Entrega Confiable de Token de Pairing)

### 3.1 Protocolo Transaccional en Servidor ([src/services/pairingSessionManager.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/services/pairingSessionManager.js))

Se reestructuró la función `bind()` para incorporar el mecanismo de confirmación `deliverWithConfirmation`:
1. **Emisión Confiable (Non-Volatile):** Se eliminó por completo `socket.volatile.emit`. La emisión de `command:assign_profile` se realiza mediante canales TCP/WebSocket confiables de Socket.IO, incluyendo el `pairingSessionId` en el payload.
2. **Espera de Acknowledgment Acotada:**
   - La sesión permanece en estado transitorio `binding` mientras espera la confirmación de la pantalla receptora.
   - Escucha concurrentemente:
     - El callback de retorno de Socket.IO (`ack(response)`).
     - El evento explícito de socket `tv:pairing_confirmed`.
     - Eventos de desconexión prematura de la pantalla (`disconnect`).
     - Eventos de rechazo explícito por error de almacenamiento (`tv:pairing_rejected`).
   - Timeout configurable (`ackTimeoutMs`, por defecto 5000 ms, ajustable en tests).
3. **Reintentos Idempotentes y Bounded:**
   - Si la primera entrega experimenta un timeout pero el socket sigue conectado y la sesión no ha vencido, se permite exactamente 1 reintento seguro reutilizando la misma credencial previamente generada.
   - No se generan tokens duplicados ni bucles infinitos de reintento.
4. **Compensación Transaccional y Reversión:**
   - Si el cliente rechaza (`PAIRING_CONFIRMATION_REJECTED`), no responde antes del timeout (`PAIRING_CONFIRMATION_TIMEOUT`) o se desconecta (`PAIRING_SESSION_DISCONNECTED`):
     - Se ejecuta inmediatamente `await bindingResult.rollback()`, restaurando el registro `nexus_tv.tv_screens` a su estado previo (desactivando `is_active` y limpiando `device_token_hash`).
     - Si la sesión aún se encuentra dentro del plazo TTL y la pantalla permanece conectada, el estado se revierte a `pending` (estado recuperable, permitiendo que el administrador vuelva a intentar la vinculación).
     - Si el TTL expiró o la pantalla se desconectó, la sesión transiciona a `expired` o `cancelled`.
5. **Aislamiento contra Confirmaciones Espurias o Cruzadas:**
   - Se valida estrictamente que `data.pairingSessionId === session.pairingSessionId`.
   - Se valida que `data.tv_uuid === session.targetTvUuid`. Confirmaciones con UUIDs divergentes son rechazadas con error `400` (`PAIRING_CONFIRMATION_MISMATCH`).
   - Confirmaciones duplicadas posteriores a la transición `bound` son tratadas de forma idempotente sin generar escrituras adicionales ni errores no controlados.

### 3.2 Cliente Web TVPlayer ([frontend/src/components/TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx))

1. **Persistencia Previa a Confirmación:**
   - Al recibir `command:assign_profile`, el cliente almacena primero `tv_uuid` y `tv_device_token` en `localStorage`.
   - Solo tras completar con éxito las escrituras locales, emite tanto el callback `ack({ success: true, tv_uuid, pairingSessionId })` como el evento `tv:pairing_confirmed`.
2. **Manejo de Excepciones de Almacenamiento:**
   - Si `localStorage` arroja una excepción (ej. `QuotaExceededError` o bloqueo de privacidad), el cliente captura el error y responde con `ack({ success: false })` y `socket.emit('tv:pairing_rejected', { reason: 'storage_error' })`.
3. **Higienización de Registros y Logs de Consola:**
   - Se eliminó el volcado del objeto `profile` en claro. Se aplica desestructuración: `const { device_token, ...safeProfile } = profile; console.log(..., safeProfile);`. El `device_token` jamás se imprime en consola ni en trazas de error.

### 3.3 Matriz de Verificación AUD-005 ([tests/pairing-ack.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/pairing-ack.test.js))

| ID Caso | Escenario | Condición Evaluada | Resultado Esperado | Resultado Observado | Estado |
|---|---|---|---|---|---|
| **AUD-005.1** | No entrega volátil ciega | Pantalla recibe `command:assign_profile` pero no confirma | HTTP 408 Timeout, sesión no queda en `bound` | HTTP 408, sesión no vinculada | **PASS** |
| **AUD-005.2** | No vincular antes de ACK | Inspección de estado mientras el cliente demora 100ms el ACK | Estado es `binding`, `admin:tv_bound` no se emite antes del ACK | Estado verificado en `binding`, evento admin emitido solo post-ACK | **PASS** |
| **AUD-005.3** | Timeout deja estado recuperable | Pantalla en silencio agota timeout de ACK | Rollback en DB ejecutado, sesión regresa a `pending`, reintento posterior exitoso | Rollback verificado (`is_active=false`), segundo intento concluye en `bound` | **PASS** |
| **AUD-005.4** | Confirmación negativa | Pantalla simula fallo en `localStorage` y emite `tv:pairing_rejected` | HTTP 422, rollback en DB, sesión no vinculada | HTTP 422 `PAIRING_CONFIRMATION_REJECTED`, rollback verificado | **PASS** |
| **AUD-005.5** | Mensajes duplicados | Emisión repetida de `tv:pairing_confirmed` y llamada HTTP reintentada por Admin | Idempotencia: 1 sola escritura en DB, reintento devuelve `alreadyBound: true` | HTTP 200, 1 sola escritura registrada, cero inconsistencias | **PASS** |
| **AUD-005.6** | Sesión ajena o expirada | Pantalla A intenta confirmar sesión de Pantalla B; intento de binding en sesión expirada | Confirmación cruzada ignorada, sesión expirada responde HTTP 410 | Binding de Pantalla B no afectado, sesión expirada rechaza con 410 | **PASS** |
| **AUD-005.7** | Flujo nominal completo | Pantalla persiste credenciales en almacenamiento local y confirma | HTTP 200, sesión en `bound`, credenciales guardadas en cliente | HTTP 200, `localStorage` poblado, `admin:tv_bound` recibido | **PASS** |
| **AUD-005.8** | Cero tokens en logs | Intercepción de stdout durante proceso completo de vinculación | El hash o token secreto en claro jamás aparece en logs | 100% de los logs validados libres de tokens | **PASS** |

---

## 4. Estado Consolidado de la Auditoría y Hallazgos

| ID | Hallazgo | Severidad | Estado Misión 2D | Estado Final Misión 3 | Justificación y Evidencia |
|---|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | Mitigado en configuración / QA aislado / Pendiente en producción | **Mitigado en configuración / Corregido y verificado en QA aislado / Pendiente de intervención operativa en el entorno activo** | Procedimiento documental actualizado aclarando que `docker-compose.yml` no modifica volúmenes poblados preexistentes y que los scripts en `/docker-entrypoint-initdb.d` no se ejecutan sobre volúmenes poblados. Requiere ventana DBA controlada. |
| **AUD-002** | Heartbeat anónimo y fuga de errores | P1 | Corregido y verificado | **Corregido y verificado** | Preservado intacto. 19/19 tests unitarios e integración en QA PostgreSQL real. |
| **AUD-003** | Vulnerabilidad `source-map-js` | P1 | Corregido y verificado | **Corregido y verificado** | 0 vulnerabilidades en `npm audit`. Compilación reproducible verificada en Docker Node 24. |
| **AUD-004** | Upload multimedia sin allowlist de firma MIME | P2 | Pendiente | **Corregido y verificado** | [src/utils/mediaValidator.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/utils/mediaValidator.js) y [src/routes/media.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/media.js). 9/9 tests dedicados PASS en [tests/media-upload.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/media-upload.test.js). |
| **AUD-005** | Credencial de pairing sin confirmación de entrega (ACK volátil) | P2 | Pendiente | **Corregido y verificado** | [src/services/pairingSessionManager.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/services/pairingSessionManager.js) y [frontend/src/components/TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx). 8/8 tests dedicados PASS en [tests/pairing-ack.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/pairing-ack.test.js) + 5/5 tests de regresión en [tests/pairing-session.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/pairing-session.test.js). |
| **AUD-006** | Token en query string WebSocket | P2 | Mitigado / Pendiente | **Mitigado en frontend / Pendiente de retiro en backend** | Separado explícitamente de AUD-005 conforme a las directivas de misión. |
| **AUD-007** | Recursos de medios `/media/*` públicos | P2 | Pendiente | **Pendiente** | Sujeto a directrices de negocio futuras. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | Mitigado en configuración / Pendiente en producción | **Mitigado en configuración / Pendiente de intervención operativa en el entorno activo** | Compose enrutado a `127.0.0.1`. Procedimiento de recreación no destructiva documentado. Contenedor activo permanece intacto en `0.0.0.0:25432` hasta ventana de mantenimiento. |

---

## 5. Resultados de Pruebas de Regresión, Compilación y Seguridad

1. **Suite Completa Backend (`npm test`):**
   - **Total de Pruebas Ejecutadas:** **120 pruebas** (incremento de +17 pruebas respecto a Misión 2D: +9 en `media-upload.test.js`, +8 en `pairing-ack.test.js`).
   - **Resultado:** **120 pasadas, 0 fallidas, 0 canceladas, 0 omitidas** (2.55 s).
2. **Auditoría de Dependencias (`npm audit`):**
   - Backend: **0 vulnerabilidades**.
   - Frontend: **0 vulnerabilidades**.
3. **Compilación y Lint del Frontend (Entorno Reproducible Docker Node 24):**
   - Ejecutado mediante contenedor limpio `node:24-alpine` con Node `24.21.0`:
     - `npm run lint`: **0 errores** (análisis estático Oxlint completado en 1.9s sobre 883 archivos).
     - `npm run build`: **Construcción exitosa en 524ms** (Vite 8.3.0, 126 módulos transformados, chunks generados en `dist/`).
4. **Higiene de Sintaxis y Formato (`git diff --check`):**
   - **0 errores o advertencias**.
5. **Inspección de Secretos y Reglas Innegociables:**
   - Cero tokens reales, contraseñas o datos de producción incluidos en fixtures o informes.
   - Cero mutaciones en la base de datos real (`tv-db`).
   - Cero operaciones destructivas de Git (no commits, no pushes, no checkout de ramas).

---

## 6. Addendum MISIÓN 3C — Validación Definitiva y Cierre Formal (2026-10-10)

1. **AUD-004 — Decodificación Real de Contenido:**
   - Implementación de decodificación efectiva multinivel: en memoria para PNG (zlib + scanlines) y GIF (LZW dinámico), y decodificación de flujo real mediante subproceso FFmpeg con `-err_detect explode -xerror -v error` para JPEG y vídeo (`decodeMediaContent` / `decodeVideoSample`).
   - Todos los casos de stream o datos corruptos son rechazados deterministamente con erradicación de archivos huérfanos (`safeUnlink`).
   - 15/15 tests en `tests/media-upload.test.js` y 2/2 tests en `tests/media-real-ffprobe.test.js` aprobados.
2. **AUD-005 — Protocolo de Confirmación, Compensación y Auto-Sanación:**
   - Formalizado en 7 pasos sin asumir atomicidad física entre subsistemas disjuntos.
   - Inyección de fallos validada: fallos de PostgreSQL antes y durante compensación, desconexiones previas a entrega, desconexiones durante ACK, almacenamiento local rechazado, ACKs tardíos o cruzados.
   - Auto-sanación validada en frontend: purga automática de tokens huérfanos ante HTTP 401 y retorno determinista a modo PIN.
   - 16/16 tests en `tests/pairing-ack.test.js` aprobados.
3. **Reproducibilidad en Entorno Limpio:**
   - Docker Node 24 Alpine: **136/136 tests de backend aprobados (100%)**, `oxlint` 0 errores, `vite build` completado, `npm audit` 0 vulnerabilidades.

---

## 7. Addendum MISIÓN 3D — Cierre Controlado y Reconciliación Persistente (2026-10-10)

1. **AUD-004 — Decodificación WebP y Límites de Vídeo:**
   - Decodificación real de WebP integrada con FFmpeg (`decodeMediaContent`) y fallback automático en ruta de subida. Archivos WebP sintéticos válidos, corruptos y truncados validados (3/3 tests PASS en `media-real-ffprobe.test.js`).
   - Muestreo de 2 segundos en vídeo documentado formalmente como límite deliberado para protección de CPU y DoS en subidas sincrónicas.
2. **AUD-005 — Commit Diferido y Reconciliación Persistente:**
   - Confirmación a dos fases: la transacción de PostgreSQL solo se confirma a disco (`COMMIT`) tras recibir el ACK de la pantalla. Si hay desconexión o corte, PostgreSQL aborta automáticamente la transacción no confirmada.
   - En caso de fallo de compensación, la sesión transiciona a `status = 'failed'` (`rollbackFailed: true`). Reconciliación limpia probada mediante nueva sesión (`AUD-005.17` PASS).
3. **Reproducibilidad Definitiva en Contenedor Node 24 Alpine:**
   - **138/138 tests de backend aprobados (100%)**, 0 fallos, 0 omitidas.
   - `oxlint` 0 errores, `vite build` exitoso, `npm audit` 0 vulnerabilidades.


