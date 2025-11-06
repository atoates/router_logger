-- Migration 013: Add date_installed column to routers table
-- Store the installation date locally instead of fetching from ClickUp on every request

ALTER TABLE routers
  ADD COLUMN IF NOT EXISTS date_installed BIGINT;

COMMENT ON COLUMN routers.date_installed IS 'Unix timestamp in milliseconds when router was installed at location (synced from ClickUp Date Installed custom field)';

-- Create index for date queries
CREATE INDEX IF NOT EXISTS idx_routers_date_installed
  ON routers(date_installed)
  WHERE date_installed IS NOT NULL;
