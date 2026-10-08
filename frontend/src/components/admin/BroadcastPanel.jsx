import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { API_URL } from '../Admin';

export default function BroadcastPanel() {
    const [screens, setScreens] = useState([]);
    const [contentList, setContentList] = useState([]);
    const [activeState, setActiveState] = useState({ global: null, byScreen: {} });

    // Modo de selección de origen: 'upload' | 'library' | 'external'
    const [sourceMode, setSourceMode] = useState('upload');

    // Configuración del Broadcast
    const [target, setTarget] = useState('all');
    const [title, setTitle] = useState('');
    const [contentType, setContentType] = useState('video');
    const [sourceUrl, setSourceUrl] = useState('');
    const [selectedLibraryId, setSelectedLibraryId] = useState('');
    const [durationSeconds, setDurationSeconds] = useState(0);
    const [loop, setLoop] = useState(true);
    const [unmuteAudio, setUnmuteAudio] = useState(true);

    // Estado Drag & Drop / Subida Local
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadedFileInfo, setUploadedFileInfo] = useState(null);
    const fileInputRef = useRef(null);

    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);

    // Cargar pantallas, librería y transmisiones activas
    const loadData = async () => {
        try {
            const [screensRes, contentRes, activeRes] = await Promise.all([
                axios.get(`${API_URL}/api/admin/screens`).catch(() => ({ data: { success: false, screens: [] } })),
                axios.get(`${API_URL}/api/tv-content`).catch(() => 
                    axios.get(`${API_URL}/api/admin/content`).catch(() => ({ data: { success: false, content: [] } }))
                ),
                axios.get(`${API_URL}/api/admin/active-temporary`).catch(() => ({ data: { success: false, state: { global: null, byScreen: {} } } }))
            ]);

            if (screensRes.data?.success) {
                setScreens(screensRes.data.screens || []);
            }
            if (contentRes.data?.success) {
                setContentList(contentRes.data.content || []);
            }
            if (activeRes.data?.success) {
                setActiveState(activeRes.data.state || { global: null, byScreen: {} });
            }
        } catch (err) {
            console.error('Error cargando datos de broadcast:', err);
        }
    };

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 5000);
        return () => clearInterval(interval);
    }, []);

    // Manejo de archivo arrastrado o seleccionado desde el explorador
    const handleFileSelected = async (file) => {
        if (!file) return;

        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/') || file.name.match(/\.(mp4|webm|mov|mkv)$/i);

        if (!isImage && !isVideo) {
            setMessage('❌ Por favor selecciona un archivo de video (MP4, WebM) o imagen (JPG, PNG).');
            return;
        }

        const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        setTitle(cleanTitle);
        setContentType(isImage ? 'image' : 'video');

        // Subir archivo al backend
        const formData = new FormData();
        formData.append('mediaFile', file);
        formData.append('title', cleanTitle);
        formData.append('duration_seconds', isImage ? 15 : 0);

        setIsUploading(true);
        setUploadProgress(0);
        setMessage('');

        try {
            const res = await axios.post(`${API_URL}/api/tv-content/upload`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (progressEvent) => {
                    const total = progressEvent.total || file.size;
                    const percent = Math.round((progressEvent.loaded * 100) / total);
                    setUploadProgress(percent);
                }
            });

            if (res.data.success && res.data.content) {
                const c = res.data.content;
                setSourceUrl(c.source_url);
                setContentType(c.content_type);
                if (c.duration_seconds) setDurationSeconds(c.duration_seconds);
                setUploadedFileInfo({
                    name: file.name,
                    size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
                    url: c.source_url,
                    type: c.content_type
                });
                setMessage(`✅ Archivo listo para emitir: "${file.name}"`);
                loadData();
            }
        } catch (err) {
            console.error('Error subiendo archivo:', err);
            setMessage('❌ Error al subir archivo: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsUploading(false);
        }
    };

    // Al seleccionar contenido preexistente de la biblioteca
    const handleSelectLibraryItem = (e) => {
        const id = e.target.value;
        setSelectedLibraryId(id);
        if (!id) return;

        const found = contentList.find((c) => String(c.id) === String(id));
        if (found) {
            setTitle(found.title || 'Transmisión en Vivo');
            setContentType(found.content_type || 'video');
            setSourceUrl(found.source_url || '');
            if (found.duration_seconds) {
                setDurationSeconds(found.duration_seconds);
            }
        }
    };

    // Emitir Contenido Temporal (Override)
    const handleBroadcast = async (e) => {
        if (e) e.preventDefault();
        if (!sourceUrl) {
            setMessage('❌ Especifica la URL del contenido, sube un archivo o selecciona un elemento de la biblioteca.');
            return;
        }

        setLoading(true);
        try {
            const res = await axios.post(`${API_URL}/api/admin/temporary-content`, {
                target,
                content: {
                    title: title || 'Transmisión en Vivo',
                    content_type: contentType,
                    source_url: sourceUrl,
                    duration_seconds: parseInt(durationSeconds, 10) || 0,
                    loop,
                    muted: !unmuteAudio
                }
            });

            if (res.data.success) {
                setMessage(`🚀 ${res.data.message}`);
                loadData();
                setTimeout(() => setMessage(''), 4000);
            }
        } catch (err) {
            setMessage('❌ Error al emitir broadcast: ' + (err.response?.data?.message || err.message));
        } finally {
            setLoading(false);
        }
    };

    // Detener Override y Reanudar Playlist
    const handleClearTemporary = async (targetToClear = 'all') => {
        try {
            const res = await axios.post(`${API_URL}/api/admin/clear-temporary`, { target: targetToClear });
            if (res.data.success) {
                setActiveState({ global: null, byScreen: {} });
                setMessage(`⏹️ ${res.data.message}`);
                loadData();
                setTimeout(() => setMessage(''), 4000);
            }
        } catch (err) {
            setMessage('❌ Error al detener broadcast: ' + (err.response?.data?.message || err.message));
        }
    };

    // Comandos de Control en Tiempo Real
    const handleControlAction = async (action, payload = {}) => {
        try {
            const res = await axios.post(`${API_URL}/api/admin/temporary-control`, {
                target,
                action,
                payload
            });
            if (res.data.success) {
                setMessage(`🎮 Acción '${action}' enviada a las pantallas.`);
                setTimeout(() => setMessage(''), 3000);
            }
        } catch (err) {
            setMessage('❌ Error al enviar comando: ' + (err.response?.data?.message || err.message));
        }
    };

    const hasGlobalActive = !!activeState.global;
    const activeScreensList = Object.entries(activeState.byScreen || {});

    return (
        <div className="admin-section">
            <h2>📡 Broadcast & Contenido Temporal en Vivo</h2>
            <p style={{ color: 'var(--text-secondary)' }}>
                Envía transmisiones prioritarias instantáneas a una o a todas las pantallas a la vez. La playlist programada se suspende de inmediato y se reanuda una vez finalizado el broadcast.
            </p>

            {message && (
                <div style={{
                    padding: '14px 20px',
                    background: message.includes('❌') ? 'rgba(255, 59, 48, 0.15)' : 'var(--status-online-bg)',
                    color: message.includes('❌') ? '#ff3b30' : 'var(--status-online-text)',
                    borderRadius: '12px',
                    marginBottom: '20px',
                    fontWeight: 500
                }}>
                    {message}
                </div>
            )}

            {/* Monitor de Transmisiones Activas */}
            {(hasGlobalActive || activeScreensList.length > 0) && (
                <div style={{
                    background: 'rgba(255, 59, 48, 0.12)',
                    border: '1.5px solid rgba(255, 59, 48, 0.4)',
                    borderRadius: '16px',
                    padding: '20px 24px',
                    marginBottom: '28px',
                    backdropFilter: 'blur(12px)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#ff3b30', fontWeight: 700, fontSize: '1.1rem' }}>
                                <span className="tv-dot-online" style={{ backgroundColor: '#ff3b30', boxShadow: '0 0 10px #ff3b30' }} />
                                <span>TRANSMISIÓN EN VIVO ACTIVA (OVERRIDE)</span>
                            </div>
                            <p style={{ margin: '6px 0 0', color: '#ffffff', fontSize: '0.95rem' }}>
                                {hasGlobalActive ? (
                                    <>🌐 <strong>Todas las Pantallas</strong>: {activeState.global.title} ({activeState.global.content_type})</>
                                ) : (
                                    <>Pantallas específicas en transmisión: {activeScreensList.length} pantalla(s)</>
                                )}
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <button className="btn-secondary" onClick={() => handleControlAction('pause')} title="Pausar video">
                                ⏸️ Pausar
                            </button>
                            <button className="btn-secondary" onClick={() => handleControlAction('play')} title="Reanudar video">
                                ▶️ Reanudar
                            </button>
                            <button className="btn-secondary" onClick={() => handleControlAction('unmute')} title="Activar sonido">
                                🔊 Sonido
                            </button>
                            <button className="btn-secondary" onClick={() => handleControlAction('mute')} title="Silenciar">
                                🔇 Mute
                            </button>
                            <button
                                style={{
                                    background: '#ff3b30',
                                    color: '#fff',
                                    border: 'none',
                                    padding: '10px 18px',
                                    borderRadius: '10px',
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                }}
                                onClick={() => handleClearTemporary('all')}
                            >
                                ⏹️ Finalizar Broadcast & Reanudar Playlist
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="tv-control-panel">
                {/* Formulario de Lanzamiento de Broadcast */}
                <div className="panel-card">
                    <h3>🚀 Configurar y Emitir Broadcast</h3>

                    {/* Selector de Pestaña de Origen */}
                    <div className="tab-selector mt-2">
                        <button
                            type="button"
                            className={`tab-btn ${sourceMode === 'upload' ? 'active' : ''}`}
                            onClick={() => setSourceMode('upload')}
                        >
                            📤 Arrastrar / Seleccionar Archivo
                        </button>
                        <button
                            type="button"
                            className={`tab-btn ${sourceMode === 'library' ? 'active' : ''}`}
                            onClick={() => setSourceMode('library')}
                        >
                            📂 De la Biblioteca
                        </button>
                        <button
                            type="button"
                            className={`tab-btn ${sourceMode === 'external' ? 'active' : ''}`}
                            onClick={() => setSourceMode('external')}
                        >
                            🌐 URL Externa (YouTube/Web)
                        </button>
                    </div>

                    <form className="config-form" onSubmit={handleBroadcast}>
                        <label>Destino de la Transmisión</label>
                        <select value={target} onChange={(e) => setTarget(e.target.value)}>
                            <option value="all">🌐 Todas las Pantallas (Broadcast Global)</option>
                            <optgroup label="Pantallas Específicas">
                                {screens.map((s) => (
                                    <option key={s.id} value={s.tv_uuid}>
                                        {s.name} ({s.location || 'Sala'}) — {s.is_online ? '🟢 Online' : '⚪ Offline'}
                                    </option>
                                ))}
                            </optgroup>
                        </select>

                        {/* ─────────────────────────────────────────────────────────
                            OPCIÓN 1: Drag & Drop / Selector de Archivo Local
                           ───────────────────────────────────────────────────────── */}
                        {sourceMode === 'upload' && (
                            <div className="mt-2">
                                <label>Cargar Archivo Multimedia (Video o Imagen)</label>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    style={{ display: 'none' }}
                                    accept="video/*,image/*"
                                    onChange={(e) => handleFileSelected(e.target.files[0])}
                                />

                                <div
                                    className={`dropzone-container ${isDragging ? 'dragging' : ''}`}
                                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                    onDragLeave={() => setIsDragging(false)}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        setIsDragging(false);
                                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                            handleFileSelected(e.dataTransfer.files[0]);
                                        }
                                    }}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <div className="dropzone-icon">
                                        {isUploading ? '⏳' : isDragging ? '📥' : '📁'}
                                    </div>
                                    <div className="dropzone-title">
                                        {isUploading
                                            ? `Subiendo archivo... ${uploadProgress}%`
                                            : 'Arrastra y suelta tu video o imagen aquí'}
                                    </div>
                                    <div className="dropzone-subtitle">
                                        {isUploading
                                            ? 'Extrayendo metadatos y duración automáticamente...'
                                            : 'o haz clic aquí para seleccionar desde tu computadora (MP4, WebM, JPG, PNG — hasta 300MB)'}
                                    </div>
                                </div>

                                {uploadedFileInfo && (
                                    <div className="file-uploaded-preview">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ fontSize: '1.4rem' }}>
                                                {uploadedFileInfo.type === 'video' ? '🎬' : '🖼️'}
                                            </span>
                                            <div>
                                                <div style={{ fontWeight: 600, color: '#34c759' }}>
                                                    {uploadedFileInfo.name}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                    {uploadedFileInfo.size} • Ruta: <code>{uploadedFileInfo.url}</code>
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn-secondary"
                                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            Cambiar
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ─────────────────────────────────────────────────────────
                            OPCIÓN 2: Selección desde la Biblioteca
                           ───────────────────────────────────────────────────────── */}
                        {sourceMode === 'library' && (
                            <div className="mt-2">
                                <label>Seleccionar de la Biblioteca Multimedia</label>
                                <select value={selectedLibraryId} onChange={handleSelectLibraryItem}>
                                    <option value="">-- Selecciona un medio --</option>
                                    {contentList.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            [{c.content_type?.toUpperCase()}] {c.title} ({c.duration_seconds ? `${c.duration_seconds}s` : 'Sin límite'})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* ─────────────────────────────────────────────────────────
                            OPCIÓN 3: URL Externa (YouTube, PowerBI, Web)
                           ───────────────────────────────────────────────────────── */}
                        {sourceMode === 'external' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }} className="mt-2">
                                <div>
                                    <label>Tipo de Contenido</label>
                                    <select value={contentType} onChange={(e) => setContentType(e.target.value)}>
                                        <option value="youtube">📺 YouTube</option>
                                        <option value="power_bi">📊 Power BI / Web</option>
                                        <option value="video">🎬 Video (URL Directa)</option>
                                        <option value="image">🖼️ Imagen (URL Directa)</option>
                                    </select>
                                </div>
                                <div>
                                    <label>URL del Recurso</label>
                                    <input
                                        type="text"
                                        value={sourceUrl}
                                        onChange={(e) => setSourceUrl(e.target.value)}
                                        placeholder="https://youtube.com/watch?v=... o https://app.powerbi.com/..."
                                        required={sourceMode === 'external'}
                                    />
                                </div>
                            </div>
                        )}

                        <label className="mt-2">Título de la Transmisión</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="ej. Comunicado de Dirección General"
                            required
                        />

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }} className="mt-2">
                            <div>
                                <label>Duración en Segundos (0 = Manual)</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={durationSeconds}
                                    onChange={(e) => setDurationSeconds(e.target.value)}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px', paddingTop: '16px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                                    <input
                                        type="checkbox"
                                        checked={loop}
                                        onChange={(e) => setLoop(e.target.checked)}
                                    />
                                    <span>🔄 Repetir en bucle continuo</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                                    <input
                                        type="checkbox"
                                        checked={unmuteAudio}
                                        onChange={(e) => setUnmuteAudio(e.target.checked)}
                                    />
                                    <span>🔊 Habilitar audio / sonido</span>
                                </label>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading || isUploading}
                            className="btn-primary mt-4"
                            style={{
                                width: '100%',
                                padding: '16px',
                                fontSize: '1.15rem',
                                background: 'linear-gradient(135deg, #ff3b30 0%, #ff9500 100%)',
                                fontWeight: 700,
                                boxShadow: '0 8px 24px rgba(255, 59, 48, 0.35)'
                            }}
                        >
                            {loading ? 'Emitiendo...' : '🚨 EMITIR BROADCAST AHORA (OVERRIDE)'}
                        </button>
                    </form>
                </div>

                {/* Guía Rápida de Operación */}
                <div className="panel-card">
                    <h3>💡 Cómo Funciona el Broadcast Temporal</h3>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.6' }}>
                        <p>
                            1. <strong>Carga Rápida Directa</strong>: Puedes arrastrar directamente cualquier archivo de video o imagen sin tener que ir previamente a la biblioteca. El sistema lo procesa y prepara al instante.
                        </p>
                        <p>
                            2. <strong>Interrupción en Tiempo Real</strong>: Al pulsar <em>Emitir Broadcast</em>, la Smart TV congela o suspende la playlist habitual y carga el temporal a pantalla completa.
                        </p>
                        <p>
                            3. <strong>Bucle Continuo y Sonido</strong>: El reproductor no se detiene al acabar el video (hace replay automático a 0s) y desbloquea el sonido nativo.
                        </p>
                        <p>
                            4. <strong>Retorno Automático</strong>: Cuando decidas finalizar el broadcast desde el botón superior o expire su duración, la pantalla vuelve a su playlist sin necesidad de refrescar ni reiniciar el televisor.
                        </p>
                    </div>

                    <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px' }}>
                        <div style={{ fontWeight: 600, color: '#fff', marginBottom: '8px' }}>
                            📺 Estado Actual de la Red
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                            <span>Pantallas Registradas:</span>
                            <strong>{screens.length}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginTop: '4px' }}>
                            <span>Pantallas Online:</span>
                            <strong style={{ color: '#34c759' }}>{screens.filter((s) => s.is_online).length}</strong>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
