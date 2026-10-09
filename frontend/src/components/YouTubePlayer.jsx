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
    onError
}) {
    const mountRef = useRef(null);
    const playerRef = useRef(null);
    const callbacksRef = useRef({ onEnded, onDurationChange, onError, iframeRef, paused, muted, volume });
    const videoId = getYouTubeVideoId(url);

    useEffect(() => {
        callbacksRef.current = { onEnded, onDurationChange, onError, iframeRef, paused, muted, volume };
    }, [onEnded, onDurationChange, onError, iframeRef, paused, muted, volume]);

    useEffect(() => {
        let disposed = false;
        loadYouTubeApi().then((YT) => {
            if (disposed || !mountRef.current) return;
            playerRef.current = new YT.Player(mountRef.current, {
                videoId,
                playerVars: {
                    autoplay: 1,
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    loop: loop ? 1 : 0,
                    playsinline: 1,
                    playlist: loop ? videoId : undefined,
                    origin: window.location.origin,
                    rel: 0
                },
                events: {
                    onReady: ({ target }) => {
                        playerRef.current = target;
                        const current = callbacksRef.current;
                        if (current.iframeRef) current.iframeRef.current = target.getIframe();
                        if (current.muted) target.mute();
                        else target.unMute();
                        target.setVolume(Math.round(current.volume * 100));
                        if (current.paused) target.pauseVideo();
                        else target.playVideo();
                        callbacksRef.current.onDurationChange?.(target.getDuration());
                    },
                    onStateChange: ({ data, target }) => {
                        if (data === YT.PlayerState.ENDED) callbacksRef.current.onEnded?.();
                        if (data === YT.PlayerState.PLAYING) {
                            callbacksRef.current.onDurationChange?.(target.getDuration());
                        }
                    },
                    onError: (error) => callbacksRef.current.onError?.(error)
                }
            });
        }).catch((error) => callbacksRef.current.onError?.(error));

        return () => {
            disposed = true;
            if (iframeRef) iframeRef.current = null;
            playerRef.current?.destroy();
            playerRef.current = null;
        };
    }, [videoId, loop, iframeRef]);

    useEffect(() => {
        const player = playerRef.current;
        if (!player) return;
        if (muted) player.mute();
        else player.unMute();
        player.setVolume(Math.round(volume * 100));
        if (paused) player.pauseVideo();
        else {
            player.playVideo();
            callbacksRef.current.onDurationChange?.(player.getDuration());
        }
    }, [muted, volume, paused]);

    return (
        <div className="tv-media-element tv-iframe-player" title={title}>
            <div ref={mountRef} />
        </div>
    );
}
