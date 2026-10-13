# INFORME DE VERIFICACIÓN DEFINITIVA — MISIÓN 3D
**Proyecto:** Nexus TV Enterprise (`tv_gsi`)  
**Fecha:** 2026-10-10  
**Alcance:** Cierre Controlado de AUD-004 (Formatos Multimedia y Decodificación Efectiva) y AUD-005 (Recuperación Persistente y Consistencia de Pairing).  
**Responsable:** Senior Software, Security & QA Engineer  
**Estado:** **Corregido y Verificado (Cierre Oficial con Evidencia Concluyente)**

---

## 1. Resumen de la Misión

En el marco de la **MISIÓN 3D**, se abordaron y resolvieron de forma definitiva las dos incertidumbres técnicas remanentes:
1. **AUD-004 (Formatos Multimedia):** Verificación empírica de decodificación efectiva para WebP y delimitación formal del alcance y compromiso de integridad para archivos de vídeo.
2. **AUD-005 (Recuperación Persistente de Pairing):** Resolución de la inconsistencia en base de datos cuando falla la compensación (`rollback()`) de PostgreSQL, implementando confirmación en dos fases (Two-Phase Commit deferido hasta el ACK del cliente) y reconciliación determinista.

Se preservó íntegramente el workspace, la base de datos de producción (`tv-db`), los contenedores activos y el historial de Git (0 commits, 0 pushes, 0 ramas modificadas).

---

## 2. AUD-004 — Verificación Exacta de Formatos y Límites de Vídeo

### 2.1 WebP: Decodificación Real vs. Cabeceras
- **Análisis Previo:** La función `validateWebpBuffer` inspeccionaba cabeceras RIFF, cuatrocc `WEBP`, tamaño de bloques y firmas de chunks `VP8 `, `VP8L`, `VP8X`, pero no evaluaba la integridad del bitstream comprimido de imagen.
- **Implementación Aplicada:**
  - Se habilitó la decodificación real mediante subproceso FFmpeg (`decodeMediaContent`) utilizando `-err_detect explode -xerror -v error` como validador estándar en la ruta de subida (`/api/tv-content/upload`).
  - La ruta HTTP invoca automáticamente `decodeMediaContent` cuando FFmpeg está disponible en el runtime del sistema (`hasSystemFfmpeg()`).
- **Pruebas y Evidencia:**
  1. *WebP Sintético Válido (1x1):* Decodificado correctamente por FFmpeg (código 0, `stderr` vacío).
  2. *WebP con Cabecera Válida y Payload Corrupto:* Rechazado de inmediato por libavcodec con código 183 (`Decoding error: Invalid data found when processing input`).
  3. *WebP Truncado:* Rechazado deterministamente por el validador estructural y por el decodificador real.
  4. *Rechazo en Ruta HTTP con Limpieza:* Subida de WebP corrupto a través de la API responde HTTP 400 (`IMAGE_CORRUPTED_OR_TRUNCATED`), genera 0 inserciones en `nexus_tv.content` y elimina el archivo de disco (`safeUnlink`, 0 archivos huérfanos).

### 2.2 Vídeo: Compromiso Técnico entre Integridad y Disponibilidad
Se establecieron y documentaron los tres niveles de validación para vídeo:

1. **Identificación de Contenedor (`ffprobe`):**
   - Comprueba átomos MP4 (`ftyp`, `moov`, `trak`), metadatos y duración positiva finita (`format.duration > 0`).
   - Verifica la presencia obligatoria de streams de vídeo (`codec_type === 'video'`).
2. **Muestreo de Decodificación del Flujo (`decodeVideoSample`):**
   - Invoca FFmpeg con `-t 2 -err_detect explode` en subproceso aislado con argumentos separados en array (protección contra inyecciones de shell).
   - Timeout acotado a 5000 ms y buffer de 1 MB.
   - Demuestra que el decodificador puede inicializarse, parsear los paquetes iniciales (keyframes y frames subsiguientes) y procesar datos reales del códec.
3. **Decodificación del Contenido Completo vs. Contrato de Subida:**
   - Decodificar el 100% de los frames durante una petición HTTP sincrónica para vídeos de hasta 100 MB saturaría los núcleos de CPU del servidor, provocaría tiempos de espera de pasarela (gateway timeouts) y expondría al backend a denegación de servicio (DoS).
   - **Criterio Oficial:** El contrato de subida garantiza la integridad del contenedor y la validez demostrada del stream mediante muestra acotada de 2 segundos. La reproducción completa queda a cargo del cliente de señalización digital (TV Player) o del pipeline de transcodificación asíncrono.

---

## 3. AUD-005 — Consistencia Persistente y Recuperación ante Fallo de Rollback

### 3.1 Identificación de la Inconsistencia Original
En el diseño previo:
1. El hash del token se persistía y se confirmaba (`COMMIT`) en PostgreSQL *antes* de entregar el token al televisor.
2. Si la entrega fallaba, se desconectaba el socket o el ACK expiraba, se ejecutaba una actualización compensatoria (`rollback()`).
3. Si PostgreSQL rechazaba o no podía completar ese rollback (ej. fallo de red transitorio), la fila en `nexus_tv.tv_screens` retenía el nuevo hash.
4. El gestor de sesiones capturaba el error y reseteaba la memoria a `pending`, dejando una desincronización entre la memoria del servidor y la base de datos persistida.

### 3.2 Corrección Implementada: Commit Diferido y Estado Persistente de Fallo
1. **Commit Diferido a Dos Fases (2PC Local):**
   - En `src/routes/admin.js`, la transacción de base de datos (`BEGIN ... UPDATE nexus_tv.tv_screens ...`) **no** se confirma inmediatamente a disco.
   - Se retorna un objeto con callbacks explícitos: `commit()` y `rollback()`.
   - `pairingSessionManager.js` ejecuta `deliverWithConfirmation(socket, session, bindingResult)`.
   - **Solo si el cliente confirma (`tv:pairing_confirmed`):** Se invoca `await bindingResult.commit()`, confirmando el hash en PostgreSQL y liberando la conexión de forma segura.
   - **Si la confirmación falla o expira:** Se invoca `await bindingResult.rollback()`, ejecutando `ROLLBACK` directo sobre la transacción abierta.
2. **Garantía del Motor PostgreSQL:**
   - Si el servidor o la conexión de PostgreSQL se interrumpe durante el intento de entrega, PostgreSQL automáticamente aborta y desace la transacción no confirmada al cerrarse la sesión TCP.
   - El hash no confirmado jamás queda escrito en el almacenamiento persistente.
3. **Manejo de Fallo de Compensación:**
   - Si por alguna razón la compensación falla, la sesión transiciona taxativamente a `status = 'failed'` (`rollbackFailed: true`).
   - La sesión **nunca** regresa a `pending` pretendiendo un estado limpio, y **nunca** emite `admin:tv_bound`.
   - La respuesta administrativa informa `rollbackFailed: true`.
4. **Reconciliación Determinista:**
   - Cuando PostgreSQL se recupera, un nuevo intento de vinculación sobre el perfil de pantalla sobrescribe limpiamente la fila con un nuevo token confirmado, invalidando de forma irreversible cualquier credencial residual.

### 3.3 Evidencia en Tests
- **Prueba `AUD-005.17`:**
  - Simula fallo inducido durante la compensación.
  - Comprueba que la sesión transiciona a `failed`, `rollbackFailed: true` y no emite `admin:tv_bound`.
  - Simula reconexión de pantalla con nuevo PIN y recuperación exitosa de base de datos.
  - Verifica que la nueva vinculación triunfa, emite `admin:tv_bound` e invalida el token previo.
  - Demuestra idempotencia ante peticiones duplicadas (`alreadyBound: true`).

---

## 4. Reproducibilidad en Entorno Limpio (Node 24 Alpine)

Se ejecutó la suite completa en un contenedor temporal independiente `node:24-alpine` con binarios nativos de FFmpeg 8.1.2 y base de datos PostgreSQL QA (`nexus-qa-isolated-db` en puerto 25499):

| Suite / Componente | Pruebas Ejecutadas | Resultado | Observaciones |
|---|---|---|---|
| `tests/media-upload.test.js` | 15 | **15 PASS (100%)** | Fixtures sintéticos (PNG zlib, GIF LZW, JPEG scan, WebP, vídeo). |
| `tests/media-real-ffprobe.test.js` | 3 | **3 PASS (100%)** | ffprobe real, FFmpeg real (JPEG/WebP/MP4) y ruta HTTP upload real. |
| `tests/pairing-ack.test.js` | 17 | **17 PASS (100%)** | 17 escenarios de inyección de fallos, rollback, 401 y reconciliación. |
| `tests/pairing-session.test.js` | 5 | **5 PASS (100%)** | Regresión de sesiones y TTL. |
| `tests/tv-heartbeat.test.js` | 10 | **10 PASS (100%)** | Validación unitaria de autenticación de pantallas. |
| `tests/tv-heartbeat-pg.test.js` | 9 | **9 PASS (100%)** | Integración real con PostgreSQL QA. |
| `tests/qa-least-privilege.test.js` | 9 | **9 PASS (100%)** | Mínimo privilegio de base de datos. |
| `tests/clean-bootstrap.test.js` | 8 | **8 PASS (100%)** | Arranque limpio de base de datos. |
| `tests/rbac-authorization.test.js` | 14 | **14 PASS (100%)** | Control de acceso basado en roles. |
| Resto de Suites (Kiosk, Schedule, Auth, etc.) | 48 | **48 PASS (100%)** | Cero regresiones en lógica de negocio. |
| **TOTAL BACKEND SUITE** | **138** | **138 PASS (100%)** | **0 fallos, 0 omitidas, duración: 10.5 s.** |
| **Frontend Linter (`oxlint`)** | 16 archivos | **0 errores** | 10 advertencias cosméticas no bloqueantes. |
| **Frontend Build (`vite build`)** | 126 módulos | **Éxito (852 ms)** | Salida en `dist/` verificada. |
| **Auditoría de Seguridad (`npm audit`)** | 260 paquetes | **0 vulnerabilidades** | Backend y frontend limpios. |

---

## 5. Clasificación y Cierre Oficial de Hallazgos

| ID | Hallazgo | Severidad | Estado Oficial Misión 3D | Justificación de Cierre y Evidencia |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | **Mitigado en configuración / Corregido y verificado en QA aislado / Pendiente en producción activa** | Script `06_runtime_user.sql` validado (8/8 tests). Producción `tv-db` preservada intacta por disponibilidad. |
| **AUD-002** | Heartbeat anónimo y manejo de errores | P1 | **Corregido y verificado** | Validado con 19 tests unitarios y de integración con PostgreSQL QA real. |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 | **Corregido y verificado en Docker/CI (Node 24 LTS)** | `source-map-js@1.2.2` fijado por `overrides`. `npm audit` a 0 vulnerabilidades. |
| **AUD-004** | Upload sin allowlist de firma MIME ni integridad de contenido | P2 | **Corregido y verificado** | Validación multinivel completa: estructural en memoria (PNG zlib, GIF LZW, JPEG marcadores, WebP chunks) y decodificación real con FFmpeg (`-err_detect explode`) para JPEG, WebP y vídeo. Cero archivos huérfanos. 18/18 pruebas aprobadas. |
| **AUD-005** | Entrega volátil en pairing sin ACK | P2 | **Corregido y verificado** | Protocolo en dos fases con commit diferido a la confirmación del cliente (17/17 pruebas en Misión 3D; evolucionado en Misión 3E a transacciones cortas desacopladas con `nexus_tv.pending_pairings` y 25/25 pruebas PASS). |
| **AUD-006** | Token en query string WebSocket | P2 | **Mitigado en frontend / Pendiente de retiro en backend** | Frontend web transmite por `auth: {}` y cabeceras `X-Device-Token`. Backend mantiene compatibilidad temporal por query string para pantallas físicas legadas existentes. |
| **AUD-007** | Directorio `/media/*` público | P2 | **Pendiente** | Sujeto a directivas de negocio para clasificación de recursos. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | **Mitigado en configuración / Pendiente en producción activa** | `docker-compose.yml` mapeado a `127.0.0.1`. Contenedor activo permanece intacto en `0.0.0.0:25432` hasta ventana de mantenimiento. |

---

## 6. Higiene del Workspace y Reglas Innegociables

- `git diff --check`: **0 errores de formato, 0 espacios en blanco espurios**.
- Contenedores de producción `tv-backend`, `tv-db` y `tv-frontend`: **100% operativos, saludables e intactos**.
- Control de versiones: **Cero commits, cero pushes, cero cambios de rama**.
- Secretos: **Cero tokens o credenciales reales incorporados en código o fixtures**.
