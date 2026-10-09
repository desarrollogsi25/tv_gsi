# Nexus TV Enterprise — Matriz Maestra de Conciliación de Estados (Status Reconciliation)

> **Documento:** STATUS-RECONCILIATION.md
> **Versión:** 1.0.0
> **Fecha de Emisión:** 2026-10-09
> **Autor / Auditor:** Senior QA Engineer & Technical Auditor
> **Estándar:** Dev Team · Estándar Operativo v1.0
> **Alineación Normativa:** ISO 9001:2015, ISO/IEC 27001:2022, ISO/IEC 90003:2018, ISO/IEC 25010:2023
> **Propósito:** Establecer una fuente única de verdad auditada para todos los bugs, riesgos y observaciones del sistema, conciliando discrepancias entre reportes individuales, índices maestros y registros de riesgo.

---

## 1. Criterios Taxonómicos de Estado (Definiciones Estrictas)

| Estado | Definición Operativa | Color / Badge |
| :--- | :--- | :--- |
| **ABIERTO** | El defecto está demostrado empíricamente o verificado en código y no existe corrección funcional aplicada. | 🔴 `ABIERTO` |
| **EN INVESTIGACIÓN** | Existen indicios o anomalías, pero falta aislar la causa raíz o determinar su alcance exacto. | 🟡 `EN INVESTIGACIÓN` |
| **EN CORRECCIÓN** | Existe una remediación en curso de desarrollo que no ha sido desplegada ni sometida a pruebas. | 🟠 `EN CORRECCIÓN` |
| **PENDIENTE DE RETEST** | La corrección está implementada en código, pero falta evidencia dinámica o validación en el entorno real correspondiente. | 🔵 `PENDIENTE DE RETEST` |
| **MITIGADO** | Existe una medida técnica que reduce la probabilidad o el impacto, pero permanece un riesgo residual o la solución definitiva es parcial. | 🟣 `MITIGADO` |
| **RESUELTO** | La corrección está implementada y el retest específico ha pasado satisfactoriamente con evidencia verificable. | 🟢 `RESUELTO` |
| **CERRADO** | Cierre formal administrativo respaldado por reporte de retest aprobado y actualización documental en repositorio. | ⚪ `CERRADO` |
| **BLOQUEADO / UNKNOWN** | No se dispone de información suficiente o la prueba no puede ejecutarse de forma segura sin degradar entornos compartidos. | ⚫ `UNKNOWN` |

---

## 2. Matriz Maestra Conciliada de Bugs (BUG-001 a BUG-011)

| ID | Título del Defecto | Severidad | Prioridad | Estado en Reporte Individual | Estado en `README.md` | Estado en `risk-register.md` | Evidencia de Corrección | Retest Ejecutado | Estado Definitivo |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **BUG-001** | Omisión de franja horaria en consulta y reproducción de playlists | Alta | **P0** | `BUG-001-schedule-ignored.md`: Cerrado<br>*`BUG-001-playlist-time-window.md`*: Confirmado (Duplicado histórico) | Cerrado | RSK-001: 🔴 Bug confirmado | `src/routes/tv.js` (L89-92): Filtro `LOCALTIME BETWEEN pc.start_time AND pc.end_time` | Tests unitarios 14–18 (`schedule-window.test.mjs`) y consulta en vivo a API local devolviendo 33 ítems filtrados | 🟢 **RESUELTO / CERRADO** |
| **BUG-002** | Inconsistencia de archivos faltantes en disco (404) y bucle acelerado | Alta | **P0** | `BUG-002-missing-media-404.md`: Cerrado<br>*`BUG-002-missing-local-media.md`*: Confirmado (Duplicado histórico) | Cerrado | RSK-002: 🔴 Bug confirmado<br>RSK-014: 🔴 Bug confirmado | BD purgada a 6 archivos locales existentes; `TVPlayer.jsx` (L542): `handleImageError` con backoff 2s | Verificación exhaustiva: 6 de 6 archivos responden HTTP 200 OK vía Nginx y Node.js | 🟢 **RESUELTO / CERRADO** |
| **BUG-003** | Layout responsive y controles fuera de viewport en panel Admin | Media | **P2** | `BUG-003-static-admin-layout.md`: 🟢 Resuelto / Verificado | 🟢 Resuelto | RSK-008: 🟢 Resuelto | `Admin.css`, `TVRegister.jsx`, `BroadcastPanel.jsx` y `ContentManager.jsx`: wrap/apilado responsive | Playwright 1.64 + Chrome local: 20 combinaciones, 4 vistas y 5 anchos. Sin scroll horizontal del documento o `.admin-main`; controles principales dentro del viewport. Build Vite correcto | 🟢 **RESUELTO / VERIFICADO** |
| **BUG-004** | Omisión de normalización de días con tildes en persistencia de playlists | Media | **P1** | `BUG-004-unnormalized-days-accent.md`: Cerrado | Cerrado | RSK-007: 🔵 Observación<br>RSK-016: 🔴 Bug confirmado | `src/routes/tv.js` (L99, L102): Soporte para variantes con y sin tilde (`miércoles`/`miercoles`, `sábado`/`sabado`) | Tests unitarios 5–8 (`normalize-days.test.mjs`) aprobados (100% PASS) | 🟢 **RESUELTO / CERRADO** |
| **BUG-005** | Ausencia total de autenticación en API administrativa y CORS irrestricto | Crítica | **P0** | `BUG-005-unauthenticated-admin-api.md`: Cerrado | Cerrado | RSK-005: 🔵 Observación<br>RSK-018: 🔴 Bug confirmado | `src/middlewares/auth.js`: Verificación JWT Bearer; `nx_tv.js`: CORS restringido a lista blanca | Tests unitarios 1–4 (`authMiddleware.test.mjs`) aprobados; peticiones anónimas responden HTTP 401 | 🟢 **RESUELTO / CERRADO** |
| **BUG-006** | Fallo fatal de sintaxis en `start-tv-kiosk.ps1` por EM DASH en PowerShell 5.1 | Crítica | **P0** | `BUG-006-kiosk-utf8-bom-parser-error.md`: Resuelto (PASS) | Resuelto | RSK-020: 🟢 Mitigado | `start-tv-kiosk.ps1`: Saneado a ASCII puro; creado `start-tv-kiosk.cmd` con bypass local efímero | AST Parser en PowerShell 5.1 arrojando 0 errores; Chrome Kiosk iniciado con PID | 🟢 **RESUELTO / CERRADO** |
| **BUG-007** | Imposibilidad de simular TV nueva por reutilización incondicional de perfil | Alta | **P1** | `BUG-007-kiosk-profile-identity-reuse.md`: Resuelto (PASS) | Resuelto | RSK-021: 🟢 Mitigado | `start-tv-kiosk.ps1`: Añadido `-NewProfile` y `-ProfileId` generando carpetas efímeras aisladas | Invocación de prueba creando directorio aislado sin alterar perfil base ni heredar UUID | 🟢 **RESUELTO / CERRADO** |
| **BUG-008** | Ausencia de control de acceso basado en roles (RBAC) en API administrativa | Crítica | **P0** | `BUG-008-missing-rbac-admin-api.md`: 🟢 Resuelto | 🟢 Resuelto | RSK-022: 🟢 Cerrado | `requireRole` implementado en `auth.js` y aplicado en 30 endpoints de `admin.js` y `media.js`; checks WS en `sockets/index.js` | Suite automatizada `tests/rbac.test.js` (14/14 tests PASS) verificando 401, 403 e intercepción antes de handlers | 🟢 **RESUELTO / CERRADO** |
| **BUG-009** | Operación destructiva de volúmenes PostgreSQL en `run-local.ps1` (Opción 6) | Crítica | **P1** | `BUG-009-destructive-docker-down-volume-wipe.md`: 🔴 Abierto *(Discrepancia interna)* | 🟢 Resuelto | RSK-023: 🟢 Mitigado | `run-local.ps1` (L149): Eliminado `-v`, ejecuta `docker compose down --remove-orphans` | Inspección estática del script verificada. Falta prueba de ciclo completo de persistencia en máquina aislada | 🟣 **MITIGADO / PENDIENTE DE RETEST DE CICLO COMPLETO** |
| **BUG-010** | Copia ciega de `.env.example` con secretos por defecto en `run-local.ps1` | Alta | **P1** | `BUG-010-default-insecure-env-copy.md`: 🟣 Mitigado (Script CSPRNG activo; pendiente validación ante .env preexistente) | 🟣 Mitigado | RSK-024: 🟣 Mitigado / Pendiente Retest | `run-local.ps1` (L60-74): Generador CSPRNG de 32 bytes para `JWT_SECRET` y 16 bytes para DB si `.env` falta | Prueba en sandbox aislado: generación segura OK, logs limpios OK, `.env` personalizado preservado OK. Brecha confirmada: `.env` preexistente con plantilla no es saneado | 🟣 **MITIGADO (Script CSPRNG activo; pendiente detección de plantilla preexistente)** |
| **BUG-011** | Bloqueo de autoplay en YouTube IFrame Player y falso positivo de audio visual | Alta | **P1** | `BUG-011-youtube-autoplay-unmuted-block.md`: 🟢 Resuelto tras retest dinámico | 🟢 Resuelto | RSK-027: 🟢 Resuelto | `YouTubePlayer.jsx`: `autoplay=1`, `mute=1`, watchdog y `onAutoplayBlocked`; `TVPlayer.jsx`: nuevo arranque silenciado por sesión | IFrame real: autoplay sin interacción, evento PLAYING, transición ENDED, mute/unmute y error 150 de video no disponible; Vite build final correcto | 🟢 **RESUELTO** |

---

## 3. Matriz Maestra de Riesgos Técnicos y Operativos (RSK-001 a RSK-027)

| ID | Descripción del Riesgo | Clasificación | Impacto | Probabilidad | Prioridad | Estado Definitivo | Justificación Técnica / Deuda Residual |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| **RSK-001** | Omisión de franja horaria en playlists | Bug mitigado | Alto | Certeza | P0 | 🟢 **Cerrado** | Mitigado en `tv.js`. Tests unitarios 14–18 pasan. |
| **RSK-002** | Inconsistencia de archivos físicos en disco (404) | Bug mitigado | Alto | Certeza | P0 | 🟢 **Cerrado** | BD purgada a 6 archivos locales válidos; 6/6 devuelven HTTP 200. |
| **RSK-003** | Volatilidad del estado de broadcast prioritario en RAM | Riesgo operacional | Alto | Alta | P1 | 🟡 **Abierto / En Investigación** | Si Node.js reinicia durante un comunicado prioritario, el override se pierde. Falta persistencia en BD o Redis. |
| **RSK-004** | Bloqueo de audio por Autoplay Policy en Smart TVs | Limitación técnica | Medio | Alta | P1 | 🟣 **Mitigado (Diseño)** | Muted-first implementado; Smart TVs comerciales requieren interacción inicial en control remoto (`handleGlobalInteraction`). |
| **RSK-005** | Ausencia total de autenticación en API | Vulnerabilidad mitigada | Crítico | Certeza | P0 | 🟢 **Cerrado** | JWT implementado en `/api/admin`. (Autorización por roles migrada a RSK-022 / BUG-008). |
| **RSK-006** | Discrepancia de tamaño de subida Multer 500M vs Nginx 300M | Config mismatch | Medio | Media | P2 | 🟢 **Cerrado** | Unificado a 500M en Nginx y Multer. |
| **RSK-007** | Incompatibilidad de días de la semana por tildes | Bug mitigado | Medio | Media | P2 | 🟢 **Cerrado** | Soporte bidireccional de tildes con overlap `&&` en query SQL. |
| **RSK-008** | Controles y tabs fuera de viewport en Admin responsive | Usabilidad mitigada | Bajo | Mitigado | P2 | 🟢 **Resuelto / Verificado** | Retest Playwright + Chrome local en 4 rutas y 5 viewports: controles dentro del ancho y sin scroll horizontal de documento o `.admin-main`; TC-004. |
| **RSK-009** | Falta de paginación en catálogo multimedia | Deuda técnica | Bajo | Baja | P3 | 🔵 **Observación (Abierto)** | `SELECT * FROM nexus_tv.content` descarga catálogo completo sin `LIMIT/OFFSET`. |
| **RSK-010** | Comportamiento de Iframe Power BI ante X-Frame-Options | Dependencia externa | Alto | Media | P1 | 🟡 **Riesgo por Comprobar** | URLs privadas de Power BI requieren autenticación interactiva de Microsoft en la TV. |
| **RSK-011** | Emisión ciega de `/bind-screen` ante PIN inexistente | Resiliencia de API | Bajo | Alta | P3 | 🔵 **Observación (Abierto)** | Responde HTTP 200 aunque la sala de socket esté vacía si el PIN no está en memoria. |
| **RSK-012** | Override temporal con target inexistente en RAM | Bug mitigado | Bajo | Mitigado | P3 | 🟢 **Cerrado** | Valida existencia de `tv_uuid` en PostgreSQL y responde 404 si no existe. |
| **RSK-013** | Campanilla sonora silenciosa por `suspended` en AudioContext | Audio Policy | Medio | Alta | P2 | 🟣 **Mitigado (Diseño)** | `ctx.resume()` ejecutado en `playChime`; condicionado a políticas de Chromium. |
| **RSK-014** | Bucle acelerado por `onError` inmediato en imágenes 404 | Bug mitigado | Alto | Certeza | P0 | 🟢 **Cerrado** | Backoff de 2s implementado en `handleImageError` ([TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx)). |
| **RSK-015** | Conflicto en límite de subida | Config mismatch | Bajo | Mitigado | P1 | 🟢 **Cerrado** | Directivas Nginx y Express/Multer unificadas a 500M. |
| **RSK-016** | Omisión de normalización de días con tildes | Bug mitigado | Medio | Certeza | P1 | 🟢 **Cerrado** | Resuelto en `tv.js` y validado en suite de pruebas. |
| **RSK-017** | Desincronización de WebSockets por `alert`/`confirm` | Bug mitigado | Medio | Mitigado | P2 | 🟢 **Cerrado** | Erradicados diálogos nativos bloqueantes; reemplazados por Toast modal no bloqueante. |
| **RSK-018** | API administrativa pública y CORS `*` | Vulnerabilidad mitigada | Crítico | Certeza | P0 | 🟢 **Cerrado** | JWT en `/api/admin` y CORS restringido a `allowedOrigins`. |
| **RSK-019** | Condición de carrera en limpieza de medios huérfanos | Integridad de datos | Bajo | Mitigado | P2 | 🟢 **Cerrado** | Cron implementa gracia de 1 hora (`stats.mtimeMs < oneHourAgo`). |
| **RSK-020** | Colapso de PowerShell 5.1 por EM DASH en launcher | Bug mitigado | Crítico | Certeza | P0 | 🟢 **Cerrado** | Saneado a ASCII puro y wrapper `start-tv-kiosk.cmd`. Verificado en TC-RETEST-KIOSK-001. |
| **RSK-021** | Reutilización de perfil Chromium en Kiosk | Bug mitigado | Alto | Certeza | P1 | 🟢 **Cerrado** | Selector `-NewProfile` operativo con sandboxing temporal verificado. |
| **RSK-022** | Ausencia de RBAC en API administrativa (BUG-008) | Vulnerabilidad mitigada | Crítico | Mitigado | P0 | 🟢 **Cerrado** | `requireRole` implementado y aplicado en 30 endpoints de `/api/admin` y `/api/tv-content`. Verificado en TC-022 (14/14 PASS). |
| **RSK-023** | Destrucción de volumen en `down -v` (BUG-009) | Integridad de datos | Crítico | Mitigado | P1 | 🟣 **Mitigado / Pendiente Retest** | Flag `-v` eliminado en `run-local.ps1`. Falta prueba de ciclo de reinicio aislada. |
| **RSK-024** | Arranque con secretos de `.env.example` (BUG-010) | Seguridad operativa | Alto | Mitigado | P1 | 🟣 **Mitigado / Pendiente Retest** | Generador aleatorio CSPRNG activo en `run-local.ps1` si falta `.env`. Brecha residual: no valida ni bloquea ante `.env` preexistente con plantilla. |
| **RSK-025** | Suplantación de TV en WebSockets `/control` sin credenciales | Vulnerabilidad mitigada | Alto | Mitigado | P0 | 🟢 **Cerrado y Desplegado** | Retest vivo 2026-10-09: sin credencial e inválida rechazadas; dos identidades distintas con credenciales propias aceptadas; token A contra UUID B rechazado por credencial inválida. Estado de prueba restaurado al finalizar. |
| **RSK-026** | Desconexión inconsistente en `onlineScreens` ante múltiples conexiones | Concurrencia | Medio | Mitigado | P2 | 🟢 **Cerrado y Desplegado** | ADR-005 implementado y desplegado en Docker: Mapeo multi-socket `screenSockets` preserva presencia online si hay sockets activos remanentes. Verificado en test #17 de TC-SECURITY-WS-001 y prueba #6 de retest en vivo. |
| **RSK-027** | Autoplay de YouTube y estado de audio | Bug mitigado | Alto | Mitigado | P0 | 🟢 **Resuelto** | Retest dinámico real en TC-YOUTUBE-AUTOPLAY-LIVE-001; la preferencia de audio persistida ya no inicia una sesión sin silenciar. |
| **RSK-028** | Autenticación obligatoria en playlist (BUG-013) | Divulgación de datos | Medio | Retest live aprobado; flota requiere credenciales | P2 | 🟢 **Mitigado y desplegado** | 401 live sin/con token falso; CORS permite cabecera. No hay hashes de dispositivo en las 8 filas activas/inactivas; el camino live legítimo 200 queda pendiente de aprovisionamiento. |
| **RSK-029** | Identidad inequívoca de sesión de pairing (BUG-014) | Concurrencia / Operativo | Medio | Integración aprobada; colisión de registro verificada live | P2 | 🟣 **Mitigado y desplegado; binding/TTL live pendiente** | Dos sockets con PIN duplicado recibieron IDs distintos en backend activo; no se vinculó ningún perfil ni se esperó TTL de cinco minutos sobre pantallas reales. |

---

## 4. Registro de Discrepancias Documentales Detectadas y Resueltas

1. **Duplicidad de Reportes para BUG-001:**
   - **Discrepancia:** Existían dos archivos en `docs/11-incidents/bugs/`: `BUG-001-playlist-time-window.md` (marcado como abierto/confirmado) y `BUG-001-schedule-ignored.md` (marcado como cerrado/validado).
   - **Resolución:** Prevalece `BUG-001-schedule-ignored.md`. El archivo `BUG-001-playlist-time-window.md` se conserva como borrador histórico inicial con nota de enlace formal a la versión validada.
2. **Duplicidad de Reportes para BUG-002:**
   - **Discrepancia:** Existían `BUG-002-missing-local-media.md` (marcado como abierto/confirmado) y `BUG-002-missing-media-404.md` (marcado como cerrado/validado).
   - **Resolución:** Prevalece `BUG-002-missing-media-404.md`. El catálogo de base de datos fue purgado a 6 archivos coincidentes al 100% con disco físico, y se comprobó respuesta HTTP 200 OK en los 6 activos.
3. **Desincronización de Estado en BUG-009 y BUG-010:**
   - **Discrepancia:** En sus reportes individuales aparecían como `🔴 Abierto`, mientras que en `docs/11-incidents/README.md` figuraban como `🟢 Resuelto`.
   - **Resolución:** Se concilian ambos reportes individuales. BUG-009 queda como `🟣 MITIGADO / PENDIENTE DE RETEST DE CICLO COMPLETO` (debido a la ausencia de una prueba de apagado y reencendido físico aislado para certificar preservación), y BUG-010 queda como `🟢 RESUELTO (Mitigado en script con CSPRNG)`.
4. **Retest Dinámico de BUG-011 (Autoplay YouTube):**
   - **Evidencia:** El 2026-10-09 un arnés temporal montó el componente real y verificó autoplay silenciado, evento `ENDED`, unlock después de interacción y manejo de error de video no disponible. La prueba detectó que una preferencia vieja de audio podía provocar pausa al intentar unmute sin gesto.
   - **Resolución:** `TVPlayer` ya no restaura esa preferencia como autorización de audio al arrancar. Retest posterior con la bandera antigua sembrada confirmó inicio y permanencia en `PLAYING` silenciado hasta interacción. BUG-011/RSK-027 queda resuelto; evidencia en TC-YOUTUBE-AUTOPLAY-LIVE-001.
5. **Inconsistencia de Estados en `risk-register.md`:**
   - **Discrepancia:** Los riesgos RSK-001, RSK-002, RSK-005, RSK-014, RSK-016 y RSK-018 permanecían con la marca roja `🔴 Bug confirmado` a pesar de estar mitigados en código y validados en suites automatizadas.
   - **Resolución:** Se actualiza `risk-register.md` para reflejar el estado mitigado/cerrado correspondiente a cada remediación verificada.
6. **Retest responsive dinámico de BUG-003:**
   - **Discrepancia previa:** El retest estaba pendiente por dificultades al descargar/ejecutar el navegador de Playwright.
   - **Ejecución 2026-10-09:** Playwright 1.64 vía `npx` contra Chrome local en 375, 414, 768, 1280 y 1920 px. El primer pase encontró controles desplazados en Register, Content y Broadcast; se adaptaron tablas, botones y barras de pestañas.
   - **Verificación posterior:** 20 combinaciones de ruta/ancho, max X de controles inferior al viewport, y `document`/`.admin-main` sin scroll horizontal en todas. Build Vite correcto. BUG-003/RSK-008 queda **Resuelto / Verificado**; evidencia en `docs/13-testing/results/TC-004.md`.
7. **Reclasificación y Auditoría Aislada de BUG-010 (.env y Secretos CSPRNG):**
   - **Discrepancia:** Se asumía resuelto totalmente por la presencia del generador CSPRNG en `run-local.ps1`.
   - **Resolución:** La prueba en sandbox aislado confirmó que el script genera secretos seguros y no filtra credenciales en logs cuando `.env` no existe, y preserva `.env` existentes. No obstante, se demostró empíricamente que si un archivo `.env` preexistente contiene las cadenas de plantilla de ejemplo, el script omite la validación y arranca con secretos inseguros. Se reclasifica formalmente a `🟣 MITIGADO (Script CSPRNG activo; pendiente detección de plantilla preexistente)`.
8. **Cierre Definitivo de BUG-008 / RSK-022 (RBAC en Backend):**
   - **Discrepancia:** La API administrativa y de contenidos multimedia validaba únicamente firma JWT sin discriminar el rol del usuario (`viewer`, `editor`, `admin`), permitiendo a usuarios de solo lectura mutar y eliminar pantallas, listas y contenidos.
   - **Resolución:** Se implementó el middleware `requireRole` en `src/middlewares/auth.js` y se blindaron los 26 endpoints de `src/routes/admin.js` y los 4 endpoints de `src/routes/media.js`, además de restringir el control WebSocket en `src/sockets/index.js`. Se validó exhaustivamente con la suite automatizada `tests/rbac.test.js` (14/14 tests PASS), demostrando intercepción HTTP 403 antes de que se ejecuten mutaciones de base de datos o subidas de archivos. Se reclasifica a 🟢 **RESUELTO / CERRADO** en todos los registros normativos.


## 6. Validación de continuación: rotación y riesgo residual (2026-10-09)

- La prueba viva contra `tv-backend` (puerto 23002) confirmó rechazo de conexiones `/control` sin credencial y con credencial inválida; autenticación correcta de dos identidades de prueba distintas con credenciales independientes; y rechazo decisivo del token A al usar el UUID B (`invalid device credentials`). Se usaron una pantalla QA existente y una fila B temporal; el estado original de la primera se restauró y la fila temporal se eliminó.
- La contraseña del rol PostgreSQL configurado se cambió mediante `ALTER ROLE`; conexión TCP con la configuración actual de `.env` y `SELECT 1` fueron correctos. Backend reconstruido/recreado de forma aislada, sin bajar otros servicios ni tocar volúmenes.
- Se retiró la clave JWT de desarrollo. El backend activo rechazó un token firmado con la clave histórica y aceptó un token de `/api/auth/me` firmado con la clave actual. Esto verifica la clave JWT activa, pero no sustituye el login administrativo con contraseña.
- El login administrativo válido no fue probado porque no se dispone de una contraseña verificada. No se intentó recuperar ni adivinarla, ni se modificaron cuentas.
- Estado de `nexus_tv.tv_screens`: 8 total, 7 activas, 1 inactiva, ninguna con hash; sin diferencia respecto al preflight. Las cuentas de `nexus_tv.users` no fueron alteradas; no hay captura preflight suficiente para afirmar si pruebas anteriores cambiaron otros datos.
- El traspaso reportó una posible exposición de credencial administrativa en logs persistidos del IDE fuera del repositorio. Se documenta como RSK-030; el log no se inspeccionó ni purgó desde esta misión y requiere revisión/rotación por canal autorizado.
- `scratch/check_admin_pass.cjs` no se ejecutó y se eliminó. El escáner y el retest quedan en `scratch/` ignorado por Git; el retest no guarda ni imprime credenciales.

El estado previo de BUG-013/RSK-028 y BUG-014/RSK-029 fue reemplazado por la evidencia live consolidada en la sección 7.

### Corrección posterior — login administrativo (2026-10-09)

La inspección de `scripts/e2e_full_audit.cjs` confirmó que `E2E_ADMIN_PASSWORD` es una entrada requerida por el retest QA de login de `admin_nexus`; el script ejecuta `POST /api/auth/login` y valida HTTP 200 y el token. Se rotó la contraseña de esa cuenta, se guardó solo en `.env` ignorado y el endpoint real devolvió HTTP 200. El JWT recibido fue verificado con la clave JWT activa y contenía la identidad y el rol administrativos esperados. Por tanto, la nota anterior de login pendiente queda reemplazada. El transcript del IDE sigue sin inspección ni purga.

## 7. Despliegue controlado y retest live BUG-012/013/014 (2026-10-09)

- Se ejecutaron `docker compose build backend`, `docker compose build frontend` y `docker compose up -d --no-deps backend frontend`. No se ejecutó `down`, no se recreó `db` y no se alteraron datos.
- `docker compose ps`: `tv-backend`, `tv-frontend` y `tv-db` quedaron `Up` y `healthy`; backend publicó 23002, frontend 28080 y PostgreSQL 25432.
- PostgreSQL mantuvo el mismo ID de contenedor, hora de inicio, volumen montado `tv_gsi_tv_pgdata` y hora `pg_postmaster_start_time()` antes/después. Los conteos de `tv_screens/playlists/content/users` se mantuvieron `8/4/46/4`. Lectura adicional: 7 pantallas activas, 0 filas con `device_token_hash`.
- Backend health `/api/status`: HTTP 200. Frontend `/`: HTTP 200.
- Playlist live en backend: sin `X-Device-Token` HTTP 401; token de prueba inválido HTTP 401. OPTIONS preflight HTTP 204 y `Access-Control-Allow-Headers` incluyó `X-Device-Token`. No se probó el caso live de token legítimo porque la BD no tiene ningún hash de dispositivo; esa limitación requiere aprovisionar/revincular pantallas, sin hacerlo en esta misión.
- `/control` sin credencial: conexión rechazada. Login administrativo real: HTTP 200; JWT verificado con la configuración JWT activa y rol `admin`, sin guardar ni mostrar token/contraseña.
- BUG-014 live: dos sockets de espera simultáneos con el mismo PIN figuraron en `/api/admin/waiting-screens` con dos `pairingSessionId` distintos. Se desconectaron al finalizar; no se enlazaron perfiles. El binding y el TTL completo de cinco minutos no se probaron live sobre registros reales.
- Suite automatizada: `node --test`, con entorno `NODE_ENV=test` y dotenv precargado, 63/63 PASS. Reporte detallado: `docs/13-testing/results/TC-LIVE-DEPLOY-2026-10-09.md`.

**Estado consolidado:** BUG-012/RSK-025 permanece cerrado/desplegado según su retest de autenticación y el rechazo live sin credencial; BUG-013/RSK-028 queda mitigado y desplegado frente a lectura no autenticada, con aprovisionamiento de credenciales pendientes para una prueba positiva live; BUG-014/RSK-029 queda mitigado/desplegado y la identidad ante PIN duplicado fue verificada live, con binding/TTL live aún pendiente.
