# BUG-008: Ausencia de Control de Acceso Basado en Roles (RBAC) en API Administrativa

- **Módulo Afectado:** Security Gateway & Access Control (`src/middlewares/auth.js` & `src/routes/admin.js`)
- **Severidad:** Crítica
- **Prioridad:** P0
- **Fecha de Detección:** 2026-10-09
- **Estado:** 🟢 Resuelto (RBAC backend implementado y verificado en suite automatizada)
- **Fecha de Resolución:** 2026-10-09
- **Resuelto por:** Senior Software Engineer & Security Engineer
- **Reportado por:** Senior QA Engineer & Technical Auditor
- **Normativa Relacionada:** ISO/IEC 27001:2022 (Control A.9.1 Control de Acceso, A.9.4.2 Conexión Segura), OWASP API Security Top 10 (API1:2023 Broken Object Level Authorization, API5:2023 Broken Function Level Authorization)

---

### 1. Descripción
Aunque la remediación `bugfix/NX-003` implementó la verificación de tokens JWT en las rutas administrativas mediante `authMiddleware`, dicho middleware se limita a comprobar la validez de la firma del token sin verificar el rol del usuario autenticado (`req.user.role`).

En la base de datos existen múltiples perfiles de usuario con diferentes niveles de privilegio: `admin`, `editor` y `viewer` (registrados en `nexus_tv.users`). Sin embargo, en `src/routes/admin.js` y `src/routes/media.js`, ningún endpoint valida si el rol del usuario posee permisos suficientes para ejecutar mutaciones. En consecuencia, un usuario con rol de solo lectura (`viewer`) puede invocar endpoints de eliminación de pantallas, borrado de playlists, control remoto y subida/borrado de archivos.

---

### 2. Pasos para Reproducir
1. Autenticarse contra `/api/auth/login` con credenciales de un usuario con rol `viewer` (ej. `viewer_nexus`).
2. Obtener el token JWT correspondiente (donde el payload contiene `{ role: 'viewer' }`).
3. Enviar una petición HTTP destructiva con la cabecera `Authorization: Bearer <token_de_viewer>`:
   ```bash
   curl -X DELETE http://localhost:23002/api/admin/screens/<uuid_pantalla> \
        -H "Authorization: Bearer <token_viewer>"
   ```
4. **Observación:** El backend procesa la petición y elimina la pantalla con HTTP 200 OK en lugar de rechazarla con HTTP 403 Forbidden.

---

### 3. Evidencia Técnica
- **Middleware `src/middlewares/auth.js` (Líneas 18–20):**
  ```javascript
  const decoded = jwt.verify(token, JWT_SECRET);
  req.user = decoded;
  next();
  ```
  No existe ninguna evaluación de roles.
- **Rutas en `src/routes/admin.js`:**
  Búsqueda del término `role` o permisos en las 747 líneas de `admin.js`: **0 coincidencias**.
- **Contraste con WebSockets (`src/sockets/index.js` L29):**
  En WebSockets sí se verifica:
  ```javascript
  if (socket.data.user.role !== 'admin') return next(new Error('Administrator access required'));
  ```
  Existe una discrepancia de seguridad flagrante entre la capa de WebSockets y la capa HTTP REST.

---

### 4. Causa Raíz Identificada
Falta de un middleware de autorización granular por roles (`requireRole('admin')`) aplicado en los endpoints administrativos mutantes en la capa Express.

---

### 5. Impacto en el Negocio / Sistema
- Escalada vertical de privilegios no autorizada.
- Violación del principio de mínimo privilegio exigido por ISO/IEC 27001.
- Riesgo de sabotaje o borrado accidental de toda la infraestructura de pantallas por usuarios que deberían tener únicamente acceso visual al panel.

---

### 6. Solución Propuesta (Para Fase de Corrección)
1. Crear un middleware `requireRole(...roles)` en `src/middlewares/auth.js`:
   ```javascript
   function requireRole(...roles) {
       return (req, res, next) => {
           if (!req.user || !roles.includes(req.user.role)) {
               return res.status(403).json({ success: false, message: 'Acceso denegado: Permisos insuficientes.' });
           }
           next();
       };
   }
   ```
2. Aplicar `requireRole('admin')` o `requireRole('admin', 'editor')` según corresponda a las operaciones de creación, edición, control remoto y eliminación.

---

### 7. Solución Implementada y Estado de Verificación

* **Archivos Modificados:**
  1. `src/middlewares/auth.js`: Se implementó la función middleware `requireRole(...allowedRoles)` con lista blanca estricta de roles válidos (`admin`, `editor`, `viewer`). Valida existencia de usuario autenticado, tipo y validez del rol, rechazando peticiones no autorizadas con HTTP 403 Forbidden antes de delegar en los controladores.
  2. `src/routes/admin.js`: Se incorporó `requireRole` en los 26 endpoints del router administrativo, discriminando operaciones de lectura (permitidas a los 3 roles), gestión de playlists (restringidas a `admin` y `editor`), y administración de dispositivos, pairing, control remoto y transmisiones prioritarias (exclusivas de `admin`).
  3. `src/routes/media.js`: Se blindaron los 4 endpoints de la biblioteca multimedia; lectura permitida a todos los roles, y subida (precediendo a Multer para evitar streams no autorizados), creación externa y borrado restringidos a `admin` y `editor`.
  4. `src/sockets/index.js`: Se reforzó la verificación de privilegios en el evento `admin:send_command`, asegurando que solo usuarios con rol `admin` puedan retransmitir comandos a salas de TV.
* **Pruebas Automatizadas:**
  - Suite de pruebas dedicada [tests/rbac.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/rbac.test.js) con 14 casos de prueba automatizados, cubriendo peticiones anónimas, tokens inválidos, expirados, pruebas específicas para `viewer`, `editor` y `admin`, roles desconocidos, tokens sin rol, e intercepción a nivel de router antes de mutar base de datos o almacenamiento.
  - Resultado: **14/14 PASS (100% de éxito)**.
* **Documento de Evidencia:** [docs/13-testing/results/TC-022.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-022.md).
* **Estado Final:** 🟢 **RESUELTO**
