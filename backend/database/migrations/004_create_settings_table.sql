-- Create settings table for system configuration
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default value for smart sync (enabled by default)
INSERT INTO settings (key, value, description)
VALUES ('smart_sync_enabled', 'true', 'Enable smart sync to skip ClickUp updates for routers that haven''t changed')
ON CONFLICT (key) DO NOTHING;
