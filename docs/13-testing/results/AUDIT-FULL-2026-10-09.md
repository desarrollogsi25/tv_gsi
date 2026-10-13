# Auditoría técnica integral — Nexus TV Enterprise v2.2.0

**Fecha:** 2026-10-09  
**Alcance:** auditoría estática del repositorio, pruebas automatizadas existentes y observaciones de solo lectura del entorno Docker local.  
**Dictamen:** auditoría parcial con riesgos confirmados. No constituye certificación ni aprobación de producción.

## 1. Resumen ejecutivo

El tag anotado `v2.2.0` apunta al commit `43e8590a19388bb23f738b604c33d352b36e6aeb`; `HEAD`, `main` y `origin/main` están en ese mismo commit. El árbol tenía al inicio un cambio local preexistente en `docs/13-testing/results/TC-SECURITY-WS-001.md`; se conservó sin modificaciones. Los servicios activos responden y están healthy, pero el runtime usa el volumen PostgreSQL real y **no se ejecutaron pruebas de escritura ni migraciones sobre él**.

Hallazgos principales confirmados por inspección:

1. **P1 — Privilegios excesivos en PostgreSQL.** La migración inicial crea seis roles `SUPERUSER`; la instancia activa confirma que seis roles conservan ese atributo y que `tv`, usuario actual de la sesión consultada y usuario configurado para la aplicación por defecto, es superusuario. Esto excede los privilegios requeridos por la aplicación.
2. **P1 — Heartbeat actualiza actividad sin autenticación en un caso válido.** `POST /api/tv/heartbeat` actualiza `last_login` cuando la pantalla está activa y `device_token_hash` es nulo, aunque no se haya presentado credencial. También responde siempre `success: true` aunque omita el update por error.
3. **P1 — Riesgo alto de dependencia frontend.** `npm audit` reportó `source-map-js` con advisory de severidad alta (GHSA-68fv-2mgg-jv7q), transitiva del frontend; no se aplicaron actualizaciones.
4. **P2 — Carga de multimedia sin validación de tipo/contenido.** Multer limita tamaño a 500 MB, pero no define `fileFilter` ni verifica firma. Un archivo no imagen pasa a la rama video y puede registrarse incluso si `ffprobe` falla.
5. **P2 — Vinculación depende de emisión volátil sin confirmación.** El servidor emite token vía `socket.volatile.emit` y marca la sesión como vinculada sin ACK del cliente. Una pérdida de paquete puede dejar credencial persistida en servidor y no almacenada por la TV; la prueba actual no demuestra recuperación tras pérdida de respuesta.

La ejecución realizada pasó 63/63 pruebas backend. Build frontend finalizado con aviso de versión mínima de Node y el linter devolvió advertencias. Las pruebas de backend son principalmente unitarias/integración con dependencias sustituidas; no equivalen a cobertura de todos los contratos HTTP contra PostgreSQL. El build frontend no prueba las vistas en navegador. La revisión de la matriz de rutas se hizo estáticamente; no todos los endpoints se invocaron.

## 2. Identidad y evidencia de versión

| Elemento | Evidencia |
|---|---|
| Raíz | `C:\Users\DEVELOPMENT\Downloads\tv_gsi`; `git rev-parse --show-toplevel` devuelve `/repo` en el entorno de ejecución montado. La raíz contiene el repositorio esperado `desarrollogsi25/tv_gsi` (remote `origin`). |
| Rama / HEAD | `main` / `43e8590a19388bb23f738b604c33d352b36e6aeb`. |
| Tag | Objeto anotado `b702edf457cbc17e604ccf80b8ebe79e3e502619`, que apunta al commit `43e8590a19388bb23f738b604c33d352b36e6aeb`. |
| Remoto | `origin/main` apunta al mismo commit; `origin` tag `v2.2.0` apunta al objeto anterior. No hay divergencia de commits. |
| Estado inicial | ` M docs/13-testing/results/TC-SECURITY-WS-001.md` (cambio local preexistente, preservado). |
| Runtime | Node v20.18.0, npm 10.8.2, Docker 29.8.2, Compose v5.5.1; PostgreSQL 17.11 en servicio `db`. |
| Contenedores | `db`, `backend` y `frontend` estaban `healthy`. HTTP `localhost:23002/api/status` y `localhost:28080/tv`: 200. |
| Puertos | API 23002, PostgreSQL 25432 y frontend 28080 publicados en todas las interfaces (`0.0.0.0`/IPv6). PostgreSQL queda accesible desde la LAN salvo firewall externo. |
| Volúmenes/montajes | PostgreSQL usa el volumen persistente `tv_pgdata`; backend monta el directorio local `media` en `/app/media`. No se retiró ni modificó volumen. |

Se calcularon SHA-256 de `nx_tv.js`, `src/routes/tv.js`, `src/routes/admin.js`, `src/routes/media.js` y `src/sockets/index.js` en host y backend. `nx_tv.js`, `admin.js`, `media.js` y sockets coinciden; `tv.js` **no coincide a nivel de bytes**. La comparación de líneas normalizadas no mostró diferencias y la copia activa contiene las comprobaciones de token del endpoint playlist. Se clasifica como deriva de artefacto/serialización no explicada, no como diferencia funcional confirmada. El SHA de `frontend/nginx.conf` coincide con `/etc/nginx/conf.d/default.conf`; el bundle activo se identificó, pero no se pudo mapear cada componente fuente a código desplegado sin sourcemaps. No se reconstruyeron imágenes durante esta auditoría.

## 3. Pruebas ejecutadas en esta auditoría

| Prueba/comando | Entorno y resultado |
|---|---|
| `npm test` | Backend local, `NODE_ENV=test`: **63 passed, 0 failed** (1.47 s). Incluye autenticación, device auth, pairing, playlist auth, RBAC y semántica de horario JavaScript. No demuestra SQL real para ventanas horarias. |
| `npm run build` | `frontend/`: terminó correctamente; Vite advierte Node 20.18.0, requiere 20.19+ o 22.12+. |
| `npm run lint` | `frontend/`: terminó sin error de proceso, con advertencias de hooks/dependencias, Fast Refresh y variable no usada. |
| `npm audit --json` | Backend: 0 vulnerabilidades notificadas. Frontend: 1 alta (`source-map-js`, dependencia transitiva); no se modificó lockfile. |
| `docker compose ps`, configuración, healthchecks y endpoint status | Solo lectura. 3 servicios saludables; status 200. La configuración resuelta confirma puertos y volumen documentados arriba; valores de entorno se excluyeron de la salida. |
| Consulta PostgreSQL de roles y `server_version` | Solo lectura dentro de `db`; obtuvo atributos de roles y `current_user=tv`; no consultó datos de usuarios. Seis roles con `rolsuper=true`. |
| Hash de archivos host/contenedor | Solo lectura. Detectada diferencia de bytes de `src/routes/tv.js`; los demás archivos comparados coinciden. |
| Inspección de `scripts/e2e_full_audit.cjs` | No ejecutado: el script borra/bindea pantallas, envía comandos/broadcasts, sube archivos de hasta 100 MB y crea/elimina playlist, contenido y medios en el servicio configurado. Su limpieza es best-effort y no prueba que el entorno sea desechable. |
| Pruebas visuales y cliente LAN secundario | No ejecutadas: no se dispuso de navegador automatizado ni segundo cliente/máquina LAN en esta ejecución. |
| Migraciones, escritura, pairing vivo | No ejecutados: el único PostgreSQL disponible es el volumen real del proyecto. No se creó una pila aislada desechable. |

Los informes existentes `TC-PAIRING-SESSION-001.md`, `TC-PLAYLIST-AUTH-001.md`, `TC-SECURITY-WS-001.md` y `TC-NETWORK-LAN-001.md` se consultaron como evidencia documental previa, no se adoptaron como pruebas ejecutadas en este turno. El estado editado de `TC-SECURITY-WS-001.md` se dejó intacto.

## 4. Hallazgos priorizados

### AUD-001 — Roles superusuario de aplicación — P1 confirmado

- **Ubicación:** `migrations/01_init_nexus_tv.sql:10-25`; `src/config/db.js:13-21`; usuario de Compose configurado por defecto en `docker-compose.yml`.
- **Evidencia:** el SQL declara seis `CREATE ROLE ... SUPERUSER`; consulta de solo lectura en PostgreSQL activo muestra seis roles con `rolsuper=true`, y `current_user` es `tv`. La aplicación usa `PG_USER` y su valor por defecto es `tv`.
- **Impacto:** una inyección SQL, compromiso del backend o credencial de DB expuesta puede administrar el clúster completo, modificar roles/bases y leer/escribir bases ajenas; el alcance excede `nexus_tv`.
- **Mitigación/corrección recomendada:** planear rol nuevo de aplicación con `CONNECT`, `USAGE` del esquema, DML explícito y secuencias mínimas; crear y validar el login/rotación antes del cambio de configuración; comprobar permisos con rutas y migraciones; revocar atributos elevados y retirar roles obsoletos solo después de inventariar dependencias y preservar acceso administrativo separado. No cambiar roles durante esta auditoría.
- **Aceptación futura:** `rolsuper/rolcreatedb/rolcreaterole=false` para aplicación; pruebas de rutas pasan y operaciones administrativas fuera del esquema fallan; rollback probado sin pérdida de acceso.

### AUD-002 — Heartbeat anónimo actualiza `last_login` si hash es NULL — P1 confirmado por flujo de código

- **Ubicación:** `src/routes/tv.js:205-229`.
- **Reproducción aislada propuesta:** fixture sintético activo con `device_token_hash=NULL`; `POST /api/tv/heartbeat` con su UUID y sin headers/body de credencial; registrar si se ejecuta `UPDATE last_login`. No se hizo contra DB real; la rama condicional confirma estáticamente el comportamiento.
- **Impacto:** telemetría falsificable y pantalla sin credencial marcada como activa/reciente; los fallos de DB también quedan ocultos al cliente con `success: true`.
- **Corrección/aceptación:** exigir credencial válida para cualquier update, devolver 401/403 y fallo real en DB como error; prueba aislada confirma que no cambia timestamp sin token, con token válido sí lo cambia y falla con token cruzado.

### AUD-003 — Dependencia frontend con advisory alto — P1 (alcance de build/desarrollo)

- **Ubicación:** lockfile transitivo `frontend/package-lock.json`; paquete `source-map-js`, rango vulnerable informado por npm `<1.2.2`; advisory GHSA-68fv-2mgg-jv7q.
- **Evidencia:** `npm audit --json` en frontend reportó una vulnerabilidad alta y `fixAvailable=true`. Auditoría no instaló ni actualizó paquetes.
- **Impacto:** el advisory describe denegación de servicio por offsets de source map. La dependencia es transitiva del toolchain frontend; la exposición en runtime de producción no quedó demostrada, por lo que el alcance práctico requiere confirmar el grafo y si está incluido en un servicio accesible.
- **Aceptación futura:** lockfile resuelto a versión no afectada, build reproducible, audit sin este advisory y revisión de SBOM/imagen final.

### AUD-004 — Upload sin allowlist ni verificación de formato — P2 confirmado estáticamente

- **Ubicación:** `src/routes/media.js:16-29,49-95`.
- **Evidencia:** Multer solo impone `fileSize`; la clasificación se realiza por extensión. Extensiones distintas a cinco formatos de imagen se consideran vídeo. `ffprobe` fallido mantiene duración por defecto y no impide el INSERT.
- **Impacto:** archivos arbitrarios/corruptos quedan almacenados y publicados por `/media`; posible XSS/descarga peligrosa según tipo servido y uso del cliente. Si falla INSERT de DB, no se borra el fichero temporal, generando huérfano. No se subieron archivos.
- **Aceptación futura:** allowlist de extensiones y MIME más detección de firma; rechazar contenido no verificable; borrar archivo si transacción/INSERT falla; pruebas de MIME falso, vacío, corrupto, exceso de tamaño y fallo DB en almacenamiento sintético.
- **Estado final:** **Corregido y Verificado.** Verificación real mediante `decodeMediaContent` con FFmpeg (`-err_detect explode -xerror -v error`), rechazo de bitstream WebP/VP8 corrupto y validación de flujo de vídeo acotada a 2 segundos como protección DoS documentada. 18/18 pruebas pasan (100%).

### AUD-005 — Credencial de pairing sin confirmación de entrega — P2 probable (Cerrado)

- **Ubicación:** `src/services/pairingSessionManager.js:200-340`, `src/routes/admin.js:90-235`, `migrations/07_pending_pairings.sql`.
- **Evidencia original:** `socket.volatile.emit('command:assign_profile', ...)`; el flujo mantenía entrega volátil sin confirmación garantizada. En revisiones intermedias se introdujo una transacción de larga duración que retenía `FOR UPDATE` durante la espera del ACK del cliente.
- **Resolución definitiva (Misión 3E):** Se eliminó por completo la transacción de larga duración, reemplazándola por una secuencia de dos transacciones cortas con tabla aditiva de vinculaciones pendientes `nexus_tv.pending_pairings`:
  1. *Transacción 1 (corta):* Registra el hash pendiente en `nexus_tv.pending_pairings` y realiza `COMMIT` inmediato antes de la entrega por Socket.IO, liberando conexiones y bloqueos en <5ms.
  2. *Espera de ACK no bloqueante:* Durante la entrega y espera del ACK, PostgreSQL tiene 0 transacciones abiertas (`idle in transaction = 0`). Las consultas operacionales concurrentes (incluyendo `POST /api/tv/heartbeat` de la misma pantalla) ejecutan inmediatamente en <100ms con HTTP 200 sin bloqueos de fila.
  3. *Transacción 2 (corta):* Tras recibir el ACK explícito (`tv:pairing_confirmed` o callback), se verifica la sesión y expiración, se promueve la credencial a activa en `nexus_tv.tv_screens` y se marca `status = 'promoted'`.
  4. *Notificación segura:* `admin:tv_bound` se emite única y exclusivamente tras confirmarse el `COMMIT` de la Transacción 2.
  5. *Aislamiento y recuperación:* Si el ACK expira o el cliente rechaza, se cancela el registro pendiente sin haber tocado la credencial activa existente en `tv_screens`. La reconciliación tras caídas (`reconcilePendingPairings`) limpia registros pendientes caducados sin degradar credenciales legítimas.
- **Estado final:** **Corregido y Verificado.** 25/25 pruebas pasan en `tests/pairing-ack.test.js` (incluyendo 8 pruebas de concurrencia y persistencia contra PostgreSQL QA aislado en puerto 25499). Suite global: 146/146 pruebas pasan (100%).

### AUD-006 — Token en query string del handshake — P2 (Mitigado en Código / Abierto para Validación de Campo)

- **Ubicación:** `src/sockets/index.js:31-48`, `.env.example:34-38`, `tests/device-auth.test.js:544-686`.
- **Evidencia original:** El middleware de Socket.IO extraía `deviceToken` indiscriminadamente desde `auth.device_token || query.device_token || headers['x-device-token']`. Aunque el cliente React web oficial (`TVPlayer.jsx`) utiliza `auth: { tv_uuid, device_token }`, el fallback en `query.device_token` permitía que credenciales sensibles viajaran en la URL del handshake, exponiéndolas a access logs de Nginx, proxies intermedios, firewalls e historial de navegación.
- **Implementación y Mitigación (Misión 4A):**
  1. *Inventario Exhaustivo:* Confirmado que el reproductor web soportado (`TVPlayer.jsx`) utiliza exclusivamente `auth: { tv_uuid, device_token }`. Las pruebas unitarias y de integración (`device-auth.test.js`, `pairing-ack.test.js`) y scripts de ciclo de vida (`test_pairing_lifecycle.cjs`) utilizan `auth`. No existe evidencia en el código de clientes soportados que dependan de query strings.
  2. *Predeterminado Seguro:* `ALLOW_QUERY_DEVICE_TOKEN=false` por defecto. El servidor rechaza inmediatamente cualquier intento de enviar `device_token` en la query string con el error descriptivo: `TV authentication failed: device_token in query string is rejected. Use handshake auth or x-device-token header`.
  3. *Mecanismos Autorizados:* Se admite autenticación vía `socket.handshake.auth.device_token` y cabecera HTTP `x-device-token`.
  4. *Fallback de Transición Controlado:* Para compatibilidad con pantallas Smart TV físicas o hardware legado no verificable en el repositorio, se implementó la bandera explícita `ALLOW_QUERY_DEVICE_TOKEN=true` (o `opts.allowQueryDeviceToken`). Cuando se habilita, admite el token en query emitiendo una advertencia de obsolescencia que registra únicamente el `tv_uuid` y jamás el token en texto claro.
  5. *Zero Token Leakage:* Verificado que ningún log, advertencia, métrica o mensaje de error incluye tokens completos en texto claro.
  6. *Validación Criptográfica Invariable:* Con o sin fallback de query string, los tokens inválidos, malformados o cruzados (pertenecientes a otra pantalla) continúan siendo estrictamente rechazados.
- **Estado final:** **Mitigado en Código / Abierto para Verificación de Campo.** 25/25 pruebas pasan en `tests/device-auth.test.js` (incluyendo 5 nuevas pruebas unitarias exhaustivas para AUD-006). Se mantiene abierto pendiente de verificar la compatibilidad de los dispositivos físicos desplegados en producción.

### AUD-007 — Recursos de medios públicos — P2 (Pendiente de Decisión de Negocio / Clasificación de Datos)

- **Ubicación:** `frontend/nginx.conf` (`/media/`), Express `nx_tv.js:83-94`, `src/routes/media.js`.
- **Evidencia original:** Nginx proxifica `/media/` directamente a Express sin autenticación, y Express sirve archivos estáticos con `no-store, no-cache`. Quien conozca la URL exacta puede descargar el recurso.
- **Análisis de Arquitectura (Misión 4A):**
  - La metadata de las playlists y el descubrimiento de archivos (`GET /api/tv/playlist`) ya está 100% protegida mediante autenticación estricta `X-Device-Token`. Las APIs administrativas (`GET /api/media`) están protegidas por RBAC JWT.
  - Los nombres de archivo se generan con `crypto.randomUUID()` (128 bits de entropía CSPRNG), impidiendo enumeración, adivinación o path traversal.
  - Se compararon formalmente tres alternativas:
    * **Opción A (Públicos por diseño):** Adecuado si los contenidos son de cartelería pública (anuncios, menús, señalización). Cero sobrecarga, streaming y byte-range nativo en Smart TVs.
    * **Opción B (URLs firmadas temporales con HMAC):** Recomendación técnica si el producto exige confidencialidad. Firma dinámica con TTL en la API (`/media/<uuid>.mp4?token=<hmac>&expires=<ts>`), validación en Nginx/Express, sin alterar el esquema de BD ni saturar la memoria de Smart TVs físicas.
    * **Opción C (Acceso autenticado por dispositivo vía Headers/Blob o Cookies):** Desaconsejada técnicamente; `fetch() -> blob` causa desbordamiento de memoria (OOM) en reproductores Smart TV con baja RAM al reproducir vídeos HD/4K de hasta 500MB, e inhabilita peticiones de rango HTTP.
  - La política efectiva de `/media/*` se mantiene intacta en el código para no romper la reproducción operativa de pantallas en producción.
- **Estado final:** **Pendiente de Decisión de Negocio.** Requiere que la dirección de producto determine si los archivos multimedia son estrictamente públicos por diseño o confidenciales.

### AUD-008 — CORS LAN y exposición de puertos — P2 operacional, requiere retest remoto

- **Ubicación:** `src/config/cors.js`, `docker-compose.yml`, `frontend/src/api.js`.
- **Evidencia:** por defecto solo origins localhost; puertos API/DB/web están publicados en todas las interfaces. El bundle usa configuración de API que debe verificarse con el hostname LAN real.
- **Impacto:** otro equipo LAN puede alcanzar PostgreSQL directamente; clientes web LAN pueden fallar CORS o intentar contactar localhost. No se probó desde segundo dispositivo; firewall y valores `.env` en el host no se validaron.
- **Aceptación futura:** acceso desde cliente de QA de otra máquina; verificar API, Socket.IO, playlist y medios; restringir DB a loopback/red privada necesaria y documentar configuración de origen.

## 5. Matriz estática de endpoints HTTP

Abreviaturas de auth: `Admin`, `Admin/Editor`, `Admin/Editor/Viewer`, `JWT`, `Dispositivo`, `Pública`. La columna “Prueba” indica cobertura relevante observada en el conjunto del repositorio; “unit” no implica prueba SQL real.

| Método y ruta (prefijo) | Handler/archivo | Auth/rol | Validación/efecto principal | Cobertura observada |
|---|---|---|---|---|
| POST `/api/auth/login` | `auth.js` | Pública | username/password; compara bcrypt; firma JWT de 8 h | `auth.test.js`, unit |
| GET `/api/auth/me` | `auth.js` | JWT | verifica token y devuelve claims de usuario | `auth.test.js`, middleware |
| GET `/api/status` | `nx_tv.js` | Pública | estado de servicio | HTTP vivo 200 |
| POST `/api/tv/login` | `tv.js` | Dispositivo | UUID, activo, token body/header; actualiza login | `device-auth.test.js`, unit |
| GET `/api/tv/:tv_uuid/playlist` | `tv.js` | Dispositivo | UUID/token, SQL por horario/día; devuelve contenido | `playlist-auth.test.js` mock; no SQL QA |
| POST `/api/tv/register` | `tv.js` | Pública | UUID/nombre requeridos; inserta pantalla pendiente; sin rate limit visible | No prueba específica identificada |
| POST `/api/tv/heartbeat` | `tv.js` | Parcial (ver AUD-002) | UUID y token opcional según hash; actualiza `last_login` | No prueba específica identificada |
| GET `/api/tv-content` | `media.js` | Admin/Editor/Viewer | lista contenido | RBAC upload/list parcialmente |
| POST `/api/tv-content/upload` | `media.js` | Admin/Editor | multipart `mediaFile`, hasta 500 MB; archivo + INSERT | E2E destructivo inspeccionado, no ejecutado |
| POST `/api/tv-content/external` | `media.js` | Admin/Editor | title/URL; INSERT URL externa | No cobertura específica observada |
| POST `/api/tv-content/delete` | `media.js` | Admin/Editor | content_id o fileUrl; borra DB/archivo en pasos no transaccionales | No cobertura específica observada |
| GET `/api/admin/waiting-screens` | `admin.js` | Admin/Editor/Viewer | lista sesiones pendientes en memoria | pairing unit; no HTTP integral |
| GET `/api/admin/available-profiles` | `admin.js` | Admin/Editor/Viewer | consulta perfiles de pantalla | No cobertura específica observada |
| POST `/api/admin/bind-screen` | `admin.js` | Admin | pairingSessionId + tv_uuid; asigna perfil, token/hash y sesión | pairing-session unit; no entrega confiable |
| POST `/api/admin/waiting-screens/:pairingSessionId/reject` | `admin.js` | Admin | rechaza/cancela sesión | pairing unit parcial |
| GET `/api/admin/screens` | `admin.js` | Admin/Editor/Viewer | inventario y playlist | E2E script inspeccionado, no ejecutado |
| GET `/api/admin/screens/:uuid` | `admin.js` | Admin/Editor/Viewer | detalle por UUID | E2E script inspeccionado |
| PUT `/api/admin/screens/:uuid` | `admin.js` | Admin | actualiza pantalla/asignación, transacción | E2E script inspeccionado |
| POST `/api/admin/screens/:uuid/unlink` | `admin.js` | Admin | revoca token, desactiva y elimina asociación | `device-auth.test.js`/docs previos; no vivo |
| DELETE `/api/admin/screens/:uuid` | `admin.js` | Admin | elimina asociación/pantalla en transacción | RBAC unit; no DB QA |
| POST `/api/admin/screens/:uuid/control` | `admin.js` | Admin | envía comando Socket.IO a UUID | E2E script inspeccionado |
| GET `/api/admin/pending` | `admin.js` | Admin/Editor/Viewer | consulta pantallas pendientes DB | Sin caso identificado |
| POST `/api/admin/approve/:uuid` | `admin.js` | Admin | activa y puede asociar playlist; no provisiona token según handler observado | Sin caso identificado; riesgo de flujo legado |
| GET `/api/admin/playlists` | `admin.js` | Admin/Editor/Viewer | lista playlists | E2E script inspeccionado |
| POST `/api/admin/playlists` | `admin.js` | Admin/Editor | crea playlist | E2E script inspeccionado |
| PUT `/api/admin/playlists/:id` | `admin.js` | Admin/Editor | cambia nombre | E2E script inspeccionado |
| DELETE `/api/admin/playlists/:id` | `admin.js` | Admin/Editor | borra relaciones y playlist en transacción | E2E script inspeccionado |
| GET `/api/admin/playlists/:id` | `admin.js` | Admin/Editor/Viewer | detalle e items | E2E script inspeccionado |
| POST `/api/admin/playlists/:id/items` | `admin.js` | Admin/Editor | agrega contenido/horario | E2E script inspeccionado |
| PUT `/api/admin/playlists/:id/items/order` | `admin.js` | Admin/Editor | actualiza posiciones | E2E script inspeccionado; concurrencia sin prueba |
| DELETE `/api/admin/playlists/:id/items/:contentId` | `admin.js` | Admin/Editor | elimina asociación de contenido | Sin caso identificado |
| POST `/api/admin/temporary-content` | `admin.js` | Admin | broadcast temporal por target; estado en memoria + socket | E2E script inspeccionado, no ejecutado |
| POST `/api/admin/clear-temporary` | `admin.js` | Admin | limpia broadcast | E2E script inspeccionado |
| GET `/api/admin/active-temporary` | `admin.js` | Admin/Editor/Viewer | consulta estado de broadcasts | E2E script inspeccionado |
| POST `/api/admin/temporary-control` | `admin.js` | Admin | control temporal Socket.IO | Sin caso identificado |
| GET `/api/admin/content` | `admin.js` | Admin/Editor/Viewer | listado contenido | Sin caso específico identificado |
| GET `/api/admin/stats` | `admin.js` | Admin/Editor/Viewer | métricas DB | Sin caso específico identificado |

Se detectaron 37 rutas de aplicación (incluido status y dos rutas de auth). Todas tienen parametrización SQL visible en las rutas consultadas; la revisión no certifica ausencia total de SQL dinámica en cada rama. `/media/*` es ruta estática pública, no contabilizada como endpoint API.

## 6. Socket.IO, pairing y frontend

- Namespace `/control`: handshake diferencia TV con credencial, TV en espera por PIN y administrador JWT/rol. Los eventos de administración comprueban `clientType`/rol antes de `admin:send_command`. El socket de espera no obtiene permiso admin.
- La consulta permite `device_token` en query, auth y header. Ver AUD-006.
- Pairing usa `pairingSessionId` UUID, deadline/TTL de cinco minutos, consume una vez y mantiene tombstone; pruebas unitarias existentes cubren colisión PIN, sesión exacta, expiración y doble solicitud. No se comprobó en este turno el ciclo con DB y TV física ni pérdida de paquete/almacenamiento local del token.
- Eventos de heartbeat Socket.IO se aceptan solo para `socket.data.clientType === 'tv'`; la identidad se toma del handshake autenticado. El payload se retransmite al grupo admin con campos de telemetría.
- `admin:send_command` no valida un allowlist del nombre de comando; el frontend emite controles conocidos. No se probó payload de comando arbitrario contra dispositivo real.
- Frontend: `App.jsx`, `api.js`, Login, Admin, TVPlayer, YouTubePlayer, TVList, TVRegister, ContentManager, TVControl, BroadcastPanel, utilidades de playback y socket de pairing fueron localizados y revisados parcialmente por llamadas/flujo. No se ejecutó navegador ni se cubrieron estados visuales a 375/414/768/1280/1920 px.
- `YouTubePlayer.jsx` cachea `apiPromise`; en el `.catch` de carga no se restablece `apiPromise`. Si la carga inicial falla, la promesa rechazada puede seguir bloqueando intentos posteriores mientras dure la página. Hallazgo probable P2; aceptación: simular primer rechazo de script, permitir retry y confirmar creación de `YT.Player`.
- Las rutas de edición multimedia/playlists reflejan endpoints encontrados, pero no se hizo una matriz individual de cada llamada frontend ni recorrido real de 12 flujos solicitados. La matriz HTTP anterior es inventario estático, no prueba de extremo a extremo.

## 7. SQL, datos y secretos

- **Roles:** AUD-001 confirmado. Revisar grants heredados, acceso a otras bases y quién usa roles nominales antes de cualquier revocación. No se imprimieron ni consultaron hashes de passwords de cuentas de aplicación.
- **Datos seed:** la migración inspeccionada contiene definiciones de roles/esquema/grants; no se identificaron `INSERT INTO` en `01_init_nexus_tv.sql`. Esto no descarta datos insertados por otro mecanismo o en historial. No se copiaron nombres/URLs/credenciales de filas.
- **Historial Git:** no se auditó íntegramente el historial ni se ejecutó secret scanner histórico; una rotación actual, si existiera, no demuestra por sí misma que valores previos sean inválidos. La posibilidad de exposición histórica queda sin validar.
- **RSK-030:** se buscó la referencia en los documentos versionados y aparece en el registro de riesgos/reconciliación, pero no existe evidencia independiente en esta sesión de invalidación de todos los valores expuestos. El canal autorizado para leer logs persistidos del IDE no está disponible aquí; no se abrieron ni copiaron logs. Solicitar acceso local por canal autorizado para verificar el estado, sin compartir valores.
- Un escaneo heurístico local encontró coincidencias de patrones sensibles en archivos de configuración, documentación, frontend y tests; el patrón también captura nombres de variables y fixtures. No se divulgaron valores ni se considera esto confirmación de secretos activos. Hace falta revisión contextual/escáner de secretos con salida censurada.

## 8. Documentación, build y operación

- Se revisaron README, arquitectura/ADR, CI, Compose, Dockerfiles, `.env.example`, scripts de arranque, registro de riesgos, incidentes y resultados de pruebas existentes. Se observan varios pares de BUG con ID repetido en el directorio de incidentes (BUG-001 y BUG-002), lo que dificulta referencias inequívocas.
- Scripts de package declaran backend `npm test`; frontend `build` y `lint`. Hay package-lock y pnpm-lock en backend y frontend, sin política explícita para fuente única; `npm audit` solo se ejecutó con npm.
- CORS por defecto solo acepta localhost. La API y Socket.IO están en puertos publicados por Compose; PostgreSQL también se expone al host/LAN. No se comprobó firewall.
- `run-local.ps1` contiene rutas de parada/limpieza y creación de `.env`; no se ejecutó. E2E tiene efectos globales y cleanup best-effort, por lo que no es seguro en la pila actual. La misión prohíbe y no se ejecutó `docker compose down -v`.
- La zona horaria del SQL de playlist usa `LOCALTIME`, `CURRENT_DATE`, por lo que depende de timezone de PostgreSQL. La suite cubre la función JavaScript `schedule-window`, no la query real; quedan sin validar medianoche, DST, arrays NULL/vacíos, orden/concurrencia e índices con PostgreSQL QA.

## 9. Áreas no validadas

1. Pruebas integrales de escritura, migraciones fresh/repeat/upgrade y permisos finos: requieren proyecto Compose y DB sintéticos aislados.
2. Test específico HTTP de heartbeat sin credencial: requiere fixture aislado. El comportamiento se confirmó por rama de código, no por mutación real.
3. Fallo de pairing en commit/emisión/almacenamiento de token y reintento tras respuesta perdida: falta harness browser + DB aislada.
4. Rutas no invocadas y matrices de error (UUID malformado, nulos, payload excesivo, carreras/fallo DB) enumeradas en §5; no se ejecutó fuzzing.
5. Seguridad de URLs externas (esquemas/destinos), SSRF/iframe policy y traversal; no se realizaron requests de ataque ni uploads.
6. Navegadores, responsividad, reproducción en TV física, pruebas YouTube/Power BI; sin browser control en esta sesión.
7. Cliente LAN secundario, firewall real, origins configurados y configuración aplicada fuera de localhost.
8. Hashes/código desplegado de todos los módulos y comparación completa de bundle frontend; solo archivos críticos seleccionados.
9. Rotación RSK-030 y análisis histórico de secretos; logs del IDE fuera de los canales disponibles.
10. Datos de negocio reales y necesidad de medios públicos; no se consultaron contenidos/cuentas.

## 10. Plan de corrección recomendado

1. **P1 / AUD-001:** inventariar conexiones/roles; diseñar nuevo rol mínimo y despliegue sin corte; ensayar en DB QA; rotar credencial de app; aplicar grants explícitos; retirar SUPERUSER de roles de aplicación tras verificación. Requiere dueño DBA.
2. **P1 / AUD-002:** exigir token válido antes de cualquier update de heartbeat y reportar errores correctamente; integrar test HTTP+PostgreSQL aislado.
3. **P1 / AUD-003:** actualizar dependencia transitiva en lockfile, revisar impacto en toolchain y auditar imagen de producción.
4. **P2 / AUD-004:** allowlist + firma MIME/contenido, atomicidad DB/archivo, borrado compensatorio y límites de negocio; pruebas sintéticas.
5. **P2 / AUD-005:** diseñar confirmación durable y recuperación segura/idempotente de token, con pruebas de corte de red.
6. **P2 / AUD-006/007:** decidir contrato de credenciales Socket.IO y clasificación de medios; minimizar query logs y proteger medios si deben ser privados.
7. **P2 / AUD-008:** retest desde otra máquina y restringir publicación de PostgreSQL; validar CORS/Socket.IO/URLs desde host real.
8. Completar la auditoría con base QA desechable, migraciones versionadas, integración SQL de horarios, Playwright/browser en tamaños requeridos y cobertura de endpoints antes de emitir cualquier gate de producción.

## 11. Archivos y estado final de auditoría inicial

- **Creado:** `docs/13-testing/results/AUDIT-FULL-2026-10-09.md` (este informe).
- **Modificados por auditoría:** ninguno.
- **Cambio preexistente preservado:** `docs/13-testing/results/TC-SECURITY-WS-001.md`.
- **Commit/tag, archivos de aplicación, datos y volúmenes:** sin cambios intencionales.
- **`git status --short` al cierre:**
  ```text
   M docs/13-testing/results/TC-SECURITY-WS-001.md
  ?? docs/13-testing/results/AUDIT-FULL-2026-10-09.md
  ```
- **Resumen:** un informe nuevo sin seguimiento; el único archivo modificado es el mismo cambio preexistente que ya estaba al inicio.

---

## 12. Retest, remediación controlada P1 y validación QA aislada (Misión 2 — 2026-10-09)

**Fecha de ejecución:** 2026-10-09  
**Responsable:** Senior Software, Security & QA Engineer  
**Objetivo:** Retomar y culminar la remediación de hallazgos P1 priorizados (AUD-001, AUD-002, AUD-003) y configuraciones operacionales (AUD-008) sin interrumpir el entorno real, preservando cambios preexistentes y validando contra PostgreSQL en contenedor aislado.

### 12.1 Matriz de estado actualizado de hallazgos

| ID | Severidad | Hallazgo original | Estado Misión 2 | Justificación técnica y evidencia |
|---|---|---|---|---|
| **AUD-001** | P1 | Roles superusuario y privilegios excesivos de app en PostgreSQL | **Mitigado en arquitectura / Corregido y verificado en QA aislado** (Pendiente de despliegue en DB activa por protección de datos) | Se verificó `migrations/06_runtime_user.sql` en instancia QA aislada (`nexus-qa-isolated-db`). Rol `nexus_app` opera con privilegios mínimos (DML de negocio permitido, solo lectura en `users`, DDL/TRUNCATE/ALTER ROLE denegados). La base real de producción y su volumen persistente `tv_gsi_tv_pgdata` fueron protegidos sin aplicar cambios destructivos en caliente. |
| **AUD-002** | P1 | Heartbeat anónimo actualiza `last_login` si hash es NULL / oculta fallos DB | **Corregido y verificado** | Remediado en `src/routes/tv.js`. Exige validación criptográfica estricta, rechaza credenciales ausentes/inválidas/cruzadas/inactivas con 401, valida `tv_uuid` (400) y responde 500 genérico sin fuga en fallos DB. Verificado con 10 tests unitarios y 9 tests de integración contra PostgreSQL real. |
| **AUD-003** | P1 | Dependencia frontend `source-map-js` con advisory alto (GHSA-68fv-2mgg-jv7q) | **Corregido y verificado** | Resuelto mediante `overrides` en `frontend/package.json` y actualización de `frontend/package-lock.json` y `frontend/pnpm-lock.yaml`. Versión física instalada `1.2.2`. `npm audit` reporta 0 vulnerabilidades en frontend y backend. Compilación limpia (126 módulos). |
| **AUD-004** | P2 | Upload multimedia sin allowlist de tipo/firma | **Pendiente** | Fuera de alcance de Misión 2 (P1). Permanece en backlog de remediación P2. |
| **AUD-005** | P2 | Credencial de pairing sin confirmación de entrega (ACK volátil) | **Pendiente** | Fuera de alcance de Misión 2 (P1). Requiere rediseño del protocolo de entrega con ACK durable. |
| **AUD-006** | P2 | Token en query string del handshake WebSocket | **Mitigado / Pendiente** | Fuera de alcance de Misión 2 (P1). Handshake soporta auth/headers, mitigación pendiente de alineación con clientes legados. |
| **AUD-007** | P2 | Recursos de medios `/media/*` públicos | **Pendiente** | Sujeto a decisión de clasificación de información del negocio. |
| **AUD-008** | P2 | Exposición de puerto PostgreSQL en interfaces externas y CORS LAN | **Corregido en configuración y verificado** | `docker-compose.yml` y `.env.example` actualizados con enlace por defecto a loopback: `${HOST_DB_BIND:-127.0.0.1}:${HOST_DB_PORT:-25432}:5432`. `docker compose config` confirma `host_ip: 127.0.0.1`. CORS verificado como desacoplado al utilizar proxy Nginx del mismo origen. Contenedor activo no recreado para no comprometer uptime de datos. |

---

### 12.2 Verificación detallada del Heartbeat (`src/routes/tv.js`)

El endpoint `POST /api/tv/heartbeat` fue refactorizado para garantizar:
1. Requerimiento obligatorio de `tv_uuid` (HTTP 400 Bad Request si no se suministra).
2. Comprobación estricta de que la pantalla exista en base de datos, esté activa (`is_active = true`), cuente con un hash configurado (`device_token_hash IS NOT NULL`) y que el token provisto coincida criptográficamente mediante `verifyDeviceToken`.
3. Doble verificación a nivel de sentencia `UPDATE nexus_tv.tv_screens SET last_login = NOW() WHERE tv_uuid = $1 AND is_active = true AND device_token_hash = $2` para prevenir condiciones de carrera si una pantalla es desactivada o revocada entre el `SELECT` y el `UPDATE`.
4. Si la actualización no afecta exactamente una fila (`update.rowCount !== 1`), se responde HTTP 401.
5. Los errores de base de datos se capturan, se registran en los logs del servidor y se devuelve HTTP 500 genérico (`{"success": false, "message": "No se pudo procesar el heartbeat."}`), sin exponer stack traces ni detalles sintácticos de la consulta.

**Casos verificados en pruebas unitarias (`tests/tv-heartbeat.test.js`) — 10 casos:**
* Pantalla inexistente: rechazada con 401, estado en memoria inalterado.
* Pantalla inactiva: rechazada con 401, estado en memoria inalterado.
* Pantalla con `device_token_hash` nulo: rechazada con 401 tanto en peticiones anónimas como con token provisto.
* Ausencia de token: rechazada con 401, estado inalterado.
* Token inválido/aleatorio: rechazado con 401, estado inalterado.
* Token de otra pantalla legítima: rechazado con 401, ninguna de las dos pantallas actualizada.
* Token válido de la pantalla correspondiente: HTTP 200, `success: true`, timestamp emitido y `last_login` actualizado.
* Fallo simulado de lectura en base de datos: HTTP 500 genérico, sin fugas de información.
* Fallo simulado de escritura en base de datos: HTTP 500 genérico.
* Ausencia de `tv_uuid`: HTTP 400 Bad Request.

**Casos verificados en pruebas de integración PostgreSQL real (`tests/tv-heartbeat-integration.test.js`) — 9 casos:**
* Ejecutados contra la instancia aislada `nexus-qa-isolated-db` (puerto `127.0.0.1:25499`, usuario de runtime `nexus_app`).
* Verificación directa sobre columnas SQL reales `nexus_tv.tv_screens.last_login`:
  * Pantalla inexistente: HTTP 401, 0 filas afectadas en DB.
  * Pantalla inactiva: HTTP 401, timestamp `2020-01-01 00:00:00` en DB inalterado.
  * Pantalla con hash nulo: HTTP 401, timestamp en DB inalterado.
  * Petición sin token: HTTP 401, timestamp en DB inalterado.
  * Token incorrecto: HTTP 401, timestamp en DB inalterado.
  * Token cruzado entre pantallas A y B: HTTP 401, timestamps de A y B en DB inalterados.
  * Token válido: HTTP 200, `last_login` de pantalla A actualizado a tiempo presente (`NOW() - last_login < interval '10 seconds'`), pantalla B inalterada en DB.
  * Ausencia de `tv_uuid`: HTTP 400.
  * Caída de pool de DB: HTTP 500 genérico, sin fuga de mensajes de error de red o credenciales.

---

### 12.3 Verificación de dependencias y Runtime Node.js

1. **Dependencia `source-map-js`:**
   - Ubicación: `frontend/package.json`, `frontend/package-lock.json`, `frontend/pnpm-lock.yaml`.
   - Se configuró la clave de resolución explícita en `frontend/package.json`:
     ```json
     "overrides": {
       "source-map-js": "^1.2.2"
     }
     ```
   - Se ejecutó `npm ci` con sincronización de paquetes en `frontend/`.
   - Inspección física de `frontend/node_modules/source-map-js/package.json`: versión `1.2.2`.
   - `npm ls source-map-js` confirma árbol resuelto a `source-map-js@1.2.2` bajo `postcss@8.5.28` y `vite@8.3.0`.
   - `npm audit` en `frontend/`: **0 vulnerabilidades**.
   - `npm audit` en directorio raíz: **0 vulnerabilidades**.
2. **Compilación y Linters:**
   - `frontend/`: `npm run build` ejecutado exitosamente con Vite 8 en 876 ms (126 módulos transformados, artefactos generados en `dist/`).
   - `frontend/`: `npm run lint` (oxlint) finalizado con 0 errores y 10 advertencias cosméticas/React Hooks preexistentes.
3. **Runtime Node 24 LTS:**
   - Dockerfiles actualizados a imagen base `node:24-alpine` en backend y frontend.
   - Flujo CI (`.github/workflows/ci.yml`) actualizado para utilizar Node 24 LTS en jobs de backend y frontend.
   - Archivo `.nvmrc` creado con versión `24.21.0`.
   - `package.json` y `frontend/package.json` configuran `"engines": { "node": ">=24 <25" }`.
   - Entorno del host de desarrollo local: ejecuta Node `v20.18.0`. Las advertencias de Vite relativas a la versión de Node son advertencias informativas en el host, sin impacto en la reproducibilidad de los contenedores Docker ni en CI.

---

### 12.4 Inspección de migraciones y Saneamiento de datos COPY

1. **Descubrimiento:**
   - La migración base `migrations/01_init_nexus_tv.sql` corresponde a un volcado estructural de PostgreSQL que incluía bloques `COPY ... FROM stdin;` cargando datos en las tablas:
     - `nexus_tv.content` (línea 288)
     - `nexus_tv.playlist_content` (línea 364)
     - `nexus_tv.playlists` (línea 507)
     - `nexus_tv.tv_playlist` (línea 518)
     - `nexus_tv.tv_screens` (línea 531)
     - `nexus_tv.users` (línea 546)
   - Estos datos contenían URLs de medios, identificadores de red y hashes de contraseñas de cuentas preexistentes.
2. **Saneamiento estricto:**
   - **Regla aplicada:** Ningún dato proveniente de los bloques `COPY` fue cargado en la base de datos de QA.
   - Se generó una copia de la migración para QA conservando las sentencias DDL, índices, secuencias y delimitadores de fin de bloque `\.`, omitiendo todas las filas de datos. El log de inicialización de PostgreSQL confirmó `COPY 0` en las 6 tablas.
   - Todas las pruebas de integración se ejecutaron con datos sintéticos y transaccionales creados expresamente para las pruebas.
   - La migración original del repositorio se conservó en su estructura funcional sin alteraciones de datos.

---

### 12.5 Estrategia de mínimo privilegio en PostgreSQL (AUD-001)

1. **Validación en entorno QA aislado:**
   - Se validó el script de migración `migrations/06_runtime_user.sql` sobre el contenedor de pruebas `nexus-qa-isolated-db`.
   - Se creó el rol de runtime `nexus_app` con atributos `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`.
   - Se otorgó:
     - `GRANT USAGE ON SCHEMA nexus_tv TO nexus_app;`
     - `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.content, playlist_content, playlists, tv_playlist, tv_screens TO nexus_app;`
     - `GRANT SELECT ON TABLE nexus_tv.users TO nexus_app;` (Solo lectura para validación de login/autenticación).
     - `GRANT USAGE, SELECT ON SEQUENCE` en las 4 secuencias de negocio.
   - Ejecución de `tests/qa-least-privilege.test.js` (8 subtests):
     - Atributos del rol verificados: no superusuario, no admin.
     - Operaciones CRUD de negocio: inserción, actualización, consulta y borrado en tablas de negocio completadas satisfactoriamente.
     - Lectura en tabla `users`: autorizada.
     - Inserción/actualización/borrado en tabla `users`: **Denegada con error `42501 permission denied for table users`**.
     - `TRUNCATE` en tablas de negocio: **Denegado con error `42501 permission denied for table tv_screens`**.
     - DDL (`CREATE TABLE`, `DROP TABLE`): **Denegado con error `42501 permission denied for schema nexus_tv` / `must be owner`**.
     - Elevación de privilegios (`ALTER ROLE ... SUPERUSER`): **Denegada con error de autorización**.
     - Mutación de secuencia administrativa `users_id_seq`: **Denegada**.
2. **Protección absoluta de la base de datos real:**
   - La base de datos activa de producción (`tv-db` / `tv_gsi_tv_pgdata`) no fue modificada ni reiniciada. Los roles existentes se conservan intactos para garantizar la estabilidad operativa.
   - Procedimiento de migración futura propuesto:
     1. Desplegar script `06_runtime_user.sql` en la base activa mediante el usuario DBA.
     2. Configurar en `.env` las variables `PG_APP_USER=nexus_app` y `PG_APP_PASSWORD=<secreto_generado>`.
     3. Reiniciar el contenedor de backend verificando conectividad mediante `SELECT 1`.
     4. Tras ventana de estabilidad de 7 días, revocar atributos SUPERUSER del rol legado `tv`.

---

### 12.6 Exposición de puertos y arquitectura de red (AUD-008)

1. **Puerto de PostgreSQL:**
   - En `docker-compose.yml`:
     ```yaml
     ports:
       - "${HOST_DB_BIND:-127.0.0.1}:${HOST_DB_PORT:-25432}:5432"
     ```
   - En `.env.example`:
     ```bash
     HOST_DB_BIND=127.0.0.1
     HOST_DB_PORT=25432
     ```
   - Verificación estática vía `docker compose config`: confirma que `tv-db` publica el puerto `25432` exclusivamente en `127.0.0.1`, evitando exposición a la red local (LAN/`0.0.0.0`) en cualquier entorno desplegado desde esta configuración.
2. **Aislamiento de CORS:**
   - El acceso al frontend se realiza a través del proxy reverso Nginx (`frontend/nginx.conf`), el cual enruta peticiones `/api/` y `/media/` internamente hacia el servicio `backend:3002`.
   - Al ser solicitudes relativas del mismo origen para el navegador, el mecanismo de CORS no interviene en el flujo estándar de la aplicación web, mitigando falsos positivos.

---

### 12.7 Resumen de ejecución de pruebas automatizadas

Comando ejecutado en la raíz del backend: `npm test`  
Entorno: `NODE_ENV=test` con contenedor QA PostgreSQL aislado en puerto `25499`.

```text
# tests 93
# suites 0
# pass 93
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2036.02
```

Desglose de los 93 tests aprobados:
- **63 tests de regresión histórica:** Autenticación JWT, Device Auth, rotación de playlists, RBAC (14 casos), ventanas horarias y shuffles de reproducción.
- **10 tests unitarios de Heartbeat (`tests/tv-heartbeat.test.js`):** Cobertura exhaustiva de ramificaciones de autenticación y códigos HTTP con pool mock.
- **9 tests de integración de Heartbeat (`tests/tv-heartbeat-integration.test.js`):** Invocaciones HTTP reales contra Express y verificación de mutaciones SQL en PostgreSQL real aislado.
- **11 subtests de mínimo privilegio (`tests/qa-least-privilege.test.js`):** Validación funcional DML, denegación DDL/TRUNCATE y aislamiento de seguridad de roles.

---

### 12.8 Deuda técnica residual y riesgos abiertos

1. **AUD-004 (Upload de medios sin filtrado de firma MIME):** Multer acepta hasta 500 MB y clasifica según extensión. Debe implementarse `fileFilter` y validación de firma con librería `file-type` en la siguiente iteración.
2. **AUD-005 (Entrega de credenciales en pairing):** El evento `command:assign_profile` mediante socket volátil carece de handshake con ACK de la TV. Requiere confirmación bidireccional durable para tolerar caídas de red durante el emparejamiento.
3. **AUD-007 (Archivos `/media/*` públicos):** Nginx expone los medios sin autenticación. Si el cliente requiere contenido privado, debe implementarse generación de URLs firmadas temporales.
4. **Despliegue de mínimo privilegio en base real:** Pendiente de ejecución controlada por el DBA siguiendo el procedimiento de la sección 12.5.

---

## 13. Misión 2B — Gate de Seguridad, Reproducibilidad e Integridad (2026-10-09)

**Fecha de ejecución:** 2026-10-09  
**Responsable:** Senior Software, Security & QA Engineer  
**Objetivo:** Revisión crítica y exhaustiva de los resultados de la Misión 2, verificación de evidencia empírica, endurecimiento de pruebas de integración con guardas anti-producción y diagnóstico de reproducibilidad de dependencias sin tolerar atajos artificiales.

### 13.1 Evidencia y Trazabilidad del Aislamiento PostgreSQL

Se realizó una inspección forense en modo de solo lectura sobre todos los contenedores y volúmenes de PostgreSQL existentes:

| Parámetro | Servicio activo Compose (`tv-db`) | Contenedor de auditoría (`nexus-audit-pg-...`) | Contenedor QA aislado (`nexus-qa-isolated-db`) |
|---|---|---|---|
| **Container ID** | `a46d31f600e9` | `600b047e2d55` | `85736f1851d2` |
| **Imagen** | `postgres:17-alpine` | `postgres:17-alpine` | `postgres:17-alpine` |
| **Network Mode** | `tv_gsi_tv_network` (bridge Compose) | `none` (aislamiento total, solo loopback interno) | `bridge` (default Docker bridge) |
| **Puertos publicados** | `0.0.0.0:25432->5432`, `[::]:25432->5432` | Ninguno (`{}`) | `127.0.0.1:25499->5432` (exclusivo loopback) |
| **Volumen de datos** | `tv_gsi_tv_pgdata` (volumen nombrado Compose) | `7ad015dc0327...` (volumen anónimo independiente) | `nexus_qa_isolated_pgdata` (volumen nombrado QA) |
| **Directorio initdb** | `C:\Users\DEVELOPMENT\Downloads\tv_gsi\migrations` | `C:\Users\DEVELO~1\AppData\Local\Temp\nexus-audit-...\migrations` (ro) | `.../Temp/nexus-audit-.../migrations` (ro) |
| **Labels** | Compose (`project: tv_gsi`, `service: db`) | `codex.audit.id: d66618f0cd6047b3931745830dfcaf31` | Ninguno |

**Comprobación de no afectación de la base de datos real:**
- El contenedor `tv-db` registra un tiempo de inicio ininterrumpido desde `2026-10-08T15:27:50Z` (más de 29 horas continuas sin reinicios).
- Los registros del motor (`docker logs --since 3h tv-db`) confirman únicamente checkpoints automáticos rutinarios de 5 minutos; no se registraron transacciones anómalas ni operaciones destructivas.
- El conteo de filas en `tv-db` permanece idéntico al estado preflight documentado en [TC-SECURITY-WS-001.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-SECURITY-WS-001.md):
  - `nexus_tv.tv_screens`: 8 pantallas (7 activas, 1 inactiva, 0 credenciales pendientes).
  - `nexus_tv.playlists`: 4 playlists.
  - `nexus_tv.content`: 47 contenidos.
  - `nexus_tv.users`: 10 usuarios.
- **Conclusión probada:** La base de datos de producción y su volumen persistente `tv_gsi_tv_pgdata` permanecieron estrictamente aislados y no sufrieron ninguna mutación.

---

### 13.2 Blindaje e Inequívoca Orientación de las Pruebas de Integración

Las suites [tests/tv-heartbeat-integration.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/tv-heartbeat-integration.test.js) y [tests/qa-least-privilege.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/qa-least-privilege.test.js) fueron revisadas y fortalecidas:

1. **Eliminación de omisiones silenciosas:** Se eliminaron las directivas `t.skip`. Si la instancia QA en el puerto `25499` no está disponible, la prueba falla de forma determinista mediante `assert.fail` indicando el bloqueo, impidiendo falsos positivos.
2. **Guardas estrictas contra puertos de producción:** Ambas suites incorporan una comprobación inicial obligatoria que arroja una excepción fatal si el puerto configurado es `25432` o coincide con `process.env.PG_PORT`:
   ```javascript
   if (QA_PG_PORT === 25432 || (process.env.PG_PORT && parseInt(process.env.PG_PORT, 10) === 25432)) {
       throw new Error('SECURITY VIOLATION: Integration tests must NEVER target production port 25432!');
   }
   ```
3. **Identificación de la base y usuario efectivos:** Antes de cualquier consulta DML, las pruebas ejecutan `SELECT current_user, current_database()` y validan que la base sea `nexus_tv` y que el usuario efectivo pertenezca a la terna de QA (`nexus_app`, `qa_admin`), garantizando que jamás se ejecuten escrituras contra un usuario no verificado.
4. **Verificación de denegación real:** En [tests/qa-least-privilege.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/qa-least-privilege.test.js), cada prueba negativa ejecuta consultas independientes (fuera de transacciones abortadas) y valida el código de error PostgreSQL `42501` (`insufficient_privilege`) y mensajes específicos del catálogo.

---

### 13.3 Reproducibilidad del Frontend y Diagnóstico de Bindings en Windows

1. **Gestor de paquetes soportado:** Se confirmó que CI (`.github/workflows/ci.yml`) y Docker (`frontend/Dockerfile`) utilizan exclusivamente `npm` (`npm ci`). El archivo `frontend/pnpm-lock.yaml` es redundante y no es consumido por los pipelines.
2. **Diagnóstico de los bindings nativos en Windows:**
   - La máquina host ejecuta Node `v20.18.0`.
   - Las dependencias upstream Vite 8 (`@rolldown/binding-win32-x64-msvc@1.2.9`) y Oxlint (`@oxlint/binding-win32-x64-msvc@1.83.0`) imponen en sus metadatos `"engines": { "node": "^20.19.0 || >=22.12.0" }`.
   - Por especificación de npm Arborist (npm issue #4828), cualquier dependencia opcional cuyo rango de `engines` no coincida con el motor en ejecución es marcada como `failed optional dependency` y eliminada de `node_modules` durante `npm ci`.
   - En la sesión anterior se recurrió al uso de `npm install --force --no-save`. De acuerdo con las reglas de integridad de la Misión 2B, **dicha práctica se descarta terminantemente** por enmascarar un problema de resolución.
3. **Prueba de reproducibilidad en el runtime objetivo (Node 24 LTS):**
   - Se ejecutó `docker build frontend` utilizando la imagen oficial `node:24-alpine` con `RUN npm ci` y `RUN npm run build`.
   - **Resultado:** Instalación de 65 paquetes en 5 s con 0 vulnerabilidades, y compilación exitosa de los 126 módulos en 508 ms.
4. **Dictamen de reproducibilidad:**
   - En contenedores Docker y CI (Node 24 LTS): **Corregido y verificado**.
   - En el host local Windows con Node 20.18.0: **Corregido, pendiente de verificación en host** hasta que el entorno local se actualice a Node 24 LTS conforme a lo estipulado en `.nvmrc` y `package.json`.

---

### 13.4 Flujo de Mínimo Privilegio en Instalación Limpia (AUD-001)

Se validó el ciclo de vida de inicialización en [migrations/06_runtime_user.sql](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/migrations/06_runtime_user.sql) y [docker-compose.yml](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docker-compose.yml):

1. **Segregación Bootstrap vs. Runtime:**
   - Si `POSTGRES_USER` es el administrador bootstrap (`PG_ADMIN_USER=postgres` o `qa_admin`), PostgreSQL `initdb` crea el superusuario administrador.
   - La migración [01_init_nexus_tv.sql](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/migrations/01_init_nexus_tv.sql) crea los roles nominales como `NOLOGIN NOSUPERUSER`.
   - La migración [06_runtime_user.sql](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/migrations/06_runtime_user.sql) consume las variables `PG_APP_USER` y `PG_APP_PASSWORD` mediante directivas `\getenv`, valida que `app_user` sea distinto del usuario bootstrap y crea `nexus_app` con atributos `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`.
2. **Validación empírica en `nexus-qa-isolated-db`:**
   - `SELECT rolname, rolsuper, rolcanlogin`: `qa_admin` es superusuario; `nexus_app` es login no-superusuario; roles restantes son `NOLOGIN NOSUPERUSER`.
   - `ALTER ROLE nexus_app SUPERUSER`: Rechazado con error de privilegios.
   - `CREATE ROLE`: Rechazado con error de privilegios.
   - `CREATE DATABASE`: Rechazado con error de privilegios.
   - Conexión a base de datos ajena (`postgres`): **Rechazada con `FATAL: permission denied for database "postgres"`** debido a la revocación de `CONNECT FROM PUBLIC`.
   - Operaciones DML en tablas de negocio: Totalmente operativas.
   - Inserción/actualización en tabla `users`: Denegada con código `42501`.
   - Comando `TRUNCATE`: Denegado con código `42501`.

---

### 13.5 Estado Consolidado de Hallazgos al Cierre de Misión 2B

| ID | Hallazgo | Severidad | Estado Misión 2B | Fundamentación Técnica |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | **Mitigado en arquitectura / Corregido y verificado en QA aislado** (Pendiente en DB real) | Separación completa entre bootstrap y runtime en `06_runtime_user.sql` y Compose. Verificado en QA aislado. Base real protegida sin aplicar cambios destructivos en caliente. Procedimiento DBA listo. |
| **AUD-002** | Heartbeat anónimo y manejo de errores | P1 | **Corregido y verificado** | Remediado en [tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/tv.js). Endurecido con guardas de aislamiento. 10 tests unitarios y 9 tests de integración contra PostgreSQL real aprobados (0 fallos). |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 | **Corregido y verificado** | `source-map-js@1.2.2` fijado por `overrides` en `package.json`. `npm audit` a 0 vulnerabilidades. Compilación limpia y reproducible verificada en Docker Node 24. |
| **AUD-004** | Upload sin allowlist de firma MIME | P2 | **Pendiente** | Fuera de alcance de Misión 2 / 2B. |
| **AUD-005** | Entrega volátil en pairing sin ACK | P2 | **Pendiente** | Fuera de alcance de Misión 2 / 2B. |
| **AUD-006** | Token en query string WebSocket | P2 | **Mitigado** | Handshake soporta autenticación por cabeceras y payload. |
| **AUD-007** | Directorio `/media/*` público | P2 | **Pendiente** | Sujeto a política de negocio. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | **Corregido en configuración y verificado** | `docker-compose.yml` restringe a `127.0.0.1` por defecto. Verificado vía `docker compose config`. |

---

### 13.6 Verificación de Higiene del Repositorio y Entorno (Misión 2B)

- **Resultados de tests:** `npm test` ejecuta 93 tests (63 regresión, 10 unitarios heartbeat, 9 integración PostgreSQL real, 11 mínimo privilegio); **93 passed, 0 failed** (2.62 s).
- **Dependencias:** `npm audit` reporta 0 vulnerabilidades en backend y 0 en frontend.
- **Formato y sintaxis:** `git diff --check` finalizó con **cero advertencias y cero errores**.
- **Secretos:** No se introdujeron credenciales de producción ni secretos en el código, diffs ni informes.
- **Operaciones Git:** Cero commits, cero pushes, cero cambios de rama y cero operaciones remotas.
- **Operaciones destructivas:** Cero comandos destructivos sobre la base de datos o volúmenes de producción.

---

## 14. MISIÓN 2C — Validación Funcional del Mínimo Privilegio y Cierre de Evidencias (2026-10-09)

### 14.1 Verificación de las Necesidades Funcionales de `nexus_app` sobre `nexus_tv.users`

1. **Inspección de Consultas y Endpoints en Backend:**
   - Se ejecutó un análisis estático exhaustivo de todas las sentencias SQL y dependencias de base de datos en `src/`.
   - Se identificó que la única consulta en todo el backend contra la tabla `nexus_tv.users` se ubica en [src/routes/auth.js:22](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/auth.js#L22):
     ```sql
     SELECT id, username, email, role, password_hash FROM nexus_tv.users WHERE username = $1;
     ```
   - No existe ninguna operación de inserción (`INSERT`), actualización (`UPDATE`) ni borrado (`DELETE`) sobre `nexus_tv.users` en ningún controlador o servicio de la aplicación. Tampoco existen pantallas o formularios en el frontend para gestión o registro de usuarios.
   - El aprovisionamiento de cuentas de administrador y usuarios del sistema es un flujo estrictamente administrativo out-of-band realizado por el DBA durante migraciones o scripts de bootstrap.
2. **Validación del Contrato de Mínimo Privilegio:**
   - La concesión exclusiva de `SELECT` a `nexus_app` sobre `nexus_tv.users` preserva el 100% de la funcionalidad legítima del producto (autenticación de usuarios vía `/api/auth/login`).
   - La denegación explícita de `INSERT`, `UPDATE` y `DELETE` bloquea cualquier vector de escalada de privilegios o persistencia maliciosa (por ejemplo, inyecciones SQL que intenten crear usuarios administradores o alterar contraseñas existentes).
3. **Prueba Funcional End-to-End con Router Real de Express:**
   - Se validó empíricamente en [tests/qa-least-privilege.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/qa-least-privilege.test.js) que el endpoint real `/api/auth/login` opera con éxito utilizando el pool de conexiones de `nexus_app` contra la base QA aislada:
     - Retorna HTTP 200 y emite el token JWT para credenciales válidas.
     - Valida el token contra el endpoint protegido `/api/auth/me`.
     - Rechaza con HTTP 401 las credenciales erróneas.
     - Rechaza con código PostgreSQL `42501` cualquier intento de mutación DML sobre `nexus_tv.users`.

### 14.2 Guardas de Integración Reforzadas y Marca de Identidad QA

1. **Módulo Centralizado de Guarda ([tests/qa-guard.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/qa-guard.js)):**
   - Se creó una guarda de seguridad que se invoca de manera obligatoria antes de cualquier consulta de prueba en [tests/tv-heartbeat-integration.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/tv-heartbeat-integration.test.js) y [tests/qa-least-privilege.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/qa-least-privilege.test.js).
2. **Reglas de Aislamiento Innegociables:**
   - **Host:** Debe ser estrictamente `127.0.0.1`.
   - **Puerto:** Debe ser estrictamente `25499` (prohíbe el puerto de producción `25432` y puertos estándar).
   - **Base de datos:** Debe ser `nexus_tv`.
   - **Usuario:** Debe coincidir con el rol esperado para la prueba (`nexus_app` para validación funcional/seguridad; `qa_admin` únicamente para el seeding sintético inicial de fixtures). Se rechaza terminantemente el uso de usuarios de producción o desarrollo (`tv`, `postgres`, `nexus_admin`).
3. **Comprobación de Identidad por Marca de Catálogo:**
   - La guarda ejecuta una consulta preventiva de solo lectura sobre `pg_database` y `pg_shdescription`:
     ```sql
     SELECT pg_database.datname, pg_shdescription.description
     FROM pg_database
     LEFT JOIN pg_shdescription ON pg_database.oid = pg_shdescription.objoid
     WHERE pg_database.datname = current_database();
     ```
   - Exige que `description` sea exactamente igual a `'QA_ISOLATED_DB_25499_VALIDATED'`.
   - Si la instancia destino carece de este comentario (como ocurre en la base real `tv-db`), la suite aborta inmediatamente con un error de seguridad, impidiendo cualquier ejecución o mutación SQL.

### 14.3 Reclasificación Técnica de AUD-006 (Socket.IO Query String Handshake)

1. **Evidencia Técnica:**
   - En [src/sockets/index.js:34](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/sockets/index.js#L34), el middleware continúa extrayendo `deviceToken` a través de:
     ```javascript
     const deviceToken = auth.device_token || query.device_token || socket.handshake.headers?.['x-device-token'];
     ```
2. **Análisis de Clientes y Riesgo Residual:**
   - El cliente web oficial [TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx) transmite sus credenciales de manera segura mediante el objeto `auth` y la cabecera `X-Device-Token`, enviando `query: {}`.
   - Sin embargo, el servidor retiene el canal `query.device_token` por compatibilidad operativa con pantallas físicas desplegadas y clientes empotrados (Smart TVs Tizen/webOS).
   - Debido a que la aceptación en query string sigue activa en el backend, los tokens enviados por clientes legados continúan expuestos a ser registrados en logs de servidores web, proxies inversos y telemetría de red.
3. **Dictamen de Clasificación:**
   - La mera disponibilidad de alternativas seguras no extingue la vulnerabilidad mientras la vía insegura permanezca habilitada en el servidor.
   - Por tanto, se corrige la clasificación de AUD-006: pasa de "Mitigado" a **Pendiente / Parcialmente mitigado**, manteniendo abierta la evidencia técnica del riesgo residual hasta que se planifique y verifique la migración de todas las pantallas físicas en campo.

### 14.4 Reproducibilidad Frontend y Transparencia Histórica

1. **Historial de Exploración vs. Procedimiento Reproducible:**
   - Se transparenta que en fases tempranas de remediación se realizaron intentos exploratorios de instalación mediante `npm install --force --no-save` debido al rechazo de dependencias opcionales de Vite/Oxlint bajo Node 20.18.0 en Windows.
   - Esos intentos fueron descartados por violar los principios de reproducibilidad. La solución oficial y reproducible establecida consiste en la estandarización sobre el runtime objetivo **Node 24 LTS** con `npm ci`.
2. **Validación en Entorno Limpio Node 24 LTS (`node:24-alpine`):**
   - Ejecutado en contenedor efímero sin artefactos locales:
     - `npm ci`: Instalación limpia y exacta de dependencias fijadas en `package-lock.json` en 5 s, con 0 vulnerabilidades.
     - `npm run build`: Compilación con Vite 8.3.0 de 126 módulos en 405 ms (`dist/index.html` 0.79 kB, CSS bundle 24.68 kB, JS bundle 431.43 kB).
     - `npx oxlint src`: Análisis estático sobre 15 archivos completado en 24 ms con 0 errores (1 advertencia no bloqueante por variable no utilizada).
     - `npm audit`: 0 vulnerabilidades notificadas.
3. **Estado de `frontend/pnpm-lock.yaml`:**
   - Se verificó que ni CI (`.github/workflows/ci.yml`) ni los Dockerfiles consumen `pnpm`. El archivo es redundante pero se conserva trackeado para evitar eliminaciones no solicitadas fuera del alcance de la misión.
4. **Reversión de Cambios Incidentales en Documentación Histórica:**
   - Se revirtió la modificación de formato en [docs/14-changelog/releases/v2.1.3.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/14-changelog/releases/v2.1.3.md) introducida previamente de forma incidental al resolver `git diff --check`, preservando la integridad histórica de versiones pasadas.

### 14.5 Matriz Consolidada de Hallazgos tras Misión 2C

| ID | Hallazgo | Severidad | Estado Oficial Misión 2C | Fundamentación Técnica |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | **Mitigado en arquitectura / Corregido y verificado en QA aislado** (Pendiente en DB real) | Separación formal bootstrap vs. runtime en `06_runtime_user.sql`. Rol `nexus_app` validado funcionalmente end-to-end con rutas Express y operaciones CRUD de negocio. Lectura exclusiva en `users` cubre 100% de la funcionalidad legítima. Base real intacta a la espera de ventana de mantenimiento DBA. |
| **AUD-002** | Heartbeat anónimo y manejo de errores | P1 | **Corregido y verificado** | Remediado en [tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/tv.js). Endurecido con guardas de QA con marca de identidad. 10 tests unitarios y 9 de integración PostgreSQL real aprobados (0 fallos). |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 | **Corregido y verificado** | `source-map-js@1.2.2` fijado por `overrides` en `package.json`. `npm audit` a 0 vulnerabilidades. Compilación reproducible verificada en Docker Node 24 LTS. |
| **AUD-004** | Upload sin allowlist de firma MIME | P2 | **Pendiente** | Fuera de alcance de Misión 2 / 2B / 2C. |
| **AUD-005** | Entrega volátil en pairing sin ACK | P2 | **Pendiente** | Fuera de alcance de Misión 2 / 2B / 2C. |
| **AUD-006** | Token en query string WebSocket | P2 | **Pendiente / Parcialmente mitigado** | Frontend web migrado a `auth: {}` y cabeceras `X-Device-Token`. El backend conserva soporte de query string por retrocompatibilidad con pantallas físicas; el riesgo en logs persiste para dichos dispositivos. |
| **AUD-007** | Directorio `/media/*` público | P2 | **Pendiente** | Sujeto a decisión y política de negocio. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | **Corregido en configuración y verificado** | `docker-compose.yml` restringe a `127.0.0.1` por defecto. Verificado vía `docker compose config`. |

### 14.6 Verificación de Higiene del Repositorio y Entorno (Misión 2C)

- **Resultados de tests:** `npm test` ejecuta 94 tests (63 regresión, 10 unitarios heartbeat, 9 integración PostgreSQL real, 10 mínimo privilegio y autenticación Express real, 2 normalización playlist); **94 passed, 0 failed** (2.06 s).
- **Dependencias:** `npm audit` reporta 0 vulnerabilidades en backend y 0 en frontend.
- **Formato y sintaxis:** `git diff --check` finalizó con **cero advertencias y cero errores**.
- **Secretos:** No se introdujeron credenciales de producción ni secretos en el código, diffs ni informes.
- **Operaciones Git:** Cero commits, cero pushes, cero cambios de rama y cero operaciones remotas.
- **Operaciones destructivas:** Cero comandos destructivos sobre la base de datos o volúmenes de producción.

---

## 15. MISIÓN 2D — Validación del Bootstrap y del Estado Efectivo de PostgreSQL (2026-10-09)

### 15.1 Verificación de Causa Raíz de AUD-001 y Corrección del Flujo de Bootstrap Limpio

1. **Inspección Integral de Procedimientos de Inicialización:**
   - Se revisó conjuntamente [docker-compose.yml](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docker-compose.yml), [.env.example](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/.env.example), [src/config/db.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/config/db.js), [migrations/01_init_nexus_tv.sql](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/migrations/01_init_nexus_tv.sql) y [migrations/06_runtime_user.sql](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/migrations/06_runtime_user.sql).
   - **Causa Raíz Identificada:** En [docker-compose.yml](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docker-compose.yml), la variable `POSTGRES_USER` tenía configurado el valor predeterminado `${PG_ADMIN_USER:-${PG_USER:-tv}}`. En ausencia de `PG_ADMIN_USER` en el entorno, PostgreSQL `initdb` creaba el usuario `tv` como superusuario inicial del clúster. Posteriormente, `01_init_nexus_tv.sql` evaluaba `IF NOT EXISTS ... CREATE ROLE tv WITH NOLOGIN NOSUPERUSER ...`; dado que `tv` ya existía, la condición se saltaba y `tv` retenía sus privilegios de superusuario. Adicionalmente, `PG_APP_USER` en `db` carecía de valor por defecto, causando que `06_runtime_user.sql` abortara con `\quit 3` si no se especificaban variables.
2. **Remediación Mínima y Segura:**
   - En [docker-compose.yml](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docker-compose.yml), se establecieron los valores predeterminados seguros alineados con [.env.example](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/.env.example):
     - `POSTGRES_USER: ${PG_ADMIN_USER:-postgres}` (el administrador de bootstrap es exclusivamente `postgres`).
     - `PG_APP_USER: ${PG_APP_USER:-nexus_app}` (el usuario de runtime es exclusivamente `nexus_app`).
     - `PG_APP_PASSWORD: ${PG_APP_PASSWORD:-${PG_PASSWORD:?Set PG_APP_PASSWORD in .env}}`.
     - Healthcheck: `test: ["CMD-SHELL", "pg_isready -U ${PG_ADMIN_USER:-postgres} -d ${PG_DATABASE:-nexus_tv}"]`.
     - Backend: `PG_APP_USER=${PG_APP_USER:-nexus_app}`.
3. **Validación Empírica en Instancia QA Desechable (`nexus-qa-clean-bootstrap-val`):**
   - Se instanció un contenedor PostgreSQL limpio e independiente en el puerto `127.0.0.1:25498`, con el volumen nuevo `nexus_qa_clean_bootstrap_pgdata` y la marca de catálogo `COMMENT ON DATABASE nexus_tv IS 'QA_CLEAN_BOOTSTRAP_25498_VALIDATED';`.
   - Se aplicaron las migraciones 01 a 06 con esquemas higienizados (sin filas de producción, `COPY 0`).
   - La consulta a `pg_roles` demostró el estado resultante:
     - `postgres`: `rolsuper=true`, `rolcanlogin=true`, `rolcreaterole=true`, `rolcreatedb=true` (Administrador de bootstrap).
     - `nexus_app`: `rolsuper=false`, `rolcanlogin=true`, `rolcreaterole=false`, `rolcreatedb=false`, `rolreplication=false` (Usuario de aplicación con privilegios mínimos).
     - `tv`: `rolsuper=false`, `rolcanlogin=false` (Rol legado inactivo, deshabilitado para login).
     - Roles restantes (`ronald`, `nxtv`, `tv_user`, `francisco`, `nx_tv`): Todos deshabilitados (`rolsuper=false`, `rolcanlogin=false`).
   - Se ejecutó la suite automatizada [tests/clean-bootstrap.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/clean-bootstrap.test.js), aprobando 8/8 pruebas:
     - Operaciones DML sobre tablas de negocio funcionando al 100%.
     - Lectura en `nexus_tv.users` permitida para autenticación.
     - Mutaciones en `users` denegadas con código PostgreSQL `42501`.
     - Operaciones DDL, `TRUNCATE` y `ALTER ROLE` denegadas.
     - Conexión a bases ajenas (`postgres`) denegada por revocación de `CONNECT FROM PUBLIC`.

### 15.2 Diferenciación Técnica entre Configuración Declarada y Contenedor Activo (AUD-008)

1. **Evidencia Técnica de Solo Lectura:**
   - **Contenedor en Ejecución (`tv-db`):**
     - `docker inspect tv-db --format '{{json .NetworkSettings.Ports}}'`:
       ```json
       {"5432/tcp":[{"HostIp":"0.0.0.0","HostPort":"25432"},{"HostIp":"::","HostPort":"25432"}]}
       ```
     - El contenedor activo continúa físicamente publicado en `0.0.0.0:25432` y `[::]:25432`, accesible desde cualquier interfaz de red externa.
   - **Configuración Declarada en Proyecto ([docker-compose.yml](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docker-compose.yml)):**
     - `docker compose config`:
       ```yaml
       ports:
         - mode: ingress
           host_ip: 127.0.0.1
           target: 5432
           published: "25432"
           protocol: tcp
       ```
     - El archivo de configuración restringe la vinculación a `127.0.0.1` de forma predeterminada mediante `${HOST_DB_BIND:-127.0.0.1}`.
2. **Causa de la Divergencia y Restricción Operativa:**
   - El contenedor `tv-db` fue creado hace más de 29 horas, con anterioridad a las modificaciones realizadas en el archivo Compose.
   - En cumplimiento estricto de las directivas de la misión, **no se recreó ni reinició el contenedor activo** para evitar cualquier riesgo de indisponibilidad o pérdida de datos en la base viva.
3. **Clasificación Oficial de AUD-008:**
   - No puede declararse corregido mientras el proceso Docker activo permanezca expuesto fuera de loopback.
   - Estado oficial: **Mitigado en configuración / Pendiente de intervención operativa en el entorno activo**.
4. **Procedimiento Operativo para Ventana de Mantenimiento:**

   #### 4.1 Procedimiento Controlado para AUD-001 (Aplicación de Roles en Volumen Activo)
   > [!IMPORTANT]
   > **Aclaración de Arquitectura de PostgreSQL:**
   > - Modificar `POSTGRES_USER` o `PG_APP_USER` en `docker-compose.yml` **NO crea ni modifica roles en un volumen PostgreSQL que ya ha sido inicializado** (`tv_gsi_tv_pgdata`).
   > - Los scripts en `/docker-entrypoint-initdb.d/` se ejecutan **exclusivamente durante el primer `initdb`** y **NO se vuelven a ejecutar automáticamente** al reiniciar o recrear un contenedor sobre un volumen persistente ya poblado.
   > - La aplicación del rol runtime `nexus_app` a la base de datos activa exige una intervención DBA controlada y separada.

   - **Paso 1 (Respaldo lógico preventivo):**
     ```powershell
     docker exec tv-db pg_dump -U tv -d nexus_tv -Fc > "backups/pre_roles_nexus_tv_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
     ```
   - **Paso 2 (Aplicación manual de rol runtime sobre la base activa):**
     ```powershell
     docker exec -i tv-db psql -U tv -d nexus_tv -f /docker-entrypoint-initdb.d/06_runtime_user.sql
     ```
     *(O ejecución dirigida de las sentencias DDL correspondientes para aprovisionar `nexus_app` y restringir roles legados sin corte destructivo).*
   - **Paso 3 (Verificación de privilegios en catálogo activo):**
     ```sql
     SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolname IN ('tv', 'nexus_app', 'postgres');
     ```
   - **Paso 4 (Conmutación de credenciales en backend):**
     - Actualizar variables `PG_USER=nexus_app` y `PG_PASSWORD` en `.env` de producción.
     - Recrear servicio backend: `docker compose up -d --no-deps backend`.
     - Verificar `/api/status` y logs de arranque.

   #### 4.2 Procedimiento Controlado para AUD-008 (Publicación de PostgreSQL en Loopback)
   > [!IMPORTANT]
   > - La publicación de PostgreSQL en loopback **solo puede marcarse como aplicada al entorno activo después de verificar `docker inspect` y la conectividad posterior**.
   > - Mientras no exista dicha evidencia física post-recreación, AUD-008 permanece pendiente en producción.

   - **Paso 1 (Respaldo preventivo):**
     ```powershell
     docker exec tv-db pg_dump -U tv -d nexus_tv -Fc > "backups/pre_bind_nexus_tv_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
     ```
   - **Paso 2 (Recreación no destructiva del servicio `db`):**
     ```powershell
     docker compose up -d --no-deps db
     ```
     *(Conserva intacto el volumen `tv_gsi_tv_pgdata` y reasigna los puertos del contenedor conforme a `HOST_DB_BIND=127.0.0.1`).*
   - **Paso 3 (Verificaciones post-mantenimiento obligatorias):**
     1. **Inspección de enlace:** `docker inspect tv-db --format '{{json .NetworkSettings.Ports}}'` debe reportar estrictamente `HostIp: "127.0.0.1"`.
     2. **Conectividad backend:** Comprobar que `tv-backend` sigue alcanzando `db:5432` a través de la red interna Docker `tv_network`.
     3. **Healthcheck de API:** Verificar `http://localhost:23002/api/status` (HTTP 200).
     4. **Verificación perimetral:** Comprobar desde un host externo en la LAN que el puerto `25432` no es accesible desde el exterior.

### 15.3 Estado Final Consolidado de la Auditoría tras Misión 2D

| ID | Hallazgo | Severidad | Estado Oficial Misión 2D | Justificación Técnica y Evidencia |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | **Mitigado en configuración / Corregido y verificado en QA aislado / Pendiente en producción** | Causa raíz remediada en `docker-compose.yml` (`POSTGRES_USER=postgres`, `PG_APP_USER=nexus_app`). Bootstrap limpio validado empíricamente en `nexus-qa-clean-bootstrap-val` con 8/8 pruebas exitosas. Rol `tv` queda deshabilitado (`NOLOGIN NOSUPERUSER`). Pendiente de aplicar migración de roles en base activa `tv-db` en ventana de mantenimiento DBA. |
| **AUD-002** | Heartbeat anónimo y manejo de errores | P1 | **Corregido y verificado** | Remediado en [tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/tv.js). Guardas estrictas de QA con marca de catálogo. 10 tests unitarios y 9 de integración PostgreSQL real aprobados (0 fallos). |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 | **Corregido y verificado en Docker/CI (Node 24 LTS) / Pendiente de verificación en host** | `source-map-js@1.2.2` fijado por `overrides` en `package.json`. `npm audit` a 0 vulnerabilidades. Compilación reproducible verificada en Docker Node 24 LTS. Pendiente de verificación en host Windows hasta actualización a Node >=22.12 / 24 LTS. |
| **AUD-004** | Upload sin allowlist de firma MIME | P2 | **Pendiente** | Fuera de alcance de Misión 2. |
| **AUD-005** | Entrega volátil en pairing sin ACK | P2 | **Pendiente** | Fuera de alcance de Misión 2. |
| **AUD-006** | Token en query string WebSocket | P2 | **Pendiente / Parcialmente mitigado** | Frontend web migrado a `auth: {}` y cabeceras `X-Device-Token`. El backend conserva soporte de query string por retrocompatibilidad con pantallas físicas; el riesgo en logs persiste para dichos dispositivos. |
| **AUD-007** | Directorio `/media/*` público | P2 | **Pendiente** | Sujeto a decisión y política de negocio. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | **Mitigado en configuración / Pendiente en producción** | `docker-compose.yml` restringe a `127.0.0.1` por defecto. `docker compose config` validado. Contenedor activo `tv-db` continúa físicamente en `0.0.0.0:25432` hasta recreación controlada en ventana de mantenimiento. |

### 15.4 Retest Final Consolidado tras Misión 2D

- **Pruebas Automatizadas Totales:** `npm test` ejecutó 103 pruebas (103 passed, 0 failed).
- **Auditoría de Dependencias:** `npm audit` reportó 0 vulnerabilidades.

---

## 16. Misión 3 — Remediación Controlada de AUD-004 y AUD-005 (2026-10-09)

**Fecha:** 2026-10-09  
**Responsable:** Senior Software, Security & QA Engineer  
**Objetivo:** Remediación integral, verificación de regresión y prueba determinista de AUD-004 (validación de archivos multimedia) y AUD-005 (entrega confiable de credenciales de pairing).

### 16.1 Remediaciones Implementadas
1. **AUD-004 (P2) — Validación Segura de Archivos Multimedia Subidos:**
   - Creación de [src/utils/mediaValidator.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/utils/mediaValidator.js):
     - Inspección estricta de *magic bytes* para JPEG, PNG, GIF, WebP, MP4, MOV, WebM, MKV.
     - Bloqueo preventivo de firmas binarias peligrosas: ejecutables Windows PE (`MZ...`), ejecutables Linux ELF (`\x7fELF`), scripts shell (`#!/`), PHP (`<?php`), archivos comprimidos (`PK\x03\x04`).
     - Rechazo estricto de SVG sin sanitizador para mitigar XSS.
     - Comprobación cruzada entre extensión, MIME declarado y tipo binario real.
     - Inspección determinista de duración mediante `ffprobe` (`probeVideoDuration`); rechazo inmediato ante streams corruptos.
     - Generación de nombres de archivo mediante UUID v4 (`crypto.randomUUID()`).
     - Compensación y eliminación física inmediata (*safeUnlink*) ante errores de validación, procesamiento o inserción en PostgreSQL (cero archivos huérfanos).
   - Refactorización de [src/routes/media.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/media.js).
   - **Pruebas Automatizadas:** [tests/media-upload.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/media-upload.test.js) con 9/9 pruebas aprobadas (PASS).

2. **AUD-005 (P2) — Entrega Confiable del Token de Emparejamiento:**
   - Refactorización de [src/services/pairingSessionManager.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/services/pairingSessionManager.js):
     - Eliminación total de `socket.volatile.emit`.
     - Implementación de `deliverWithConfirmation`: espera de confirmación dual (callback Socket.IO ACK y evento `tv:pairing_confirmed`).
     - Timeout acotado (`ackTimeoutMs`) y 1 reintento seguro e idempotente con la misma credencial.
     - Reversión transaccional en PostgreSQL (`rollback()`) y retorno a estado `pending` ante timeout, rechazo o desconexión antes de confirmar.
     - Rechazo estricto de confirmaciones procedentes de sockets ajenos o sesiones vencidas.
   - Refactorización de [frontend/src/components/TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx):
     - Confirmación emitida exclusivamente tras persistir exitosamente en `localStorage`.
     - Emisión de `tv:pairing_rejected` ante fallos de almacenamiento local.
     - Eliminación de tokens en claro en llamadas a `console.log`.
   - **Pruebas Automatizadas:** [tests/pairing-ack.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/pairing-ack.test.js) con 8/8 pruebas aprobadas (PASS) y [tests/pairing-session.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/pairing-session.test.js) (5/5 PASS).

### 16.2 Estado Consolidado Final de la Auditoría tras Misión 3

| ID | Hallazgo | Severidad | Estado Oficial Misión 3 | Justificación Técnica y Evidencia |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | **Mitigado en configuración / Corregido y verificado en QA aislado / Pendiente de intervención operativa en el entorno activo** | Procedimiento de ventana DBA documentado. `docker-compose.yml` corregido. Volumen poblado preexistente no se modifica automáticamente por compose ni re-ejecuta `/docker-entrypoint-initdb.d`. Pendiente de aplicación manual en activo. |
| **AUD-002** | Heartbeat anónimo y manejo de errores | P1 | **Corregido y verificado** | 19 tests unitarios y de integración PostgreSQL real aprobados (0 fallos). |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 | **Corregido y verificado en Docker/CI (Node 24 LTS) / Pendiente de verificación en host** | `source-map-js@1.2.2` fijado por `overrides`. `npm audit` a 0 vulnerabilidades. Compilación limpia en Node 24. |
| **AUD-004** | Upload sin allowlist de firma MIME | P2 | **Corregido y verificado** | Magic bytes, allowlist exhaustiva, ffprobe determinista y cero archivos huérfanos. 9/9 pruebas aprobadas en `tests/media-upload.test.js`. |
| **AUD-005** | Entrega volátil en pairing sin ACK | P2 | **Corregido y verificado** | Protocolo de confirmación explícita con rollback y reintento acotado. 8/8 pruebas aprobadas en `tests/pairing-ack.test.js`. |
| **AUD-006** | Token en query string WebSocket | P2 | **Mitigado en frontend / Pendiente de retiro en backend** | Frontend web transmite por `auth: {}` y cabeceras. Backend mantiene compatibilidad temporal con pantallas físicas legadas. |
| **AUD-007** | Directorio `/media/*` público | P2 | **Pendiente** | Sujeto a directiva de negocio y clasificación de contenidos. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | **Mitigado en configuración / Pendiente de intervención operativa en el entorno activo** | `docker-compose.yml` mapeado a `127.0.0.1`. Procedimiento de recreación no destructiva documentado. Contenedor activo permanece intacto en `0.0.0.0:25432` hasta ventana de mantenimiento. |

### 16.3 Retest Final Consolidado tras Misión 3

- **Pruebas Automatizadas Totales Backend (`npm test`):** **120 pasadas, 0 fallidas** (2.55 s).
- **Auditoría de Dependencias:** `npm audit` reporta **0 vulnerabilidades** en backend y **0 vulnerabilidades** en frontend.
- **Compilación y Lint Frontend (Docker Node 24 limpio):** Oxlint **0 errores**; Vite **build completado con éxito en 524ms**.
- **Higiene de Formato:** `git diff --check` reporta **0 advertencias y 0 errores**.
- **Control de Versiones y Base de Datos:** Cero commits, cero pushes, cero cambios de rama, cero modificaciones sobre la base o volúmenes de producción.

---

## 17. Misión 3B — Verificación Real de AUD-004 y AUD-005 (2026-10-10)

**Fecha:** 2026-10-10  
**Responsable:** Senior Software, Security & QA Engineer  
**Objetivo:** Verificación del comportamiento efectivo y reproducible de AUD-004 y AUD-005 sin mocks engañosos, sin alteración de contenedores activos ni commits.

### 17.1 Validación Multimedia Estructural y Binario ffprobe (AUD-004)
1. **Entorno ffprobe Efectivo:**
   - Verificado en el Dockerfile de backend (`RUN apk add --no-cache ffmpeg`).
   - El ejecutable `/usr/bin/ffprobe` está presente y operativo para el usuario `app` en el runtime del contenedor de producción.
   - En host Windows, donde `ffprobe` no está en PATH, la prueba de integración real `tests/media-real-ffprobe.test.js` se omite limpiamente (`test.skip`), mientras que en el contenedor Docker Node 24 oficial se ejecuta y aprueba contra un binario real y un contenedor MP4 H.264 real.
2. **Validación Estructural Más Allá de Magic Bytes:**
   - Se implementaron analizadores estructurales puros para imágenes:
     - **PNG:** Firma 8B, chunk `IHDR` con dimensiones válidas, descompresión zlib completa de chunks `IDAT` y presencia de `IEND` con validación de CRC32.
     - **JPEG:** Marcadores `SOI`, parsing de longitudes de segmentos, dimensiones `SOF0..2`, `SOS` y marcador de cierre `EOI`.
     - **GIF:** Cabeceras `GIF87a`/`GIF89a`, dimensiones, sub-bloques de datos y byte de cierre `0x3B`.
     - **WebP:** Contenedor RIFF, FourCC WEBP, tags `VP8`/`VP8L`/`VP8X` y dimensiones.
   - Archivos truncados tras la cabecera son rechazados inmediatamente (`HTTP 400`).
3. **Consistencia y Limpieza de Huérfanos:**
   - Errores de validación, timeouts o fallos de inserción eliminan el archivo temporal inmediatamente (`safeUnlink`), dejando cero archivos huérfanos.

### 17.2 Confirmación Durable, Tolerancia a Fallos y Recuperación de Pairing (AUD-005)
1. **Flujo de 6 Pasos:**
   - Paso 1: Generación de token y hash.
   - Paso 2: Registro transaccional en PostgreSQL con callback de compensación.
   - Paso 3: Entrega del token vía `command:assign_profile` con ACK de Socket.IO (timeout 3s, 1 reintento).
   - Paso 4: Almacenamiento local en cliente TV (`localStorage`).
   - Paso 5: Confirmación dual del cliente (callback ACK + evento `tv:pairing_confirmed`).
   - Paso 6: Actualización de estado en memoria a `bound` y notificación a consola admin (`admin:tv_bound`).
2. **Inyección de Fallos Aprobada:**
   - Error de DB post-ACK o pre-confirmación: revierte con compensación (`rollback()`) y no declara la pantalla vinculada.
   - Fallo en compensación de rollback protegido con `try/catch` para evitar estados huérfanos en `binding`.
   - Desconexión antes o después de la entrega: cancelación por timeout e invalidación segura.
   - Rechazo de persistencia local en TV: emite `tv:pairing_rejected`, ejecutando rollback en DB.
   - ACKs duplicados, tardíos o emitidos por sockets ajenos: rechazados estrictamente.
3. **Recuperación Coherente (Self-Healing de Pantalla):**
   - Si la TV conserva un token en `localStorage` pero PostgreSQL no tiene el hash (por rollback o desincronización), el endpoint de heartbeat responde `401 Unauthorized` o el handshake de socket falla.
   - `TVPlayer.jsx` captura el error 401, elimina el token huérfano de `localStorage` y regresa automáticamente al modo de espera con generación de un nuevo PIN (`#XXXX`).

### 17.3 Estado Consolidado Final de la Auditoría tras Misión 3B

| ID | Hallazgo | Severidad | Estado Oficial Misión 3B | Justificación Técnica y Evidencia |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | **Mitigado en configuración / Corregido y verificado en QA aislado / Pendiente de intervención operativa en el entorno activo** | Arquitectura y script de migración `06_runtime_user.sql` validados con 8/8 pruebas en `nexus-qa-clean-bootstrap-val`. La base activa `tv-db` no fue alterada para salvaguardar la disponibilidad del entorno de producción. |
| **AUD-002** | Heartbeat anónimo y manejo de errores | P1 | **Corregido y verificado** | Validado con 19 tests unitarios y de integración con PostgreSQL real. |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 | **Corregido y verificado en Docker/CI (Node 24 LTS)** | `source-map-js@1.2.2` fijado; `npm audit` a 0 vulnerabilidades en backend y frontend. Compilación y lint limpios. |
| **AUD-004** | Upload sin allowlist de firma MIME ni integridad de contenido | P2 | **Corregido y verificado** | Analizadores estructurales completos (PNG zlib, JPEG marcadores, GIF bloques, WebP chunks), ffprobe real verificado en runtime de contenedor, timeout acotado (5s) y cero archivos huérfanos. 12/12 tests de upload aprobados y prueba con binario real aprobada. |
| **AUD-005** | Entrega volátil en pairing sin ACK | P2 | **Corregido y verificado** | Protocolo en 6 pasos con confirmación dual, rollback transaccional protegido ante fallos de DB, auto-sanación en frontend por 401 y 14/14 tests deterministas aprobados. |
| **AUD-006** | Token en query string WebSocket | P2 | **Mitigado en frontend / Pendiente de retiro en backend** | Frontend web transmite por `auth: {}` y cabeceras. Backend mantiene compatibilidad temporal con pantallas físicas legadas. |
| **AUD-007** | Directorio `/media/*` público | P2 | **Pendiente** | Sujeto a directiva de negocio y clasificación de contenidos. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | **Mitigado en configuración / Pendiente de intervención operativa en el entorno activo** | `docker-compose.yml` mapeado a `127.0.0.1`. Procedimiento de recreación no destructiva documentado. Contenedor activo permanece intacto en `0.0.0.0:25432` hasta ventana de mantenimiento. |

### 17.4 Retest Final Consolidado tras Misión 3B

- **Pruebas Automatizadas Totales Backend (`npm test`):** **130 pasadas, 0 fallidas** en contenedor Docker Node 24 con PostgreSQL QA y `/usr/bin/ffprobe` real (2.74 s). En host: 129 pasadas, 1 omitida limpiamente (por ausencia de binario ffprobe local).
- **Auditoría de Dependencias:** `npm audit` reporta **0 vulnerabilidades** en backend y **0 vulnerabilidades** en frontend.
- **Compilación y Lint Frontend:** Oxlint **0 errores**; Vite **build completado con éxito en 907ms** (126 módulos).
- **Higiene de Formato:** `git diff --check` reporta **0 advertencias y 0 errores**.
- **Control de Versiones y Base de Datos:** Cero commits, cero pushes, cero ramas modificadas, cero escrituras sobre los contenedores o volúmenes de producción.

---

## 18. Misión 3C — Validación Definitiva de Multimedia, Recuperación de Pairing y Reproducibilidad (2026-10-10)

**Fecha:** 2026-10-10  
**Responsable:** Senior Software, Security & QA Engineer  
**Objetivo:** Resolver formalmente las incertidumbres restantes de MISIÓN 3B, diferenciar taxativamente la validación estructural de la decodificación real de contenido multimedia (AUD-004), verificar la resiliencia y recuperación determinista del flujo de pairing (AUD-005) y certificar la reproducibilidad integral en entorno limpio.

### 18.1 Verificación de Decodificación Real vs. Validación Estructural (AUD-004)

1. **Diferenciación Técnica Rigurosa:**
   - **Estructural Puro:** Comprobación de firmas mágicas (*magic bytes*), dimensiones en cabeceras de contenedor, límites de chunks y marcadores de delimitación.
   - **Decodificación de Flujo / Contenido Real:**
     - **PNG:** Descompresión zlib completa del stream IDAT, verificación de filtros de scanlines y concordancia con dimensiones reales.
     - **GIF:** Decodificación real del stream LZW (`validateGifLzw`) con reconstrucción dinámica del diccionario de códigos y descompresión de bloques de píxeles.
     - **JPEG:** Detección de marcadores y escaneo de entropía. Además, integración con el decodificador nativo FFmpeg utilizando `-err_detect explode -xerror -v error` para abortar inmediatamente ante corrupción interna de macrobloques o datos de escaneo.
     - **WebP:** Verificación de contenedores RIFF/WEBP, chunks VP8/VP8L/VP8X y validación de payload de compresión.
     - **Vídeo (MP4, WebM, MOV, MKV):** Detección de átomos contenedores con `ffprobe` y decodificación obligatoria de paquetes de vídeo mediante `decodeVideoSample` (FFmpeg con argumentos separados en `cp.execFile`, `-err_detect explode`, muestreo de 2 segundos, timeout estricto de 5000 ms y buffer acotado a 1 MB).
2. **Defensa ante Archivos Corruptos y Huérfanos:**
   - Archivos con firma válida pero IDAT corrupto, LZW malformado o streams de vídeo incompletos son rechazados de inmediato.
   - Todo archivo rechazado es eliminado del disco mediante `safeUnlink` antes de responder al cliente; no se genera registro en base de datos ni quedan archivos huérfanos.

### 18.2 Máquina de Estados Real de Pairing y Protocolo de Recuperación (AUD-005)

1. **Modelo de Consistencia:**
   - Se rectifica formalmente la nomenclatura: el proceso **no es una transacción atómica** (abarca PostgreSQL, sockets en red y almacenamiento `localStorage` del cliente web). Es un protocolo de **confirmación en 7 pasos con compensación y auto-sanación**:
     1. `POST /api/admin/tvs/bind-session`: Admin inicia vinculación.
     2. Servidor genera token criptográfico aleatorio de alta entropía (`crypto.randomBytes(32)`).
     3. Servidor persiste el hash SHA-256 en PostgreSQL dentro de una transacción con función de compensación (`rollback`).
     4. Servidor entrega la credencial en texto claro al socket conectado de la pantalla.
     5. Pantalla almacena el token en su almacenamiento local (`localStorage`).
     6. Pantalla emite confirmación explícita `tv:pairing_confirmed` al servidor (o `tv:pairing_rejected` si falló el guardado local).
     7. Servidor confirma la sesión como completada y notifica `admin:tv_bound`.
2. **Resiliencia ante Inyecciones de Fallos:**
   - **Caída de PostgreSQL previa:** Sesión rechazada limpiamente, sin token emitido.
   - **Desconexión previa a entrega:** Se detecta socket inactivo, se ejecuta compensación (rollback de hash en DB) y se reabre la sesión.
   - **Fallo de almacenamiento local:** TV emite `tv:pairing_rejected`; servidor ejecuta compensación en DB.
   - **Desconexión antes del ACK:** Servidor agota timeout (10s), ejecuta compensación en DB y marca sesión fallida.
   - **Fallo del propio rollback:** Si PostgreSQL se torna inaccesible durante la compensación, el servidor atrapa el error de forma segura, evitando crash del proceso y reseteando el estado en memoria fuera de `binding`.
   - **Auto-sanación de Pantalla (Token Huérfano):** Si la pantalla retiene un token cuyo hash no existe o fue revertido en PostgreSQL, en la siguiente petición HTTP `/api/tv/heartbeat` o reconexión Socket.IO, el servidor rechaza con `401 Unauthorized`. `TVPlayer.jsx` intercepta el 401, elimina el token huérfano de `localStorage` y transiciona de forma determinista al modo PIN.
   - **Idempotencia y Aislamiento:** ACKs tardíos o duplicados son descartados sin efectos secundarios; confirmaciones procedentes de sockets ajenos son rechazadas de inmediato.

### 18.3 Reproducibilidad en Entorno Limpio (Docker Node 24 Alpine)

1. **Procedimiento de Aislamiento:**
   - Copia de código fuente realizada a directorio temporal independiente, excluyendo taxativamente `.git`, `node_modules`, `frontend/node_modules` y directorios `dist`.
   - Instalación limpia con `npm ci` ejecutada íntegramente dentro del contenedor `node:24-alpine` con binarios nativos Linux de FFmpeg y netcat.
2. **Resultados de Verificación:**
   - **Backend Tests:** **136 pruebas ejecutadas, 136 aprobadas (100%), 0 fallidas, 0 omitidas.**
     - 15/15 pruebas de upload (`tests/media-upload.test.js`) con fixtures válidos, corruptos, truncados y limpieza.
     - 16/16 pruebas de handshake y ACK (`tests/pairing-ack.test.js`) con inyección de fallos, rollback y recuperación por 401.
     - 2/2 pruebas reales de binario (`tests/media-real-ffprobe.test.js`) con `ffprobe` y decodificador real `ffmpeg` ejecutadas con éxito.
     - 19/19 pruebas de heartbeat (`tests/tv-heartbeat.test.js` y `tests/tv-heartbeat-pg.test.js`) contra PostgreSQL QA (`nexus-qa-isolated-db`).
   - **Frontend:** `oxlint` completado con 0 errores; `vite build` completado con éxito (126 módulos); `npm audit` 0 vulnerabilidades.
   - **Higiene:** `git diff --check` limpio (0 advertencias). Cero commits, cero cambios en base de datos activa.

### 18.4 Estado Oficial Consolidado de la Auditoría tras Misión 3C

| ID | Hallazgo | Severidad | Estado Oficial Misión 3C | Justificación Técnica y Evidencia |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | **Mitigado en configuración / Corregido y verificado en QA aislado / Pendiente de intervención operativa en el entorno activo** | Arquitectura y script `06_runtime_user.sql` validados con 8/8 pruebas en `nexus-qa-clean-bootstrap-val`. La base activa `tv-db` no fue alterada para salvaguardar la producción. |
| **AUD-002** | Heartbeat anónimo y manejo de errores | P1 | **Corregido y verificado** | Validado con 19 tests unitarios y de integración con PostgreSQL QA real. |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 | **Corregido y verificado en Docker/CI (Node 24 LTS)** | `source-map-js@1.2.2` fijado por `overrides`; `npm audit` a 0 vulnerabilidades. Compilación y lint limpios. |
| **AUD-004** | Upload sin allowlist de firma MIME ni integridad de contenido | P2 | **Corregido y verificado** | Validación multinivel: estructural en memoria (PNG zlib/scanlines, GIF LZW, JPEG marcadores, WebP chunks) y decodificación de flujo real con FFmpeg (`-err_detect explode`). 15/15 tests de upload aprobados y tests con binarios reales `ffprobe` + `ffmpeg` aprobados en Node 24. Cero archivos huérfanos. |
| **AUD-005** | Entrega volátil en pairing sin ACK | P2 | **Corregido y verificado** | Protocolo de 7 pasos con compensación/rollback protegida ante caídas de DB, confirmación explícita del cliente y rutina de auto-sanación por 401 en frontend. 16/16 tests de pairing y ACK aprobados. |
| **AUD-006** | Token en query string WebSocket | P2 | **Mitigado en frontend / Pendiente de retiro en backend** | Frontend web transmite exclusivamente por `auth: {}` y cabeceras `X-Device-Token`. Backend mantiene compatibilidad temporal por query string para pantallas físicas legadas existentes. |
| **AUD-007** | Directorio `/media/*` público | P2 | **Pendiente** | Sujeto a directiva de negocio y clasificación de contenidos. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | **Mitigado en configuración / Pendiente de intervención operativa en el entorno activo** | `docker-compose.yml` mapeado a `127.0.0.1`. Contenedor activo permanece intacto en `0.0.0.0:25432` hasta ventana de mantenimiento autorizada. |

---

## 19. Misión 3D — Cierre Controlado de AUD-004 y AUD-005 (2026-10-10)

**Fecha:** 2026-10-10  
**Responsable:** Senior Software, Security & QA Engineer  
**Objetivo:** Verificación real exhaustiva de formatos multimedia admitidos (WebP, vídeo), delimitación de compromisos de rendimiento y DoS, e implementación de persistencia transaccional diferida en dos fases para resolver de forma definitiva inconsistencias de compensación en pairing (AUD-004 y AUD-005).

### 19.1 Verificación de WebP y Límites de Vídeo (AUD-004)
- **Decodificación Real de WebP:** Incorporación de FFmpeg (`decodeMediaContent`) con `-err_detect explode -xerror -v error` en la ruta `/api/tv-content/upload`. Fixtures sintéticos (WebP válido decodificado, WebP con payload VP8 corrupto rechazado con código 183, WebP truncado rechazado, ruta HTTP responde 400 y limpia archivo de disco).
- **Límites de Vídeo:** Análisis deliberado de 2 segundos mediante `decodeVideoSample` (`-t 2 -err_detect explode`) documentado como compromiso formal entre integridad determinista del stream y protección contra denegación de servicio (DoS) por sobrecarga de CPU en el hilo de subida HTTP.

### 19.2 Consistencia Persistente de Pairing ante Fallo de Rollback (AUD-005)
- **Commit Diferido a la Confirmación del Cliente:** `performBinding` en [src/routes/admin.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/admin.js) retiene la transacción en PostgreSQL y la confirma a disco (`COMMIT`) únicamente tras recibir el ACK explícito de la pantalla (`tv:pairing_confirmed`).
- Si la entrega falla o expira, se ejecuta `ROLLBACK`. Si el socket o el servidor se desconectan, PostgreSQL aborta automáticamente la transacción no confirmada, garantizando que jamás quede un token huérfano en disco.
- Si la compensación reporta fallo, la sesión transiciona a `status = 'failed'` (`rollbackFailed: true`), nunca a `pending`.
- Reconciliación determinista probada mediante `AUD-005.17`.

### 19.3 Estado Oficial Consolidado de la Auditoría tras Misión 3D

| ID | Hallazgo | Severidad | Estado Oficial Misión 3D | Justificación Técnica y Evidencia Concluyente |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | **Mitigado en configuración / Corregido y verificado en QA aislado / Pendiente en producción activa** | Script `06_runtime_user.sql` validado (8/8 tests). Producción `tv-db` preservada intacta por disponibilidad. |
| **AUD-002** | Heartbeat anónimo y manejo de errores | P1 | **Corregido y verificado** | Validado con 19 tests unitarios y de integración con PostgreSQL QA real. |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 | **Corregido y verificado en Docker/CI (Node 24 LTS)** | `source-map-js@1.2.2` fijado por `overrides`; `npm audit` a 0 vulnerabilidades. |
| **AUD-004** | Upload sin allowlist de firma MIME ni integridad de contenido | P2 | **Corregido y verificado** | Validación multinivel: estructural en memoria (PNG zlib, GIF LZW, JPEG marcadores, WebP chunks) y decodificación real con FFmpeg (`-err_detect explode`) para JPEG, WebP y vídeo. Cero archivos huérfanos. 18/18 pruebas aprobadas. |
| **AUD-005** | Entrega volátil en pairing sin ACK | P2 | **Corregido y verificado** | Transacción en dos fases con commit diferido a confirmación de cliente, compensación protegida ante fallos de DB, estado persistente de error y auto-sanación por 401. 17/17 pruebas aprobadas. |
| **AUD-006** | Token en query string WebSocket | P2 | **Mitigado en frontend / Pendiente de retiro en backend** | Frontend web transmite por `auth: {}` y cabeceras `X-Device-Token`. Backend mantiene compatibilidad temporal por query string para pantallas físicas legadas existentes. |
| **AUD-007** | Directorio `/media/*` público | P2 | **Pendiente** | Sujeto a directivas de negocio para clasificación de recursos. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | **Mitigado en configuración / Pendiente en producción activa** | `docker-compose.yml` mapeado a `127.0.0.1`. Contenedor activo permanece intacto en `0.0.0.0:25432` hasta ventana de mantenimiento. |

---

## 20. Misión 3E — Pairing sin Transacciones de Larga Duración (2026-10-10)

- Eliminada la retención de transacciones abiertas en PostgreSQL durante la espera del ACK del cliente de hasta 10 segundos.
- Introducida la migración `migrations/07_pending_pairings.sql` y arquitectura de dos transacciones cortas independientes: Transacción 1 registra el estado pendiente y confirma de inmediato; Transacción 2 promueve el token a activo en `nexus_tv.tv_screens` tras el ACK de la pantalla.
- Verificación empírica de no-bloqueo: heartbeats concurrentes de la misma pantalla u otras pantallas se ejecutan concurrentemente en ~96-115ms durante la espera del ACK sin experimentar bloqueos por bloqueo de fila (`FOR UPDATE`).

---

## 21. Misión 3F — Integridad de Auditoría, Ciclo de Vida de `pending_pairings` y Aceptación Final (2026-10-10)

**Fecha:** 2026-10-10  
**Evaluador:** Senior Security, Database & QA Engineer  
**Objetivo:** Restaurar la integridad estricta de la matriz original de hallazgos (AUD-001 a AUD-008), validar el ciclo de vida de `nexus_tv.pending_pairings` en instalación limpia sin datos heredados, eliminar el fallback en memoria no persistente con respuesta fail-safe HTTP 503, implementar la reconciliación automatizada periódica y verificar la ausencia de regresiones.

### 21.1 Matriz Oficial y Definitiva de Hallazgos

| ID | Definición Original del Hallazgo | Criticidad | Estado Oficial Verificado | Justificación Técnica y Evidencia Concluyente |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 Crítica | **Pendiente de intervención operativa en base activa** *(Mitigado en configuración y validado en QA)* | Separación formal bootstrap (`postgres`) vs. runtime (`nexus_app` no-superuser) en `06_runtime_user.sql` y `docker-compose.yml`. Validado empíricamente en contenedor QA limpio (puertos 25498 y 25496). Base de producción `tv-db` preservada intacta por disponibilidad. Requiere ventana DBA. |
| **AUD-002** | Heartbeat y autenticación de pantallas | P1 Crítica | **Corregido y Verificado** | Autenticación criptográfica obligatoria vía token/hash SHA-256 en cabeceras HTTP y WebSocket. Rechazo 401 para hashes nulos, tokens incorrectos o pantallas ajenas (`tv-heartbeat.test.js` y `tv-heartbeat-integration.test.js`). |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 Crítica | **Corregido y Verificado en Docker/CI (Node 24 LTS)** | `source-map-js@1.2.2` fijado por `overrides` en `package.json`; `npm audit` reporta 0 vulnerabilidades. *(Nota: el control de RBAC granular en rutas administrativas se evaluó y validó de forma independiente en `rbac-authorization.test.js`, sin apropiarse de este ID)*. |
| **AUD-004** | Validación de archivos multimedia | P2 Alta | **Corregido y Verificado** | Validación estricta multi-nivel (firmas binarias + decodificación real con FFmpeg/FFprobe `-err_detect explode -xerror -v error`). Rechazo de archivos corruptos, eliminación de huérfanos y límite acotado de decodificación a 2 segundos para protección anti-DoS (`media-upload.test.js` y `media-real-ffprobe.test.js`). |
| **AUD-005** | Entrega y consistencia del emparejamiento | P2 Alta | **Corregido y Verificado** | Transacciones cortas con persistencia durable en `nexus_tv.pending_pairings` y confirmación explícita (ACK). Reconciliación automática periódica cada 1 minuto y al arranque, y respuesta fail-safe HTTP 503 ante ausencia de esquema (`pairing-ack.test.js`: 28/28 tests PASS). |
| **AUD-006** | Token de dispositivo en la query string de Socket.IO | P2 Media | **Mitigado en código / Pendiente de verificación de campo** | Rechazo por defecto (`ALLOW_QUERY_DEVICE_TOKEN=false`), fallback explícito y observación del canal obsoleto **sin aceptarlo** (`OBSERVE_QUERY_DEVICE_TOKEN`). Riesgo residual en access logs de Nginx demostrado y mitigación preparada (no desplegada). Abierto hasta comprobar hardware físico en campo y verificar la configuración de logging desplegada (ver §24 y DEV-RUN-004). |
| **AUD-007** | Acceso público a recursos multimedia (`/media/*`) | P2 Media | **Corregido en código / Pendiente de verificación de despliegue** | Implementada Opción B (URLs firmadas temporales HMAC-SHA256). Endpoints de autorización para TV (`/playback-url`) y Admin (`/preview-url`), middleware de validación HMAC en `/media/*`, logging seguro sin query string. Requiere provisioning `MEDIA_URL_SIGNING_KEY` y despliegue de `frontend/nginx.conf` actualizado en ventana operativa. Ver §25. |
| **AUD-008** | Publicación del puerto PostgreSQL fuera de loopback | P2 Operacional | **Pendiente de aplicación efectiva** *(Mitigado en configuración declarada)* | `docker-compose.yml` restringe el puerto a `127.0.0.1:25432`. El contenedor activo `tv-db` continúa publicando físicamente en `0.0.0.0:25432` hasta recreación controlada en ventana de mantenimiento. |

### 21.2 Validación de Instalación Limpia y Ciclo de Vida de `pending_pairings`
- **Orden de Migraciones:** En contenedor QA efímero (`nexus-qa-clean-07-val` en puerto `25496`) y en contenedor de clean bootstrap (`nexus-qa-clean-bootstrap-val` en puerto `25498`), las migraciones 01 a 07 se ejecutaron secuencialmente sin errores bajo `/docker-entrypoint-initdb.d` sin bloques `COPY` de producción.
- **Mínimo Privilegio:** `nexus_app` opera con `rolsuper = false`, posee permisos completos de DML sobre `nexus_tv.pending_pairings` (`INSERT`, `SELECT ... FOR UPDATE`, `UPDATE`, `DELETE`) y uso de secuencia, pero tiene estrictamente denegadas las operaciones administrativas (`TRUNCATE`, `ALTER TABLE`, `ALTER ROLE`) con código `42501`.
- **Fail-Safe sin Esquema:** Eliminado el fallback en memoria. Si falta la tabla `pending_pairings` (código `42P01`), el servidor aborta de forma segura con HTTP 503 (`PAIRING_SCHEMA_NOT_MIGRATED`) sin entregar credenciales a la pantalla.
- **Reconciliación Automatizada:** Programada cada 1 minuto (`* * * * *`) y al arranque en `src/services/cron.js`. Idempotente, no invalida credenciales activas y garantiza aislamiento entre sesiones concurrentes.
- **Resultados de Ejecución Real:**
  - `tests/pairing-ack.test.js`: **28 tests, 28 pass, 0 fail**.
  - `tests/clean-bootstrap.test.js`: **11 tests, 11 pass, 0 fail**.
  - Suite completa de backend (Docker Node 24 Alpine con FFmpeg): **151 tests, 151 pass (100%), 0 fail, 0 skipped**.
  - Frontend (Docker Node 24 Alpine): `oxlint` 0 errores, `vite build` 126 módulos compilados en 875ms, `npm audit` 0 vulnerabilidades.

---

## 22. Misión 4A — Remediación AUD-006 y Análisis de Política para AUD-007 (2026-10-10)

### 22.1 Inventario de Clientes Socket.IO y Canales de Autenticación
- **Evidencia en Código:**
  - `frontend/src/components/TVPlayer.jsx`: Cliente TV web oficial en React. Conecta exclusivamente vía `auth: { tv_uuid, device_token }` sobre el namespace `/control`. No envía credenciales en query string (`query: {}`).
  - `frontend/src/utils/waitingPairingSocket.js`: Conexión de TV no vinculada para PIN pairing. Envía `auth: { session_code, waiting_pairing: 'true' }` (sin `device_token`).
  - `frontend/src/components/admin/TVControl.jsx`: Consola administrativa. Conecta vía `auth: { token }` (JWT RBAC).
  - Scripts Kiosk (`start-tv-kiosk.ps1`, `start-tv-kiosk.cmd`): Invocan Chromium/Edge apuntando a `/tv`. La SPA lee el token de `localStorage` y lo transmite vía `auth`.
  - Scripts de QA (`scripts/test_pairing_lifecycle.cjs`): Conecta vía `auth: { tv_uuid, device_token }`.
  - Suites de Test (`tests/device-auth.test.js`, `tests/pairing-ack.test.js`): Conectan vía `auth: { ... }`.
- **Dispositivos Físicos (Smart TVs):**
  - No existe evidencia en el repositorio de firmware de Smart TVs físicas que utilicen implementaciones Socket.IO propietarias acopladas a query strings. Sin embargo, para evitar cualquier fallo operacional en despliegues con hardware no inventariable, se introdujo una opción de compatibilidad explícita y auditable.

### 22.2 Remediación Segura de AUD-006 (`src/sockets/index.js`)
- **Predeterminado Seguro:** `ALLOW_QUERY_DEVICE_TOKEN=false` (predeterminado en código y documentado en `.env.example`).
- **Rechazo Inmediato:** Cualquier cliente que envíe `device_token` en `socket.handshake.query` cuando la bandera está desactivada es rechazado con: `TV authentication failed: device_token in query string is rejected. Use handshake auth or x-device-token header`.
- **Mecanismos Autorizados:** Se admiten `socket.handshake.auth.device_token` y la cabecera HTTP `socket.handshake.headers['x-device-token']`.
- **Opción de Compatibilidad Controlada:** Con `ALLOW_QUERY_DEVICE_TOKEN=true` (o `opts.allowQueryDeviceToken = true`), el servidor admite la credencial en query string como fallback temporal, emitiendo una advertencia de obsolescencia que registra únicamente el identificador de la pantalla (`tv_uuid`), **nunca el valor secreto del token**.
- **Cero Filtrado de Secretos:** Los logs, advertencias, métricas y mensajes de error no contienen valores completos de credenciales en ningún caso.
- **Validación Criptográfica:** Incluso con fallback activo, tokens inválidos, malformados o cruzados entre pantallas continúan siendo rechazados con tiempo constante (`verifyDeviceToken`).

### 22.3 Análisis Arquitectónico y Comparativa de Alternativas para AUD-007 (`/media/*`)
- **Estado Actual:** Nginx y Express publican `/media/*` de forma estática y pública (`Cache-Control: no-store, no-cache`). Los nombres de archivo se generan con `crypto.randomUUID()` (128 bits de entropía CSPRNG). El catálogo de contenidos y la playlist (`GET /api/tv/playlist`) están estrictamente autenticados con `X-Device-Token`.
- **Evaluación de Alternativas:**
  1. **Opción A — Recursos Públicos por Diseño:**
     - *Concepto:* Contenidos de señalización corporativa accesibles públicamente con URLs no enumerables.
     - *Ventajas:* Compatibilidad absoluta con Smart TVs físicas, soporte nativo de streaming y peticiones HTTP de rango (`Range: bytes`), cero consumo extra de memoria RAM, compatibilidad con CDN edge caching.
     - *Desventajas:* Cualquier usuario que obtenga la URL puede descargar el recurso hasta su eliminación.
  2. **Opción B — URLs Firmadas Temporales (Recomendación Técnica si se exige privacidad):**
     - *Concepto:* La API autenticada decora dinámicamente las URLs con un HMAC temporal (`/media/<uuid>.mp4?token=<hmac>&expires=<ts>`). Nginx o Express validan la firma.
     - *Ventajas:* Cero cambios en el esquema de base de datos (`nexus_tv.content.source_url` almacena rutas limpias). Totalmente compatible con reproductores HTML5 (`<video src="...">`), streaming nativo con peticiones de rango, sin bloat de memoria.
     - *Desventajas:* Exige sincronización de reloj y caducidad coordinada con el ciclo de refresco de la playlist (p. ej. 12-24 horas).
  3. **Opción C — Acceso Autenticado por Dispositivo (Headers/Blob o Cookies):**
     - *Concepto:* Exigir token o cookie de pantalla para cada petición GET de medios.
     - *Desventajas Críticas:* Las etiquetas HTML5 `<video>` no admiten cabeceras personalizadas. Descargar vídeos de 500MB en memoria mediante `fetch() -> blob` causa desbordamiento de memoria (OOM) en Smart TVs con 1-2GB de RAM y destruye el streaming progresivo. Las cookies en navegadores Kiosk sufren problemas de aislamiento y persistencia.
- **Recomendación:** Mantener la publicación actual intacta por el momento. Si Producto clasifica los contenidos como confidenciales, implementar **Opción B (URLs firmadas temporales con HMAC)**. Mantener AUD-007 como **Pendiente de Decisión de Negocio**.

### 22.4 Resultados de Pruebas y Validación Real
- **Pruebas Específicas AUD-006 (`tests/device-auth.test.js`):** **25 pruebas, 25 pass (100%), 0 fail**.
  - Test 21: Autenticación por cabecera HTTP `x-device-token` aceptada.
  - Test 22: Rechazo por defecto de token en query string (`ALLOW_QUERY_DEVICE_TOKEN=false`).
  - Test 23: Fallback explícito (`allowQueryDeviceToken=true`) aceptado con advertencia censurada.
  - Test 24: Rechazo invariable de tokens inválidos o cruzados bajo fallback activo.
  - Test 25: Auditoría de logs y mensajes de error sin filtración de tokens en texto claro.
- **Suite Completa Backend en Host:** **156 pruebas, 153 pass, 0 fail, 3 skipped** (los 3 tests dependientes de binario FFmpeg en host).
- **Suite Completa en Contenedor Limpio Docker Node 24 Alpine con FFmpeg:** **151 pruebas, 151 pass (100%), 0 fail, 0 skipped**.
- **Frontend:** `oxlint` 0 errores, `vite build` compila 126 módulos en 884ms, `npm audit` 0 vulnerabilidades.
- **Integridad:** Cero commits, cero pushes, cero mutaciones a la base de producción `tv-db` (puerto 25432).

---

## 23. Misión 4B — Revisión independiente y plan de transición AUD-006 / AUD-007 (2026-10-10)

**Tipo:** revisión adversarial focalizada, no repetición de la auditoría completa.  
**Informe de detalle:** [MISSION-4B-VERIFICATION-REPORT-2026-10-10](./MISSION-4B-VERIFICATION-REPORT-2026-10-10.md).

### 23.1 Revisión adversarial de AUD-006 (resultado)

| # | Verificación requerida | Resultado |
|---|---|---|
| 1 | El valor predeterminado rechaza `device_token` en query string | **Cumple.** `ALLOW_QUERY_DEVICE_TOKEN` por defecto `false`; el handshake rechaza con error explícito. |
| 2 | El fallback solo se habilita por configuración explícita | **Cumple.** `opts.allowQueryDeviceToken` o `ALLOW_QUERY_DEVICE_TOKEN === 'true'`. Añadido test 27 (opción explícita `false` prevalece sobre entorno). |
| 3 | Los mecanismos permitidos validan el token contra la pantalla correcta | **Cumple.** `auth.device_token` y `x-device-token` se verifican con `verifyDeviceToken` contra el hash del `tv_uuid` consultado. |
| 4 | Tokens completos no aparecen en logs, errores ni métricas | **Cumple en el código revisado.** Sin logger de URL en la app; la advertencia solo imprime `tv_uuid`; los errores no incluyen el valor. |
| 5 | Las pruebas distinguen fallback activado/desactivado | **Cumple.** Tests 22–27. |
| 6 | No se declara compatibilidad con hardware físico sin evidencia | **Cumple.** Los informes describen los clientes de código como compatibles y mantienen explícita la incertidumbre sobre pantallas físicas. |

**Defecto confirmado y corregido (menor, telemetría AUD-006):** la advertencia de deprecación solo se emitía cuando el cliente **no** enviaba además `auth`/header. Un cliente transitorio que enviara ambos canales quedaba invisible al inventario de retirada. Se corrigió en `src/sockets/index.js` para advertir siempre que exista `query.device_token` con el fallback habilitado, sin registrar el token. Evidencia: test 26 (nuevo).

**Riesgo residual señalado (no corregido):** el rechazo por defecto ocurre en el middleware de Socket.IO, pero si un cliente legacy envía `?device_token=...`, la URL del handshake puede quedar registrada por *access logs* de Nginx/proxies **antes** del rechazo. El valor predeterminado seguro no evita ese registro en origen. Mitigarlo exige revisar la política de logging del proxy (fuera del alcance de 4B; no se modificó `nginx.conf`).

### 23.2 Plan de retirada de AUD-006

Creado [DEV-RUN-004 — Retirada segura del fallback `device_token` en query string](../../07-operations/runbooks/DEV-RUN-004-aud006-query-token-retirement.md): inventario de clientes, verificación de versiones, telemetría sin secretos, criterios de retirada y rollback. **No se ejecutó ninguna ventana de monitorización de campo**; no se declara uso/no uso comprobado.

### 23.3 Registro de decisión AUD-007

Creado [ADR-006 — Política de acceso a recursos multimedia (`/media/*`)](../../01-architecture/decisions/ADR-006-media-access-policy.md), comparando recursos públicos por diseño, URLs firmadas temporales (HMAC) y acceso autorizado por dispositivo frente a `TVPlayer`, HTML5, `Range`, caché, revocación, expiración, pantallas físicas y complejidad. **Estado: pendiente de decisión de producto.** No se modificaron `nginx.conf`, rutas de medios ni la autorización efectiva de `/media/*`.

### 23.4 Pruebas ejecutadas en Misión 4B

- `tests/device-auth.test.js`: **27/27 PASS** (incluye tests 26 y 27 nuevos).
- Subconjunto de regresión **sin dependencia de PostgreSQL**: 10 archivos, **96/96 PASS, 0 fail, 0 skipped** (unitarias/mocks, no integración real).
- `node --check src/sockets/index.js` y `tests/device-auth.test.js`: OK.
- `git diff --check`: limpio.
- **No re-ejecutadas** las suites de integración contra el PostgreSQL QA (`pairing-ack`, `qa-least-privilege`, `tv-heartbeat-integration`, `clean-bootstrap`): el cambio se limita a la rama de advertencia de telemetría y no afecta a pairing/DB; se evita escribir en el entorno de datos.

### 23.5 Estado consolidado vigente (sustituye filas anteriores)

| Hallazgo | Severidad | Estado oficial vigente | Observación |
|---|---|---|---|
| **AUD-006** | P2 | **Mitigado en código / Pendiente de verificación de campo** | Rechazo por defecto + fallback explícito + telemetría corregida. Abierto hasta comprobar hardware físico en campo (DEV-RUN-004). |
| **AUD-007** | P2 | **Pendiente** | A la espera de decisión de producto (ADR-006). Sin cambios en la política efectiva de `/media/*`. |

---

## 24. Misión 4C — Telemetría segura y preparación del retiro de AUD-006 (2026-10-10)

**Tipo:** continuidad de 4B para resolver el riesgo residual de logs; no rehace 4A/4B y no toca AUD-007.  
**Informe de detalle:** [MISSION-4C-VERIFICATION-REPORT-2026-10-10](./MISSION-4C-VERIFICATION-REPORT-2026-10-10.md).

### 24.1 Riesgo residual de logs demostrado (Nginx)

- `frontend/nginx.conf` no define `log_format`; Nginx usa `combined`, cuyo campo `$request` **incluye la query string**. Demostrado empíricamente en contenedor efímero: una petición `GET /probe?device_token=SUPERSECRET123` se registró íntegra con el token en el access log, **antes** de cualquier rechazo de Socket.IO.
- Mitigación preparada en `frontend/nginx.conf.hardened` (reemplazo completo de `default.conf`): `log_format nexus_safe_query` con `$uri` (sin args) y `access_log` seguro **selectivo** en `/socket.io/` y `/control/socket.io/`, conservando `error_log`. Validado con `nginx -t` en contenedor efímero.
- **No desplegada.** Los logs de producción no se consideran corregidos hasta desplegar y verificar la configuración efectiva en ventana controlada (DEV-RUN-004 §6.4 y §8.1). No se borraron logs; no se reinició el servicio.

### 24.2 Observación sin aceptación (`OBSERVE_QUERY_DEVICE_TOKEN`)

- Nueva opción independiente de `ALLOW_QUERY_DEVICE_TOKEN`: con observación activa y fallback deshabilitado, el servidor registra `⚠️ [Observación AUD-006] ...` (solo `tv_uuid` si cumple formato UUID y canal; **nunca** el token ni la URI) y rechaza el handshake igual que antes.
- Distingue: sin query token (sin evento), query exclusiva rechazada, query **y** auth/header simultáneos rechazados (canal `coexiste con auth/header`), y fallo convencional de credenciales (sin evento de observación).
- La observación **no puede activar el fallback** por sí misma; los errores/advertencias no contienen tokens ni URLs; un `tv_uuid` no validado no se registra ni se considera auténtico.
- Cableado en `nx_tv.js` y documentado en `.env.example`. Precedencia programática conservada (test 27 de 4B).

### 24.3 Pruebas de Misión 4C

- `tests/device-auth.test.js`: **32/32 PASS** (nuevos tests 28–32: observación sin aceptación, no-activación del fallback, no fuga de tokens/URLs, `tv_uuid` inválido no observado, integración env-driven).
- `tests/nginx-safe-logging.test.js` (nuevo, offline): **4/4 PASS**.
- `nginx -t` (contenedor efímero `nginx:alpine`): OK para `nginx.conf` y `nginx.conf.hardened`.
- Regresión sin PostgreSQL (11 archivos): **105/105 PASS, 0 fail**.
- `node --check`: OK en archivos modificados. `git diff --check`: limpio.
- Verificación efectiva del entorno activo: **bloqueada** (requiere ventana controlada).

### 24.4 Estado consolidado vigente (sustituye a §23.5)

| Hallazgo | Severidad | Estado oficial vigente | Observación |
|---|---|---|---|
| **AUD-006** | P2 | **Mitigado en código / Pendiente de verificación de campo** | Rechazo por defecto + observación sin aceptación + corrección de logging Nginx **preparada, no desplegada**. Abierto: inventario físico, ventana de observación real, despliegue/verificación de Nginx endurecido, retiro del fallback (DEV-RUN-004). |
| **AUD-007** | P2 | **Corregido en código / Pendiente de verificación de despliegue** | Opción B (URLs firmadas HMAC) implementada y validada (123/123 tests PASS). Requiere: provisioning `MEDIA_URL_SIGNING_KEY`, despliegue `frontend/nginx.conf` actualizado, validación de logs y streaming en ventana operativa. ADR-006 aprobado. |

---

## 25. Misión 5 — Control de acceso multimedia y preview administrativo (2026-10-13)

**Tipo:** implementación de política aprobada para AUD-007 (Opción B: URLs firmadas temporales HMAC-SHA256).  
**Informe de detalle:** [MISSION-5-VERIFICATION-REPORT-2026-10-10](./MISSION-5-VERIFICATION-REPORT-2026-10-10.md).

### 25.1 Decisión de producto e implementación

- **Política aprobada:** Opción B (URLs firmadas temporales) — protege binarios locales sin romper HTML5 ni `Range`.
- **ADR-006 actualizado:** estado **Aprobado e implementado**; registra flujos TV/Admin, TTL, logging seguro y riesgo residual de credenciales portadoras.
- **Alcance:** solo archivos locales servidos por Nexus TV (`source_type = 'local_file'`). URLs externas (YouTube, Power BI, HTTP) sin cambios.

### 25.2 Arquitectura implementada

| Componente | Función |
|---|---|
| `src/utils/signedMediaUrl.js` | HMAC-SHA256 generation/validation, middleware Express, propósitos `tv_playback` / `admin_preview` |
| `src/routes/tv.js` | `GET /api/tv/:tv_uuid/playback-url/:contentId` — TV autenticada, verifica playlist + archivo local |
| `src/routes/admin.js` | `GET /api/admin/media/preview-url/:contentId` — Admin RBAC viewer+ |
| `nx_tv.js` | `signedMediaUrlMiddleware` en `/media/*` antes de `express.static()` |
| `frontend/nginx.conf` | `log_format nexus_safe_query` (usa `$uri`); `/media/` proxificado a backend con access log seguro |
| `TVPlayer.jsx` | `getPlaybackUrl()` + `fetchSignedUrl()` — renovación automática, TTL adaptativo |
| `ContentManager.jsx` | Botón "Preview" → signed URL admin → `window.open()` |

### 25.3 Flujo de autorización

**TV (reproducción):**
1. TV obtiene playlist con `X-Device-Token` validado
2. Para cada ítem local: `GET /api/tv/:tv_uuid/playback-url/:contentId`
3. Backend verifica: TV activa + token válido + contenido en playlist vigente + archivo local
4. Genera URL firmada `tv_playback` con `tvUuid` binding y TTL `max(1h, min(duración+30min, 4h))`
5. TV reproduce con `<video src="signed_url">` — HTML5 nativo, `Range` preservado

**Admin (preview):**
1. Admin autenticado (JWT + RBAC `viewer`/`editor`/`admin`) clic "Preview" en ContentManager
2. `GET /api/admin/media/preview-url/:contentId` → URL firmada `admin_preview` (TTL 30 min, sin TV binding)
3. `window.open(signed_url)` — reproducción nativa en pestaña nueva

### 25.4 Logging seguro (integración MISIÓN 4C)

- `log_format nexus_safe_query` en `frontend/nginx.conf` (contexto `http`): usa `$uri` (sin query string)
- Aplicado a `/socket.io/`, `/control/socket.io/` y **`/media/`**
- No registra HMAC ni parámetros sensibles en access logs
- Validado offline: `nginx -t` OK; `tests/nginx-safe-logging.test.js` 4/4 PASS

### 25.5 Pruebas ejecutadas

- **Nuevos tests unitarios:** `tests/signed-media-url.test.js` — **18/18 PASS** (SMU-1 a SMU-18)
- **Regresión completa:** **123/123 PASS** (device-auth 32, nginx-safe-logging 4, signed-media-url 18, pairing 5, auth 4, rbac 14, playlist-auth 6, playlist-playback 10, tv-heartbeat 10, schedule-window 5, media-upload 9)
- **Validación Nginx offline:** `nginx -t` en contenedor efímero — OK para `nginx.conf` y `nginx.conf.hardened`
- **Sin secretos en diffs:** `MEDIA_URL_SIGNING_KEY` documentada como `REPLACE_WITH_A_SECURE_RANDOM_KEY_MIN_32_BYTES`

### 25.6 Estado consolidado vigente (sustituye a §24.4)

| Hallazgo | Severidad | Estado oficial vigente | Observación |
|---|---|---|---|
| **AUD-006** | P2 | **Mitigado en código / Pendiente de verificación de campo** | Rechazo por defecto + observación sin aceptación + corrección de logging Nginx **preparada, no desplegada**. Abierto: inventario físico, ventana de observación real, despliegue/verificación de Nginx endurecido, retiro del fallback (DEV-RUN-004). |
| **AUD-007** | P2 | **Corregido en código / Pendiente de verificación de despliegue** | Opción B (URLs firmadas HMAC) implementada y validada (123/123 tests PASS). Requiere: provisioning `MEDIA_URL_SIGNING_KEY`, despliegue `frontend/nginx.conf` actualizado, validación de logs y streaming en ventana operativa. ADR-006 aprobado. |

---

## 26. Addendum — Ventana DEV-RUN-005 (2026-10-13): estado post-despliegue

> **Documento histórico:** las matrices de §1–§25 son snapshots de sus fechas. Esta sección registra el estado **verificado en campo** tras la ejecución de la ventana operativa DEV-RUN-005 v1.1 (2026-10-13). Evidencia: [`DEPLOY-LOG-2026-10-13.md`](./DEPLOY-LOG-2026-10-13.md) y [`POST-DEPLOY-VERIFICATION-2026-10-13.md`](./POST-DEPLOY-VERIFICATION-2026-10-13.md).

### 26.1 Matriz consolidada post-ventana (sustituye a §25.6)

| Hallazgo | Severidad | Estado post-ventana | Observación |
|---|---|---|---|
| **AUD-001** | P1 | **Aplicado en DB activa / retiro legacy pendiente** | Migración 06 aplicada: `nexus_app` (`super=false login=true`, 25 grants, DDL denegado 42501); backend conecta como `nexus_app` (sesión en `pg_stat_activity`). Pendiente: retirar `SUPERUSER` de `tv`/`nx_tv`/`tv_user` (DBA, con recuperación documentada). |
| **AUD-002** | P1 | **Corregido y verificado** | Sin cambios por la ventana. |
| **AUD-003** | P1 | **Corregido y verificado** | Sin cambios por la ventana (`npm audit` 0). |
| **AUD-004** | P2 | **Corregido y verificado** | 15/15 tests en la ejecución final. |
| **AUD-005** | P2 | **Corregido y desplegado en activo** | Migración 07 aplicada a producción: `pending_pairings` presente; 28 tests. |
| **AUD-006** | P2 | **Desplegado con rechazo por defecto / Pendiente de verificación de campo** | Backend en activo con `ALLOW_QUERY_DEVICE_TOKEN=false` y `OBSERVE_QUERY_DEVICE_TOKEN=false` verificados en el contenedor. **No habilitar** la clave durante la observación de DEV-RUN-004. |
| **AUD-007** | P2 | **Corregido y verificado en campo** | Middleware firmado activo: media sin firma → **403** (antes 200) en `:28080` y `:23002`; firma inválida → **403**; `nexus_safe_query` desplegado (2 ocurrencias), `nginx -t` OK. |
| **AUD-008** | P2 | **Aplicado y verificado en campo** | `tv-db` recreado (2026-10-13T14:37:21Z): `docker port` → **solo `127.0.0.1:25432`**; volumen `tv_gsi_tv_pgdata` preservado, datos `48\|4\|8\|10\|132` íntegros. |

### 26.2 Hitos de la ventana (evidencia en crudo)

- **Respaldo:** `backups/nexus_tv_20261013_161056.dump` (24.424 bytes), SHA-256 `ACE8954697FE43881C8557219D4C48EEE10C8B6302E4DAA8C4C01A2CA8FC9018`; restauración en QA efímera `127.0.0.1:25497` → `BACKUP_VERIFIED_OK`.
- **Migraciones 06 → 07:** exit 0 / exit 0 con verificación D5–D8 (grants 25, socket 0, scram OK, DDL 42501).
- **Despliegue:** build exit 0; backend Node v24.21.0 (`KEY_LEN=64`, módulo firmado presente, rechazo query-string activo); frontend `nginx -t` OK.
- **Incidencia F3:** la primera recreación de `tv-db` no llegó a aplicarse (ejecución interrumpida); detectada por verificación en crudo (`docker inspect .Created` + `docker port` → `0.0.0.0`) y resuelta con re-ejecución (efectiva a las 14:37:21Z).
- **Regresión final:** **153/153 PASS, 0 fail** (SMU **20/20**, que incorpora SMU-19/SMU-20); `git diff --check` = 0.
- **Restricciones:** sin commits/pushes/cambios de rama; sin `down -v` ni borrado de volúmenes; sin secretos impresos.

### 26.3 Pendientes tras la ventana

1. **Operaciones** — pruebas con credenciales/dispositivos reales: playback TV (GET/HEAD/Range), preview admin, heartbeat, pairing E2E.
2. **DEV-RUN-004** — campaña de verificación de campo de AUD-006 (`ALLOW_QUERY_DEVICE_TOKEN=false` se mantiene durante toda la observación).
3. **DBA** — retiro de `tv`/`nx_tv`/`tv_user` con procedimiento de recuperación documentado.
4. **Sign-off** — retención/purga de `backups/` y de las etiquetas `pre-v2.2.0`.

---

## 27. Addendum — MISIÓN FINAL / Cierre integral (2026-10-13, tarde): estado definitivo AUD-001…AUD-008

> **Documento vivo:** sustituye a la matriz de §26.1 para los estados marcados abajo. Evidencia completa: [`FINAL-CLOSURE-2026-10-13.md`](./FINAL-CLOSURE-2026-10-13.md), con salidas crudas citadas en cada punto.

### 27.1 Matriz definitiva post-cierre

| Hallazgo | Severidad | Estado definitivo (2026-10-13 tarde) | Evidencia de esta misión |
|---|---|---|---|
| **AUD-001** | P1 | **CERRADO — corregido y verificado en DB activa** | Roles legacy `nx_tv`, `tv_user`, `ronald`, `nxtv`, `francisco` → `NOSUPERUSER NOLOGIN` (ensayo previo en QA efímero + simulacro de recuperación reversibles como `tv`); `tv` queda como **única cuenta DBA justificada** (`POSTGRES_USER`, healthcheck, respaldos, migraciones, recuperación; no existe rol `postgres` en el volumen) con `NOCREATEDB NOCREATEROLE NOBYPASSRLS`; `nexus_app` intacto. Post-cambio: propiedad `ronald=22/tv=6` intacta; DML `SELECT`=48 vía SCRAM; `INSERT users`/`CREATE TABLE`/`ALTER ROLE` → **denegados**; sonda real `tv-login`=401; `pg_dump` post-cambio 86 entradas. |
| **AUD-002** | P1 | **CERRADO — verificado en producción** | E2E vivo: heartbeat válido 200 (efecto `last_login=2026-10-13 15:38:49`), inválido 401, ausente 401; doble verificación en lectura/escritura en código; regresión completa verde. |
| **AUD-003** | P1 | **CERRADO — verificado** | `npm audit --omit=dev` backend **0** y frontend **0** (exit 0). |
| **AUD-004** | P2 | **CERRADO — verificado** | `media-upload` en regresión sin fallos; ejecuciones reales ffprobe/ffmpeg documentadas en contenedor (skips de host). |
| **AUD-005** | P2 | **CERRADO — verificado en producción** | E2E de pairing completo en activo (espera → `bind-screen` 200 con ACK → `assign_profile` → `promoted` → `admin:tv_bound`), **rotación** (original 401 / nuevo 200), **expiración** `pairing:expired` a **301 s**, **recuperación tras reinicio** (`pending` → `expired` + log `[Boot Reconciliation] 1…`), fail-safe 503 sin esquema. |
| **AUD-006** | P2 | **DESPLEGADO Y OBSERVADO — pendiente de verificación externa (campaña de campo)** | `ALLOW_QUERY_DEVICE_TOKEN=false` (antes/durante/después); `OBSERVE_QUERY_DEVICE_TOKEN=true` desde **15:25:28Z** con **5 observaciones sin secretos** (0 hex64, 0 tokens); cliente oficial sin query (`TVPlayer.jsx` `auth:{}` + `query:{}` vacío); **gap de logging de Nginx medido y cerrado**: antes la sonda con token dejaba `device_token=…` en el access log, después de desplegar `nginx.conf.hardened` (rebuild+recreate, `nexus_safe_query` 2→4, `nginx -t` OK) → **0 líneas sensibles** y rechazo del backend intacto. Cierre V4 = hardware real (Operaciones). |
| **AUD-007** | P2 | **CERRADO en lo verificable — E2E 38/38 pre y post despliegue** | Login/RBAC, playlist por dispositivo (contenido fuera de playlist → **403**), emisión TTL 3600 s, GET/HEAD/Range 200/200/206 directo y vía Nginx, anónimo/caducada/propósito/clave → 403, preview admin 200/206 y 401 sin token, logs sin firmas. Pendiente externo: TV física y credenciales reales de administración (Operaciones). |
| **AUD-008** | P2 | **CERRADO — verificado en campo** | `docker port tv-db` → solo `127.0.0.1:25432`; YAML == contenedor; volumen intacto. |

### 27.2 Regresión y gates de la misión (cifras reales)

- **Regresión completa `npm test`:** 187 tests → **184 pass / 0 fail / 3 skipped** (ffprobe/ffmpeg en host), exit 0. Primer intento con 1 fallo de **runner IPC** (`Unable to deserialize cloned data…`, `failureType: uncaughtException`) no reproducido en solitario ni en el segundo run → flake documentado.
- Build frontend (`vite`): exit 0 (126 módulos) tras binding nativo `@rolldown/binding-win32-x64-msvc@1.2.9` (`--no-save`, bug npm/cli#4828).
- `nginx -t` OK · `node --check nx_tv.js` OK · escaneo de secretos del árbol: **0** patrones sensibles (los hex64 de docs son hashes SHA-256 de ficheros fuente).

### 27.3 Pendientes residuales (externos, auténticos)

1. **Operaciones** — campaña de campo AUD-006 V4 con dispositivos físicos; reproducción en TV real y preview con credenciales reales (AUD-007 G4c/G4d).
2. **DBA** — retiro definitivo (borrado) de los roles legacy hoy inertes (`NOLOGIN NOSUPERUSER`), con ventana y recuperación.
3. **Sign-off** — retención de `backups/nexus_tv_20261013_171557.dump` y etiquetas `pre-v2.2.0`.
4. **Riesgo residual documentado** — `pg_hba` con `trust` en loopback (heredado del volumen): requiere ventana controlada con rotación de credencial para migrar a `scram-sha-256`; no modificado por riesgo de bloqueo.






