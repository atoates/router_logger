-- Migration: Add User Authentication System
-- Created: 2025-11-10
-- Description: Adds users, router assignments, and login tracking

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'guest')),
  email VARCHAR(255),
  full_name VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  created_by INTEGER REFERENCES users(id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Router assignments for guest users
CREATE TABLE IF NOT EXISTS user_router_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  router_id VARCHAR(255) NOT NULL REFERENCES routers(router_id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_by INTEGER REFERENCES users(id),
  notes TEXT,
  UNIQUE(user_id, router_id)
);

-- Indexes for assignment queries
CREATE INDEX IF NOT EXISTS idx_assignments_user ON user_router_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_router ON user_router_assignments(router_id);

-- Login history tracking
CREATE TABLE IF NOT EXISTS user_login_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN DEFAULT TRUE
);

-- Index for history queries
CREATE INDEX IF NOT EXISTS idx_login_history_user ON user_login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_time ON user_login_history(login_at DESC);

-- Add updated_at trigger for users table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert 3 default admin users (passwords will be hashed in seed script)
-- Note: These are placeholder hashes, run seed script to set real passwords
INSERT INTO users (username, password_hash, role, full_name, is_active)
VALUES 
  ('admin1', '$2b$10$placeholder1', 'admin', 'Administrator 1', TRUE),
  ('admin2', '$2b$10$placeholder2', 'admin', 'Administrator 2', TRUE),
  ('admin3', '$2b$10$placeholder3', 'admin', 'Administrator 3', TRUE)
ON CONFLICT (username) DO NOTHING;

COMMENT ON TABLE users IS 'Application users with role-based access';
COMMENT ON TABLE user_router_assignments IS 'Maps guest users to specific routers they can access';
COMMENT ON TABLE user_login_history IS 'Tracks all login attempts for security and auditing';
