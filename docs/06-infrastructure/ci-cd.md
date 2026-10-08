# Pipeline de Integración Continua (CI/CD) — Nexus TV

> **Documento:** Flujo de Automatización y Verificación de Código  
> **Motor:** GitHub Actions (`.github/workflows/ci.yml`)  
> **Disparadores:** `push` y `pull_request` sobre ramas `main` y `staging`  
> **Estrategia de Concurrencia:** Cancelación de ejecuciones redundantes en progreso  

---

## 1. Estructura de Jobs y Verificaciones

El pipeline ejecuta tres flujos paralelos automatizados en entornos limpios `ubuntu-latest`:

### A. Backend Syntax & Dependency Check (`backend-lint-and-syntax`)
- Entorno de ejecución: Node.js v20 con caché de dependencias npm basada en `package.json`.
- Instalación de dependencias del servidor backend.
- Verificación estática de sintaxis JavaScript mediante `node --check` sobre los módulos críticos:
  - `nx_tv.js` (Punto de entrada Express + Dual Socket Hub).
  - `src/config/db.js` (Pool de base de datos PostgreSQL).
  - `src/middlewares/auth.js` (Middleware de verificación JWT y control de acceso).
  - `src/routes/auth.js` (Endpoints de autenticación y emisión de tokens).
  - `src/routes/tv.js` (Motor de reproducción de playlists y turnos horarios).
  - `src/routes/admin.js` (Control remoto, estadísticas y gestión de pantallas).
  - `src/routes/media.js` (Gestor de subida de archivos y validación Multer).
  - `src/sockets/index.js` (Orquestador de sockets y namespaces).

### B. Frontend Build & Oxlint (`frontend-lint-and-build`)
- Entorno de ejecución: Node.js v20 con caché de dependencias npm basada en `frontend/package.json`.
- Instalación de dependencias del cliente React.
- Análisis estático de código y reglas de calidad mediante `oxlint`.
- Compilación de activos estáticos para producción mediante `vite build` (`npm run build`).

### C. Docker Compose Syntax Validation (`docker-compose-validate`)
- Validación de sintaxis e integridad del archivo de orquestación local:
  ```bash
  docker compose -f docker-compose.yml config --quiet
  ```

---

## 2. Política de Puertas de Calidad (Quality Gates)
- Todo commit o pull request hacia `staging` o `main` debe aprobar el 100% de los jobs.
- Ante fallo en cualquier job, el merge se bloquea automáticamente evitando despliegues con errores de sintaxis, regresiones de build o configuraciones de Docker corruptas.
