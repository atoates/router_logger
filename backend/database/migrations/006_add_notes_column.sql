-- Add notes column to routers table
ALTER TABLE routers ADD COLUMN IF NOT EXISTS notes TEXT;
