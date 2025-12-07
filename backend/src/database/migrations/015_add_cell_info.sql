-- Add EARFCN and Physical Cell ID to router_logs
ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS earfcn VARCHAR(20);
ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS pc_id VARCHAR(20);
