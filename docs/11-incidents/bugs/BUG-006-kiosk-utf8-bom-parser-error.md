# BUG-006: Fallo Fatal de Sintaxis en `start-tv-kiosk.ps1` por Carácter Unicode EM DASH sin BOM en PowerShell 5.1

- **Módulo Afectado:** Kiosk Launcher / Scripts Operativos Windows (`start-tv-kiosk.ps1`)
- **Severidad:** Crítica
- **Prioridad:** P0 (Bloqueante de Operación Kiosk)
- **Fecha de Detección:** 2026-10-09
- **Fecha de Resolución:** 2026-10-09
- **Estado:** 🟢 Resuelto / Verificado (PASS)
- **Reportado por:** Senior QA Engineer & Technical Auditor
- **Resuelto por:** Senior Software Engineer
- **Normativa Relacionada:** ISO/IEC 25010:2023 (Operabilidad y Confiabilidad), ISO/IEC 90003:2018 (Control de Scripts)

---

### 1. Descripción
Al intentar ejecutar el script `start-tv-kiosk.ps1` en un entorno estándar de Windows con PowerShell 5.1, el script aborta inmediatamente durante la etapa de compilación léxica/sintáctica arrojando `ParserError: AmpersandNotAllowed`. El navegador (Chrome o Edge) nunca llega a iniciarse, impidiendo la apertura de pantallas en modo Kiosk y bloqueando la simulación y pruebas de televisores en la red.

---

### 2. Pasos para Reproducir
1. Abrir una consola PowerShell 5.1 estándar en Windows.
2. Posicionarse en la raíz del proyecto `tv_gsi`.
3. Ejecutar el script permitiendo ejecución:
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File .\start-tv-kiosk.ps1
   ```
4. Observar la salida en terminal.

---

### 3. Evidencia Técnica
- **Comando Ejecutado:** `powershell.exe -ExecutionPolicy Bypass -File .\start-tv-kiosk.ps1`
- **Código de Salida:** `1`
- **Mensaje Literal del Error Capturado:**
  ```text
  En C:\Users\DEVELOPMENT\Downloads\tv_gsi\start-tv-kiosk.ps1: 17 Carácter: 44
  + Write-Host "    NEXUS TV —" KIOSK DISPLAY & AUDIO AUTO-UNLOCK     "  ...
  +                                            ~
  No se permite usar el carácter de Y comercial (&). El operador & está reservado para un uso futuro; encierre un
  símbolo de Y comercial entre comillas dobles ("&") para pasarlo como parte de una cadena.
  En C:\Users\DEVELOPMENT\Downloads\tv_gsi\start-tv-kiosk.ps1: 22 Carácter: 33
  +         $TargetUrl = "$TargetUrl&uuid=$TvUuid"
  +                                 ~
  No se permite usar el carácter de Y comercial (&). El operador & está reservado para un uso futuro; encierre un
  símbolo de Y comercial entre comillas dobles ("&") para pasarlo como parte de una cadena.
  En C:\Users\DEVELOPMENT\Downloads\tv_gsi\start-tv-kiosk.ps1: 73 Carácter: 14
  + Write-Host "[OK] Nexus TV Kiosk iniciado exitosamente." -ForegroundCo ...
  +              ~
  Falta una expresión de índice de matriz o no es válida.
  En C:\Users\DEVELOPMENT\Downloads\tv_gsi\start-tv-kiosk.ps1: 73 Carácter: 55
  + ... t "[OK] Nexus TV Kiosk iniciado exitosamente." -ForegroundColor Green
  +                                                  ~~~~~~~~~~~~~~~~~~~~~~~~
  Falta la cadena en el terminador: ".
      + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException
      + FullyQualifiedErrorId : AmpersandNotAllowed
  ```
- **Caso de Prueba Documentado:** [docs/13-testing/results/TC-KIOSK-001.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-KIOSK-001.md).

---

### 4. Causa Raíz Identificada
El archivo `start-tv-kiosk.ps1` está guardado en codificación UTF-8 sin BOM (Byte Order Mark). En la línea 17 contiene el carácter **EM DASH** (`—`, Unicode U+2014, bytes `0xE2 0x80 0x94`).
En Windows PowerShell 5.1, los archivos sin BOM son interpretados por defecto bajo la página de códigos ANSI del sistema (Windows-1252).
En Windows-1252, el byte `0x94` corresponde al carácter tipográfico `”` (Right Double Quotation Mark, Unicode U+201D). Dado que el analizador de PowerShell considera `”` como un delimitador de comillas dobles de cadena de texto, la cadena iniciada en `Write-Host "` se cierra de forma anticipada. El texto restante `KIOSK DISPLAY & AUDIO AUTO-UNLOCK` es procesado como código fuente fuera de comillas, y al encontrar el carácter `&`, PowerShell aborta con la excepción fatal `AmpersandNotAllowed`.

---

### 5. Impacto en el Negocio / Sistema
- **100% de Fallo Operativo:** Ningún técnico ni operador puede abrir pantallas en modo Kiosk utilizando este script en Windows.
- **Opción 7 de `run-local.ps1` Inoperativa:** La opción interactiva que llama a este script falla con el mismo error.
- **Bloqueo de Pruebas de TV:** Imposibilidad de validar la política `--autoplay-policy=no-user-gesture-required`.

---

### 6. Solución Propuesta (Para Fase de Corrección)
1. Sustituir el carácter `—` por un guión estándar ASCII `-` en líneas 2 y 17 de `start-tv-kiosk.ps1`.
2. Guardar el archivo en formato UTF-8 con BOM o ASCII puro.
3. Proporcionar un archivo por lotes `start-tv-kiosk.bat` para ejecución desatendida sin requerir manipulación de `ExecutionPolicy`.

---

### 7. Criterio de Verificación (QA Retest)
- Ejecutar `powershell.exe -ExecutionPolicy Bypass -File .\start-tv-kiosk.ps1` en PowerShell 5.1.
- Verificar código de salida 0 y que el proceso de Chrome/Edge sea lanzado con los argumentos correctos.

---

### 8. Solución Implementada y Evidencia del Retest
- **Archivos Modificados:**
  - `start-tv-kiosk.ps1`: Sustitución completa de todos los caracteres Unicode no ASCII (`—`) por guiones ASCII (`-`), eliminación de ambigüedad de codificación ANSI vs UTF-8. Implementación de array estructurado para argumentos y verificación de proceso `-PassThru`.
  - `start-tv-kiosk.cmd`: Creación de envoltorio por lotes que ejecuta PowerShell con `-ExecutionPolicy Bypass -NoProfile` sin modificar la política global del sistema.
- **Pruebas de Retest Ejecutadas:**
  - **AST Parser:** `[System.Management.Automation.Language.Parser]::ParseFile(...)` ejecutado en PowerShell 5.1 arrojando **0 errores de análisis**.
  - **Lanzamiento Real:** Invocación de `start-tv-kiosk.cmd` iniciada con éxito en Google Chrome (PID 2628) en modo Kiosk y pantalla completa.
- **Resultado del Retest:** 🟢 **PASS**
- **Documento de Evidencia:** [TC-RETEST-KIOSK-001.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-RETEST-KIOSK-001.md)
- **Deuda Técnica Pendiente:** Ninguna. Script 100% compatible con Windows PowerShell 5.1 y pwsh 7+.
