# INFORME DE VERIFICACIÓN REAL — MISIÓN 3B (AUD-004 Y AUD-005)

**Fecha:** 2026-10-10  
**Proyecto:** Nexus TV Enterprise (`tv_gsi`)  
**Responsable:** Senior Software, Security & QA Engineer  
**Alcance:** Validación empírica, no destructiva y reproducible de la remediación de AUD-004 y AUD-005.

---

## 1. Resumen Ejecutivo y Clasificación Oficial

| ID | Hallazgo | Severidad | Estado Misión 3B | Evidencia Clave |
|---|---|---|---|---|
| **AUD-004** | Validación multimedia (MIME, firmas, contenido e integridad física) | P2 | **Corregido y verificado** | Validación estructural profunda más allá de magic bytes para PNG (IHDR/IDAT zlib/IEND), JPEG (SOI/SOF0..2/SOS/EOI), GIF (bloques/trailer 0x3B) y WebP (RIFF/VP8 chunks). Detección efectiva de archivos truncados o corruptos. Integración real con binario `/usr/bin/ffprobe` verificada dentro de imagen de producción (`node:24-alpine` con ffmpeg). Límite de ejecución acotado (`timeoutMs: 5000`), validación de flujos de vídeo (`streams.some(s => s.codec_type === 'video')`) y recolección garantizada de archivos temporales (*safeUnlink*). 12/12 tests de upload aprobados y prueba de integración del ejecutable real aprobada. |
| **AUD-005** | Entrega y consistencia de credenciales de pairing tras ACK | P2 | **Corregido y verificado** | Protocolo en 6 pasos con confirmación dual durable (Socket.IO callback ACK + evento `tv:pairing_confirmed`). Aislamiento por socket/sesión (rechazo de ACKs de sockets ajenos o sesiones vencidas). Compensación transaccional robustecida (`rollback()` protegido ante errores de PostgreSQL). Auto-sanación y desalojo de token en frontend (`TVPlayer.jsx`) ante HTTP 401 o fallo de autenticación de socket para retorno inmediato a pantalla de PIN (`#XXXX`). 14/14 tests de entrega y tolerancia a fallos aprobados. |
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | **Mitigado en configuración / Corregido y verificado en QA aislado / Pendiente de intervención operativa en el entorno activo** | Arquitectura y script de migración `06_runtime_user.sql` validados con 8/8 pruebas en `nexus-qa-clean-bootstrap-val`. La base activa `tv-db` no fue alterada para salvaguardar la disponibilidad del entorno de producción. |
| **AUD-002** | Heartbeat anónimo y manejo de errores | P1 | **Corregido y verificado** | Validado con 19 tests unitarios y de integración con PostgreSQL real. |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 | **Corregido y verificado en Docker/CI (Node 24 LTS)** | `source-map-js@1.2.2` fijado; `npm audit` a 0 vulnerabilidades en backend y frontend. Compilación y lint limpios. |
| **AUD-006** | Token en query string WebSocket | P2 | **Mitigado en frontend / Pendiente de retiro en backend** | Clientes web usan `auth: {}` y cabeceras. El backend conserva retrocompatibilidad temporal con pantallas físicas. |
| **AUD-007** | Directorio `/media/*` público | P2 | **Pendiente** | Sujeto a definición de clasificación de información de negocio. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | **Mitigado en configuración / Pendiente de intervención operativa en el entorno activo** | Enlace `127.0.0.1` configurado en `docker-compose.yml`. Contenedor activo no recreado en esta sesión para proteger el servicio. |

---

## 2. AUD-004 — Verificación Real de Validación Multimedia

### 2.1 Verificación del Entorno Efectivo de `ffprobe`
1. **Presencia en Runtime:**
   - [Dockerfile](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/Dockerfile) instala explícitamente `ffmpeg` (`RUN apk add --no-cache ffmpeg su-exec netcat-openbsd ...`) en la imagen base `node:24-alpine`.
   - Se verificó que `/usr/bin/ffprobe` está presente, es ejecutable por el usuario sin privilegios `app`, y responde a la invocación con `-version`.
2. **Entorno Host vs. Contenedor:**
   - En el host Windows de desarrollo, `ffprobe` no se encuentra en el `PATH`.
   - Las pruebas se desacoplaron rigurosamente:
     - `tests/media-upload.test.js`: prueba la lógica de endpoints, validadores estructurales en memoria, límites de tamaño, limpieza de archivos huérfanos y casos de error con inyección controlada (`ffprobeFn`).
     - `tests/media-real-ffprobe.test.js`: prueba el binario real `/usr/bin/ffprobe` contra un contenedor MP4 H.264 real y contra un contenedor truncado/corrupto. En el host se omite limpiamente si el binario no está instalado (`test.skip`), mientras que en el contenedor Docker oficial de Node 24 se ejecuta y aprueba al 100%.
3. **Control de Recursos y Límites:**
   - `probeVideoDuration` ejecuta `execFile` con límite de tiempo `timeoutMs: 5000` (configurable), `maxBuffer: 1MB` y mata el proceso inmediatamente (`SIGKILL`) si expira.
   - Si `ffprobe` no existe, termina con error, supera el timeout o no detecta una duración positiva con al menos un stream de vídeo (`s.codec_type === 'video'`), el upload es rechazado con HTTP 400 (`VIDEO_PROBE_FAILED` / `VIDEO_PROBE_TIMEOUT`) y el archivo temporal es eliminado inmediatamente del disco mediante `safeUnlink`.

### 2.2 Validación de Contenido Completo vs. Magic Bytes
Se implementaron analizadores estructurales puros en [src/utils/mediaValidator.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/utils/mediaValidator.js) sin dependencias externas adicionales:
- **PNG:** Verifica firma de 8 bytes, decodifica el chunk `IHDR` validando dimensiones válidas (`width > 0, height > 0`), descomprime el stream zlib de los chunks `IDAT` para comprobar integridad del raster y exige la presencia del chunk terminador `IEND` con validación de CRC32. Un archivo truncado tras los primeros 30 bytes falla la descompresión zlib (`PNG_ZLIB_TRUNCATED`).
- **JPEG:** Verifica `SOI` (`0xFFD8`), recorre la secuencia de marcadores validando la longitud declarada de cada segmento, extrae dimensiones de `SOF0`/`SOF1`/`SOF2`, localiza el inicio de escaneo `SOS` (`0xFFDA`) y comprueba el marcador final `EOI` (`0xFFD9`). Un JPEG truncado antes de `EOI` o con segmentos rotos es rechazado como `JPEG_TRUNCATED_OR_INVALID`.
- **GIF:** Valida cabecera `GIF87a`/`GIF89a`, dimensiones en el descriptor de pantalla lógica, recorre bloques de extensión y descriptores de imagen con sub-bloques de tamaño variable, y exige el byte terminador `0x3B`. Archivos cortados en medio de un sub-bloque son rechazados (`GIF_TRUNCATED`).
- **WebP:** Valida contenedor `RIFF` y FourCC `WEBP`, decodifica chunks `VP8` (frame key, dimensiones), `VP8L` (firma sin pérdidas 0x2F, dimensiones) o `VP8X` (canvas extendido). Archivos incompletos son rechazados (`WEBP_TRUNCATED_OR_INVALID`).
- **Vídeo (MP4/WebM/MOV/MKV):** Además de validar la caja `ftyp`/EBML, se verifica con `probeVideoDuration` que el contenedor sea procesable y contenga al menos un stream de vídeo decodificable con duración válida. Archivos MP4 truncados provocan fallo de parsing y rechazo inmediato.

### 2.3 Pruebas con Fixtures Reales
En [tests/media-upload.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/media-upload.test.js):
- Imagen PNG sintética válida decodificable (1x1 transparente) -> **PASS**
- Imagen JPEG sintética válida decodificable (2x2 píxeles) -> **PASS**
- Imagen GIF sintética válida decodificable (1x1 GIF89a) -> **PASS**
- Imagen WebP sintética válida decodificable (1x1 sin pérdidas) -> **PASS**
- PNG truncado (firma válida pero sin IDAT/IEND) -> **Rechazado HTTP 400** (`INVALID_IMAGE_STRUCTURE`)
- JPEG truncado (firma SOI válida pero cortado antes de EOI) -> **Rechazado HTTP 400** (`INVALID_IMAGE_STRUCTURE`)
- Vídeo MP4 sintético válido con stream de vídeo H.264 -> **Aceptado HTTP 201**
- Vídeo MP4 truncado -> **Rechazado HTTP 400** (`VIDEO_PROBE_FAILED`)
- MIME/Extensión/Contenido en desacuerdo (ej. `malicious.png` con contenido PE Windows) -> **Rechazado HTTP 400** (`DANGEROUS_FILE_SIGNATURE`)
- Timeout inyectado de procesamiento de vídeo -> **Rechazado HTTP 400** (`VIDEO_PROBE_TIMEOUT`) y archivo borrado.
- Fallo de inserción en PostgreSQL simulado -> **Rechazado HTTP 500** y archivo borrado de disco (cero huérfanos).

---

## 3. AUD-005 — Verificación Real de Pairing y Consistencia de Estado

### 3.1 Flujo y Ordenamiento de Pasos
El flujo implementado garantiza consistencia transaccional mediante compensación controlada:

1. **Paso 1:** El servidor recibe `admin:pair_screen` con `pairingSessionId` y `screenId`.
2. **Paso 2:** El servidor genera el token criptográfico (`crypto.randomBytes(32).toString('hex')`) y calcula su hash SHA-256.
3. **Paso 3:** El servidor guarda preventivamente el hash en PostgreSQL dentro de una transacción con callback de compensación (`rollback()`) si la entrega física falla.
4. **Paso 4:** El servidor emite la credencial al socket de la TV vía `command:assign_profile` utilizando Socket.IO ACK con timeout estricto (3000 ms) y 1 reintento.
5. **Paso 5:** El cliente TV (`TVPlayer.jsx`) recibe el token, lo persiste en `localStorage`, y emite el callback ACK afirmativo más el evento `tv:pairing_confirmed`. Si `localStorage` falla, emite `tv:pairing_rejected`.
6. **Paso 6:** El servidor recibe la confirmación vinculada estrictamente al socket del dispositivo y a la sesión actual, consolida la sesión en memoria como `bound`, y notifica a la consola administrativa vía `admin:tv_bound`.

### 3.2 Inyección de Fallos y Tolerancia a Errores
Se añadieron 14 pruebas deterministas en [tests/pairing-ack.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/pairing-ack.test.js):
- **Error de PostgreSQL tras persistir token:** Si la base falla durante la confirmación final, la sesión no se declara `bound` y el rollback compensatorio elimina el hash.
- **Error de PostgreSQL antes de la entrega:** Si falla la escritura inicial del hash, no se emite el token al cliente.
- **Desconexión antes de recibir el token:** El intento de entrega detecta el socket desconectado, ejecuta rollback en DB y revierte la sesión a `pending`.
- **Desconexión tras recibir el token pero antes del ACK:** El servidor agota el timeout de espera del ACK, ejecuta rollback en DB y cancela la vinculación.
- **Rechazo por fallo de almacenamiento local:** `TVPlayer.jsx` emite `tv:pairing_rejected`; el servidor ejecuta rollback en DB y la sesión no se completa.
- **ACK tardío / Timeout:** La confirmación recibida después de haber expirado el timeout es ignorada; no se emite `admin:tv_bound`.
- **Confirmación cruzada de socket ajeno:** Un socket malicioso que intenta enviar `tv:pairing_confirmed` conociendo el `pairingSessionId` es rechazado de inmediato (`Socket does not match waiting TV socket`).
- **Fallo en compensación/rollback:** Se protegió `pairingSessionManager.js` con bloque `try/catch` alrededor de `bindingResult.rollback()`; si la base de datos se cae durante el rollback, el gestor de sesiones no lanza excepción no controlada, resetea el estado fuera de `binding` y reporta el error original de forma limpia.

### 3.3 Recuperación Coherente (Self-Healing de Pantalla)
En [frontend/src/components/TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx):
- Si una pantalla almacena un token en `localStorage` pero en PostgreSQL el hash fue revertido o no existe (ej. tras un corte de red durante el handshake o restauración de respaldo):
  1. En `verifyScreen` (HTTP `POST /api/tv/heartbeat`), el backend responde `401 Unauthorized`.
  2. El frontend captura el error 401, elimina automáticamente el token corrupto/huérfano de `localStorage` (`localStorage.removeItem('nexus_device_token')`) y transiciona limpiamente al modo de espera con generación de un nuevo PIN (`#XXXX`).
  3. En la conexión Socket.IO `/control`, si el servidor rechaza el handshake por credencial inválida (`Authentication error`), el cliente TV purga el token almacenado y se reinicializa en modo PIN.

---

## 4. Reproducibilidad de Comprobaciones

Se realizaron todas las validaciones sin utilizar cadenas permisivas (`|| true`) ni omitir fallos, utilizando entornos limpios con Node 24 LTS y archivos de bloqueo oficiales.

### 4.1 Resultados de Verificación
1. **Instalación Limpia de Dependencias (`npm ci`):**
   - Ejecutada en contenedor limpio con `node:24-alpine` sin reutilizar dependencias del host: completada en 8.1s con 0 errores.
2. **Auditoría de Seguridad (`npm audit`):**
   - Backend: 0 vulnerabilidades.
   - Frontend: 0 vulnerabilidades.
3. **Suite Completa de Pruebas Backend (`npm test`):**
   - Ejecutada en contenedor aislado con Node 24 LTS, PostgreSQL QA real (`nexus-qa-isolated-db`) y `/usr/bin/ffprobe`:
   - **130 pruebas ejecutadas, 130 aprobadas (100%), 0 fallidas.**
4. **Linting Frontend:**
   - Ejecutado con `oxlint`: **0 errores, 0 advertencias**.
5. **Compilación Frontend:**
   - Ejecutada con `vite build`: completada con éxito en 907ms generando 126 módulos limpios.
6. **Higiene de Formato Git:**
   - `git diff --check` ejecutado sobre el árbol de trabajo: **0 errores de formato, 0 espacios en blanco espurios**.
7. **Estado de Contenedores y Datos:**
   - Contenedores de producción `tv-backend`, `tv-db` y `tv-frontend` preservados 100% operativos e intactos.
   - Cero commits, cero pushes, cero ramas modificadas.

---

## 5. Addendum MISIÓN 3C — Validación Definitiva de Contenido y Máquina de Estados (2026-10-10)

### 5.1 Diferenciación Estructural vs. Decodificación Real (AUD-004)
- **Análisis Estructural Puro:** Inspecciona magic bytes, headers de contenedor (IHDR, chunks WebP, marcadores JPEG SOS/SOF, subbloques GIF).
- **Decodificación de Contenido:** 
  - PNG: Descompresión zlib del stream IDAT y cálculo de bytes de scanlines con filtros PNG.
  - GIF: Descompresión real de stream LZW con diccionario dinámico (`validateGifLzw`).
  - JPEG & Vídeo: Decodificación de flujo real mediante proceso aislado FFmpeg (`decodeMediaContent` / `decodeVideoSample`) con argumentos independientes (`['-v', 'error', '-err_detect', 'explode', '-xerror', '-i', filePath, ...]`), límite de 5000 ms y 1 MB de buffer.
- Archivos corruptos o truncados son rechazados de forma determinista y limpiados del disco sin dejar archivos huérfanos ni registros en base de datos.

### 5.2 Máquina de Estados de Pairing y Consistencia Eventual (AUD-005)
- Se rectificó la denominación: el protocolo **no constituye una transacción atómica** (abarca PostgreSQL, WebSocket y localStorage del navegador), sino un flujo de **confirmación en 7 pasos con compensación y auto-sanación/recuperación**:
  1. Solicitud de vinculación (`POST /api/admin/tvs/bind-session`).
  2. Generación de credencial aleatoria segura (`crypto.randomBytes(32)`).
  3. Persistencia de hash en PostgreSQL dentro de transacción DB con rollback.
  4. Entrega de credencial vía socket autenticado de la pantalla.
  5. Almacenamiento local en `localStorage` del cliente TV.
  6. Confirmación explícita del cliente (`tv:pairing_confirmed`).
  7. Confirmación definitiva del servidor y emisión de `admin:tv_bound`.
- Casos de caída del servidor o fallo de rollback: si el rollback no puede ejecutarse por desconexión de PostgreSQL, la pantalla conserva el token local; sin embargo, en el siguiente heartbeat HTTP o reconexión de socket, el servidor responderá `401 Unauthorized` (o fallo de auth), lo que desencadena la purga automática del token huérfano en `localStorage` y regresa la pantalla a modo PIN.
- Casos no recuperables automáticamente: partición permanente de red durante la sesión de pairing que impida todo contacto entre cliente y servidor. En este caso, la sesión expira a los 5 minutos y se resetea.

### 5.3 Resultados de Reproducibilidad en Entorno Limpio (Node 24 Alpine)
- 136 pruebas ejecutadas en suite backend, **136 aprobadas (100%), 0 fallidas, 0 omitidas**.
- Pruebas reales de `ffprobe` y `ffmpeg` ejecutadas con decodificación real aprobadas.
- Frontend: `oxlint` 0 errores, `vite build` completado, `npm audit` 0 vulnerabilidades.

---

## 6. Addendum MISIÓN 3D — Verificación WebP, Muestreo de Vídeo y Reconciliación Persistente (2026-10-10)

- **AUD-004:** WebP verificado con decodificador real FFmpeg (`-err_detect explode`); límites de vídeo fijados deliberadamente en 2 segundos de stream para mitigar riesgo de DoS por CPU en subidas sincrónicas.
- **AUD-005:** Two-phase commit local en pairing (commit diferido a confirmación de cliente), garantizando que fallos de compensación o interrupciones de PostgreSQL aborten automáticamente transacciones pendientes sin ensuciar la base de datos persistida.
- **Reproducibilidad:** Suite backend ampliada a **138 pruebas, 138 aprobadas (100%), 0 fallidas, 0 omitidas** en contenedor limpio Node 24 Alpine.


