# ADR-004 — Modelo de Autenticación, Control de Acceso y Restricción de CORS

> **Estado:** Aceptado  
> **Fecha:** 2026-10-08  
> **Área:** Seguridad Perimetral, Control de Acceso y Gobernanza de APIs  
> **Decisores:** Security Architect, Senior Backend Engineer & QA Lead  
> **Normativa de Referencia:** ISO/IEC 27001:2022 — Control A.9 (Access Control) / A.9.4.2 (Secure Log-on Procedures)  

---

## 1. Contexto y Problemática

Durante la auditoría de seguridad perimetral (TC-014), se confirmó el incidente crítico **BUG-005** ([BUG-005-unauthenticated-admin-api.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-005-unauthenticated-admin-api.md)):
1. Los 14 endpoints administrativos bajo `/api/admin/*` y `/api/tv-content/*` se encontraban montados en el servidor Express sin ningún middleware de autenticación o validación de credenciales.
2. La política de CORS global estaba configurada con comodín universal (`app.use(cors({ origin: '*' }))`).
3. Esto permitía a cualquier estación de la red o a cualquier script web malicioso ejecutar peticiones cross-origin anónimas para mutar playlists, subir/eliminar activos en disco o emitir transmisiones prioritarias en pantallas corporativas.

---

## 2. Decisión de Arquitectura

Se adopta una arquitectura de control de acceso híbrida y segmentada según el perfil del actor:

### 2.1. Política Estricta de CORS (Whitelist perimetral)
* Reemplazar la directiva `origin: '*'` por una lista blanca explícita definida mediante la variable de entorno `ALLOWED_ORIGINS`.
* En entornos locales y de staging, permitir únicamente los orígenes autorizados del reverse proxy y cliente web:
  ```javascript
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',') 
      : ['http://localhost:28080', 'http://127.0.0.1:28080'];
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  ```

### 2.2. Autenticación y Autorización Administrativa (JWT + BCrypt)
* **Middleware Perimetral (`authMiddleware.js`):** Intercepta todas las rutas protegidas (`/api/admin/*` y `/api/tv-content/*`) exigiendo una cabecera HTTP estándar:
  ```http
  Authorization: Bearer <token_jwt>
  ```
* **Firma Criptográfica:** Los tokens se firman utilizando `jsonwebtoken` con algoritmo HMAC SHA-256 utilizando la clave secreta `JWT_SECRET` (con expiración configurable, ej. 8 horas).
* **Endpoint de Autenticación (`/api/auth/login`):** Ruta pública que valida las credenciales (`username`/`password`) contra la tabla `nexus_tv.users`, verificando el hash de contraseña almacenado mediante la biblioteca `bcrypt` / `bcryptjs`.

### 2.3. Canal de Pantallas TV Kiosk (Desacoplado y sin fricción interactiva)
* Las rutas orientadas al motor de visualización (`/api/tv/*`) y el handshake WebSocket en `/control?tv_uuid=...` preservan su esquema de autenticación por identificador único de pantalla (`tv_uuid`).
* **Justificación Kiosk:** Los dispositivos de señalización digital operan de manera desatendida y automática tras reinicios eléctricos. Forzar credenciales interactivas o renovación periódica de JWT en hardware de cartelería incrementaría los puntos de fallo ante caídas de red, mientras que el control por `tv_uuid` activo y verificado en base de datos ofrece el balance óptimo entre seguridad y alta disponibilidad.

---

## 3. Consecuencias

### 3.1. Consecuencias Positivas
* **Cumplimiento Normativo ISO 27001:** Alineación inmediata con los requisitos de control de acceso perimetral A.9.
* **Inmunidad ante Inyecciones Externas:** Bloqueo absoluto de peticiones anónimas que pretendan alterar contenidos, disparar broadcasts de emergencia o manipular pantallas.
* **Trazabilidad de Auditoría:** Cada solicitud administrativa autenticada asocia la identidad del usuario (`req.user.id`, `req.user.role`).

### 3.2. Trade-offs y Mitigaciones
* **Gestión de Sesión en Frontend:** Requiere que la consola de administración almacene el token JWT (en `localStorage` o `sessionStorage`) y lo adjunte en los interceptores de Axios.
* **Gestión de Secretos:** Exige definir `JWT_SECRET` en las variables de entorno de producción (`.env`), evitando valores por defecto inseguros.
