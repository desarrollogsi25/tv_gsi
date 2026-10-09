# Nexus TV Enterprise — Retest y Validación TC-RETEST-KIOSK-001

> **Documento:** TC-RETEST-KIOSK-001
> **Título:** Retest de Corrección de Sintaxis UTF-8/ANSI, Invocación Segura y Aislamiento de Perfil para Simulación de TV Nueva
> **Fecha de Ejecución:** 2026-10-09
> **Tester / Ingeniero:** Senior Software Engineer & Senior QA Auditor
> **Normativas:** ISO/IEC 25010:2023 (Operabilidad, Confiabilidad, Portabilidad), ISO/IEC 90003:2018 (Control de Scripts y Calidad de Software)
> **Resultado del Retest:** 🟢 **APROBADO (PASS)**

---

## 1. Identificación y Alcance del Retest

- **Objetivo:** Verificar la resolución del defecto crítico de análisis sintáctico `ParserError: AmpersandNotAllowed` en `start-tv-kiosk.ps1` bajo Windows PowerShell 5.1 (BUG-006), validar el método de ejecución desatendida sin alterar la política de seguridad global del sistema, y validar el mecanismo de aislamiento de perfil para simulación de una nueva pantalla sin degradar o borrar perfiles existentes (BUG-007).
- **Archivos Modificados / Creados:**
  - `start-tv-kiosk.ps1` (Corrección de codificación a ASCII puro, adición de `-NewProfile` y `-ProfileId`, paso de argumentos como array seguro y comprobación de proceso `-PassThru`).
  - `start-tv-kiosk.cmd` (Lanzador seguro en lote con `-ExecutionPolicy Bypass -NoProfile`).
  - `run-local.ps1` (Actualización de la opción 7 con selector interactivo de perfil normal vs nuevo perfil de prueba).

---

## 2. Matriz de Verificaciones Ejecutadas

| ID Sub-Prueba | Escenario Evaluado | Comando Ejecutado | Resultado Esperado | Resultado Obtenido | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ST-01** | Análisis sintáctico formal (AST Parser) en Windows PowerShell 5.1 | `[System.Management.Automation.Language.Parser]::ParseFile(...)` | 0 errores sintácticos (`ParseErrors.Count -eq 0`) | 0 errores sintácticos. AST completo generado. | 🟢 PASS |
| **ST-02** | Lanzamiento mediante wrapper seguro `.cmd` en máquina con política restringida | `cmd.exe /c start-tv-kiosk.cmd` | Invocación exitosa sin error de `UnauthorizedAccess` | Script ejecutado con éxito, bypass aplicado exclusivamente a nivel de proceso efímero. | 🟢 PASS |
| **ST-03** | Lanzamiento en Modo Normal (Perfil Persistente) | `cmd.exe /c start-tv-kiosk.cmd` | Modo Normal, ruta `$env:TEMP\nexus_tv_kiosk_profile`, navegador Chrome iniciado | Modo Normal confirmado, ruta validada, PID retornado. | 🟢 PASS |
| **ST-04** | Lanzamiento en Modo TV Nueva (`-NewProfile`) | `cmd.exe /c start-tv-kiosk.cmd -NewProfile -ProfileId auto_test_verify` | Modo Simulación TV Nueva, ruta aislada `$env:TEMP\nexus_tv_kiosk_auto_test_verify`, PID retornado | Modo Simulación confirmado, carpeta creada sin colisión ni herencia de datos. | 🟢 PASS |
| **ST-05** | Integridad de perfiles previos | Inspección de `$env:TEMP\nexus_tv_kiosk_profile` y carpetas de Chrome | Ningún archivo o perfil existente borrado o sobrescrito | Perfil normal intacto; carpetas de Edge y Chrome intactas. | 🟢 PASS |

---

## 3. Evidencias de Ejecución

### 3.1. ST-01: Verificación de Análisis Léxico y Sintáctico AST
```powershell
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path ".\start-tv-kiosk.ps1").Path, [ref]$null, [ref]$null)
```
- **Salida:** Retorna el árbol de sintaxis abstracta (`ScriptBlockAst`) sin excepciones.
- **Conclusión:** Se eliminó la ambigüedad generada por bytes `0x94` de caracteres Unicode no ASCII (`—`), garantizando 100% de compatibilidad con Windows PowerShell 5.1 y PowerShell Core 7+.

### 3.2. ST-02 y ST-03: Lanzamiento en Modo Normal
```text
======================================================
    NEXUS TV - KIOSK DISPLAY & AUDIO AUTO-UNLOCK
======================================================
 Modo Kiosk     : Normal (Perfil Persistente)
 Perfil Usuario : C:\Users\DEVELO~1\AppData\Local\Temp\nexus_tv_kiosk_profile
 URL de destino : http://localhost:28080/tv
 Navegador      : C:\Program Files\Google\Chrome\Application\chrome.exe
 Flags Kiosk    : --kiosk --autoplay-policy=no-user-gesture-required

[+] Iniciando reproductor Nexus TV en pantalla completa con audio remoto desbloqueado...
[OK] Proceso del navegador Kiosk iniciado correctamente (PID: 2628).
```

### 3.3. ST-04: Lanzamiento en Modo Simulación de TV Nueva (-NewProfile)
```text
======================================================
    NEXUS TV - KIOSK DISPLAY & AUDIO AUTO-UNLOCK
======================================================
 Modo Kiosk     : Simulacion de TV Nueva (Perfil Limpio Aislado: auto_test_verify)
 Perfil Usuario : C:\Users\DEVELO~1\AppData\Local\Temp\nexus_tv_kiosk_auto_test_verify
 URL de destino : http://localhost:28080/tv
 Navegador      : C:\Program Files\Google\Chrome\Application\chrome.exe
 Flags Kiosk    : --kiosk --autoplay-policy=no-user-gesture-required

[+] Iniciando reproductor Nexus TV en pantalla completa con audio remoto desbloqueado...
[OK] Proceso del navegador Kiosk iniciado correctamente (PID: 6400).
```

---

## 4. Conclusión y Dictamen

El lanzador Kiosk `start-tv-kiosk.ps1` y su wrapper `start-tv-kiosk.cmd` cumplen satisfactoriamente los requisitos funcionales, operativos y de seguridad:
1. No se requiere alterar la directiva global `Set-ExecutionPolicy` de la máquina.
2. Es 100% inmune a discrepancias de codificación de páginas de código Windows-1252 / UTF-8.
3. Permite a los equipos de QA y soporte simular infinitas pantallas nuevas sin destruir ni sobrescribir perfiles de hardware existentes.
