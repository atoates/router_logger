-- Add current_status column to routers table
-- This column tracks the online/offline status from RMS sync

-- Add the column if it doesn't exist
ALTER TABLE routers ADD COLUMN IF NOT EXISTS current_status VARCHAR(50) DEFAULT 'unknown';

-- Also add operator and wan_ip if missing (used by RMS sync)
ALTER TABLE routers ADD COLUMN IF NOT EXISTS operator VARCHAR(100);
ALTER TABLE routers ADD COLUMN IF NOT EXISTS wan_ip VARCHAR(50);

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_routers_current_status ON routers(current_status);

-- Update existing routers based on last_seen
-- If last_seen within 10 minutes, assume online
UPDATE routers 
SET current_status = CASE 
  WHEN last_seen > NOW() - INTERVAL '10 minutes' THEN 'online'
  ELSE 'offline'
END
WHERE current_status IS NULL OR current_status = 'unknown';

