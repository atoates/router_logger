-- Migration 010: Add stored_with tracking to property assignments

-- Drop old constraint that restricts stored_with values
ALTER TABLE routers 
  DROP CONSTRAINT IF EXISTS check_stored_with;

-- Make property_clickup_task_id nullable first (before adding constraints)
ALTER TABLE router_property_assignments
  ALTER COLUMN property_clickup_task_id DROP NOT NULL;

-- Add stored_with fields to track storage events in history
ALTER TABLE router_property_assignments
  ADD COLUMN IF NOT EXISTS assignment_type VARCHAR(20) DEFAULT 'property',
  ADD COLUMN IF NOT EXISTS stored_with_user_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS stored_with_username VARCHAR(100);

-- Update existing records to have assignment_type = 'property'
UPDATE router_property_assignments 
SET assignment_type = 'property' 
WHERE assignment_type IS NULL;

-- Add check constraint for assignment_type values
ALTER TABLE router_property_assignments
  ADD CONSTRAINT check_assignment_type_values 
  CHECK (assignment_type IN ('property', 'storage'));

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

-- Drop the old unique constraint that only allowed one active property assignment
DROP INDEX IF EXISTS idx_unique_active_assignment;

-- Create new unique constraint: only one active assignment per router (either property OR storage)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_assignment 
  ON router_property_assignments(router_id) 
  WHERE removed_at IS NULL;

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
