-- Migration: Add API call tracking table
-- Tracks API calls to external services (RMS, ClickUp) for quota monitoring
-- This persists across server restarts unlike in-memory tracking

CREATE TABLE IF NOT EXISTS api_call_log (
  id SERIAL PRIMARY KEY,
  service VARCHAR(50) NOT NULL, -- 'rms' or 'clickup'
  call_type VARCHAR(100), -- e.g., 'getDevices', 'updateTask', 'createComment'
  status_code INTEGER, -- HTTP status code
  timestamp TIMESTAMP DEFAULT NOW(),
  is_retry BOOLEAN DEFAULT FALSE,
  response_time_ms INTEGER -- Optional: track API performance
);

-- Index for fast 24-hour queries
CREATE INDEX idx_api_call_log_service_timestamp ON api_call_log(service, timestamp DESC);
CREATE INDEX idx_api_call_log_timestamp ON api_call_log(timestamp DESC);

-- Auto-delete logs older than 7 days (keep recent history only)
-- This can be run as a cron job or scheduled task
CREATE OR REPLACE FUNCTION cleanup_old_api_call_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM api_call_log 
  WHERE timestamp < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE api_call_log IS 'Tracks API calls to external services for quota monitoring and debugging';
COMMENT ON COLUMN api_call_log.service IS 'External service: rms, clickup, or other';
COMMENT ON COLUMN api_call_log.call_type IS 'Type of API call made';
COMMENT ON COLUMN api_call_log.status_code IS 'HTTP response status code';
COMMENT ON COLUMN api_call_log.is_retry IS 'Whether this was a retry attempt';
