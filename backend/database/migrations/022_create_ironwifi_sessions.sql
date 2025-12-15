-- Migration 022: Create ironwifi_sessions table
-- Required for storing IronWifi guest session data

-- IronWifi sessions table - stores guest WiFi connection sessions
CREATE TABLE IF NOT EXISTS ironwifi_sessions (
  id SERIAL PRIMARY KEY,
  
  -- Router/AP identification
  router_id VARCHAR(255) REFERENCES routers(router_id) ON DELETE SET NULL,
  router_mac_address VARCHAR(50),
  
  -- Session identification
  session_id VARCHAR(255) UNIQUE NOT NULL,
  
  -- User information
  username VARCHAR(255),
  user_device_mac VARCHAR(50),
  ip_address VARCHAR(45),
  
  -- Session timing
  session_start TIMESTAMP NOT NULL,
  session_end TIMESTAMP,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Bandwidth usage
  bytes_uploaded BIGINT DEFAULT 0,
  bytes_downloaded BIGINT DEFAULT 0,
  bytes_total BIGINT DEFAULT 0,
  
  -- Duration
  duration_seconds INTEGER DEFAULT 0,
  
  -- Optional additional fields from IronWifi
  nas_ip_address VARCHAR(45),
  terminate_cause VARCHAR(100),
  ironwifi_ap_id VARCHAR(100),
  ironwifi_ap_name VARCHAR(255),
  
  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_router_id ON ironwifi_sessions(router_id);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_session_id ON ironwifi_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_username ON ironwifi_sessions(username);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_router_mac ON ironwifi_sessions(router_mac_address);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_user_mac ON ironwifi_sessions(user_device_mac);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_active ON ironwifi_sessions(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_start ON ironwifi_sessions(session_start DESC);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_created ON ironwifi_sessions(created_at DESC);

-- Daily aggregated statistics per router
CREATE TABLE IF NOT EXISTS router_user_stats (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(255) REFERENCES routers(router_id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  -- User counts
  unique_users INTEGER DEFAULT 0,
  total_sessions INTEGER DEFAULT 0,
  
  -- Bandwidth totals
  bytes_uploaded BIGINT DEFAULT 0,
  bytes_downloaded BIGINT DEFAULT 0,
  bytes_total BIGINT DEFAULT 0,
  
  -- Session stats
  total_duration_seconds BIGINT DEFAULT 0,
  avg_session_duration_seconds INTEGER DEFAULT 0,
  peak_concurrent_users INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(router_id, date)
);

-- Indexes for stats queries
CREATE INDEX IF NOT EXISTS idx_router_user_stats_router ON router_user_stats(router_id);
CREATE INDEX IF NOT EXISTS idx_router_user_stats_date ON router_user_stats(date DESC);
CREATE INDEX IF NOT EXISTS idx_router_user_stats_router_date ON router_user_stats(router_id, date DESC);

-- Trigger to update updated_at on session changes
CREATE OR REPLACE FUNCTION update_ironwifi_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ironwifi_sessions_updated_at ON ironwifi_sessions;
CREATE TRIGGER ironwifi_sessions_updated_at
BEFORE UPDATE ON ironwifi_sessions
FOR EACH ROW
EXECUTE FUNCTION update_ironwifi_session_updated_at();

DROP TRIGGER IF EXISTS router_user_stats_updated_at ON router_user_stats;
CREATE TRIGGER router_user_stats_updated_at
BEFORE UPDATE ON router_user_stats
FOR EACH ROW
EXECUTE FUNCTION update_ironwifi_session_updated_at();

COMMENT ON TABLE ironwifi_sessions IS 'Stores guest WiFi connection sessions from IronWifi webhook/API';
COMMENT ON TABLE router_user_stats IS 'Daily aggregated user statistics per router';
