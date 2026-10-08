import axios from 'axios';

const api = axios.create({
    baseURL: '/api'
});

// Interceptor de petición para inyectar token JWT
const attachAuthToken = (config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
};

// Interceptor de respuesta para manejar 401 Unauthorized
const handleAuthError = (error) => {
    if (error.response && error.response.status === 401) {
        const isLoginRequest = error.config?.url?.includes('/auth/login');
        if (!isLoginRequest) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            if (window.location.pathname.startsWith('/admin')) {
                window.location.href = '/admin';
            }
        }
    }
    return Promise.reject(error);
};

// Aplicar a la instancia centralizada api
api.interceptors.request.use(attachAuthToken, (error) => Promise.reject(error));
api.interceptors.response.use((response) => response, handleAuthError);

// Aplicar también a la instancia global de axios para retrocompatibilidad directa
axios.interceptors.request.use(attachAuthToken, (error) => Promise.reject(error));
axios.interceptors.response.use((response) => response, handleAuthError);

export default api;
