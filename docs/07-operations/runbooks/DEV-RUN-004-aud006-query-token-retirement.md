# DEV-RUN-004 — Retirada segura del fallback `device_token` en query string (AUD-006)

> **Tipo:** Runbook / plan de transición operativa
> **Versión:** 1.1
> **Fecha:** 2026-10-10
> **Responsable:** Operaciones de Nexus TV + Seguridad
> **Sistemas:** Socket.IO `/control`, pantallas físicas/Web, `ALLOW_QUERY_DEVICE_TOKEN`, `OBSERVE_QUERY_DEVICE_TOKEN`, Nginx (`frontend/nginx.conf`)
> **Hallazgos relacionados:** AUD-006
> **ADR relacionados:** ADR-005 (autenticación de dispositivos)
> **Cambio 1.1 (Misión 4C):** se añade observación sin aceptación (`OBSERVE_QUERY_DEVICE_TOKEN`), validación offline de logging de Nginx y separación explícita de las fases de validación automatizada, verificación de configuración, despliegue de telemetría, observación de campo y retiro.
> **Cambio 1.2 (Misión de cierre, 2026-10-13):** se registra la ejecución real: V3 activa (`OBSERVE=true`), V2 desplegada en runtime con medición antes/después (§13), inventarios V1 realizados; V4 pendiente de dispositivos físicos reales (Operaciones).

## 1. Propósito y alcance

Definir el procedimiento para **inventariar clientes**, verificar versiones, detectar el uso del mecanismo antiguo (`device_token` en la query string del handshake) **sin registrar secretos**, y decidir cuándo retirar definitivamente el fallback `ALLOW_QUERY_DEVICE_TOKEN`.

Este documento **no ejecuta cambios sobre el entorno activo** y **no requiere reiniciar servicios ni modificar la configuración actual**. Es un plan; su aplicación requiere una ventana de mantenimiento aprobada.

> **Advertencia de estado:** A la fecha de este documento **no se ha desplegado ni observado ninguna campaña de monitorización** en producción. Cualquier afirmación de "sin uso del mecanismo antiguo" es una hipótesis hasta que este runbook se ejecute realmente en campo.

## 2. Estado actual y predeterminado seguro

- `ALLOW_QUERY_DEVICE_TOKEN` tiene valor predeterminado **`false`**: el servidor rechaza en el handshake cualquier `device_token` presente en `socket.handshake.query`.
- Canales admitidos: `socket.handshake.auth.device_token` y cabecera HTTP `x-device-token`.
- El reproductor web oficial (`frontend/src/components/TVPlayer.jsx`) y el socket de pairing (`frontend/src/utils/waitingPairingSocket.js`) **no envían `device_token` en query**.
- No existe evidencia en el repositorio de firmware de terceros que dependa de `query.device_token`; sin embargo, el fallback se mantiene por si hubiera hardware de campo no inventariado.

## 3. Fase 0 — Congelar supuestos y responsabilidades

| Rol | Responsabilidad |
|---|---|
| Operaciones | Inventariar pantallas y ejecutar el muestreo de campo |
| Seguridad | Validar el instrumento de telemetría y que no se registren tokens |
| Desarrollo | Proporcionar la build con telemetría de deprecación y, después, la retirada del bloque |
| Producto/negocio | Autorizar la ventana y aceptar el riesgo de retirada |

No iniciar ninguna fase sin una ventana de mantenimiento aprobada y un plan de reversión.

## 4. Fase 1 — Inventario de clientes

Objetivo: conocer **qué** pantallas existen y **cómo** se conectan, sin tocar el entorno activo.

1. **Inventario lógico (fuente de verdad):**
   - Exportar desde la administración la lista de pantallas (`GET /api/admin/screens`): `tv_uuid`, nombre, ubicación, `is_active`, `last_login`.
   - Clasificar por ubicación física y por tipo de dispositivo (kiosko Windows, Smart TV, navegador, otro).
2. **Inventario físico:** recorrer las ubicaciones y registrar, por pantalla, el tipo de dispositivo y el mecanismo de arranque (URL del kiosko, `localStorage`, launcher).
3. **Inventario documental:** confirmar qué pantallas usan el reproductor web oficial y cuáles podrían usar un cliente no soportado.
4. **No registrar secretos:** anotar solo identificadores de pantalla (UUID/nombre/ubicación). Nunca copiar `device_token`, URLs con token ni capturas de cabeceras.

**Salida:** tabla de inventario con `tv_uuid`, tipo de dispositivo, versión de cliente y estado, sin secretos.

## 5. Fase 2 — Verificación de versiones de cliente

Objetivo: determinar si cada pantalla envía credenciales por `auth`/header (compatible) o si depende de query string.

1. **Pantallas con reproductor oficial:** verificar que la versión desplegada envía `auth: { tv_uuid, device_token }` y `query: {}`. Confirmar por build/etiqueta de versión, no por lectura del token.
2. **Pantallas no oficiales/embebidas:** identificar cómo construyen la conexión (URL fija con `?device_token=...`, firmware, script propio). Requiere inspección en sitio o del artefacto de configuración, **sin capturar el valor del token**.
3. **Registrar** por pantalla: `compatible_auth` (sí/no) y evidencia (versión/build), sin secretos.

## 6. Fase 3 — Detección del uso del mecanismo antiguo (telemetría sin secretos)

Objetivo: detectar **si** se usa `query.device_token` **sin aceptarlo** y sin exponer el token.

> **Principio (Misión 4C):** observación y aceptación son **opciones independientes**.
> `OBSERVE_QUERY_DEVICE_TOKEN=true` **no activa** el fallback; el handshake sigue rechazando.
> No se recomienda habilitar `ALLOW_QUERY_DEVICE_TOKEN=true` sólo para recopilar métricas.

### 6.0 Configuración de observación (sin aceptar la credencial)

| Variable | Valor recomendado en observación | Efecto |
|---|---|---|
| `ALLOW_QUERY_DEVICE_TOKEN` | `false` | **Rechaza** el token en query (no lo acepta). |
| `OBSERVE_QUERY_DEVICE_TOKEN` | `true` | Registra el intento rechazado, sin token ni URI. |

Cuando el fallback está **deshabilitado** y la observación habilitada, el servidor emite:

```
⚠️ [Observación AUD-006] Intento rechazado de device_token en query string (tv_uuid: <uuid>, fallback_habilitado: false, canal: <coexiste con auth/header | query string exclusiva>)
```

- Sólo se registra el `tv_uuid` **si supera el filtro de formato UUID**; si no, la observación se omite (no se registra un identificador no validado).
- **Nunca** se registra el token, fragmentos, la URI completa ni la query string.

### 6.1 Instrumento de fallback (sólo si se autoriza aceptación temporal)

Cuando `ALLOW_QUERY_DEVICE_TOKEN=true`, el servidor emite en cada handshake con `device_token` en query:

```
⚠️ [Deprecation Warning AUD-006] TV connection using deprecated query string device_token detected (tv_uuid: <uuid|unknown>, channel: <...>)
```

La advertencia registra **únicamente el `tv_uuid`** y el canal; **nunca** el token. Habilitar el fallback **debe ser explícito, temporal y aprobado**, y revertirse a `false` al terminar. No es requisito para la observación de la §6.0.

### 6.2 Indicadores permitidos (sin tokens)

Recopilar y agregar por intervalo (por ejemplo, diario):
- Nº de eventos `[Observación AUD-006]` (rechazos) por `tv_uuid`.
- Nº de eventos `[Deprecation Warning AUD-006]` (fallback activo), si se usara.
- Nº de `tv_uuid` distintos que intentan query string.
- Nº de conexiones totales por canal (`auth`/header vs. query) — solo conteos.
- Errores de rechazo por query (`device_token in query string is rejected`) como contraste.

**Prohibido** en la telemetría: valor del token, prefijos, hashes, URLs con query completa.

> **Limitación reconocida:** si un dispositivo antiguo no expone ningún identificador adicional fiable, **no puede atribuirse a una pantalla concreta sin aceptar su credencial**. En ese caso, o el intento se rechaza sin asociación (situación por defecto), o se requiere coordinación con el fabricante/operador. **No se inventa** una identificación de dispositivo.

### 6.3 Configuración necesaria para la ventana

- `OBSERVE_QUERY_DEVICE_TOKEN=true` durante la observación, **manteniendo `ALLOW_QUERY_DEVICE_TOKEN=false`**, con fecha/hora de inicio y fin registradas.
- Captura de logs del backend filtrada por el prefijo `[Observación AUD-006]` (y/o `[Deprecation Warning AUD-006]` si aplica), con almacenamiento que no persista el handshake completo.
- **Antes** de habilitar la ventana debe desplegarse la configuración de Nginx endurecida (ver §6.4), para que la propia medición no filtre el secreto.
- **No** se habilita en producción para esta revisión ni sin aprobación.

### 6.4 Verificación y endurecimiento de logging de Nginx (configuración)

El `frontend/nginx.conf` **no define `log_format` propio**, por lo que Nginx usa el formato por defecto `combined`, cuyo campo `"$request"` **incluye la query string**. Si un cliente legacy envía `?device_token=...`, esa URI puede quedar registrada en el access log de Nginx **antes** de que Socket.IO la rechace.

Mitigación preparada (no desplegada en esta misión): `frontend/nginx.conf.hardened` define:
- `log_format nexus_safe_query` que usa `$uri` (sin args) en lugar de `$request`/`$request_uri`.
- `access_log` seguro aplicado **selectivamente** a `/control/socket.io/` y `/socket.io/`.
- Se conservan `error_log` y el resto de la auditoría de acceso (no se desactiva globalmente).

Verificación **offline** automatizada: `tests/nginx-safe-logging.test.js` (4/4) valida estáticamente que el formato seguro no incluye `$request_uri` ni `$query_string` y que se aplica a las rutas de Socket.IO.

> **Estado:** la configuración endurecida **no está desplegada**. La sintaxis ya fue validada **offline** (`nginx -t` en contenedor efímero, Misión 4C); no se afirma que los logs de producción estén corregidos. La comprobación del contenedor activo requiere ventana controlada (ver §8.1).

## 7. Fase 4 — Criterios de decisión de retirada

Retirar el fallback y fijar `ALLOW_QUERY_DEVICE_TOKEN=false` de forma permanente cuando se cumpla **todo** lo siguiente:

1. La ventana de observación se ejecutó **realmente** en producción (no simulada) durante el periodo aprobado.
2. No se observaron nuevos eventos `[Observación AUD-006]`/`[Deprecation Warning AUD-006]`, **o** las pantallas detectadas fueron migradas/revinculadas (ver DEV-RUN-003).
3. El inventario físico quedó conciliado con el inventario lógico (no hay pantallas sin clasificar).
4. Seguridad confirma que la telemetría no persistió tokens.
5. La configuración de Nginx endurecida fue desplegada y verificada, de modo que la observación/uso no quede registrado con la query string.
6. Existe plan de reversión: ante regresión, volver temporalmente a `false`/`true` según corresponda sin cambios de datos.

Si **no** se cumple lo anterior, el fallback permanece, con estado AUD-006 "mitigado / pendiente de verificación de campo".

## 8. Fases de despliegue y validación (secuencia explícita)

Cada fase es un hito distinto; **no presumir** que una fase posterior ocurrió.

| Fase | Descripción | Estado |
|---|---|---|
| **V1 — Validación automatizada de código** | Suites unitarias (rechazo por defecto, observación sin aceptación, no fuga de tokens, precedencia de opciones). | Ejecutada en Misión 4C (32/32 en `device-auth`; 105/105 en regresión sin BD). |
| **V2 — Verificación de configuración de Nginx** | `tests/nginx-safe-logging.test.js` (offline, 4/4) y `nginx -t` sobre `nginx.conf.hardened` (contenedor efímero). | **Sintaxis validada en 4C.** Verificación de los **logs del contenedor activo** pendiente (bloqueada; requiere ventana controlada). |
| **V3 — Despliegue de telemetría** | Desplegar build con `OBSERVE_QUERY_DEVICE_TOKEN=true`, `ALLOW_QUERY_DEVICE_TOKEN=false` y Nginx endurecido. | **No iniciada.** |
| **V4 — Periodo de observación de campo** | Recoger y agregar indicadores sin tokens durante el periodo aprobado. | **No iniciada.** No afirmar que ha comenzado. |
| **V5 — Retiro definitivo del fallback** | Eliminar el bloque de compatibilidad y/o marcar la variable obsoleta; verificar clientes. | **No iniciada.** |
| **R — Rollback** | Ver §9. | Preparado conceptualmente. |

### 8.1 Verificación de Nginx (offline ejecutada; runtime bloqueado)

En Misión 4C se validó **offline** la sintaxis con `docker run --rm -v <conf>:/etc/nginx/conf.d/default.conf:ro nginx:alpine nginx -t` para `nginx.conf` y `nginx.conf.hardened`, y se demostró empíricamente que el formato por defecto registra la query string mientras `nexus_safe_query` no la registra.

Queda **bloqueada** la verificación del entorno activo (no se reinicia ni altera el contenedor en uso). Procedimiento futuro en ventana controlada:
1. Desplegar `frontend/nginx.conf.hardened` como `default.conf` del contenedor de frontend.
2. `nginx -t` si el despliegue lo permite, o validación equivalente en el nuevo contenedor antes de servir tráfico.
3. Inspeccionar una muestra de access logs (nuevos y posteriores al despliegue) para confirmar que la query string no aparece.

## 9. Fase 5 — Retirada definitiva (versión futura)

1. Aprobar la ventana y publicar aviso interno.
2. Desplegar la versión con `ALLOW_QUERY_DEVICE_TOKEN` eliminado del código (el bloque de compatibilidad) y/o documentar la variable como obsoleta en `.env.example`.
3. Verificar que todas las pantallas del inventario conectan por `auth`/header.
4. Retirar `/control` legacy y actualizar documentación (ADR/README/KB).
5. Cerrar AUD-006 como **Corregido y verificado** solo con evidencia de la campaña real.

## 10. Plan de reversión

- Durante la ventana: si aparece una pantalla que solo soporta query, **no** retirar el fallback; migrar/revinculnar esa pantalla (DEV-RUN-003).
- Tras la retirada: si una pantalla falla, evaluar reactivar el fallback temporal con aprobación, registrar el `tv_uuid` (sin token) y planificar su migración.
- No se revierten: la validación criptográfica del token, el rechazo por defecto ni la exigencia de `X-Device-Token` en playlist/heartbeat.

## 11. Criterios de cierre

- Inventario de pantallas completo y sin secretos.
- Versiones de cliente documentadas (`auth` vs. query).
- Ventana de observación ejecutada y agregada sin tokens (o declarada como **no ejecutada**).
- Configuración de Nginx endurecida desplegada y verificada.
- Decisión de retirada registrada con responsables y fecha.
- AUD-006 cerrado solo con evidencia de campo; en su defecto, permanece abierto/mitigado.

## 12. Referencias

- [AUDIT-FULL-2026-10-09 — AUD-006](../../13-testing/results/AUDIT-FULL-2026-10-09.md)
- [MISSION-4B-VERIFICATION-REPORT-2026-10-10](../../13-testing/results/MISSION-4B-VERIFICATION-REPORT-2026-10-10.md)
- [MISSION-4C-VERIFICATION-REPORT-2026-10-10](../../13-testing/results/MISSION-4C-VERIFICATION-REPORT-2026-10-10.md)
- [DEV-RUN-003 — Revinculación de pantallas](./DEV-RUN-003-screen-pairing-recommission.md)
- [ADR-005 — Autenticación de dispositivos TV](../01-architecture/decisions/ADR-005-device-authentication.md)

---

## 13. Estado de ejecución (Misión de cierre — 2026-10-13)

> Registro de lo ejecutado realmente contra el entorno activo. Las fases §3–§8 siguen siendo el procedimiento; esta sección documenta el cumplimiento parcial con evidencia. Informe completo: [`FINAL-CLOSURE-2026-10-13.md`](../../13-testing/results/FINAL-CLOSURE-2026-10-13.md).

### 13.1 Fases ejecutadas

| Fase | Estado | Evidencia |
|---|---|---|
| **V1 — Inventario lógico de clientes (§4)** | ✅ Ejecutada | Cliente oficial `frontend/src/components/TVPlayer.jsx`: REST con `X-Device-Token` y Socket.IO con `auth: {tv_uuid, device_token}` + `query: {}` **vacío** (líneas 348–356, 578–584) → nunca usa query string. `waitingPairingSocket.js`: query solo con `session_code`/`waiting_pairing` (no es el token de dispositivo). Uso de `device_token` en query en el repositorio: **solo en pruebas negativas** (`tests/device-auth.test.js`). |
| **V1 — Inventario de pantallas (§4)** | ✅ Ejecutada | 8 pantallas: `PT204` con credencial activa; 6 activas **sin credencial** que responden `401 requires_pairing` (`tv.js:58-64`, sin ruta sin credencial); ninguna pantalla opera sin token. |
| **V2 — Logging de Nginx (§6.4, §8.1)** | ✅ **Desplegada y verificada en runtime** | Antes: sonda con `device_token` en query vía `:28080` → el backend rechazó **pero el access log registró `device_token=…`** (medido: 1 línea en `docker logs tv-frontend`). Despliegue: `frontend/nginx.conf` ← `frontend/nginx.conf.hardened` (2026-10-13T16:02:15Z, `docker compose build frontend` + `--force-recreate`), `nginx -t` OK, `nexus_safe_query` 2→4, hash contenedor == local. Después: **0 líneas sensibles**, rechazo intacto, handshake válido por Nginx → `connect`, E2E completo verde. |
| **V3 — Telemetría de observación (§6.0, §6.2)** | ✅ **Activada** | `OBSERVE_QUERY_DEVICE_TOKEN=true` desde **2026-10-13T15:25:28Z**; `ALLOW_QUERY_DEVICE_TOKEN=false` **sin cambios** (nunca habilitado). 5 líneas `[Observación AUD-006]` con solo `tv_uuid` + flags; **0 hex64, 0 valores de token** (verificado por patrón). |

### 13.2 Fase pendiente (dependencia externa auténtica)

| Fase | Estado | Qué falta |
|---|---|---|
| **V4 — Observación con dispositivos físicos reales (§6.3, §7)** | ⏳ **PENDIENTE — Operaciones** | Este laboratorio **no dispone de pantallas físicas ni clientes legacy reales**; no se puede ejecutar ni simula su resultado. Requiere: ventana con la telemetría V3 ya desplegada (lo está), pantallas reales encendidas operando durante el periodo de observación definido por §6.3, y agregado semanal sin tokens. Cierre definitivo de AUD-006 solo con esa evidencia de campo (§11). |

### 13.3 Trazabilidad de reversión

- Revertir V2: restaurar la versión previa de `frontend/nginx.conf` (historial Git), rebuild + recreate del frontend. Efecto: los logs de socket.io vuelven a registrar query strings — **no recomendado**.
- Revertir V3: `OBSERVE_QUERY_DEVICE_TOKEN=false` + recreate del backend. (V4 debería completarse antes de retirar la observación.)
