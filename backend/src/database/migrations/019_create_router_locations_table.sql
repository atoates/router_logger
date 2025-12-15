-- Migration: Create router_locations table for tracking location history
-- This table stores unique locations for each router with start/end times
-- A new record is only created when the router's location changes significantly

-- Create router_locations table
CREATE TABLE IF NOT EXISTS router_locations (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(255) NOT NULL REFERENCES routers(router_id) ON DELETE CASCADE,
  
  -- Location coordinates
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  accuracy INTEGER, -- meters
  
  -- Cell tower info used to determine location
  cell_id VARCHAR(50),
  tac VARCHAR(50),
  lac VARCHAR(50),
  mcc VARCHAR(10),
  mnc VARCHAR(10),
  operator VARCHAR(100),
  network_type VARCHAR(50),
  
  -- Time tracking
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP, -- NULL means current/active location
  
  -- Metadata
  sample_count INTEGER DEFAULT 1, -- How many telemetry samples at this location
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_router_locations_router_id ON router_locations(router_id);
CREATE INDEX IF NOT EXISTS idx_router_locations_started_at ON router_locations(started_at);
CREATE INDEX IF NOT EXISTS idx_router_locations_ended_at ON router_locations(ended_at);
CREATE INDEX IF NOT EXISTS idx_router_locations_active ON router_locations(router_id) WHERE ended_at IS NULL;

-- Composite index for time range queries
CREATE INDEX IF NOT EXISTS idx_router_locations_router_time ON router_locations(router_id, started_at DESC, ended_at);

-- Comments
COMMENT ON TABLE router_locations IS 'Tracks router location history - new record only on significant location change';
COMMENT ON COLUMN router_locations.ended_at IS 'NULL indicates this is the current/active location';
COMMENT ON COLUMN router_locations.sample_count IS 'Number of telemetry samples received while at this location';
