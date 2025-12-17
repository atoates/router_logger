-- Migration 026: Fix ironwifi_guests.router_id column type
-- The router_id in routers table is VARCHAR(255), but in ironwifi_guests it was INTEGER
-- This causes type mismatch errors on JOINs and "out of range for integer" on inserts

-- Step 1: Drop the index that depends on the column
DROP INDEX IF EXISTS idx_ironwifi_guests_router_id;

-- Step 2: Change the column type from INTEGER to VARCHAR(255)
-- Use ALTER TABLE with USING clause to convert existing data
ALTER TABLE ironwifi_guests 
ALTER COLUMN router_id TYPE VARCHAR(255) 
USING router_id::VARCHAR(255);

-- Step 3: Recreate the index
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_router_id ON ironwifi_guests(router_id);

-- Add a comment for documentation
COMMENT ON COLUMN ironwifi_guests.router_id IS 'References routers.router_id (VARCHAR) - matches RMS device ID';
