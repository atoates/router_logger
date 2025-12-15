-- Migration 023: Add IronWifi webhook log table for debugging
-- Tracks incoming webhook data to verify webhook is working

CREATE TABLE IF NOT EXISTS ironwifi_webhook_log (
  id SERIAL PRIMARY KEY,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_type VARCHAR(100),
  record_count INTEGER DEFAULT 0,
  raw_sample TEXT, -- First 5KB of webhook data for debugging
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for recent webhook lookups
CREATE INDEX IF NOT EXISTS idx_ironwifi_webhook_log_received ON ironwifi_webhook_log(received_at DESC);

-- Cleanup old entries (keep last 7 days)
-- This can be run periodically via cron or manually
COMMENT ON TABLE ironwifi_webhook_log IS 'Debug log for IronWifi webhook receipts - auto-cleanup after 7 days recommended';

-- Add ironwifi_guests table to cache guest data from API
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
  
  -- Metadata
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  auth_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for guest lookups
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_username ON ironwifi_guests(username);
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_email ON ironwifi_guests(email);
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_auth_date ON ironwifi_guests(auth_date DESC);
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_last_seen ON ironwifi_guests(last_seen_at DESC);

COMMENT ON TABLE ironwifi_guests IS 'Cached guest data from IronWifi API - reduces API calls';

