import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import { API_URL } from '../Admin';

export default function TVControl() {
    const { uuid } = useParams();
    const [screen, setScreen] = useState(null);
    const [playlists, setPlaylists] = useState([]);
    const [name, setName] = useState('');
    const [location, setLocation] = useState('');
    const [selectedPlaylist, setSelectedPlaylist] = useState('');
    const [volume, setVolume] = useState(80);
    const [message, setMessage] = useState('');
    const [tvAudioStatus, setTvAudioStatus] = useState(null); // { isUnlocked: bool, volume: number }

    // Estado local para emisión temporal directa
    const [tempUrl, setTempUrl] = useState('');
    const [tempTitle, setTempTitle] = useState('Transmisión Prioritaria');
    const [tempType, setTempType] = useState('video');
    const [isTempActive, setIsTempActive] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef(null);

    // Conectar a WebSockets para recibir telemetría de audio en vivo
    useEffect(() => {
        const socket = io(`${API_URL}/control`, {
            transports: ['websocket', 'polling'],
            auth: { token: localStorage.getItem('token') }
        });

        socket.on('tv:heartbeat_received', (data) => {
            if (data && data.tv_uuid === uuid) {
                setTvAudioStatus({
                    isUnlocked: data.is_audio_unlocked,
                    volume: data.volume,
                    currentContent: data.current_content
                });
                if (data.volume !== undefined) {
                    setVolume(data.volume);
                }
            }
        });

        return () => {
            socket.disconnect();
        };
    }, [uuid]);

    useEffect(() => {
        const loadData = async () => {
            try {
                const [screenRes, playlistRes, activeRes] = await Promise.all([
                    axios.get(`${API_URL}/api/admin/screens/${uuid}`).catch(() => ({ data: { success: false } })),
                    axios.get(`${API_URL}/api/admin/playlists`).catch(() => ({ data: { success: false, playlists: [] } })),
                    axios.get(`${API_URL}/api/admin/active-temporary`).catch(() => ({ data: { success: false, state: { global: null, byScreen: {} } } }))
                ]);

                if (screenRes.data?.success) {
                    const scr = screenRes.data.screen;
                    setScreen(scr);
                    setName(scr.name || '');
                    setLocation(scr.location || '');
                    setSelectedPlaylist(scr.playlist_id || '');
                }
                if (playlistRes.data?.success) {
                    setPlaylists(playlistRes.data.playlists || []);
                }
                if (activeRes.data?.success) {
                    const byScreen = activeRes.data.state?.byScreen || {};
                    const isGlobal = !!activeRes.data.state?.global;
                    setIsTempActive(isGlobal || !!byScreen[uuid]);
                }
            } catch (err) {
                console.error('Error cargando control TV:', err);
                setMessage('Error al cargar la información de la pantalla.');
            }
        };

        loadData();
    }, [uuid]);

    const sendCommand = async (command, payload = {}) => {
        try {
            await axios.post(`${API_URL}/api/admin/screens/${uuid}/control`, { command, payload });
            setMessage(`Comando '${command}' ejecutado exitosamente.`);
            setTimeout(() => setMessage(''), 3500);
        } catch (err) {
            setMessage('Error al ejecutar comando: ' + (err.response?.data?.message || err.message));
        }
    };

    const handleFileSelected = async (file) => {
        if (!file) return;

        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/') || file.name.match(/\.(mp4|webm|mov|mkv)$/i);

        if (!isImage && !isVideo) {
            setMessage('❌ Por favor selecciona un archivo de video o imagen.');
            return;
        }

        const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        setTempTitle(cleanTitle);
        setTempType(isImage ? 'image' : 'video');
        setIsUploading(true);

        const formData = new FormData();
        formData.append('mediaFile', file);
        formData.append('title', cleanTitle);

        try {
            const res = await axios.post(`${API_URL}/api/tv-content/upload`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (res.data.success && res.data.content) {
                setTempUrl(res.data.content.source_url);
                setMessage(`✅ Archivo "${file.name}" cargado. Listo para emitir.`);
            }
        } catch (err) {
            setMessage('❌ Error al subir archivo: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsUploading(false);
        }
    };

    const handleSendTemporary = async (e) => {
        e.preventDefault();
        if (!tempUrl) {
            setMessage('❌ Ingresa la URL o sube un archivo para el contenido temporal.');
            return;
        }

        try {
            const res = await axios.post(`${API_URL}/api/admin/temporary-content`, {
                target: uuid,
                content: {
                    title: tempTitle,
                    content_type: tempType,
                    source_url: tempUrl,
                    loop: true,
                    muted: false
                }
            });
            if (res.data.success) {
                setIsTempActive(true);
                setMessage(`🚀 Transmisión temporal iniciada en ${screen.name}. Playlist pausada.`);
                setTimeout(() => setMessage(''), 4000);
            }
        } catch (err) {
            setMessage('❌ Error emitiendo temporal: ' + (err.response?.data?.message || err.message));
        }
    };

    const handleClearTemporary = async () => {
        try {
            const res = await axios.post(`${API_URL}/api/admin/clear-temporary`, { target: uuid });
            if (res.data.success) {
                setIsTempActive(false);
                setMessage(`⏹️ Transmisión temporal detenida. Playlist reanudada.`);
                setTimeout(() => setMessage(''), 4000);
            }
        } catch (err) {
            setMessage('❌ Error deteniendo temporal: ' + (err.response?.data?.message || err.message));
        }
    };

    const handleSaveConfig = async (e) => {
        e.preventDefault();
        try {
            await axios.put(`${API_URL}/api/admin/screens/${uuid}`, {
                name,
                location,
                playlist_id: selectedPlaylist ? parseInt(selectedPlaylist, 10) : null
            });
            setMessage('✅ Configuración de pantalla actualizada exitosamente.');
            setTimeout(() => setMessage(''), 3500);
        } catch (err) {
            setMessage('❌ Error al guardar: ' + (err.response?.data?.message || err.message));
        }
    };

    if (!screen) {
        return <div className="admin-section"><p>Cargando consola de control...</p></div>;
    }

    return (
        <div className="admin-section">
            <div style={{ marginBottom: '20px' }}>
                <Link to="/admin" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 600 }}>
                    ← Volver a Pantallas
                </Link>
            </div>

            <h2>Consola Remota: {screen.name}</h2>
            <p style={{ color: 'var(--text-secondary)' }}>UUID: <code>{uuid}</code></p>

            {message && (
                <div style={{ padding: '12px 16px', background: 'var(--status-online-bg)', color: 'var(--status-online-text)', borderRadius: '12px', marginBottom: '20px' }}>
                    {message}
                </div>
            )}

            <div className="tv-control-panel">
                {/* Panel de Comandos Remotos en Vivo */}
                <div className="panel-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0 }}>🎮 Control en Tiempo Real</h3>
                        {tvAudioStatus && (
                            <span style={{
                                padding: '4px 12px',
                                borderRadius: '12px',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                background: tvAudioStatus.isUnlocked ? 'rgba(52, 199, 89, 0.15)' : 'rgba(255, 149, 0, 0.15)',
                                color: tvAudioStatus.isUnlocked ? '#34c759' : '#ff9500',
                                border: tvAudioStatus.isUnlocked ? '1px solid rgba(52, 199, 89, 0.3)' : '1px solid rgba(255, 149, 0, 0.3)'
                            }}>
                                {tvAudioStatus.isUnlocked ? `🔊 Audio Activo (${tvAudioStatus.volume || volume}%)` : '🔇 Silenciado en Pantalla'}
                            </span>
                        )}
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '8px' }}>
                        Envía comandos inmediatos mediante WebSockets sin recargar el navegador de la TV.
                    </p>

                    <div className="button-group mt-4" style={{ flexWrap: 'wrap' }}>
                        <button className="btn-play" onClick={() => sendCommand('resume')}>
                            ▶️ Reanudar
                        </button>
                        <button className="btn-pause" onClick={() => sendCommand('pause')}>
                            ⏸️ Pausar
                        </button>
                        <button className="btn-secondary" onClick={() => sendCommand('skip')}>
                            ⏭️ Saltar Contenido
                        </button>
                        <button className="btn-primary" onClick={() => sendCommand('reload')}>
                            🔄 Recargar Pantalla
                        </button>
                        <button className="btn-secondary" onClick={() => sendCommand('unmute')}>
                            🔊 Activar Sonido
                        </button>
                        <button className="btn-secondary" onClick={() => sendCommand('mute')}>
                            🔇 Silenciar
                        </button>
                        <button className="btn-secondary" onClick={() => sendCommand('chime')} title="Reproduce un tono sintetizado en los altavoces de la TV">
                            🔔 Probar Campanilla
                        </button>
                    </div>

                    <div className="config-form mt-4">
                        <label>Volumen Remoto: {volume}%</label>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={volume}
                            onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                setVolume(val);
                                sendCommand('set_volume', { volume: val / 100 });
                            }}
                        />
                    </div>

                    {/* Nota técnica sobre Política de Autoplay de Navegadores */}
                    <div style={{ marginTop: '20px', padding: '12px 14px', background: 'rgba(0, 113, 227, 0.08)', borderRadius: '12px', border: '1px solid rgba(0, 113, 227, 0.2)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                        <strong style={{ color: 'var(--accent-blue)' }}>💡 Nota sobre el sonido en Smart TVs:</strong>
                        <p style={{ margin: '4px 0 0' }}>
                            Por seguridad, los navegadores (Chrome/Edge/Tizen) bloquean el audio si la TV no tuvo al menos un toque o tecla previa, o si no corre en <strong>Modo Kiosk</strong> con <code>--autoplay-policy=no-user-gesture-required</code>. Una vez desbloqueado, el sonido se mantiene activo de forma permanente.
                        </p>
                    </div>
                </div>

                {/* Panel de Emisión Temporal Específica */}
                <div className="panel-card" style={{ border: isTempActive ? '1.5px solid #ff3b30' : undefined }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3>🚨 Contenido Temporal en Vivo</h3>
                        {isTempActive && (
                            <span style={{ background: '#ff3b30', color: '#fff', padding: '4px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700 }}>
                                ACTIVO
                            </span>
                        )}
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        Envía un video o contenido prioritario exclusivo a esta TV deteniendo su playlist.
                    </p>

                    <form className="config-form mt-2" onSubmit={handleSendTemporary}>
                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            accept="video/*,image/*"
                            onChange={(e) => handleFileSelected(e.target.files[0])}
                        />

                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                            <button
                                type="button"
                                className="btn-secondary"
                                style={{ flex: 1, padding: '8px 12px', fontSize: '0.85rem' }}
                                disabled={isUploading}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {isUploading ? '⏳ Subiendo...' : '📁 Subir Archivo Local (Video/Imagen)'}
                            </button>
                        </div>

                        <label>Título</label>
                        <input
                            type="text"
                            value={tempTitle}
                            onChange={(e) => setTempTitle(e.target.value)}
                            required
                        />

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }} className="mt-2">
                            <div>
                                <label>Tipo</label>
                                <select value={tempType} onChange={(e) => setTempType(e.target.value)}>
                                    <option value="video">Video</option>
                                    <option value="image">Imagen</option>
                                    <option value="youtube">YouTube</option>
                                    <option value="power_bi">PowerBI / Web</option>
                                </select>
                            </div>
                            <div>
                                <label>URL o Archivo</label>
                                <input
                                    type="text"
                                    value={tempUrl}
                                    placeholder="ej. /media/video.mp4"
                                    onChange={(e) => setTempUrl(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                            <button
                                type="submit"
                                disabled={isUploading}
                                style={{
                                    flex: 1,
                                    padding: '12px',
                                    borderRadius: '10px',
                                    background: '#ff3b30',
                                    color: '#fff',
                                    fontWeight: 700,
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                🚨 Emitir Temporal
                            </button>
                            <button
                                type="button"
                                onClick={handleClearTemporary}
                                style={{
                                    padding: '12px 18px',
                                    borderRadius: '10px',
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    color: '#fff',
                                    fontWeight: 600,
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                ⏹️ Quitar y Reanudar
                            </button>
                        </div>
                    </form>
                </div>

                {/* Panel de Configuración & Playlist */}
                <div className="panel-card" style={{ gridColumn: 'span 2' }}>
                    <h3>⚙️ Configuración & Asignación</h3>
                    <form className="config-form" onSubmit={handleSaveConfig}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <div>
                                <label>Nombre de la Pantalla</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <label>Ubicación / Zona</label>
                                <input
                                    type="text"
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                />
                            </div>
                        </div>

                        <label className="mt-2">Playlist Asignada</label>
                        <select
                            value={selectedPlaylist}
                            onChange={(e) => setSelectedPlaylist(e.target.value)}
                        >
                            <option value="">-- Sin Playlist (Estado Espera) --</option>
                            {playlists.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name} ({p.item_count || 0} contenidos)
                                </option>
                            ))}
                        </select>

                        <button type="submit" className="btn-primary mt-4" style={{ width: '100%' }}>
                            💾 Guardar Cambios
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
