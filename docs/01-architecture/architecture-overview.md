# Nexus TV Enterprise — Architecture Overview

> **Estado:** Documentación Técnica de Referencia  
> **Versión:** 2.0.0 Dual-Hub  
> **Fecha:** 2026-10-08  

---

## 1. Componentes del Sistema

Nexus TV opera como un ecosistema modular de 3 niveles desacoplados, contenerizados mediante Docker:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                  │
│   Smart TV Browser (/tv)             Admin Control Center (/admin)     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ HTTP :28080 / WS :28080
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    EDGE REVERSE PROXY (Nginx Alpine)                   │
│   • Servidor SPA Estático (/usr/share/nginx/html)                      │
│   • Proxy Pass /api/           ──► Backend :3002                       │
│   • Proxy Pass /media/         ──► Backend :3002 (no-cache)            │
│   • Proxy Pass /socket.io/     ──► Backend :3002 (WebSockets)          │
│   • Proxy Pass /control/socket.io/ ──► Backend :3002 (Namespace)       │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ Red Interna Docker: tv_network
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 APPLICATION BACKEND (Node.js 20 Express)               │
│   • Express 5 Router (/api/tv, /api/admin, /api/tv-content)            │
│   • Socket.IO Dual-Hub Server (Namespace: /control)                    │
│   • Multer Storage Engine + Fluent-FFmpeg                              │
│   • Node-Cron Background Service                                       │
│   • Filesystem Volume (/app/media)                                     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ TCP Pool :5432
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     DATABASE LAYER (PostgreSQL 17)                     │
│   • Schema: nexus_tv                                                   │
│   • Extension: pgcrypto                                                │
│   • Persistencia: Volume tv_pgdata                                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Detalle de Componentes

### 2.1 Frontend (SPA React 19)
* **Directorio:** `frontend/src`
* **Compilación:** Construido con Vite 8 en una etapa de build multi-stage Docker (`node:20-alpine`) generando artefactos estáticos en `frontend/dist/`.
* **Enrutador:** React Router DOM v7 con tres rutas raíz:
  * `/tv` -> [TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx) (Pantalla de visualización continua).
  * `/admin/*` -> [Admin.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/Admin.jsx) (Shell con navegación y sub-rutas para control, vinculación, broadcast y contenidos).
  * `/` -> Redirección automática a `/tv`.
* **Manejo de Estado Local:** Estado React estándar con `useState` y persistencia en cliente mediante `localStorage` para UUID (`tv_uuid`), volumen (`tv_volume`) y estado de audio desbloqueado (`tv_audio_unlocked`).

### 2.2 Servidor Web & Reverse Proxy (Nginx)
* **Contenedor:** `tv-frontend`
* **Archivo de Configuración:** `frontend/nginx.conf`
* **Responsabilidades:**
  * Escucha en el puerto 8080 (mapeado a 28080 en host).
  * Sirve el SPA compilado con fallback `try_files $uri $uri/ /index.html;`.
  * Cabeceras estrictas anti-caché (`Cache-Control: no-store, no-cache, must-revalidate`).
  * Enrutamiento inverso transparente:
    * `/api/` -> `http://backend:3002/api/` (timeout 300s, max body 300M).
    * `/socket.io/` y `/control/socket.io/` -> Soporte WebSocket con headers `Upgrade` y `Connection "Upgrade"`.
    * `/media/` -> Servido desde el backend suprimiendo headers `ETag` y `Last-Modified` para forzar entrega continua sin respuestas 304.

### 2.3 Backend API & Hub de Tiempo Real (Express + Socket.IO)
* **Contenedor:** `tv-backend`
* **Punto de Entrada:** [nx_tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/nx_tv.js)
* **Responsabilidades:**
  * Servir endpoints REST JSON bajo `/api/tv`, `/api/admin` y `/api/tv-content`.
  * Mantener el Hub de WebSockets `/control` para comando y telemetría de pantallas.
  * Gestionar subida de archivos físicos a `/app/media/` mediante Multer (límite 500MB).
  * Extraer duración exacta de video con `fluent-ffmpeg` ejecutando el binario nativo de Alpine `ffmpeg`.
  * Ejecutar tareas en segundo plano (`node-cron`) para auditoría de pantallas inactivas y limpieza de archivos huérfanos.

### 2.4 Base de Datos (PostgreSQL 17)
* **Contenedor:** `tv-db`
* **Imagen:** `postgres:17-alpine`
* **Esquema:** `nexus_tv`
* **Persistencia:** Volumen Docker nombrado `tv_pgdata` montado en `/var/lib/postgresql/data`.
* **Inicialización:** Script [01_init_nexus_tv.sql](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/migrations/01_init_nexus_tv.sql) montado en `/docker-entrypoint-initdb.d` para inicialización idempotente.

---

## 3. Flujo de Peticiones HTTP (REST)

Ejemplo: Consulta de Playlist desde un televisor:

1. **Cliente:** [TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx) ejecuta:
   ```javascript
   axios.get('/api/tv/a1b2c3d4-e5f6-7890-1234-567890abcdef/playlist')
   ```
2. **Nginx:** Recibe la petición en el puerto 8080, detecta prefijo `/api/` y reenvía por red interna Docker a `http://tv-backend:3002/api/tv/...`.
3. **Express:** [tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/tv.js) captura la ruta `:tv_uuid/playlist`.
4. **PostgreSQL:** El pool de conexiones ejecuta la query relacional que une:
   `tv_screens` -> `tv_playlist` -> `playlists` -> `playlist_content` -> `content`.
   Aplica el filtro del día actual (`pc.days_of_week @> ARRAY[CASE EXTRACT(ISODOW FROM CURRENT_DATE)...]`).
5. **Retorno:** El backend devuelve JSON estructurado con array de contenidos. Nginx retransmite al cliente con cabeceras `no-cache`.

---

## 4. Arquitectura de WebSockets (Socket.IO Hub)

La comunicación en tiempo real se implementa mediante el namespace `/control` en [src/sockets/index.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/sockets/index.js).

### Salas (Rooms) y Topología
* **`admins`:** Consolas de administración conectadas sin parámetros de TV.
* **`session:<PIN>`:** Pantallas no vinculadas que se unen con su PIN temporal (ej. `session:4455`).
* **`tv:<UUID>`:** Pantallas registradas y autenticadas por su UUID (ej. `tv:a1b2c3d4-...`).

### Eventos Principales

```
[ TV Screen ]                          [ Backend Hub (/control) ]                   [ Admin Panel ]
     │                                            │                                      │
     │── (Handshake ?waiting_pairing=true) ──────►│                                      │
     │                                            │─── admin:tv_discovered (PIN) ──────►│
     │                                            │                                      │
     │                                            │◄── bind-screen (POST API) ───────────│
     │◄── command:assign_profile (profile) ───────│                                      │
     │                                            │                                      │
     │── (Re-conecta ?tv_uuid=UUID) ─────────────►│                                      │
     │                                            │─── tv:status_change (online) ───────►│
     │                                            │                                      │
     │── tv:heartbeat (volume, content) ─────────►│─── tv:heartbeat_received ───────────►│
     │                                            │                                      │
     │                                            │◄── admin:send_command (pause/vol) ───│
     │◄── command:execute (cmd, payload) ─────────│                                      │
     │                                            │                                      │
     │                                            │◄── temporary-content (POST API) ─────│
     │◄── command:temporary_content (content) ────│                                      │
```

---

## 5. Almacenamiento y Flujo Multimedia

* **Volumen Físico:** Directorio `./media` en la raíz del proyecto, montado en `/app/media` dentro de `tv-backend`.
* **Proceso de Subida:**
  1. Frontend envía `multipart/form-data` a `/api/tv-content/upload`.
  2. Multer almacena el archivo con nombre sanitizado y prefijo de timestamp único (`<timestamp>-<random>-<name>.<ext>`).
  3. Si es video, `ffmpeg.ffprobe` analiza el archivo en disco para extraer su duración en segundos.
  4. Se inserta un registro en `nexus_tv.content` con `source_type = 'local_file'` y `source_url = '/media/<filename>'`.
* **Entrega al Navegador:**
  Express sirve los archivos vía `express.static` en la ruta `/media/*` con supresión explícita de caché (`no-store, no-cache, must-revalidate`) para garantizar que las actualizaciones de contenido se reflejen de inmediato sin congelarse en la memoria del navegador.

---

## 6. Matriz de Dependencias entre Componentes

| Origen | Destino | Tipo de Conexión | Impacto si Destino Falla |
| :--- | :--- | :--- | :--- |
| `tv-frontend` (Nginx) | `tv-backend` | HTTP Reverse Proxy (TCP 3002) | Error 502 Bad Gateway en toda la API y assets multimedia. |
| `tv-backend` (Node) | `tv-db` (Postgres) | pg.Pool (TCP 5432) | Endpoints de TV y Admin retornan HTTP 500. Sockets siguen activos pero sin datos. |
| `TVPlayer` (Browser) | `tv-backend` | WebSocket `/control` | La pantalla sigue reproduciendo la playlist en caché local pero pierde sincronización remota y broadcast. |
| `tv-backend` (Node) | Volumen `/app/media` | Filesystem I/O | Falla de subidas (HTTP 500) y videos locales retornan 404. |
