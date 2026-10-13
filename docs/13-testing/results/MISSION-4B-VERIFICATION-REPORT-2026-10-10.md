# INFORME DE VERIFICACIÓN — MISIÓN 4B: REVISIÓN INDEPENDIENTE Y PLAN DE TRANSICIÓN DE AUD-006 / AUD-007

**Proyecto:** Nexus TV Enterprise (`tv_gsi`)  
**Fecha:** 2026-10-10  
**Área:** Seguridad de Canales en Tiempo Real (Socket.IO) y Política de Publicación de Medios  
**Responsable:** Revisión independiente (QA/Security)  
**Estado:** AUD-006 Mitigado en Código / Pendiente de Verificación de Campo — AUD-007 Pendiente de Decisión de Producto

---

## 1. Alcance y método

Revisión **adversarial y focalizada** de los cambios de MISIÓN 4A sobre AUD-006 y elaboración del plan de transición y del registro de decisión de AUD-007. No se repitió la auditoría completa ni se reconstruyeron implementaciones.

Archivos inspeccionados: `src/sockets/index.js`, `.env.example`, `tests/device-auth.test.js`, clientes Socket.IO (`frontend/src/components/TVPlayer.jsx`, `frontend/src/components/admin/TVControl.jsx`, `frontend/src/utils/waitingPairingSocket.js`), `src/utils/deviceAuth.js`, `src/routes/tv.js`, `frontend/nginx.conf`, `docs/01-architecture/decisions/ADR-005-device-authentication.md` y `docs/13-testing/results/*`.

---

## 2. Preservación del workspace y del entorno

- No se ejecutó `git reset`, `git clean`, commits, pushes ni cambios de rama.
- No se escribió en el PostgreSQL activo (`tv-db`, puerto 25432), no se reiniciaron servicios y no se alteraron volúmenes.
- No se leyeron ni imprimieron secretos de `.env`.
- IDs de hallazgos conservados (AUD-006, AUD-007).
- No se modificó la política multimedia (`nginx.conf`, rutas de medios, autorización efectiva de `/media/*`).

---

## 3. Revisión adversarial de AUD-006

### 3.1 Verificaciones en el código efectivo

| # | Verificación | Evidencia en código | Resultado |
|---|---|---|---|
| 1 | El valor predeterminado rechaza `device_token` en query string | `src/sockets/index.js:20-22` (default `false`), `:46-48` (rechazo) | **Cumple** |
| 2 | El fallback solo se habilita por configuración explícita | `:20-22` (`opts.allowQueryDeviceToken` o `env === 'true'`) | **Cumple** |
| 3 | Los mecanismos permitidos validan contra la pantalla correcta | `:42`, `:77-98` (`auth`/header → hash SHA-256 del `tv_uuid`) | **Cumple** |
| 4 | Los tokens completos no aparecen en logs, errores ni métricas | Sin logger de URL en la app; advertencia solo imprime `tv_uuid`; errores sin valor | **Cumple** |
| 5 | Las pruebas distinguen fallback activado/desactivado | Tests 22–27 | **Cumple** |
| 6 | No se declara compatibilidad con hardware físico sin evidencia | Informes separan clientes de código (compatibles) de pantallas físicas (incertidumbre) | **Cumple** |

### 3.2 Defecto confirmado y corregido

**D1 — Telemetría de retiro incompleta (menor, AUD-006).**  
La condición de advertencia era `queryDeviceToken && allowQueryDeviceToken && !authDeviceToken`. Si un cliente transitorio enviaba `device_token` tanto en `auth`/header como en query, no se emitía `[Deprecation Warning AUD-006]`, quedando invisible al inventario de retirada (objetivo explícito del plan de campo).

**Corrección:** la advertencia se emite siempre que exista `query.device_token` con el fallback habilitado, indicando el canal, y **sin** registrar el token:

```js
if (queryDeviceToken && allowQueryDeviceToken) {
    const channel = authDeviceToken ? 'auth/header (query ignorada)' : 'query string (fallback activo)';
    console.warn(`⚠️ [Deprecation Warning AUD-006] ... (tv_uuid: ${tvUuid || 'unknown'}, channel: ${channel}). ...`);
}
```

**Evidencia:** test 26 (nuevo) falla con el código previo y pasa tras la corrección.

### 3.3 Robustez de pruebas (corregida)

**D2 — Dependencia de entorno en el valor predeterminado.** El hub global de la suite se construía con `initSockets` sin opciones, por lo que el resultado del test 22 dependía de la variable de entorno del host. Se fijó `process.env.ALLOW_QUERY_DEVICE_TOKEN = 'false'` al inicio del archivo y se añadió el **test 27**, que verifica que `allowQueryDeviceToken: false` explícito prevalece aunque el entorno esté en `true`.

### 3.4 Riesgo residual señalado (abordado en Misión 4C)

El rechazo por defecto ocurre en el middleware de Socket.IO; si un cliente legacy envía `?device_token=...`, la URL del handshake puede quedar en **access logs de Nginx/proxies antes del rechazo**. El `false` por defecto no evita ese registro en origen. En Misión 4B no se modificó `nginx.conf` por restricción de alcance.

**Suplemento (MISIÓN 4C):** se demostró empíricamente con un contenedor Nginx efímero que el formato de log por defecto (`combined`) **sí incluye la query string** en `$request`. Se preparó `frontend/nginx.conf.hardened` (reemplazo completo y válido de `default.conf`, verificado con `nginx -t`) que usa un `log_format` basado en `$uri` (sin argumentos) aplicado selectivamente a `/socket.io/` y `/control/socket.io/`. **Mitigación preparada, no desplegada:** no se afirma que los logs de producción ya estén corregidos (ver informe de Misión 4C y DEV-RUN-004 §6.4-§8).

---

## 4. Pruebas ejecutadas (comandos reales)

Runtime del host: **Node v20.18.0** (por debajo de `engines >=24 <25`; ver limitación en §7).

| Comando | Resultado |
|---|---|
| `node --test tests/device-auth.test.js` (baseline, antes de cambios) | **25/25 PASS, 0 fail** |
| `node --test tests/device-auth.test.js` (tras añadir tests 26–27) | **27/27 PASS, 0 fail** |
| `node --test tests/pairing-session.test.js` | **5/5 PASS, 0 fail** |
| Regresión sin BD: `device-auth`, `pairing-session`, `auth`, `rbac`, `playlist-auth`, `playlist-playback`, `tv-heartbeat`, `schedule-window`, `normalize-days`, `media-upload` | **96/96 PASS, 0 fail, 0 skipped** |
| `node --check src/sockets/index.js` y `node --check tests/device-auth.test.js` | OK |
| `git diff --check` | Limpio (inicialmente detectó un *blank line at EOF* en `tests/device-auth.test.js`, corregido) |
| `git status --short` / `git diff --stat` | Ejecutados (ver §6) |

**Naturaleza de las pruebas:** las 96 pruebas son unitarias/aisladas con *mocks* (no integración real contra PostgreSQL). No se presentan como integración.

**No re-ejecutadas:** `pairing-ack`, `qa-least-privilege`, `tv-heartbeat-integration`, `clean-bootstrap` (dependen del PostgreSQL QA y no están afectadas por el cambio, limitado a la rama de advertencia de telemetría). Se omiten para no escribir en el entorno de datos.

---

## 5. Plan de retirada de AUD-006

Creado [DEV-RUN-004 — Retirada segura del fallback `device_token` en query string](../../07-operations/runbooks/DEV-RUN-004-aud006-query-token-retirement.md). Cubre: inventario de clientes, verificación de versiones, detección del uso antiguo sin registrar secretos, configuración necesaria, criterios de retirada y rollback.

**Importante:** no se ha desplegado ni observado ninguna ventana de monitorización en producción; el runbook **no requiere** modificar ni reiniciar el entorno activo y **no se declara** uso/no uso comprobado del mecanismo antiguo.

---

## 6. Registro de decisión AUD-007

Creado [ADR-006 — Política de acceso a recursos multimedia (`/media/*`)](../../01-architecture/decisions/ADR-006-media-access-policy.md). Compara:

- **Opción A — Recursos públicos por diseño**
- **Opción B — URLs firmadas temporales (HMAC)**
- **Opción C — Acceso autorizado por dispositivo**

Dimensiones evaluadas: compatibilidad `TVPlayer`, reproducción HTML5, peticiones HTTP `Range`, caché/CDN, revocación, expiración, pantallas físicas y complejidad de despliegue, además de ventajas, riesgos, impacto en clientes y requisitos a confirmar por Producto.

**Estado:** **Pendiente de decisión de producto.** No se inventó una decisión de negocio; no se modificaron `nginx.conf`, rutas de medios ni la autorización de `/media/*`.

---

## 7. Riesgos residuales y limitaciones

1. **AUD-006 abierto:** falta verificación de campo con hardware físico; la compatibilidad de pantallas no soportadas en código no está demostrada.
2. **Logging del proxy:** el formato de log por defecto de Nginx incluye la query string (demostrado en Misión 4C). Mitigación preparada en `frontend/nginx.conf.hardened` y validada con `nginx -t`; **pendiente de despliegue y verificación efectiva** en el entorno activo, que no se ha modificado (ver informe de Misión 4C).
3. **Runtime:** esta verificación se ejecutó en host con Node v20.18.0; no sustituye la validación en el runtime fijado por CI (`Node 24 LTS`). Las suites no-DB pasaron igualmente.
4. **Integración con PostgreSQL:** no re-ejecutada en esta misión (fuera del alcance afectado).
5. **AUD-007:** bloqueado hasta decisión de producto e implementación verificada.

---

## 8. Estado consolidado

| Hallazgo | Estado vigente |
|---|---|
| **AUD-006** | **Mitigado en código / Pendiente de verificación de campo** (ver Misión 4C: observación sin aceptación + mitigación de logging preparada, no desplegada) |
| **AUD-007** | **Pendiente de decisión de producto** |

---

## 9. Trazabilidad de archivos

**Modificados en Misión 4B:**
- `src/sockets/index.js` (telemetría de deprecación sin fuga de token).
- `tests/device-auth.test.js` (tests 26–27 y determinismo de entorno).
- `docs/13-testing/results/AUDIT-FULL-2026-10-09.md` (sección 23 y estado AUD-006).

**Creados en Misión 4B:**
- `docs/01-architecture/decisions/ADR-006-media-access-policy.md`
- `docs/07-operations/runbooks/DEV-RUN-004-aud006-query-token-retirement.md`
- `docs/13-testing/results/MISSION-4B-VERIFICATION-REPORT-2026-10-10.md` (este informe)

---

## 10. Confirmación final

- [x] Workspace previo preservado íntegramente.
- [x] Cero commits, pushes o cambios de rama.
- [x] Cero escrituras/alteraciones sobre el PostgreSQL activo o volúmenes.
- [x] Pruebas de autenticación afectadas y regresión sin BD ejecutadas: 27/27 y 96/96 PASS.
- [x] `git diff --check` limpio; `git status --short` y `git diff --stat` ejecutados.
- [x] AUD-006 y AUD-007 mantenidos en sus estados pendientes correspondientes.
