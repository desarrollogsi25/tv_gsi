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

*(Espacio reservado para los futuros BUG-001, BUG-002, etc. a medida que se ejecuten y confirmen durante el plan de QA).*

| Ticket | Módulo | Título | Severidad | Estado | Resolución / KB |
| :--- | :--- | :--- | :---: | :---: | :--- |
| [BUG-001](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-001-playlist-time-window.md) | TV Engine / Scheduling | Omisión de Franja Horaria en Consulta y Reproducción de Playlists | Alta | Confirmado | Pendiente de Corrección |
| [BUG-002](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-002-missing-local-media.md) | Storage / Filesystem | Inconsistencia entre Base de Datos y Disco Local (24 Archivos 404) | Alta | Confirmado | Pendiente de Reabastecimiento |
