# Registro de Resultados de Remediación y Retest — Misión 2

**Fecha:** 2026-10-09  
**Misión:** MISIÓN 2 — REMEDIACIÓN CONTROLADA P1 Y ACTUALIZACIÓN DEL REGISTRO DE AUDITORÍA  
**Repositorio:** `tv_gsi`  
**Responsable:** Senior Software, Security & QA Engineer  
**Documento base ampliado:** [AUDIT-FULL-2026-10-09.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/AUDIT-FULL-2026-10-09.md)  

---

## 1. Alcance y Objetivos Operativos

1. **Continuidad estricta:** Retomar la misión desde el punto exacto en que se interrumpió la sesión previa, sin descartar ni alterar modificaciones preexistentes (en particular, conservando íntegro el contenido previo de [TC-SECURITY-WS-001.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-SECURITY-WS-001.md)).
2. **Protección absoluta de datos reales:** Salvaguardar la base de datos PostgreSQL activa (`tv-db`), su volumen de persistencia (`tv_gsi_tv_pgdata`) y la configuración en caliente, sin ejecutar migraciones destructivas ni operaciones de limpieza global de Docker (`docker compose down -v`, `docker volume prune`).
3. **Remediación y verificación de Heartbeat (AUD-002 / P1):** Eliminar la mutación no autenticada de `last_login`, garantizar rechazo determinista (HTTP 401) ante pantallas inactivas, inexistentes, sin token, con hash nulo o token cruzado, y verificar respuesta genérica 500 ante fallos de DB sin filtrado de errores internos.
4. **Remediación y verificación de dependencias y runtime (AUD-003 / P1):** Resolver la vulnerabilidad de `source-map-js` mediante fijación y override explícito `>=1.2.2`, verificar la presencia física en `node_modules` y ejecutar `npm audit` limpio. Validar la migración hacia Node 24 LTS en Dockerfiles, Compose y CI.
5. **Inspección de datos en migraciones y base QA aislada:** Detectar bloques de carga `COPY` en `01_init_nexus_tv.sql`, aislar el esquema omitiendo datos sensibles y desplegar un contenedor PostgreSQL efímero e independiente (`nexus-qa-isolated-db`) en puerto `127.0.0.1:25499` para pruebas de integración con datos sintéticos.
6. **Estrategia de mínimo privilegio (AUD-001 / P1):** Validar la migración `06_runtime_user.sql` con el rol `nexus_app`, asegurando operatividad DML de negocio y denegación estricta de DDL, mutaciones sobre usuarios, TRUNCATE y elevación de roles.
7. **Exposición de puerto PostgreSQL (AUD-008 / P2):** Hardening de la directiva de puertos en `docker-compose.yml` y `.env.example` para vincular exclusivamente a `127.0.0.1` por defecto, separando el vector de exposición respecto al comportamiento de CORS.

---

## 2. Inventario de Modificaciones Preservadas y Archivos Afectados

El preflight de `git status --short` confirmó el estado preservado y enriquecido:
- `.env.example`: Incorporación de `HOST_DB_BIND=127.0.0.1`, `PG_ADMIN_USER`, `PG_ADMIN_PASSWORD`, `PG_APP_USER` y `PG_APP_PASSWORD`.
- `docker-compose.yml`: Directiva de puertos actualizada a `"${HOST_DB_BIND:-127.0.0.1}:${HOST_DB_PORT:-25432}:5432"`.
- `Dockerfile` y `frontend/Dockerfile`: Actualización de base a `node:24-alpine` y estandarización a `npm ci`.
- `.github/workflows/ci.yml`: Actualización a Node.js 24 LTS para jobs de backend y frontend.
- `.nvmrc`: Archivo untracked preservado con `24.21.0`.
- `package.json` y `package-lock.json`: Declaración de engine Node `>=24 <25` y ajuste de script `node --test`.
- `frontend/package.json`: Configuración de engine Node y directiva explícita `"overrides": { "source-map-js": "^1.2.2" }`.
- `frontend/package-lock.json` y `frontend/pnpm-lock.yaml`: Resolución fija de `source-map-js` a versión `1.2.2`.
- `src/config/db.js`: Soporte para variables `PG_APP_USER` y `PG_APP_PASSWORD` con fallback seguro.
- `src/routes/tv.js`: Remediación de validación y control de errores en `POST /api/tv/heartbeat`.
- `migrations/01_init_nexus_tv.sql`: Modificación de creación inicial de roles a `NOLOGIN NOSUPERUSER`.
- `migrations/04_distribute_library_content.sql`: Reasignación de correlativo para evitar colisión con `03_playlist_ordering.sql`.
- `migrations/06_runtime_user.sql`: Script idempotente de creación de rol `nexus_app` con mínimo privilegio.
- `docs/13-testing/results/TC-SECURITY-WS-001.md`: **Preservado íntegramente** sin sobrescrituras.
- `tests/tv-heartbeat.test.js`: Suite unitaria (10 casos con mock de queries).
- `tests/tv-heartbeat-integration.test.js`: Suite de integración real contra PostgreSQL aislado (9 casos con mutaciones SQL reales).
- `tests/qa-least-privilege.test.js`: Suite de validación de privilegios mínimos sobre PostgreSQL aislado (8 casos).

---

## 3. Comandos Ejecutados y Evidencias de Ejecución

### 3.1 Entorno de Construcción y Linters

1. **Host Node y npm:**
   - Comando: `node -v; npm -v`
   - Salida: `v20.18.0` / `10.8.2` (Host de desarrollo).
2. **Dependencias Frontend e Inspección Física:**
   - Comando: `npm ci` (en `frontend/`)
   - Resultado: 60 paquetes instalados en 3 s, 0 vulnerabilidades.
   - Comando: `node -e "console.log(require('./node_modules/source-map-js/package.json').version)"` (en `frontend/`)
   - Salida: `1.2.2` (Versión física verificada).
   - Comando: `npm ls source-map-js` (en `frontend/`)
   - Salida: `source-map-js@1.2.2` bajo `postcss@8.5.28` <- `vite@8.3.0`.
   - Comando: `npm audit` (en raíz y en `frontend/`)
   - Salida: `found 0 vulnerabilities`.
3. **Build Frontend:**
   - Comando: `npm run build` (en `frontend/`)
   - Salida: Vite v8.3.0 compila 126 módulos en 876 ms (`dist/index.html` 0.79 kB, `dist/assets/index-*.js` 431.43 kB).
4. **Linter Frontend:**
   - Comando: `npm run lint` (oxlint en `frontend/`)
   - Salida: 10 advertencias cosméticas, 0 errores en 16 archivos.

### 3.2 Despliegue de Instancia PostgreSQL Aislada

- **Nombre de contenedor:** `nexus-qa-isolated-db`
- **Volumen persistente QA:** `nexus_qa_isolated_pgdata`
- **Puerto expuesto:** `127.0.0.1:25499` (loopback exclusivo de pruebas)
- **Base de datos:** `nexus_tv`
- **Usuario administrador QA:** `qa_admin`
- **Usuario de aplicación runtime:** `nexus_app`
- **Comando de inicio:**
  ```powershell
  docker run -d --name nexus-qa-isolated-db -p 127.0.0.1:25499:5432 `
    -v nexus_qa_isolated_pgdata:/var/lib/postgresql/data `
    -v "C:\Users\DEVELOPMENT\AppData\Local\Temp\nexus-audit-d66618f0cd6047b3931745830dfcaf31\migrations:/docker-entrypoint-initdb.d:ro" `
    -e POSTGRES_USER=qa_admin -e POSTGRES_PASSWORD=qa_secure_password_2026 `
    -e POSTGRES_DB=nexus_tv -e PG_APP_USER=nexus_app -e PG_APP_PASSWORD=nexus_app_runtime_pw_2026 postgres:17-alpine
  ```
- **Resultado de inicialización:** Todas las migraciones `01` a `06` aplicadas secuencialmente sin errores. Los bloques `COPY` se procesaron limpios con `COPY 0` en todas las tablas sin cargar datos reales ni sensibles.

### 3.3 Ejecución Completa de Pruebas Automatizadas

- **Comando:** `npm test`
- **Resultado global:**
  ```text
  # tests 93
  # suites 0
  # pass 93
  # fail 0
  # cancelled 0
  # skipped 0
  # todo 0
  # duration_ms 2036.02
  ```

#### Desglose de Resultados por Suite:

1. **`tests/auth.test.js` (2 subtests):** Login con credenciales válidas emite JWT; credenciales inválidas responden 401. **[PASS]**
2. **`tests/device-auth.test.js` (5 subtests):** Creación/login de dispositivo, hashing CSPRNG, expiración de tokens. **[PASS]**
3. **`tests/pairing-session.test.js` (6 subtests):** Ciclo de vida de PIN, unicidad de sesiones, caducidad por TTL. **[PASS]**
4. **`tests/playlist-auth.test.js` (6 subtests):** Validación de headers `X-Device-Token` y control de pertenencia de playlists. **[PASS]**
5. **`tests/playlist-shuffle.test.js` (4 subtests):** Distribución uniforme y determinismo de mezclas por UUID. **[PASS]**
6. **`tests/playlist-normalization.test.js` (2 subtests):** Normalización de duraciones multimedia y compatibilidad de URLs. **[PASS]**
7. **`tests/rbac.test.js` (14 subtests):** Matriz completa de autorización de roles `viewer`, `editor` y `admin` contra rutas protegidas. **[PASS]**
8. **`tests/schedule-window.test.js` (5 subtests):** Ventanas de emisión 24/7 y filtrado de franjas horarias. **[PASS]**
9. **`tests/tv-heartbeat.test.js` (10 subtests unitarios):** Cobertura exhaustiva con pool mock:
   - Pantalla desconocida -> 401 **[PASS]**
   - Pantalla inactiva -> 401 **[PASS]**
   - Hash de credencial NULL -> 401 **[PASS]**
   - Ausencia de credencial -> 401 **[PASS]**
   - Credencial inválida -> 401 **[PASS]**
   - Credencial de otra pantalla -> 401 **[PASS]**
   - Credencial legítima -> 200 (`last_login` actualizado) **[PASS]**
   - Fallo simulado de lectura DB -> 500 genérico **[PASS]**
   - Fallo simulado de escritura DB -> 500 genérico **[PASS]**
   - Petición sin `tv_uuid` -> 400 Bad Request **[PASS]**
10. **`tests/tv-heartbeat-integration.test.js` (9 subtests de integración PostgreSQL real):**
   - Validación HTTP y comprobación de mutación física en PostgreSQL `nexus-qa-isolated-db`:
     - Pantalla inexistente: HTTP 401, DB sin mutaciones **[PASS]**
     - Pantalla inactiva: HTTP 401, timestamp DB inalterado **[PASS]**
     - Pantalla con hash nulo: HTTP 401 sin token y con token, timestamp DB inalterado **[PASS]**
     - Pantalla activa sin token: HTTP 401, timestamp DB inalterado **[PASS]**
     - Token inválido: HTTP 401, timestamp DB inalterado **[PASS]**
     - Token cruzado entre pantallas A y B: HTTP 401, ningún timestamp actualizado **[PASS]**
     - Token válido: HTTP 200, timestamp en DB actualizado al presente (`NOW() - last_login < interval '10s'`), pantalla B inalterada **[PASS]**
     - Petición sin `tv_uuid`: HTTP 400 **[PASS]**
     - Simulación de pool cerrado/caído: HTTP 500 genérico sin fuga de mensajes internos **[PASS]**
11. **`tests/qa-least-privilege.test.js` (8 subtests de seguridad PostgreSQL):**
   - Verificación de atributos: `rolsuper=false`, `rolcreaterole=false`, `rolcreatedb=false`, `rolreplication=false` **[PASS]**
   - Operaciones funcionales CRUD en tablas de negocio (`content`, `playlists`, `tv_screens`, `tv_playlist`, `playlist_content`) **[PASS]**
   - Acceso de solo lectura sobre `nexus_tv.users` **[PASS]**
   - Denegación de mutaciones (INSERT, UPDATE, DELETE) en `nexus_tv.users` con código `42501` **[PASS]**
   - Denegación de comando `TRUNCATE` con código `42501` **[PASS]**
   - Denegación de DDL (`CREATE TABLE`, `DROP TABLE`) **[PASS]**
   - Denegación de escalada administrativa (`ALTER ROLE nexus_app SUPERUSER`) **[PASS]**
   - Denegación de consumo de secuencia administrativa `users_id_seq` **[PASS]**

---

## 4. Estado Final de Hallazgos Priorizados

| ID | Hallazgo | Estado | Categoría de Cierre |
|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | Mitigado en arquitectura / Validado en QA | **Mitigado / Corregido y verificado en QA aislado** (Pendiente de aplicación en caliente por DBA) |
| **AUD-002** | Heartbeat anónimo y manejo de errores | Totalmente remediado y probado | **Corregido y verificado** |
| **AUD-003** | Vulnerabilidad de `source-map-js` | Overrides explícitos, árbol limpio y npm audit a cero | **Corregido y verificado** |
| **AUD-004** | Upload sin allowlist de firma | En cola de remediación P2 | **Pendiente** |
| **AUD-005** | Entrega de credencial en pairing | En cola de remediación P2 | **Pendiente** |
| **AUD-006** | Token en query string WebSocket | Handshake soporta headers/auth | **Mitigado** |
| **AUD-007** | Directorio `/media/*` público | Sujeto a clasificación de datos | **Pendiente** |
| **AUD-008** | Exposición de puerto PostgreSQL | Vinculación a loopback `127.0.0.1` | **Corregido en configuración y verificado** |

---

## 5. Declaraciones de Cumplimiento de Seguridad y Garantía Operativa

- **No destrucción de datos:** Se declara y comprueba que el contenedor activo `tv-db` y el volumen persistente `tv_gsi_tv_pgdata` no sufrieron mutaciones, eliminaciones ni reinicios destructivos.
- **Sin operaciones Git remotas:** No se ejecutaron comandos `git commit`, `git push`, cambios de rama ni operaciones que alteren el repositorio remoto.
- **Sin filtrado de secretos:** Ningún hash, secreto, token o dato sensible extraído de los bloques `COPY` o variables de entorno fue replicado en reportes o artefactos de prueba.

---

## 6. Misión 2B — Verificación Independiente y Gate de Seguridad (2026-10-09)

### 6.1 Demostración Empírica de Aislamiento
1. **Contenedores y Volúmenes:**
   - `tv-db`: Contenedor oficial Compose, volumen `tv_gsi_tv_pgdata`, puerto `25432`, uptime continuo de >29 horas.
   - `nexus-audit-pg-d66618f0cd6047b3931745830dfcaf31`: Contenedor efímero de auditoría, volumen anónimo `7ad015dc...`, network `none`, puertos `{}`.
   - `nexus-qa-isolated-db`: Contenedor QA aislado, volumen `nexus_qa_isolated_pgdata`, puerto `127.0.0.1:25499`.
2. **Integridad de Datos Reales:**
   - La base de datos `tv-db` mantiene con exactitud el inventario auditado preexistente: 8 pantallas (7 activas, 1 inactiva, 0 credenciales pendientes), 4 playlists, 47 ítems de contenido y 10 usuarios.
   - Cero escrituras, mutaciones o reinicios destructivos ocurrieron sobre el entorno real.

### 6.2 Blindaje de Suites de Integración
1. **Guardas Anti-Producción:**
   - [tests/tv-heartbeat-integration.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/tv-heartbeat-integration.test.js) y [tests/qa-least-privilege.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/qa-least-privilege.test.js) bloquean terminantemente la ejecución contra el puerto `25432` o `process.env.PG_PORT=25432` lanzando una excepción de violación de seguridad.
   - Se eliminaron directivas `t.skip`. Si el contenedor QA no responde, la prueba falla explícitamente (`assert.fail`).
   - Se valida preventivamente `current_database = 'nexus_tv'` y `current_user = 'nexus_app'` antes de emitir sentencias.
2. **Validación de Denegación Real:**
   - Cada consulta negativa en [tests/qa-least-privilege.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/qa-least-privilege.test.js) se ejecuta de forma independiente y valida el código de error PostgreSQL `42501` (`insufficient_privilege`).

### 6.3 Reproducibilidad Frontend y Gestión de Dependencias
1. **Toolchain Oficial:** Se corroboró que el pipeline oficial de CI y Docker emplea exclusivamente `npm ci` bajo Node 24 LTS. `pnpm-lock.yaml` es un archivo redundante que no participa en las etapas de construcción.
2. **Bindings Nativos de Windows:**
   - Vite 8 / Rolldown y Oxlint imponen en upstream `"engines": { "node": "^20.19.0 || >=22.12.0" }`.
   - En el host local con Node `v20.18.0`, npm Arborist descarta las dependencias opcionales por incompatibilidad de engine.
   - Se rechazó terminantemente el uso de atajos como `npm install --force --no-save`.
   - La reproducibilidad fue probada de forma integral en el entorno objetivo mediante `docker build frontend` (Node 24 LTS), logrando una instalación y compilación limpia de 126 módulos en 508 ms.
   - **Estado:** Corregido y verificado en Docker/CI (Node 24); Corregido, pendiente de verificación en host (requiere Node >=22.12 / 24 LTS en Windows).

### 6.4 Mínimo Privilegio en Instalación Limpia (AUD-001)
1. **Segregación:** Verificada la creación del superusuario administrador (`qa_admin`) en el bootstrap y del rol de aplicación `nexus_app` mediante [migrations/06_runtime_user.sql](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/migrations/06_runtime_user.sql).
2. **Permisos:** `nexus_app` posee login, permisos CRUD sobre tablas de negocio y lectura en `users`. Tiene denegado terminantemente `TRUNCATE`, DDL, `ALTER ROLE`, creación de bases de datos y conexión a bases externas (`postgres`).

### 6.5 Evidencia de Cierre y Verificaciones Finales Misión 2B
- `npm test`: **93/93 pruebas aprobadas** (0 fallos).
- `npm audit`: **0 vulnerabilidades** en backend y frontend.
- `git diff --check`: **0 errores de formato o sintaxis**.
- Cero commits, pushes ni modificaciones remotas.

---

## 7. Misión 2C — Validación Funcional del Mínimo Privilegio y Cierre de Evidencias (2026-10-09)

### 7.1 Validación Funcional de las Necesidades Reales de `nexus_app` sobre `nexus_tv.users`

1. **Inspección Exhaustiva de Consultas SQL en Backend:**
   - Se realizó una búsqueda sistemática en todo el código fuente del backend (`src/`).
   - Se comprobó que el único punto del backend que accede a la tabla `nexus_tv.users` es [src/routes/auth.js:22](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/auth.js#L22):
     ```sql
     SELECT id, username, email, role, password_hash FROM nexus_tv.users WHERE username = $1;
     ```
   - No existen rutas ni servicios en el producto que realicen inserciones, actualizaciones o eliminaciones sobre `nexus_tv.users` (no hay endpoints de registro de usuarios, cambio de contraseña ni administración de perfiles en la API o frontend). La creación y gestión de administradores es una operación out-of-band/administrativa (mediante migraciones iniciales o scripts de bootstrapping con privilegios de administrador).
2. **Evaluación de Mínimo Privilegio:**
   - La concesión de permisos de solo lectura (`SELECT`) a `nexus_app` sobre `nexus_tv.users` satisface el **100% de los requerimientos funcionales legítimos** de la aplicación.
   - Denegar `INSERT`, `UPDATE` y `DELETE` sobre `nexus_tv.users` al rol de runtime `nexus_app` es una medida fundamental de defensa en profundidad que evita que una vulnerabilidad de inyección SQL o compromiso de aplicación modifique contraseñas de administradores o inyecte usuarios privilegiados espurios.
3. **Prueba End-to-End con Rutas Reales de Express:**
   - Se integró en [tests/qa-least-privilege.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/qa-least-privilege.test.js) un test funcional con el router real [src/routes/auth.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/auth.js) conectado al pool de `nexus_app` sobre la base QA.
   - La prueba validó:
     - `POST /api/auth/login` con credenciales válidas genera exitosamente un JWT y retorna la información de usuario (HTTP 200).
     - Acceso al endpoint protegido `GET /api/auth/me` con el token emitido.
     - `POST /api/auth/login` con credenciales inválidas rechaza deterministamente con HTTP 401.
     - Intentos de inserción, actualización o borrado en `nexus_tv.users` ejecutados por `nexus_app` son rechazados por PostgreSQL con error `42501` (`insufficient_privilege`).

### 7.2 Endurecimiento de las Guardas de Identidad del Entorno QA

1. **Módulo de Guarda Estricta ([tests/qa-guard.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/qa-guard.js)):**
   - Se implementó la función `assertAuthorizedQaEnvironment(poolConfig, expectedRole)` para verificar preventivamente que el destino de las pruebas sea inequívocamente el entorno QA antes de permitir cualquier mutación o consulta de prueba.
2. **Criterios de Verificación Estricta:**
   - **Destino obligatorio:** `host === '127.0.0.1'`, `port === 25499`, `database === 'nexus_tv'`. Cualquier otro puerto (incluyendo producción `25432` o el estándar `5432`) detiene la ejecución inmediatamente.
   - **Rechazo de credenciales predeterminadas:** Prohíbe explícitamente el uso de roles de desarrollo/producción (`tv`, `postgres`, `nexus_admin`).
   - **Marca de identidad en catálogo:** Ejecuta una consulta de solo lectura contra `pg_database` y `pg_shdescription`:
     ```sql
     SELECT pg_database.datname, pg_shdescription.description
     FROM pg_database
     LEFT JOIN pg_shdescription ON pg_database.oid = pg_shdescription.objoid
     WHERE pg_database.datname = current_database();
     ```
     Exige que el comentario de la base sea exactamente `'QA_ISOLATED_DB_25499_VALIDATED'`.
   - En la base de producción real (`tv-db` en puerto 25432), este comentario es `NULL` (vacío). Si la marca no coincide, la suite aborta con una excepción crítica antes de cualquier consulta.
   - **Validación de rol efectivo:** Verifica que `current_user` coincida con el rol esperado (`nexus_app` para pruebas funcionales/de privilegios mínimos, o `qa_admin` exclusivamente para la inserción inicial de fixtures de prueba cuando sea imprescindible).

### 7.3 Corrección de la Clasificación de AUD-006 (Exposición de Tokens en Handshake)

1. **Inspección Técnica de Socket.IO ([src/sockets/index.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/sockets/index.js)):**
   - En la línea 34, el middleware de autorización extrae el token de dispositivo mediante:
     ```javascript
     const deviceToken = auth.device_token || query.device_token || socket.handshake.headers?.['x-device-token'];
     ```
2. **Estado Real de los Clientes:**
   - El cliente web oficial [TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx#L487) fue migrado para enviar credenciales mediante `auth: { tv_uuid, device_token }` y cabeceras `X-Device-Token`, manteniendo `query: {}`.
   - Sin embargo, el servidor backend **continúa aceptando tokens a través de la query string** (`query.device_token`) para preservar la retrocompatibilidad con pantallas físicas y clientes empotrados existentes (Smart TVs Tizen/webOS).
3. **Reclasificación Honesta:**
   - Conforme a los principios de auditoría, la mera existencia de alternativas seguras (`auth` y cabeceras) **no elimina la vulnerabilidad** mientras el servidor siga admitiendo la transmisión sensible por query string (la cual puede quedar registrada en logs de servidores web, proxies inversos y telemetría de red).
   - Se reclasifica formalmente AUD-006 de "Mitigado" a **Pendiente / Parcialmente mitigado**, manteniendo documentado el riesgo residual y la justificación técnica de compatibilidad.

### 7.4 Reproducibilidad Limpia del Frontend y Exactitud Histórica

1. **Transparencia en el Historial de Instalación:**
   - Se documenta con precisión que en fases exploratorias previas se intentó la instalación mediante atajos (`npm install --force --no-save`) para sortear el descarte de dependencias opcionales de Vite/Oxlint en Windows con Node 20.18.0.
   - En Misión 2B y 2C, dicho enfoque fue rechazado de acuerdo con las políticas de integridad, adoptándose la validación formal en el entorno objetivo oficial (Node 24 LTS).
2. **Validación en Contenedor Limpio Node 24 LTS (`node:24-alpine`):**
   - Se ejecutó la secuencia completa del proyecto sin paquetes adicionales ni banderas forzadas:
     - `npm ci`: 65 paquetes instalados limpiamente en 5 s con 0 vulnerabilidades.
     - `npm run build`: Vite 8.3.0 compila los 126 módulos en 405 ms (`dist/index.html` 0.79 kB, JS bundle 431.43 kB).
     - `npx oxlint src`: Finalizado en 24 ms sobre 15 archivos con 0 errores (1 advertencia no bloqueante por variable no utilizada).
     - `npm audit`: 0 vulnerabilidades.
3. **Evaluación de `frontend/pnpm-lock.yaml`:**
   - Se verificó que ni CI (`.github/workflows/ci.yml`) ni los Dockerfiles consumen `pnpm`. El archivo es redundante pero se conserva trackeado para evitar eliminaciones no solicitadas fuera del alcance de la misión.
4. **Reversión de Cambios Incidentales:**
   - Se revirtió la modificación de formato en [docs/14-changelog/releases/v2.1.3.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/14-changelog/releases/v2.1.3.md) introducida previamente de forma incidental al resolver `git diff --check`, preservando la integridad histórica de versiones pasadas.

### 7.5 Estado Final Consolidado de la Auditoría tras Misión 2C

| ID | Hallazgo | Severidad | Estado Oficial Misión 2C | Evidencia y Justificación Técnica |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | **Mitigado en arquitectura / Corregido y verificado en QA aislado** (Pendiente en DB real) | Separación formal bootstrap vs. runtime en `06_runtime_user.sql`. Rol `nexus_app` validado funcionalmente end-to-end con rutas Express y operaciones CRUD de negocio. Lectura exclusiva en `users` cubre 100% de la funcionalidad legítima. Base real intacta a la espera de ventana de mantenimiento DBA. |
| **AUD-002** | Heartbeat anónimo y manejo de errores | P1 | **Corregido y verificado** | Remediado en [tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/tv.js). Guardas estrictas de QA con marca de identidad. 10 tests unitarios y 9 de integración PostgreSQL real aprobados (0 fallos). |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 | **Corregido y verificado** | `source-map-js@1.2.2` fijado por `overrides` en `package.json`. `npm audit` a 0 vulnerabilidades. Compilación reproducible verificada en Docker Node 24 LTS. |
| **AUD-004** | Upload sin allowlist de firma MIME | P2 | **Pendiente** | Fuera de alcance de Misión 2 / 2B / 2C. |
| **AUD-005** | Entrega volátil en pairing sin ACK | P2 | **Pendiente** | Fuera de alcance de Misión 2 / 2B / 2C. |
| **AUD-006** | Token en query string WebSocket | P2 | **Pendiente / Parcialmente mitigado** | Frontend web migrado a `auth: {}` y cabeceras `X-Device-Token`. El backend conserva soporte de query string por retrocompatibilidad con pantallas físicas; el riesgo en logs persiste para dichos dispositivos. |
| **AUD-007** | Directorio `/media/*` público | P2 | **Pendiente** | Sujeto a decisión y política de negocio. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | **Corregido en configuración y verificado** | `docker-compose.yml` restringe a `127.0.0.1` por defecto. Verificado vía `docker compose config`. |

### 7.6 Métricas de Retest Final Misión 2C

- **Suite Automatizada de Backend:** `npm test` ejecuta 94 pruebas (63 unitarias de regresión, 10 unitarias de heartbeat con mock, 9 de integración HTTP/PostgreSQL contra QA aislado, 10 de privilegios mínimos y autenticación Express real, 2 de normalización de playlists); **94 passed, 0 failed** (2.06 s).
- **Auditoría de Dependencias:** `npm audit` reporta **0 vulnerabilidades** en raíz (backend) y **0 vulnerabilidades** en `frontend/`.
- **Compilación Limpia:** Compilación en Docker Node 24 LTS finalizada exitosamente en 405 ms.
- **Higiene de Formato:** `git diff --check` finalizó con **0 advertencias y 0 errores**.
- **Seguridad de Datos:** Base de datos de producción (`tv-db`), volumen (`tv_gsi_tv_pgdata`) e inventario de registros preexistentes permanecen **completamente intactos y sin mutaciones**.
- **Políticas Git:** Cero commits, cero pushes, cero cambios de rama y cero operaciones destructivas.

---

## 8. Misión 2D — Validación del Bootstrap y del Estado Efectivo de PostgreSQL (2026-10-09)

### 8.1 Verificación de Causa Raíz de AUD-001 y Corrección del Flujo de Bootstrap Limpio

1. **Diagnóstico de la Inicialización Predeterminada:**
   - La inspección de [docker-compose.yml](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docker-compose.yml) reveló que `POSTGRES_USER` empleaba el valor por defecto `${PG_ADMIN_USER:-${PG_USER:-tv}}`.
   - Si un operador no definía explícitamente `PG_ADMIN_USER` en `.env`, PostgreSQL `initdb` creaba el rol `tv` como el superusuario inicial del clúster.
   - Posteriormente, al ejecutarse [migrations/01_init_nexus_tv.sql](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/migrations/01_init_nexus_tv.sql):
     ```sql
     IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'tv') THEN
        CREATE ROLE tv WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
     END IF;
     ```
     Dado que `tv` ya había sido creado por `initdb`, la condición `IF NOT EXISTS` resultaba falsa, omitiendo la sentencia y **dejando al rol `tv` como superusuario login con privilegios absolutos**.
   - Adicionalmente, `PG_APP_USER` en el servicio `db` carecía de valor por defecto (`${PG_APP_USER:-}`), provocando que [migrations/06_runtime_user.sql](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/migrations/06_runtime_user.sql) abortara con `\quit 3` en una instalación que no configurara explícitamente `.env`.
2. **Remediación Mínima y Segura en Configuración:**
   - En [docker-compose.yml](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docker-compose.yml), se establecieron los valores por defecto coherentes con [.env.example](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/.env.example):
     - `POSTGRES_USER: ${PG_ADMIN_USER:-postgres}` (el administrador bootstrap es `postgres`).
     - `PG_APP_USER: ${PG_APP_USER:-nexus_app}` (el usuario de runtime es `nexus_app`).
     - `PG_APP_PASSWORD: ${PG_APP_PASSWORD:-${PG_PASSWORD:?Set PG_APP_PASSWORD in .env}}`.
     - Healthcheck: `pg_isready -U ${PG_ADMIN_USER:-postgres} -d ${PG_DATABASE:-nexus_tv}`.
     - Backend: `PG_APP_USER=${PG_APP_USER:-nexus_app}`.
3. **Validación Empírica en Instancia QA Desechable (`nexus-qa-clean-bootstrap-val`):**
   - **Despliegue:** Contenedor efímero `nexus-qa-clean-bootstrap-val` en puerto `127.0.0.1:25498`, volumen nuevo `nexus_qa_clean_bootstrap_pgdata`, migraciones higienizadas sin datos de producción (`COPY 0`).
   - **Marca de Identidad:** `COMMENT ON DATABASE nexus_tv IS 'QA_CLEAN_BOOTSTRAP_25498_VALIDATED';`.
   - **Ejecución de Migraciones:** Las migraciones 01 a 06 completaron secuencialmente con código de salida 0.
   - **Auditoría de Catálogo (`pg_roles`):**
     - `postgres`: `rolsuper=true`, `rolcanlogin=true`, `rolcreaterole=true`, `rolcreatedb=true` (Administrador de bootstrap).
     - `nexus_app`: `rolsuper=false`, `rolcanlogin=true`, `rolcreaterole=false`, `rolcreatedb=false`, `rolreplication=false` (Usuario runtime mínimo privilegio).
     - `tv`: `rolsuper=false`, `rolcanlogin=false`, `rolcreaterole=false`, `rolcreatedb=false` (Rol legado inactivo y deshabilitado).
     - Roles adicionales (`ronald`, `nxtv`, `tv_user`, `francisco`, `nx_tv`): Todos deshabilitados (`rolsuper=false`, `rolcanlogin=false`).
   - **Suite Automatizada ([tests/clean-bootstrap.test.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/tests/clean-bootstrap.test.js)):**
     - Verificación de guardas de aislamiento y marca de catálogo **[PASS]**
     - Creación de `nexus_app` y consumo efectivo de variables **[PASS]**
     - Atributos estrictos de no-superusuario para `nexus_app` **[PASS]**
     - Rol legado `tv` sin login y sin superusuario **[PASS]**
     - Operaciones CRUD completas sobre tablas operativas (`tv_screens`, `playlists`, `content`, relaciones) **[PASS]**
     - Lectura sobre `nexus_tv.users` para flujos de autenticación **[PASS]**
     - Mutaciones en `users` denegadas con código PostgreSQL `42501` **[PASS]**
     - Operaciones administrativas indebidas (`TRUNCATE`, `CREATE TABLE`, `ALTER ROLE`) denegadas **[PASS]**
     - Conexión cruzada a base de datos externa `postgres` denegada por revocación de `CONNECT` **[PASS]**

### 8.2 Diferenciación Técnica entre Configuración Declarada y Contenedor Activo (AUD-008)

1. **Evidencia Técnica de Solo Lectura:**
   - **Contenedor en Ejecución (`tv-db`):**
     - `docker inspect tv-db --format '{{json .NetworkSettings.Ports}}'`:
       ```json
       {"5432/tcp":[{"HostIp":"0.0.0.0","HostPort":"25432"},{"HostIp":"::","HostPort":"25432"}]}
       ```
     - El contenedor activo continúa físicamente publicado en `0.0.0.0:25432` y `[::]:25432`, accesible desde cualquier interfaz de red externa.
   - **Configuración Declarada en Proyecto ([docker-compose.yml](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docker-compose.yml)):**
     - `docker compose config`:
       ```yaml
       ports:
         - mode: ingress
           host_ip: 127.0.0.1
           target: 5432
           published: "25432"
           protocol: tcp
       ```
     - El archivo de configuración restringe la vinculación a `127.0.0.1` de forma predeterminada mediante `${HOST_DB_BIND:-127.0.0.1}`.
2. **Causa de la Divergencia y Restricción Operativa:**
   - El contenedor `tv-db` fue creado hace más de 29 horas, con anterioridad a las modificaciones realizadas en el archivo Compose.
   - En cumplimiento estricto de las directivas de la misión, **no se recreó ni reinició el contenedor activo** para evitar cualquier riesgo de indisponibilidad o pérdida de datos en la base viva.
3. **Clasificación Oficial de AUD-008:**
   - No puede declararse corregido mientras el proceso Docker activo permanezca expuesto fuera de loopback.
   - Estado oficial: **Mitigado en configuración / Pendiente de intervención operativa en el entorno activo**.
4. **Procedimiento Operativo para Ventana de Mantenimiento:**

   #### 4.1 Procedimiento Controlado para AUD-001 (Aplicación de Roles en Volumen Activo)
   > [!IMPORTANT]
   > **Aclaración de Arquitectura de PostgreSQL:**
   > - Modificar `POSTGRES_USER` o `PG_APP_USER` en `docker-compose.yml` **NO crea ni modifica roles en un volumen PostgreSQL que ya ha sido inicializado** (`tv_gsi_tv_pgdata`).
   > - Los scripts en `/docker-entrypoint-initdb.d/` se ejecutan **exclusivamente durante el primer `initdb`** y **NO se vuelven a ejecutar automáticamente** al reiniciar o recrear un contenedor sobre un volumen persistente ya poblado.
   > - La aplicación del rol runtime `nexus_app` a la base de datos activa exige una intervención DBA controlada y separada.

   - **Paso 1 (Respaldo lógico preventivo):**
     ```powershell
     docker exec tv-db pg_dump -U tv -d nexus_tv -Fc > "backups/pre_roles_nexus_tv_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
     ```
   - **Paso 2 (Aplicación manual de rol runtime sobre la base activa):**
     ```powershell
     docker exec -i tv-db psql -U tv -d nexus_tv -f /docker-entrypoint-initdb.d/06_runtime_user.sql
     ```
     *(O ejecución dirigida de las sentencias DDL correspondientes para aprovisionar `nexus_app` y restringir roles legados sin corte destructivo).*
   - **Paso 3 (Verificación de privilegios en catálogo activo):**
     ```sql
     SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolname IN ('tv', 'nexus_app', 'postgres');
     ```
   - **Paso 4 (Conmutación de credenciales en backend):**
     - Actualizar variables `PG_USER=nexus_app` y `PG_PASSWORD` en `.env` de producción.
     - Recrear servicio backend: `docker compose up -d --no-deps backend`.
     - Verificar `/api/status` y logs de arranque.

   #### 4.2 Procedimiento Controlado para AUD-008 (Publicación de PostgreSQL en Loopback)
   > [!IMPORTANT]
   > - La publicación de PostgreSQL en loopback **solo puede marcarse como aplicada al entorno activo después de verificar `docker inspect` y la conectividad posterior**.
   > - Mientras no exista dicha evidencia física post-recreación, AUD-008 permanece pendiente en producción.

   - **Paso 1 (Respaldo preventivo):**
     ```powershell
     docker exec tv-db pg_dump -U tv -d nexus_tv -Fc > "backups/pre_bind_nexus_tv_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
     ```
   - **Paso 2 (Recreación no destructiva del servicio `db`):**
     ```powershell
     docker compose up -d --no-deps db
     ```
     *(Conserva intacto el volumen `tv_gsi_tv_pgdata` y reasigna los puertos del contenedor conforme a `HOST_DB_BIND=127.0.0.1`).*
   - **Paso 3 (Verificaciones post-mantenimiento obligatorias):**
     1. **Inspección de enlace:** `docker inspect tv-db --format '{{json .NetworkSettings.Ports}}'` debe reportar estrictamente `HostIp: "127.0.0.1"`.
     2. **Conectividad backend:** Comprobar que `tv-backend` sigue alcanzando `db:5432` a través de la red interna Docker `tv_network`.
     3. **Healthcheck de API:** Verificar `http://localhost:23002/api/status` (HTTP 200).
     4. **Verificación perimetral:** Comprobar desde un host externo en la LAN que el puerto `25432` no es accesible desde el exterior.

### 8.3 Estado Final Consolidado de la Auditoría tras Misión 2D

| ID | Hallazgo | Severidad | Estado Oficial Misión 2D | Justificación Técnica y Evidencia |
|---|---|---|---|---|
| **AUD-001** | Privilegios excesivos en PostgreSQL | P1 | **Mitigado en configuración / Corregido y verificado en QA aislado / Pendiente en producción** | Causa raíz remediada en `docker-compose.yml` (`POSTGRES_USER=postgres`, `PG_APP_USER=nexus_app`). Bootstrap limpio validado empíricamente en `nexus-qa-clean-bootstrap-val` con 8/8 pruebas exitosas. Rol `tv` queda deshabilitado (`NOLOGIN NOSUPERUSER`). Pendiente de aplicar migración de roles en base activa `tv-db` en ventana de mantenimiento DBA. |
| **AUD-002** | Heartbeat anónimo y manejo de errores | P1 | **Corregido y verificado** | Remediado en [tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/tv.js). Guardas estrictas de QA con marca de catálogo. 10 tests unitarios y 9 de integración PostgreSQL real aprobados (0 fallos). |
| **AUD-003** | Vulnerabilidad de `source-map-js` | P1 | **Corregido y verificado en Docker/CI (Node 24 LTS) / Pendiente de verificación en host** | `source-map-js@1.2.2` fijado por `overrides` en `package.json`. `npm audit` a 0 vulnerabilidades. Compilación reproducible verificada en Docker Node 24 LTS. Pendiente de verificación en host Windows hasta actualización a Node >=22.12 / 24 LTS. |
| **AUD-004** | Upload sin allowlist de firma MIME | P2 | **Pendiente** | Fuera de alcance de Misión 2. |
| **AUD-005** | Entrega volátil en pairing sin ACK | P2 | **Pendiente** | Fuera de alcance de Misión 2. |
| **AUD-006** | Token en query string WebSocket | P2 | **Pendiente / Parcialmente mitigado** | Frontend web migrado a `auth: {}` y cabeceras `X-Device-Token`. El backend conserva soporte de query string por retrocompatibilidad con pantallas físicas; el riesgo en logs persiste para dichos dispositivos. |
| **AUD-007** | Directorio `/media/*` público | P2 | **Pendiente** | Sujeto a decisión y política de negocio. |
| **AUD-008** | Exposición de puerto PostgreSQL | P2 | **Mitigado en configuración / Pendiente en producción** | `docker-compose.yml` restringe a `127.0.0.1` por defecto. `docker compose config` validado. Contenedor activo `tv-db` continúa físicamente en `0.0.0.0:25432` hasta recreación controlada en ventana de mantenimiento. |

### 8.4 Retest Final Consolidado

- **Pruebas Automatizadas Totales:** `npm test` ejecuta 103 pruebas:
  - 63 unitarias de regresión
  - 10 unitarias de heartbeat con mocks
  - 9 de integración HTTP/PostgreSQL con mutaciones reales en base QA aislada
  - 10 de privilegios mínimos y autenticación Express real en base QA aislada
  - 9 de validación de bootstrap limpio y mínimo privilegio en QA desechable (`clean-bootstrap.test.js`)
  - 2 de normalización de playlists
  - **Resultado:** **103 passed, 0 failed** (2.28 s).
- **Auditoría de Dependencias:** `npm audit` reporta **0 vulnerabilidades** en backend y **0 vulnerabilidades** en `frontend/`.
- **Higiene de Formato:** `git diff --check` finalizó con **0 advertencias y 0 errores**.
- **Inspección de Secretos:** Cero credenciales reales, tokens o secretos de producción incorporados en informes o código.
- **Control de Versiones:** Cero commits, cero pushes, cero cambios de rama y cero operaciones destructivas sobre volúmenes o contenedores activos.

