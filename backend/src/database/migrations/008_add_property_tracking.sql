-- Migration 008: Add router-property tracking

-- Table to track historical property assignments for routers
CREATE TABLE IF NOT EXISTS router_property_assignments (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(50) NOT NULL,
  property_clickup_task_id VARCHAR(50) NOT NULL,
  property_name VARCHAR(255),
  installed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TIMESTAMP,
  notes TEXT,
  installed_by VARCHAR(100),
  removed_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign key to routers table
  CONSTRAINT fk_router_property_router 
    FOREIGN KEY (router_id) 
    REFERENCES routers(router_id) 
    ON DELETE CASCADE,
  
  -- Ensure valid date range
  CONSTRAINT check_property_dates 
    CHECK (removed_at IS NULL OR removed_at >= installed_at)
);

-- Index for finding assignments by router
CREATE INDEX IF NOT EXISTS idx_property_assignments_router 
  ON router_property_assignments(router_id);

-- Index for finding assignments by property
CREATE INDEX IF NOT EXISTS idx_property_assignments_property 
  ON router_property_assignments(property_clickup_task_id);

-- Index for finding current assignments (where removed_at is NULL)
CREATE INDEX IF NOT EXISTS idx_property_assignments_current 
  ON router_property_assignments(router_id, removed_at);

-- Unique constraint: only one active assignment per router
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_assignment 
  ON router_property_assignments(router_id) 
  WHERE removed_at IS NULL;

-- Add current property columns to routers table (denormalized for quick access)
ALTER TABLE routers 
  ADD COLUMN IF NOT EXISTS current_property_task_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS current_property_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS property_installed_at TIMESTAMP;

-- Index for current property lookups
CREATE INDEX IF NOT EXISTS idx_routers_current_property 
  ON routers(current_property_task_id);

-- Comments for documentation
COMMENT ON TABLE router_property_assignments IS 'Historical tracking of router installations at properties. NULL removed_at means currently installed.';
COMMENT ON COLUMN router_property_assignments.router_id IS 'Router identifier from routers table';
COMMENT ON COLUMN router_property_assignments.property_clickup_task_id IS 'ClickUp task ID of the property';
COMMENT ON COLUMN router_property_assignments.property_name IS 'Cached property name for quick display';
COMMENT ON COLUMN router_property_assignments.installed_at IS 'When router was installed at this property';
COMMENT ON COLUMN router_property_assignments.removed_at IS 'When router was removed (NULL = currently installed)';
COMMENT ON COLUMN router_property_assignments.notes IS 'Installation/removal notes';
COMMENT ON COLUMN router_property_assignments.installed_by IS 'Who installed the router';
COMMENT ON COLUMN router_property_assignments.removed_by IS 'Who removed the router';

COMMENT ON COLUMN routers.current_property_task_id IS 'ClickUp task ID of current property (denormalized for performance)';
COMMENT ON COLUMN routers.current_property_name IS 'Name of current property (denormalized for performance)';
COMMENT ON COLUMN routers.property_installed_at IS 'When router was installed at current property';
