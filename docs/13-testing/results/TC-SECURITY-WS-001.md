# Resultado de Prueba: TC-SECURITY-WS-001 — Autenticación de Dispositivos TV y Seguridad de Handshake Socket.IO

> **Caso de Prueba:** TC-SECURITY-WS-001 (incorporando [TC-025](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/test-cases.md))
> **Riesgos Asociados:** [RSK-025](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/risk-register.md) (Suplantación de Pantallas) y [RSK-026](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/risk-register.md) (Falso Offline en Reconexiones)
> **Módulos Involucrados:** `src/sockets/index.js`, `src/utils/deviceAuth.js`, `src/routes/admin.js`, `src/routes/tv.js`, `frontend/src/components/TVPlayer.jsx`, `migrations/05_device_auth.sql`
> **Fecha de Ejecución:** 2026-10-09
> **Ejecutado por:** Senior Security Engineer & QA Lead
> **Alineación Normativa:** ISO/IEC 27001:2022 (A.8.20 Redes, A.8.24 Criptografía, A.9.4.2 Log-on Seguro), ISO/IEC 25010:2023 (Seguridad y Fiabilidad)
> **Estado:** 🟢 APROBADO (18/18 pruebas obligatorias PASS, 2/2 pruebas HTTP PASS, 8/8 fases E2E PASS)

---

## 1. Resumen Ejecutivo

Previamente a esta intervención, el namespace WebSocket `/control` admitía cualquier conexión que declarara el parámetro `tv_uuid` en la query del handshake sin exigir prueba criptográfica alguna. Esto permitía a cualquier estación en la red corporativa suplantar una pantalla, recibir comandos en tiempo real, inyectar telemetría y desplazar a la televisión legítima.

La implementación de la arquitectura **ADR-005** ha remediado esta vulnerabilidad mediante:
1. Tokens opacos de 256 bits (`nxdt_<64 hex>`) generados exclusivamente por el backend durante la vinculación administrativa.
2. Almacenamiento seguro del hash SHA-256 (`device_token_hash`) en PostgreSQL, sin guardar texto plano reutilizable.
3. Handshake estricto en Socket.IO `/control` que valida la correspondencia criptográfica del token, estado activo y vigencia.
4. Entrega privada punto a punto del perfil al socket específico durante el pairing (eliminando broadcasts a salas compartidas).
5. Desconexión segura y revocación inmediata de credenciales al desvincular una pantalla.
6. Gestión multi-socket de presencia (`screenSockets`), evitando falsos estados offline ante reconexiones o aperturas concurrentes.

---

## 2. Cobertura de Pruebas de Seguridad Automatizadas

Ejecutadas mediante el runner nativo en [tests/device-auth.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/device-auth.test.js) con fixtures aislados:

| # | Escenario Obligatorio Evaluado | Condición de Prueba | Resultado Esperado | Resultado Observado | Estado |
| :-: | :--- | :--- | :--- | :--- | :---: |
| **1** | TV sin UUID y sin credencial | Handshake vacío `{}` | No se registra como TV; rechazo seguro | Error: `Authentication required` | ✅ PASS |
| **2** | TV con UUID conocido y sin credencial | Handshake con solo `{ tv_uuid: '...' }` | Rechazo inmediato (RSK-025 mitigado) | Error: `device_token is required` | ✅ PASS |
| **3** | TV con UUID y credencial inexistente | Handshake `{ tv_uuid: '...', device_token: '' }` | Rechazo por credencial vacía | Error: `device_token is required` | ✅ PASS |
| **4** | Credencial malformada | Formato inválido (`not-a-valid-token-format`) | Rechazo por formato sintáctico | Error: `malformed device_token` | ✅ PASS |
| **5** | Credencial de TV A con UUID de TV B | Credencial legítima de A enviada para B | Rechazo por falta de correspondencia | Error: `invalid device credentials` | ✅ PASS |
| **6** | Credencial revocada | Pantalla con `device_token_hash = NULL` | Rechazo por credencial revocada | Error: `pairing required` | ✅ PASS |
| **7** | Pantalla inactiva | Pantalla con `is_active = false` | Rechazo de pantalla deshabilitada | Error: `screen is inactive` | ✅ PASS |
| **8** | Credencial válida de TV A | Credencial legítima de TV A con su UUID | Aceptación; registro en `onlineScreens` | Conectado; presente en mapa online | ✅ PASS |
| **9** | Reconexión con credencial válida | Cierre de socket y nueva conexión | Aceptación si sigue autorizada | Conectado exitosamente | ✅ PASS |
| **10** | Revinculación / Rotación | Nuevo token emitido por el admin | Token previo invalidado inmediatamente | Token previo rechazado; nuevo aceptado | ✅ PASS |
| **11** | PIN duplicado / Sesión inexistente | `bindWaitingScreen` con PIN desconocido | Retorna false; no asigna a terceros | Retorna `false` determinista | ✅ PASS |
| **12** | TV en espera de pairing | `{ waiting_pairing: 'true', session_code }` | Conecta en espera; sin permisos admin | Conectado; comando admin bloqueado | ✅ PASS |
| **13** | Socket admin sin token | Conexión admin sin token JWT | Rechazo en handshake | Error: `Authentication required` | ✅ PASS |
| **14** | Socket admin con rol viewer | JWT válido con `role: 'viewer'` | Rechazo; `/control` exige admin | Error: `Administrator access required` | ✅ PASS |
| **15** | Socket admin con rol editor | JWT válido con `role: 'editor'` | Rechazo; `/control` exige admin | Error: `Administrator access required` | ✅ PASS |
| **16** | Socket admin con rol admin | JWT válido con `role: 'admin'` | Aceptación; ingreso a sala `admins` | Conectado como admin operativo | ✅ PASS |
| **17** | Desconexión de socket antiguo | Dos sockets conectados al mismo UUID; desconexión del primero | Presencia online se preserva (RSK-026) | Pantalla continúa online con socket activo | ✅ PASS |
| **18** | Limpieza de sesión al desconectar | Socket en espera desconecta | Eliminación de `waitingScreens` | Sesión purgada de memoria | ✅ PASS |
| **19** | HTTP `POST /api/tv/login` sin token | Petición `{ tv_uuid }` sin credencial | HTTP 401 Unauthorized | HTTP 401 (`Credencial requerida`) | ✅ PASS |
| **20** | HTTP `POST /api/tv/login` con token | Petición `{ tv_uuid, device_token }` válido | HTTP 200 OK | HTTP 200 (`Autenticación exitosa`) | ✅ PASS |

---

## 3. Prueba E2E de Ciclo Completo de Vida (PostgreSQL Real)

Ejecutada mediante [scripts/test_pairing_lifecycle.cjs](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/scripts/test_pairing_lifecycle.cjs) contra la base de datos persistente Docker (`127.0.0.1:25432`) y servidores HTTP/WebSocket en vivo:

1. **Intento de Suplantación Inicial:** Conexión a `/control` con solo `tv_uuid` -> **RECHAZADO:** `TV authentication failed: device_token is required`.
2. **Conexión en Espera:** TV cliente genera PIN `#4829` y conecta como `waiting_pairing: 'true'` -> **ACEPTADO** (Socket registrado en `waitingScreens`).
3. **Vinculación Administrativa:** Admin ejecuta `POST /api/admin/bind-screen` con PIN `#4829` y perfil `TV E2E Test`:
   * Backend generó una credencial de dispositivo; el valor se omite en este informe.
   * Persiste hash SHA-256 en `nexus_tv.tv_screens`.
   * Emite `command:assign_profile` **exclusivamente al socket ID de la TV**.
4. **Reconexión Autenticada:** TV cliente almacena el token y conecta a `/control` con `auth: { tv_uuid, device_token }` -> **AUTENTICADO** e incorporado a `onlineScreens`.
5. **Autenticación HTTP:** TV consulta `POST /api/tv/login` con credencial -> **HTTP 200 OK**.
6. **Obtención de Playlist:** TV solicita `GET /api/tv/:uuid/playlist` con cabecera `X-Device-Token` -> **HTTP 200 OK**.
7. **Desvinculación (Revocación):** Admin ejecuta `POST /api/admin/screens/:uuid/unlink`:
   * `device_token_hash` actualizado a `NULL` en base de datos.
   * `command:execute: unlink` emitido a la pantalla.
   * Desconexión forzosa de sockets activos (`disconnectSockets`).
8. **Intento de Reconexión con Token Revocado:** Conexión rechazada con `TV authentication failed: screen is inactive`.

---

## 4. Regresión y Compatibilidad

* **Suite de Pruebas Global:** `npm test` ejecutó exitosamente las **52 pruebas** unitarias y de integración del proyecto (0 fallos).
* **Compilación Frontend:** `npm run build` en `frontend/` compiló en 284ms sin advertencias sintácticas ni roturas en los componentes.
* **Pantallas Preexistentes:** Las pantallas que contaban con `tv_uuid` pero sin token transicionan limpiamente al modo de espera con PIN `#xxxx`, permitiendo su revinculación inmediata desde el panel administrativo sin pérdida de datos.

---

## 5. Conciliación de Entornos: Copia Local vs Contenedor Docker en Ejecución

Durante la auditoría se compararon los hashes SHA-256 de los archivos locales frente a los archivos dentro del contenedor en ejecución `tv-backend` (puerto 23002):
* **Copia Local:** Contiene `src/utils/deviceAuth.js` y las versiones protegidas de `src/sockets/index.js`, `src/routes/tv.js`, `src/routes/admin.js`.
* **Contenedor `tv-backend` en Ejecución:** Ejecuta una imagen construida previamente que no contiene `deviceAuth.js` (`sha256sum: can't open /app/src/utils/deviceAuth.js`). Se comprobó mediante sondeo de socket en puerto 23002 que el contenedor activo admite conexiones no autenticadas con solo `?tv_uuid=...`.
* **Causa de la Discrepancia Previa:** En `docker-compose.yml`, el servicio `backend` construye una imagen estática y únicamente monta el volumen `./media:/app/media` (sin montar `./src`).
* **Despliegue Controlado Realizado (2026-10-09):**
  1. Respaldo de seguridad de PostgreSQL verificado: `scratch/nexus_tv_backup_pre_deploy.dump` (inspeccionado con `pg_restore -l`).
  2. Migración `migrations/05_device_auth.sql` aplicada a PostgreSQL persistente sin pérdida de datos.
  3. Reconstrucción de la imagen: `docker compose build backend`.
  4. Recreación aislada del servicio: `docker compose up -d --no-deps backend`.
* **Verificación de Hashes Post-Despliegue en `tv-backend`:**
  * `src/sockets/index.js`: `1b7ff14c2ddb45ed740b1045bb322d5a7f26b37c6567b6f202d322c9452d338d` (MATCH)
  * `src/routes/tv.js`: `fe6aefb5b3cd64487a768f94f0b05bf4cbd5c35f0e5573928f8fdced6b95aa0a` (MATCH)
  * `src/routes/admin.js`: `0503761f7dfb94ca3ccd5817c1d6eed32b8b51721bf624be93ae3726d99f1ee5` (MATCH)
  * `src/utils/deviceAuth.js`: `d218957db4cd69ff881fb886aab3d39f60c6e209a040390ebb963ce62b260a26` (MATCH & LOADED)
* **Retest contra Contenedor Real en Vivo (`scratch/test_live_docker_backend.cjs` - Puerto 23002):**
  * Conexión sólo con `tv_uuid`: Rechazada (`TV authentication failed: device_token is required`).
  * Conexión con token malformado: Rechazada (`TV authentication failed: malformed device_token`).
  * Pairing por PIN y emisión de token: Aprobada (Token `nxdt_` entregado punto a punto).
  * Autenticación con token legítimo: Aprobada (Conexión establecida a room de pantalla).
  * Suplantación cruzada: Rechazada.
  * Preservación multi-socket (RSK-026): Aprobada (Desconexión de socket primario mantiene vivo socket secundario).
  * Revocación: Rechazada (`TV authentication failed: screen is inactive`).
  * Salud del sistema: `GET /api/status` HTTP 200, `GET /api/tv/:uuid/playlist` HTTP 200.

---

## 6. Riesgos Residuales Identificados en Auditoría

1. **[BUG-013](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-013-unauthenticated-playlist-endpoint-exposure.md) / [RSK-028](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/risk-register.md):** `GET /api/tv/:tv_uuid/playlist` entrega la programación a cualquier solicitante con el UUID sin exigir token de dispositivo. (Severidad Media / P2).
2. **[BUG-014](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-014-pairing-pin-collision-and-binding-ambiguity.md) / [RSK-029](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/risk-register.md):** PIN de 4 dígitos (1000–9999) con probabilidad de colisión; búsqueda ambigua en `bindWaitingScreen` por `sessionCode` en vez de `socketId`; ausencia de debounce ante doble clic en `TVRegister.jsx`. (Severidad Media / P2).
3. **Dispositivos Previos sin Token:** Las 7 pantallas registradas con anterioridad requieren revinculación administrativa por PIN al conectarse por WebSocket a `/control` para obtener su credencial `nxdt_`.

---

## 7. Dictamen Final

* **RSK-025 (Entorno Activo Docker y Código Local):** 🟢 **RESUELTO Y DESPLEGADO** — El contenedor en producción local `tv-backend` (puerto 23002) rechaza determinísticamente conexiones no autenticadas en `/control` y opera con tokens criptográficos verificados en base de datos.
* **RSK-026 (Presencia Multi-Socket):** 🟢 **RESUELTO Y DESPLEGADO** — La gestión mediante `screenSockets` Set garantiza que desconexiones no matan sesiones legítimas en el backend real.


## 8. Retest posterior: rotación de secretos y validación viva (2026-10-09)

Este apartado registra la continuación del retest con estado real comprobado; prevalece sobre resultados de intentos heredados cuya evidencia no se conservó.

- PostgreSQL: ejecutado `ALTER ROLE` sobre el rol configurado por Compose; después de reconstruir únicamente `backend`, una conexión TCP nueva desde el host con `.env` permitió `SELECT 1`.
- JWT: el fallback de desarrollo fue eliminado de `src/config/jwt.js`; el backend activo rechazó un JWT firmado con la clave histórica de desarrollo y respondió HTTP 200 a `/api/auth/me` con un JWT firmado usando el `JWT_SECRET` actual de `.env`.
- WebSocket `/control` en `127.0.0.1:23002`: sin credencial rechazado (`device_token is required`); credencial inválida rechazada (`invalid device credentials`); identidad A válida aceptada; identidad B distinta, activa y con credencial propia aceptada; token de A presentado contra UUID de B rechazado (`invalid device credentials`).
- Las identidades A y B se prepararon solo para el retest. Se restauró el estado previo de la pantalla QA ID 17 y se eliminó la fila temporal B.
- API: `/api/status` respondió HTTP 200 y `/api/tv/:uuid/playlist` respondió HTTP 200 (`total=0` para la pantalla QA consultada).
- Login administrativo con contraseña válida: **no comprobado**. No se proporcionó una contraseña vigente y no se adivinó ni se restableció la cuenta. El endpoint respondió HTTP 400 al envío de una solicitud incompleta; esto solo valida la ruta de entrada, no un login exitoso.
- Los registros persistidos del IDE indicados en el traspaso siguen como riesgo residual posible. No se inspeccionaron ni purgaron; están fuera del repositorio y requieren intervención/validación del propietario del IDE.

Estado final observado de pantallas: 8 filas, 7 activas, 1 inactiva y 0 con hash de credencial. Coincide con el preflight heredado (8/7/1/0). No se modificaron cuentas de usuario.

### Addendum — T1 QA credential and live admin login (2026-10-09)

Source inspection confirmed that `scripts/e2e_full_audit.cjs` documents `E2E_ADMIN_PASSWORD` as a required test input, defaults the username to `admin_nexus`, and posts both values to `/api/auth/login`, asserting HTTP 200 and a returned token. The administrator password was rotated, the new value stored only in ignored `.env`, and the real endpoint returned HTTP 200. The returned JWT verified with the active JWT secret and carried the expected administrator identity and role. Secret values were not printed. The earlier note that login was untested is superseded by this addendum. The IDE transcript itself remains uninspected and unpurged.
