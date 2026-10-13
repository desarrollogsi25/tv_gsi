# INFORME DE VERIFICACIÓN — MISIÓN 4C: TELEMETRÍA SEGURA Y PREPARACIÓN DEL RETIRO DE AUD-006

**Fecha:** 2026-10-10  
**Repositorio:** `tv_gsi`  
**Objetivo:** resolver el riesgo residual de exposición de credenciales en los logs, preparar la observación del canal obsoleto **sin aceptarlo**, y separar las fases de validación automatizada, verificación de configuración de Nginx, despliegue de telemetría, observación de campo y retiro definitivo del fallback de AUD-006.

> **Alcance:** continua de MISIÓN 4B (no rehace 4A/4B). No modifica AUD-007 ni su política de medios. No se cierra AUD-006.

---

## 1. Estado de entrada y preservación del workspace

- Ejecutadas antes de modificar: `git status --short`, `git diff --stat`, `git diff --name-only`. Trabajo de 4A/4B conservado íntegramente.
- Cero commits, cero pushes, cero cambios de rama.
- Cero escrituras/alteraciones sobre PostgreSQL activo (puerto 25432) o volúmenes; no se reiniciaron servicios operativos.
- No se leyó ni imprimió ningún valor secreto de `.env`.

---

## 2. Verificación real de los logs del proxy (Nginx)

### 2.1 Configuración efectiva

- `frontend/nginx.conf` **no define ningún `log_format`** ni `access_log` propio en `server {}`. Por tanto Nginx usa el formato predefinido `combined` (nivel `http` heredado de `nginx.conf` de la imagen).
- El formato `combined` construye el request line con `$request`, que **incluye la URL completa con la query string** (`GET /socket.io/?EIO=4&transport=polling&t=...&device_token=xxx HTTP/1.1`).
- Los puntos de entrada de Socket.IO son `location /socket.io/` y `location /control/socket.io/` (`proxy_pass` a `backend:3002`). No hay ningún `access_log off` ni sanitización de `$args`/`$request_uri` en la configuración.
- No existe en el repositorio config adicional que redefina `log_format` (grep sobre `log_format|access_log|$request_uri|$args` en el árbol: sin coincidencias fuera de este informe y de `frontend/nginx.conf.hardened`).

### 2.2 Demostración empírica (contenedor efímero, sin tocar servicios activos)

Con `nginx:alpine` en contenedor desechable se comprobó el comportamiento real de los logs:

| Escenario | Petición | Línea de access log observada | ¿Filtra `device_token`? |
|---|---|---|---|
| Formato por defecto (`combined`) | `GET /probe?device_token=SUPERSECRET123` | `127.0.0.1 - - ... "GET /probe?device_token=SUPERSECRET123 HTTP/1.1" 200 2 "-" "curl/8.22.0"` | **SÍ** |
| Formato endurecido `nexus_safe_query` (log_format con `$uri`) | `GET /probe?device_token=SUPERSECRET123` | `127.0.0.1 - - ... "GET 127.0.0.1/probe HTTP/1.1" 200 2 "-" "curl/8.22.0"` (ruta sin argumentos) | **NO** |

**Conclusión verificada por observación, no por suposición:** el formato por defecto de Nginx **registra la query string** del handshake, incluyendo `device_token`, **antes** de que el middleware de Socket.IO lo rechace.

### 2.3 Qué se registra antes del rechazo de Socket.IO

En la secuencia del handshake, Nginx registra el request HTTP en el access log **en el momento de procesar la petición**, independientemente de que Socket.IO responda `connect_error`/400. El medio refiere el propio middleware: los logs de error y depuración de la app no registran URLs completas (grep en `src/` sin coincidencias de logging de URL con query).

### 2.4 Corrección acotada preparada (no desplegada)

`frontend/nginx.conf.hardened` — reemplazo completo y válido para `default.conf`:

- Define `log_format nexus_safe_query` en contexto `http` (el archivo se incluye dentro de `http{}`), que usa `$uri` (sin argumentos) en lugar de `$request`/`$request_uri`, conservando `$remote_addr`, usuario, método, host, ruta, protocolo, `$status`, bytes, referer y user-agent.
- Aplica `access_log` seguro **selectivamente** a `/socket.io/` y `/control/socket.io/`, y conserva `error_log` por ruta.
- El resto de la configuración es idéntica a `nginx.conf` (API, assets, SPA y `/media/`); **no desactiva la auditoría global ni borra logs existentes**.
- No se elimina ni debilita la auditoría de acceso; solo se omite la query string en las rutas de Socket.IO.

**Validación offline ejecutada:** `nginx -t` en contenedor efímero (`--add-host backend:127.0.0.1` para resolución local) sobre `nginx.conf.hardened`: **sintaxis OK / test successful**. También se validó el `nginx.conf` actual con el mismo método (sintaxis OK), lo que no cambia el hallazgo: la sintaxis del formato `combined` es válida; el problema es su contenido.

> ⚠️ **No se afirma que los logs de producción estén corregidos.** La configuración endurecida **no está desplegada** y la verificación efectiva de los logs del contenedor activo queda **bloqueada** hasta una ventana controlada (procedimiento en DEV-RUN-004 §8.1). Los access logs existentes no fueron borrados. Los servicios activos no fueron reiniciados ni modificados.

---

## 3. Telemetría de retiro sin habilitar la autenticación heredada

### 3.1 Diseño

Se añadió a `initSockets(io, opts)` la opción programática **`observeQueryDeviceToken`** (independiente de `allowQueryDeviceToken`):

- Opción de **observación**: `OBSERVE_QUERY_DEVICE_TOKEN` (entorno) y `observeQueryDeviceToken` (programática).
- Opción de **aceptación**: `ALLOW_QUERY_DEVICE_TOKEN` (entorno) y `allowQueryDeviceToken` (programática).

**La observación nunca activa por sí misma el fallback.** El único camino para aceptar credenciales por query sigue siendo `allowQueryDeviceToken=true` explícito.

### 3.2 Evento de observación (fallback deshabilitado)

Con `observeQueryDeviceToken=true` y `ALLOW_QUERY_DEVICE_TOKEN=false`, el middleware emite (solo si `tv_uuid` supera el filtro de formato UUID):

```
⚠️ [Observación AUD-006] Intento rechazado de device_token en query string (tv_uuid: <uuid>, fallback_habilitado: false, canal: <coexiste con auth/header (rechazada query) | query string exclusiva (rechazada)>).
```

Y **rechaza** de inmediato con el error estándar `device_token in query string is rejected`.

### 3.3 Distinción de canales

| Caso observado | Rechazo | Evento |
|---|---|---|
| Sin `query.device_token` | — | No hay evento de observación |
| `query.device_token` exclusivo, fallback off | Sí | `canal: query string exclusiva (rechazada)` |
| `query.device_token` **y** `auth`/header simultáneos, fallback off | Sí (la query siempre invalida el handshake) | `canal: coexiste con auth/header (rechazada query)` |
| Fallo de autenticación convencional (auth/header incorrecta) | Sí | No hay evento de observación (error estándar de credenciales) |

### 3.4 Reglas respetadas

1. **Nunca se registran** tokens, fragmentos, query strings completas ni URLs sensibles.
2. La observación **no acepta** ninguna credencial por query.
3. Un `tv_uuid` de query no validado **no se registra ni se considera auténtico** (el registro exige `isValidUuid`).
4. Solo se registran indicadores mínimos: `tv_uuid` (filtrado por formato) + canal de fallback + `fallback_habilitado`.
5. No hay seguimiento de dispositivos/usuario más allá del conteo de eventos; sin hora de conexión persistida ni datos de sesión adicionales.
6. **Limitación documentada:** si un dispositivo legacy no expone un `tv_uuid` reconocible o el operador no puede aceptar su credencial para atribuirlo, **no se inventa** la identificación; el evento queda como rechazo sin asociación.

---

## 4. Configuración e integración

- `nx_tv.js` alimenta `initSockets(io)` con:
  - `allowQueryDeviceToken: process.env.ALLOW_QUERY_DEVICE_TOKEN === 'true'`
  - `observeQueryDeviceToken: process.env.OBSERVE_QUERY_DEVICE_TOKEN === 'true'`
- `.env.example` documenta ambas variables con valores por defecto `false`, incluye la nota de que para inventario se usa `ALLOW_QUERY_DEVICE_TOKEN=false` + `OBSERVE_QUERY_DEVICE_TOKEN=true`.
- La precedencia programática se mantiene: si `opts.allowQueryDeviceToken` está definido, prevalece sobre el entorno (mantiene el determinismo verificado en Misión 4B, test 27).

---

## 5. Pruebas ejecutadas

### 5.1 `tests/device-auth.test.js` — 32/32 PASS (nuevos tests 28–32)

| Test | Verifica |
|---|---|
| 28 | `observeQueryDeviceToken` detecta el intento **rechazado** con fallback deshabilitado, sin registrar el token y sin dejar `onlineScreens` |
| 29 | `observeQueryDeviceToken=true` **NO** habilita el fallback (rechazo persistente con `ALLOW_QUERY_DEVICE_TOKEN=false`) |
| 30 | advertencias/errores de observación **sin tokens ni URLs** de host |
| 31 | no se observa ni se considera auténtico un `tv_uuid` malformado |
| 32 | integración env-driven: `OBSERVE_QUERY_DEVICE_TOKEN=true` observa sin aceptar (mismo contrato que `nx_tv.js`) |

Además se mantienen los 27 tests previos (rechazo por defecto, fallback explícito con precedencia, canales autorizados, no fuga de secretos).

### 5.2 `tests/nginx-safe-logging.test.js` — 4/4 PASS (nuevo)

| Test | Verifica |
|---|---|
| NGINX-1 | `nginx.conf` principal no contiene `log_format` con `$request_uri`/`$query_string` (no hay formato inseguro propio) |
| NGINX-2 | `nexus_safe_query` usa `$uri` y no `$request_uri` ni `$query_string` |
| NGINX-3 | el access log seguro se aplica a `/socket.io/` y `/control/socket.io/` |
| NGINX-4 | no hay `access_log off` global; se conservan `error_log` (auditoría no desactivada) |

### 5.3 Validación offline de Nginx

- `nginx -t` (contenedor efímero `nginx:alpine`, `--add-host backend:127.0.0.1`, montaje read-only): **ok** para `nginx.conf.hardened` y para `nginx.conf` actual.
- Demostración real del formato por defecto (filtra la query) y del formato endurecido (no la filtra) — sección 2.2.
- La verificación de los logs del entorno activo queda **bloqueada** (requiere ventana controlada; ver DEV-RUN-004 §8.1). No se reinició ningún servicio.

### 5.4 Regresión

- Suite de autenticación: `node --test tests/device-auth.test.js` → **32/32**.
- Regresión sin PostgreSQL (11 archivos: device-auth, nginx-safe-logging, pairing-session, auth, rbac, playlist-auth, playlist-playback, tv-heartbeat, schedule-window, normalize-days, media-upload): **105/105 PASS, 0 fail**.
- `node --check` sobre `src/sockets/index.js`, `nx_tv.js`, `tests/device-auth.test.js`, `tests/nginx-safe-logging.test.js`: OK.
- No se re-ejecutaron las suites de integración contra PostgreSQL QA (fuera del alcance afectado; evita escrituras en el entorno de datos).

---

## 6. Actualización de documentación

- **DEV-RUN-004** (v1.0 → v1.1): fases separadas V1–V5 + rollback; observación sin aceptación (§6.0), límites e indicadores (§6.2), verificación/endurecimiento de Nginx (§6.4), criterios de decisión (§7) y cierre (§11). No se da por iniciada la observación de campo.
- **AUDIT-FULL-2026-10-09**: fila AUD-006 de §21.1 actualizada y nueva sección §24 (MISIÓN 4C) que sustituye a §23.5 como estado vigente.
- **MISSION-4B-VERIFICATION-REPORT**: §3.4 y riesgos (§7) actualizados con el suplemento 4C (mitigación preparada, no desplegada).

---

## 7. Estado consolidado (autoritativo desde Misión 4C)

| Hallazgo | Estado vigente | Justificación |
|---|---|---|
| **AUD-006** | **Mitigado en código / Pendiente de verificación de campo** — no cerrado | Rechazo por defecto + observación sin aceptación + corrección de logging **preparada pero NO desplegada**. Falta: inventario físico, ventana de observación real, despliegue y verificación de la config de Nginx endurecida, retiro del fallback. |
| **AUD-007** | **Pendiente de decisión de producto** (sin cambios) | No se modificó en esta misión; sigue sujeto a ADR-006. |

---

## 8. Riesgos residuales y limitaciones

1. Los **access logs actuales de producción** pueden contener query strings de handshakes legacy hasta que se despliegue la configuración endurecida y se verifique en el entorno activo.
2. La **verificación efectiva de campo** (hardware físico y logs del contenedor activo) sigue bloqueada: no hay ventana operativa autorizada.
3. Runtime de esta verificación: Node v20.18.0 en host (no es el runtime CI `Node 24 LTS`); validación de despliegue requiere contenedor de CI/despliegue.
4. Un dispositivo legacy sin identificador reconocible no puede atribuirse durante la observación sin aceptar su credencial (limitación documentada — no se inventa identificación).
5. Suites de integración PostgreSQL (QA) no re-ejecutadas: fuera del alcance afectado.

---

## 9. Trazabilidad de archivos

**Modificados en Misión 4C:**
- `src/sockets/index.js` — observación sin aceptación (`observeQueryDeviceToken`).
- `nx_tv.js` — cableado de `ALLOW_QUERY_DEVICE_TOKEN` y `OBSERVE_QUERY_DEVICE_TOKEN`.
- `.env.example` — documenta ambas variables (independencia observación/aceptación).
- `tests/device-auth.test.js` — tests 28–32.
- `docs/07-operations/runbooks/DEV-RUN-004-aud006-query-token-retirement.md` — v1.1 con fases separadas.
- `docs/13-testing/results/AUDIT-FULL-2026-10-09.md` — §21.1 y nueva §24.
- `docs/13-testing/results/MISSION-4B-VERIFICATION-REPORT-2026-10-10.md` — suplemento 4C.

**Creados en Misión 4C:**
- `frontend/nginx.conf.hardened` — reemplazo completo con logging seguro (validado `nginx -t`).
- `tests/nginx-safe-logging.test.js` — validación estática offline (4/4).
- `docs/13-testing/results/MISSION-4C-VERIFICATION-REPORT-2026-10-10.md` — este informe.

---

## 10. Confirmación de integridad

- [x] Workspace previo (4A/4B) preservado íntegramente.
- [x] Cero commits, pushes o cambios de rama.
- [x] Cero escrituras/alteraciones sobre PostgreSQL activo ni volúmenes; sin reinicios de servicios.
- [x] Sin secretos en diffs; demostración de fuga solo con valor sintético `SUPERSECRET123` en contenedor desechable.
- [x] `git diff --check` limpio; `git status --short` y `git diff --stat` ejecutados.
- [x] AUD-006 **no cerrado**; AUD-007 **no modificado**; política de medios intacta.