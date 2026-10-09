# Nexus TV Enterprise — Sistema de Gestión de Incidentes & Bugs

> **Estándar:** Incident Tracking & Knowledge Base (KB)  
> **Versión:** 2.0.0 Dual-Hub  
> **Fecha de Inicialización:** 2026-10-08  

---

## 1. Ciclo de Vida del Incidente

Todo defecto funcional, visual o técnico identificado durante las sesiones de QA debe registrarse formalmente siguiendo este flujo:

```
[ Detección / Hallazgo ]
          │
          ▼
   [ Registro Inicial ] ──► (Asignación de ID: BUG-XXX)
          │
          ▼
   [ Reproducción & Evidencia ] (Comandos, logs, capturas)
          │
          ▼
   [ Análisis de Causa Raíz (RCA) ]
          │
          ▼
   [ Propuesta de Solución ] (Sin aplicar código hasta autorización)
          │
          ▼
   [ Verificación / Retest ]
          │
          ▼
   [ Cierre & Registro en KB ]
```

---

## 2. Plantilla Estándar para Nuevos Tickets (`BUG-XXX.md`)

```markdown
# BUG-XXX: [Título Breve y Específico del Problema]

- **Módulo Afectado:** (ej. TV Engine, Pairing, Broadcast, API, UI)
- **Severidad:** (Crítica | Alta | Media | Baja)
- **Prioridad:** (P0 | P1 | P2 | P3)
- **Fecha de Detección:** YYYY-MM-DD
- **Estado:** (Abierto | En Análisis | Resuelto | Descartado)

### 1. Descripción
[Qué ocurre exactamente y qué se esperaba que ocurriera]

### 2. Pasos para Reproducir
1. Paso 1
2. Paso 2
3. Paso 3

### 3. Evidencia Técnica
- **Archivo / Componente:** `ruta/al/archivo.ext:Lxx-Lyy`
- **Comando / Petición:** `curl ...`
- **Respuesta / Log:** `...`

### 4. Impacto en el Negocio / Sistema
[Afecta reproducción, bloquea pantallas, expone seguridad, etc.]

### 5. Causa Raíz Identificada
[Explicación técnica del porqué ocurre la falla]

### 6. Criterio de Verificación (QA Test)
[Cómo validar que el bug quedó resuelto de forma definitiva]
```

---

## 3. Registro de Hallazgos Previos del Reconocimiento Inicial

*(Los siguientes hallazgos fueron detectados durante la auditoría técnica. Se documentan con evidencia verificable para su posterior prueba sistemática antes de su conversión formal a BUG IDs confirmados).*

---

### Hallazgo H-01: Omisión de Condición Horaria en Consulta de Playlists

* **Qué se observó:** El endpoint que entrega los contenidos a reproducir por pantalla devuelve todos los ítems programados para el día actual sin discriminar si la hora del sistema coincide con la franja horaria programada.
* **Dónde está:** [src/routes/tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/tv.js#L70-L100) y [frontend/src/components/TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx).
* **Evidencia Técnica:**
  ```sql
  -- Extracto de query en tv.js:
  WHERE ts.tv_uuid = $1
    AND ts.is_active = true
    AND pc.days_of_week @> ARRAY[...]::text[]
  ORDER BY pc.start_time ASC, c.id ASC;
  ```
  La cláusula `WHERE` no contiene `CURRENT_TIME BETWEEN pc.start_time AND pc.end_time`.
* **Impacto Potencial:** Videos o contenidos configurados para emitirse exclusivamente en la mañana (ej. 06:00 a 08:59) se reproducen también durante la tarde y la noche.
* **Cómo probarlo:** Consultar `GET /api/tv/:uuid/playlist` en horario vespertino y verificar la presencia de ítems con `start_time: 06:00:00, end_time: 08:59:00`.
* **Estado Actual:** 🟠 Bug probable / Requiere confirmación con requerimientos de negocio.

---

### Hallazgo H-02: Registros de Archivos Locales Huérfanos sin Binario en Disco

* **Qué se observó:** En la base de datos existen 28 registros clasificados como `source_type = 'local_file'`, pero en el directorio físico montado en el contenedor (`/app/media`) únicamente existen 4 archivos PNG.
* **Dónde está:** Base de datos tabla `nexus_tv.content` y directorio [media/](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/media).
* **Evidencia Técnica:**
  * Query en BD: `SELECT count(*) FROM nexus_tv.content WHERE source_type = 'local_file';` -> Retorna `28`.
  * Comando en contenedor: `docker exec tv-backend ls -la /app/media` -> Retorna solo 4 archivos de imagen.
* **Impacto Potencial:** Al intentar cargar estos 24 archivos, la TV recibe HTTP 404. El reproductor dispara `onError` y fuerza un salto de contenido, generando parpadeos o saltos erráticos en la reproducción.
* **Cómo probarlo:** Ejecutar peticiones HTTP `HEAD` a cada una de las 24 URLs `/media/<filename>` registradas en BD y registrar las respuestas 404.
* **Estado Actual:** 🔴 Bug confirmado (discrepancia física comprobada al 100%).

---

### Hallazgo H-03: Volatilidad de Transmisiones Prioritarias en Memoria

* **Qué se observó:** El estado de las transmisiones prioritarias de emergencia (**Broadcast Override**) se almacena únicamente en variables de memoria del proceso de Node.js.
* **Dónde está:** [src/sockets/index.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/sockets/index.js#L9-L10).
* **Evidencia Técnica:**
  ```javascript
  let globalTemporaryContent = null;
  const screenTemporaryContent = new Map();
  ```
  No existe llamada a PostgreSQL ni a almacenamiento persistente cuando se ejecuta `POST /api/admin/temporary-content`.
* **Impacto Potencial:** Si el proceso de Node.js se reinicia por mantenimiento o falla transitoria mientras hay un comunicado de emergencia activo, todas las pantallas pierden el comunicado y vuelven a la playlist regular.
* **Cómo probarlo:** Emitir un contenido temporal, reiniciar el backend (`docker restart tv-backend`) y verificar el estado devuelto por `GET /api/admin/active-temporary`.
* **Estado Actual:** 🟡 Riesgo por comprobar.

---

### Hallazgo H-04: Discrepancia en Límite de Tamaño de Archivo (Proxy vs Backend)

* **Qué se observó:** El proxy Nginx y el backend Node.js tienen límites divergentes para el tamaño máximo de archivo.
* **Dónde está:** [frontend/nginx.conf](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/nginx.conf#L4) (`client_max_body_size 300M;`) vs [src/routes/media.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/media.js#L28) (`limits: { fileSize: 500 * 1024 * 1024 }`).
* **Evidencia Técnica:** Nginx intercepta las peticiones antes de llegar a Multer; si un archivo pesa entre 301MB y 500MB, Nginx responderá HTTP 413 Payload Too Large.
* **Impacto Potencial:** Falsas expectativas en el backend o en el usuario final, con fallas silenciosas en la interfaz si no se maneja el error 413.
* **Cómo probarlo:** Intentar subir un archivo de prueba generado de 350MB y verificar el código HTTP de respuesta.
* **Estado Actual:** 🟡 Riesgo por comprobar.

---

### Hallazgo H-05: Inexistencia de Reglas Responsivas en el Panel de Administración

* **Qué se observó:** El archivo de estilos CSS de administración no define ningún breakpoint `@media`.
* **Dónde está:** [frontend/src/components/Admin.css](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/Admin.css).
* **Evidencia Técnica:** Búsqueda textual de `@media` en `Admin.css` devuelve 0 ocurrencias. El sidebar tiene ancho estático `width: 280px;` y el layout usa `width: 100vw;`.
* **Impacto Potencial:** En resoluciones de tablets o móviles (<1024px de ancho), el sidebar comprime la tabla o desborda horizontalmente la ventana.
* **Cómo probarlo:** Abrir la consola de administración en una ventana reducida a 768px de ancho y evaluar usabilidad de tablas y formularios.
* **Estado Actual:** 🔵 Observación de diseño.

---

## 4. Índice de Incidentes Registrados

| Ticket | Módulo | Título | Severidad | Prioridad | Estado | Resolución / Evidencia |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| [BUG-001](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-001-schedule-ignored.md) | TV Engine / Scheduling | Omisión de Franja Horaria en Consulta y Reproducción de Playlists | Alta | P0 | 🟢 Cerrado | Mitigado en `tv.js` con `LOCALTIME BETWEEN pc.start_time AND pc.end_time` |
| [BUG-002](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-002-missing-media-404.md) | Storage / TV Player | Inconsistencia de Archivos Faltantes en Disco y Bucle Acelerado ante HTTP 404 | Alta | P0 | 🟢 Cerrado | Mitigado: 6 archivos en BD coinciden en disco; `handleImageError` con backoff 2s |
| [BUG-003](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-003-static-admin-layout.md) | Admin UI / Layout | Layout Responsive Incompleto y Controles Fuera de Viewport en Panel Admin | Media | P2 | 🟢 Resuelto / Verificado | Playwright + Chrome local en las 4 vistas y 375, 414, 768, 1280 y 1920 px: controles dentro del viewport y sin scroll horizontal interno; ver TC-004 |
| [BUG-004](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-004-unnormalized-days-accent.md) | TV Engine / Data | Omisión de Normalización de Días con Tildes en Persistencia de Playlists | Media | P1 | 🟢 Cerrado | Mitigado: Normalización canónica con operador overlap `&&` en `tv.js` |
| [BUG-005](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-005-unauthenticated-admin-api.md) | Security Gateway | Ausencia Total de Autenticación en API Administrativa y CORS Irrestricto | Crítica | P0 | 🟢 Cerrado | Mitigado: JWT Bearer en `/api/admin`, `/api/auth/login` y lista blanca de CORS |
| [BUG-006](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-006-kiosk-utf8-bom-parser-error.md) | Kiosk Launcher / Scripts | Fallo Fatal de Sintaxis en `start-tv-kiosk.ps1` por EM DASH sin BOM en PowerShell 5.1 | Crítica | P0 | 🟢 Resuelto | Corregido a ASCII puro, wrapper `.cmd` seguro, verificado AST en PS 5.1 (TC-RETEST-KIOSK-001) |
| [BUG-007](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-007-kiosk-profile-identity-reuse.md) | Kiosk / Device Identity | Imposibilidad de Simular TV Nueva por Reutilización Incondicional de Perfil Chromium | Alta | P1 | 🟢 Resuelto | Modo `-NewProfile` genera directorios efímeros aislados sin alterar perfil persistente (TC-RETEST-KIOSK-001) |
| [BUG-008](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-008-missing-rbac-admin-api.md) | Security / Access Control | Ausencia de Control de Acceso Basado en Roles (RBAC) en API Administrativa | Crítica | P0 | 🟢 Resuelto | Middleware `requireRole` implementado en `admin.js` y `media.js`; 14 tests automatizados PASS (TC-022) |
| [BUG-009](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-009-destructive-docker-down-volume-wipe.md) | DevOps / Operations | Operación Destructiva de Volúmenes de BD en `run-local.ps1` (Opción 6 `down -v`) | Crítica | P1 | 🟣 Mitigado | Eliminado flag `-v` en `run-local.ps1` (usa `--remove-orphans`). Pendiente retest de ciclo completo aislado |
| [BUG-010](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-010-default-insecure-env-copy.md) | Security / DevOps | Copia Ciega de `.env.example` con Secretos por Defecto en `run-local.ps1` | Alta | P1 | 🟣 Mitigado | Generador CSPRNG activo en `run-local.ps1` si falta `.env` (verificado en sandbox); pendiente detección ante `.env` preexistente con plantillas |
| [BUG-011](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-011-youtube-autoplay-unmuted-block.md) | Frontend Video Players | Bloqueo de Autoplay en YouTube IFrame Player y Discrepancia en Estado de Audio Visual | Alta | P1 | 🟢 Resuelto | Retest IFrame real confirmó autoplay silenciado, fin de contenido, unlock tras gesto y propagación de error; audio persistido ya no provoca autoplay con sonido |
| [BUG-012](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-012-unauthenticated-tv-websocket-spoofing.md) | Security / WebSockets | Suplantación de Pantallas TV en WebSockets `/control` sin Autenticación (RSK-025) | Crítica | P0 | 🟢 Resuelto y Desplegado | Desplegado en Docker `tv-backend` (port 23002). Credenciales criptográficas (ADR-005), handshake estricto, pairing seguro; validado en vivo (8/8 PASS) y 52/52 tests unitarios |
| [BUG-013](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-013-unauthenticated-playlist-endpoint-exposure.md) | TV Engine / Auth | Exposición de Playlist en `GET /api/tv/:uuid/playlist` sin Verificación de Credencial (RSK-028) | Media | P2 | 🔴 Abierto | Endpoint entrega playlist con solo UUID sin validar token. Pendiente control gradual |
| [BUG-014](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-014-pairing-pin-collision-and-binding-ambiguity.md) | Pairing / Concurrencia | Ambigüedad en Pairing por Colisión de PIN (4 Dígitos) y Ausencia de `socketId` (RSK-029) | Media | P2 | 🔴 Abierto | PIN 1000-9999 vulnerable a colisión; `bindWaitingScreen` resuelve ambiguamente por sessionCode; UI sin debounce |
