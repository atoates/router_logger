-- Migration: Cleanup deprecated IronWifi tables and add performance indexes
-- 
-- 1. Remove deprecated IronWifi tables (replaced by self-hosted RADIUS)
-- 2. Add missing indexes on wifi_guest_sessions
-- 3. Add JSONB index for router metadata queries

-- =====================================================
-- Drop Deprecated IronWifi Tables
-- =====================================================

-- These tables are no longer used since switching to self-hosted RADIUS
DROP TABLE IF EXISTS ironwifi_events CASCADE;
DROP TABLE IF EXISTS ironwifi_webhook_log CASCADE;
DROP TABLE IF EXISTS ironwifi_sessions CASCADE;
DROP TABLE IF EXISTS ironwifi_guests CASCADE;

COMMENT ON SCHEMA public IS 'Removed deprecated IronWifi tables - now using self-hosted RADIUS';

-- =====================================================
-- Add Missing Indexes on wifi_guest_sessions
-- =====================================================

-- Index for router_mac lookups (linking guests to routers by MAC)
CREATE INDEX IF NOT EXISTS idx_wifi_sessions_router_mac ON wifi_guest_sessions(router_mac);

-- Index for email lookups (finding guest sessions by email)
CREATE INDEX IF NOT EXISTS idx_wifi_sessions_email ON wifi_guest_sessions(email);

-- Partial index for active sessions (WHERE session_end IS NULL)
-- This significantly speeds up queries for currently active sessions
CREATE INDEX IF NOT EXISTS idx_wifi_sessions_active ON wifi_guest_sessions(session_start DESC) 
  WHERE session_end IS NULL;

COMMENT ON INDEX idx_wifi_sessions_router_mac IS 'Fast lookup of guest sessions by router MAC address';
COMMENT ON INDEX idx_wifi_sessions_email IS 'Fast lookup of guest sessions by email';
COMMENT ON INDEX idx_wifi_sessions_active IS 'Partial index for active sessions only - faster than full table scan';

-- =====================================================
-- Add JSONB Metadata Column and Index to Routers
-- =====================================================

-- Add metadata JSONB column if it doesn't exist
ALTER TABLE routers ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

COMMENT ON COLUMN routers.metadata IS 'Flexible JSONB storage for custom router metadata and extended properties';

-- GIN index on metadata JSONB column for fast queries filtering by metadata fields
-- This speeds up queries like: WHERE metadata @> '{"key": "value"}'
CREATE INDEX IF NOT EXISTS idx_routers_metadata_gin ON routers USING gin(metadata);

COMMENT ON INDEX idx_routers_metadata_gin IS 'GIN index for fast JSONB metadata queries on routers table';

-- Example queries that benefit from this index:
-- SELECT * FROM routers WHERE metadata @> '{"deployment_status": "active"}';
-- SELECT * FROM routers WHERE metadata ? 'custom_field';
-- SELECT * FROM routers WHERE metadata @> '{"location": {"building": "HQ"}}';
