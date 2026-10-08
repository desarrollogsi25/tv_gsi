# BUG-001: Omisión de Franja Horaria en Consulta y Reproducción de Playlists

- **Módulo Afectado:** TV Engine / Playlist Scheduling (`src/routes/tv.js` & `frontend/src/components/TVPlayer.jsx`)
- **Severidad:** Alta
- **Prioridad:** P0
- **Fecha de Detección:** 2026-10-08
- **Estado:** Confirmado (Pendiente de Corrección)
- **Reportado por:** QA Lead & Senior Software Architect

---

### 1. Descripción
El sistema define y almacena formalmente en base de datos (`nexus_tv.playlist_content`) ventanas horarias de emisión mediante las columnas `start_time` y `end_time`, permitiendo a los operadores programar contenidos en turnos disjuntos (ejemplo: turno mañana `06:00:00` a `08:59:00`, turno mediodía `09:00:00` a `11:59:00` y turno tarde `12:00:00` a `15:59:00`).

Sin embargo, al consultar el endpoint de playlist de cualquier pantalla (`GET /api/tv/:uuid/playlist`), el backend entrega la totalidad de contenidos asignados al día actual sin discriminar si la hora del sistema coincide con la ventana horaria programada. Asimismo, el reproductor web cliente (`TVPlayer.jsx`) itera secuencialmente sobre todos los elementos devueltos sin filtrar por hora. En consecuencia, la programación horaria es ignorada y los contenidos de todos los turnos se reproducen en un único bucle continuo las 24 horas.

---

### 2. Comportamiento Esperado vs Observado

* **Comportamiento Esperado:**  
  La API (o el cliente TV) debe validar la hora actual contra `start_time` y `end_time` de cada contenido programado, entregando o reproduciendo únicamente aquellos ítems cuya franja horaria esté activa en el momento de la consulta.
* **Comportamiento Observado:**  
  A las `15:51 UTC` / `17:51 CEST`, la API devolvió los 45 contenidos configurados en la lista `TELECOM`, incluyendo los 15 contenidos del turno matutino `06:00:00 - 08:59:00`.

---

### 3. Pasos para Reproducir
1. Identificar una pantalla activa con playlist programada en franjas horarias disjuntas (ej. `PT101`, playlist `TELECOM`, UUID `a1b2c3d4-e5f6-7890-1234-567890abcdef`).
2. Consultar la API fuera del horario de uno de los turnos (ej. consultar a las 17:50 horas):
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
  La consulta únicamente filtra por `days_of_week`. La cláusula `CURRENT_TIME BETWEEN pc.start_time AND pc.end_time` está ausente.
* **Componente `frontend/src/components/TVPlayer.jsx`:**  
  Las variables `start_time` y `end_time` tienen **0 menciones** en el archivo. El reproductor ejecuta `setPlaylist(res.data.playlist)` y pasa secuencialmente por cada elemento mediante `(prev + 1) % playlist.length`.
* **Prueba Documentada:** [docs/13-testing/results/TC-003.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-003.md).

---

### 5. Archivos / Componentes Involucrados
* `src/routes/tv.js` (Endpoint `GET /:tv_uuid/playlist`).
* `frontend/src/components/TVPlayer.jsx` (Lógica de carga y ciclo de reproducción).

---

### 6. Causa Técnica Conocida
Falta de implementación del predicado temporal en la consulta SQL de backend y ausencia de lógica de re-evaluación horaria en el bucle del reproductor cliente.

---

### 7. Impacto
* **Negocio:** Se transmiten contenidos en horarios no deseados (ej. comunicados dirigidos al personal del turno mañana son emitidos al personal del turno noche).
* **Rendimiento:** El reproductor carga en memoria y procesa innecesariamente contenidos fuera de horario.

---

### 8. Reproducibilidad
**100% Determinística (Siempre reproducible en cualquier consulta a la API).**

---

### 9. Mitigación Actual
Ninguna implementada en código. El operador debe crear playlists separadas por turno y reasignarlas manualmente en la consola.

---

### 10. Validación y Estado de Resolución
* **Estado:** Abierto / Confirmado / Pendiente de autorización para corrección.
* **Criterio de Validación Futuro:** Ejecutar `TC-003` y verificar que la API o el cliente sólo entreguen/reproduzcan contenidos dentro del rango horario activo.
