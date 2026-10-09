import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { API_URL } from '../Admin';
import { showToast } from '../Toast';

export default function TVRegister() {
    const [waitingScreens, setWaitingScreens] = useState([]);
    const [profiles, setProfiles] = useState([]);
    const [selectedProfileBySession, setSelectedProfileBySession] = useState({});
    const [busySessionIds, setBusySessionIds] = useState(() => new Set());
    const pendingSessionIds = useRef(new Set());
    const [message, setMessage] = useState('');

    const loadData = async () => {
        try {
            const [waitingRes, profilesRes] = await Promise.all([
                axios.get(`${API_URL}/api/admin/waiting-screens`),
                axios.get(`${API_URL}/api/admin/available-profiles`)
            ]);

            if (waitingRes.data.success) {
                setWaitingScreens(waitingRes.data.waiting);
            }
            if (profilesRes.data.success) {
                setProfiles(profilesRes.data.profiles);
            }
        } catch (err) {
            console.error('Error cargando datos de vinculación:', err);
        }
    };

    useEffect(() => {
        loadData();
        // Polling cada 4 segundos para detectar nuevas TVs en la red automáticamente
        const interval = setInterval(loadData, 4000);
        return () => clearInterval(interval);
    }, []);

    const handleBindScreen = async (pairingSessionId) => {
        if (pendingSessionIds.current.has(pairingSessionId)) return;
        const tvUuid = selectedProfileBySession[pairingSessionId] || (profiles[0] ? profiles[0].tv_uuid : null);
        if (!tvUuid) {
            return showToast('Por favor selecciona un usuario/perfil de pantalla para asignar.', 'warning');
        }

        pendingSessionIds.current.add(pairingSessionId);
        setBusySessionIds((current) => new Set(current).add(pairingSessionId));
        try {
            const res = await axios.post(`${API_URL}/api/admin/bind-screen`, {
                pairingSessionId,
                tv_uuid: tvUuid
            });

            if (res.data.success) {
                setMessage(`✅ ¡Éxito! Pantalla vinculada con el usuario '${res.data.profile.name}'. La TV ha comenzado a reproducir.`);
                setTimeout(() => setMessage(''), 4500);
                loadData();
            }
        } catch (err) {
            setMessage('Error al vincular: ' + (err.response?.data?.message || err.message));
        } finally {
            pendingSessionIds.current.delete(pairingSessionId);
            setBusySessionIds((current) => {
                const next = new Set(current);
                next.delete(pairingSessionId);
                return next;
            });
        }
    };

    const handleRejectScreen = async (pairingSessionId) => {
        if (pendingSessionIds.current.has(pairingSessionId)) return;
        pendingSessionIds.current.add(pairingSessionId);
        setBusySessionIds((current) => new Set(current).add(pairingSessionId));
        try {
            const res = await axios.post(`${API_URL}/api/admin/waiting-screens/${encodeURIComponent(pairingSessionId)}/reject`);
            showToast(res.data.message || 'Solicitud rechazada.', 'success');
            loadData();
        } catch (err) {
            showToast('Error al rechazar: ' + (err.response?.data?.message || err.message), 'error');
        } finally {
            pendingSessionIds.current.delete(pairingSessionId);
            setBusySessionIds((current) => {
                const next = new Set(current);
                next.delete(pairingSessionId);
                return next;
            });
        }
    };

    return (
        <div className="admin-section">
            <h2>Vinculación Automática & Asignación de Usuarios</h2>
            <p style={{ color: 'var(--text-secondary)' }}>
                Flujo sin contacto: Enciende o abre la URL en la Smart TV, el panel la detectará aquí en vivo y solo debes hacer clic para asignarle su usuario.
            </p>

            {message && (
                <div style={{ padding: '14px 18px', background: 'var(--status-online-bg)', color: 'var(--status-online-text)', borderRadius: '12px', marginBottom: '24px', fontWeight: 600 }}>
                    {message}
                </div>
            )}

            {/* SECCIÓN 1: PANTALLAS DETECTADAS EN VIVO */}
            <div className="panel-card" style={{ marginBottom: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="tv-dot-online" style={{ width: '10px', height: '10px' }} />
                            📡 Pantallas Detectadas en Vivo en la Red
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '4px 0 0' }}>
                            Dispositivos que abrieron la URL <code>/tv</code> y están esperando asignación.
                        </p>
                    </div>
                    <button className="btn-secondary" onClick={loadData}>🔄 Refrescar</button>
                </div>

                {waitingScreens.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '36px 20px', background: 'var(--bg-subtle)', borderRadius: '14px' }}>
                        <p style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', margin: 0 }}>
                            Esperando conexiones... Abre <code>http://localhost:28080/tv</code> en una pantalla o navegador.
                        </p>
                    </div>
                ) : (
                    <table className="nexus-table pairing-table">
                        <thead>
                            <tr>
                                <th>PIN de Sesión</th>
                                <th>Detectada</th>
                                <th>Asignar Usuario / Pantalla de BD</th>
                                <th>Acción Inmediata</th>
                            </tr>
                        </thead>
                        <tbody>
                            {waitingScreens.map((tv) => (
                                <tr key={tv.pairingSessionId}>
                                    <td data-label="PIN de sesión">
                                        <span className="badge" style={{ fontSize: '1.1rem', background: '#0071e3', color: '#fff', padding: '6px 12px' }}>
                                            #{tv.sessionCode}
                                        </span>
                                    </td>
                                    <td data-label="Detectada">
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            {new Date(tv.connectedAt).toLocaleTimeString('es-ES')}
                                        </span>
                                    </td>
                                    <td data-label="Perfil asignado">
                                        <select
                                            className="pairing-profile-select"
                                            disabled={busySessionIds.has(tv.pairingSessionId)}
                                            style={{ padding: '8px 12px', borderRadius: '10px', border: '1px solid var(--border-card)', fontSize: '0.95rem' }}
                                            value={selectedProfileBySession[tv.pairingSessionId] || ''}
                                            onChange={(e) => setSelectedProfileBySession({ ...selectedProfileBySession, [tv.pairingSessionId]: e.target.value })}
                                        >
                                            <option value="">-- Elige un usuario preconfigurado --</option>
                                            {profiles.map((p) => (
                                                <option key={p.tv_uuid} value={p.tv_uuid}>
                                                    {p.name} ({p.location || 'Sin ubicación'})
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                    <td data-label="Acciones">
                                        <div className="pairing-actions">
                                        <button
                                            className="btn-primary"
                                            style={{ background: 'linear-gradient(135deg, #0071e3, #00c6ff)' }}
                                            disabled={busySessionIds.has(tv.pairingSessionId)}
                                            onClick={() => handleBindScreen(tv.pairingSessionId)}
                                        >
                                            {busySessionIds.has(tv.pairingSessionId) ? '⏳ Vinculando…' : '🔗 Asignar y Activar TV'}
                                        </button>
                                        <button className="btn-danger" disabled={busySessionIds.has(tv.pairingSessionId)} onClick={() => handleRejectScreen(tv.pairingSessionId)}>
                                            {busySessionIds.has(tv.pairingSessionId) ? '⏳ Procesando…' : 'Rechazar'}
                                        </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* SECCIÓN 2: CATÁLOGO DE USUARIOS / PANTALLAS PRECONFIGURADAS EN SQL */}
            <div className="panel-card">
                <h3>👥 Usuarios de Pantalla Preconfigurados (Base de Datos)</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '16px' }}>
                    Perfiles registrados en el volcado maestro <code>nexus_tv.tv_screens</code> listos para ser asignados o probados.
                </p>

                <table className="nexus-table pairing-table">
                    <thead>
                        <tr>
                            <th>Usuario / Pantalla</th>
                            <th>Ubicación</th>
                            <th>Playlist Asignada</th>
                            <th>UUID en Base de Datos</th>
                            <th>Prueba Rápida</th>
                        </tr>
                    </thead>
                    <tbody>
                        {profiles.map((p) => (
                            <tr key={p.id}>
                            <td data-label="Pantalla"><strong>{p.name}</strong></td>
                            <td data-label="Ubicación">{p.location || 'No asignada'}</td>
                            <td data-label="Playlist">{p.playlist_name || 'Sin playlist'}</td>
                            <td data-label="UUID"><code style={{ fontSize: '0.8rem' }}>{p.tv_uuid}</code></td>
                            <td data-label="Prueba rápida">
                                    <a
                                        href={`/tv?uuid=${p.tv_uuid}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="btn-secondary"
                                        style={{ textDecoration: 'none', display: 'inline-block', fontSize: '0.82rem', padding: '6px 12px' }}
                                    >
                                        📺 Abrir como {p.name}
                                    </a>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
