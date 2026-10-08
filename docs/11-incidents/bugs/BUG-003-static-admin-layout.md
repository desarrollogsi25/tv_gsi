# BUG-003: Layout Estático No Responsivo y Truncamiento Visual en Panel de Administración

- **Módulo Afectado:** Admin UI / CSS Architecture & Responsive Design (`frontend/src/components/Admin.css`)
- **Severidad:** Media
- **Prioridad:** P2
- **Fecha de Detección:** 2026-10-08
- **Estado:** 🟢 Cerrado y Validado en QA
- **Reportado por:** QA Lead & Senior Software Architect

---

### 1. Descripción
La hoja de estilos principal del panel de administración (`Admin.css`) carece en su totalidad de reglas `@media` (0 reglas responsivas). La barra lateral (`.admin-sidebar`) tiene un ancho fijo inmutable de `280px` sin posibilidad de colapso, cajón off-canvas o menú hamburguesa. Además, el contenedor principal fuerza `width: 100vw;` y `overflow: hidden;`, mientras que la sección de contenido `.admin-main` tiene un padding estático de `88px` horizontal (`44px` por lado) y solo permite desplazamiento vertical (`overflow-y: auto;`).

En pantallas con resoluciones de tablet o portátiles pequeñas (viewport $\le 1024px$ y $\le 768px$), las tablas de datos (catálogo multimedia, listas de reproducción) y formularios superan el ancho remanente (apenas 400px útiles en 768px), produciendo recorte horizontal irreversible de columnas y botones de acción.

---

### 2. Comportamiento Esperado vs Observado

* **Comportamiento Esperado:**  
  La interfaz debe adaptarse mediante breakpoints responsivos: en pantallas $\le 1024px$ o $\le 768px$, la barra lateral debe colapsar en un menú drawer/hamburguesa o barra compacta, el padding lateral debe reducirse (ej. 16px) y las tablas de datos deben contener un contenedor con scroll horizontal (`overflow-x: auto;`).
* **Comportamiento Observado:**  
  En 768px, la barra lateral ocupa el 36.5% del ancho de pantalla. Las tablas de administración quedan cortadas en su extremo derecho sin barra de desplazamiento horizontal disponible, haciendo inaccesibles los botones de edición y eliminación.

---

### 3. Pasos para Reproducir
1. Abrir la consola de administración en `http://localhost:28080/admin`.
2. Redimensionar la ventana del navegador o abrir las herramientas de desarrollador en modo de emulación de dispositivo (ej. iPad Mini 768x1024).
3. Navegar a la pestaña "Biblioteca de Contenidos & Playlists".
4. Observar que las columnas de la tabla y los controles quedan cortados fuera del marco visible y no hay scroll horizontal.

---

### 4. Evidencia Técnica
* **Inspección de `Admin.css`:**
  * Búsqueda de `@media`: 0 coincidencias.
  * Línea 79: `.admin-sidebar { width: 280px; ... }`
  * Línea 202: `.admin-container { ... overflow: hidden; }`
  * Línea 252-253: `.admin-main { padding: 40px 44px; overflow-y: auto; }`
* **Prueba Documentada:** [docs/13-testing/results/TC-004.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-004.md).

---

### 5. Archivos / Componentes Involucrados
* `frontend/src/components/Admin.css` (Reglas de layout y grillas).
* `frontend/src/components/Admin.jsx` (Estructura del árbol DOM de administración).

---

### 6. Impacto y Riesgo
* **Impacto Operativo:** Imposibilidad para técnicos y supervisores de operar el sistema desde tablets en campo o laptops de resolución estándar.
* **Degradación Visual:** Sensación de software incompleto o roto en dispositivos no de escritorio ultra-panorámicos.

---

### 7. Solución Propuesta (Recomendaciones de Arquitectura)
1. Incorporar breakpoints estándar en `Admin.css`:
   ```css
   @media (max-width: 1024px) {
       .admin-sidebar {
           position: fixed;
           left: -280px;
           transition: left 0.3s ease;
       }
       .admin-sidebar.open {
           left: 0;
       }
       .admin-main {
           padding: 20px 16px;
       }
   }
   ```
2. Envolver `.nexus-table` dentro de un contenedor `<div className="table-responsive">` con `overflow-x: auto;`.
