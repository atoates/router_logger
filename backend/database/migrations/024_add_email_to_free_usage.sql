-- Migration: Add email column to captive_free_usage
-- This allows tracking email alongside MAC address for reference
-- The primary tracking is now by MAC address (device-level limits)

-- Add email column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'captive_free_usage' AND column_name = 'email'
    ) THEN
        ALTER TABLE captive_free_usage ADD COLUMN email VARCHAR(255);
    END IF;
END $$;

-- Add index on email for lookup
CREATE INDEX IF NOT EXISTS idx_free_usage_email ON captive_free_usage(email);

-- Add comment
COMMENT ON COLUMN captive_free_usage.email IS 'User email (optional reference, primary tracking is by MAC)';
