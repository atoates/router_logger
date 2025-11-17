-- Migration 014: Database Performance Optimizations
-- Date: 2025-01-XX
-- Description: Add missing indexes and constraints for better query performance

-- 1. Add missing index on routers.last_seen (HIGH PRIORITY)
-- Used for ordering in getAllRouters() and other router list queries
CREATE INDEX IF NOT EXISTS idx_routers_last_seen 
ON routers(last_seen DESC NULLS LAST);

-- 2. Add index on routers.clickup_task_status (MEDIUM PRIORITY)
-- Used for filtering decommissioned/returned routers
CREATE INDEX IF NOT EXISTS idx_routers_task_status 
ON routers(clickup_task_status) 
WHERE clickup_task_status IS NOT NULL;

-- 3. Add indexes on router_logs for common filters (MEDIUM PRIORITY)
-- Used for status filtering and operator distribution queries
CREATE INDEX IF NOT EXISTS idx_router_logs_status 
ON router_logs(status) 
WHERE status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_router_logs_operator 
ON router_logs(operator) 
WHERE operator IS NOT NULL;

-- Composite index for router + status queries
CREATE INDEX IF NOT EXISTS idx_router_logs_router_status 
ON router_logs(router_id, status, timestamp DESC);

-- 4. Add check constraint for clickup_task_status (MEDIUM PRIORITY)
-- Ensures data integrity for status values
ALTER TABLE routers 
DROP CONSTRAINT IF EXISTS check_task_status;

ALTER TABLE routers 
ADD CONSTRAINT check_task_status 
CHECK (
  clickup_task_status IN (
    'installed', 
    'ready', 
    'needs attention', 
    'being returned', 
    'decommissioned'
  ) OR clickup_task_status IS NULL
);

-- 5. Add index on routers.name for search queries (LOW PRIORITY)
-- Used in router search/filter operations
CREATE INDEX IF NOT EXISTS idx_routers_name 
ON routers(name) 
WHERE name IS NOT NULL;

-- 6. Analyze tables to update statistics for query planner
ANALYZE routers;
ANALYZE router_logs;
ANALYZE router_property_assignments;
ANALYZE inspection_logs;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 014 complete: Database optimizations applied';
END $$;

