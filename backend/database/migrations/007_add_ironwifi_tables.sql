-- IronWifi Integration - User Session Tracking
-- Migration: 007_add_ironwifi_tables.sql

-- Add MAC address to routers table for IronWifi AP matching
ALTER TABLE routers ADD COLUMN IF NOT EXISTS mac_address VARCHAR(17);
ALTER TABLE routers ADD COLUMN IF NOT EXISTS ironwifi_ap_id VARCHAR(255);
ALTER TABLE routers ADD COLUMN IF NOT EXISTS ironwifi_ap_name VARCHAR(255);

-- Create index for MAC address lookups
CREATE INDEX IF NOT EXISTS idx_routers_mac_address ON routers(mac_address);

-- Store IronWifi user sessions
CREATE TABLE IF NOT EXISTS ironwifi_sessions (
  id SERIAL PRIMARY KEY,
  
  -- Router/AP identification
  router_id VARCHAR(255),
  router_mac_address VARCHAR(17) NOT NULL,
  ap_name VARCHAR(255),
  
  -- Session identification
  session_id VARCHAR(255) UNIQUE NOT NULL,
  ironwifi_session_id VARCHAR(255),
  
  -- User/Device information
  user_id VARCHAR(255),
  username VARCHAR(255),
  user_email VARCHAR(255),
  user_device_mac VARCHAR(17),
  user_device_name VARCHAR(255),
  user_device_type VARCHAR(100),
  
  -- Session timing
  session_start TIMESTAMP NOT NULL,
  session_end TIMESTAMP,
  last_seen TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  
  -- Usage metrics
  bytes_uploaded BIGINT DEFAULT 0,
  bytes_downloaded BIGINT DEFAULT 0,
  bytes_total BIGINT DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  
  -- Network details
  ssid VARCHAR(255),
  location_name VARCHAR(255),
  ip_address VARCHAR(45),
  
  -- Authentication method
  auth_method VARCHAR(50),
  auth_provider VARCHAR(100),
  
  -- Metadata
  raw_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (router_id) REFERENCES routers(router_id) ON DELETE SET NULL
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_router_id ON ironwifi_sessions(router_id);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_router_mac ON ironwifi_sessions(router_mac_address);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_active ON ironwifi_sessions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_session_start ON ironwifi_sessions(session_start DESC);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_user_mac ON ironwifi_sessions(user_device_mac);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_username ON ironwifi_sessions(username);

-- Daily aggregated statistics per router
CREATE TABLE IF NOT EXISTS router_user_stats (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  
  -- User metrics
  total_users INTEGER DEFAULT 0,
  unique_users INTEGER DEFAULT 0,
  unique_devices INTEGER DEFAULT 0,
  total_sessions INTEGER DEFAULT 0,
  
  -- Usage metrics
  total_bytes_transferred BIGINT DEFAULT 0,
  total_bytes_uploaded BIGINT DEFAULT 0,
  total_bytes_downloaded BIGINT DEFAULT 0,
  
  -- Session metrics
  avg_session_duration_seconds INTEGER DEFAULT 0,
  max_session_duration_seconds INTEGER DEFAULT 0,
  min_session_duration_seconds INTEGER DEFAULT 0,
  
  -- Peak metrics
  peak_concurrent_users INTEGER DEFAULT 0,
  peak_hour INTEGER,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (router_id) REFERENCES routers(router_id) ON DELETE CASCADE,
  UNIQUE(router_id, date)
);

CREATE INDEX IF NOT EXISTS idx_router_user_stats_router_date ON router_user_stats(router_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_router_user_stats_date ON router_user_stats(date DESC);

-- Materialized view for quick access to current active users per router
CREATE MATERIALIZED VIEW IF NOT EXISTS router_active_users AS
SELECT 
  r.router_id,
  r.name as router_name,
  r.mac_address,
  COUNT(DISTINCT s.session_id) as active_sessions,
  COUNT(DISTINCT s.user_device_mac) as unique_active_devices,
  ARRAY_AGG(DISTINCT s.username) FILTER (WHERE s.username IS NOT NULL) as active_usernames,
  SUM(s.bytes_total) as total_bytes,
  MAX(s.last_seen) as last_activity
FROM routers r
LEFT JOIN ironwifi_sessions s ON r.router_id = s.router_id AND s.is_active = true
GROUP BY r.router_id, r.name, r.mac_address;

CREATE UNIQUE INDEX IF NOT EXISTS idx_router_active_users_router_id ON router_active_users(router_id);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_router_active_users()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY router_active_users;
END;
$$ LANGUAGE plpgsql;

-- Settings table for IronWifi configuration (if not exists)
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default IronWifi settings
INSERT INTO settings (key, value, description) VALUES
  ('ironwifi_last_sync', '1970-01-01T00:00:00.000Z', 'Last successful IronWifi sync timestamp'),
  ('ironwifi_sync_enabled', 'false', 'Enable/disable automatic IronWifi syncing'),
  ('ironwifi_sync_interval_minutes', '5', 'Minutes between IronWifi syncs')
ON CONFLICT (key) DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE ironwifi_sessions IS 'Stores user session data from IronWifi captive portal';
COMMENT ON TABLE router_user_stats IS 'Daily aggregated statistics for user connections per router';
COMMENT ON COLUMN routers.mac_address IS 'MAC address of the router WiFi AP for IronWifi matching';
COMMENT ON COLUMN ironwifi_sessions.user_device_mac IS 'MAC address of the user device connecting through the router';
COMMENT ON MATERIALIZED VIEW router_active_users IS 'Quick lookup for currently active users per router';
