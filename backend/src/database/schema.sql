-- Router Logger Database Schema
-- Complete schema with all columns defined
-- Last updated: 2024-12-15

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Main routers table with all columns
CREATE TABLE IF NOT EXISTS routers (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(255) UNIQUE NOT NULL,
  device_serial VARCHAR(255),
  imei VARCHAR(255),
  name VARCHAR(255),
  location VARCHAR(255),
  site_id VARCHAR(255),
  firmware_version VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- RMS integration
  rms_created_at TIMESTAMP,
  current_status VARCHAR(50) DEFAULT 'unknown',
  operator VARCHAR(100),
  wan_ip VARCHAR(50),
  
  -- Status and notes
  notes TEXT,
  mac_address VARCHAR(50),
  
  -- ClickUp integration
  clickup_task_id VARCHAR(50),
  clickup_task_url TEXT,
  clickup_list_id VARCHAR(50),
  clickup_location_task_id VARCHAR(50),
  clickup_location_task_name VARCHAR(255),
  location_linked_at TIMESTAMP,
  date_installed BIGINT,
  last_clickup_sync_hash TEXT,
  clickup_assignees JSONB,
  clickup_task_status VARCHAR(50),
  
  -- Service status tracking
  service_status VARCHAR(50) DEFAULT 'in-service',
  stored_with VARCHAR(50),
  out_of_service_date TIMESTAMP,
  out_of_service_reason TEXT,
  out_of_service_notes TEXT,
  
  -- Property tracking (denormalized for quick access)
  current_property_task_id VARCHAR(50),
  current_property_name VARCHAR(255),
  property_installed_at TIMESTAMP,
  stored_with_user_id VARCHAR(50),
  stored_with_username VARCHAR(100),
  current_state VARCHAR(20) DEFAULT 'unassigned',
  state_updated_at TIMESTAMP
);

-- Router telemetry logs (RUT200 format) - may be partitioned by timestamp
CREATE TABLE IF NOT EXISTS router_logs (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(255) NOT NULL,
  imei VARCHAR(255),
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- WAN & Network Info
  wan_ip VARCHAR(45),
  wan_ipv6 VARCHAR(45),
  wan_type VARCHAR(50),
  operator VARCHAR(100),
  mcc VARCHAR(10),
  mnc VARCHAR(10),
  network_type VARCHAR(50),
  
  -- Cell Tower Info
  lac VARCHAR(50),
  tac VARCHAR(50),
  cell_id VARCHAR(50),
  rsrp INTEGER,
  rsrq INTEGER,
  rssi INTEGER,
  sinr INTEGER,
  earfcn INTEGER,
  pc_id INTEGER,
  
  -- SIM Card Info
  iccid VARCHAR(32),
  imsi VARCHAR(32),
  
  -- Location (enriched from cell tower)
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  location_accuracy VARCHAR(50),
  
  -- Data Counters (cumulative)
  total_tx_bytes BIGINT DEFAULT 0,
  total_rx_bytes BIGINT DEFAULT 0,
  
  -- Device Status & Hardware
  uptime_seconds INTEGER DEFAULT 0,
  conn_uptime_seconds INTEGER,
  firmware_version VARCHAR(100),
  cpu_usage DECIMAL(5,2),
  cpu_temp_c DECIMAL(5,2),
  board_temp_c DECIMAL(5,2),
  input_voltage_mv INTEGER,
  memory_free INTEGER,
  status VARCHAR(50) DEFAULT 'online',
  
  -- Network Connections
  vpn_status VARCHAR(50),
  vpn_name VARCHAR(100),
  eth_link_up BOOLEAN,
  
  -- Wi-Fi Clients (JSON array)
  wifi_clients JSONB,
  wifi_client_count INTEGER DEFAULT 0,
  
  -- Additional data
  raw_data JSONB,
  
  FOREIGN KEY (router_id) REFERENCES routers(router_id) ON DELETE CASCADE
);

-- ============================================================================
-- USER AUTHENTICATION TABLES
-- ============================================================================

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'guest')),
  email VARCHAR(255),
  full_name VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  created_by INTEGER REFERENCES users(id)
);

-- User-router assignments (for guest users)
CREATE TABLE IF NOT EXISTS user_router_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  router_id VARCHAR(255) NOT NULL REFERENCES routers(router_id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_by INTEGER REFERENCES users(id),
  notes TEXT,
  UNIQUE(user_id, router_id)
);

-- User login history for auditing
CREATE TABLE IF NOT EXISTS user_login_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN DEFAULT TRUE
);

-- User sessions (persist across restarts)
CREATE TABLE IF NOT EXISTS user_sessions (
  session_token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'guest')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL
);

-- ============================================================================
-- INSPECTION & TRACKING TABLES
-- ============================================================================

-- Device inspection tracking
CREATE TABLE IF NOT EXISTS inspection_logs (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(255) NOT NULL,
  inspected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  inspected_by VARCHAR(255),
  notes TEXT,
  FOREIGN KEY (router_id) REFERENCES routers(router_id) ON DELETE CASCADE
);

-- Router property assignments (event-based tracking)
CREATE TABLE IF NOT EXISTS router_property_assignments (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(50) NOT NULL REFERENCES routers(router_id) ON DELETE CASCADE,
  property_clickup_task_id VARCHAR(50),
  property_name VARCHAR(255),
  installed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TIMESTAMP,
  notes TEXT,
  installed_by VARCHAR(100),
  removed_by VARCHAR(100),
  assignment_type VARCHAR(20) DEFAULT 'property',
  stored_with_user_id VARCHAR(50),
  stored_with_username VARCHAR(100),
  event_type VARCHAR(20),
  event_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Router location history (distinct locations with start/end times)
CREATE TABLE IF NOT EXISTS router_locations (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(255) NOT NULL REFERENCES routers(router_id) ON DELETE CASCADE,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  accuracy INTEGER,
  cell_id VARCHAR(50),
  tac VARCHAR(50),
  lac VARCHAR(50),
  mcc VARCHAR(10),
  mnc VARCHAR(10),
  operator VARCHAR(100),
  network_type VARCHAR(50),
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP, -- NULL = current location
  sample_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- OAUTH & INTEGRATION TABLES
-- ============================================================================

-- RMS OAuth tokens
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type VARCHAR(50) DEFAULT 'Bearer',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  scope TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ClickUp OAuth tokens
CREATE TABLE IF NOT EXISTS clickup_oauth_tokens (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  access_token TEXT NOT NULL,
  token_type VARCHAR(50) DEFAULT 'Bearer',
  workspace_id VARCHAR(50),
  workspace_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

-- OAuth state store (for PKCE flow)
CREATE TABLE IF NOT EXISTS oauth_state_store (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  state VARCHAR(255) NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(provider, state)
);

-- ============================================================================
-- SYSTEM TABLES
-- ============================================================================

-- Settings for system configuration
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migration tracking
CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Archive table for long-term retention of router logs
CREATE TABLE IF NOT EXISTS router_logs_archive (LIKE router_logs INCLUDING ALL);

-- ============================================================================
-- IRONWIFI INTEGRATION TABLES
-- ============================================================================

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

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Router logs indexes
CREATE INDEX IF NOT EXISTS idx_router_logs_router_id ON router_logs(router_id);
CREATE INDEX IF NOT EXISTS idx_router_logs_timestamp ON router_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_router_logs_router_timestamp ON router_logs(router_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_router_logs_router_ts ON router_logs (router_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_router_logs_ts ON router_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_router_logs_timestamp_brin ON router_logs USING brin (timestamp);

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active) WHERE is_active = true;

-- User assignments
CREATE INDEX IF NOT EXISTS idx_user_router_assignments_user ON user_router_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_router_assignments_router ON user_router_assignments(router_id);

-- Login history
CREATE INDEX IF NOT EXISTS idx_user_login_history_user ON user_login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_login_history_time ON user_login_history(login_at DESC);

-- Sessions
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- Inspection logs
CREATE INDEX IF NOT EXISTS idx_inspection_logs_router_id ON inspection_logs(router_id);
CREATE INDEX IF NOT EXISTS idx_inspection_logs_inspected_at ON inspection_logs(inspected_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspection_logs_router_ts ON inspection_logs (router_id, inspected_at DESC);

-- Property assignments
CREATE INDEX IF NOT EXISTS idx_property_assignments_router ON router_property_assignments(router_id);
CREATE INDEX IF NOT EXISTS idx_property_assignments_property ON router_property_assignments(property_clickup_task_id);
CREATE INDEX IF NOT EXISTS idx_property_assignments_current ON router_property_assignments(router_id, removed_at);

-- Router locations
CREATE INDEX IF NOT EXISTS idx_router_locations_router_id ON router_locations(router_id);
CREATE INDEX IF NOT EXISTS idx_router_locations_started_at ON router_locations(started_at);
CREATE INDEX IF NOT EXISTS idx_router_locations_active ON router_locations(router_id) WHERE ended_at IS NULL;

-- OAuth & ClickUp
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_id ON oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires_at ON oauth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_routers_clickup_task ON routers(clickup_task_id);
CREATE INDEX IF NOT EXISTS idx_clickup_tokens_user ON clickup_oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_state_store_provider_state ON oauth_state_store(provider, state);
CREATE INDEX IF NOT EXISTS idx_oauth_state_store_expires_at ON oauth_state_store(expires_at);

-- Routers
CREATE INDEX IF NOT EXISTS idx_routers_location_task ON routers(clickup_location_task_id) WHERE clickup_location_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routers_date_installed ON routers(date_installed) WHERE date_installed IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routers_service_status ON routers(service_status);
CREATE INDEX IF NOT EXISTS idx_routers_current_state ON routers(current_state);

-- Archive
CREATE INDEX IF NOT EXISTS idx_router_logs_archive_router_ts ON router_logs_archive (router_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_router_logs_archive_timestamp_brin ON router_logs_archive USING brin (timestamp);

-- IronWifi sessions
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_router_id ON ironwifi_sessions(router_id);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_session_id ON ironwifi_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_username ON ironwifi_sessions(username);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_router_mac ON ironwifi_sessions(router_mac_address);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_user_mac ON ironwifi_sessions(user_device_mac);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_active ON ironwifi_sessions(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_start ON ironwifi_sessions(session_start DESC);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_created ON ironwifi_sessions(created_at DESC);

-- Router user stats
CREATE INDEX IF NOT EXISTS idx_router_user_stats_router ON router_user_stats(router_id);
CREATE INDEX IF NOT EXISTS idx_router_user_stats_date ON router_user_stats(date DESC);
CREATE INDEX IF NOT EXISTS idx_router_user_stats_router_date ON router_user_stats(router_id, date DESC);

-- ============================================================================
-- IRONWIFI WEBHOOK AND GUEST CACHE TABLES
-- ============================================================================

-- Webhook log for debugging
CREATE TABLE IF NOT EXISTS ironwifi_webhook_log (
  id SERIAL PRIMARY KEY,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_type VARCHAR(100),
  record_count INTEGER DEFAULT 0,
  raw_sample TEXT,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ironwifi_webhook_log_received ON ironwifi_webhook_log(received_at DESC);

-- Cached guest data from IronWifi API
-- NOTE: New columns (client_mac, ap_mac, router_id, etc.) are added via migration 024
-- to handle existing databases that don't have these columns yet
CREATE TABLE IF NOT EXISTS ironwifi_guests (
  id SERIAL PRIMARY KEY,
  ironwifi_id VARCHAR(100) UNIQUE NOT NULL,
  username VARCHAR(255),
  email VARCHAR(255),
  fullname VARCHAR(255),
  firstname VARCHAR(100),
  lastname VARCHAR(100),
  phone VARCHAR(50),
  auth_date TIMESTAMP,
  creation_date TIMESTAMP,
  source VARCHAR(255),
  owner_id VARCHAR(100),
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  auth_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Base indexes for ironwifi_guests (new column indexes are in migration 024)
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_username ON ironwifi_guests(username);
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_email ON ironwifi_guests(email);
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_auth_date ON ironwifi_guests(auth_date DESC);
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_last_seen ON ironwifi_guests(last_seen_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_oauth_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS oauth_tokens_updated_at ON oauth_tokens;
CREATE TRIGGER oauth_tokens_updated_at
BEFORE UPDATE ON oauth_tokens
FOR EACH ROW
EXECUTE FUNCTION update_oauth_tokens_updated_at();

-- ============================================================================
-- PARTITION MAINTENANCE FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION create_router_logs_partition_if_needed()
RETURNS void AS $$
DECLARE
  partition_name TEXT;
  partition_start DATE;
  partition_end DATE;
BEGIN
  -- Only run if router_logs is partitioned
  IF NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON pt.partrelid = c.oid
    WHERE c.relname = 'router_logs'
  ) THEN
    RETURN;
  END IF;

  -- Create partitions for current month, next month, and month after
  FOR i IN 0..2 LOOP
    partition_start := (date_trunc('month', CURRENT_DATE) + (i || ' month')::INTERVAL)::DATE;
    partition_end := (partition_start + INTERVAL '1 month')::DATE;
    partition_name := 'router_logs_' || to_char(partition_start, 'YYYY_MM');
    
    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = partition_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF router_logs FOR VALUES FROM (%L) TO (%L)',
        partition_name, partition_start, partition_end
      );
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
