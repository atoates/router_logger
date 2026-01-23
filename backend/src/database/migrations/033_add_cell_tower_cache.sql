-- Migration: Add cell_tower_cache table for persistent geolocation caching
-- This saves Unwired Labs API calls by caching cell tower coordinates
-- Cell towers don't move, so this cache never expires

CREATE TABLE IF NOT EXISTS cell_tower_cache (
  id SERIAL PRIMARY KEY,
  cache_key VARCHAR(100) NOT NULL UNIQUE, -- Format: {mcc}-{mnc}-{lac/tac}-{cell_id}
  mcc VARCHAR(10) NOT NULL,
  mnc VARCHAR(10) NOT NULL,
  lac_or_tac VARCHAR(20) NOT NULL,
  cell_id VARCHAR(50) NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  accuracy INTEGER,
  radio_type VARCHAR(10), -- gsm, umts, lte
  source VARCHAR(50) DEFAULT 'unwiredlabs',
  hit_count INTEGER DEFAULT 1, -- Track how often this tower is used
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_cell_tower_cache_key ON cell_tower_cache(cache_key);

-- Comments for documentation
COMMENT ON TABLE cell_tower_cache IS 'Persistent cache of cell tower coordinates from Unwired Labs API';
COMMENT ON COLUMN cell_tower_cache.cache_key IS 'Unique key: {mcc}-{mnc}-{lac_or_tac}-{cell_id}';
COMMENT ON COLUMN cell_tower_cache.hit_count IS 'Number of times this cache entry was used';
