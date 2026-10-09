# Nexus TV Enterprise (GSI) — Reconciliación de Versión y Estado del Repositorio

> **Documento:** REPO-VERSION-RECONCILIATION
> **Versión:** 1.0.0
> **Fecha de Emisión:** 2026-10-09
> **Autor / Rol:** Senior QA Engineer & Technical Auditor
> **Normativas de Referencia:** ISO 9001:2015 (Control de Información Documentada y Trazabilidad), ISO/IEC 90003:2018 (Ingeniería de Software), ISO/IEC 25010:2023 (Calidad de Producto Software)

---

## 1. Identificación y Estado Base del Workspace

| Parámetro | Valor Registrado | Evidencia / Comando |
| :--- | :--- | :--- |
| **Ruta Absoluta del Workspace** | `C:\Users\DEVELOPMENT\Downloads\tv_gsi` | PowerShell `$PWD.Path` |
| **Rama Actual** | `main` | `git branch -a` |
| **Commit Local Activo (HEAD)** | `d346408c314df354aa37f9ad38f5cf0ef60de801` | `git rev-parse HEAD` |
| **Mensaje de Commit HEAD** | `release: [NX-015] version v2.1.3 bucle continuo onEnded, shuffle y soporte call center 24/7` | `git log -n 1 --oneline` |
| **Fecha de Commit HEAD** | `2026-10-09 12:47:47 +0000` | `git log -n 1 --format="%ad" --date=iso` |
| **Tag de Versión Asociado** | `v2.1.3` | `git describe --tags --exact-match` |
| **Estado del Working Tree** | Limpio (`working tree clean`, sin archivos sin seguimiento ni modificaciones no confirmadas) | `git status --short` (0 salidas) |
| **Remoto Configurado** | `origin -> https://github.com/desarrollogsi25/tv_gsi.git` (fetch y push) | `git remote -v` |
| **Rastreador Remoto `origin/main`** | Presente y alineado: `d346408c314df354aa37f9ad38f5cf0ef60de801` | `git rev-parse origin/main` |
| **Diferencias Local vs `origin/main`** | 0 diferencias (`git diff HEAD origin/main` es completamente vacío) | `git diff HEAD origin/main --stat` (0 bytes) |

> **Nota Metodológica:** Conforme a la regla obligatoria 0 y 1, no se ejecutó `git fetch` ni `git pull`. La comparación se realizó estrictamente contra el estado de las referencias y objetos ya presentes localmente en la base de datos de Git.

---

## 2. Reconciliación entre Workspace y Contenedores Docker Activos

Un principio crítico de auditoría QA es **no asumir que los contenedores en ejecución reflejan el código del workspace**. Se realizó una inspección forense comparativa entre los archivos locales del repositorio y los artefactos ejecutados dentro de los contenedores Docker en tiempo de ejecución.

### 2.1. Estado de los Contenedores (`docker compose ps -a`)

```text
NAME          IMAGE             COMMAND                  SERVICE    STATUS
tv-backend    sha256:15dd39...  "docker-entrypoint.s…"   backend    Up (healthy) :23002->3002/tcp
tv-db         postgres:17       "docker-entrypoint.s…"   db         Up (healthy) :25432->5432/tcp
tv-frontend   tv_gsi-frontend   "/docker-entrypoint.…"   frontend   Up (healthy) :28080->8080/tcp
```

### 2.2. Verificación Criptográfica de Archivos Backend (Local vs `tv-backend`)

Se ejecutó un cotejo de sumas de verificación MD5 entre los archivos en el host de Windows y los archivos dentro del contenedor `tv-backend`:

| Archivo Crítico | MD5 Host Local (`C:\Users\DEVELOPMENT\Downloads\tv_gsi`) | MD5 Contenedor Docker (`tv-backend:/app`) | Estado de Coincidencia |
| :--- | :--- | :--- | :---: |
| `nx_tv.js` | `61FB3C159493E28361F1350F7352911A` | `61fb3c159493e28361f1350f7352911a` | ✅ Idéntico al 100% |
| `src/routes/tv.js` | `E6FB8E0FB2264D22F610F6C385445241` | `e6fb8e0fb2264d22f610f6c385445241` | ✅ Idéntico al 100% |
| `src/routes/admin.js` | `4E6B06F161BC2507863A806E2BBABEE4` | `4e6b06f161bc2507863a806e2bbabee4` | ✅ Idéntico al 100% |
| `src/sockets/index.js` | `A6EF2C2D185A21A8090911E1DB9D570E` | `a6ef2c2d185a21a8090911e1db9d570e` | ✅ Idéntico al 100% |

### 2.3. Verificación de Artefactos de Frontend (Local `dist/` vs `tv-frontend`)

El frontend es servido por un contenedor Nginx que aloja el bundle compilado por Vite. Se compararon los hashes de los bundles:

| Artefacto Frontend | Hash MD5 Local (`frontend/dist/assets`) | Hash MD5 Contenedor (`/usr/share/nginx/html/assets`) | Estado de Coincidencia |
| :--- | :--- | :--- | :---: |
| `index-mHBeMnZW.js` (426,136 bytes) | `BC5849C9EC9FC2E90B14F8D5D80B0140` | `bc5849c9ec9fc2e90b14f8d5d80b0140` | ✅ Idéntico al 100% |
| `index-DC2qpHSg.css` (23,341 bytes) | Identificado en dist local | Identificado en contenedor | ✅ Idéntico al 100% |

**Conclusión de Reconciliación Docker:** Los tres contenedores Docker locales (`tv-backend`, `tv-db`, `tv-frontend`) están ejecutando exactamente el código compilado correspondiente al commit `d346408` (release v2.1.3). No existen discrepancias entre los archivos del workspace y los contenedores en ejecución.

---

## 3. Matriz de Reconciliación de Archivos Solicitados

A continuación se detalla la verificación obligatoria de cada uno de los archivos clave solicitados en el pliego de la misión:

| Archivo | Existe en Workspace | Hash / Estado | Observaciones Técnicas Relevantes |
| :--- | :---: | :---: | :--- |
| `start-tv-kiosk.ps1` | Sí | UTF-8 sin BOM (74 líneas) | **Defecto Crítico Detectado:** Contiene caracteres em-dash (`—`) en L2 y L17 que provocan `ParserError: AmpersandNotAllowed` en Windows PowerShell 5.1. No tiene mecanismo de perfil limpio. |
| `run-local.ps1` | Sí | UTF-8 con LF (153 líneas) | **Defectos Detectados:** Opción 6 ejecuta `docker compose down -v` destruyendo la base de datos. Líneas 61-64 copian `.env.example` a `.env` con secretos predeterminados sin advertencia ni confirmación. |
| `docker-compose.yml` | Sí | 83 líneas | Define servicios `db`, `backend`, `frontend`. Red `tv_network`, volumen `tv_pgdata`. Puertos host `25432`, `23002`, `28080`. |
| `.env.example` | Sí | 25 líneas | Define plantillas de variables de entorno con contraseñas y secretos de ejemplo (`replace_with_...`). |
| `package.json` | Sí | 27 líneas | Version 1.0.0, scripts `start` y `test: node --test tests/`. Dependencias: bcryptjs, cors, dotenv, express 5, fluent-ffmpeg, jsonwebtoken, multer 2, node-cron, pg 8, socket.io 4, sqlite3. |
| `src/routes/tv.js` | Sí | 171 líneas | Contiene filtro `LOCALTIME BETWEEN pc.start_time AND pc.end_time` (BUG-001 mitigado) y coincidencia con array `miércoles/miercoles`, `sábado/sabado` (BUG-004 mitigado). |
| `src/routes/admin.js` | Sí | 747 líneas | 14 endpoints administrativos. **Defecto:** No valida roles `admin`, permitiendo operaciones destructivas a cualquier usuario con JWT válido (ej. rol `viewer`). |
| `src/sockets/index.js` | Sí | 199 líneas | Namespace `/control`. Autentica administradores por JWT. **Defecto:** Admite cualquier conexión que pase `?tv_uuid=...` sin token ni validación criptográfica, permitiendo suplantación de pantallas. Map 1:1 en `onlineScreens` sufre desincronización con pestañas duplicadas. |
| `frontend/src/components/TVPlayer.jsx` | Sí | 878 líneas | Manejador `handleImageError` con backoff de 2s (BUG-002 mitigado). Soporta rotación shuffle y continuous loop. Lee `tv_uuid` prioritariamente de URL y luego `localStorage`. |
| `frontend/src/components/admin/TVRegister.jsx` | Sí | 202 líneas | Polling cada 4s a `/api/admin/waiting-screens` y `/api/admin/available-profiles`. |
| `frontend/src/App.jsx` | Sí | 57 líneas | React Router con rutas `/tv`, `/login`, `/admin/*`. Redirige `/admin` a `/login` si no existe token en `localStorage`. |
| `frontend/src/api.js` | Sí | 41 líneas | Interceptor Axios que inyecta `Authorization: Bearer <token>` y redirige a `/admin` ante error HTTP 401. |
| `frontend/nginx.conf` | Sí | 73 líneas | `client_max_body_size 500M;`, proxies `/api/`, `/socket.io/`, `/control/socket.io/`, `/media/` con cabeceras `no-cache`. |
| `scripts/e2e_full_audit.cjs` | Sí | 325 líneas | **Alerta Operativa:** Script intrusivo con efectos colaterales masivos (sube 4 archivos incluyendo un video de 100MB, emite broadcast prioritario a `target: all`, envía comandos de pausa/volumen a `all` pantallas). Su ejecución directa sobre producción o pantallas reales está prohibida. |
| **Tests Unitarios Existentes** | Sí | 4 suites / 18 tests | `tests/auth.test.js`, `tests/normalize-days.test.js`, `tests/playlist-playback.test.js`, `tests/schedule-window.test.js`. Todos pasan exitosamente (18/18 PASS en 245 ms). |

---

## 4. Reconciliación de Documentación (`docs/00-overview/`, `docs/11-incidents/`, `docs/13-testing/`)

### 4.1. Discrepancias Documentales Identificadas

1. **`docs/00-overview/project-overview.md`:**
   - **Discrepancia:** En la Sección 2 ("Fuera de Alcance Actual", Línea 31) y Sección 4 ("Usuarios y Actores", Línea 55), afirma textualmente: *"No requiere credenciales en el estado actual del código (el acceso administrativo es abierto a la red interna)"*.
   - **Realidad en Código:** En v2.1.0 (commits posteriores al 2026-10-08) se implementó formalmente autenticación con JWT, endpoint `/api/auth/login`, protección en `/api/admin` con `authMiddleware`, y pantalla de Login en el frontend. El documento de visión general quedó desactualizado respecto a la arquitectura real implementada.

2. **`docs/11-incidents/README.md`:**
   - Registra formalmente los tickets `BUG-001` y `BUG-002` como abiertos/en seguimiento de incidentes preliminares, mientras que los archivos individuales en `docs/11-incidents/bugs/` (`BUG-001` al `BUG-005`) fueron cerrados tras las ramas de remediación `bugfix/NX-001` a `bugfix/NX-003`.
   - La tabla consolidada de incidentes requiere actualización para reflejar el estado actual y dar de alta los nuevos incidentes detectados en la auditoría del Kiosk y la seguridad (`BUG-006` en adelante).

3. **`docs/13-testing/risk-register.md` y `test-cases.md`:**
   - No incluyen los riesgos ni los casos de prueba asociados al script `start-tv-kiosk.ps1`, la pérdida de datos de `run-local.ps1 down -v`, ni los riesgos de ejecución no aislada de `e2e_full_audit.cjs`.

---

## 5. Dictamen de Calidad (ISO 9001 / ISO/IEC 25010)

- **Trazabilidad de Versión:** Conforme (Commit local `d346408` coincide con `origin/main` y los contenedores en ejecución).
- **Control de Configuración:** Brecha menor identificada (documentación general desincronizada respecto a la introducción de JWT).
- **Riesgo Operativo Identificado:** Alto debido a herramientas de automatización con efectos secundarios no controlados (`run-local.ps1` opción 6 y `scripts/e2e_full_audit.cjs`).
