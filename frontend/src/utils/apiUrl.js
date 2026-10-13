// ═══════════════════════════════════════════════════════════
// Configuración compartida de la URL base de la API.
//
// Motivo de extracción: `Admin.jsx` solo debe exportar componentes
// (regla `react(only-export-components)` de oxlint, necesaria para
// que Fast Refresh funcione). Los componentes del panel de admin
// importan `API_URL` desde aquí en lugar de desde el componente.
// ═══════════════════════════════════════════════════════════

export const API_URL = import.meta.env.VITE_API_URL || '';
