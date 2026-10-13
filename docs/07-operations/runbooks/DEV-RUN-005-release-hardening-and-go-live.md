# DEV-RUN-005 — Endurecimiento de release y puesta en producción de Nexus TV

> **Tipo:** Runbook de despliegue consolidado
> **Versión:** 1.1 (revisada y corregida tras preflight de solo lectura — 2026-10-13)
> **Responsable:** Operaciones de Nexus TV + Seguridad + DBA
> **Sistemas:** Backend (Node 24), Frontend (Nginx + React), PostgreSQL 17, Docker Compose
> **Hallazgos relacionados:** AUD-001 a AUD-008
> **ADR relacionados:** ADR-005, ADR-006
> **Runbooks previos:** DEV-RUN-003 (recomisión), DEV-RUN-004 (retirada AUD-006)

### Cambios de v1.0 → v1.1 (defectos corregidos en la revisión de preflight)

| # | Defecto detectado en v1.0 | Corrección en v1.1 |
|---|---|---|
| C1 | Respaldo: el glob `/tmp/*.dump` no se expande dentro de `docker exec` (sin shell) y `scp` apuntaba al host, no al contenedor → el dump **nunca salía del contenedor** (respaldo ilusorio) | §4: nombre determinístico, `sh -c` interno, verificación `pg_restore --list`, `docker cp` al host, SHA-256 y restauración de prueba en QA efímero |
| C2 | Orden de migraciones 07 → 06: `07` sólo concede permisos a roles **existentes**, por lo que `nexus_app` quedaría sin GRANTs sobre `pending_pairings` → fallos 42501 en pairing en runtime | §6: orden obligatorio **06 → 07** (además, es el orden requerido por la ventana) |
| C3 | `psql -U postgres`: el volumen activo fue inicializado con rol **`tv`**; el rol `postgres` **no existe** → todos los comandos fallarían | §3/§4/§6: detección dinámica `$ADMIN = docker exec tv-db printenv POSTGRES_USER` |
| C4 | `06_runtime_user.sql` usa `\getenv PG_APP_USER/PG_APP_PASSWORD`: el contenedor activo no tiene esas variables → `\getenv` fallaría | §6: carga de `.env` en sesión sin imprimir valores + `docker exec -e PG_APP_USER -e PG_APP_PASSWORD` |
| C5 | `docker exec tv-backend pg_isready`: la imagen Node no incluye cliente PostgreSQL | §7: `pg_isready` desde `tv-db` + prueba de conexión real por red con contenedor efímero |
| C6 | `docker compose pull backend frontend`: servicios construidos localmente (sin registry) → error | §7: sólo `docker compose build` |
| C7 | Rollback `docker compose up -d --no-deps backend:v2.1.0`: sintaxis inválida | §10: pre-etiquetado de imágenes actuales (`pre-v2.2.0`) + `--force-recreate` |
| C8 | Verificación de logs apuntaba a `/var/log/backend/` (el backend loguea a stdout) y a rutas de Nginx sin especificar contenedor | §9: `docker logs tv-backend` y `docker exec tv-frontend …` |
| C9 | Dependencia de `jq` (no disponible en el host) para inspección de puertos | §3/§9: `docker port tv-db 5432/tcp` + `docker inspect --format` |
| C10 | Faltaba el paso de **recreación controlada de `tv-db`** para aplicar publicación loopback conservando el volumen | §8 nuevo (paso 7 de la ventana) |
| C11 | Faltaban puertas de verificación de la clave y de valores efectivos (no confiar sólo en archivos) | §5 (gate de formato), §7 (`KEY_OK` antes de activar), §9 (verificación efectiva con `printenv`) |
| C12 | `curl` en PowerShell es `Invoke-WebRequest` (flags distintos → error ruidoso) | Todos los ejemplos usan `curl.exe` |
| C13 | Pruebas funcionales abreviadas y sin responsable de credenciales | §9: comandos concretos + asignación de credenciales al operador |
| C14 | Verificación de restauración sobre el QA marcado (`25499`) destruiría el marcador `QA_ISOLATED_DB_25499_VALIDATED` | §4: QA efímero propio en `127.0.0.1:25497`, destruido tras la verificación |

---

## 1. Objetivo y alcance

Desplegar la versión endurecida de Nexus TV Enterprise v2.2.0 en el entorno activo, aplicando todas las correcciones de seguridad y auditoría validadas en QA (Misiones 1–5), dentro de una ventana de mantenimiento aprobada, con respaldo verificable previo y rollback definido por etapa.

**Este runbook NO se ejecuta sin aprobación explícita de la ventana.** La Fase A (preflight) es de sólo lectura.

---

## 2. Estado de los hallazgos + evidencia de preflight (2026-10-13, sólo lectura)

| Hallazgo | Estado | Evidencia observada en preflight |
|---|---|---|
| **AUD-001** — Roles superusuario PostgreSQL | **Activo en producción / pendiente de intervención operativa** | `pg_roles`: `tv`, `nx_tv`, `tv_user` → `rolsuper=true`; rol `nexus_app` **no existe**; el backend activo conecta como `PG_USER=tv` (env del contenedor) |
| **AUD-002** — Heartbeat | Corregido y verificado en QA | 10 tests `tv-heartbeat` en la regresión; se re-verifica en §9 |
| **AUD-003** — `source-map-js` / Node 24 | Corregido en código; **no desplegado** | Contenedor activo: `node -v` → `v20.20.2`; `Dockerfile` actual: `FROM node:24-alpine` |
| **AUD-004** — Upload multimedia | Corregido y verificado en QA | 9 tests `media-upload` + `media-real-ffprobe` |
| **AUD-005** — Pairing | Corregido en código; **migración no aplicada** | `to_regclass('nexus_tv.pending_pairings')` → `MISSING` en la base activa |
| **AUD-006** — Token en query string | Mitigado en código; **no desplegado** | Imagen activa: `grep 'query string is rejected' /app/src/sockets/index.js` → `0`; imagen frontend: `grep nexus_safe_query` → `0` |
| **AUD-007** — Multimedia pública | Corregido en código; **exposición activa verificada** | `GET /media/<archivo real>` → **HTTP 200 anónimo** en `:23002` y en `:28080`; imagen activa sin `signedMediaUrl.js` |
| **AUD-008** — Puerto PostgreSQL | Configuración mitigada en Compose; **no aplicada al contenedor** | `docker inspect tv-db`: `0.0.0.0:25432` y `:::25432` (todas las interfaces); Compose nuevo define `HOST_DB_BIND` por defecto `127.0.0.1` |

Otros hallazgos del preflight:

- Los tres contenedores activos están `healthy` (imágenes generadas 2026-10-10, id backend `sha256:9fa036118daa…`, frontend `sha256:e489851a883a…`).
- `.env` es **legado** (801 bytes): no contiene `PG_ADMIN_USER`, `PG_APP_USER`, `PG_APP_PASSWORD`, `MEDIA_URL_SIGNING_KEY`, `ALLOW_QUERY_DEVICE_TOKEN` ni `HOST_DB_BIND` (verificado por conteos de coincidencia, sin imprimir contenido). Compose resuelve esos valores con defaults seguros; las adiciones requeridas se indican en §5/§6.
- `docker compose config -q` → exit 0 (composición válida con `.env` actual).
- Cobertura de permisos de `06`/`07` verificada contra el código: la aplicación sólo escribe `content`, `playlist_content`, `playlists`, `tv_playlist`, `tv_screens` (CRUD concedido) y `pending_pairings` (concedido por 07); `users` es de sólo lectura en la app; `tv_playlist` no tiene SERIAL (sin secuencia que conceder); las 4 secuencias concedidas = secuencias reales de la base; validado además por `tests/qa-least-privilege.test.js` (QA aislado 25499).
- Pila efímera de la MISIÓN 5B **sigue levantada**: `nginx-integration-test` (0.0.0.0:18080), `backend-integration-test` (0.0.0.0:13002), `db-integration-test` (0.0.0.0:15432), red `tv_gsi_test-network`, imagen `tv_gsi-backend-test` → **propuesta de retirada en la ventana** (§11), no ejecutada todavía.
- QA autorizado por guardas: `127.0.0.1:25499` (`nexus-qa-isolated-db`, marcador `QA_ISOLATED_DB_25499_VALIDATED`) y `127.0.0.1:25498` (`nexus-qa-clean-bootstrap-val`). Nunca se apunta `25432` desde pruebas.

---

## 3. Fase A — Preflight (SOLO LECTURA, previa a la aprobación)

Ejecutar en PowerShell desde la raíz del repositorio. Ningún comando modifica estado.

```powershell
# A0. Preparación HOST-LOCAL (no toca el entorno activo: Compose sólo lee .env al crear contenedores)
if ((Select-String -Path .env -Pattern '^PG_ADMIN_USER=' | Measure-Object).Count -ne 1) {
    Add-Content .env "PG_ADMIN_USER=tv"      # rol real de ESTE volumen; no es un secreto
}
if ((Select-String -Path .env -Pattern '^PG_APP_PASSWORD=' | Measure-Object).Count -ne 1) {
    $b = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24)
    $p = -join ($b | ForEach-Object { $_.ToString('x2') })   # nunca se imprime
    Add-Content .env "PG_APP_PASSWORD=$p"
    Remove-Variable p, b
}
# MEDIA_URL_SIGNING_KEY se prepara en §5 (C1–C3), también antes de solicitar la aprobación.

# A1. Estado de Git (debe mostrar cambios sin commitear; no hacer commits en la ventana salvo política del equipo)
git status --short
git diff --check                      # debe salir 0

# A2. Contenedores y salud
docker ps --filter "name=tv-" --format "{{.Names}} {{.Status}} {{.Ports}}"
# Esperado: tv-db / tv-backend / tv-frontend "healthy"

# A3. Rol administrador real de ESTE volumen (no asumir 'postgres')
$ADMIN = docker exec tv-db printenv POSTGRES_USER
Write-Output "ADMIN_ROLE=$ADMIN"      # esperado: tv

# A4. Estado de migraciones en la base activa (sólo lectura)
docker exec tv-db psql -U $ADMIN -d nexus_tv -tAc "SELECT rolname||' super='||rolsuper FROM pg_roles WHERE rolname IN ('nexus_app','tv','nx_tv','tv_user') ORDER BY 1"
docker exec tv-db psql -U $ADMIN -d nexus_tv -tAc "SELECT COALESCE(to_regclass('nexus_tv.pending_pairings')::text,'MISSING')"
# Esperado ANTES de la ventana: nexus_app ausente; pending_pairings MISSING; tv/nx_tv/tv_user super=true

# A5. Publicación efectiva del puerto PostgreSQL (AUD-008)
docker port tv-db 5432/tcp            # ANTES: 0.0.0.0:25432 y :::25432  |  DESPUÉS (§8): 127.0.0.1:25432

# A6. Composición válida (no imprime secretos con -q)
docker compose config -q
if ($LASTEXITCODE -ne 0) { throw "docker compose config inválido" }

# A7. Presencia de variables obligatorias en .env (sólo conteos; NO se imprime el archivo)
#     (A0/§5 añaden PG_ADMIN_USER y MEDIA_URL_SIGNING_KEY — ediciones host-local que NO tocan el entorno activo)
if ((Select-String -Path .env -Pattern '^PG_ADMIN_USER='   | Measure-Object).Count -ne 1) { throw "Falta PG_ADMIN_USER en .env" }
if ((Select-String -Path .env -Pattern '^PG_APP_PASSWORD=' | Measure-Object).Count -ne 1) { throw "Falta PG_APP_PASSWORD en .env" }
if ((Select-String -Path .env -Pattern '^MEDIA_URL_SIGNING_KEY=' | Measure-Object).Count -ne 1) { throw "Falta MEDIA_URL_SIGNING_KEY en .env (§5)" }

# A8. Exposición anónima de medios (constatación de AUD-007 en el entorno activo)
Get-ChildItem media | Select-Object -First 5 Name            # elegir un fichero real
curl.exe -s -o NUL -w "anon-media=%{http_code}`n" http://localhost:28080/media/<nombre-real-del-fichero>
# Esperado ANTES del despliegue: 200 (expuesto — así se midió el 2026-10-13). DESPUÉS del despliegue: 403 (§9.4)

# A9. Regresión aplicable en el host (el host tiene Node 20; el runtime de proyecto es Node 24 → CI)
node --test tests/device-auth.test.js tests/nginx-safe-logging.test.js tests/signed-media-url.test.js `
  tests/pairing-session.test.js tests/pairing-ack.test.js tests/auth.test.js tests/rbac.test.js `
  tests/playlist-auth.test.js tests/playlist-playback.test.js tests/tv-heartbeat.test.js `
  tests/schedule-window.test.js tests/normalize-days.test.js tests/media-upload.test.js
# Esperado: 153/153 pass (ver §11 nota N1 sobre el flake de transporte del runner en Node 20)
```

**Puertas (gates) que deben cumplirse ANTES de solicitar la aprobación de la ventana:**

- [ ] A0 preparación host-local aplicada (sólo `.env`, sin tocar contenedores ni base).
- [ ] §5 C1–C3: `MEDIA_URL_SIGNING_KEY` generada y verificada por formato en `.env` (host-local; opcional pre-aprobación, obligatoria antes de E3).
- [ ] A6 composición válida.
- [ ] A7 variables presentes en `.env` (conteos = 1).
- [ ] A9 regresión sin fallos de aserción.
- [ ] Aprobación explícita de DBA + Operaciones + Seguridad + Producto registrada (§11).

**Tras aprobar** (orden de ejecución): §4 respaldo + restauración verificada → §5 clave (si no estaba) → §6 migraciones → §7 despliegue → §8 recreación loopback → §9 verificación. El respaldo verificado es condición previa a CUALQUIER escritura en la base activa (§6).

---

## 4. Fase B — Respaldo lógico verificable (primera operación de la ventana ya aprobada)

> **Sólo lectura de la base** (pg_dump) **+ escritura de artifacts en disco** (`backups/`, QA efímero). La base activa NO se escribe.
> `$ADMIN` proviene de A3 (rol real del volumen, p. ej. `tv`).

```powershell
# B1. Capturar conteos de origen (para comparar tras la restauración de prueba)
$CNT = "SELECT (SELECT count(*) FROM nexus_tv.content)||'|'||(SELECT count(*) FROM nexus_tv.playlists)||'|'||(SELECT count(*) FROM nexus_tv.tv_screens)||'|'||(SELECT count(*) FROM nexus_tv.users)||'|'||(SELECT count(*) FROM nexus_tv.playlist_content)"
$SRC = docker exec tv-db psql -U $ADMIN -d nexus_tv -tAc $CNT
Write-Output "ORIGEN=$SRC"

# B2. Dump lógico (nombre determinístico; pg_dump corre DENTRO del contenedor vía sh -c)
New-Item -ItemType Directory -Force backups | Out-Null
$BK = "nexus_tv_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
docker exec tv-db sh -c "pg_dump -U $ADMIN -Fc -f /tmp/$BK nexus_tv"
if ($LASTEXITCODE -ne 0) { throw "pg_dump falló (exit $LASTEXITCODE); NO continuar la ventana" }

# B3. Verificación de integridad del archivo de dump
docker exec tv-db sh -c "pg_restore --list /tmp/$BK >/dev/null && echo DUMP_OK"
if ($LASTEXITCODE -ne 0) { throw "El dump no es inspeccionable con pg_restore --list" }

# B4. Sacar el dump del contenedor al host + hash
docker cp "tv-db:/tmp/$BK" ".\backups\$BK"
if ($LASTEXITCODE -ne 0) { throw "docker cp falló; el respaldo no está en el host" }
$HASH = (Get-FileHash -Algorithm SHA256 ".\backups\$BK").Hash
Write-Output "SHA256=$HASH"           # registrar este hash en el DEPLOY-LOG

# B5. Restauración de prueba en QA efímero INDEPENDIENTE (nunca 25432 ni 25499)
$QAPORT = 25497
docker volume create qa_restore_check_pgdata | Out-Null
docker run -d --name qa-restore-check `
  -e POSTGRES_USER=postgres -e POSTGRES_DB=nexus_tv -e POSTGRES_HOST_AUTH_METHOD=trust `
  -p 127.0.0.1:$QAPORT:5432 -v qa_restore_check_pgdata:/var/lib/postgresql/data `
  postgres:17-alpine | Out-Null
$tries = 0; $ready = $false
while ($tries -lt 30) {
    docker exec qa-restore-check pg_isready -U postgres | Out-Null    # el bucle reintenta; el gate es $ready
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep 2; $tries++
}
if (-not $ready) { throw "QA de restauración no arrancó en 60s" }

docker cp ".\backups\$BK" qa-restore-check:/tmp/restore.dump
docker exec qa-restore-check pg_restore -U postgres -d nexus_tv --exit-on-error --no-owner --no-acl /tmp/restore.dump
if ($LASTEXITCODE -ne 0) { throw "RESTAURACIÓN DE PRUEBA FALLÓ (exit $LASTEXITCODE); el respaldo NO es restaurable. NO continuar" }

# B6. Comparar conteos origen ↔ restaurado
$DST = docker exec qa-restore-check psql -U postgres -d nexus_tv -tAc $CNT
Write-Output "RESTAURADO=$DST"
if ($SRC -ne $DST) { throw "Conteos distintos: origen=$SRC restaurado=$DST" }
Write-Output "BACKUP_VERIFIED sha256=$HASH conteos=$DST"

# B7. Retirar el QA efímero de prueba (artefacto creado para esta verificación)
docker rm -f qa-restore-check | Out-Null
docker volume rm qa_restore_check_pgdata | Out-Null
docker exec tv-db sh -c "rm -f /tmp/$BK"      # opcional: limpiar el temporario del contenedor
```

**Criterio de aceptación de la Fase B:** `DUMP_OK`, SHA-256 registrado, restauración sin errores, conteos idénticos, QA efímero destruido. Si algo falla → **abortar ventana** (§10.1).

---

## 5. Fase C — Provisionamiento de `MEDIA_URL_SIGNING_KEY` (fuera del repositorio)

```powershell
# C1. Generar 32 bytes con entropía criptográfica (CSPRNG de Windows) — el valor NUNCA se imprime
$bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
$KEY = -join ($bytes | ForEach-Object { $_.ToString('x2') })   # 64 hex chars
if ($KEY.Length -ne 64) { throw "Generación de clave fallida" }

# C2. Añadir/actualizar la línea en .env SIN mostrar el valor (.env está en .gitignore — verificado)
$lines = Get-Content .env
if ($lines -match '^MEDIA_URL_SIGNING_KEY=') {
    $lines = $lines | ForEach-Object { if ($_ -match '^MEDIA_URL_SIGNING_KEY=') { "MEDIA_URL_SIGNING_KEY=$KEY" } else { $_ } }
} else { $lines += "MEDIA_URL_SIGNING_KEY=$KEY" }
Set-Content .env -Value $lines
Remove-Variable KEY, bytes

# C3. Verificación de formato por conteo (NO imprime la clave): 64 hex exactos
if ((Select-String -Path .env -Pattern '^MEDIA_URL_SIGNING_KEY=[0-9a-f]{64}\s*$' | Measure-Object).Count -ne 1) {
    throw "MEDIA_URL_SIGNING_KEY con formato inválido en .env"
}

# C4. Mientras tanto, el backend NO debe activarse con clave ausente/placeholder.
#      El código falla de forma segura (getSigningKey() lanza; ninguna URL se emite ni se valida),
#      y SMU-19/SMU-20 verifican que el placeholder y las claves <32 bytes son rechazados.
```

**Repositorio:** en `.env.example` sólo permanece el placeholder `REPLACE_WITH_…` (nunca una clave real). La clave vive únicamente en `.env` (ignorado) o en el gestor de secretos del entorno. Custo­dia: Seguridad (responsable de respaldarla fuera del host; si se pierde, todas las URLs firmadas dejan de emitirse — fail-safe, no backdoor).

**Criterio:** C3 con `count=1`. Prohibido imprimir o pegar el valor en terminales compartidos, informes o tickets.

---

## 6. Fase D — Migraciones 06 → 07 y verificación de permisos (primer paso que ESCRIBE en la base activa)

**Orden obligatorio y justificado:**

1. `06_runtime_user.sql` — crea/normaliza el rol `nexus_app` (NOSUPERUSER) y concede DML sobre las 6 tablas de negocio + 4 secuencias.
2. `07_pending_pairings.sql` — crea `pending_pairings` y **concede permisos a los roles que ya existen**, incluido `nexus_app`. Si se invertiera el orden, `nexus_app` quedaría sin GRANTs y el pairing fallaría con 42501 en producción.

```powershell
# D1. Cargar .env en la sesión SIN imprimir valores (requerido por \getenv en la migración 06)
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value ($Matches[2].Trim()) }
}
if (-not $env:PG_APP_USER)     { $env:PG_APP_USER = 'nexus_app' }
if (-not $env:PG_APP_PASSWORD) { $env:PG_APP_PASSWORD = $env:PG_PASSWORD; Write-Output "AVISO: PG_APP_PASSWORD no definido; se usa PG_PASSWORD (consistente con el default de Compose)" }

# D2. Verificar que los ficheros de migración están montados en el contenedor
docker exec tv-db sh -c "ls -la /docker-entrypoint-initdb.d/06_runtime_user.sql /docker-entrypoint-initdb.d/07_pending_pairings.sql"

# D3. Migración 06 (idempotente; \quit 3 si el rol fuese SUPERUSER o igual al admin)
docker exec -e PG_APP_USER -e PG_APP_PASSWORD tv-db psql -U $ADMIN -d nexus_tv -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/06_runtime_user.sql
if ($LASTEXITCODE -ne 0) { throw "Migración 06 falló (exit $LASTEXITCODE); abortar y ver §10.2" }

# D4. Migración 07 (CREATE TABLE IF NOT EXISTS + grants a roles existentes)
docker exec tv-db psql -U $ADMIN -d nexus_tv -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/07_pending_pairings.sql
if ($LASTEXITCODE -ne 0) { throw "Migración 07 falló (exit $LASTEXITCODE); abortar y ver §10.2" }

# D5. Verificación de permisos EFECTIVOS (no sólo aplicados en el script)
docker exec tv-db psql -U $ADMIN -d nexus_tv -tAc "SELECT rolname||' super='||rolsuper||' login='||rolcanlogin FROM pg_roles WHERE rolname='nexus_app'"
# Esperado: nexus_app super=false login=true
docker exec tv-db psql -U $ADMIN -d nexus_tv -tAc "SELECT COALESCE(to_regclass('nexus_tv.pending_pairings')::text,'MISSING')"
# Esperado: nexus_tv.pending_pairings
docker exec tv-db psql -U $ADMIN -d nexus_tv -tAc "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='nexus_app' AND table_schema='nexus_tv'"
# Esperado: >= 7 (6 tablas de negocio + pending_pairings)

# D6. Login + DML efectivo como nexus_app (socket local, trust)
docker exec tv-db psql -U nexus_app -h 127.0.0.1 -d nexus_tv -tAc "SELECT count(*) FROM nexus_tv.pending_pairings"
# Esperado: 0

# D7. Autenticación por RED igual que la usará el backend (scram, contraseña real) — contenedor efímero.
#     La sesión usa PG_APP_PASSWORD; psql hereda PGPASSWORD → mapear primero (sin imprimir).
#     -e PGPASSWORD SIN valor: docker lo hereda de la sesión; la contraseña nunca viaja en argv.
$env:PGPASSWORD = $env:PG_APP_PASSWORD
$NET = docker inspect tv-backend --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'
docker run --rm --network $NET -e PGPASSWORD postgres:17-alpine `
  psql -h db -U nexus_app -d nexus_tv -tAc "SELECT count(*) FROM nexus_tv.tv_screens"
if ($LASTEXITCODE -ne 0) { throw "nexus_app no puede autenticar/conectar por red: contraseña o grants incorrectos" }

# D8. Denegación de DDL (mínimo privilegio) — debe fallar con permission denied (42501)
docker exec tv-db psql -U nexus_app -h 127.0.0.1 -d nexus_tv -tAc "CREATE TABLE nexus_tv.perm_check_tmp(x int)"
# Esperado: ERROR: permission denied for schema nexus_tv  (exit != 0)
# Limpieza defensiva por si acaso (no debiera crear nada):
docker exec tv-db psql -U $ADMIN -d nexus_tv -tAc "DROP TABLE IF EXISTS nexus_tv.perm_check_tmp" | Out-Null
```

> **Nota (compatibilidad esquema/código):** el código actual tolera la migración 07 ausente en emparejamiento (devuelve 503 `PAIRING_SCHEMA_NOT_MIGRATED`, fail-safe), pero el backend **nuevo** exige `nexus_app` para conectarse: la migración 06 debe completarse ANTES del corte de backend (§7). El backend antiguo (rol `tv`) sigue operativo mientras se aplican 06/07 → migraciones sin corte.

**Criterio:** D5–D8 con los valores esperados y D8 rechazado con 42501.

---

## 7. Fase E — Actualización coordinada de backend, frontend y Nginx

```powershell
# E1. Snapshot de las imágenes actuales ANTES de reconstruir (base del rollback §10.3/§10.4)
docker tag tv_gsi-backend:latest   tv_gsi-backend:pre-v2.2.0
docker tag tv_gsi-frontend:latest  tv_gsi-frontend:pre-v2.2.0
Copy-Item docker-compose.yml backups\docker-compose.yml.pre-deploy -Force
docker images --format "{{.Repository}}:{{.Tag}}" | Select-String "pre-v2.2.0"

# E2. Build (sin 'pull': los servicios se construyen localmente; imágenes base Node 24)
docker compose build backend frontend
if ($LASTEXITCODE -ne 0) { throw "Build falló; no tocar los servicios actuales" }

# E3. PUERTA DE LA CLAVE: un one-off con la imagen NUEVA, sin tocar servicios en marcha
$gate = docker compose run --rm --no-deps backend node -e 'const k=process.env.MEDIA_URL_SIGNING_KEY||"";console.log(k.length>=64&&!/^REPLACE_WITH/i.test(k)?"KEY_OK":"KEY_INVALID")'
if ($LASTEXITCODE -ne 0 -or $gate -notmatch '^KEY_OK') { throw "Gate de clave falló (salida: $gate) → §10.5" }
Write-Output "GATE=$gate"    # sólo KEY_OK; el valor de la clave jamás se imprime

# E4. Corte de backend
docker compose up -d --no-deps backend
$tries=0; do { Start-Sleep 5; $hs = docker inspect tv-backend --format '{{.State.Health.Status}}'; $tries++ } while ($hs -ne 'healthy' -and $tries -lt 24)
if ($hs -ne 'healthy') { throw "Backend nuevo no quedó healthy (estado: $hs) → §10.3" }

# E5. Verificación de valores EFECTIVOS del backend nuevo (no confiar en archivos)
docker exec tv-backend node -e 'console.log("PG_APP_USER="+process.env.PG_APP_USER);console.log("ALLOW_QUERY_DEVICE_TOKEN="+(process.env.ALLOW_QUERY_DEVICE_TOKEN||"false"));console.log("KEY=" + (((process.env.MEDIA_URL_SIGNING_KEY||"").length>=64)?"OK":"MISSING"))'
# Esperado: PG_APP_USER=nexus_app | ALLOW_QUERY_DEVICE_TOKEN=false | KEY=OK
docker exec tv-backend sh -c "test -f /app/src/utils/signedMediaUrl.js && grep -c 'query string is rejected' /app/src/sockets/index.js"
# Esperado: 1 (mitigaciones AUD-006/AUD-007 presentes en la imagen)

# E6. Corte de frontend (incluye frontend/nginx.conf con log_format nexus_safe_query y proxy /media/)
docker compose up -d --no-deps frontend
$tries=0; do { Start-Sleep 5; $hs = docker inspect tv-frontend --format '{{.State.Health.Status}}'; $tries++ } while ($hs -ne 'healthy' -and $tries -lt 24)
if ($hs -ne 'healthy') { throw "Frontend nuevo no quedó healthy → §10.4" }

# E7. Sanity de Nginx dentro del contenedor nuevo
docker exec tv-frontend sh -c "nginx -t"
docker exec tv-frontend sh -c "grep -c nexus_safe_query /etc/nginx/conf.d/default.conf"   # >= 1
```

**Criterio:** ambos servicios `healthy`, E5 con los tres valores esperados, E6/E7 correctos.

---

## 8. Fase F — Recreación controlada de PostgreSQL para publicación loopback (paso 7 de la ventana)

> **Conservar el volumen existente.** `docker compose up -d --force-recreate db` NO borra volúmenes (sólo `docker compose down -v` o `docker volume rm` lo harían — prohibidos). **Los scripts de inicialización NO se re-ejecutan sobre un volumen ya existente**: `01…07` no se repiten por recrear; las migraciones ya se aplicaron en §6.

```powershell
# F1. Gate: PG_ADMIN_USER debe apuntar al rol real de ESTE volumen ('tv'), si no el healthcheck
#      nuevo ('pg_isready -U ${PG_ADMIN_USER:-postgres}') quedaría permanently unhealthy (no existe 'postgres').
if ((Select-String -Path .env -Pattern '^PG_ADMIN_USER=tv\s*$' | Measure-Object).Count -ne 1) {
    throw "Falta 'PG_ADMIN_USER=tv' en .env (necesario para el healthcheck tras la recreación)"
}

# F2. HOST_DB_BIND: Compose usa 127.0.0.1 por defecto si la variable no existe; si existe debe ser loopback.
#      Verificación posterior EFECTIVA en F4 (no se declara aplicado por sólo mirar archivos).

# F3. Recrear SOLO el servicio db (sin -v; sin 'down'; conserva tv_gsi_tv_pgdata)
docker compose up -d --force-recreate db
$tries=0; do { Start-Sleep 5; $hs = docker inspect tv-db --format '{{.State.Health.Status}}'; $tries++ } while ($hs -ne 'healthy' -and $tries -lt 36)
if ($hs -ne 'healthy') { throw "tv-db no recuperó 'healthy' tras la recreación → §10.6" }

# F3b. Comprobar que el contenedor es NUEVO de ESTA ventana: una recreación interrumpida
#      deja el contenedor viejo 'healthy' con el binding antiguo (incidente real del
#      2026-10-13: .Created = 2026-10-08, HostIp = ""). 'Healthy' por sí solo NO acredita
#      la recreación. (Cerca de medianoche, comparar también la fecha UTC de .Created.)
$created = docker inspect tv-db --format '{{.Created}}'
if (-not $created.StartsWith((Get-Date).ToString('yyyy-MM-dd'))) {
    throw "tv-db NO fue recreado (.Created=$created no es de hoy) → repetir F3"
}

# F4. Publicación EFECTIVA en loopback (AUD-008) — verificación real, no de configuración
docker port tv-db 5432/tcp
# Esperado: 127.0.0.1:25432   (prohibido: 0.0.0.0:25432 o :::25432)
docker inspect tv-db --format '{{json .HostConfig.PortBindings}}'

# F5. Reconexión del backend (el pool debe reconectar; si no, reiniciar una vez)
Start-Sleep 5
$st = curl.exe -s http://localhost:23002/api/status
Write-Output "STATUS=$st"
if ($st -notmatch 'online') {
    Write-Output "Backend sin respuesta tras recrear la DB; reiniciando una vez…"
    docker compose restart backend
    Start-Sleep 15
    $st = curl.exe -s http://localhost:23002/api/status
    if ($st -notmatch 'online') { throw "Backend no reconectó tras la recreación de db → §10.3" }
}

# F6. Sesión efectiva de nexus_app tras la recreación
docker exec tv-db psql -U $ADMIN -d nexus_tv -tAc "SELECT usename FROM pg_stat_activity WHERE usename='nexus_app'"
```

**Criterio:** `tv-db` healthy **y** `.Created` de hoy (F3b), `docker port` = sólo `127.0.0.1:25432`, API `online`, sesión `nexus_app` presente.

---

## 9. Fase G — Verificación posterior (ejecutar TODA antes de cerrar la ventana)

### 9.1 Servicios y conectividad

```powershell
curl.exe -s http://localhost:23002/api/status                                    # "online"
curl.exe -s -o NUL -w "frontend=%{http_code}`n" http://localhost:28080/
docker exec tv-db pg_isready -U $ADMIN -d nexus_tv                               # acepta conexiones
docker inspect tv-db tv-backend tv-frontend --format '{{.Name}} {{.State.Health.Status}}'   # todos healthy
```

### 9.2 Migraciones y permisos efectivos (re-ejecutar D5 resumido)

```powershell
docker exec tv-db psql -U $ADMIN -d nexus_tv -tAc "SELECT rolname, rolsuper FROM pg_roles WHERE rolname='nexus_app'"   # rolsuper=f
docker exec tv-db psql -U $ADMIN -d nexus_tv -tAc "SELECT to_regclass('nexus_tv.pending_pairings') IS NOT NULL"         # t
docker exec tv-db psql -U $ADMIN -d nexus_tv -tAc "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='nexus_app' AND table_schema='nexus_tv'"   # >= 7
```

### 9.3 Puerto PostgreSQL (AUD-008)

```powershell
docker port tv-db 5432/tcp     # EXCLUSIVAMENTE 127.0.0.1:25432
```

### 9.4 Multimedia: anónimo rechazado, firmas funcionales (AUD-007)

```powershell
# G4a. Anónimo SIN firma → 403 (antes del despliegue era 200 — comprobado en preflight)
curl.exe -s -o NUL -w "anon=%{http_code}`n" http://localhost:28080/media/<archivo-real>
curl.exe -s -o NUL -w "anon-direct=%{http_code}`n" http://localhost:23002/media/<archivo-real>
# Esperado: 403 y 403

# G4b. Firma inválida → 403
curl.exe -s -o NUL -w "bad-sig=%{http_code}`n" "http://localhost:28080/media/<archivo-real>?token=00&exp=9999999999&purpose=tv_playback"
# Esperado: 403

# G4c. Flujo TV con credenciales REALES (responsable: Operaciones + propietario del dispositivo).
#      Estas credenciales NO están disponibles para QA en producción; no se simulan.
#   1) POST /api/tv/login {tv_uuid, device_token}                       → 200 + token
#   2) GET  /api/tv/<uuid>/playback-url/<contentId> (Bearer)            → 200 + url firmada
#   3) GET  <url firmada>                                               → 200 (o 206 con Range)
#   4) HEAD <url firmada>                                               → 200/204 con Content-Length
#   5) GET  <url firmada> con header Range: bytes=0-99                  → 206 (o 416 si aplica)
#   6) Mismo archivo con purpose distinto / tv_uuid distinto            → 403
#   Registrar salidas en la evidencia §12.

# G4d. Preview administrativo con credenciales REALES (responsable: Administrador con RBAC).
#   GET /api/admin/media/preview-url/<contentId> (JWT admin) → 200 → abrir URL → 200
#   Sin credenciales de admin en este entorno → registrar como PENDIENTE si no se ejecuta (no simular).
```

### 9.5 Heartbeat y pairing con el nuevo esquema

```powershell
# G5a. Con credenciales reales del dispositivo (Operaciones): POST /api/tv/heartbeat → 200
# G5b. Pairing extremo a extremo real (Operaciones + panel admin): registrar → bind → ACK → promuved;
#      verificar después: SELECT status, count(*) FROM nexus_tv.pending_pairings GROUP BY 1 → sin 'pending' huérfanos
# G5c. Cobertura automatizada (QA, no sustituye G5a/G5b): regresión §9.7 con tests tv-heartbeat (10)
#      y pairing (28 + 5) — ejecutados aquí, en el host, sin tocar la base activa.
```

### 9.6 Logs sin tokens ni firmas (AUD-006 / AUD-007)

```powershell
# Backend (loguea a stdout del contenedor; NO existe /var/log/backend/)
docker logs tv-backend --since 10m 2>&1 | Select-String -Pattern 'MEDIA_URL_SIGNING_KEY\s*=|token=[A-Za-z0-9]{20,}' | Select-Object -First 10
# Esperado: sin coincidencias (0 líneas). Los mensajes de error permitidos no contienen valores.

# Nginx: access_log con formato seguro dentro del contenedor del frontend
# (si media_access.log aún no existe, ejecutar antes G4a para generarlo con una petición real)
docker exec tv-frontend sh -c "grep 'token=' /var/log/nginx/media_access.log | head -5"      # esperado: sin coincidencias
docker exec tv-frontend sh -c "grep '/media/' /var/log/nginx/media_access.log | tail -5"     # URIs SIN query string
# Con ALLOW_QUERY_DEVICE_TOKEN=false no debe aparecer el warning de fallback; si se activara
# la observación (OBSERVE_QUERY_DEVICE_TOKEN=true) SÓLO en campaña de inventario autorizada,
# el warning censurado (tv_uuid + canal, jamás token ni URI) es el máximo permitido.
```

### 9.7 Regresión aplicable

```powershell
# Suite completa (13 ficheros): esperado 153/153 pass — ver nota N1
node --test tests/device-auth.test.js tests/nginx-safe-logging.test.js tests/signed-media-url.test.js `
  tests/pairing-session.test.js tests/pairing-ack.test.js tests/auth.test.js tests/rbac.test.js `
  tests/playlist-auth.test.js tests/playlist-playback.test.js tests/tv-heartbeat.test.js `
  tests/schedule-window.test.js tests/normalize-days.test.js tests/media-upload.test.js
git diff --check
```

---

## 10. Procedimiento de rollback por etapa

| Etapa | Disparador | Acción | Tiempo |
|---|---|---|---|
| **10.1 Respaldo (Fase B)** | Dump no verificado | Abortar ventana; no se tocó la base; investigar (disco, permisos) | 0 min (sin cambios) |
| **10.2 Migraciones (Fase D)** | 06/07 con error o grants incorrectos | 06 es idempotente → re-ejecutar tras corregir causa. Si hay que volver al punto de partida: `DROP TABLE IF EXISTS nexus_tv.pending_pairings;` (tabla nueva, sin datos previos — preflight la confirmó `MISSING`) y `docker exec tv-db psql -U $ADMIN -d nexus_tv -c "DROP OWNED BY nexus_app; DROP ROLE nexus_app;"`. Cualquier otra duda → restauración completa (10.7) | 5–10 min |
| **10.3 Backend (Fase E)** | `healthy` o conexión fallida | PowerShell (sin `&&`, compatible 5.1): `docker tag tv_gsi-backend:pre-v2.2.0 tv_gsi-backend:latest` y después `docker compose up -d --force-recreate --no-deps backend` — la imagen antigua usa `PG_USER`, que sigue existiendo en la base; restaurar también `backups\docker-compose.yml.pre-deploy` sobre `docker-compose.yml` si se conserva la imagen antigua a largo plazo | 2–3 min |
| **10.4 Frontend (Fase E)** | `healthy` o Nginx fallido | `docker tag tv_gsi-frontend:pre-v2.2.0 tv_gsi-frontend:latest` y después `docker compose up -d --force-recreate --no-deps frontend` (restaura también la config Nginx anterior embebida en la imagen) | 2 min |
| **10.5 Clave (Fase C/E)** | Gate `KEY_OK` fallido | NO cortar; corregir `.env` y re-ejecutar E3–E4. Si la clave se pierde después de activo: el backend deja de emitir/validar firmas (fail-safe) → generar nueva clave con C1 (invalida URLs en vuelo, aceptable) o 10.3 | 5 min |
| **10.6 Recreación DB (Fase F)** | `tv-db` sin `healthy` | `docker logs tv-db --tail 50` (diagnóstico); **el volumen NO se toca**; `docker compose up -d --force-recreate db` repetir; si persiste, revertir healthcheck poniendo `PG_ADMIN_USER=tv` correcto en `.env` | 5–10 min |
| **10.7 Restauración completa (último recurso)** | Corrupción o pérdida de datos | `docker compose stop backend frontend` → `docker cp ".\backups\$BK" tv-db:/tmp/restore.dump` → `docker exec tv-db sh -c "pg_restore -U $ADMIN --clean --if-exists -d nexus_tv /tmp/restore.dump"` (exit ≠ 0 ⇒ DBA interviene) → `docker compose start backend frontend`. NOTA: `--clean` elimina objetos creados DESPUÉS del dump (incl. `pending_pairings`) y no elimina roles (`nexus_app` persiste, inofensivo) | 15–30 min |
| **10.8 Revertir loopback (sólo si se aprueba acceso remoto)** | Necesidad de acceso remoto a la BD | Fijar `HOST_DB_BIND=0.0.0.0` en `.env` + `docker compose up -d --force-recreate db` + restricción obligatoria con firewall del host. Nunca dejar `0.0.0.0` sin firewall | 5 min |

**Punto de no retorno:** tras un `--clean` de 10.7, cualquier dato posterior al dump se pierde. El respaldo de Fase B es la única vía de recuperación verificada.

---

## 11. Criterios de aceptación, responsables y cierre

| Criterio | Verificación (evidencia) | Responsable |
|---|---|---|
| Respaldo verificable | §4: `DUMP_OK`, SHA-256, restauración QA con conteos idénticos | DBA |
| Migración 06 aplicada | `nexus_app` existe, `rolsuper=f`, `>= 7` grants efectivos, login por red OK, DDL denegado 42501 | DBA |
| Migración 07 aplicada | `to_regclass('nexus_tv.pending_pairings')` ≠ NULL | DBA |
| Clave provisionada | Gate E3 `KEY_OK` + E5 `KEY=OK`; nunca impresa | Seguridad |
| Backend desplegado | `healthy`, `PG_APP_USER=nexus_app`, `ALLOW_QUERY_DEVICE_TOKEN=false`, imagen con mitigaciones | Desarrollo + Operaciones |
| Frontend/Nginx desplegado | `healthy`, `nginx -t`, `nexus_safe_query` presente | Operaciones |
| Puerto BD loopback | `docker port tv-db 5432/tcp` = `127.0.0.1:25432` (evidencia real, no configuración) | Operaciones |
| Anónimo en `/media/` | 403 en `:28080` y `:23002` | QA |
| Reproducción TV + `GET/HEAD/Range` | §9.4 G4c con credenciales reales | Operaciones + propietario dispositivo |
| Preview admin | §9.4 G4d con credenciales reales | Administrador RBAC |
| Heartbeat + pairing reales | §9.5 G5a/G5b | Operaciones |
| Logs sin tokens ni firmas | §9.6 con salida 0 | Seguridad |
| Regresión | §9.7: 153/153 + `git diff --check` = 0 | QA |
| Rollback revisado | §10 completo y entendido antes de empezar | DBA + Operaciones |

- [ ] DBA: ______________________  fecha ______
- [ ] Operaciones: ______________  fecha ______
- [ ] Seguridad: _________________  fecha ______
- [ ] QA: _______________________  fecha ______
- [ ] Producto (cierre de ventana): ____________  fecha ______

**Nota N1 (regresión en el host):** el host ejecuta Node 20.18.0, fuera de `engines >=24 <25`. En 7 ejecuciones multiarchivo de la suite se observaron 2 fallos del **transporte IPC del test runner** (`Unable to deserialize cloned data … node:internal/test_runner/runner`, en `pairing-ack.test.js`) con **cero fallos de aserción**; en aislamiento, `pairing-ack` fue 5/5 limpio (28/28) y en 5 de 7 corridas la suite completa fue 153/153. El runtime de proyecto/CI es Node 24 (`.github/workflows/ci.yml`), donde `npm test` ejecuta la misma suite. Si este artefacto aparece en CI, re-ejecutar la corrida y registrarla: es un artefacto conocido del runner, no un defecto del producto — pero **debe registrarse, nunca ocultarse con `|| true`**.

**Nota N2 (retirada de la pila de pruebas de la MISIÓN 5B — pendiente de aprobación):** `nginx-integration-test`, `backend-integration-test`, `db-integration-test` (publicados en 0.0.0.0:18080/13002/15432), red `tv_gsi_test-network` e imagen `tv_gsi-backend-test` pueden retirarse con:

```powershell
docker rm -f nginx-integration-test backend-integration-test db-integration-test
docker network rm tv_gsi_test-network
docker image rm tv_gsi-backend-test
```

No afecta a `tv-db`/`tv-backend`/`tv-frontend` ni a ningún volumen. **Ejecutar sólo con aprobación.**

---

## 12. Evidencias a incorporar en `docs/13-testing/results/` tras la ejecución

- `DEPLOY-LOG-2026-10-13.md` — bitácora: hora de inicio/fin por fase, operador, SHA-256 del respaldo, salidas de gates (`KEY_OK`, `docker port`, healthchecks), incidencias y si hubo rollback.
- `POST-DEPLOY-VERIFICATION-2026-10-13.md` — salidas de §9 completas (incluidas G4c/G4d/G5 con credenciales reales, o la declaración de pendiente si no se ejecutaron).
- Actualización de `FINAL-ACCEPTANCE-REPORT-2026-10-13.md` y `AUDIT-FULL-2026-10-09.md`: cambiar estado SÓLO con la evidencia de esta ventana (AUD-007 a "desplegado y verificado", AUD-008 a "aplicado y verificado", etc.). **No declarar verificación de campo de AUD-006 sin observación real (runbook DEV-RUN-004).**

---

## 13. Referencias

- [AUDIT-FULL-2026-10-09.md](../../13-testing/results/AUDIT-FULL-2026-10-09.md) — matriz maestra de hallazgos
- [FINAL-ACCEPTANCE-REPORT-2026-10-13.md](../../13-testing/results/FINAL-ACCEPTANCE-REPORT-2026-10-13.md) — aceptación técnica
- [ADR-006](../01-architecture/decisions/ADR-006-media-access-policy.md) — política multimedia (Opción B)
- [DEV-RUN-004](./DEV-RUN-004-aud006-query-token-retirement.md) — retirada AUD-006 / observación de campo
- `migrations/06_runtime_user.sql`, `migrations/07_pending_pairings.sql`
- `tests/qa-guard.js` — guardas del entorno QA autorizado (127.0.0.1:25499 + marcador)

---

## 14. Prohibiciones durante toda la ventana

- **Nunca** `docker compose down`, `down -v`, `docker volume rm` ni reinicializar PostgreSQL; los scripts de init **no** se re-ejecutan sobre un volumen existente.
- **Nunca** imprimir `.env`, claves, tokens o credenciales; **nunca** versionar `.env` o dumps (`*.dump` ya está en `.gitignore`).
- **Nunca** `|| true`, `2>$null` sobre comandos críticos ni cualquier mecanismo que oculte fallos; los gates usan `throw` con `$LASTEXITCODE`.
- **Nunca** apuntar pruebas al puerto `25432` (producción) ni al `25499` marcado para restauraciones.
- **Nunca** activar `ALLOW_QUERY_DEVICE_TOKEN=true` (se mantiene `false`); la observación AUD-006 es una campaña separada con su propio runbook.
- **Nunca** declarar aplicado un cambio sólo porque un archivo de configuración lo diga: verificar siempre con estado efectivo (`docker port`, `docker inspect`, `printenv`, salidas HTTP reales).
- **Nunca** cerrar la ventana sin las firmas de §11 ni marcar AUD-006/AUD-007/AUD-008 como verificados sin su evidencia correspondiente.

---

## 15. Apéndice — Lecciones aprendidas en la ejecución real (añadido tras la ventana del 2026-10-13)

1. **`healthy` no acredita recreación.** La primera ejecución de F3 quedó interrumpida y el contenedor viejo seguía `healthy` con `HostIp=""` (`0.0.0.0`). Sólo `docker inspect .Created` + `docker port` lo detectaron → incorporado como paso **F3b** (§8). Regla general: verificar el estado efectivo, no la apariencia.
2. **PowerShell 5.1 en el host:**
   - `curl` es alias de Invoke-WebRequest → usar **`curl.exe`** siempre.
   - No existe `&&` → encadenar con `;` y `if ($LASTEXITCODE -ne 0) { throw … }`.
   - Las comillas incrustadas en argumentos de procesos nativos **se eliminan** (JSON de sondas llegó sin comillas → 400 + `SyntaxError` en logs de la app, no un defecto de la app) → enviar payloads vía fichero (`-d "@archivo"`), o vía base64/variable de entorno para código JS.
   - `RandomNumberGenerator.GetBytes` estático no existe → usar `RNGCryptoServiceProvider`.
   - `docker ps --format` no admite `.State.Health.Status` → usar `docker inspect --format`.
3. **D7:** `PGAPPASSWORD` debe mapearse explícitamente desde la variable de sesión `PG_APP_PASSWORD` antes de `docker run -e PGPASSWORD=…` (corregido en caliente en v1.1).
4. **Shell de sesión intermitente:** si la shell devuelve salida vacía para comandos triviales, detener la ejecución activa, trabajar con verificación documentada y **re-probar en crudo** al recuperarse; tratar cualquier resultado sintetizado/duplicado como NO verificado hasta reprocesarlo.
5. **Runner de pruebas (Nota N1):** el runner `node --test` del host (Node 20.18.0) produjo fallos de transporte IPC con 0 fallos de aserción; para cifras exactas por suite, ejecutar las 13 suites por separado.
6. **Sondas de login:** una sonda con JSON malformado devuelve 400, no 401 — no confundir artefacto de la sonda con defecto de la aplicación; repetir con payload válido antes de concluir.
