# ADR-006 — Política de acceso a recursos multimedia (`/media/*`)

> **Estado:** **Aprobado e implementado (Opción B: URLs firmadas temporales HMAC)**
> **Fecha:** 2026-10-10
> **Área:** Arquitectura de Seguridad, Publicación de Medios y Compatibilidad de Reproductores TV
> **Decisores:** Product Owner + Security Architect + Dev Team Lead + Senior QA Engineer
> **Hallazgo relacionado:** AUD-007 (Acceso público a recursos multimedia, P2 Media) — **Cerrado en código, pendiente de despliegue verificado**
> **Normativa de referencia:** ISO/IEC 27001:2022 (A.5.12 Clasificación de la información, A.8.20 Control de redes, A.8.24 Criptografía) / ISO/IEC 25010 (Compatibilidad y Eficiencia de desempeño)

---

## 1. Contexto y problemática

`/media/*` se publicaba anteriormente sin autenticación por petición. Nginx (`frontend/nginx.conf`, `location /media/`) proxificaba el contenido a Express, que servía los archivos con `Cache-Control: no-store, no-cache, must-revalidate`. Los nombres de archivo se generan con `crypto.randomUUID() + extensión` (alta entropía), por lo que no son enumerables en la práctica, pero **quien obtenga la URL exacta podía descargar el recurso mientras existiera**.

La metadata sí está protegida:
- `GET /api/tv/:tv_uuid/playlist` exige `X-Device-Token` validado contra PostgreSQL.
- `GET /api/media` y las APIs administrativas exigen JWT con RBAC (`admin`/`editor`/`viewer`).

**Decisión de producto (MISIÓN 5):** Los contenidos multimedia locales se clasifican como **acceso restringido**. Se implementa la **Opción B (URLs firmadas temporales HMAC)** para proteger el acceso al binario sin romper HTML5 ni `Range`.

> **Restricción vigente:** El código está implementado y validado en tests. El despliegue en entorno activo requiere ventana operativa para aplicar `frontend/nginx.conf` actualizado y provisionar `MEDIA_URL_SIGNING_KEY`. AUD-007 se considera **Corregido en código / Pendiente de verificación de despliegue**.

---

## 2. Alternativas evaluadas

### Opción A — Recursos públicos por diseño

El acceso directo a `/media/<uuid>.<ext>` se mantiene sin autenticación por petición. La protección se apoya en:
- Rutas de alta entropía (`crypto.randomUUID()`, 128 bits CSPRNG) y no enumerables.
- Metadata y descubrimiento de playlists estrictamente autenticados (`X-Device-Token` / RBAC JWT).

### Opción B — URLs firmadas temporales (HMAC)

La API autenticada decora cada `source_url` con una firma y caducidad al construir la playlist:
`/media/<uuid>.<ext>?token=<hmac>&expires=<ts>`. Nginx (`secure_link`) o un middleware Express validan la firma antes de servir el binario. La BD conserva rutas limpias.

### Opción C — Acceso autorizado por dispositivo

Cada `GET` de medio exige la credencial de pantalla (`X-Device-Token`) o una cookie de sesión de dispositivo.

---

## 3. Comparativa por dimensión

| Dimensión | Opción A — Públicos por diseño | Opción B — URLs firmadas (HMAC) | Opción C — Autorizado por dispositivo |
|---|---|---|---|
| **Compatibilidad `TVPlayer` (React)** | Nula carga: ya consume `<video src>` e `<img src>`. | Mínima: la API devuelve URLs ya firmadas; el reproductor no cambia. | Crítica: `<video>`/`<img>` no envían cabeceras personalizadas. Requiere `fetch() -> Blob` o cookies. |
| **Reproducción HTML5** | Nativa, sin cambios. | Nativa, sin cambios. | Degradada: reemplaza el streaming progresivo por descarga en memoria. |
| **Peticiones HTTP `Range: bytes`** | Nativas (Nginx/Express). | Nativas (Nginx `secure_link` valida firma y conserva `Range`). | Rotas o muy complejas con Blob/cookies; rompe *seek* y segmentación. |
| **Caché / CDN** | Óptima. | Buena mientras la firma esté vigente. | Pobre: exige `Vary: Cookie` o impide caché compartida. |
| **Revocación** | Inmediata eliminando el archivo (`DELETE /api/media/:id`); la URL deja de existir. | Global rotando la clave HMAC o por TTL. La URL filtrada caduca. | Inmediata revocando el token del dispositivo, pero exige canal por petición. |
| **Expiración** | No aplica (el recurso existe hasta su borrado). | TTL configurable (p. ej. 12–24 h) coordinado con la caducidad de playlist. | Depende del token/cookie; caducidad de sesión a gestionar en cada pantalla. |
| **Pantallas físicas (Smart TV/kiosk)** | Compatibilidad nativa total. | Compatibilidad nativa total (la firma viaja en la URL). | Alto riesgo de OOM al reproducir vídeos HD/4K (hasta 500 MB) en TVs con 1–2 GB de RAM. |
| **Complejidad de despliegue** | Mínima: 0 componentes nuevos. | Media: utilidad HMAC + `secure_link` en Nginx o middleware Express + sincronización de reloj. | Muy alta: gestión de sesiones de medios, blobs o cookies cross-origin. |
| **Riesgo residual** | Quien obtiene la URL exacta descarga el recurso mientras exista. | Una URL filtrada es válida solo hasta su expiración. | El token de dispositivo debe transmitirse con cada activo; fuga amplifica el daño. |

---

## 4. Ventajas y riesgos por alternativa

### Opción A
- **Ventajas:** máxima compatibilidad, streaming y `Range` nativos, cero sobrecarga, apta para CDN, sin cambios de cliente ni de BD.
- **Riesgos:** exposición del binario a quien conozca/obtenga la URL; sin caducidad; la seguridad depende de la no enumerabilidad.
- **Impacto en clientes:** nulo.

### Opción B
- **Ventajas:** protege el acceso sin romper HTML5 ni `Range`; no altera el esquema de BD; revocación global por rotación de clave y caducidad fina.
- **Riesgos:** sincronización de reloj entre API y Nginx/Express; hay que ajustar el TTL al ciclo de refresco de la playlist; requiere trabajo de infraestructura y pruebas de streaming.
- **Impacto en clientes:** mínimo (cambio transparente en la URL devuelta por la API); requiere desplegar API y validación de firma de forma coordinada.

### Opción C
- **Ventajas:** control por dispositivo y revocación inmediata.
- **Riesgos:** `<video>`/`<img>` no envían cabeceras; `fetch() -> Blob` provoca OOM y elimina *byte-range*; cookies frágiles en kioskos.
- **Impacto en clientes:** crítico; recomendada únicamente como descartada salvo requisito de confidencialidad extrema verificado en hardware concreto.

---

## 5. Requisitos que debe confirmar Producto

1. **Clasificación de la información:** ¿los contenidos son señalización/cartelería de visualización pública o material confidencial/restringido?
2. **Perímetro de acceso esperado:** ¿basta con impedir la enumeración (Opción A) o se exige que una URL filtrada caduque (Opción B)?
3. **Ciclo de vida de las URLs:** si se elige B, TTL aceptable y relación con el refresco de playlist (cada cuánto relee la pantalla la playlist).
4. **Hardware objetivo:** inventario real de pantallas y capacidad (RAM/decodificador) antes de descartar o aprobar cualquier opción que afecte a HTML5.
5. **Requisitos regulatorios/contractuales** sobre los activos (acuerdos, datos de terceros, derechos de imagen) que obliguen a caducidad o revocación.
6. **Presupuesto y ventana de despliegue** para Nginx `secure_link`/middleware y pruebas de streaming con `Range`.

---

## 6. Decisión adoptada: Opción B — URLs firmadas temporales (HMAC-SHA256)

### 6.1 Mecanismo implementado

- **Clave de firma dedicada:** `MEDIA_URL_SIGNING_KEY` (variable de entorno, min 32 bytes, nunca valor por defecto).
- **Algoritmo:** HMAC-SHA256 con comparación en tiempo constante (`crypto.timingSafeEqual`).
- **Payload firmado:** `purpose|filename|expiresAt|tvUuid(opcional)|contentId(opcional)`.
- **Propósitos diferenciados:**
  - `tv_playback`: Reproducción en TV autenticada (incluye `tvUuid` para ligar a pantalla).
  - `admin_preview`: Preview en panel administrativo (sin `tvUuid`, TTL 30 min).
- **TTL adaptativo:**
  - TV playback: `max(1h, min(duración_contenido + 30min, 4h))` — cubre reproducción completa + buffering.
  - Admin preview: 30 minutos fijo.
- **Endpoints emisores:**
  - `GET /api/tv/:tv_uuid/playback-url/:contentId` — TV autenticada (valida TV activa, token, contenido en playlist).
  - `GET /api/admin/media/preview-url/:contentId` — Admin autenticado (RBAC viewer+).
- **Middleware de validación:** `signedMediaUrlMiddleware` en Express (`/media/*`) verifica HMAC, expiración, propósito y TV binding antes de servir archivo.

### 6.2 Protección de rutas directas

- Nginx **no sirve archivos estáticos** bajo `/media/`; todo el tráfico se proxifica a `backend:3002/media/`.
- Express (`nx_tv.js`) valida firma HMAC via `signedMediaUrlMiddleware` **antes** de `express.static()`.
- Path traversal mitigado con `path.resolve()` y verificación de contención en `mediaDirectory`.
- Access logs de Nginx usan `log_format nexus_safe_query` basado en `$uri` (sin query string) para no registrar firmas HMAC.

### 6.3 Flujo TV (reproducción)

1. TV autenticada obtiene playlist via `GET /api/tv/:tv_uuid/playlist` (con `X-Device-Token`).
2. Para cada ítem local (`source_type === 'local_file'`), TV llama a `GET /api/tv/:tv_uuid/playback-url/:contentId`.
3. Backend verifica: TV activa + token válido + contenido en playlist vigente + archivo local.
4. Backend genera URL firmada `tv_playback` con TTL adaptativo y la devuelve.
5. TV reproduce usando `<video src="signed_url">` — HTML5 nativo, `Range` support preservado.
6. Al expirar la URL, TV renueva automáticamente antes de la siguiente reproducción.

### 6.4 Flujo Admin (preview)

1. Admin autenticado (JWT + RBAC) visualiza biblioteca en ContentManager.
2. Para archivo local, clic en "Preview" → `GET /api/admin/media/preview-url/:contentId`.
3. Backend genera URL firmada `admin_preview` (TTL 30 min, sin TV binding).
4. Admin abre URL en nueva pestaña; `<video>`/`<img>` nativo reproduce el preview.

### 6.4 Recursos externos

URLs externas (YouTube, Power BI, HTTP directo) **no se firman**; se consumen tal cual. Esta implementación protege **solo archivos locales servidos por Nexus TV**.

### 6.5 Recursos externos

URLs externas (YouTube, Power BI, HTTP directo) **no se firman**; se consumen tal cual. Esta implementación protege **solo archivos locales servidos por Nexus TV**.

---

## 7. Riesgo residual de URLs portadoras

Una URL firmada es una **credencial portadora** mientras esté vigente: quien la copie puede usarla hasta su expiración. Mitigaciones:

- TTL acotado (máx 4h para TV, 30min para admin).
- Rotación de clave `MEDIA_URL_SIGNING_KEY` invalida todas las URLs existentes.
- Logs no registran query string (`nexus_safe_query` usa `$uri`).
- `Referer` header controlado via `Referrer-Policy: strict-origin-when-cross-origin` (recomendado en frontend).

> **Limitación reconocida:** no se puede revocar una URL firmada individualmente sin rotar la clave global. Esto es inherente al diseño stateless de URLs firmadas.

---

## 8. Cambios de despliegue requeridos

1. **Provisionar `MEDIA_URL_SIGNING_KEY`** (generar con `openssl rand -hex 32`) en entorno antes de desplegar.
2. **Desplegar `frontend/nginx.conf` actualizado** (incluye `log_format nexus_safe_query` y `location /media/` con access log seguro).
3. **Verificar `nginx -t`** en contenedor de staging antes de producción.
4. **Validar access logs** tras despliegue: confirmar que `/media/` requests no muestran query string en `media_access.log`.

---

## 9. Referencias

- [AUDIT-FULL-2026-10-09 — Hallazgo AUD-007](../../13-testing/results/AUDIT-FULL-2026-10-09.md)
- [ADR-005 — Autenticación criptográfica de dispositivos TV](./ADR-005-device-authentication.md)
- `frontend/nginx.conf` (`location /media/`, `log_format nexus_safe_query`)
- `src/utils/signedMediaUrl.js` (HMAC generation & validation)
- `src/routes/tv.js` (`GET /api/tv/:tv_uuid/playback-url/:contentId`)
- `src/routes/admin.js` (`GET /api/admin/media/preview-url/:contentId`)
- `frontend/src/components/TVPlayer.jsx` (`getPlaybackUrl`, `fetchSignedUrl`)
- `frontend/src/components/admin/ContentManager.jsx` (Preview button)
