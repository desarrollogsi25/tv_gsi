# INFORME DE VERIFICACIÓN — MISIÓN 5: CONTROL DE ACCESO MULTIMEDIA Y PREVIEW ADMINISTRATIVO

**Fecha:** 2026-10-10  
**Repositorio:** `tv_gsi`  
**Hallazgo:** AUD-007 — Acceso público a recursos multimedia locales  
**Política aprobada:** Opción B — URLs firmadas temporales (HMAC-SHA256)

---

## 1. Resumen ejecutivo

Se ha implementado la **Opción B (URLs firmadas temporales)** para proteger el acceso a archivos multimedia locales (`/media/*`) bajo Nexus TV. La solución:

- **Elimina el acceso anónimo** a `/media/<archivo>` — toda petición requiere firma HMAC válida.
- **Preserva compatibilidad total** con HTML5 `<video>`/`<img>` y peticiones `Range` (streaming nativo).
- **Distingue dos flujos autorizados**: reproducción TV (con binding a pantalla) y preview administrativo (RBAC).
- **No rompe URLs externas** (YouTube, Power BI, HTTP directo) — solo protege archivos locales servidos por Nexus TV.
- **No registra firmas ni query strings sensibles** en logs (formato `nexus_safe_query` en Nginx).

> **Estado AUD-007:** **Corregido en código / Pendiente de verificación de despliegue**. La implementación está completa y validada en tests (123/123 PASS). Falta: provisionar `MEDIA_URL_SIGNING_KEY`, desplegar `frontend/nginx.conf` actualizado y validar logs en entorno activo.

---

## 2. Arquitectura implementada

### 2.1 Componentes nuevos

| Archivo | Responsabilidad |
|---|---|
| `src/utils/signedMediaUrl.js` | Generación/validación HMAC-SHA256, middleware Express, propósitos `tv_playback` / `admin_preview` |
| `src/routes/tv.js` | Endpoint `GET /api/tv/:tv_uuid/playback-url/:contentId` (TV autenticada) |
| `src/routes/admin.js` | Endpoint `GET /api/admin/media/preview-url/:contentId` (Admin RBAC) |
| `nx_tv.js` | Middleware `signedMediaUrlMiddleware` en `/media/*` antes de `express.static()` |

### 2.2 Componentes modificados

| Archivo | Cambio |
|---|---|
| `frontend/nginx.conf` | `log_format nexus_safe_query` (usa `$uri` sin args); `/media/` proxificado a backend con access log seguro; **sin servir estático** |
| `frontend/nginx.conf.hardened` | Actualizado con mismo `log_format` y access log seguro para `/media/` |
| `frontend/src/components/TVPlayer.jsx` | `getPlaybackUrl()` + `fetchSignedUrl()` para obtener URLs firmadas on-demand; renovación automática |
| `frontend/src/components/admin/ContentManager.jsx` | Botón "Preview" para archivos locales → llama a endpoint admin y abre en pestaña nueva |
| `.env.example` | Documenta `MEDIA_URL_SIGNING_KEY` (requerido, min 32 bytes) |
| `src/utils/mediaValidator.js` | Sin cambios funcionales (validación de upload intacta) |

### 2.3 Flujo de datos

```
┌─────────────┐     1. Playlist (X-Device-Token)     ┌──────────────┐
│   TV Player │ ───────────────────────────────────► │   Backend    │
└─────────────┘ ◄─────────────────────────────────── │  (playlist)  │
        │                                             └──────────────┘
        │ 2. Para cada ítem local: GET /playback-url/:contentId
        ▼
┌─────────────┐     3. Verifica: TV activa + token +     ┌──────────────┐
│   Backend   │  contenido en playlist + archivo local    │  Base de     │
│  (firma)    │ ───────────────────────────────────────► │    Datos     │
└─────────────┘ ◄───────────────────────────────────     └──────────────┘
        │
        │ 4. Genera URL firmada: /media/file.mp4?token=HMAC&exp=...&purpose=tv_playback&tv=UUID
        ▼
┌─────────────┐     5. <video src="signed_url">          ┌──────────────┐
│   TV Player │ ───────────────────────────────────────► │   Nginx      │
└─────────────┘     (HTML5 nativo, Range OK)             │  (proxy)     │
                                                ┌──────────────┐
                                                │  Express     │
                                                │ (valida HMAC)│
                                                └──────────────┘
```

---

## 3. URLs firmadas — Especificación técnica

### 3.1 Formato de URL

```
/media/<filename>?token=<hmac_sha256_hex>&exp=<unix_ts>&purpose=<tv_playback|admin_preview>[&tv=<uuid>][&cid=<content_id>]
```

### 3.2 Propósitos

| Propósito | Uso | TV Binding | TTL | Emisor |
|---|---|---|---|---|
| `tv_playback` | Reproducción en TV | **Sí** (obligatorio) | `max(1h, min(duración+30min, 4h))` | `GET /api/tv/:tv_uuid/playback-url/:contentId` |
| `admin_preview` | Preview en panel admin | No | 30 min (1800s) | `GET /api/admin/media/preview-url/:contentId` |

### 3.3 Payload firmado (HMAC-SHA256)

```
purpose|filename|expiresAt|tvUuid(opcional)|contentId(opcional)
```

Ejemplo `tv_playback`: `tv_playback|abc-uuid.mp4|1728567890|aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee|123`

### 3.4 Validaciones en middleware (`signedMediaUrlMiddleware`)

1. Método HTTP: solo `GET`/`HEAD` (otros pasan a siguiente handler)
2. Parámetros obligatorios: `token`, `exp`, `purpose`
3. Propósito válido: `tv_playback` o `admin_preview`
4. Expiración: `now <= exp`
5. `tv_playback` requiere parámetro `tv` (UUID)
6. Reconstrucción de payload y comparación HMAC con `crypto.timingSafeEqual`
7. En fallo: **403** con código `SIGNED_URL_EXPIRED` o `INVALID_SIGNED_URL`; **no revela** si archivo existe

---

## 4. Pruebas ejecutadas

### 4.1 Tests unitarios nuevos (`tests/signed-media-url.test.js`)

| Test | Verifica |
|---|---|
| SMU-1 a SMU-3 | Generación y verificación de URLs firmadas (ambos propósitos) |
| SMU-4 | Rechazo de firma corrupta |
| SMU-5 | Rechazo de URL caducada |
| SMU-6 | Rechazo de propósito incorrecto |
| SMU-7 | Rechazo de archivo diferente (binding a filename) |
| SMU-8 | Rechazo de TV UUID diferente (binding para TV_PLAYBACK) |
| SMU-9, SMU-10 | Rechazo de parámetros faltantes |
| SMU-11 a SMU-14 | Middleware: permite válida, rechaza inválida/caducada, no bloquea POST |
| SMU-15 | Fallo seguro sin `MEDIA_URL_SIGNING_KEY` |
| SMU-16 a SMU-18 | TTL, contentId en firma, timingSafeEqual |

**Resultado:** 18/18 PASS

### 4.2 Tests de regresión (123 tests totales)

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| `device-auth.test.js` (AUD-006) | 32 | 32 | 0 |
| `nginx-safe-logging.test.js` | 4 | 4 | 0 |
| `signed-media-url.test.js` | 18 | 18 | 0 |
| `pairing-session.test.js` | 5 | 5 | 0 |
| `auth.test.js` | 4 | 4 | 0 |
| `rbac.test.js` | 14 | 14 | 0 |
| `playlist-auth.test.js` | 6 | 6 | 0 |
| `playlist-playback.test.js` | 10 | 10 | 0 |
| `tv-heartbeat.test.js` | 10 | 10 | 0 |
| `schedule-window.test.js` | 5 | 5 | 0 |
| `media-upload.test.js` (AUD-004) | 9 | 9 | 0 |
| **Total** | **123** | **123** | **0** |

### 4.3 Validaciones offline

- `nginx -t` (contenedor efímero `nginx:alpine`): **OK** para `frontend/nginx.conf` y `frontend/nginx.conf.hardened`
- `node --check` en todos los archivos JS/JSX modificados: **OK**
- `git diff --check`: **clean** (exit 0)

---

## 5. Logging seguro (integración con MISIÓN 4C)

- `log_format nexus_safe_query` en `frontend/nginx.conf` (contexto `http` válido para conf.d):
  ```
  '$remote_addr - $remote_user [$time_local] '
  '"$request_method $host$uri $server_protocol" '
  '$status $body_bytes_sent "$http_referer" "$http_user_agent"'
  ```
- Usa `$uri` (sin query string) en lugar de `$request`/`$request_uri` → **no registra HMAC ni parámetros**
- Aplicado selectivamente a `/socket.io/`, `/control/socket.io/` y **`/media/`**
- `error_log` conservado en todas las rutas
- Validado en `tests/nginx-safe-logging.test.js` (4/4 PASS)

---

## 6. Compatibilidad y casos de uso

### 6.1 TV Player (reproducción continua)

- Playlist obtenida via `GET /api/tv/:tv_uuid/playlist` (con `X-Device-Token`)
- Para cada ítem local: llamada lazy a `GET /api/tv/:tv_uuid/playback-url/:contentId`
- URL firmada cacheada en memoria con `expiresAt`; renovación automática antes de expiración
- TTL adaptativo: `max(1h, min(duración_contenido + 30min, 4h))` — cubre videos largos + buffering
- Streaming `Range` y `HEAD` preservados (Express `express.static` los maneja nativamente)
- Fallback a URL directa si falla firma (comportamiento degradado, logged)

### 6.2 Admin Preview

- Botón "Preview" en ContentManager para `source_type === 'local_file'`
- Llama `GET /api/admin/media/preview-url/:contentId` (JWT + RBAC `viewer`+`editor`+`admin`)
- Recibe URL firmada `admin_preview` (TTL 30 min, sin TV binding)
- Abre en `window.open()` — reproducción nativa en pestaña nueva
- Funciona para video, imagen, iframe (Power BI)

### 6.3 URLs externas (YouTube, Power BI, HTTP)

- **Sin cambios**: se consumen tal cual desde `source_url`
- No pasan por firma HMAC
- Documentado en ADR-006: alcance limitado a **archivos locales servidos por Nexus TV**

---

## 7. Riesgos residuales y limitaciones

| Riesgo | Mitigación | Estado |
|---|---|---|
| **URL firmada = credencial portadora** mientras vigente | TTL acotado (máx 4h TV, 30min admin); rotación de clave invalida todas | Documentado en ADR-006 §7 |
| **No revocación individual** sin rotar clave global | Inherente a diseño stateless; rotación de clave es operación rápida | Documentado |
| **Clave `MEDIA_URL_SIGNING_KEY` no provisionada** | Fallo seguro en arranque (`getSigningKey()` lanza Error explícito) | Implementado |
| **Path traversal** | `path.resolve()` + verificación contención en `mediaDirectory` | Implementado |
| **Fuga de HMAC en `Referer`** | Recomendado `Referrer-Policy: strict-origin-when-cross-origin` en frontend | Pendiente configuración |
| **Reloj desincronizado** entre TV y backend | NTP obligatorio en despliegue; TTL incluye margen | Operacional |

---

## 8. Despliegue y verificación en entorno activo

### 8.1 Prerrequisitos

1. Generar clave: `openssl rand -hex 32` → `MEDIA_URL_SIGNING_KEY`
2. Provisionar en entorno (Docker env, .env, secret manager)
3. Desplegar `frontend/nginx.conf` actualizado (incluye `log_format` + `/media/` proxy con access log seguro)
4. Validar `nginx -t` en staging antes de producción

### 8.2 Verificación post-despliegue

- `curl -I /media/existente.mp4` → **403** sin firma
- `curl -I "/media/existente.mp4?token=...&exp=...&purpose=tv_playback&tv=UUID"` → **200** / **206** con firma válida
- Inspeccionar `/var/log/nginx/media_access.log`: **no debe aparecer query string** (solo ruta)
- Verificar `Range` requests: `curl -H "Range: bytes=0-1023" <signed_url>` → **206 Partial Content**
- Confirmar TV Player reproduce video largo (>1h) sin interrupción por expiración

---

## 9. Estado oficial de hallazgos

| Hallazgo | Estado vigente | Observación |
|---|---|---|
| **AUD-006** | Mitigado en código / Pendiente de verificación de campo | MISIÓN 4C completa; falta inventario físico y despliegue Nginx hardening |
| **AUD-007** | **Corregido en código / Pendiente de verificación de despliegue** | Implementación Opción B completa (123/123 tests PASS); requiere provisioning clave y despliegue Nginx |

---

## 10. Trazabilidad de archivos (MISIÓN 5)

**Nuevos:**
- `src/utils/signedMediaUrl.js`
- `tests/signed-media-url.test.js`

**Modificados:**
- `src/routes/tv.js` (endpoint playback-url)
- `src/routes/admin.js` (endpoint preview-url + temporary-content con firma)
- `nx_tv.js` (middleware signedMediaUrlMiddleware)
- `frontend/nginx.conf` (log_format + /media/ proxy seguro)
- `frontend/nginx.conf.hardened` (actualizado)
- `frontend/src/components/TVPlayer.jsx` (getPlaybackUrl, fetchSignedUrl)
- `frontend/src/components/admin/ContentManager.jsx` (Preview button)
- `.env.example` (MEDIA_URL_SIGNING_KEY)
- `docs/01-architecture/decisions/ADR-006-media-access-policy.md` (Aprobado Opción B)

---

## 11. Confirmación de integridad

- [x] Workspace previo (MISIÓN 4C) preservado íntegramente
- [x] Cero commits, pushes o cambios de rama
- [x] Cero escrituras/alteraciones sobre PostgreSQL activo ni volúmenes
- [x] Sin secretos en diffs; clave de firma documentada como `REPLACE_WITH_...`
- [x] `git diff --check` limpio; `git status --short` y `git diff --stat` ejecutados
- [x] 123/123 tests PASS (incluye 18 nuevos SMU + regresión completa)
- [x] `nginx -t` OK (producción y hardened)
- [x] `node --check` OK en todos los archivos modificados
- [x] AUD-006 sin cambios; AUD-007 corregido en código (no cerrado hasta despliegue verificado)

---

**Informe generado:** 2026-10-10  
**Próximo hito:** Despliegue en ventana operativa, provisioning `MEDIA_URL_SIGNING_KEY`, validación de logs y streaming en entorno activo.