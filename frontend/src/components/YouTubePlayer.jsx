import { useEffect, useRef } from 'react';
import { getYouTubeVideoId } from '../utils/playlistPlayback.mjs';

let apiPromise;

function loadYouTubeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (!apiPromise) {
        apiPromise = new Promise((resolve, reject) => {
            const previousReady = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                previousReady?.();
                resolve(window.YT);
            };
            let script = document.querySelector('script[data-youtube-iframe-api]');
            if (!script) {
                script = document.createElement('script');
                script.src = 'https://www.youtube.com/iframe_api';
                script.dataset.youtubeIframeApi = 'true';
                script.onerror = () => reject(new Error('No se pudo cargar YouTube IFrame API.'));
                document.head.appendChild(script);
            }
        });
    }
    return apiPromise;
}

export default function YouTubePlayer({
    url,
    title,
    iframeRef,
    paused,
    muted,
    volume,
    loop,
    onEnded,
    onDurationChange,
    onError,
    onAudioStateChange,
    onPlayStateChange
}) {
    const mountRef = useRef(null);
    const playerRef = useRef(null);
    const watchdogTimerRef = useRef(null);
    const retryTimerRef = useRef(null);
    const hasStartedRef = useRef(false);
    const callbacksRef = useRef({
        onEnded,
        onDurationChange,
        onError,
        onAudioStateChange,
        onPlayStateChange,
        iframeRef,
        paused,
        muted,
        volume
    });
    const videoId = getYouTubeVideoId(url);

    useEffect(() => {
        callbacksRef.current = {
            onEnded,
            onDurationChange,
            onError,
            onAudioStateChange,
            onPlayStateChange,
            iframeRef,
            paused,
            muted,
            volume
        };
    }, [onEnded, onDurationChange, onError, onAudioStateChange, onPlayStateChange, iframeRef, paused, muted, volume]);

    const clearTimers = () => {
        if (watchdogTimerRef.current) {
            clearTimeout(watchdogTimerRef.current);
            watchdogTimerRef.current = null;
        }
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    };

    useEffect(() => {
        let disposed = false;
        hasStartedRef.current = false;
        clearTimers();

        loadYouTubeApi().then((YT) => {
            if (disposed || !mountRef.current) return;

            // Iniciar watchdog de arranque desatendido
            const startWatchdog = (target) => {
                clearTimers();
                watchdogTimerRef.current = setTimeout(() => {
                    if (disposed || hasStartedRef.current) return;

                    const state = target.getPlayerState?.();
                    console.warn(`[YouTubePlayer] Watchdog: Estado actual ${state} tras 4s. Aplicando recuperacion silenciada...`);

                    // Intento 1 de recuperacion: forzar mute y reproducir
                    try {
                        target.mute();
                        target.playVideo();
                    } catch (e) {
                        console.warn('[YouTubePlayer] Fallo en intento 1 de recuperacion:', e);
                    }

                    // Temporizador final si no reacciona en 3s mas
                    retryTimerRef.current = setTimeout(() => {
                        if (disposed || hasStartedRef.current) return;
                        const finalState = target.getPlayerState?.();
                        if (finalState !== YT.PlayerState.PLAYING) {
                            console.error(`[YouTubePlayer] Autoplay fallido definitivamente para ${videoId} (estado ${finalState}). Avanzando...`);
                            callbacksRef.current.onError?.({
                                type: 'AUTOPLAY_TIMEOUT',
                                videoId,
                                message: 'El reproductor no alcanzo el estado PLAYING en el tiempo limite.'
                            });
                        }
                    }, 3500);
                }, 4000);
            };

            playerRef.current = new YT.Player(mountRef.current, {
                videoId,
                playerVars: {
                    autoplay: 1,
                    mute: 1, // Garantiza inicio sin bloqueo de politica de navegador
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    loop: loop ? 1 : 0,
                    playsinline: 1,
                    playlist: loop ? videoId : undefined,
                    origin: window.location.origin,
                    rel: 0,
                    enablejsapi: 1
                },
                events: {
                    onReady: ({ target }) => {
                        if (disposed) return;
                        playerRef.current = target;
                        const current = callbacksRef.current;
                        if (current.iframeRef) current.iframeRef.current = target.getIframe();

                        target.setVolume(Math.round(current.volume * 100));

                        // Silenciado inicial estricto para superar politicas de autoplay
                        target.mute();
                        current.onAudioStateChange?.('muted');

                        if (!current.paused) {
                            target.playVideo();
                        } else {
                            target.pauseVideo();
                        }

                        current.onDurationChange?.(target.getDuration());
                        startWatchdog(target);
                    },
                    onStateChange: ({ data, target }) => {
                        if (disposed) return;
                        const current = callbacksRef.current;

                        if (data === YT.PlayerState.PLAYING) {
                            hasStartedRef.current = true;
                            clearTimers();
                            current.onPlayStateChange?.(true);
                            current.onDurationChange?.(target.getDuration());

                            // Ahora que la reproduccion esta confirmada, si el usuario solicito audio, intentar unmute
                            if (!current.muted) {
                                try {
                                    target.unMute();
                                    current.onAudioStateChange?.('unmuted');
                                } catch (e) {
                                    console.warn('[YouTubePlayer] Error activando audio en PLAYING:', e);
                                    target.mute();
                                    current.onAudioStateChange?.('muted');
                                }
                            } else {
                                target.mute();
                                current.onAudioStateChange?.('muted');
                            }
                        } else if (data === YT.PlayerState.PAUSED) {
                            current.onPlayStateChange?.(false);
                        } else if (data === YT.PlayerState.ENDED) {
                            hasStartedRef.current = false;
                            clearTimers();
                            current.onEnded?.();
                        }
                    },
                    onAutoplayBlocked: ({ target }) => {
                        console.warn('[YouTubePlayer] Evento onAutoplayBlocked recibido. Forzando mute y reanudando video...');
                        if (disposed) return;
                        target.mute();
                        target.playVideo();
                        callbacksRef.current.onAudioStateChange?.('blocked');
                    },
                    onError: (error) => {
                        console.warn(`[YouTubePlayer] Error en YouTube IFrame (Codigo: ${error.data}) para video ${videoId}`);
                        clearTimers();
                        callbacksRef.current.onError?.(error);
                    }
                }
            });
        }).catch((error) => {
            clearTimers();
            callbacksRef.current.onError?.(error);
        });

        return () => {
            disposed = true;
            clearTimers();
            if (iframeRef) iframeRef.current = null;
            playerRef.current?.destroy();
            playerRef.current = null;
        };
    }, [videoId, loop, iframeRef]);

    // Sincronizacion reactiva con cambios de props de volumen, mute y pausa
    useEffect(() => {
        const player = playerRef.current;
        if (!player || typeof player.getPlayerState !== 'function') return;

        try {
            player.setVolume(Math.round(volume * 100));

            if (muted) {
                player.mute();
                callbacksRef.current.onAudioStateChange?.('muted');
            } else if (hasStartedRef.current) {
                player.unMute();
                callbacksRef.current.onAudioStateChange?.('unmuted');
            }

            if (paused) {
                player.pauseVideo();
            } else {
                player.playVideo();
                callbacksRef.current.onDurationChange?.(player.getDuration());
            }
        } catch (e) {
            console.warn('[YouTubePlayer] Error sincronizando estado del reproductor:', e);
        }
    }, [muted, volume, paused]);

    return (
        <div className="tv-media-element tv-iframe-player" title={title}>
            <div ref={mountRef} />
        </div>
    );
}
