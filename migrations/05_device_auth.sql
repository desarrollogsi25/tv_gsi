-- ═══════════════════════════════════════════════════════════
-- Nexus TV Enterprise — Migration 05: Device Authentication (RSK-025)
-- ═══════════════════════════════════════════════════════════

-- Agregar columna para almacenar el hash SHA-256 del token de dispositivo de forma segura (sin texto plano)
ALTER TABLE nexus_tv.tv_screens
ADD COLUMN IF NOT EXISTS device_token_hash character varying(64);

-- Agregar marca de tiempo de creación/rotación del token
ALTER TABLE nexus_tv.tv_screens
ADD COLUMN IF NOT EXISTS token_created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP;

-- Asegurar permisos sobre las nuevas columnas para los roles correspondientes
GRANT SELECT, UPDATE ON TABLE nexus_tv.tv_screens TO tv;
GRANT SELECT, UPDATE ON TABLE nexus_tv.tv_screens TO nx_tv;
GRANT SELECT, UPDATE ON TABLE nexus_tv.tv_screens TO tv_user;
