# TC-YOUTUBE-AUTOPLAY-LIVE-001 — Retest dinámico de YouTubePlayer

**Fecha:** 2026-10-09
**Resultado:** Aprobado tras corregir la restauración de audio entre sesiones.
**Entorno:** Navegador integrado Codex en `localhost`, YouTube IFrame API real, componente React `YouTubePlayer.jsx`. El arnés temporal y sus dos archivos se retiraron al terminar.

## Configuración inspeccionada

`YouTubePlayer` crea `YT.Player` con `autoplay: 1`, `mute: 1`, `playsinline: 1` y `enablejsapi: 1`; también establece `origin`, deshabilita controles/teclado y añade `loop`/`playlist` solo cuando aplica. El navegador observó el iframe de YouTube con `autoplay=1&mute=1&...&playsinline=1&...&enablejsapi=1`.

En `onReady`, el componente aplica el volumen configurado, fuerza `mute()`, reporta audio silenciado y ejecuta `playVideo()` si no está pausado. Al confirmar `PLAYING`, mantiene mute si la prop lo solicita; de lo contrario intenta `unMute()`. En el TVPlayer, la prop muted corresponde al estado de unlock de audio.

## Ejecuciones dinámicas

| Caso | Resultado observado | Estado |
| --- | --- | --- |
| Arranque limpio sin interacción | Video real “YouTube Developers Live: Embedded Web Player Customization” (ID `M7lc1UVf-VE`) produjo `AUDIO muted → PLAYING → AUDIO muted`; el iframe mostró controles de reproducción/pausa del video, no una portada detenida. | PASS |
| Fin de video y callback | El control del arnés buscó al último par de segundos. La API generó `ENDED -> playlist item completion`, correspondiente al `onEnded` que usa TVPlayer para cambiar de contenido. | PASS |
| Recuperación de audio | Tras click explícito en el control del arnés se registró `AUDIO unmuted`. Confirma ejecución del unlock de API tras interacción; no es medición del volumen acústico del dispositivo. | PASS |
| ID inválido/no disponible | Un ID no válido produjo callback `onError` con código 150 y el reproductor mostró “Este video no está disponible.” | PASS |
| Regresión por unlock persistido | Antes del ajuste, simulando prop inicial `muted=false`, la traza fue `PLAYING → AUDIO unmuted → NOT_PLAYING` sin gesto en esta sesión. | FALLÓ antes de la corrección; hallazgo corregido |
| Retest con preferencia anterior persistida | Se sembró `localStorage.tv_audio_unlocked=true`; con el nuevo inicio de sesión de TVPlayer en estado locked, el video permaneció `AUDIO muted → PLAYING → AUDIO muted` hasta un click explícito, que luego emitió `AUDIO unmuted`. | PASS |

## Corrección y resultado

`TVPlayer` ahora inicializa `isAudioUnlocked=false` y `actualAudioState='muted'` para cada carga, sin tratar `localStorage.tv_audio_unlocked` como permiso de autoplay vigente. La interacción global del dispositivo sigue llamando a `unlockAudio`, que habilita audio para esa sesión. Así, una preferencia guardada anteriormente no activa reproducción con sonido en una carga nueva ni interrumpe el autoplay silenciado.

Build final: `npm run build` en `frontend/` terminó con código 0, 126 módulos transformados. Node 20.18 mostró el aviso de Vite que pide 20.19+ o 22.12+.

## Alcance y limitaciones

Se probó un IFrame de YouTube real en el navegador integrado y se observó el DOM/eventos de la aplicación. El test de fin aceleró el caso mediante `seekTo` al tramo final; no se esperaron los 22 minutos de duración completa. El test de error fue un ID no disponible; no se probó un caso de restricción de embedding con un video real de tercero. No se probó el sonido físico de una TV ni diferentes modelos/versiones de navegador.

Referencia del comportamiento de IFrame y `onAutoplayBlocked`: [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference).
