# BUG-007: Imposibilidad de Simular Televisor Nuevo por Reutilización Incondicional de Perfil Chromium en `start-tv-kiosk.ps1`

- **Módulo Afectado:** Kiosk Launcher & Device Identity (`start-tv-kiosk.ps1` & `frontend/src/components/TVPlayer.jsx`)
- **Severidad:** Alta
- **Prioridad:** P1
- **Fecha de Detección:** 2026-10-09
- **Fecha de Resolución:** 2026-10-09
- **Estado:** 🟢 Resuelto / Verificado (PASS)
- **Reportado por:** Senior QA Engineer & Technical Auditor
- **Resuelto por:** Senior Software Engineer
- **Normativa Relacionada:** ISO/IEC 25010:2023 (Operabilidad, Facilidad de Prueba)

---

### 1. Descripción
Cuando un usuario ejecuta `start-tv-kiosk.ps1` sin el parámetro `-TvUuid` con la intención de simular la conexión de una nueva televisión para probar el flujo de auto-detección y emparejamiento por PIN en `/admin/register`, el script reutiliza forzosamente la ruta de perfil persistente `$UserDataDir = "$env:TEMP\nexus_tv_kiosk_profile"`.

Si en una ejecución anterior ese perfil completó un emparejamiento o guardó un `tv_uuid` en `localStorage`, Chromium retiene dicho almacenamiento en disco. Al iniciar, `TVPlayer.jsx` lee `localStorage.getItem('tv_uuid')`, omite el estado de espera con PIN `#xxxx` y carga de inmediato la pantalla vinculada anteriormente. En consecuencia, el operador no puede simular una TV nueva sin borrar a mano archivos del sistema operativo.

---

### 2. Pasos para Reproducir
1. Abrir una sesión de TV con un perfil persistente y vincularla a cualquier pantalla (ej. `PT101`), almacenando `tv_uuid` en `localStorage`.
2. Cerrar el navegador.
3. Volver a ejecutar `start-tv-kiosk.ps1` sin parámetros para simular una segunda pantalla nueva.
4. Inspeccionar la ventana del navegador.
5. **Observación:** El navegador no muestra "Pantalla Detectada en la Red" ni genera un PIN `#xxxx`; reproduce directamente la pantalla vinculada con anterioridad.

---

### 3. Evidencia Técnica
- **Código en `start-tv-kiosk.ps1` (Línea 59 y 68):**
  ```powershell
  $UserDataDir = "$env:TEMP\nexus_tv_kiosk_profile"
  ...
  "--user-data-dir=`"$UserDataDir`"",
  ```
  La ruta es estática y persistente para todas las ejecuciones.
- **Código en `frontend/src/components/TVPlayer.jsx` (Líneas 12, 274–276):**
  ```javascript
  const [tvUuid, setTvUuid] = useState(localStorage.getItem('tv_uuid') || '');
  ...
  const activeUuid = queryUuid || tvUuid;
  if (!activeUuid) return; // Solo entra en espera si activeUuid es vacío
  ```
- **Caso de Prueba Documentado:** [docs/13-testing/results/TC-KIOSK-001.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-KIOSK-001.md).

---

### 4. Causa Raíz Identificada
Falta de soporte en `start-tv-kiosk.ps1` para sesiones aisladas, perfiles efímeros o banderas de limpieza de almacenamiento al momento de requerir una simulación limpia de hardware nuevo.

---

### 5. Impacto en el Negocio / Sistema
- Imposibilidad de realizar pruebas automáticas o manuales del flujo de onboarding y aprovisionamiento Zero-Touch.
- Falsos positivos en pruebas de Kiosk donde se cree estar probando una pantalla nueva cuando en realidad se está reutilizando una pantalla antigua.

---

### 6. Solución Propuesta (Para Fase de Corrección)
1. Agregar un switch `-NewProfile` o `-CleanSession` a `start-tv-kiosk.ps1`.
2. Si no se especifica `-TvUuid` ni se indica persistencia, generar una carpeta de perfil efímera con sufijo aleatorio:
   ```powershell
   $UserDataDir = Join-Path $env:TEMP ("nexus_tv_kiosk_" + [System.Guid]::NewGuid().ToString().Substring(0,8))
   ```
3. Opcionalmente, agregar soporte para flags `--incognito` o `--inprivate` si no se requiere persistencia de audio.

---

### 7. Solución Implementada y Evidencia del Retest
- **Archivos Modificados:**
  - `start-tv-kiosk.ps1`: Se incorporaron los parámetros `[switch]$NewProfile` y `[string]$ProfileId`. Cuando se activa, se asigna una ruta aislada `$env:TEMP\nexus_tv_kiosk_<ProfileId>` asegurando que no se herede el archivo `localStorage` del perfil base ni se sobrescriba la sesión normal. Se agregaron los flags `--no-first-run` y `--no-default-browser-check` para omitir asistentes de primer uso en carpetas nuevas.
  - `run-local.ps1`: Se actualizó la opción 7 para ofrecer un menú interactivo que permite elegir entre Modo Normal (1) o Modo Simulación TV Nueva (2).
- **Pruebas de Retest Ejecutadas:**
  - Ejecución con `start-tv-kiosk.cmd -NewProfile -ProfileId auto_test_verify`: Creación exitosa del directorio de perfil aislado sin tocar el perfil persistente, arranque del navegador en Kiosk con PID 6400.
  - Ejecución posterior sin argumentos: El perfil persistente `$env:TEMP\nexus_tv_kiosk_profile` se conserva intacto.
- **Resultado del Retest:** 🟢 **PASS**
- **Documento de Evidencia:** [TC-RETEST-KIOSK-001.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-RETEST-KIOSK-001.md)
- **Deuda Técnica Pendiente:** Ninguna. Perfiles aislados e independientes 100% operativos.
