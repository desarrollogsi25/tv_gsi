import React, { useState, useEffect } from 'react';
import { toastListeners, confirmListeners } from '../utils/toastBus';
import './Toast.css';

export function ToastContainer() {
    const [toasts, setToasts] = useState([]);
    const [confirmModal, setConfirmModal] = useState(null);

    useEffect(() => {
        const handleToast = (newToast) => {
            setToasts(prev => [...prev, newToast]);
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== newToast.id));
            }, newToast.duration);
        };

        const handleConfirm = (config) => {
            setConfirmModal(config);
        };

        toastListeners.add(handleToast);
        confirmListeners.add(handleConfirm);

        return () => {
            toastListeners.delete(handleToast);
            confirmListeners.delete(handleConfirm);
        };
    }, []);

    const removeToast = (id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    return (
        <>
            {/* Contenedor de Toasts */}
            <div className="toast-portal">
                {toasts.map(t => (
                    <div
                        key={t.id}
                        className={`toast-item toast-${t.type}`}
                        role="alert"
                        onClick={() => removeToast(t.id)}
                    >
                        <span className="toast-icon">
                            {t.type === 'error' && '❌'}
                            {t.type === 'warning' && '⚠️'}
                            {t.type === 'success' && '✅'}
                            {t.type === 'info' && 'ℹ️'}
                        </span>
                        <span className="toast-message">{t.message}</span>
                        <button
                            className="toast-close"
                            onClick={(e) => {
                                e.stopPropagation();
                                removeToast(t.id);
                            }}
                            aria-label="Cerrar notificación"
                        >
                            &times;
                        </button>
                    </div>
                ))}
            </div>

            {/* Modal de Confirmación */}
            {confirmModal && (
                <div
                    className="confirm-overlay"
                    onClick={() => {
                        if (confirmModal.onCancel) confirmModal.onCancel();
                        setConfirmModal(null);
                    }}
                >
                    <div className="confirm-modal" onClick={e => e.stopPropagation()}>
                        <h3 className="confirm-title">{confirmModal.title}</h3>
                        <p className="confirm-message">{confirmModal.message}</p>
                        <div className="confirm-actions">
                            <button
                                className="confirm-btn cancel"
                                onClick={() => {
                                    if (confirmModal.onCancel) confirmModal.onCancel();
                                    setConfirmModal(null);
                                }}
                            >
                                {confirmModal.cancelText}
                            </button>
                            <button
                                className="confirm-btn confirm"
                                autoFocus
                                onClick={() => {
                                    if (confirmModal.onAccept) confirmModal.onAccept();
                                    setConfirmModal(null);
                                }}
                            >
                                {confirmModal.confirmText}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default ToastContainer;
