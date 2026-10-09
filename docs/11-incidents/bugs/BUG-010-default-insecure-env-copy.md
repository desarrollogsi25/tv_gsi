# BUG-010: Copia Ciega de `.env.example` con Secretos por Defecto en `run-local.ps1`

- **Módulo Afectado:** DevOps & Security Configuration (`run-local.ps1` & `.env.example`)
- **Severidad:** Alta
- **Prioridad:** P1
- **Fecha de Detección:** 2026-10-09
- **Estado:** 🟣 Mitigado (Script CSPRNG activo; pendiente validación y bloqueo ante .env preexistente con valores por defecto)
- **Reportado por:** Senior QA Engineer & Technical Auditor
- **Resuelto por:** Senior Software Engineer
- **Normativa Relacionada:** ISO/IEC 27001:2022 (Control A.10 Criptografía, Control A.13 Seguridad de las Comunicaciones)

---

### 1. Descripción
En el script `run-local.ps1`, la **Opción 1** verifica si existe el archivo `.env`. Si no existe, copia automáticamente `.env.example` a `.env` e inicia inmediatamente los contenedores con `docker compose up --build -d` sin requerir al usuario que configure valores reales para las contraseñas ni el secreto criptográfico `JWT_SECRET`.

Dado que `.env.example` contiene valores de marcador de posición estáticos (`JWT_SECRET=replace_with_a_random_secret_of_at_least_32_bytes` y `PG_PASSWORD=replace_with_a_unique_database_password`), los contenedores arrancan en producción o entorno local utilizando cadenas predecibles y de conocimiento público, comprometiendo de inmediato la integridad de los tokens JWT y el acceso a la base de datos PostgreSQL.

---

### 2. Pasos para Reproducir
1. Eliminar o renombrar `.env` en un entorno de pruebas.
2. Ejecutar `run-local.ps1` y seleccionar la opción `1`.
3. Observar que el script copia `.env.example` y arranca los contenedores inmediatamente sin detenerse ni advertir sobre los secretos por defecto.
4. Firmar o decodificar un token JWT usando la cadena literal de ejemplo: el token es aceptado como válido por el backend.

---

### 3. Evidencia Técnica
- **Líneas 61–64 en `run-local.ps1`:**
  ```powershell
  if (-not (Test-Path "$ProjectRoot\.env") -and (Test-Path "$ProjectRoot\.env.example")) {
      Write-Host "[i] Inicializando archivo .env desde .env.example..." -ForegroundColor $Yellow
      Copy-Item "$ProjectRoot\.env.example" "$ProjectRoot\.env"
  }
  ```
- **Contenido en `.env.example` (Línea 14 y 20):**
  - Contraseña de BD y secreto JWT definidos como cadenas de plantilla conocidas.

---

### 4. Causa Raíz Identificada
Falta de validación interactiva o generación automática de secretos aleatorios criptográficamente seguros (`[System.Security.Cryptography.RandomNumberGenerator]`) antes de iniciar los contenedores.

---

### 5. Impacto en el Negocio / Sistema
- Despliegue de instancias operativas con secretos conocidos.
- Exposición a falsificación de tokens administrativos JWT por parte de atacantes internos en la red corporativa.

---

### 6. Solución Propuesta (Para Fase de Corrección)
1. En `run-local.ps1`, si `.env` no existe:
   - Generar dinámicamente un `JWT_SECRET` aleatorio de 64 caracteres hexadecimales y una contraseña aleatoria de base de datos antes de escribir el archivo `.env`, O
   - Pausar la ejecución con un mensaje de alerta obligatorio: `[!] Archivo .env generado. Por favor edite las credenciales en .env antes de iniciar los contenedores` y salir con código 0.

---

### 7. Solución Implementada en Código
- **Archivos Modificados:**
  - `run-local.ps1` (Líneas 60-74): Se implementó la generación automática de secretos criptográficos mediante `[System.Security.Cryptography.RandomNumberGenerator]::Create()` (CSPRNG), generando 32 bytes (64 hex) para `JWT_SECRET` y 16 bytes (32 hex) para `PG_PASSWORD`. Los valores generados se inyectan en `.env` sin imprimirse en la consola ni exponerse en logs.

---

### 8. Verificación Técnica y Resultados de Prueba Aislada (Misión QA 2026-10-09)

Se ejecutó una prueba de ejecución en entorno temporal aislado (`$env:TEMP`) extrayendo la lógica exacta de inicialización de secretos de `run-local.ps1`, con Docker simulado, sin tocar el `.env` del proyecto ni exponer secretos:

* **Prueba 1 — Generación segura ante `.env` inexistente:**
  - `Test1_GeneratedWithoutPlaceholders`: **PASS (`True`)** — Se generó un `.env` completo donde las cadenas de plantilla fueron sustituidas al 100% por claves hexadecimales CSPRNG.
  - `Test1_LogsLeakNoSecrets`: **PASS (`True`)** — La consola y logs solo emitieron mensajes descriptivos (`"Generando archivo .env local..."`) sin imprimir los valores de los secretos generados.
* **Prueba 2 — Conservación de `.env` preexistente con valores personalizados:**
  - `Test2_PreservedCustomEnv`: **PASS (`True`)** — El script detectó el `.env` preexistente (`"Archivo .env preexistente detectado. Se mantiene."`) y no sobrescribió las credenciales personalizadas.
* **Prueba 3 — Comportamiento ante `.env` preexistente con valores de plantilla conocidos (BRECHA IDENTIFICADA):**
  - `Test3_RetainsInsecurePlaceholdersIfPreexisting`: **OBSERVADO (`True`)** — Si el entorno ya cuenta con un archivo `.env` que contiene `replace_with_a_random_secret_of_at_least_32_bytes` o contraseñas por defecto (ej. por una copia manual previa de `.env.example`), el script omite la generación y no valida su contenido. En consecuencia, **el sistema arranca con secretos de plantilla inseguros**.

#### Dictamen Normativo y Estado Final
- **Diferenciación:**
  * *Corrección implementada:* Generador CSPRNG funcional en `run-local.ps1` para primeras instalaciones.
  * *Verificación dinámica:* Comportamiento aislado verificado sin levantar servicios reales.
  * *Riesgo residual / Brecha:* Falta validación preventiva en `run-local.ps1` para rechazar o regenerar secretos si el `.env` existente aún contiene cadenas de plantilla conocidas.
- **Estado Final:** 🟣 **MITIGADO (Script CSPRNG activo; pendiente validación ante .env preexistente con plantillas)**
- **Deuda Técnica Pendiente:**
  1. Agregar validación en `run-local.ps1` que verifique si el `.env` preexistente contiene cadenas de plantilla conocidas y aborte el arranque con advertencia de seguridad.
  2. Extender esta protección a entornos Linux/macOS donde se utilice un script bash equivalente (ej. `run-local.sh`).
