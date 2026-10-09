import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../Admin';
import { showToast, showConfirmation } from '../Toast';

export default function ContentManager() {
    const [activeTab, setActiveTab] = useState('library'); // 'library' | 'upload' | 'external' | 'playlists'
    const [contentList, setContentList] = useState([]);
    const [playlists, setPlaylists] = useState([]);
    const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
    const [playlistDetails, setPlaylistDetails] = useState(null);

    // Form Subida Local
    const [fileToUpload, setFileToUpload] = useState(null);
    const [uploadTitle, setUploadTitle] = useState('');
    const [uploadDuration, setUploadDuration] = useState(15);
    const [isUploading, setIsUploading] = useState(false);

    // Form URL Externa
    const [extTitle, setExtTitle] = useState('');
    const [extUrl, setExtUrl] = useState('');
    const [extType, setExtType] = useState('power_bi');
    const [extDuration, setExtDuration] = useState(60);

    // Form Nueva Playlist
    const [newPlaylistName, setNewPlaylistName] = useState('');

    // Form Agregar Contenido a Playlist
    const [addItemContentId, setAddItemContentId] = useState('');
    const [addStartTime, setAddStartTime] = useState('06:00');
    const [addEndTime, setAddEndTime] = useState('22:00');
    const [isAlwaysOn, setIsAlwaysOn] = useState(false);
    const [selectedDays, setSelectedDays] = useState(['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']);
    const [editPlaylistName, setEditPlaylistName] = useState('');

    const [message, setMessage] = useState('');

    // Cargar Biblioteca y Playlists
    const loadData = async () => {
        try {
            const [contentRes, playlistsRes] = await Promise.all([
                axios.get(`${API_URL}/api/tv-content`),
                axios.get(`${API_URL}/api/admin/playlists`)
            ]);

            if (contentRes.data.success) setContentList(contentRes.data.content);
            if (playlistsRes.data.success) {
                setPlaylists(playlistsRes.data.playlists);
                if (!selectedPlaylistId && playlistsRes.data.playlists.length > 0) {
                    setSelectedPlaylistId(playlistsRes.data.playlists[0].id);
                }
            }
        } catch (err) {
            console.error('Error cargando contenidos:', err);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    // Cargar detalles de playlist seleccionada
    useEffect(() => {
        if (!selectedPlaylistId) return;
        axios.get(`${API_URL}/api/admin/playlists/${selectedPlaylistId}`)
            .then((res) => {
                if (res.data.success) {
                    setPlaylistDetails(res.data);
                    setEditPlaylistName(res.data.playlist.name);
                }
            })
            .catch((err) => console.error('Error cargando playlist:', err));
    }, [selectedPlaylistId]);

    // Subir Archivo
    const handleUploadSubmit = async (e) => {
        e.preventDefault();
        if (!fileToUpload) return showToast('Por favor selecciona un archivo.', 'warning');

        setIsUploading(true);
        const formData = new FormData();
        formData.append('mediaFile', fileToUpload);
        formData.append('title', uploadTitle || fileToUpload.name);
        formData.append('duration_seconds', uploadDuration);

        try {
            const res = await axios.post(`${API_URL}/api/tv-content/upload`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (res.data.success) {
                setMessage('Archivo subido exitosamente a la biblioteca.');
                setFileToUpload(null);
                setUploadTitle('');
                loadData();
                setActiveTab('library');
            }
        } catch (err) {
            setMessage('Error al subir: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsUploading(false);
            setTimeout(() => setMessage(''), 3500);
        }
    };

    // Registrar Externa
    const handleExternalSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post(`${API_URL}/api/tv-content/external`, {
                title: extTitle,
                source_url: extUrl,
                content_type: extType,
                duration_seconds: parseInt(extDuration, 10)
            });
            if (res.data.success) {
                setMessage('Contenido externo registrado exitosamente.');
                setExtTitle('');
                setExtUrl('');
                loadData();
                setActiveTab('library');
            }
        } catch (err) {
            setMessage('Error al registrar: ' + (err.response?.data?.message || err.message));
        } finally {
            setTimeout(() => setMessage(''), 3500);
        }
    };

    // Eliminar Contenido
    const handleDeleteContent = (id, url) => {
        showConfirmation({
            title: 'Eliminar Contenido',
            message: '¿Seguro de eliminar este contenido? Se desvinculará de las playlists.',
            confirmText: 'Eliminar',
            onAccept: async () => {
                try {
                    await axios.post(`${API_URL}/api/tv-content/delete`, { content_id: id, fileUrl: url });
                    setMessage('Contenido eliminado.');
                    showToast('Contenido eliminado exitosamente.', 'success');
                    loadData();
                } catch (err) {
                    const errMsg = 'Error al eliminar: ' + (err.response?.data?.message || err.message);
                    setMessage(errMsg);
                    showToast(errMsg, 'error');
                } finally {
                    setTimeout(() => setMessage(''), 3500);
                }
            }
        });
    };

    // Crear Playlist
    const handleCreatePlaylist = async (e) => {
        e.preventDefault();
        if (!newPlaylistName) return;
        try {
            const res = await axios.post(`${API_URL}/api/admin/playlists`, { name: newPlaylistName });
            if (res.data.success) {
                setMessage(`Playlist '${newPlaylistName}' creada.`);
                setSelectedPlaylistId(res.data.playlist.id);
                setEditPlaylistName(res.data.playlist.name);
                setNewPlaylistName('');
                loadData();
            }
        } catch (err) {
            setMessage('Error al crear playlist: ' + (err.response?.data?.message || err.message));
        }
    };

    // Asignar Contenido a Playlist
    const handleAddContentToPlaylist = async (e) => {
        e.preventDefault();
        if (!selectedPlaylistId || !addItemContentId) return;
        if (selectedDays.length === 0) return showToast('Selecciona al menos un día de emisión.', 'warning');

        try {
            await axios.post(`${API_URL}/api/admin/playlists/${selectedPlaylistId}/items`, {
                content_id: parseInt(addItemContentId, 10),
                start_time: isAlwaysOn ? null : addStartTime,
                end_time: isAlwaysOn ? null : addEndTime,
                days_of_week: selectedDays
            });
            setMessage('Contenido asignado a la playlist.');
            // Recargar detalles
            const res = await axios.get(`${API_URL}/api/admin/playlists/${selectedPlaylistId}`);
            if (res.data.success) setPlaylistDetails(res.data);
        } catch (err) {
            setMessage('Error al programar: ' + (err.response?.data?.message || err.message));
        } finally {
            setTimeout(() => setMessage(''), 3500);
        }
    };

    // Quitar Contenido de Playlist
    const handleRemoveFromPlaylist = async (contentId) => {
        try {
            await axios.delete(`${API_URL}/api/admin/playlists/${selectedPlaylistId}/items/${contentId}`);
            const res = await axios.get(`${API_URL}/api/admin/playlists/${selectedPlaylistId}`);
            if (res.data.success) setPlaylistDetails(res.data);
        } catch (err) {
            setMessage('Error al retirar contenido: ' + (err.response?.data?.message || err.message));
        }
    };

    const handleRenamePlaylist = async (e) => {
        e.preventDefault();
        try {
            await axios.put(`${API_URL}/api/admin/playlists/${selectedPlaylistId}`, { name: editPlaylistName });
            showToast('Nombre de playlist actualizado.', 'success');
            await loadData();
            const res = await axios.get(`${API_URL}/api/admin/playlists/${selectedPlaylistId}`);
            if (res.data.success) setPlaylistDetails(res.data);
        } catch (err) {
            showToast('Error al renombrar: ' + (err.response?.data?.message || err.message), 'error');
        }
    };

    const handleDeletePlaylist = () => showConfirmation({
        title: 'Eliminar playlist',
        message: `¿Eliminar ${playlistDetails?.playlist?.name || 'esta playlist'} y sus programaciones?`,
        confirmText: 'Eliminar',
        onAccept: async () => {
            try {
                await axios.delete(`${API_URL}/api/admin/playlists/${selectedPlaylistId}`);
                setPlaylistDetails(null);
                setSelectedPlaylistId('');
                await loadData();
                showToast('Playlist eliminada.', 'success');
            } catch (err) {
                showToast('Error al eliminar: ' + (err.response?.data?.message || err.message), 'error');
            }
        }
    });

    const handleReorderPlaylist = async (index, offset) => {
        const items = [...(playlistDetails?.items || [])];
        const destination = index + offset;
        if (destination < 0 || destination >= items.length) return;
        [items[index], items[destination]] = [items[destination], items[index]];
        try {
            await axios.put(`${API_URL}/api/admin/playlists/${selectedPlaylistId}/items/order`, {
                items: items.map((item) => ({ id: item.id }))
            });
            const res = await axios.get(`${API_URL}/api/admin/playlists/${selectedPlaylistId}`);
            if (res.data.success) setPlaylistDetails(res.data);
        } catch (err) {
            showToast('Error al cambiar el orden: ' + (err.response?.data?.message || err.message), 'error');
        }
    };

    return (
        <div className="admin-section">
            <h2>Biblioteca de Contenidos & Playlists</h2>
            <p style={{ color: 'var(--text-secondary)' }}>
                Gestiona los activos multimedia (videos, imágenes, dashboards Power BI, URLs) y programa las listas de reproducción.
            </p>

            {message && (
                <div style={{ padding: '12px 16px', background: 'var(--status-online-bg)', color: 'var(--status-online-text)', borderRadius: '12px', marginBottom: '20px' }}>
                    {message}
                </div>
            )}

            {/* Selector de Pestañas */}
            <div className="content-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
                <button
                    className={activeTab === 'library' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setActiveTab('library')}
                >
                    📂 Biblioteca de Medios ({contentList.length})
                </button>
                <button
                    className={activeTab === 'upload' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setActiveTab('upload')}
                >
                    ⬆️ Subir Archivo Local
                </button>
                <button
                    className={activeTab === 'external' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setActiveTab('external')}
                >
                    🌐 Registrar Power BI / URL
                </button>
                <button
                    className={activeTab === 'playlists' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setActiveTab('playlists')}
                >
                    📑 Gestor de Playlists ({playlists.length})
                </button>
            </div>

            {/* Pestaña 1: Biblioteca */}
            {activeTab === 'library' && (
                <div className="panel-card" style={{ padding: '0', overflow: 'hidden' }}>
                    <table className="nexus-table">
                        <thead>
                            <tr>
                                <th>Título</th>
                                <th>Tipo</th>
                                <th>Origen</th>
                                <th>Duración</th>
                                <th>Acción</th>
                            </tr>
                        </thead>
                        <tbody>
                            {contentList.map((item) => (
                                <tr key={item.id}>
                                    <td><strong>{item.title}</strong></td>
                                    <td>
                                        <span className="badge" style={{ background: item.content_type === 'video' ? '#0071e3' : item.content_type === 'power_bi' ? '#f59e0b' : '#10b981', color: '#fff' }}>
                                            {item.content_type}
                                        </span>
                                    </td>
                                    <td><code style={{ fontSize: '0.8rem' }}>{item.source_type}</code></td>
                                    <td>{item.duration_seconds ? `${item.duration_seconds}s` : 'Auto'}</td>
                                    <td>
                                        <button className="btn-danger" onClick={() => handleDeleteContent(item.id, item.source_url)}>
                                            🗑️ Eliminar
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Pestaña 2: Subir Archivo */}
            {activeTab === 'upload' && (
                <div className="panel-card" style={{ maxWidth: '600px' }}>
                    <h3>⬆️ Subir Video o Imagen</h3>
                    <form className="config-form" onSubmit={handleUploadSubmit}>
                        <label>Seleccionar Archivo (MP4, WebM, PNG, JPG — hasta 500MB)</label>
                        <input
                            type="file"
                            accept="video/*,image/*"
                            onChange={(e) => setFileToUpload(e.target.files[0])}
                            required
                        />

                        <label className="mt-2">Título Descriptivo</label>
                        <input
                            type="text"
                            placeholder="ej. Video Institucional Nexus 2026"
                            value={uploadTitle}
                            onChange={(e) => setUploadTitle(e.target.value)}
                        />

                        <label className="mt-2">Duración en Pantalla (Segundos - para imágenes)</label>
                        <input
                            type="number"
                            min="5"
                            max="3600"
                            value={uploadDuration}
                            onChange={(e) => setUploadDuration(e.target.value)}
                        />

                        <button type="submit" className="btn-primary mt-4" disabled={isUploading}>
                            {isUploading ? 'Subiendo...' : '🚀 Iniciar Subida'}
                        </button>
                    </form>
                </div>
            )}

            {/* Pestaña 3: URL Externa / Power BI */}
            {activeTab === 'external' && (
                <div className="panel-card" style={{ maxWidth: '600px' }}>
                    <h3>🌐 Registrar URL Externa (Power BI / YouTube / Web)</h3>
                    <form className="config-form" onSubmit={handleExternalSubmit}>
                        <label>Título del Contenido</label>
                        <input
                            type="text"
                            placeholder="ej. Tablero Power BI Operaciones"
                            value={extTitle}
                            onChange={(e) => setExtTitle(e.target.value)}
                            required
                        />

                        <label className="mt-2">URL del Dashboard o Video</label>
                        <input
                            type="url"
                            placeholder="https://app.powerbi.com/view?r=... o https://youtu.be/..."
                            value={extUrl}
                            onChange={(e) => setExtUrl(e.target.value)}
                            required
                        />

                        <label className="mt-2">Tipo de Contenido</label>
                        <select value={extType} onChange={(e) => setExtType(e.target.value)}>
                            <option value="power_bi">📊 Tablero Power BI</option>
                            <option value="url">🎬 YouTube / Web Iframe</option>
                            <option value="image">🖼️ Imagen Externa (URL)</option>
                            <option value="video">🎥 Video Externo (URL directa)</option>
                        </select>

                        <label className="mt-2">Duración en Rotación (Segundos)</label>
                        <input
                            type="number"
                            min="10"
                            max="7200"
                            value={extDuration}
                            onChange={(e) => setExtDuration(e.target.value)}
                        />

                        <button type="submit" className="btn-primary mt-4">
                            💾 Registrar Contenido
                        </button>
                    </form>
                </div>
            )}

            {/* Pestaña 4: Playlists & Horarios */}
            {activeTab === 'playlists' && (
                <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px' }}>
                        {/* Selector y Creación de Playlist */}
                        <div className="panel-card">
                            <h3>📑 Playlists Disponibles</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                                {playlists.map((p) => (
                                    <button
                                        key={p.id}
                                        style={{
                                            textAlign: 'left',
                                            padding: '12px 16px',
                                            borderRadius: '10px',
                                            border: p.id === parseInt(selectedPlaylistId, 10) ? '2px solid var(--accent-blue)' : '1px solid var(--border-card)',
                                            background: p.id === parseInt(selectedPlaylistId, 10) ? 'var(--status-online-bg)' : '#fff',
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                        onClick={() => setSelectedPlaylistId(p.id)}
                                    >
                                        {p.name}
                                    </button>
                                ))}
                            </div>

                            <h4>➕ Nueva Playlist</h4>
                            <form className="config-form" onSubmit={handleCreatePlaylist}>
                                <input
                                    type="text"
                                    placeholder="Nombre de Playlist"
                                    value={newPlaylistName}
                                    onChange={(e) => setNewPlaylistName(e.target.value)}
                                    required
                                />
                                <button type="submit" className="btn-secondary mt-2" style={{ width: '100%' }}>
                                    Crear Playlist
                                </button>
                            </form>
                            {playlistDetails?.playlist && (
                                <form className="config-form mt-4" onSubmit={handleRenamePlaylist}>
                                    <h4>Editar playlist</h4>
                                    <input value={editPlaylistName} onChange={(e) => setEditPlaylistName(e.target.value)} required />
                                    <button type="submit" className="btn-secondary mt-2">Guardar nombre</button>
                                    <button type="button" className="btn-danger mt-2" onClick={handleDeletePlaylist}>Eliminar playlist</button>
                                </form>
                            )}
                        </div>

                        {/* Programación de la Playlist Seleccionada */}
                        <div className="panel-card">
                            <h3>Contenido Programado: {playlistDetails?.playlist?.name || 'Selecciona una playlist'}</h3>

                            <form className="config-form mb-4" onSubmit={handleAddContentToPlaylist} style={{ background: 'var(--bg-subtle)', padding: '16px', borderRadius: '12px' }}>
                                <h4>➕ Programar Contenido en esta Playlist</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '10px', alignItems: 'flex-end' }}>
                                    <div>
                                        <label>Contenido</label>
                                        <select
                                            value={addItemContentId}
                                            onChange={(e) => setAddItemContentId(e.target.value)}
                                            required
                                        >
                                            <option value="">-- Elegir de la biblioteca --</option>
                                            {contentList.map((c) => (
                                                <option key={c.id} value={c.id}>{c.title} ({c.content_type})</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label>Inicio</label>
                                        <input
                                            type="time"
                                            value={addStartTime}
                                            onChange={(e) => setAddStartTime(e.target.value)}
                                            disabled={isAlwaysOn}
                                            required={!isAlwaysOn}
                                        />
                                    </div>
                                    <div>
                                        <label>Fin</label>
                                        <input
                                            type="time"
                                            value={addEndTime}
                                            onChange={(e) => setAddEndTime(e.target.value)}
                                            disabled={isAlwaysOn}
                                            required={!isAlwaysOn}
                                        />
                                    </div>
                                    <button type="submit" className="btn-primary" style={{ height: '42px' }}>
                                        ➕ Añadir
                                    </button>
                                </div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                                    <input type="checkbox" checked={isAlwaysOn} onChange={(e) => setIsAlwaysOn(e.target.checked)} />
                                    Continuo 24/7 (sin horario)
                                </label>
                                <fieldset style={{ border: '1px solid var(--border-card)', borderRadius: '8px', marginTop: '10px' }}>
                                    <legend>Días de emisión</legend>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                        {['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'].map((day) => (
                                            <label key={day} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <input type="checkbox" checked={selectedDays.includes(day)} onChange={(e) => {
                                                    setSelectedDays((days) => e.target.checked ? [...days, day] : days.filter((value) => value !== day));
                                                }} />
                                                {day}
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                            </form>

                            {playlistDetails?.items?.length === 0 ? (
                                <p style={{ color: 'var(--text-secondary)' }}>Esta playlist no tiene contenidos programados.</p>
                            ) : (
                                <table className="nexus-table">
                                    <thead>
                                        <tr>
                                            <th>Título</th>
                                            <th>Horario</th>
                                            <th>Días</th>
                                            <th>Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {playlistDetails?.items?.map((it, idx) => (
                                            <tr key={it.id || idx}>
                                                <td><strong>{it.title}</strong></td>
                                                <td>{it.start_time && it.end_time ? `${it.start_time} - ${it.end_time}` : '24/7'}</td>
                                                <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{(it.days_of_week || []).join(', ')}</span></td>
                                                <td>
                                                    <button className="btn-secondary" disabled={idx === 0} onClick={() => handleReorderPlaylist(idx, -1)} title="Mover arriba">↑</button>
                                                    <button className="btn-secondary" disabled={idx === playlistDetails.items.length - 1} onClick={() => handleReorderPlaylist(idx, 1)} title="Mover abajo">↓</button>
                                                    <button className="btn-danger" onClick={() => handleRemoveFromPlaylist(it.content_id)}>
                                                        Quitar
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
