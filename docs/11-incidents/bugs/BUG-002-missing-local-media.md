# BUG-002: Inconsistencia entre Base de Datos y Disco Local (24 Archivos 404)

- **Módulo Afectado:** Multimedia & Storage / Filesystem (`nexus_tv.content` & `/app/media/`)
- **Severidad:** Alta
- **Prioridad:** P0
- **Fecha de Detección:** 2026-10-08
- **Estado:** ⚪ Histórico / Superado por Versión Validada (Ver [BUG-002-missing-media-404.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-002-missing-media-404.md))
- **Reportado por:** QA Lead & Senior Software Architect
- **Nota Documental:** Este reporte corresponde al borrador preliminar de detección. La versión canónica con resolución y evidencias de validación se encuentra en [BUG-002-missing-media-404.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-002-missing-media-404.md).

---

### 1. Descripción
En la tabla `nexus_tv.content` existen 28 registros catalogados con `source_type = 'local_file'` que apuntan a rutas relativas `/media/<filename>`. Sin embargo, en el directorio físico del volumen montado en el backend (`/app/media/`) únicamente existen 4 archivos PNG. Los 24 archivos restantes fueron eliminados o no fueron incluidos en el entorno de despliegue inicial.

Cuando una pantalla Smart TV carga una lista de reproducción que contiene estos archivos huérfanos (por ejemplo, la lista `TELECOM`, donde los 6 archivos locales asignados faltan por completo en disco), el servidor web responde con `HTTP 404 Not Found`.

---

### 2. Comportamiento Esperado vs Observado

* **Comportamiento Esperado:**  
  Todos los registros catalogados como `local_file` en la base de datos deben tener su binario correspondiente existente y accesible en `/app/media/` con permisos de lectura para el usuario `app`.
* **Comportamiento Observado:**  
  24 de 28 archivos retornan `HTTP 404 Not Found`. El reproductor cliente maneja el error mediante `onError={handleNext}` en imágenes, lo que provoca un **salto en cascada instantáneo** (omitiendo múltiples comunicados corporativos en milisegundos) hasta anclarse en un video de YouTube funcional.

---

### 3. Pasos para Reproducir
1. Consultar la lista de archivos huérfanos en la base de datos:
   ```sql
   SELECT id, title, source_url FROM nexus_tv.content WHERE source_type = 'local_file';
   ```
2. Verificar la existencia física de uno de ellos (ej. `/media/1765484611765-791077771.png`):
   ```bash
   docker exec tv-backend ls -l /app/media/1765484611765-791077771.png
   # Salida: No such file or directory
   ```
3. Realizar una petición HTTP directa mediante Nginx o Express:
   ```bash
   curl.exe -i http://localhost:28080/media/1765484611765-791077771.png
   # Respuesta: HTTP/1.1 404 Not Found
   ```
4. Abrir `/tv?uuid=a1b2c3d4-e5f6-7890-1234-567890abcdef` en el navegador con la consola de red abierta y observar los errores 404 para los índices 0 y 1.

---

### 4. Evidencia Técnica
* **Conteo en BD vs Disco:**  
  * En PostgreSQL: 28 filas con `source_type = 'local_file'`.
  * En disco (`/app/media`): 4 archivos físicos existentes (`1790102952871-623597520-image_779738258736djec454.png`, `1790104074397-862342464-tmpC5F3_tmp.png`, `1790104249984-273932323-image_76648282029ehacdi3i.png`, `1790104800777-21643196-Captura_de_pantalla_2026-08-26_152430.png`).
* **Respuesta HTTP:**
  ```json
  HTTP/1.1 404 Not Found
  {"error":"Not found","path":"/app/media/1765484611765-791077771.png"}
  ```
* **Impacto en Playlist `TELECOM`:**  
  6 archivos locales distintos asignados en 18 franjas horarias faltan al 100% en disco (`1784554574298-561825712.png`, `1786027991015-567379525.png`, `1787240698075-528024327.png`, `1787240450425-510604055.png`, `1787241447486-782108721.png`, `1783712706678-706640844.jpg`).
* **Prueba Documentada:** [docs/13-testing/results/TC-004.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-004.md).

---

### 5. Archivos / Componentes Involucrados
* Directorio físico `./media/` en host montado en `/app/media` en el contenedor `tv-backend`.
* Tabla `nexus_tv.content` en PostgreSQL.
* Manejador estático de Express en `nx_tv.js` (Líneas 72-83).
* Mecanismo de fallback en `frontend/src/components/TVPlayer.jsx` (`onError={handleNext}`).

---

### 6. Causa Técnica Conocida
Desincronización histórica entre el volcado SQL maestro (`nexus_tv_20260919_091327.dump` / `01_init_nexus_tv.sql`) que contenía los metadatos de los archivos cargados, y el directorio local de medios, cuyos binarios originales no fueron empaquetados en su totalidad.

---

### 7. Impacto
* **Operativo:** Se dejan de exhibir 24 piezas de comunicación institucional (flyers de seguridad, avisos de nómina, eventos).
* **Experiencia de Usuario:** Parpadeo perceptible en el reproductor durante el salto en cascada y tráfico 404 continuo en el servidor web.

---

### 8. Reproducibilidad
**100% Determinística (Siempre reproducible al solicitar los archivos afectados).**

---

### 9. Mitigación Actual
El reproductor React cuenta con una guarda preventiva `onError={handleNext}` en `TVPlayer.jsx` (Línea 650) que evita que la pantalla se congele permanentemente en un pantallazo negro, forzando el avance al siguiente ítem.

---

### 10. Validación y Estado de Resolución
* **Estado:** Abierto / Confirmado / Pendiente de reabastecimiento de assets o depuración de registros huérfanos.
* **Criterio de Validación Futuro:** Verificar que para cada registro `local_file` en BD, la petición HTTP devuelva `HTTP 200 OK` con el archivo binario correspondiente.
