# ADR-005 — Autenticación Criptográfica de Dispositivos TV y Protección de WebSockets

> **Estado:** Aceptado
> **Fecha:** 2026-10-09
> **Área:** Arquitectura de Seguridad, Identidad de Dispositivos y Canales en Tiempo Real
> **Decisores:** Security Architect, Dev Team Lead & Senior QA Engineer
> **Riesgo Mitigado:** RSK-025 (Suplantación de identidad de pantallas) y RSK-026 (Falso offline en reconexiones)
> **Normativa de Referencia:** ISO/IEC 27001:2022 (A.8.20 Control de Redes, A.8.24 Criptografía, A.9.4.2 Autenticación) / ISO/IEC 25010 (Fiabilidad y Seguridad)

---

## 1. Contexto y Problemática

En versiones anteriores (incluyendo la asunción documentada en ADR-004 §2.3), el namespace WebSocket `/control` y los endpoints HTTP de televisión (`/api/tv/login`, `/api/tv/heartbeat`) admitían conexiones basándose exclusivamente en el parámetro declarativo `tv_uuid`:
```javascript
// Vulnerabilidad previa en src/sockets/index.js
const isTv = Boolean(socket.handshake.query.tv_uuid);
if (isTv || isWaitingTv) return next();
```

Esto constituía el riesgo principal de seguridad **RSK-025**:
1. **Suplantación Trivial:** Cualquier cliente en la red corporativa que conociera o interceptara un `tv_uuid` podía conectarse a `/control`, recibir comandos remotos en vivo (incluyendo URLs de videos y contenidos confidenciales), emitir telemetría falsa y desplazar a la televisión legítima en la tabla de pantallas online.
2. **Entrega Insegura durante Pairing:** Al vincular una pantalla por PIN, el perfil se emitía mediante broadcast a la sala compartida `session:${PIN}`, lo que abría una ventana a colisiones o intercepción de perfiles.
3. **Persistencia y Desconexión:** La desconexión de una pestaña o socket secundario eliminaba incondicionalmente la entrada en `onlineScreens`, marcando a la pantalla física erróneamente como offline (**RSK-026**).

---

## 2. Decisión de Arquitectura

Se implementa un modelo estricto de **Credenciales Criptográficas de Dispositivo (Nexus Device Token)** diferenciado de la autorización administrativa RBAC:

```
┌─────────────────┐       1. Pairing PIN (Handshake)        ┌─────────────────┐
│                 ├────────────────────────────────────────►│                 │
│  TV en Espera   │       2. Emisión Privada de Credencial  │ Backend Nexus TV│
│  (No vinculada) │◄────────────────────────────────────────┤   (/control)    │
│                 │   (command:assign_profile + Token)      │                 │
└────────┬────────┘                                         └────────┬────────┘
         │ 3. Almacena token en localStorage                         │ 4. Persiste SHA-256
         ▼                                                           ▼
┌─────────────────┐       5. WebSocket Handshake con Auth   ┌─────────────────┐
│                 ├────────────────────────────────────────►│ DB PostgreSQL   │
│  TV Registrada  │   auth: { tv_uuid, device_token }       │ nexus_tv.       │
│  y Autenticada  │◄────────────────────────────────────────┤ tv_screens      │
│                 │       6. Conexión Aprobada / Comandos   │ (device_token_  │
└─────────────────┘                                         │      hash)      │
                                                            └─────────────────┘
```

### 2.1. Estructura y Generación de Credenciales
* **Generación Exclusiva en Servidor:** El token es generado únicamente en el backend durante la aprobación administrativa de vinculación (`POST /api/admin/bind-screen`).
* **Entropía Criptográfica:** Cadena opaca con prefijo `nxdt_` y 32 bytes de aleatoriedad criptográfica CSPRNG (`crypto.randomBytes(32).toString('hex')`): 256 bits de entropía.
* **Persistencia Segura (Zero Plaintext):** En PostgreSQL (`nexus_tv.tv_screens`) nunca se almacena el token en texto plano. Se almacena el hash criptográfico SHA-256 (`device_token_hash VARCHAR(64)`) junto con la fecha de emisión (`token_created_at`).
* **Verificación en Tiempo Constante:** La comparación en el handshake se realiza mediante `crypto.timingSafeEqual` para mitigar ataques de temporización (timing attacks).

### 2.2. Protocolo de Handshake de Socket.IO (`/control`)
El handshake valida de manera determinista tres perfiles de conexión mutuamente excluyentes:

1. **Televisión Registrada:**
   * Requiere `auth.tv_uuid` y `auth.device_token` (no en query string para evitar fugas en logs de proxy).
   * Valida formato UUID y sintaxis del token.
   * Valida que la pantalla exista en base de datos y que `is_active = true`.
   * Valida que `device_token_hash` no sea nulo y coincida con el hash del token presentado.
   * Rechaza de forma segura con error explicativo ante cualquier discrepancia.

2. **Televisión en Espera de Pairing:**
   * Requiere `waiting_pairing: 'true'` y `session_code` (PIN de 4-8 caracteres alfanuméricos).
   * **Incompatibilidad Estricta:** Si declara simultáneamente `tv_uuid`, la conexión se rechaza inmediatamente para evitar bypasses de autenticación.
   * No ingresa a salas administrativas ni puede emitir comandos de TV ni de administración.

3. **Consola Administrativa:**
   * Requiere `auth.token` (JWT válido).
   * Exige estrictamente `role === 'admin'`. Roles `editor` o `viewer` son rechazados con HTTP/WS Error (`Administrator access required`).

### 2.3. Entrega Punto a Punto en Pairing (Anti-Colisión)
* La función `bindWaitingScreen` localiza la sesión pendiente por su PIN y emite `command:assign_profile` **exclusivamente al socket ID individual** de la TV solicitante (`controlNs.to(targetSocketId).emit(...)`), eliminando la emisión a salas compartidas `session:${PIN}`.
* El payload incluye `{ ...profile, device_token: rawToken }`.
* El cliente (`TVPlayer.jsx`) almacena el token en `localStorage.setItem('tv_device_token', token)`.

### 2.4. Ciclo de Vida, Revocación y Rotación
* **Revocación:** Al desvincular una pantalla (`POST /api/admin/screens/:uuid/unlink`) o eliminarla (`DELETE`), el servidor establece `device_token_hash = NULL`, emite `command:execute: unlink` y desconecta forzosamente los sockets activos (`controlNamespace.in('tv:' + uuid).disconnectSockets(true)`).
* **Reconexión Rechazada:** Una pantalla con token revocado es rechazada inmediatamente con error de autenticación.
* **Rotación:** Si una pantalla se revincula con un nuevo perfil, el backend genera un nuevo token y sobrescribe el hash en BD, invalidando de inmediato cualquier credencial previa.

### 2.5. Gestión Multi-Socket y Presencia en Red (RSK-026)
* El servidor mantiene `screenSockets = new Map()` (`tv_uuid -> Set<socket.id>`).
* Cuando un socket secundario o pestaña previa se desconecta, `onlineScreens` sólo retira a la pantalla y emite `is_online: false` si el conjunto de sockets activos para ese UUID queda vacío. Si queda un socket activo, la pantalla permanece online sin interrupciones.

---

## 3. Procedimiento de Migración y Pantallas Preexistentes

Para pantallas previamente vinculadas antes de esta actualización (que tienen `tv_uuid` en `localStorage` pero carecen de `device_token`):

1. **Rechazo Seguro sin Ruptura Definitiva:** El backend rechaza el handshake por falta de credencial (`requires_credentials: true` / `requires_pairing: true`).
2. **Fallback Automático en TVPlayer:** Al recibir el rechazo de credenciales en `verifyScreen` o `connect_error`, `TVPlayer.jsx` transiciona automáticamente al estado de espera de pairing, generando un PIN `#xxxx` en pantalla sin borrar el identificador de hardware.
3. **Procedimiento del Operador:**
   * El operador observa el PIN en la pantalla física.
   * Ingresa a la consola administrativa (`/admin`) en la pestaña **Pantallas**.
   * Localiza la pantalla en "Pantallas Detectadas" y selecciona el perfil corporativo correspondiente.
   * El sistema genera y transmite la nueva credencial criptográfica, quedando el dispositivo restablecido y securizado sin intervención en el sistema operativo del quiosco.

---

## 4. Consecuencias y Validación

### 4.1. Consecuencias Positivas
* **Mitigación Completa de RSK-025:** Conocer el UUID ya no otorga ningún acceso al canal de control en tiempo real.
* **Mitigación Completa de RSK-026:** Ausencia de falsos estados offline en reconexiones de red.
* **Alineación ISO 27001:** Cumplimiento de controles A.8.20 y A.9.4.2 para endpoints desatendidos.
* **Seguridad de Datos:** Ningún secreto en texto plano en logs ni en PostgreSQL.

### 4.2. Resultados de Testing
* **Suite Automatizada:** 18/18 pruebas de seguridad en `tests/device-auth.test.js` PASS.
* **Prueba E2E de Ciclo Completo:** `scripts/test_pairing_lifecycle.cjs` (8/8 fases PASS contra PostgreSQL real).
* **Regresión General:** 52/52 tests totales del proyecto PASS. Build de frontend Vite exitoso.
