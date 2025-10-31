-- Migration 010: Add stored_with tracking to property assignments

-- Add stored_with fields to track storage events in history
ALTER TABLE router_property_assignments
  ADD COLUMN IF NOT EXISTS assignment_type VARCHAR(20) DEFAULT 'property' CHECK (assignment_type IN ('property', 'storage')),
  ADD COLUMN IF NOT EXISTS stored_with_user_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS stored_with_username VARCHAR(100);

-- Index for finding storage records
CREATE INDEX IF NOT EXISTS idx_property_assignments_type 
  ON router_property_assignments(assignment_type);

-- Index for finding routers stored with specific users
CREATE INDEX IF NOT EXISTS idx_property_assignments_stored_with 
  ON router_property_assignments(stored_with_user_id) 
  WHERE stored_with_user_id IS NOT NULL;

-- Comments
COMMENT ON COLUMN router_property_assignments.assignment_type IS 'Type of assignment: property (installed at location) or storage (stored with person)';
COMMENT ON COLUMN router_property_assignments.stored_with_user_id IS 'ClickUp user ID of person storing the router (for storage type)';
COMMENT ON COLUMN router_property_assignments.stored_with_username IS 'Username of person storing the router (for storage type)';

-- Add check constraint: storage type must have stored_with fields, property type must have property fields
ALTER TABLE router_property_assignments
  ADD CONSTRAINT IF NOT EXISTS check_assignment_type_fields
  CHECK (
    (assignment_type = 'property' AND property_clickup_task_id IS NOT NULL AND stored_with_user_id IS NULL) OR
    (assignment_type = 'storage' AND stored_with_user_id IS NOT NULL AND property_clickup_task_id IS NULL)
  );

-- Drop the old unique constraint that only allowed one active property assignment
DROP INDEX IF EXISTS idx_unique_active_assignment;

-- Create new unique constraint: only one active assignment per router (either property OR storage)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_assignment 
  ON router_property_assignments(router_id) 
  WHERE removed_at IS NULL;

-- Make property_clickup_task_id nullable since storage records won't have it
ALTER TABLE router_property_assignments
  ALTER COLUMN property_clickup_task_id DROP NOT NULL;

-- Add stored_with fields to routers table for current state
ALTER TABLE routers
  ADD COLUMN IF NOT EXISTS stored_with_user_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS stored_with_username VARCHAR(100);

-- Index for current stored_with lookups
CREATE INDEX IF NOT EXISTS idx_routers_stored_with_user 
  ON routers(stored_with_user_id);

-- Comments for routers table
COMMENT ON COLUMN routers.stored_with_user_id IS 'ClickUp user ID of person currently storing the router';
COMMENT ON COLUMN routers.stored_with_username IS 'Username of person currently storing the router';

-- Note: The old stored_with VARCHAR(50) column can be migrated or removed in a future migration
-- For now, we'll keep both to maintain backwards compatibility
