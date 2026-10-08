# BUG-004: Omisión de Normalización de Días de la Semana con Tildes en Persistencia de Playlists

- **Módulo Afectado:** TV Engine & Admin / Data Normalization (`src/routes/admin.js` & `src/routes/tv.js`)
- **Severidad:** Media
- **Prioridad:** P1
- **Fecha de Detección:** 2026-10-08
- **Estado:** 🟢 Cerrado y Validado en QA
- **Reportado por:** QA Lead & Senior Software Architect

---

### 1. Descripción
En el backend administrativo ([src/routes/admin.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/admin.js#L376-L395)), el endpoint `POST /api/admin/playlists/:id/items` acepta el campo `days_of_week` como un array de strings y lo inserta directamente en la columna `nexus_tv.playlist_content.days_of_week text[]` sin aplicar ninguna normalización de acentos, minúsculas o canonicidad.

Por otra parte, el endpoint de reproducción para las pantallas ([src/routes/tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/tv.js#L88-L98)) consulta los contenidos diarios utilizando el operador de inclusión de arrays de PostgreSQL (`@>`) contra valores con tilde obligatoria: `'miércoles'` y `'sábado'`.

Dado que PostgreSQL realiza comparaciones binarias estrictas en tipos `text[]`, si un cliente o script externo almacena `'miercoles'` o `'sabado'` (sin tilde), el operador `@>` evalúa a `false`, provocando que los contenidos asociados **nunca sean emitidos por las pantallas durante esos días**.

---

### 2. Comportamiento Esperado vs Observado

* **Comportamiento Esperado:**  
  El backend debe normalizar los días de la semana a un formato canónico estandarizado (o desacentuado en minúsculas) en ambas puntas (ingreso de datos y consulta de la TV), de forma que variaciones tipográficas no impidan la entrega de contenido.
* **Comportamiento Observado:**  
  * La consulta `ARRAY['miercoles', 'sabado']::text[] @> ARRAY['miércoles']::text[]` evalúa a `FALSE`.
  * La inserción en `POST /playlists/:id/items` acepta cualquier variación sin normalizar.
  * El contenido programado sin tilde queda huérfano los días miércoles y sábados.

---

### 3. Pasos para Reproducir
1. Ejecutar en PostgreSQL:
   ```sql
   SELECT ARRAY['miercoles', 'sabado']::text[] @> ARRAY['miércoles']::text[] AS match;
   ```
   Observar que el resultado es `f` (falso).
2. Insertar un contenido en una lista mediante `POST /api/admin/playlists/1/items` con `days_of_week: ["lunes", "miercoles"]`.
3. Consultar la playlist desde la TV un día miércoles: el contenido no aparecerá en el listado devuelto.

---

### 4. Evidencia Técnica
* **Inserción sin sanitización en `src/routes/admin.js` (L385-394):**
  ```javascript
  const defaultDays = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const days = (Array.isArray(days_of_week) && days_of_week.length > 0) ? days_of_week : defaultDays;
  await pool.query(query, [id, content_id, start_time, end_time, days]);
  ```
* **Filtro estricto con tildes en `src/routes/tv.js` (L92, L95):**
  ```sql
  WHEN 3 THEN 'miércoles'
  WHEN 6 THEN 'sábado'
  ```
* **Prueba Documentada:** [docs/13-testing/results/TC-006.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-006.md).

---

### 5. Archivos / Componentes Involucrados
* `src/routes/admin.js` (Endpoint `POST /playlists/:id/items`).
* `src/routes/tv.js` (Endpoint `GET /:tv_uuid/playlist`).
* `frontend/src/components/admin/ContentManager.jsx` (Formulario de asignación).

---

### 6. Impacto y Riesgo
* **Impacto Operativo:** Contenidos corporativos programados que misteriosamente no aparecen en pantalla ciertos días de la semana, causando reportes de incidencia difíciles de diagnosticar.
* **Falta de Trazabilidad:** La base de datos acepta los datos sin arrojar advertencias ni errores.

---

### 7. Solución Propuesta (Recomendaciones de Arquitectura)
1. Definir una función de normalización canónica en backend:
   ```javascript
   function normalizeDay(d) {
       return d.toLowerCase()
               .normalize("NFD")
               .replace(/[\u0300-\u036f]/g, ""); // "miércoles" -> "miercoles"
   }
   ```
2. Unificar el almacenamiento y las consultas en PostgreSQL sobre el formato desacentuado (`['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']`) o validar contra un enum estricto.
