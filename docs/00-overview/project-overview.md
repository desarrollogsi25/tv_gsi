# Nexus TV Enterprise (GSI) — Project Overview

> **Estado Operativo:** Local / Entorno Dockerizado  
> **Versión del Sistema:** v2.0.0 (Dual-Hub)  
> **Fecha de Documentación:** 2026-10-08  
> **Última Auditoría:** QA Lead & Senior Software Architect  

---

## 1. Propósito del Sistema

**Nexus TV Enterprise** es una plataforma centralizada de **Cartelería Digital Corporativa (Digital Signage)** diseñada para controlar y sincronizar pantallas y monitores en sedes corporativas (ej. Pisos 1 al 4 de la organización).

El sistema resuelve dos necesidades operativas fundamentales:
1. **Reproducción Autónoma y Continua:** Permitir que pantallas Smart TV o clientes en modo Kiosk reproduzcan de forma desatendida listas de contenidos programados (videos corporativos, imágenes, dashboards analíticos de Power BI y URLs externas) con soporte de desbloqueo automático de audio.
2. **Control Centralizado en Tiempo Real:** Permitir a los administradores monitorear la salud de las pantallas, vincular nuevos televisores sin contacto físico (mediante código PIN), enviar comandos remotos inmediatos (pausa, salto, volumen, reinicio) y emitir transmisiones prioritarias de emergencia (**Broadcast Override**) que interrumpen la programación regular.

---

## 2. Alcance del Proyecto

### En Alcance
* Interfaz web responsiva para televisores (`/tv`) optimizada para operación desatendida y modo Kiosk.
* Consola web de administración (`/admin`) con módulos de monitoreo, vinculación de dispositivos, control remoto, transmisiones prioritarias y gestión de playlists/archivos.
* Hub de comunicación bidireccional en tiempo real basado en WebSockets (Socket.IO).
* Almacenamiento local de archivos multimedia con procesamiento de metadatos mediante FFprobe.
* Base de datos relacional PostgreSQL 17 para persistencia de pantallas, playlists, contenidos y horarios.
* Despliegue en contenedores Docker orquestados por Docker Compose con puertos aislados en el host.

### Fuera de Alcance Actual
* Sistema de autenticación de usuarios por usuario/contraseña o JWT (el acceso administrativo es abierto a la red interna).
* Transcodificación de video bajo demanda (los videos deben subirse en formatos reproducibles por el navegador como MP4 o WebM).
* Sincronización multi-sede distribuida entre diferentes centros de datos o nubes (opera exclusivamente en red local / LAN corporativa).

---

## 3. Módulos del Sistema

| Módulo | Ruta UI | Endpoints Principales | Responsabilidad |
| :--- | :--- | :--- | :--- |
| **TV Player (Kiosk Engine)** | `/tv` | `POST /api/tv/login`<br>`GET /api/tv/:uuid/playlist`<br>`POST /api/tv/heartbeat` | Reproductor desatendido para Smart TVs, bucle infinito, transiciones automáticas y auto-desbloqueo de sonido. |
| **Monitoreo de Pantallas** | `/admin` | `GET /api/admin/screens`<br>`GET /api/admin/stats`<br>`POST /api/admin/screens/:uuid/control` | Vista general en tiempo real del estado de conexión de cada pantalla y disparador de recargas remotas. |
| **Vinculación Remota (Zero-Touch)** | `/admin/register` | `GET /api/admin/waiting-screens`<br>`GET /api/admin/available-profiles`<br>`POST /api/admin/bind-screen` | Auto-detección de TVs nuevas que muestran un PIN de 4 dígitos en pantalla y asignación remota de perfiles. |
| **Consola Remota TV** | `/admin/tv/:uuid` | `GET /api/admin/screens/:uuid`<br>`PUT /api/admin/screens/:uuid`<br>`POST /api/admin/screens/:uuid/control` | Control individual por pantalla: telemetría de audio, slider de volumen, recarga, cambio de playlist y override específico. |
| **Broadcast en Vivo (Override)** | `/admin/broadcast` | `POST /api/admin/temporary-content`<br>`POST /api/admin/clear-temporary`<br>`GET /api/admin/active-temporary` | Interrupción inmediata de la programación para emitir un video/banner a todas o ciertas TVs con audio forzado. |
| **Biblioteca & Playlists** | `/admin/content` | `GET /api/tv-content`<br>`POST /api/tv-content/upload`<br>`POST /api/admin/playlists` | Subida de archivos (hasta 500MB en Multer / 300MB en Nginx), registro de Power BI y programación horaria en listas. |

---

## 4. Usuarios y Actores del Sistema

1. **Operador / Administrador Corporativo:**
   * Accede a la consola web en `http://localhost:28080/admin`.
   * Monitorea pantallas, sube contenidos, programa playlists, vincula televisores y lanza comunicados en vivo.
   * *Restricción real:* No requiere credenciales en el estado actual del código (acceso abierto en red local).
2. **Pantalla Smart TV (Dispositivo Receptor / Kiosk):**
   * Dispositivo físico que ejecuta el navegador en `http://localhost:28080/tv`.
   * Si no tiene perfil, muestra PIN de sesión. Una vez vinculada, reporta telemetría (`heartbeat`) cada 15s y ejecuta comandos recibidos por WebSockets.
3. **Servicios de Segundo Plano (Cron Jobs):**
   * Auditoría de pantallas inactivas cada 15 minutos.
   * Limpieza de archivos multimedia huérfanos a las 03:00 AM diario.

---

## 5. Arquitectura Resumida y Stack Real

* **Frontend:** React 19 + React Router DOM 7 + Axios + Socket.io-client + Vite 8.
* **Web Server / Proxy:** Nginx Alpine (sirve SPA estático y redirige `/api/`, `/media/` y `/socket.io/`).
* **Backend API & Sockets:** Node.js 20 (Alpine) + Express 5 + Socket.io 4 + Multer 2 + fluent-ffmpeg (FFmpeg binario nativo) + node-cron.
* **Base de Datos:** PostgreSQL 17 (Alpine) con esquema relacional dedicado `nexus_tv` y extensión `pgcrypto`.

---

## 6. Servicios y Puertos en Host

Para evitar conflictos con otros servicios en la máquina anfitriona, el sistema utiliza puertos aislados:

| Servicio | Contenedor | Puerto Interno | Puerto Host | Protocolo |
| :--- | :--- | :--- | :--- | :--- |
| **Web SPA (Nginx)** | `tv-frontend` | `8080` | `28080` | HTTP |
| **API & Sockets (Express)** | `tv-backend` | `3002` | `23002` | HTTP / WS |
| **PostgreSQL (v17)** | `tv-db` | `5432` | `25432` | TCP (PostgreSQL) |

---

## 7. Cómo Levantar el Sistema Localmente

### Prerrequisitos
* Docker Desktop instalado y en ejecución en Windows.
* Puertos `28080`, `23002` y `25432` disponibles en el host.

### Comandos de Ejecución

1. **Construir y levantar todos los contenedores:**
   ```powershell
   docker compose up --build -d
   ```
   *(Alternativa interactiva: ejecutar `.\run-local.ps1` y seleccionar opción `1`).*

2. **Verificar el estado y salud de los servicios:**
   ```powershell
   docker compose ps
   # Probar API directamente
   curl http://localhost:23002/api/status
   # Probar Nginx Frontend
   curl http://localhost:28080/
   ```

3. **Lanzar el reproductor en Modo Kiosk con Audio Remoto Desbloqueado:**
   ```powershell
   .\start-tv-kiosk.ps1 -TvUuid "a1b2c3d4-e5f6-7890-1234-567890abcdef"
   ```

---

## 8. Restricciones Conocidas del Sistema

1. **Ausencia de Autenticación en API:** Todas las rutas bajo `/api/admin/*` y `/api/tv-content/*` están expuestas sin middleware de seguridad (JWT o sesiones).
2. **Almacenamiento Local Efímero de Broadcast:** El estado del contenido prioritario (`globalTemporaryContent`) se almacena en la memoria RAM del proceso de Node.js; un reinicio del backend revierte las pantallas a su playlist regular.
3. **Discrepancia en Límites de Archivo:** Multer acepta hasta `500MB`, pero `nginx.conf` tiene configurado `client_max_body_size 300M;`. Subidas entre 301MB y 500MB fallarán a nivel proxy con error HTTP 413.
4. **Dependencia de Interacción para Audio en Navegadores Normales:** Si la Smart TV no arranca con el flag de Kiosk `--autoplay-policy=no-user-gesture-required`, el navegador silencia el audio hasta que se realice un clic o toque físico en la pantalla.

---

## 9. Unknowns Pendientes de Definición de Negocio

1. **Comportamiento de la Franja Horaria (`start_time` / `end_time`):** La base de datos tiene turnos configurados (ej. 06:00 a 08:59), pero la query SQL actual solo filtra por día de la semana. ¿Se debe forzar la ventana horaria exacta o se desea que la playlist rote todo el contenido asignado al día?
2. **Reposición de Archivos Multimedia Faltantes:** Hay 28 registros de `local_file` en la base de datos pero solo 4 archivos físicos en `./media`. ¿Se restaurará un paquete de activos o se limpiarán los contenidos huérfanos durante el testing?
3. **Estrategia de Seguridad para Producción:** ¿Se integrará un login JWT básico antes de pasar a producción o la red permanecerá aislada por hardware/VLAN?
