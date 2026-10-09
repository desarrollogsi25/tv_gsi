# BUG-003: Layout Estático No Responsivo y Truncamiento Visual en Panel de Administración

- **Módulo Afectado:** Admin UI / CSS Architecture & Responsive Design (`frontend/src/components/Admin.css`)
- **Severidad:** Media
- **Prioridad:** P2
- **Fecha de Detección:** 2026-10-08
- **Estado:** 🟢 Resuelto / Verificado (Playwright + Chrome local, 2026-10-09)
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

---

### 8. Retest dinámico responsive (2026-10-09)

* **Herramienta:** Playwright 1.64.0 invocado con `npx`; la dependencia no está declarada ni instalada en el proyecto. Se conectó a Chrome local (`C:\Program Files\Google\Chrome\Application\chrome.exe`) mediante `executablePath`; no fue necesario descargar un navegador. Vite sirvió el frontend en localhost. El arnés interceptó las llamadas API con respuestas JSON deterministas y un token de interfaz ficticio; no envió credenciales ni ejecutó mutaciones.
* **Vistas:** `/admin` (lista de pantallas), `/admin/register` (perfil y sesión de prueba), `/admin/broadcast` y `/admin/content` (datos vacíos simulados, salvo un perfil/sesión de muestra en Vinculación).
* **Viewports:** 375×812, 414×896, 768×1024, 1280×800 y 1920×1080.
* **Correcciones:** `TVRegister.jsx` ahora presenta las tablas de vinculación y perfiles como tarjetas etiquetadas en móvil, permite envolver las acciones y limita el selector al ancho disponible. Las pestañas de Broadcast se envuelven; las de Contenido forman filas flexibles; el grid de tarjetas Broadcast usa una columna en móvil.
* **Resultado común tras el cambio:** `document.documentElement.scrollWidth` y `.admin-main.scrollWidth` coincidieron con el viewport en las 20 combinaciones. Ningún botón, enlace, input, selector o tab dentro de `.admin-main` rebasó x=ancho del viewport.
* **Coordenada X máxima de controles por viewport:** 375 px → x=359; 414 px → x=398; 768 px → x=752. Por ruta a 375 px: `/admin/register` x=326, `/admin/broadcast` x=326, `/admin` y `/admin/content` x=359. A 414 px: Register/Broadcast x=365, Admin/Content x=398. A 768 px: Register/Broadcast x=719, Admin/Content x=752.
* **Escritorio:** 1280 px y 1920 px también pasaron; no hubo scroll del documento ni controles fuera del viewport. Los paneles conservaron su distribución de escritorio.
* **Build:** `npm run build` terminó correctamente con 126 módulos transformados. Vite mostró la advertencia conocida de Node 20.18 (recomienda 20.19+ o 22.12+).
* **Dictamen:** BUG-003 **Resuelto / Verificado** para las vistas y anchos probados. Evidencia detallada: [TC-004.md](../../13-testing/results/TC-004.md).
