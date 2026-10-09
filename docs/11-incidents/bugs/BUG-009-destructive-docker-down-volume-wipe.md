# BUG-009: Operación Destructiva de Volúmenes de Base de Datos en `run-local.ps1` (Opción 6)

- **Módulo Afectado:** DevOps & Scripts de Operación (`run-local.ps1`)
- **Severidad:** Crítica
- **Prioridad:** P1
- **Fecha de Detección:** 2026-10-09
- **Fecha de Mitigación:** 2026-10-09
- **Estado:** 🟣 Mitigado / Pendiente de Retest de Ciclo Completo
- **Reportado por:** Senior QA Engineer & Technical Auditor
- **Mitigado por:** Senior Software Engineer
- **Normativa Relacionada:** ISO 9001:2015 (Control de Procesos Operativos), ISO/IEC 27001:2022 (Control A.12.3 Copias de Seguridad y Preservación de Datos)

---

### 1. Descripción
En el script interactivo de gestión de despliegue local `run-local.ps1`, la **Opción 6** ("Detener y Limpiar Entorno Local (Down)") ejecuta incondicionalmente el comando `docker compose -f $ComposeFile down -v --remove-orphans`.

El modificador `-v` (`--volumes`) instruye al motor de Docker a eliminar de manera irreversible todos los volúmenes nombrados declarados en el compose (`tv_pgdata`). En consecuencia, cuando un operador selecciona la opción de detener el entorno local al finalizar su jornada de trabajo, toda la base de datos de PostgreSQL (pantallas registradas, usuarios, relaciones de playlists, métricas y configuración de red) es eliminada permanentemente sin confirmación ni advertencia previa.

---

### 2. Pasos para Reproducir
1. Ejecutar `run-local.ps1`.
2. Registrar pantallas y configurar contenidos en el sistema.
3. Volver a ejecutar `run-local.ps1` y seleccionar la opción `6` ("Detener y Limpiar Entorno Local").
4. Volver a levantar el entorno con la opción `1`.
5. Consultar las tablas de la base de datos: todas las pantallas creadas por el usuario han desaparecido y la BD vuelve al estado inicial de migración.

---

### 3. Evidencia Técnica
- **Líneas 138–140 en `run-local.ps1`:**
  ```powershell
  elseif ($Option -eq "6") {
      Write-Host ""
      Write-Host "[+] Deteniendo y limpiando contenedores locales de Nexus TV (tv-db, tv-backend, tv-frontend)..." -ForegroundColor $Yellow
      docker compose -f $ComposeFile down -v --remove-orphans
      Write-Host "[OK] Entorno local detenido y limpiado exitosamente (otros contenedores en Docker se mantienen intactos)." -ForegroundColor $Green
  }
  ```
  La presencia del flag `-v` destruye el volumen persistente `tv_pgdata`.

---

### 4. Causa Raíz Identificada
Uso inadecuado del modificador destructivo `-v` en un comando de apagado estándar de entorno operativo sin confirmación interactiva ni distinción entre "Detener contenedores" (stop/down regular) y "Reiniciar datos a cero" (purge/reset).

---

### 5. Impacto en el Negocio / Sistema
- Pérdida catastrófica de información de pantallas y configuraciones corporativas.
- Riesgo de que un operador ejecute la opción 6 creyendo que solo detiene los procesos para ahorrar recursos de RAM/CPU en el host.

---

### 6. Solución Propuesta (Para Fase de Corrección)
1. Modificar la Opción 6 para ejecutar únicamente `docker compose down --remove-orphans` (sin la bandera `-v`).
2. Si se desea proveer una opción de restablecimiento de fábrica (Factory Reset), crear una opción separada (ej. Opción 8: "Limpieza Total de Datos") con solicitud explícita de confirmación: `¿Está seguro de destruir todos los datos? Escriba 'SI' para confirmar`.

---

### 7. Solución Implementada y Estado de Verificación
- **Archivos Modificados:**
  - `run-local.ps1` (Línea 149): Se eliminó la bandera destructiva `-v`, reemplazándola por `docker compose -f $ComposeFile down --remove-orphans`. El volumen `tv_pgdata` ya no se marca para purga en el ciclo de parada normal.
- **Evidencia Estática:** Verificada en código fuente de `run-local.ps1`.
- **Razón de Estado Pendiente de Retest:** Conforme a las reglas obligatorias de QA ("No ejecutes pruebas destructivas ni docker compose down -v sobre el entorno activo"), no se ejecutó un apagado real sobre los contenedores en ejecución para no alterar la disponibilidad operativa de la base de datos actual.
- **Deuda Técnica Pendiente:** Ejecutar un retest en máquina de pruebas aislada ejecutando Opción 6 seguida de Opción 1 y verificando `SELECT count(*) FROM nexus_tv.tv_screens` antes y después.
