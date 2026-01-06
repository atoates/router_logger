-- Migration: Create wifi_guest_sessions table for captive portal data
-- This replaces the old ironwifi_* tables with a cleaner structure

-- Create new wifi_guest_sessions table
CREATE TABLE IF NOT EXISTS wifi_guest_sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    guest_name VARCHAR(255),
    user_mac VARCHAR(50),
    router_mac VARCHAR(50),
    router_id VARCHAR(50) REFERENCES routers(router_id) ON DELETE SET NULL,
    session_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    session_end TIMESTAMP WITH TIME ZONE,
    session_duration_seconds INTEGER,
    event_type VARCHAR(50),
    end_reason VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_wifi_guest_sessions_router_id ON wifi_guest_sessions(router_id);
CREATE INDEX IF NOT EXISTS idx_wifi_guest_sessions_session_start ON wifi_guest_sessions(session_start DESC);
CREATE INDEX IF NOT EXISTS idx_wifi_guest_sessions_username ON wifi_guest_sessions(username);
CREATE INDEX IF NOT EXISTS idx_wifi_guest_sessions_email ON wifi_guest_sessions(email);
CREATE INDEX IF NOT EXISTS idx_wifi_guest_sessions_user_mac ON wifi_guest_sessions(user_mac);

-- Add last_guest_activity column to routers table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'routers' AND column_name = 'last_guest_activity'
    ) THEN
        ALTER TABLE routers ADD COLUMN last_guest_activity TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Comment on table
COMMENT ON TABLE wifi_guest_sessions IS 'Guest WiFi sessions from self-hosted captive portal';
COMMENT ON COLUMN wifi_guest_sessions.session_id IS 'Unique session identifier from captive portal';
COMMENT ON COLUMN wifi_guest_sessions.router_mac IS 'MAC address of the router (from CoovaChilli called parameter)';
COMMENT ON COLUMN wifi_guest_sessions.router_id IS 'Linked router ID (matched by MAC address)';
COMMENT ON COLUMN wifi_guest_sessions.event_type IS 'Type of event: registration_completed, free_access_granted, guest_login, etc.';

