import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import TVPlayer from './components/TVPlayer';
import Admin from './components/Admin';
import Login from './components/Login';
import './api'; // Asegurar inicialización de interceptores de Axios
import './App.css';

function App() {
    const [token, setToken] = useState(() => localStorage.getItem('token'));

    useEffect(() => {
        const handleStorageChange = () => {
            setToken(localStorage.getItem('token'));
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const handleLogin = (user, newToken) => {
        setToken(newToken);
    };

    return (
        <BrowserRouter>
            <div className="app-container">
                <Routes>
                    {/* Redirigir raíz a /tv */}
                    <Route path="/" element={<Navigate to="/tv" replace />} />
                    
                    {/* Ruta del Televisor (Pública) */}
                    <Route path="/tv" element={<TVPlayer />} />
                    
                    {/* Ruta explícita de login */}
                    <Route
                        path="/login"
                        element={token ? <Navigate to="/admin" replace /> : <Login onLogin={handleLogin} />}
                    />

                    {/* Rutas de Administración (Protegida con Login si no hay token) */}
                    <Route
                        path="/admin/*"
                        element={token ? <Admin /> : <Login onLogin={handleLogin} />}
                    />

                    {/* Fallback */}
                    <Route path="*" element={<Navigate to="/tv" replace />} />
                </Routes>
            </div>
        </BrowserRouter>
    );
}

export default App;
