# BUG-002: Inconsistencia de Archivos Faltantes en Disco y Bucle Acelerado ante HTTP 404

- **Módulo Afectado:** Multimedia Engine / File Storage & TV Player (`/app/media` & `frontend/src/components/TVPlayer.jsx`)
- **Severidad:** Alta
- **Prioridad:** P0
- **Fecha de Detección:** 2026-10-08
- **Estado:** 🟡 Resuelto en Staging / Pendiente QA
- **Reportado por:** QA Lead & Senior Software Architect

---

### 1. Descripción
En la base de datos (`nexus_tv.content`) existen **28 registros** con `source_type = 'local_file'` apuntando a archivos bajo la ruta `/media/176...`. Sin embargo, en el directorio físico del volumen montado en el backend (`/app/media`) **únicamente existen 4 archivos**, y ninguno coincide con los 28 registrados en la base de datos. Como consecuencia, el 100% de los medios locales en base de datos retornan `HTTP 404 Not Found`.

Además, en el reproductor cliente (`TVPlayer.jsx`), el manejador de error de imágenes (`<img onError={handleNext} />`) no implementa ningún tiempo de espera (`0 ms`). Si una playlist encadena múltiples imágenes inexistentes, se desencadena un bucle de avance ultrarrápido y re-renderizados continuos que colapsa el hilo de ejecución de la pantalla.

---

### 2. Comportamiento Esperado vs Observado

* **Comportamiento Esperado:**  
  1. Los archivos multimedia registrados en base de datos deben existir en el almacenamiento persistente.
  2. Ante un fallo de carga (404), el reproductor debe aplicar un retardo controlado (`backoff` de al menos 2 a 3 segundos) antes de intentar el siguiente contenido, evitando tormentas de peticiones y bloqueos del navegador.
* **Comportamiento Observado:**  
  1. 28 de 28 archivos locales registrados devuelven `HTTP 404`.
  2. El evento `onError` en `<img>` llama inmediatamente a `handleNext()`, provocando una cascada de re-renderizados instantáneos, saturación de la CPU al 100% y parpadeo continuo en pantalla negra.

---

### 3. Pasos para Reproducir
1. Comparar los nombres de archivos en la base de datos contra el sistema de archivos:
   ```bash
   docker exec tv-db psql -U tv -d nexus_tv -t -A -c "SELECT source_url FROM nexus_tv.content WHERE source_type = 'local_file';"
   docker exec tv-backend ls -la /app/media
   ```
2. Observar que ninguno de los 28 archivos existe en disco.
3. Asignar una playlist con 2 o más imágenes locales faltantes a una TV y abrir `http://localhost:28080/tv`.
4. Inspeccionar la pestaña Network y Console de las herramientas de desarrollador: se observan ráfagas ininterrumpidas de peticiones HTTP 404 y ejecuciones sucesivas de `handleNext`.

---

### 4. Evidencia Técnica
* **Discrepancia de Archivos:**  
  * BD: 28 registros (`/media/1765484611765-791077771.png`, etc.).
  * Disco: 4 archivos huérfanos (`1790102952871-...`, etc.).
* **Código Frontend en `frontend/src/components/TVPlayer.jsx`:**
  * En `<video>` (L640): `onError={handleVideoError}` -> `setTimeout(handleNext, 2000)` (manejo seguro).
  * En `<img>` (L650): `onError={handleNext}` -> llamada síncrona sin retardo (bucle descontrolado).
* **Prueba Documentada:** [docs/13-testing/results/TC-002.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-002.md).

---

### 5. Archivos / Componentes Involucrados
* `/app/media` (Volumen de almacenamiento local en `tv-backend`).
* `nexus_tv.content` (Tabla de catálogo multimedia en PostgreSQL).
* `frontend/src/components/TVPlayer.jsx` (Línea 650).

---

### 6. Impacto y Riesgo
* **Impacto Operativo:** Pantallas en negro, parpadeo constante y congelamiento del navegador en dispositivos Kiosk.
* **Degradación de Red/Servidor:** Cientos de peticiones HTTP 404 por segundo hacia Nginx y Node.js por cada pantalla afectada.

---

### 7. Solución Propuesta (Recomendaciones de Arquitectura)
1. **Frontend:** Implementar `handleImageError` con backoff de seguridad análogo al de video:
   ```javascript
   const handleImageError = () => {
       setTimeout(handleNext, 2000);
   };
   ```
2. **Backend / Base de Datos:**
   * Script de reconciliación para depurar o marcar como inactivos los registros de `nexus_tv.content` cuyos archivos no existan físicamente en `/app/media`.
   * Verificación de existencia física antes de incluir el contenido en la respuesta de playlist.
