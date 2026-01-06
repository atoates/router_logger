-- Migration: Add data consumption tracking to wifi_guest_sessions
-- Date: 2026-01-07

-- Add columns for tracking data usage per guest session
ALTER TABLE wifi_guest_sessions
ADD COLUMN IF NOT EXISTS bytes_uploaded BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS bytes_downloaded BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS bytes_total BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_accounting_update TIMESTAMP WITH TIME ZONE;

-- Create index for data usage queries
CREATE INDEX IF NOT EXISTS idx_wifi_guest_sessions_bytes ON wifi_guest_sessions(bytes_total DESC);

-- Add comments
COMMENT ON COLUMN wifi_guest_sessions.bytes_uploaded IS 'Total bytes uploaded by guest (from RADIUS accounting)';
COMMENT ON COLUMN wifi_guest_sessions.bytes_downloaded IS 'Total bytes downloaded by guest (from RADIUS accounting)';
COMMENT ON COLUMN wifi_guest_sessions.bytes_total IS 'Total bytes (upload + download)';
COMMENT ON COLUMN wifi_guest_sessions.last_accounting_update IS 'Last time accounting data was updated';
