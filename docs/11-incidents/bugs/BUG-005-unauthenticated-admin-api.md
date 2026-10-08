# BUG-005: Ausencia Total de Autenticación en API Administrativa y CORS Irrestricto

- **Módulo Afectado:** Security Gateway & Admin Router (`nx_tv.js`, `src/routes/admin.js`, `src/routes/media.js`)
- **Normativa Vulnerada:** ISO/IEC 27001:2022 — Control A.9 (Control de Acceso) / A.9.4.2 (Procedimientos de Conexión Segura)
- **Severidad:** Crítica
- **Prioridad:** P0
- **Fecha de Detección:** 2026-10-08
- **Estado:** Confirmado (Pendiente de Corrección)
- **Reportado por:** QA Lead & Senior Software Architect

---

### 1. Descripción
En el punto de entrada de la aplicación ([nx_tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/nx_tv.js)), las rutas administrativas (`/api/admin/*`) y de gestión de medios (`/api/tv-content/*`) están montadas directamente sobre la instancia global de Express sin ningún middleware de autenticación (JWT, API Key, Session, Basic Auth o RBAC).

Adicionalmente, se encuentra habilitado el middleware `cors({ origin: '*' })`, permitiendo que cualquier cliente de la red local o cualquier sitio web externo mediante peticiones cross-origin anónimas invoque libremente operaciones con impacto destructivo o de control en tiempo real sobre la infraestructura de cartelería digital.

---

### 2. Comportamiento Esperado vs Observado

* **Comportamiento Esperado:**  
  Todos los endpoints que consultan estado sensible (`/api/admin/stats`, `/api/admin/screens`) o ejecutan mutaciones (control remoto de TVs, emisión de transmisiones de emergencia, subida y eliminación de medios) deben exigir credenciales válidas y retornar `HTTP 401 Unauthorized` o `HTTP 403 Forbidden` ante solicitudes anónimas. Las políticas de CORS deben restringir el acceso a dominios autorizados.
* **Comportamiento Observado:**  
  Cualquier petición HTTP anónima sin cabeceras de autorización devuelve **HTTP 200 OK** con datos de negocio completos y la cabecera `Access-Control-Allow-Origin: *`.

---

### 3. Pasos para Reproducir
1. Enviar una petición HTTP sin credenciales ni tokens a un endpoint administrativo sensible:
   ```bash
   curl -i http://localhost:23002/api/admin/screens
   curl -i http://localhost:23002/api/admin/stats
   ```
2. Observar que el servidor responde inmediatamente con `HTTP/1.1 200 OK`, cabecera `Access-Control-Allow-Origin: *` y el volcado íntegro de la lista de pantallas corporativas y estadísticas de red.

---

### 4. Evidencia Técnica
* **Montaje de Rutas en `nx_tv.js` (L50 y L92-94):**
  ```javascript
  app.use(cors({ origin: '*' }));
  ...
  app.use('/api/tv', tvRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/tv-content', mediaRoutes);
  ```
* **Respuesta HTTP Obtenida en Prueba Real:**
  ```http
  HTTP/1.1 200 OK
  Access-Control-Allow-Origin: *
  Content-Type: application/json; charset=utf-8
  {"success":true,"stats":{"totalScreens":7,"activeScreens":7,"totalPlaylists":3,"totalContent":68}}
  ```
* **Prueba Documentada:** [docs/13-testing/results/TC-014.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-014.md).

---

### 5. Archivos / Componentes Involucrados
* `nx_tv.js` (Configuración de servidor Express y middlewares perimetrales).
* `src/routes/admin.js` (Enrutador con 14 endpoints administrativos desprotegidos).
* `src/routes/media.js` (Endpoints de subida, consulta y borrado físico de archivos).

---

### 6. Impacto y Riesgo (ISO 27001)
* **Suplantación de Contenido en Vivo:** Un atacante en la red puede ejecutar un broadcast de emergencia (`POST /api/admin/temporary-content`) y forzar la proyección de contenido no autorizado en todas las pantallas corporativas en segundos.
* **Denegación de Servicio y Sabotaje:** Posibilidad de borrar permanentemente contenidos multimedia (`POST /api/tv-content/delete`), desvincular pantallas activas (`POST /api/admin/bind-screen`) o forzar recargas masivas en bucle.
* **Incumplimiento Regulatorio Crítico:** Violación flagrante de políticas de ciberseguridad corporativa e ISO 27001 Control A.9.

---

### 7. Solución Propuesta (Recomendaciones de Arquitectura)
1. **Middleware de Autenticación:**  
   Implementar un middleware de verificación en `src/middlewares/auth.js` (ej. JWT firmado o API Key en cabecera `X-API-Key`) e inyectarlo en las rutas protegidas:
   ```javascript
   app.use('/api/admin', authMiddleware, adminRoutes);
   app.use('/api/tv-content', authMiddleware, mediaRoutes);
   ```
2. **Restricción de Orígenes CORS:**  
   Reemplazar el comodín `*` por una lista blanca explícita de dominios confiables (o el origen del frontend autorizado en producción):
   ```javascript
   const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:28080'];
   app.use(cors({ origin: allowedOrigins, credentials: true }));
   ```
