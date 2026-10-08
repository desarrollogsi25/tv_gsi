import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../Admin';
import { showToast } from '../Toast';

export default function TVList() {
    const [screens, setScreens] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchScreens = async () => {
        try {
            setLoading(true);
            const screensRes = await axios.get(`${API_URL}/api/admin/screens`);
            if (screensRes.data.success) {
                setScreens(screensRes.data.screens);
            }
        } catch (err) {
            console.error('Error fetching screens:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchScreens();
    }, []);

    const handleQuickReload = async (uuid) => {
        try {
            await axios.post(`${API_URL}/api/admin/screens/${uuid}/control`, {
                command: 'reload'
            });
            showToast('Comando de recarga enviado exitosamente.', 'success');
        } catch (err) {
            showToast('Error al enviar recarga: ' + (err.response?.data?.message || err.message), 'error');
        }
    };

    return (
        <div className="admin-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h2>Pantallas de Transmisión</h2>
                    <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                        Monitoreo en tiempo real de todas las pantallas registradas en el ecosistema.
                    </p>
                </div>
                <button className="btn-secondary" onClick={fetchScreens}>
                    🔄 Actualizar Lista
                </button>
            </div>

            {loading ? (
                <p style={{ color: 'var(--text-secondary)' }}>Cargando dispositivos...</p>
            ) : screens.length === 0 ? (
                <div className="panel-card" style={{ textAlign: 'center', padding: '48px' }}>
                    <p style={{ fontSize: '1.2rem', color: 'var(--text-secondary)' }}>No hay pantallas registradas aún.</p>
                    <Link to="/admin/register" className="btn-primary" style={{ display: 'inline-block', marginTop: '16px' }}>
                        Ver Dispositivos Pendientes
                    </Link>
                </div>
            ) : (
                <div className="tv-grid">
                    {screens.map((tv) => {
                        const isOnline = tv.is_active; // o evaluado con last_login
                        return (
                            <div key={tv.id} className={`tv-card ${isOnline ? 'online' : 'offline'}`}>
                                <div className="tv-card-header">
                                    <h3>{tv.name}</h3>
                                    <span className="status-badge">
                                        {isOnline ? 'En Línea' : 'Inactiva'}
                                    </span>
                                </div>
                                <div className="tv-card-body">
                                    <p><strong>Ubicación:</strong> {tv.location || 'No asignada'}</p>
                                    <p><strong>Playlist:</strong> {tv.playlist_name || 'Sin playlist'}</p>
                                    <p className="small"><strong>UUID:</strong> {tv.tv_uuid}</p>
                                </div>
                                <div className="tv-card-footer">
                                    <div className="button-group">
                                        <Link to={`/admin/tv/${tv.tv_uuid}`} className="btn-primary" style={{ textDecoration: 'none', textAlign: 'center' }}>
                                            ⚙️ Control
                                        </Link>
                                        <button className="btn-secondary" onClick={() => handleQuickReload(tv.tv_uuid)}>
                                            🔄 Reiniciar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
