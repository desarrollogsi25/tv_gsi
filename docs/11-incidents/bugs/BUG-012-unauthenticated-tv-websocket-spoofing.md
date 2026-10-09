# BUG-012 — Suplantación de Pantallas TV en WebSockets `/control` sin Autenticación

> **ID del Incidente:** BUG-012
> **Riesgos Asociados:** [RSK-025](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/risk-register.md) (Suplantación de Pantallas) / [RSK-026](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/risk-register.md) (Falso Offline)
> **Severidad:** Crítica (P0)
> **Módulo:** Realtime Hub (`src/sockets/index.js`, `src/routes/tv.js`, `src/routes/admin.js`, `frontend/src/components/TVPlayer.jsx`)
> **Fecha de Detección:** 2026-10-09
> **Fecha de Resolución:** 2026-10-09
> **Alineación Normativa:** ISO/IEC 27001:2022 (A.8.20, A.8.24, A.9.4.2), ISO/IEC 25010 (Seguridad y Fiabilidad)
> **Estado:** 🟢 RESUELTO (Validado en [TC-SECURITY-WS-001](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-SECURITY-WS-001.md))

---

## 1. Descripción del Defecto

El middleware de conexión del namespace Socket.IO `/control` admitía cualquier conexión que enviara el parámetro declarativo `tv_uuid` en la query del handshake sin exigir ninguna prueba criptográfica o credencial de posesión:
```javascript
// Código vulnerable previo en src/sockets/index.js
const isTv = Boolean(socket.handshake.query.tv_uuid);
if (isTv || isWaitingTv) return next();
```

### Impacto Real
1. **Suplantación de Identidad:** Cualquier cliente en la LAN con conocimiento de un `tv_uuid` podía conectarse a `/control`, recibir comandos remotos en vivo, capturar URLs de contenido y emitir telemetría falsa (`tv:heartbeat`).
2. **Desplazamiento del Dispositivo Legítimo:** El socket impostor se registraba en `onlineScreens.set(tvUuid, socket.id)`, expulsando de la presencia activa a la pantalla física real.
3. **Colisión de Sesiones de Pairing:** Al emparejar una nueva pantalla, el servidor emitía `command:assign_profile` a la sala compartida `session:${PIN}`, exponiendo las credenciales a terceros conectados con el mismo PIN.
4. **Falso Estado Offline (RSK-026):** Cuando un socket antiguo de la TV se desconectaba, borraba incondicionalmente la entrada en `onlineScreens`, marcando a la pantalla física como offline aunque tuviera otra conexión activa.

---

## 2. Causa Raíz

En el diseño inicial (ADR-004 §2.3), se asumió erróneamente que las pantallas en modo Kiosk debían operar sin fricción de credenciales, considerando que el identificador `tv_uuid` era suficiente prueba de identidad. Sin embargo, un UUID es un identificador público observable en logs, tráfico HTTP y configuraciones, no un secreto de autenticación.

---

## 3. Solución Implementada (ADR-005)

1. **Tokens Criptográficos de Dispositivo:**
   * Generación exclusiva en servidor mediante CSPRNG de 256 bits (`nxdt_<64 hex>`) durante la aprobación administrativa (`POST /api/admin/bind-screen`).
   * Almacenamiento seguro del hash SHA-256 (`device_token_hash VARCHAR(64)`) en `nexus_tv.tv_screens` (migración `migrations/05_device_auth.sql`). Cero credenciales en texto plano en PostgreSQL.
2. **Handshake Estricto en `/control`:**
   * Exige `auth: { tv_uuid, device_token }` en el handshake de Socket.IO (no en query params URL).
   * Verificación en tiempo constante (`crypto.timingSafeEqual`) contra el hash en base de datos.
   * Rechazo determinista de conexiones sin credencial, con credencial ajena, pantalla inactiva o credencial revocada.
3. **Entrega Punto a Punto en Pairing:**
   * La emisión de `command:assign_profile` se dirige exclusivamente al socket ID individual de la pantalla en espera (`controlNs.to(targetSocketId).emit(...)`).
4. **Revocación Inmediata:**
   * En `screens/:uuid/unlink` o `DELETE`, se establece `device_token_hash = NULL`, se emite `command:execute: unlink` y se desconectan los sockets activos de la TV (`disconnectSockets(true)`).
5. **Presencia Multi-Socket Segura:**
   * Mapeo `screenSockets` (`tv_uuid -> Set<socket.id>`). La pantalla permanece online mientras exista al menos un socket activo.

---

## 4. Evidencia de Validación

1. **Suite de Pruebas Unitarias y de Integración:**
   * [tests/device-auth.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/device-auth.test.js): 20/20 pruebas PASS (cubriendo los 18 escenarios obligatorios y 2 pruebas HTTP).
2. **Prueba E2E de Ciclo Completo contra DB Real:**
   * [scripts/test_pairing_lifecycle.cjs](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/scripts/test_pairing_lifecycle.cjs): 8/8 fases aprobadas (rechazo de suplantación, pairing por PIN, recepción de token, reconexión autenticada, login HTTP, obtención de playlist, unlink y rechazo de token revocado).
3. **Regresión Total:**
   * 52/52 pruebas en `npm test` PASS. Compilación Vite exitosa en 284ms.

---

## 5. Despliegue y Validación en Contenedor Activo (`tv-backend`)

* **Fecha de Despliegue:** 2026-10-09
* **Procedimiento:** Migración `migrations/05_device_auth.sql` confirmada en DB, respaldo de base de datos validado (`pg_restore -l`), construcción `docker compose build backend` y recreación aislada `docker compose up -d --no-deps backend` sin afectar datos ni volúmenes persistentes.
* **Hashes SHA-256 Verificados en el Contenedor:**
  * `/app/src/sockets/index.js`: `1b7ff14c2ddb45ed740b1045bb322d5a7f26b37c6567b6f202d322c9452d338d` (Idéntico a local)
  * `/app/src/routes/tv.js`: `fe6aefb5b3cd64487a768f94f0b05bf4cbd5c35f0e5573928f8fdced6b95aa0a` (Idéntico a local)
  * `/app/src/routes/admin.js`: `0503761f7dfb94ca3ccd5817c1d6eed32b8b51721bf624be93ae3726d99f1ee5` (Idéntico a local)
  * `/app/src/utils/deviceAuth.js`: `d218957db4cd69ff881fb886aab3d39f60c6e209a040390ebb963ce62b260a26` (Presente y utilizado)
* **Retest en Vivo (`scratch/test_live_docker_backend.cjs` contra puerto 23002):**
  * Rechazo sin credenciales: `TV authentication failed: device_token is required` (APROBADO).
  * Rechazo con credencial malformada: `TV authentication failed: malformed device_token` (APROBADO).
  * Flujo de pairing por PIN y emisión de token `nxdt_`: APROBADO.
  * Autenticación con token legítimo emitido: APROBADO (Conexión establecida y room asignada).
  * Rechazo de suplantación cruzada: APROBADO.
  * Preservación de presencia multi-socket (RSK-026): APROBADO.
  * Revocación inmediata: APROBADO.
  * Salud del backend y endpoint de playlist: APROBADO (HTTP 200).
* **Estado en Entorno de Producción Local:** 🟢 RESUELTO Y DESPLEGADO.



## 6. Retest de continuación de misión — 2026-10-09

La revisión actual del despliegue confirmó que el código endurecido de autenticación está activo en el backend. El test en vivo adicional está documentado en [TC-SECURITY-WS-001](../../13-testing/results/TC-SECURITY-WS-001.md): ambas identidades de dispositivo de prueba tenían UUID válido, estaban activas y portaban hashes de credenciales diferentes; ambas autenticaron individualmente y la credencial A fue rechazada contra la identidad B. Se restauró el registro QA existente y se eliminó la fila temporal creada para B.

La rotación de secretos también quedó aplicada y comprobada en el despliegue local: autenticación PostgreSQL nueva por TCP exitosa, clave JWT histórica rechazada y clave JWT actual aceptada. El login de administrador con contraseña no queda validado porque no se dispone de una contraseña conocida; no se intentó adivinarla ni se alteró la cuenta.

Permanece un riesgo residual: el traspaso reportó una posible exposición de credencial administrativa en logs persistidos del IDE, fuera del repositorio. No se accedió ni se intentó borrar esos logs; véase RSK-030 en el registro de riesgos.
