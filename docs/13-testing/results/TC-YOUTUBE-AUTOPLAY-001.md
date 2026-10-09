# Nexus TV Enterprise — Caso de Prueba TC-YOUTUBE-AUTOPLAY-001

> **Nota de alcance (2026-10-09):** Este es el registro histórico del caso y de sus pruebas previas; sus resultados de suite, watchdog, backoff y contenedor no se volvieron a ejecutar en el retest de esta misión. La evidencia dinámica realmente ejecutada ahora está en [TC-YOUTUBE-AUTOPLAY-LIVE-001.md](TC-YOUTUBE-AUTOPLAY-LIVE-001.md). No se debe interpretar la tabla histórica como evidencia de que esos casos se repitieron hoy.

> **Documento:** TC-YOUTUBE-AUTOPLAY-001
> **Título:** Validación de Autoplay Silenciado Inicial, Recuperación de Audio Desatendido y Watchdog de YouTube
> **Fecha de Ejecución:** 2026-10-09
> **Tester / Ingeniero:** Senior Software Engineer & Senior QA Auditor
> **Normativas:** ISO/IEC 25010:2023 (Operabilidad, Confiabilidad de Reproducción), W3C Media Autoplay Policy Specification
> **Resultado del Caso:** 🟢 **APROBADO (PASS)**

---

## 1. Identificación y Alcance del Caso de Prueba

- **Módulos Bajo Prueba:**
  - `frontend/src/components/YouTubePlayer.jsx`
  - `frontend/src/components/TVPlayer.jsx`
  - `frontend/src/utils/playlistPlayback.mjs`
- **Objetivo:**
  1. Garantizar que los vídeos de YouTube insertados inicien automáticamente sin interacción manual (clic central de YouTube) en entornos de señalización digital / Smart TV.
  2. Implementar una secuencia de arranque con inicio silenciado estricto (`mute: 1`) para satisfacer las políticas de autoplay de Chromium/WebKit sin requerir gestos de usuario previos.
  3. Desacoplar la variable de audio deseada en `localStorage` (`tv_audio_unlocked`) del estado real reportado por el reproductor (`actualAudioState`).
  4. Implementar recuperación ante eventos `onAutoplayBlocked` y watchdog acotado ante vídeos bloqueados o con timeout.
  5. Asegurar un retroceso acotado (backoff de 10 segundos) cuando la playlist contenga un único elemento fallido para evitar bucles agresivos de reintento.

---

## 2. Diagnóstico del Comportamiento Previo y Causa Raíz

### 2.1. Comportamiento Anterior Observado
En pruebas en navegador sin flags o en Smart TVs comerciales, el reproductor de YouTube mostraba la miniatura del vídeo con el botón central rojo de reproducción visible, sin iniciar el vídeo de forma autónoma. Paralelamente, la barra inferior mostraba falsamente `🔊 Audio Activo` basándose exclusivamente en que `localStorage.getItem('tv_audio_unlocked')` era `'true'`.

### 2.2. Causa Raíz Confirmada
1. **Política de Autoplay del Navegador (MEI - Media Engagement Index):** Chromium y WebKit bloquean incondicionalmente la llamada `playVideo()` si el reproductor tiene volumen activo (`muted: false`) y el origen no cuenta con un gesto previo del usuario en la sesión actual.
2. **Desacoplamiento de Estado:** `TVPlayer.jsx` infería el estado sonoro a partir de la preferencia persistida del usuario, no del estado efectivo devuelto por la API de YouTube IFrame (`target.isMuted()`).
3. **Ausencia de Watchdog:** Si el reproductor no pasaba al estado `PLAYING` (1) dentro de un tiempo prudencial, permanecía estancado indefinidamente en la pantalla estática de YouTube.

---

## 3. Solución Implementada

### 3.1. Secuencia de Inicialización Segura en `YouTubePlayer.jsx`
```javascript
// playerVars con mute forzado para satisfacer la política del navegador
playerVars: {
    autoplay: 1,
    mute: 1,
    controls: 0,
    disablekb: 1,
    fs: 0,
    loop: loop ? 1 : 0,
    playsinline: 1,
    playlist: loop ? videoId : undefined,
    origin: window.location.origin,
    rel: 0,
    enablejsapi: 1
}
```

### 3.2. Watchdog de Reproducción y Listener `onAutoplayBlocked`
- **Watchdog T1 (4.0s):** Si tras 4 segundos el reproductor no ha alcanzado `YT.PlayerState.PLAYING`, se fuerza `target.mute()` y se reintenta `target.playVideo()`.
- **Watchdog T2 (3.5s adicionales):** Si tras el reintento el vídeo aún no reproduce, se emite `onError({ type: 'AUTOPLAY_TIMEOUT' })` permitiendo avanzar al siguiente contenido de forma controlada.
- **Evento API `onAutoplayBlocked`:** Se suscribe al evento nativo de YouTube IFrame API; si se dispara, el reproductor silencia automáticamente el vídeo y reintenta el inicio en modo mudo, actualizando la telemetría a `'blocked'`.

### 3.3. Unmute Condicional Posterior a la Confirmación de `PLAYING`
Cuando el evento `onStateChange` confirma `YT.PlayerState.PLAYING`, y sólo si el audio fue solicitado previamente (`!current.muted`), se intenta habilitar el sonido con `target.unMute()`. Si el navegador arroja excepción o bloquea el sonido, se captura el error de forma segura manteniendo la reproducción visual y notificando `onAudioStateChange('muted')`.

### 3.4. Sincronización Visual en `TVPlayer.jsx`
- Nuevo estado local `actualAudioState` (`'unmuted' | 'muted' | 'blocked'`).
- La barra inferior muestra:
  - 🟢 `🔊 Audio Activo` cuando el audio está confirmado.
  - 🟠 `🔇 Silenciado` cuando el sistema está configurado en silencio.
  - 🔴 `⚠️ Audio Bloqueado` cuando el navegador impide la reproducción con sonido.
- Se implementó un banner interactivo visible únicamente cuando el sonido está bloqueado o silenciado por política del navegador.
- En caso de error en playlist con un único elemento (`playlist.length <= 1`), se aplica un backoff de 10 segundos antes de recargar.

---

## 4. Matriz de Pruebas Ejecutadas y Resultados

| ID Prueba | Escenario Evaluado | Condición de Entrada | Resultado Esperado | Resultado Real | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **YT-01** | Autoplay silenciado en entorno limpio | Perfil limpio sin gestos previos | Vídeo inicia autónomamente sin requerir clic | Vídeo inicia con `mute: 1` y alcanza estado `PLAYING` en < 2s | 🟢 PASS |
| **YT-02** | Indicador de audio desacoplado | `isAudioUnlocked = true`, pero vídeo bloqueado en mute | Barra inferior refleja `⚠️ Audio Bloqueado` o `🔇 Silenciado`, nunca falso positivo | Refleja fielmente el estado `actualAudioState` | 🟢 PASS |
| **YT-03** | Watchdog ante vídeo bloqueado | URL o vídeo que no avanza a `PLAYING` | Watchdog interviene a los 4s con mute y avanza a los 7.5s | Dispara `AUTOPLAY_TIMEOUT` y notifica `onError` | 🟢 PASS |
| **YT-04** | Error en Playlist con único ítem | URL con vídeo eliminado y playlist = 1 | No entra en bucle agresivo de 2s; aplica backoff de 10s | Backoff de 10s ejecutado sin saturar CPU ni red | 🟢 PASS |
| **YT-05** | Compilación de producción | `npm run build` en carpeta `frontend/` | Bundle generado sin errores de tipos o sintaxis | Compilación exitosa (125 módulos transformados, 0 errores) | 🟢 PASS |
| **YT-06** | Suite completa de pruebas unitarias | `npm test` en raíz del proyecto | 18/18 pruebas aprobadas | 18/18 pruebas aprobadas (200ms) | 🟢 PASS |

---

## 5. Nota Operativa sobre Dispositivos Smart TV Físicos

El flag `--autoplay-policy=no-user-gesture-required` es una característica de la línea de comandos de motores Chromium (Google Chrome, Microsoft Edge, Electron, webOS con Chromium embed).
En Smart TVs comerciales con navegadores cerrados (Samsung Tizen, LG webOS nativo antiguo, Vidaa OS), las políticas de audio no admiten flags de consola. En dichos entornos:
1. El vídeo de YouTube reproducirá de manera garantizada gracias a la política de **inicio silenciado (`mute: 1`)**.
2. Para activar el sonido, se requiere una interacción física inicial única (pulsar cualquier botón en el mando a distancia de la TV), lo cual dispara el listener global `handleGlobalInteraction` y activa el audio permanentemente para la sesión.
