-- Migration 021: Database Schema Sync and Fixes
-- This migration brings schema.sql into sync with reality and fixes issues:
-- 1. Add missing users table
-- 2. Add missing user_router_assignments table
-- 3. Add missing user_login_history table
-- 4. Add missing router_property_assignments table
-- 5. Add missing router_locations table (if not exists)
-- 6. Add missing settings table
-- 7. Remove hardcoded stored_with constraint
-- 8. Add partition maintenance function for router_logs

-- ============================================================================
-- 1. USERS TABLE (missing from schema.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'guest')),
  email VARCHAR(255),
  full_name VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  created_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active) WHERE is_active = true;

-- ============================================================================
-- 2. USER_ROUTER_ASSIGNMENTS TABLE (missing from schema.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_router_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  router_id VARCHAR(255) NOT NULL REFERENCES routers(router_id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_by INTEGER REFERENCES users(id),
  notes TEXT,
  UNIQUE(user_id, router_id)
);

CREATE INDEX IF NOT EXISTS idx_user_router_assignments_user ON user_router_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_router_assignments_router ON user_router_assignments(router_id);

-- ============================================================================
-- 3. USER_LOGIN_HISTORY TABLE (missing from schema.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_login_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_user_login_history_user ON user_login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_login_history_time ON user_login_history(login_at DESC);

-- ============================================================================
-- 4. ROUTER_PROPERTY_ASSIGNMENTS TABLE (missing from schema.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS router_property_assignments (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(50) NOT NULL REFERENCES routers(router_id) ON DELETE CASCADE,
  property_clickup_task_id VARCHAR(50),
  property_name VARCHAR(255),
  installed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TIMESTAMP,
  notes TEXT,
  installed_by VARCHAR(100),
  removed_by VARCHAR(100),
  assignment_type VARCHAR(20) DEFAULT 'property',
  stored_with_user_id VARCHAR(50),
  stored_with_username VARCHAR(100),
  event_type VARCHAR(20),
  event_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_property_assignments_router ON router_property_assignments(router_id);
CREATE INDEX IF NOT EXISTS idx_property_assignments_property ON router_property_assignments(property_clickup_task_id);
CREATE INDEX IF NOT EXISTS idx_property_assignments_current ON router_property_assignments(router_id, removed_at);

-- ============================================================================
-- 5. ROUTER_LOCATIONS TABLE (added in migration 019, ensure exists)
-- ============================================================================
CREATE TABLE IF NOT EXISTS router_locations (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(255) NOT NULL REFERENCES routers(router_id) ON DELETE CASCADE,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  accuracy INTEGER,
  cell_id VARCHAR(50),
  tac VARCHAR(50),
  lac VARCHAR(50),
  mcc VARCHAR(10),
  mnc VARCHAR(10),
  operator VARCHAR(100),
  network_type VARCHAR(50),
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP,
  sample_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_router_locations_router_id ON router_locations(router_id);
CREATE INDEX IF NOT EXISTS idx_router_locations_started_at ON router_locations(started_at);
CREATE INDEX IF NOT EXISTS idx_router_locations_active ON router_locations(router_id) WHERE ended_at IS NULL;

-- ============================================================================
-- 6. SETTINGS TABLE (created in init.js but missing from schema.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 7. MIGRATIONS TABLE (for tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 8. REMOVE HARDCODED stored_with CONSTRAINT
-- ============================================================================
ALTER TABLE routers DROP CONSTRAINT IF EXISTS check_stored_with;

-- ============================================================================
-- 9. ADD MISSING COLUMNS TO ROUTERS TABLE (from various migrations)
-- ============================================================================
ALTER TABLE routers ADD COLUMN IF NOT EXISTS mac_address VARCHAR(50);
ALTER TABLE routers ADD COLUMN IF NOT EXISTS service_status VARCHAR(50) DEFAULT 'in-service';
ALTER TABLE routers ADD COLUMN IF NOT EXISTS stored_with VARCHAR(50);
ALTER TABLE routers ADD COLUMN IF NOT EXISTS out_of_service_date TIMESTAMP;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS out_of_service_reason TEXT;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS out_of_service_notes TEXT;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS current_property_task_id VARCHAR(50);
ALTER TABLE routers ADD COLUMN IF NOT EXISTS current_property_name VARCHAR(255);
ALTER TABLE routers ADD COLUMN IF NOT EXISTS property_installed_at TIMESTAMP;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS stored_with_user_id VARCHAR(50);
ALTER TABLE routers ADD COLUMN IF NOT EXISTS stored_with_username VARCHAR(100);
ALTER TABLE routers ADD COLUMN IF NOT EXISTS current_state VARCHAR(20) DEFAULT 'unassigned';
ALTER TABLE routers ADD COLUMN IF NOT EXISTS state_updated_at TIMESTAMP;

-- ============================================================================
-- 10. ADD MISSING COLUMNS TO ROUTER_LOGS TABLE (from migrations)
-- ============================================================================
ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS earfcn INTEGER;
ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS pc_id INTEGER;

-- ============================================================================
-- 11. PARTITION MAINTENANCE FUNCTION FOR ROUTER_LOGS
-- ============================================================================
CREATE OR REPLACE FUNCTION create_router_logs_partition_if_needed()
RETURNS void AS $$
DECLARE
  partition_name TEXT;
  partition_start DATE;
  partition_end DATE;
  next_month DATE;
BEGIN
  -- Check if router_logs is partitioned
  IF NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON pt.partrelid = c.oid
    WHERE c.relname = 'router_logs'
  ) THEN
    RAISE NOTICE 'router_logs is not partitioned, skipping partition creation';
    RETURN;
  END IF;

  -- Create partition for current month if it doesn't exist
  partition_start := date_trunc('month', CURRENT_DATE)::DATE;
  partition_end := (partition_start + INTERVAL '1 month')::DATE;
  partition_name := 'router_logs_' || to_char(partition_start, 'YYYY_MM');
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = partition_name AND n.nspname = 'public'
  ) THEN
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF router_logs FOR VALUES FROM (%L) TO (%L)',
      partition_name, partition_start, partition_end
    );
    RAISE NOTICE 'Created partition: %', partition_name;
  END IF;
  
  -- Create partition for next month if it doesn't exist
  next_month := partition_end;
  partition_start := next_month;
  partition_end := (partition_start + INTERVAL '1 month')::DATE;
  partition_name := 'router_logs_' || to_char(partition_start, 'YYYY_MM');
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = partition_name AND n.nspname = 'public'
  ) THEN
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF router_logs FOR VALUES FROM (%L) TO (%L)',
      partition_name, partition_start, partition_end
    );
    RAISE NOTICE 'Created partition for next month: %', partition_name;
  END IF;
  
  -- Create partition for month after next (always have 2 months ahead)
  next_month := partition_end;
  partition_start := next_month;
  partition_end := (partition_start + INTERVAL '1 month')::DATE;
  partition_name := 'router_logs_' || to_char(partition_start, 'YYYY_MM');
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = partition_name AND n.nspname = 'public'
  ) THEN
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF router_logs FOR VALUES FROM (%L) TO (%L)',
      partition_name, partition_start, partition_end
    );
    RAISE NOTICE 'Created partition for 2 months ahead: %', partition_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Run partition maintenance now
SELECT create_router_logs_partition_if_needed();

-- ============================================================================
-- 12. CLEAN UP REDUNDANT INDEXES
-- ============================================================================
-- idx_router_logs_router_id is covered by idx_router_logs_router_timestamp
-- idx_router_logs_timestamp is covered by idx_router_logs_ts
-- However, we keep them for now as dropping indexes on large tables is expensive
-- and they may still serve specific query patterns

-- Just document the redundancy for now:
COMMENT ON INDEX idx_router_logs_router_id IS 'Consider removing - covered by idx_router_logs_router_timestamp';
COMMENT ON INDEX idx_router_logs_timestamp IS 'Consider removing - covered by idx_router_logs_ts';

-- ============================================================================
-- SUCCESS
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 021 complete: Schema synchronized and fixes applied';
END $$;
