# INFORME DE VERIFICACIÓN — MISIÓN 4A: AUD-006 Y ANÁLISIS DE POLÍTICA AUD-007

**Proyecto:** Nexus TV Enterprise (`tv_gsi`)  
**Fecha:** 2026-10-10  
**Área:** Seguridad de Canales en Tiempo Real (Socket.IO) y Arquitectura de Publicación de Medios  
**Responsable:** Senior QA Engineer & Security Architect  
**Estado:** Finalizado — AUD-006 Mitigado en Código (Abierto para Verificación de Campo) / AUD-007 Pendiente de Decisión de Producto  

---

## 1. Preservación del Workspace y Entorno Operativo

Conforme a las directivas de seguridad y control de cambios:
1. **Conservación de Cambios Acumulados:** Se mantuvieron íntegros todos los cambios previos de las misiones 2 a 3F (26 archivos modificados previamente, incluyendo validador multimedia AUD-004, protocolo de pairing no bloqueante con `pending_pairings` AUD-005 y aislamiento de roles AUD-001).
2. **Cero Commits / Cero Pushes:** No se crearon commits, no se realizaron pushes ni se modificaron ramas git.
3. **Protección de Base de Datos Activa:** No se realizaron conexiones de escritura, migraciones ni alteraciones destructivas sobre el contenedor `tv-db` (puerto `25432`) ni sus volúmenes. Todas las pruebas de validación se ejecutaron contra fixtures en memoria y los contenedores QA aislados (`nexus-qa-isolated-db` en puerto `25499` y `nexus-qa-clean-bootstrap-val` en puerto `25498`).

---

## 2. AUD-006: Inventario de Clientes Socket.IO y Mecanismos de Autenticación

Se realizó una inspección completa del código fuente, plantillas de configuración, documentación y pruebas para determinar el transporte de `device_token`:

### 2.1 Evidencia Verificada en Código
| Componente / Cliente | Archivo | Mecanismo de `device_token` | Estado de Compatibilidad |
|---|---|---|---|
| **Reproductor Web TV (React SPA)** | `frontend/src/components/TVPlayer.jsx:521-527` | `socket.handshake.auth` (`auth: { tv_uuid, device_token }`) | **100% Compatible.** No envía credenciales en query string (`query: {}`). |
| **TV en Espera de Pairing** | `frontend/src/utils/waitingPairingSocket.js:27-33` | `auth: { session_code, waiting_pairing: 'true' }` | **100% Compatible.** No posee `device_token` previo a la vinculación. |
| **Consola Administrativa** | `frontend/src/components/admin/TVControl.jsx:28-31` | `auth: { token }` (JWT RBAC) | **100% Compatible.** No utiliza credenciales de dispositivo. |
| **Lanzador Kiosk Windows** | `start-tv-kiosk.ps1:12,91-93` | Carga URL base `/tv`; SPA consume `localStorage` | **100% Compatible.** El launcher no inyecta tokens en la query string. |
| **Script E2E de Ciclo de Vida** | `scripts/test_pairing_lifecycle.cjs:84,134` | `auth: { session_code }` / `auth: { tv_uuid, device_token }` | **100% Compatible.** |
| **Suites de Pruebas Unitarias** | `tests/device-auth.test.js`, `tests/pairing-ack.test.js` | `auth: { tv_uuid, device_token }` | **100% Compatible.** |
| **Documentación Antigua** | `README.md:111` | `query: { tv_uuid: '...' }` (contrato obsoleto pre-RSK-025) | Documentación histórica; no representa un cliente real. |

### 2.2 Distinción entre Evidencia en Código y Dispositivos Físicos
- **Evidencia Demostrada:** Todos los clientes desarrollados y soportados en el repositorio utilizan `socket.handshake.auth` para transmitir credenciales de pantalla. Ningún cliente verificado en el código depende de `query.device_token`.
- **Incertidumbre de Dispositivos Físicos:** No existe en el repositorio evidencia directa del firmware de Smart TVs físicas de terceros (Tizen, WebOS, Android TV o microcontroladores embebidos) que pudieran haberse configurado manualmente en el campo con URLs fijas que contengan `?device_token=...`.
- **Conclusión de Riesgo:** Eliminar el soporte de query string sin una opción de contingencia podría provocar una interrupción de servicio en pantallas físicas no actualizadas. Por ello, se implementó una política de **retiro controlado con valor predeterminado seguro**.

---

## 3. AUD-006: Implementación Segura y Remediación en `src/sockets/index.js`

### 3.1 Decisiones Técnicas Implementadas
1. **Configuración Explícita y Controlada:**
   Se introduce la variable de entorno `ALLOW_QUERY_DEVICE_TOKEN` (y la opción programática `opts.allowQueryDeviceToken`), con valor predeterminado **`false`** (seguro por defecto).
2. **Rechazo Inmediato sin Fallback Silencioso:**
   Si un cliente intenta conectarse enviando `device_token` en `socket.handshake.query` mientras la bandera está en `false`, la conexión se rechaza inmediatamente en el handshake:
   ```
   TV authentication failed: device_token in query string is rejected. Use handshake auth or x-device-token header
   ```
3. **Mecanismos Autorizados:**
   Se admite la autenticación segura por:
   - `socket.handshake.auth.device_token` (canal principal).
   - `socket.handshake.headers['x-device-token']` (cabecera HTTP autorizada).
4. **Fallback de Transición Auditable (Migración Gradual):**
   Si un administrador despliega `ALLOW_QUERY_DEVICE_TOKEN=true` para mantener temporalmente operativas pantallas físicas legacy:
   - Se admite la credencial desde `query.device_token`.
   - Se emite una advertencia de auditoría/obsolescencia en logs:
     `⚠️ [Deprecation Warning AUD-006] TV connection using deprecated query string device_token detected (tv_uuid: ...).`
   - **Zero Token Leakage:** La advertencia y los logs registran únicamente el `tv_uuid` (o `unknown`); **bajo ninguna circunstancia se imprime el token sensible ni sus fragmentos**.
5. **Invarianza Criptográfica:**
   Tanto con fallback activado como desactivado, los tokens inválidos, malformados o pertenecientes a una pantalla distinta (`verifyDeviceToken`) son rechazados en tiempo constante mediante comparación segura.

### 3.2 Plan de Retiro y Desmantelamiento (Retirement Plan)
1. **Fase 1 (Actual - Misión 4A):** `ALLOW_QUERY_DEVICE_TOKEN=false` por defecto en entornos nuevos y QA. Se documenta la variable en `.env.example`.
2. **Fase 2 (Verificación de Campo en Producción):** En el próximo ciclo de mantenimiento en producción, habilitar temporalmente `ALLOW_QUERY_DEVICE_TOKEN=true` durante 72 horas para auditar si alguna pantalla física activa genera advertencias `[Deprecation Warning AUD-006]`.
3. **Fase 3 (Retiro Definitivo):** Si no se registran advertencias tras 72 horas, o una vez actualizadas las pantallas identificadas, fijar `ALLOW_QUERY_DEVICE_TOKEN=false` en producción y eliminar el bloque de compatibilidad en la versión siguiente de la API.
4. **Estado:** Se mantiene **AUD-006 abierto (mitigado en código)** hasta que se complete la verificación de campo con las pantallas físicas.

---

## 4. AUD-007: Análisis de Política de Acceso a `/media/*`

No se modificó la política efectiva en esta misión para no romper la reproducción operativa de pantallas activas.

### 4.1 Inspección del Flujo Actual
- **Almacenamiento y Rutas:** Multer almacena archivos en `./media/` con nombres generados por `crypto.randomUUID() + ext` (`src/utils/mediaValidator.js:664`). En base de datos (`nexus_tv.content.source_url`) se guarda `/media/<uuid>.<ext>`.
- **Servidor Nginx / Express:** Nginx proxifica `/media/` a Express sin verificar autenticación (`frontend/nginx.conf:53-71`). Express sirve los archivos con `express.static` forzando `Cache-Control: no-store, no-cache, must-revalidate` (`nx_tv.js:83-94`).
- **Descubrimiento de Playlists:** Las pantallas obtienen sus URLs a través de `GET /api/tv/playlist`. Este endpoint **ya está estrictamente autenticado** con cabecera `X-Device-Token` validada contra PostgreSQL (`src/routes/tv.js:99-111`). La consola administrativa (`GET /api/media`) requiere autenticación JWT con roles `admin`, `editor` o `viewer`.
- **Reproductor TV (`TVPlayer.jsx`):** Consume los medios directamente mediante etiquetas HTML5 estándar:
  ```jsx
  <video src={`${API_BASE}${currentItem.source_url}`} autoPlay playsInline />
  <img src={`${API_BASE}${currentItem.source_url}`} />
  ```

### 4.2 Comparativa Exhaustiva de Alternativas

| Dimensión | Opción A: Recursos Públicos por Diseño | Opción B: URLs Firmadas Temporales (HMAC) | Opción C: Acceso Autenticado por Dispositivo |
|---|---|---|---|
| **Concepto** | Acceso directo a URLs de alta entropía sin autenticación per-request. | Enlaces dinámicos con firma y tiempo de caducidad (`?token=...&expires=...`). | Exigir credenciales de pantalla (`X-Device-Token` o Cookie) en cada GET de medio. |
| **Impacto en `TVPlayer`** | **Nulo.** Consume `<video src>` e `<img src>` directamente. | **Mínimo.** La API devuelve URLs ya firmadas. El reproductor las renderiza directamente sin cambios. | **Crítico / Incompatible.** `<video>` no envía cabeceras. Requiere `fetch() -> Blob` o gestión de cookies complejas. |
| **Dispositivos Físicos** | Compatibilidad nativa total en cualquier Smart TV o navegador Kiosk. | Compatibilidad nativa total (la firma viaja en la query string). | **Alto Riesgo de Colapso (OOM).** Descargar vídeos de 500MB en memoria satura navegadores de TVs con 1-2GB RAM. |
| **Soporte Streaming / Range** | Excelente. Nginx y Express gestionan `Range: bytes` nativamente. | Excelente. Nginx (`secure_link`) valida la firma y gestiona `Range` sin sobrecarga. | Pésimo si se usan Blobs; complejo con cookies si hay proxies intermedios. |
| **Caché y Rendimiento** | Óptimo para CDN y caché HTTP. | Bueno. Permite caché mientras la firma esté vigente. | Pobre. Impide compartir caché entre pantallas o exige `Vary: Cookie`. |
| **Almacenamiento de URLs** | Rutas limpias `/media/<uuid>.mp4` en PostgreSQL. | Rutas limpias `/media/<uuid>.mp4` en PostgreSQL. Las firmas se generan al vuelo en la API. | Rutas limpias en PostgreSQL. |
| **Revocación y Caducidad** | Inmediata mediante borrado de archivo (`DELETE /api/media/:id`). | Fina (TTL configurable, p. ej. 12-24 h). Revocación global rotando la clave HMAC. | Inmediata revocando el token del dispositivo. |
| **Complejidad Operativa** | Mínima (0 componentes nuevos). | Media (utilidad HMAC + módulo Nginx `secure_link` o middleware Express). | Muy alta (gestión de sesiones de medios, blobs o cookies cross-origin). |
| **Riesgo Residual** | Quien obtenga la URL exacta puede descargar el archivo mientras exista. | Si se filtra una URL firmada, es válida únicamente hasta su expiración. | El token del dispositivo debe transmitirse con cada activo multimedia. |

### 4.3 Recomendación Técnica y Decisión Pendiente de Producto
- **Recomendación Técnica:**
  - Si el negocio define que los contenidos son **materiales de cartelería y señalización de visualización pública** (anuncios, menús, bienvenida, noticias corporativas), la **Opción A (Públicos por diseño)** es la más robusta, eficiente y confiable para entornos de Smart TV. La seguridad se apoya en que las rutas no son enumerables (`randomUUID`) y la metadata está protegida por `X-Device-Token`.
  - Si el negocio define que los contenidos son **confidenciales o de difusión restringida**, la **Opción B (URLs firmadas temporales con HMAC)** es la única arquitectura viable que protege el acceso sin provocar desbordamientos de memoria ni incompatibilidades en los reproductores de TV.
  - La **Opción C queda formalmente desaconsejada** debido a las limitaciones del estándar HTML5 de vídeo y los recursos de memoria limitados en Smart TVs comerciales.
- **Decisión que Falta:** Producto debe formalizar la clasificación de la información de los contenidos multimedia.
- **Estado:** AUD-007 permanece **Pendiente de Decisión de Negocio**.

---

## 5. Resultados de Pruebas y Control de Cambios

### 5.1 Pruebas de AUD-006 (`tests/device-auth.test.js`)
Se añadieron 5 pruebas unitarias automatizadas cubriendo todos los aspectos requeridos:
- **Test 21:** Handshake vía cabecera HTTP `x-device-token` aceptado. (PASS)
- **Test 22:** Token en query string rechazado por defecto con error explícito (`ALLOW_QUERY_DEVICE_TOKEN=false`). (PASS)
- **Test 23:** Fallback de compatibilidad (`allowQueryDeviceToken=true`) admitido con advertencia censurada sin fugar el token. (PASS)
- **Test 24:** Con fallback activo, tokens malformados o pertenecientes a otra pantalla siguen siendo estrictamente rechazados. (PASS)
- **Test 25:** Verificación de que ningún mensaje de error expone el valor del token en texto claro. (PASS)
- **Resultado:** **25/25 pruebas PASS** en `tests/device-auth.test.js`.

### 5.2 Suite Completa de Backend
- **Host (Node.js 22 Windows):** **156 tests ejecutados (153 PASS, 0 FAIL, 3 skipped por dependencia de binario local FFmpeg)**.
- **Contenedor Reproducible Docker (Node 24 Alpine con FFmpeg):** **151 tests ejecutados (151 PASS [100%], 0 FAIL, 0 skipped)**. Duración: 11.23 segundos.

### 5.3 Frontend y Dependencias
- **Linter (`oxlint`):** 0 errores (warnings informativos de React Hooks no bloqueantes).
- **Build (`vite build`):** 126 módulos transformados exitosamente en 884ms (`dist/index.html`, `dist/assets/index.js`, `dist/assets/index.css`).
- **Auditoría de Dependencias (`npm audit`):** **0 vulnerabilidades** en backend y **0 vulnerabilidades** en frontend.

---

## 6. Estado Consolidado de la Auditoría

| Hallazgo | Título | Severidad | Estado Actual | Observaciones |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | Mitigado / Verificado en QA | Esquema y usuario de mínimo privilegio `nexus_app` listos; pendiente aplicar en producción durante ventana de mantenimiento. |
| **AUD-002** | Heartbeat anónimo actualizaba `last_login` | P1 | Corregido y Verificado | Validación estricta de `device_token_hash`. 10/10 tests unitarios y 9/9 tests de integración PASS. |
| **AUD-003** | Vulnerabilidad alta en `source-map-js` | P1 | Corregido y Verificado | Dependencia actualizada en lockfile. 0 vulnerabilidades en `npm audit`. |
| **AUD-004** | Upload sin validación estricta de formato | P2 | Corregido y Verificado | Validación mágica de firmas y decodificación FFmpeg con límite anti-DoS de 2s. 18/18 tests PASS. |
| **AUD-005** | Pairing sin confirmación garantizada | P2 | Corregido y Verificado | Arquitectura de 2 transacciones cortas con `pending_pairings` y ACK garantizado sin bloqueos de fila. 28/28 tests PASS. |
| **AUD-006** | Exposición de credenciales en query string | P2 | Mitigado en Código / Abierto | Tokens en query string rechazados por defecto (`ALLOW_QUERY_DEVICE_TOKEN=false`). Fallback explícito seguro documentado. Abierto para validación con Smart TVs físicas. |
| **AUD-007** | Recursos multimedia públicos | P2 | Pendiente de Decisión de Negocio | Análisis arquitectónico entregado comparando 3 alternativas. Recomendación: Opción B si el contenido es confidencial; Opción A si es público. |
| **AUD-008** | Exposición de puertos PostgreSQL en host | P2 | Mitigado en Código / Abierto | Vinculación loopback `127.0.0.1` configurada en Compose; pendiente recrear contenedor de producción para cerrar puerto `0.0.0.0:25432`. |

---

## 7. Confirmación Final

- [x] Workspace íntegramente preservado respecto a misiones anteriores.
- [x] Cero commits, pushes o modificaciones de rama.
- [x] Cero escrituras o alteraciones sobre el PostgreSQL activo de producción (`tv-db`).
- [x] 151/151 pruebas pasando en entorno limpio de contenedor Docker Node 24 con FFmpeg.
