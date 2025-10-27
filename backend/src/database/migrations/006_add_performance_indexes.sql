-- Add performance indexes for common query patterns
-- Migration 006: Performance indexes for router_logs and inspection_logs

-- Index for router-specific log queries (most common pattern)
-- Used by: getLogs, getUsageStats, getUptimeData, rolling queries
CREATE INDEX IF NOT EXISTS idx_router_logs_router_ts 
ON router_logs (router_id, timestamp DESC);

-- Index for time-based queries across all routers
-- Used by: getNetworkUsageByDay, getNetworkUsageRolling, operator distribution
CREATE INDEX IF NOT EXISTS idx_router_logs_timestamp 
ON router_logs (timestamp DESC);

-- Index for inspection history queries
-- Used by: getInspectionHistory, getInspectionStatus
CREATE INDEX IF NOT EXISTS idx_inspection_logs_router_ts 
ON inspection_logs (router_id, inspected_at DESC);

-- Partial index for recent logs (last 90 days) - optional optimization
-- Speeds up dashboard queries that focus on recent data
CREATE INDEX IF NOT EXISTS idx_router_logs_recent 
ON router_logs (timestamp DESC) 
WHERE timestamp > NOW() - INTERVAL '90 days';

-- Analyze tables after index creation to update statistics
ANALYZE router_logs;
ANALYZE inspection_logs;
