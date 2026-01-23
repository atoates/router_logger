-- Migration: Add extended_offline_alert_sent_at column
-- Purpose: Track when we last sent a 24-hour offline alert to the property task
--          to prevent duplicate alerts during the same offline period

-- Add the tracking column
ALTER TABLE routers 
ADD COLUMN IF NOT EXISTS extended_offline_alert_sent_at TIMESTAMP WITH TIME ZONE;

-- Add a comment for documentation
COMMENT ON COLUMN routers.extended_offline_alert_sent_at IS 
  'Timestamp when the last 24h offline alert was sent to the property task. Reset when router comes back online.';

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_routers_extended_offline_alert 
ON routers(extended_offline_alert_sent_at) 
WHERE extended_offline_alert_sent_at IS NOT NULL;
