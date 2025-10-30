-- Migration 007: Add ClickUp integration support

-- Add ClickUp fields to routers table
ALTER TABLE routers 
  ADD COLUMN IF NOT EXISTS clickup_task_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS clickup_task_url TEXT,
  ADD COLUMN IF NOT EXISTS clickup_list_id VARCHAR(50);

-- Create index for ClickUp task lookups
CREATE INDEX IF NOT EXISTS idx_routers_clickup_task 
  ON routers(clickup_task_id);

-- Create table for ClickUp OAuth tokens (separate from RMS tokens)
CREATE TABLE IF NOT EXISTS clickup_oauth_tokens (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  access_token TEXT NOT NULL,
  token_type VARCHAR(50) DEFAULT 'Bearer',
  workspace_id VARCHAR(50),
  workspace_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

-- Create index for token lookups
CREATE INDEX IF NOT EXISTS idx_clickup_tokens_user 
  ON clickup_oauth_tokens(user_id);

-- Comments for documentation
COMMENT ON COLUMN routers.clickup_task_id IS 'ClickUp task ID linked to this router';
COMMENT ON COLUMN routers.clickup_task_url IS 'Direct URL to the linked ClickUp task';
COMMENT ON COLUMN routers.clickup_list_id IS 'ClickUp list ID where the task belongs';
COMMENT ON TABLE clickup_oauth_tokens IS 'OAuth tokens for ClickUp API access';
