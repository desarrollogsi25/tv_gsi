# BUG-011: Bloqueo de Autoplay en YouTube IFrame Player y Discrepancia en Estado de Audio Visual

- **Módulo Afectado:** Frontend Video Players (`YouTubePlayer.jsx`, `TVPlayer.jsx`)
- **Severidad:** Alta
- **Prioridad:** P1 (Crítico para Operación Desatendida Kiosk)
- **Fecha de Detección:** 2026-10-09
- **Fecha de Implementación:** 2026-10-09
- **Estado:** 🟢 Resuelto; retest dinámico con IFrame real aprobado en navegador
- **Reportado por:** Senior QA Engineer & Technical Auditor
- **Implementado por:** Senior Software Engineer
- **Normativa Relacionada:** ISO/IEC 25010:2023 (Operabilidad, Confiabilidad de Reproducción)

---

### 1. Descripción
En pantallas de visualización desatendida (Digital Signage / Kiosk) y Smart TVs que no disponen de flags Chromium especiales, los vídeos de YouTube insertados mediante IFrame API no iniciaban su reproducción automáticamente, dejando en pantalla la miniatura con el botón central de YouTube.
Adicionalmente, la barra inferior mostraba falsamente `🔊 Audio Activo` debido a que el componente React leía un valor previo almacenado en `localStorage` (`tv_audio_unlocked = 'true'`), sin comprobar si el navegador había bloqueado el audio en la sesión en curso.

---

### 2. Pasos para Reproducir
1. Abrir la URL `/tv` en un navegador limpio sin clics ni gestos previos.
2. Cargar una playlist que contenga un enlace de YouTube.
3. Observar que el reproductor queda detenido en la portada de YouTube con el botón Play.
4. Observar que la barra inferior indica `🔊 Audio Activo` aunque el vídeo no esté reproduciendo ni emitiendo sonido.

---

### 3. Evidencia Técnica
- **Código Previo en `YouTubePlayer.jsx`:**
  - `playerVars` no forzaba `mute: 1`.
  - Invocación de `playVideo()` con sonido activo sin validación de permisos.
  - Ausencia de watchdog ante eventos de timeout.
- **Código Previo en `TVPlayer.jsx`:**
  - Indicador visual dependiente únicamente de `isAudioUnlocked`.
- **Caso de Prueba Histórico:** [TC-YOUTUBE-AUTOPLAY-001.md](../../13-testing/results/TC-YOUTUBE-AUTOPLAY-001.md). El retest dinámico de esta misión está en [TC-YOUTUBE-AUTOPLAY-LIVE-001.md](../../13-testing/results/TC-YOUTUBE-AUTOPLAY-LIVE-001.md).

---

### 4. Causa Raíz Identificada
1. La política de Autoplay de los navegadores modernos restringe la reproducción automática con sonido a menos que exista un gesto previo del usuario en la pestaña o el dominio cuente con un alto índice de interacción (MEI).
2. Intentar reproducir directamente con volumen causa el rechazo de la llamada o el congelamiento del IFrame en estado pausado/no-iniciado.
3. No existía desacoplamiento entre el estado de audio deseado y el estado real confirmado por el reproductor.

---

### 5. Impacto en el Negocio / Sistema
- Pantallas corporativas desatendidas quedaban varadas mostrando miniaturas de YouTube sin reproducir la programación horaria.
- Confusión en operadores al reportarse "Audio Activo" cuando la sala permanecía en silencio.

---

### 6. Solución Implementada
1. **Inicio Silenciado Garantizado:** Se configuró `mute: 1` en los `playerVars` y se ejecuta `target.mute()` en `onReady`.
2. **Watchdog de Inicio:** Se implementó un temporizador de vigilancia de 4.0s para reintentar en modo silenciado, y un timeout final de 3.5s para disparar `AUTOPLAY_TIMEOUT` y evitar bloqueos indefinidos.
3. **Manejo de `onAutoplayBlocked`:** Captura nativa del evento con recuperación inmediata.
4. **Activación de Audio en `PLAYING`:** Una vez confirmado el estado `PLAYING`, si el audio estaba solicitado se intenta `unMute()`. Si falla, se mantiene la reproducción y se reporta `'muted'`.
5. **Estado Visual Dinámico:** Se introdujo `actualAudioState` (`'unmuted' | 'muted' | 'blocked'`) sincronizado en tiempo real con la barra inferior y un banner interactivo.
6. **Backoff en Ítem Único:** En caso de error en playlist con un solo elemento, se aplica una pausa de 10s antes de reintentar.
7. **Unlock de audio por sesión:** `TVPlayer` ya no restaura `tv_audio_unlocked=true` como permiso para autoplay con sonido tras recargar. Cada carga inicia con audio bloqueado/silenciado; la interacción física actual de la sesión habilita audio y actualiza el componente.

---

### 7. Pruebas y Evidencia del Retest
- **Evidencia histórica previa:** El registro anterior reportó 18/18 pruebas, build y reconstrucción del contenedor. No se repitieron esas actividades como parte del retest dinámico actual.
- **Compilación en esta misión:** `npm run build` completó con código 0 y 126 módulos transformados; Vite advirtió que Node local es 20.18 y recomienda 20.19+.
- **Retest dinámico (2026-10-09):** Arnés temporal montó el componente real `YouTubePlayer.jsx` en navegador y cargó YouTube Developers Live (`M7lc1UVf-VE`). Sin interacción inicial, la traza fue `AUDIO muted → PLAYING → AUDIO muted`. Los parámetros observados del iframe incluyeron `autoplay=1`, `mute=1`, `playsinline=1`, `enablejsapi=1`.
- **Transición de fin:** Se buscó al último par de segundos y se observó el evento real `ENDED -> playlist item completion`, que activa `onEnded` para que el reproductor cambie de contenido.
- **Restauración de audio:** Tras pulsar el control de prueba, se observó `AUDIO unmuted`. Es una interacción explícita, acorde a la política de autoplay; no se afirma medición acústica del volumen físico.
- **Video no disponible:** Un ID inválido provocó `onError` con código 150 y el iframe mostró “Este video no está disponible.” No se probó un video de tercero con restricción específica de embedding.
- **Hallazgo y corrección durante retest:** Con prop inicial `muted=false` (estado que antes podía proceder de `tv_audio_unlocked` persistido), la traza mostró `PLAYING → AUDIO unmuted → NOT_PLAYING` sin gesto nuevo. Se modificó `TVPlayer` para iniciar cada sesión silenciado y requerir interacción física de la sesión actual para habilitar audio. Después de la corrección, el arnés sembró la preferencia vieja `tv_audio_unlocked=true`, no interactuó y confirmó `AUDIO muted → PLAYING → AUDIO muted`; el botón de interacción habilitó `AUDIO unmuted`.
- **Build final:** `npm run build` compiló 126 módulos y terminó con código 0; Vite advirtió que el Node local es 20.18 y recomienda 20.19+.
- **Documento de Evidencia:** [TC-YOUTUBE-AUTOPLAY-LIVE-001.md](</C:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-YOUTUBE-AUTOPLAY-LIVE-001.md>).
