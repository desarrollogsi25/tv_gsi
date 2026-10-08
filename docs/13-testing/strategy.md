# Nexus TV Enterprise — QA Testing Strategy

> **Tipo de Documento:** Estrategia Maestra de Calidad & QA Plan  
> **Versión del Sistema:** v2.0.0 Dual-Hub  
> **Fecha:** 2026-10-08  
> **Responsable:** QA Lead & Software Auditor  

---

## 1. Visión y Objetivos de la Estrategia

El objetivo primordial del plan de QA es garantizar la **estabilidad continua y operación desatendida 24/7** del sistema Nexus TV Enterprise en pantallas físicas corporativas y consolas administrativas, asegurando que:
1. Ninguna pantalla sufra congelamientos, pantallas negras o bloqueos ante fallas de red, assets 404 o reconexiones.
2. Los comandos remotos y transmisiones prioritarias de emergencia (**Broadcast Override**) se ejecuten con latencia mínima (< 1 segundo) y restauren la programación habitual sin corrupción de estado.
3. El audio opere conforme a las directivas de cada pantalla sin violar las políticas de autoplay del navegador.
4. Se documenten formalmente todos los hallazgos y riesgos técnicos antes de cualquier modificación de código.

---

## 2. Niveles de Prueba

### 2.1 Testing Funcional
* **Acceso y Navegación:** Acceso directo a `/tv` y `/admin`, redirección desde `/`, persistencia de parámetros en query string (`?uuid=...`).
* **Monitoreo de Pantallas:** Visualización del estado en línea/inactiva, conteo de dispositivos, recarga rápida (`reload`).
* **Vinculación PIN (Zero-Touch):** Generación de PIN de 4 dígitos en TV nueva, detección en panel admin, asociación a perfil y auto-inicio de reproducción.
* **Playlists & Contenidos:** Creación de listas, adición de ítems con horarios (`start_time`/`end_time`) y días (`days_of_week`), eliminación de contenidos.
* **Motor Multimedia (Player):** Reproducción continua de video MP4, transiciones de imágenes temporizadas, carga de dashboards Power BI y enlaces de YouTube embebidos.
* **Control Remoto en Tiempo Real:** Ejecución de comandos `play`, `pause`, `next`, `reload`, `unmute`, `mute`, `chime` y ajuste de volumen `0-100%`.
* **Broadcast Prioritario en Vivo:** Emisión temporal a una pantalla o a todas (`all`), superposición visual `EN VIVO`, persistencia del bucle de emergencia y reanudación limpia de la lista programada.
* **Recuperación Automática de Errores:** Avance automático ante archivos 404 (`onError`), reintentos tras errores de red y reconexión automática de WebSockets.

### 2.2 Testing de Integración
* **Frontend SPA ──► Nginx Proxy:** Entrega correcta de assets estáticos, ausencia de respuestas cacheadas 304 indeseadas y límites de body (`client_max_body_size`).
* **Nginx Proxy ──► Express API:** Enrutamiento transparente de `/api/*` y `/media/*` sin pérdida de headers ni timeouts.
* **Nginx Proxy ──► WebSockets (Upgrade):** Negociación exitosa de protocolo WS sobre `/socket.io/` y `/control/socket.io/`.
* **Express API ──► PostgreSQL 17:** Ejecución limpia de queries relacionales en schema `nexus_tv`, manejo del pool de conexiones sin leaks de clientes.
* **Express API ──► Socket.IO Hub:** Emisión de eventos desde endpoints REST hacia salas WebSocket (`controlNs.to('tv:UUID').emit(...)`).
* **Smart TV ──► Backend Telemetría:** Envío de heartbeats HTTP y WS cada 15 segundos reportando contenido actual y estado de audio.

### 2.3 Testing de Datos
* **Colecciones Vacías:** Pantallas sin playlist asignada (`playlist_id = null`), playlists sin contenidos programados, búsquedas sin resultados.
* **Datos Inválidos / Malformados:** UUIDs de TV no válidos, fechas o duraciones negativas, URLs externas inaccesibles o con caracteres especiales.
* **Duplicados:** Registro de UUIDs ya existentes, duplicación de asignación de contenido a la misma playlist en horarios idénticos.
* **Integridad Referencial:** Eliminación de contenido asignado a playlists activas (`ON DELETE CASCADE` o restricciones foráneas), pantallas vinculadas a playlists eliminadas.
* **Inconsistencias de Turnos Horarios:** Validación del cruce de medianoche en rangos de tiempo (ej. 23:00 a 02:00) y coincidencia de tildes en días de la semana (`miércoles` vs `miercoles`).

### 2.4 Testing de Edge Cases & Resiliencia
* **Archivos Multimedia Faltantes:** Comportamiento ante registros de `local_file` cuyo binario fue eliminado del disco (`/app/media/`).
* **Interrupción de Conectividad (Offline Mode):** Comportamiento de la pantalla al perder conexión a Internet o a la red local durante la reproducción de un video.
* **Reinicio del Contenedor Backend:** Pérdida y recuperación de conexiones WebSocket; impacto en el estado en memoria de transmisiones temporales activas.
* **Reinicio / Recarga de la TV:** Comprobación de que la pantalla recupere su perfil desde `localStorage` sin requerir re-vinculación con PIN.
* **Cambios en Vivo en la Playlist:** Modificación de la lista en el admin mientras la TV está en reproducción (evento `playlist_changed`).
* **Múltiples Conexiones Simultáneas:** Varios navegadores abriendo el mismo perfil de TV o múltiples administradores interactuando con la misma consola.

### 2.5 Testing Visual, UX & Responsividad
* **Resoluciones y Ratios de Pantalla:**
  * Resolución Full HD (1920x1080, 16:9) y 4K (3840x2160).
  * Pantallas verticales / Tótems publicitarios (1080x1920, 9:16).
  * Consola Admin en pantallas Desktop estándar (1366x768, 1920x1080).
  * Consola Admin en Tablets (iPad / Galaxy Tab 768px - 1024px) y Móviles (< 768px).
* **Inspección de Layout & CSS:**
  * Desbordamiento horizontal (overflow-x) por ancho estático del sidebar (`280px`).
  * Truncamiento de textos largos en títulos de contenido o nombres de pantalla.
  * Legibilidad del reloj flotante y badges en contrastes de fondo claro/oscuro.
  * Consistencia de elementos visuales (reemplazo de `window.alert` por banners integrados).

---

## 3. Criterios de Aceptación Globales (Definition of Done)

* **Disponibilidad:** 0 caídas del frontend ante respuestas 404 o 500 del backend.
* **Tiempo de Respuesta:** Comandos de control remoto aplicados en pantalla en menos de 1000ms.
* **Resiliencia:** Reconexión automática de WebSockets tras cortes de red sin recargar la página completa si no es estrictamente necesario.
* **Trazabilidad:** Cada falla detectada debe estar categorizada con su respectivo ticket en `docs/11-incidents/` y documentada en la matriz de riesgos.
