import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { showConfirmation } from './Toast';
import './TVPlayer.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function TVPlayer() {
    const [tvUuid, setTvUuid] = useState(localStorage.getItem('tv_uuid') || '');
    const [screenName, setScreenName] = useState('');
    const [screenLocation, setScreenLocation] = useState('');
    const [isRegistered, setIsRegistered] = useState(false);
    const [isRejected, setIsRejected] = useState(false);

    // Audio Autoplay & Unlock State (Persistente en localStorage)
    const [isAudioUnlocked, setIsAudioUnlocked] = useState(() => {
        return localStorage.getItem('tv_audio_unlocked') === 'true';
    });
    const [volumeLevel, setVolumeLevel] = useState(() => {
        const saved = localStorage.getItem('tv_volume');
        return saved !== null ? parseFloat(saved) : 0.8;
    });

    // Código de Sesión PIN para auto-vinculación remota
    const [sessionPin] = useState(() => {
        const saved = sessionStorage.getItem('tv_session_pin');
        if (saved) return saved;
        const generated = String(Math.floor(1000 + Math.random() * 9000));
        sessionStorage.setItem('tv_session_pin', generated);
        return generated;
    });

    // Playlist State
    const [playlist, setPlaylist] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [playbackCycle, setPlaybackCycle] = useState(0);
    const [currentTimeStr, setCurrentTimeStr] = useState('');

    // Contenido Temporal en Vivo (Override de Playlist)
    const [temporaryContent, setTemporaryContent] = useState(null);
    const temporaryContentRef = useRef(null);
    const [isPaused, setIsPaused] = useState(false);
    const isPausedRef = useRef(false);

    useEffect(() => {
        temporaryContentRef.current = temporaryContent;
    }, [temporaryContent]);

    // Modal manual de ajustes (opcional)
    const [showSettings, setShowSettings] = useState(false);
    const [manualUuid, setManualUuid] = useState('');

    const timerRef = useRef(null);
    const tempTimerRef = useRef(null);
    const timerDeadlineRef = useRef(null);
    const timerRemainingRef = useRef(null);
    const tempTimerDeadlineRef = useRef(null);
    const tempTimerRemainingRef = useRef(null);
    const timerItemKeyRef = useRef(null);
    const videoRef = useRef(null);
    const tempVideoRef = useRef(null);
    const iframeRef = useRef(null);
    const tempIframeRef = useRef(null);
    const audioCtxRef = useRef(null);
    const isAudioUnlockedRef = useRef(isAudioUnlocked);
    const volumeLevelRef = useRef(volumeLevel);

    const pausePlayback = () => {
        if (isPausedRef.current) return;
        isPausedRef.current = true;
        setIsPaused(true);
        if (timerRef.current) {
            timerRemainingRef.current = Math.max(0, timerDeadlineRef.current - Date.now());
            clearTimeout(timerRef.current);
            timerRef.current = null;
            timerDeadlineRef.current = null;
        }
        if (tempTimerRef.current) {
            tempTimerRemainingRef.current = Math.max(0, tempTimerDeadlineRef.current - Date.now());
            clearTimeout(tempTimerRef.current);
            tempTimerRef.current = null;
            tempTimerDeadlineRef.current = null;
        }
        videoRef.current?.pause();
        tempVideoRef.current?.pause();
        [iframeRef.current, tempIframeRef.current].forEach((frame) => frame?.contentWindow?.postMessage(
            JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*'
        ));
    };

    const resumePlayback = () => {
        if (!isPausedRef.current) return;
        isPausedRef.current = false;
        setIsPaused(false);
        videoRef.current?.play().catch(() => {});
        tempVideoRef.current?.play().catch(() => {});
        [iframeRef.current, tempIframeRef.current].forEach((frame) => frame?.contentWindow?.postMessage(
            JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*'
        ));
        const content = temporaryContentRef.current;
        if (content?.duration_seconds > 0 && !tempTimerRef.current) {
            const duration = tempTimerRemainingRef.current ?? content.duration_seconds * 1000;
            tempTimerDeadlineRef.current = Date.now() + duration;
            tempTimerRef.current = setTimeout(() => {
                tempTimerRef.current = null;
                tempTimerDeadlineRef.current = null;
                tempTimerRemainingRef.current = null;
                setTemporaryContent(null);
            }, duration);
        }
    };

    const getMediaKind = (item) => {
        const url = item?.source_url || '';
        const path = url.split(/[?#]/, 1)[0].toLowerCase();
        if (item?.content_type === 'video' || /\.(mp4|webm|mkv|mov|ogv|m4v|mpeg|mpg|3gp)$/.test(path)) return 'video';
        if (['image', 'img'].includes(item?.content_type) || /\.(avif|gif|jpe?g|png|svg|webp|bmp)$/.test(path)) return 'image';
        if (getYouTubeEmbed(url) || ['power_bi', 'url', 'iframe', 'external_url', 'youtube'].includes(item?.content_type)) return 'iframe';
        return 'image';
    };

    useEffect(() => {
        isAudioUnlockedRef.current = isAudioUnlocked;
        volumeLevelRef.current = volumeLevel;
    }, [isAudioUnlocked, volumeLevel]);

    useEffect(() => {
        [videoRef.current, tempVideoRef.current].filter(Boolean).forEach((video) => {
            if (isPaused) video.pause();
            else video.play().catch(() => {});
        });
    }, [isPaused, temporaryContent, currentIndex]);

    // ─────────────────────────────────────────────────────────
    // Campanilla Sonora Synthesizer (Web Audio API)
    // ─────────────────────────────────────────────────────────
    const playChime = () => {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            if (!audioCtxRef.current) {
                audioCtxRef.current = new AudioCtx();
            }
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now); // A5
            osc.frequency.exponentialRampToValueAtTime(440, now + 0.15); // A4

            const vol = volumeLevel || 0.8;
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.exponentialRampToValueAtTime(0.3 * vol, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.55);
        } catch (e) {
            console.warn('AudioContext chime warning:', e);
        }
    };

    // ─────────────────────────────────────────────────────────
    // Desbloqueo de Audio & Sonido (Web Audio API + HTML5 Video)
    // ─────────────────────────────────────────────────────────
    const unlockAudio = (withChime = false) => {
        setIsAudioUnlocked(true);
        localStorage.setItem('tv_audio_unlocked', 'true');

        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                if (!audioCtxRef.current) {
                    audioCtxRef.current = new AudioCtx();
                }
                if (audioCtxRef.current.state === 'suspended') {
                    audioCtxRef.current.resume().catch(() => {});
                }
            }
        } catch (e) {
            console.warn('AudioContext resume warning:', e);
        }

        const vol = volumeLevel || 0.8;

        if (videoRef.current && !isPausedRef.current) {
            videoRef.current.muted = false;
            videoRef.current.volume = vol;
            videoRef.current.play().catch((err) => {
                console.warn('Aviso: Reproducción con audio pendiente de permiso del navegador:', err.message);
            });
        }
        if (tempVideoRef.current && !isPausedRef.current) {
            tempVideoRef.current.muted = false;
            tempVideoRef.current.volume = vol;
            tempVideoRef.current.play().catch((err) => {
                console.warn('Aviso en video temporal:', err.message);
            });
        }

        if (withChime) {
            playChime();
        }
    };

    // ─────────────────────────────────────────────────────────
    // Desbloqueo universal con cualquier interacción física en la TV
    // (Control remoto IR/Bluetooth, Tecla, Mouse o Pantalla Táctil)
    // ─────────────────────────────────────────────────────────
    useEffect(() => {
        const handleGlobalInteraction = () => {
            if (!isAudioUnlocked) {
                console.log('🔓 [TV Audio] Interacción física detectada. Activando audio permanentemente.');
                unlockAudio(true);
            }
        };

        window.addEventListener('click', handleGlobalInteraction, { passive: true });
        window.addEventListener('keydown', handleGlobalInteraction, { passive: true });
        window.addEventListener('touchstart', handleGlobalInteraction, { passive: true });
        window.addEventListener('pointerdown', handleGlobalInteraction, { passive: true });

        return () => {
            window.removeEventListener('click', handleGlobalInteraction);
            window.removeEventListener('keydown', handleGlobalInteraction);
            window.removeEventListener('touchstart', handleGlobalInteraction);
            window.removeEventListener('pointerdown', handleGlobalInteraction);
        };
    }, [isAudioUnlocked, volumeLevel]);

    // ─────────────────────────────────────────────────────────
    // Reloj en tiempo real
    // ─────────────────────────────────────────────────────────
    useEffect(() => {
        const interval = setInterval(() => {
            const now = new Date();
            setCurrentTimeStr(now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // ─────────────────────────────────────────────────────────
    // Carga de Playlist
    // ─────────────────────────────────────────────────────────
    const loadPlaylist = async (uuid) => {
        try {
            const res = await axios.get(`${API_BASE}/api/tv/${uuid}/playlist?t=${Date.now()}`);
            if (res.data.success && res.data.playlist.length > 0) {
                setPlaylist(res.data.playlist);
                setCurrentIndex(0);
            } else {
                setPlaylist([]);
            }
        } catch (err) {
            console.error('Error cargando playlist:', err);
        }
    };

    // ─────────────────────────────────────────────────────────
    // Autenticación inicial y verificación de pantalla
    // ─────────────────────────────────────────────────────────
    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const queryUuid = searchParams.get('uuid');

        if (queryUuid) {
            localStorage.setItem('tv_uuid', queryUuid);
            setTvUuid(queryUuid);
        }

        const activeUuid = queryUuid || tvUuid;
        if (!activeUuid) return;

        const verifyScreen = async () => {
            try {
                const res = await axios.post(`${API_BASE}/api/tv/login`, { tv_uuid: activeUuid });
                if (res.data.success) {
                    setIsRegistered(true);
                    setScreenName(res.data.screen.name);
                    setScreenLocation(res.data.screen.location);
                    loadPlaylist(activeUuid);
                }
            } catch (err) {
                console.warn('Pantalla no registrada en base de datos:', err);
                setIsRegistered(false);
            }
        };

        verifyScreen();
    }, [tvUuid]);

    // ─────────────────────────────────────────────────────────
    // WebSockets Hub de Control & Broadcast Temporal
    // ─────────────────────────────────────────────────────────
    useEffect(() => {
        const controlSocket = io(`${API_BASE}/control`, {
            query: isRegistered && tvUuid
                ? { tv_uuid: tvUuid }
                : { session_code: sessionPin, waiting_pairing: 'true' },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000
        });

        controlSocket.on('connect', () => {
            if (isRegistered && tvUuid) controlSocket.emit('register_screen', { tv_uuid: tvUuid });
        });

        controlSocket.on('command:rejected', () => setIsRejected(true));

        // 1. Asignación remota de usuario/perfil desde el Admin
        controlSocket.on('command:assign_profile', (profile) => {
            console.log('🎉 Perfil asignado remotamente desde el Admin:', profile);
            localStorage.setItem('tv_uuid', profile.tv_uuid);
            setTvUuid(profile.tv_uuid);
            setScreenName(profile.name);
            setScreenLocation(profile.location);
            setIsRegistered(true);
            loadPlaylist(profile.tv_uuid);
        });

        // 2. Comandos generales de control remoto
        controlSocket.on('command:execute', ({ command, payload }) => {
            console.log(`🎮 Comando recibido: ${command}`, payload);
            if (command === 'unlink') {
                localStorage.removeItem('tv_uuid');
                setTvUuid('');
                setIsRegistered(false);
                setPlaylist([]);
                setIsRejected(false);
            } else if (command === 'reload' || command === 'playlist_changed' || command === 'approved') {
                window.location.reload();
            } else if (command === 'next' || command === 'skip') {
                handleNext();
            } else if (command === 'pause') {
                pausePlayback();
            } else if (command === 'play' || command === 'resume') {
                resumePlayback();
            } else if (command === 'unmute') {
                unlockAudio(true);
            } else if (command === 'mute') {
                setIsAudioUnlocked(false);
                localStorage.setItem('tv_audio_unlocked', 'false');
                if (videoRef.current) videoRef.current.muted = true;
                if (tempVideoRef.current) tempVideoRef.current.muted = true;
            } else if (command === 'volume' || command === 'set_volume') {
                const vol = Math.max(0, Math.min(1, payload?.volume !== undefined ? payload.volume : (payload?.level ?? 80) / 100));
                setVolumeLevel(vol);
                localStorage.setItem('tv_volume', String(vol));
                if (videoRef.current) videoRef.current.volume = vol;
                if (tempVideoRef.current) tempVideoRef.current.volume = vol;
                if (vol > 0) {
                    setIsAudioUnlocked(true);
                    localStorage.setItem('tv_audio_unlocked', 'true');
                    if (videoRef.current && !isPausedRef.current) {
                        videoRef.current.muted = false;
                        videoRef.current.play().catch(() => {});
                    }
                    if (tempVideoRef.current && !isPausedRef.current) {
                        tempVideoRef.current.muted = false;
                        tempVideoRef.current.play().catch(() => {});
                    }
                } else {
                    setIsAudioUnlocked(false);
                    localStorage.setItem('tv_audio_unlocked', 'false');
                    if (videoRef.current) videoRef.current.muted = true;
                    if (tempVideoRef.current) tempVideoRef.current.muted = true;
                }
            } else if (command === 'chime' || command === 'test_sound' || command === 'play_sound') {
                playChime();
            }
        });

        // 3. Inicio de Contenido Temporal en Vivo (Override de Playlist)
        controlSocket.on('command:temporary_content', (content) => {
            console.log('🚨 [Live Override] Contenido temporal recibido:', content);
            if (tempTimerRef.current) clearTimeout(tempTimerRef.current);
            tempTimerRemainingRef.current = null;
            tempTimerDeadlineRef.current = null;

            setTemporaryContent(content);

            // Si el contenido temporal pide sonido explícito, desbloquear
            if (content.muted === false) {
                unlockAudio(false);
            }

            // Si tiene duración programada, auto-finalizar y reanudar playlist
            if (content.duration_seconds && content.duration_seconds > 0 && !isPausedRef.current) {
                const duration = (tempTimerRemainingRef.current ?? content.duration_seconds * 1000);
                tempTimerRemainingRef.current = duration;
                tempTimerDeadlineRef.current = Date.now() + duration;
                tempTimerRef.current = setTimeout(() => {
                    console.log('⏱️ [Live Override] Duración de temporal expirada. Reanudando playlist.');
                    tempTimerRef.current = null;
                    tempTimerDeadlineRef.current = null;
                    tempTimerRemainingRef.current = null;
                    setTemporaryContent(null);
                }, duration);
            }
        });

        // 4. Finalización de Contenido Temporal -> Reanudar Playlist
        controlSocket.on('command:clear_temporary', () => {
            console.log('⏹️ [Live Override] Quitando contenido temporal, reanudando playlist.');
            if (tempTimerRef.current) clearTimeout(tempTimerRef.current);
            tempTimerRef.current = null;
            tempTimerDeadlineRef.current = null;
            tempTimerRemainingRef.current = null;
            setTemporaryContent(null);
        });

        // 5. Acciones remotas específicas sobre el contenido temporal
        controlSocket.on('command:temporary_action', ({ action, payload }) => {
            console.log(`🎮 [Live Override Action] '${action}':`, payload);
            if (action === 'play' || action === 'resume') {
                resumePlayback();
            } else if (action === 'pause') {
                pausePlayback();
            } else if (action === 'unmute') {
                unlockAudio(true);
            } else if (action === 'mute') {
                if (tempVideoRef.current) tempVideoRef.current.muted = true;
            } else if (action === 'volume' || action === 'set_volume') {
                const vol = Math.max(0, Math.min(1, payload?.volume !== undefined ? payload.volume : (payload?.level ?? 80) / 100));
                setVolumeLevel(vol);
                localStorage.setItem('tv_volume', String(vol));
                if (tempVideoRef.current) {
                    tempVideoRef.current.volume = vol;
                    if (vol > 0) {
                        tempVideoRef.current.muted = false;
                        setIsAudioUnlocked(true);
                        localStorage.setItem('tv_audio_unlocked', 'true');
                    } else {
                        tempVideoRef.current.muted = true;
                    }
                }
            } else if (action === 'chime' || action === 'test_sound' || action === 'play_sound') {
                playChime();
            }
        });

        // Heartbeat periódico HTTP y WebSocket con telemetría de audio
        const hbInterval = setInterval(() => {
            if (isRegistered && tvUuid) {
                axios.post(`${API_BASE}/api/tv/heartbeat`, {
                    tv_uuid: tvUuid,
                    is_override: !!temporaryContentRef.current
                }).catch(() => {});

                controlSocket.emit('tv:heartbeat', {
                    tv_uuid: tvUuid,
                    current_content: temporaryContentRef.current?.title || (playlist.length > 0 && playlist[currentIndex]?.title) || 'En Reproducción',
                    volume: Math.round(volumeLevelRef.current * 100),
                    is_override: !!temporaryContentRef.current,
                    is_audio_unlocked: isAudioUnlockedRef.current
                });
            }
        }, 15000);

        return () => {
            controlSocket.disconnect();
            if (tempTimerRef.current) clearTimeout(tempTimerRef.current);
            clearInterval(hbInterval);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tvUuid, isRegistered, sessionPin]);

    // ─────────────────────────────────────────────────────────
    // Transición de Contenido de Playlist Normal
    // ─────────────────────────────────────────────────────────
    const handleNext = () => {
        if (isPausedRef.current) return;
        if (playlist.length === 0) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        timerDeadlineRef.current = null;
        timerRemainingRef.current = null;
        setPlaybackCycle((cycle) => cycle + 1);
        setCurrentIndex((prev) => (prev + 1) % playlist.length);
    };

    // Bucle continuo y seguro de Video
    const handleVideoEnded = () => {
        if (isPausedRef.current) return;
        if (playlist.length <= 1) {
            // Rebobinar a 0 y reproducir en bucle infinito
            if (videoRef.current) {
                videoRef.current.currentTime = 0;
                videoRef.current.play().catch((err) => {
                    console.warn('Replay loop warning:', err);
                });
            }
        } else {
            handleNext();
        }
    };

    const handleVideoError = (err) => {
        console.warn('Video playback error, auto-advancing:', err);
        setTimeout(handleNext, 2000);
    };

    const handleImageError = () => {
        console.warn(`[TVPlayer] Error cargando imagen en índice ${currentIndex}. Aplicando backoff de 2s...`);
        setTimeout(() => {
            handleNext();
        }, 2000);
    };

    // Temporizador para imágenes o URLs estáticas
    useEffect(() => {
        if (temporaryContent) return; // Si hay override temporal, no avanzar playlist
        if (playlist.length === 0) return;

        const currentItem = playlist[currentIndex];
        if (!currentItem) return;

        if (timerRef.current) clearTimeout(timerRef.current);

        const itemKey = `${currentItem.content_id ?? currentItem.id ?? currentIndex}:${currentItem.source_url}`;
        if (timerItemKeyRef.current !== itemKey) {
            timerItemKeyRef.current = itemKey;
            timerRemainingRef.current = null;
        }
        const isVideo = getMediaKind(currentItem) === 'video';

        if (!isVideo && !isPaused) {
            const duration = (timerRemainingRef.current ?? (currentItem.duration_seconds || 15) * 1000);
            timerDeadlineRef.current = Date.now() + duration;
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                timerDeadlineRef.current = null;
                timerRemainingRef.current = null;
                handleNext();
            }, duration);
        }

        return () => {
            if (timerRef.current) {
                timerRemainingRef.current = Math.max(0, timerDeadlineRef.current - Date.now());
                clearTimeout(timerRef.current);
                timerRef.current = null;
                timerDeadlineRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex, playlist, temporaryContent, isPaused, playbackCycle]);

    // Bucle continuo para el video del Contenido Temporal
    const handleTempVideoEnded = () => {
        if (isPausedRef.current) return;
        if (tempVideoRef.current) {
            tempVideoRef.current.currentTime = 0;
            tempVideoRef.current.play().catch(() => {});
        }
    };

    // Helper para YouTube Embed
    const getYouTubeEmbed = (url) => {
        if (!url) return null;
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
        return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1&mute=${isAudioUnlocked ? 0 : 1}&controls=0&loop=1&playlist=${match[1]}&enablejsapi=1` : null;
    };

    const handleManualBind = (e) => {
        e.preventDefault();
        if (manualUuid) {
            localStorage.setItem('tv_uuid', manualUuid);
            setTvUuid(manualUuid);
            setShowSettings(false);
            window.location.reload();
        }
    };

    const handleUnlink = () => {
        showConfirmation({
            title: 'Desvincular Pantalla',
            message: '¿Desvincular esta pantalla? Volverá al estado de espera para asignación remota.',
            confirmText: 'Desvincular',
            onAccept: () => {
                localStorage.removeItem('tv_uuid');
                setTvUuid('');
                setIsRegistered(false);
                setPlaylist([]);
                window.location.reload();
            }
        });
    };

    const currentItem = playlist[currentIndex];

    // ─────────────────────────────────────────────────────────
    // CASO 1: Pantalla NO vinculada aún (Estado de Espera Remota)
    // ─────────────────────────────────────────────────────────
    if (!isRegistered || !tvUuid) {
        return (
            <div className="tv-player-container" onClick={unlockAudio}>
                <div className="tv-waiting-state">
                    <div className="tv-waiting-logo">📡</div>
                    <h1 className="tv-waiting-title">Pantalla Detectada en la Red</h1>
                    <p className="tv-waiting-subtitle">
                        {isRejected
                            ? 'La solicitud de vinculación fue rechazada. Contacta al administrador para iniciar una nueva sesión.'
                            : 'Esta pantalla se encuentra en línea y lista para ser vinculada automáticamente desde la Consola de Administración.'}
                    </p>

                    <div style={{
                        background: 'rgba(0, 113, 227, 0.15)',
                        border: '2px solid rgba(0, 198, 255, 0.5)',
                        borderRadius: '20px',
                        padding: '24px 36px',
                        margin: '16px 0 28px',
                        backdropFilter: 'blur(16px)',
                        textAlign: 'center'
                    }}>
                        <div style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#00c6ff', marginBottom: '6px' }}>
                            Código PIN de Sesión
                        </div>
                        <div style={{ fontSize: '3.6rem', fontWeight: '900', letterSpacing: '0.08em', color: '#ffffff' }}>
                            #{sessionPin}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '10px', color: '#34c759', fontSize: '0.95rem' }}>
                            <span className="tv-dot-online" />
                            <span>Esperando asignación remota del Administrador...</span>
                        </div>
                    </div>

                    <div className="tv-clock-badge">{currentTimeStr || '00:00:00'}</div>

                    <button
                        onClick={() => setShowSettings(true)}
                        style={{ marginTop: '24px', background: 'transparent', border: 'none', color: '#6e6e73', cursor: 'pointer', fontSize: '0.85rem' }}
                    >
                        ⚙️ Asignación Manual / Avanzada
                    </button>
                </div>

                {/* Modal manual de respaldo */}
                {showSettings && (
                    <div className="tv-pairing-backdrop" onClick={(e) => e.stopPropagation()}>
                        <div className="tv-pairing-modal">
                            <h2>⚙️ Asignación Manual</h2>
                            <p>Ingresa el UUID de la pantalla configurado en el sistema:</p>
                            <form onSubmit={handleManualBind}>
                                <input
                                    className="tv-form-input"
                                    type="text"
                                    placeholder="Ingresa UUID (ej. PT101-uuid...)"
                                    value={manualUuid}
                                    onChange={(e) => setManualUuid(e.target.value)}
                                    required
                                />
                                <button type="submit" className="tv-btn-primary">Guardar y Vincular</button>
                                <button
                                    type="button"
                                    style={{ marginTop: '10px', background: 'transparent', border: 'none', color: '#8e8e93', cursor: 'pointer' }}
                                    onClick={() => setShowSettings(false)}
                                >
                                    Cerrar
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ─────────────────────────────────────────────────────────
    // CASO 2: Pantalla Vinculada (Reproducción Activa)
    // ─────────────────────────────────────────────────────────
    return (
        <div className="tv-player-container" onClick={unlockAudio} tabIndex={0}>
            {/* Banner de Desbloqueo de Audio si el navegador lo bloqueó */}
            {!isAudioUnlocked && (
                <div className="tv-audio-unlock-banner" onClick={(e) => { e.stopPropagation(); unlockAudio(); }}>
                    <span>🔊 Audio Silenciado por Política del Navegador</span>
                    <button className="tv-btn-unlock-sound">Activar Sonido</button>
                </div>
            )}

            {/* ─────────────────────────────────────────────────────────
                A. MODO OVERRIDE: Contenido Temporal en Vivo
               ───────────────────────────────────────────────────────── */}
            {temporaryContent ? (
                <>
                    {/* Badge Indicador de Transmisión Temporal en Vivo */}
                    <div className="tv-live-badge">
                        <span className="tv-dot-live" />
                        <span className="tv-live-title">
                            EN VIVO: {temporaryContent.title || 'Transmisión Prioritaria'}
                        </span>
                    </div>

                    {/* Video Temporal */}
                    {getMediaKind(temporaryContent) === 'video' && (
                        <video
                            ref={tempVideoRef}
                            className="tv-media-element tv-video-player"
                            src={temporaryContent.source_url.startsWith('http') ? temporaryContent.source_url : `${API_BASE}${temporaryContent.source_url}`}
                            autoPlay={!isPaused}
                            playsInline
                            loop={temporaryContent.loop !== false}
                            muted
                            onLoadedMetadata={(e) => {
                                const isMuted = temporaryContent.muted === false ? false : !isAudioUnlocked;
                                e.currentTarget.muted = isMuted;
                                e.currentTarget.volume = volumeLevel;
                            }}
                            onEnded={handleTempVideoEnded}
                            onError={(e) => console.warn('Error en video temporal:', e)}
                        />
                    )}

                    {/* Imagen Temporal */}
                    {getMediaKind(temporaryContent) === 'image' && (
                        <img
                            className="tv-media-element tv-image-player"
                            src={temporaryContent.source_url.startsWith('http') ? temporaryContent.source_url : `${API_BASE}${temporaryContent.source_url}`}
                            alt={temporaryContent.title}
                        />
                    )}

                    {/* YouTube Temporal */}
                    {getYouTubeEmbed(temporaryContent.source_url) && (
                        <iframe
                            ref={tempIframeRef}
                            className="tv-media-element tv-iframe-player"
                            src={getYouTubeEmbed(temporaryContent.source_url)}
                            title={temporaryContent.title}
                            allow="autoplay; encrypted-media"
                        />
                    )}

                    {/* Iframe / PowerBI Temporal */}
                    {!getYouTubeEmbed(temporaryContent.source_url) && getMediaKind(temporaryContent) === 'iframe' && (
                        <iframe
                            ref={tempIframeRef}
                            className="tv-media-element tv-iframe-player"
                            src={temporaryContent.source_url}
                            title={temporaryContent.title}
                            onLoad={(e) => { if (isPaused) e.currentTarget.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*'); }}
                            allowFullScreen
                        />
                    )}
                </>
            ) : currentItem ? (
                /* ─────────────────────────────────────────────────────────
                   B. MODO REGULAR: Playlist Programada
                   ───────────────────────────────────────────────────────── */
                <>
                    {/* Video de Playlist en Bucle Infinito Seguro */}
                    {getMediaKind(currentItem) === 'video' && (
                        <video
                            ref={videoRef}
                            className="tv-media-element tv-video-player"
                            src={currentItem.source_url.startsWith('http') ? currentItem.source_url : `${API_BASE}${currentItem.source_url}`}
                            autoPlay={!isPaused}
                            playsInline
                            loop={playlist.length <= 1}
                            muted
                            onLoadedMetadata={(e) => {
                                e.currentTarget.muted = !isAudioUnlocked;
                                e.currentTarget.volume = volumeLevel;
                            }}
                            onEnded={handleVideoEnded}
                            onError={handleVideoError}
                        />
                    )}

                    {/* Imagen de Playlist */}
                    {getMediaKind(currentItem) === 'image' && (
                        <img
                            className="tv-media-element tv-image-player"
                            src={currentItem.source_url.startsWith('http') ? currentItem.source_url : `${API_BASE}${currentItem.source_url}`}
                            alt={currentItem.title}
                            onError={handleImageError}
                        />
                    )}

                    {/* YouTube */}
                    {getYouTubeEmbed(currentItem.source_url) && (
                        <iframe
                            ref={iframeRef}
                            className="tv-media-element tv-iframe-player"
                            src={getYouTubeEmbed(currentItem.source_url)}
                            title={currentItem.title}
                            onLoad={(e) => { if (isPaused) e.currentTarget.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*'); }}
                            allow="autoplay; encrypted-media"
                        />
                    )}

                    {/* IFrame Genérico (Power BI, URL Web) */}
                    {!getYouTubeEmbed(currentItem.source_url) && getMediaKind(currentItem) === 'iframe' && (
                        <iframe
                            ref={iframeRef}
                            className="tv-media-element tv-iframe-player"
                            src={currentItem.source_url}
                            title={currentItem.title}
                            allowFullScreen
                        />
                    )}
                </>
            ) : (
                /* Estado en Espera cuando la playlist no tiene items configurados */
                <div className="tv-waiting-state">
                    <div className="tv-waiting-logo">📺</div>
                    <h1 className="tv-waiting-title">{screenName}</h1>
                    <p className="tv-waiting-subtitle">
                        {screenLocation ? `Ubicación: ${screenLocation}` : 'Sin contenido programado en esta franja horaria.'}
                    </p>
                    <div className="tv-clock-badge">{currentTimeStr || '00:00:00'}</div>
                </div>
            )}

            {/* Barra Inferior Discreta */}
            <div className="tv-bottom-bar">
                <div className="tv-screen-badge">
                    <span className="tv-dot-online" />
                    <span>{screenName} • {screenLocation || 'Sala'}</span>
                    <span style={{ opacity: 0.7, margin: '0 4px' }}>|</span>
                    <span style={{ color: isAudioUnlocked ? '#34c759' : '#ff9500' }}>
                        {isAudioUnlocked ? '🔊 Audio Activo' : '🔇 Silenciado'}
                    </span>
                    {temporaryContent && (
                        <>
                            <span style={{ opacity: 0.7, margin: '0 4px' }}>|</span>
                            <span style={{ color: '#ff3b30', fontWeight: 600 }}>🔴 OVERRIDE ACTIVO</span>
                        </>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="tv-btn-gear" onClick={handleUnlink}>
                        🔗 Cambiar Usuario / Desvincular
                    </button>
                </div>
            </div>
        </div>
    );
}
