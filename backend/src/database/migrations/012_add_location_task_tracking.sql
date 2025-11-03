-- Migration 012: Add location task tracking
-- New architecture: Router is EITHER at a location (linked to location task) OR with a person (assignee)

-- Add location task fields to routers table
ALTER TABLE routers
  ADD COLUMN IF NOT EXISTS clickup_location_task_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS clickup_location_task_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS location_linked_at TIMESTAMP;

-- Create index for location task lookups
CREATE INDEX IF NOT EXISTS idx_routers_location_task
  ON routers(clickup_location_task_id)
  WHERE clickup_location_task_id IS NOT NULL;

-- Add constraint: Router cannot have BOTH a location task AND an assignee
-- (This is a soft rule enforced in application logic, not DB constraint, 
--  because we need flexibility during transitions)

COMMENT ON COLUMN routers.clickup_location_task_id IS 'ClickUp task ID for the physical location where this router is installed';
COMMENT ON COLUMN routers.clickup_location_task_name IS 'Name/description of the location (cached from ClickUp)';
COMMENT ON COLUMN routers.location_linked_at IS 'Timestamp when router was linked to current location';

-- Add event types for location tracking
COMMENT ON TABLE router_property_assignments IS 'Event-based tracking for router assignments: property (location), storage (person), inspection, etc.';

-- Note: When a router is linked to a location task:
--   - clickup_location_task_id should be set
--   - Task assignees should be cleared (managed in application)
--   - stored_with_user_id should be NULL
-- When a router is unlinked from location:
--   - clickup_location_task_id should be NULL
--   - If router is out-of-service, assignee should be added back (managed in application)
