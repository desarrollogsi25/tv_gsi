import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import './Login.css';

export default function Login({ onLogin }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMessage('');

        if (!username.trim() || !password) {
            setErrorMessage('Por favor ingrese usuario y contraseña.');
            return;
        }

        try {
            setLoading(true);
            const res = await api.post('/auth/login', {
                username: username.trim(),
                password: password
            });

            if (res.data?.success && res.data?.token) {
                localStorage.setItem('token', res.data.token);
                if (res.data.user) {
                    localStorage.setItem('user', JSON.stringify(res.data.user));
                }

                if (onLogin) {
                    onLogin(res.data.user, res.data.token);
                }
                navigate('/admin');
            } else {
                setErrorMessage(res.data?.message || 'Error al autenticar.');
            }
        } catch (err) {
            const msg = err.response?.data?.message || 'Credenciales inválidas o error de comunicación.';
            setErrorMessage(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-viewport">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-badge">
                        <span className="login-badge-dot"></span>
                        <span className="login-badge-title">NEXUS TV ENTERPRISE</span>
                    </div>
                    <h1 className="login-title">Iniciar Sesión</h1>
                    <p className="login-subtitle">Acceso administrativo al Centro de Control</p>
                </div>

                {errorMessage && (
                    <div className="login-error-banner" role="alert">
                        <span>⚠️</span>
                        <span>{errorMessage}</span>
                    </div>
                )}

                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="login-field">
                        <label className="login-label" htmlFor="username">Usuario</label>
                        <input
                            id="username"
                            type="text"
                            className="login-input"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Ingrese su usuario"
                            autoComplete="username"
                            autoFocus
                            disabled={loading}
                            required
                        />
                    </div>

                    <div className="login-field">
                        <label className="login-label" htmlFor="password">Contraseña</label>
                        <input
                            id="password"
                            type="password"
                            className="login-input"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            autoComplete="current-password"
                            disabled={loading}
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        className="login-btn"
                        disabled={loading}
                    >
                        {loading ? (
                            <span>Autenticando...</span>
                        ) : (
                            <span>Acceder al Panel</span>
                        )}
                    </button>
                </form>

                <div className="login-footer">
                    <span>Nexus TV v2.0 • ISO 27001 Access Control Gateway</span>
                </div>
            </div>
        </div>
    );
}
