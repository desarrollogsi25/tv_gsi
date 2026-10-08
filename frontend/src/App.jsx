import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import TVPlayer from './components/TVPlayer';
import Admin from './components/Admin';
import './App.css';

function App() {
    return (
        <BrowserRouter>
            <div className="app-container">
                <Routes>
                    {/* Redirigir raíz a /tv */}
                    <Route path="/" element={<Navigate to="/tv" replace />} />
                    
                    {/* Ruta del Televisor (Pública) */}
                    <Route path="/tv" element={<TVPlayer />} />
                    
                    {/* Rutas de Administración (Pública nuevamente) */}
                    <Route path="/admin/*" element={<Admin />} />

                    {/* Fallback */}
                    <Route path="*" element={<Navigate to="/tv" replace />} />
                </Routes>
            </div>
        </BrowserRouter>
    );
}

export default App;
