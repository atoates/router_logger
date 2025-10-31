-- Migration 009: Add out-of-service tracking

-- Add columns to routers table for tracking routers in storage
ALTER TABLE routers 
  ADD COLUMN IF NOT EXISTS service_status VARCHAR(50) DEFAULT 'in-service',
  ADD COLUMN IF NOT EXISTS stored_with VARCHAR(50),
  ADD COLUMN IF NOT EXISTS out_of_service_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS out_of_service_reason TEXT,
  ADD COLUMN IF NOT EXISTS out_of_service_notes TEXT;

-- Index for filtering by service status
CREATE INDEX IF NOT EXISTS idx_routers_service_status 
  ON routers(service_status);

-- Index for finding routers stored with specific person
CREATE INDEX IF NOT EXISTS idx_routers_stored_with 
  ON routers(stored_with) 
  WHERE service_status = 'out-of-service';

-- Check constraint for valid service status
ALTER TABLE routers 
  ADD CONSTRAINT IF NOT EXISTS check_service_status 
  CHECK (service_status IN ('in-service', 'out-of-service'));

-- Check constraint for valid stored_with person
ALTER TABLE routers 
  ADD CONSTRAINT IF NOT EXISTS check_stored_with 
  CHECK (stored_with IS NULL OR stored_with IN ('Jordan', 'Ali', 'Karl'));

-- Comments for documentation
COMMENT ON COLUMN routers.service_status IS 'Current service status: in-service or out-of-service';
COMMENT ON COLUMN routers.stored_with IS 'Person currently storing the router (Jordan, Ali, or Karl) when out-of-service';
COMMENT ON COLUMN routers.out_of_service_date IS 'When router was taken out of service';
COMMENT ON COLUMN routers.out_of_service_reason IS 'Reason for taking router out of service';
COMMENT ON COLUMN routers.out_of_service_notes IS 'Additional notes about out-of-service status';
