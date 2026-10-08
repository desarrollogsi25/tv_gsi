# BUG-001: Omisión de Franjas Horarias en Consulta y Reproducción de Playlists

- **Módulo Afectado:** TV Engine / Playlist Scheduling (`src/routes/tv.js` & `frontend/src/components/TVPlayer.jsx`)
- **Severidad:** Alta
- **Prioridad:** P0
- **Fecha de Detección:** 2026-10-08
- **Estado:** 🟢 Cerrado y Validado en QA
- **Reportado por:** QA Lead & Senior Software Architect

---

### 1. Descripción
El sistema define y almacena formalmente en base de datos (`nexus_tv.playlist_content`) franjas horarias de emisión mediante las columnas `start_time` y `end_time`, permitiendo a los operadores programar contenidos en turnos disjuntos (ejemplo: turno mañana `06:00:00` a `08:59:00`, turno mediodía `09:00:00` a `11:59:00` y turno tarde `12:00:00` a `15:59:00`).

Sin embargo, al consultar el endpoint de playlist de cualquier pantalla (`GET /api/tv/:uuid/playlist`), el backend entrega la totalidad de contenidos asignados al día actual sin discriminar si la hora del sistema coincide con la ventana horaria programada. Asimismo, el reproductor web cliente (`TVPlayer.jsx`) itera secuencialmente sobre todos los elementos devueltos sin filtrar por hora. En consecuencia, la programación horaria es ignorada y los contenidos de todos los turnos se reproducen en un único bucle continuo las 24 horas.

---

### 2. Comportamiento Esperado vs Observado

* **Comportamiento Esperado:**  
  La API (o el cliente TV) debe validar la hora actual contra `start_time` y `end_time` de cada contenido programado, entregando o reproduciendo únicamente aquellos ítems cuya franja horaria esté activa en el momento de la consulta.
* **Comportamiento Observado:**  
  A las `18:31 CEST` / `16:31 UTC`, la API devolvió los 45 contenidos configurados en la lista (incluyendo los 15 contenidos del turno matutino `06:00:00 - 08:59:00` y del turno mediodía `09:00:00 - 11:59:00`).

---

### 3. Pasos para Reproducir
1. Identificar una pantalla activa con playlist programada en franjas horarias disjuntas (ej. `PT101`, playlist `TELECOM`, UUID `a1b2c3d4-e5f6-7890-1234-567890abcdef`).
2. Consultar la API fuera del horario de uno de los turnos (ej. consultar a las 18:31 horas):
   ```bash
   curl -s http://localhost:23002/api/tv/a1b2c3d4-e5f6-7890-1234-567890abcdef/playlist
   ```
3. Inspeccionar el array `playlist` de la respuesta JSON y observar la presencia de elementos con `start_time: "06:00:00"` y `end_time: "08:59:00"`.

---

### 4. Evidencia Técnica
* **Consulta SQL en `src/routes/tv.js` (Líneas 86-100):**
  ```sql
  WHERE ts.tv_uuid = $1
    AND ts.is_active = true
    AND pc.days_of_week @> ARRAY[
      CASE EXTRACT(ISODOW FROM CURRENT_DATE)
          WHEN 1 THEN 'lunes'
          ...
      END
    ]::text[]
  ORDER BY pc.start_time ASC, c.id ASC;
  ```
  La consulta únicamente filtra por `days_of_week`. La cláusula de discriminación horaria está ausente.
* **Componente `frontend/src/components/TVPlayer.jsx`:**  
  Las variables `start_time` y `end_time` tienen 0 referencias funcionales en el ciclo de reproducción. El reproductor ejecuta `setPlaylist(res.data.playlist)` y pasa secuencialmente por cada elemento mediante `(prev + 1) % playlist.length`.
* **Prueba Documentada:** [docs/13-testing/results/TC-001.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-001.md).

---

### 5. Archivos / Componentes Involucrados
* `src/routes/tv.js` (Endpoint `GET /:tv_uuid/playlist`).
* `frontend/src/components/TVPlayer.jsx` (Lógica de carga y ciclo de reproducción).
* `nexus_tv.playlist_content` (Tabla de relación en PostgreSQL).

---

### 6. Impacto y Riesgo
* **Impacto Operativo:** Contenidos confidenciales o específicos de turnos (ej. reportes matutinos, avisos de almuerzo, comunicados nocturnos) se proyectan en horarios inadecuados.
* **Degradación Funcional:** La funcionalidad de segmentación horaria prometida en el producto queda 100% inoperativa.

---

### 7. Solución Propuesta (Recomendaciones de Arquitectura)
1. **Opción A (Filtrado en Backend - Recomendada):**
   Incorporar en el query SQL de `src/routes/tv.js`:
   ```sql
   AND (pc.start_time IS NULL OR (CURRENT_TIME >= pc.start_time AND CURRENT_TIME <= pc.end_time))
   ```
2. **Opción B (Filtrado Dinámico en Frontend):**
   Si se requiere que la TV no consulte la API en cada cambio de bloque, el cliente `TVPlayer.jsx` debe filtrar en memoria los ítems antes de montar el timer de reproducción, y programar un refresco de lista en cada frontera horaria.
