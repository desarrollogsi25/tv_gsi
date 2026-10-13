// ═══════════════════════════════════════════════════════════
// Bus de eventos del sistema de notificaciones Toast / Modal
// de confirmación.
//
// Motivo de extracción: `Toast.jsx` solo debe exportar componentes
// (regla `react(only-export-components)` de oxlint, necesaria para
// que Fast Refresh funcione). Las funciones imperativas
// `showToast` / `showConfirmation` y los registros de escuchas
// viven aquí y `Toast.jsx` únicamente se suscribe a ellos.
// ═══════════════════════════════════════════════════════════

export const toastListeners = new Set();
export const confirmListeners = new Set();

/**
 * Muestra una notificación tipo Toast no bloqueante
 * @param {string} message - Texto del mensaje
 * @param {'info' | 'success' | 'warning' | 'error'} type - Severidad
 * @param {number} duration - Duración en ms (defecto 3500ms)
 */
export const showToast = (message, type = 'info', duration = 3500) => {
    toastListeners.forEach(fn => fn({
        id: Date.now() + Math.random(),
        message,
        type,
        duration
    }));
};

/**
 * Muestra un modal de confirmación no bloqueante
 * @param {Object} options
 * @param {string} [options.title]
 * @param {string} options.message
 * @param {string} [options.confirmText]
 * @param {string} [options.cancelText]
 * @param {Function} [options.onConfirm]
 * @param {Function} [options.onCancel]
 */
export const showConfirmation = ({
    title = 'Confirmar Acción',
    message,
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    onAccept,
    onCancel
}) => {
    confirmListeners.forEach(fn => fn({
        id: Date.now(),
        title,
        message,
        confirmText,
        cancelText,
        onAccept,
        onCancel
    }));
};
