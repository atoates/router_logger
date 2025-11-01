-- Migration 011: Convert to event-based tracking
-- Transform router_property_assignments into an event log

-- Add event_type column to track what kind of event this is
ALTER TABLE router_property_assignments
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS event_date TIMESTAMP;

-- Make property_clickup_task_id nullable (storage events won't have this)
ALTER TABLE router_property_assignments
  ALTER COLUMN property_clickup_task_id DROP NOT NULL;

-- Add check constraint for valid event types
ALTER TABLE router_property_assignments
  DROP CONSTRAINT IF EXISTS check_event_type;

ALTER TABLE router_property_assignments
  ADD CONSTRAINT check_event_type 
  CHECK (event_type IN ('property_assign', 'property_remove', 'storage_assign', 'storage_remove'));

-- Backfill event_type and event_date for existing records
-- Records with removed_at NULL are current assignments (assign events)
-- Records with removed_at are historical removals (we'll create both assign and remove events)

-- First, backfill current property assignments as 'property_assign' events
UPDATE router_property_assignments 
SET event_type = 'property_assign',
    event_date = installed_at
WHERE event_type IS NULL 
  AND removed_at IS NULL 
  AND property_clickup_task_id IS NOT NULL;

-- For historical records (removed_at IS NOT NULL), we need to create TWO events:
-- 1. The assign event (keep the original record as-is)
-- 2. A remove event (we'll insert this)

-- Mark existing historical records as assign events
UPDATE router_property_assignments 
SET event_type = 'property_assign',
    event_date = installed_at
WHERE event_type IS NULL 
  AND removed_at IS NOT NULL 
  AND property_clickup_task_id IS NOT NULL;

-- Now insert corresponding remove events for historical records
INSERT INTO router_property_assignments 
  (router_id, event_type, event_date, property_clickup_task_id, property_name, notes, removed_by, created_at, updated_at)
SELECT 
  router_id,
  'property_remove' as event_type,
  removed_at as event_date,
  property_clickup_task_id,
  property_name,
  'Auto-generated remove event from migration' as notes,
  removed_by,
  removed_at as created_at,
  removed_at as updated_at
FROM router_property_assignments
WHERE event_type = 'property_assign'
  AND removed_at IS NOT NULL;

-- Now we can drop the old columns since we have events
-- Keep them for now for backward compatibility, but they're deprecated
-- Future migration can remove: removed_at, installed_at, installed_by, removed_by

-- Update routers table with current state tracking
ALTER TABLE routers
  ADD COLUMN IF NOT EXISTS current_state VARCHAR(20) DEFAULT 'unassigned',
  ADD COLUMN IF NOT EXISTS state_updated_at TIMESTAMP;

-- Add check constraint for current_state
ALTER TABLE routers
  DROP CONSTRAINT IF EXISTS check_current_state;

ALTER TABLE routers
  ADD CONSTRAINT check_current_state 
  CHECK (current_state IN ('installed', 'stored', 'unassigned'));

-- Backfill current_state based on service_status
UPDATE routers
SET current_state = CASE 
    WHEN service_status = 'out-of-service' THEN 'stored'
    WHEN current_property_task_id IS NOT NULL THEN 'installed'
    ELSE 'unassigned'
  END,
  state_updated_at = COALESCE(property_installed_at, out_of_service_date, CURRENT_TIMESTAMP)
WHERE current_state IS NULL OR current_state = 'unassigned';

-- Create indexes for event queries
CREATE INDEX IF NOT EXISTS idx_router_events_router_date 
  ON router_property_assignments(router_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_router_events_type 
  ON router_property_assignments(event_type);

CREATE INDEX IF NOT EXISTS idx_routers_current_state 
  ON routers(current_state);

-- Comments
COMMENT ON COLUMN router_property_assignments.event_type IS 'Type of event: property_assign, property_remove, storage_assign, storage_remove';
COMMENT ON COLUMN router_property_assignments.event_date IS 'When this event occurred';
COMMENT ON COLUMN routers.current_state IS 'Current router state: installed (at property), stored (with person), or unassigned';
COMMENT ON COLUMN routers.state_updated_at IS 'When the current state was last updated';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 011 complete: Converted to event-based tracking';
END $$;
