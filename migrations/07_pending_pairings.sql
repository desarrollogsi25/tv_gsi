-- ═══════════════════════════════════════════════════════════
-- Nexus TV Enterprise — Migration 07: Pending Pairings (AUD-005)
-- ═══════════════════════════════════════════════════════════

-- Tabla para almacenar vinculaciones pendientes sin mantener transacciones de larga duración
CREATE TABLE IF NOT EXISTS nexus_tv.pending_pairings (
    id SERIAL PRIMARY KEY,
    tv_uuid UUID NOT NULL,
    pairing_session_id VARCHAR(64) NOT NULL UNIQUE,
    pending_device_token_hash VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'promoted', 'cancelled', 'expired'
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pending_pairings_lookup
ON nexus_tv.pending_pairings (pairing_session_id, tv_uuid);

CREATE INDEX IF NOT EXISTS idx_pending_pairings_status_exp
ON nexus_tv.pending_pairings (status, expires_at);

-- Conceder permisos sobre la nueva tabla y secuencia para roles existentes
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tv') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.pending_pairings TO tv;
        GRANT USAGE, SELECT ON SEQUENCE nexus_tv.pending_pairings_id_seq TO tv;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nx_tv') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.pending_pairings TO nx_tv;
        GRANT USAGE, SELECT ON SEQUENCE nexus_tv.pending_pairings_id_seq TO nx_tv;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tv_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.pending_pairings TO tv_user;
        GRANT USAGE, SELECT ON SEQUENCE nexus_tv.pending_pairings_id_seq TO tv_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nexus_tv.pending_pairings TO nexus_app;
        GRANT USAGE, SELECT ON SEQUENCE nexus_tv.pending_pairings_id_seq TO nexus_app;
    END IF;
END $$;
