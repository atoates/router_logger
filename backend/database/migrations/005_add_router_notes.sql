-- Add notes column to routers table for tracking return information
ALTER TABLE routers ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add index on clickup_task_status for faster filtering
CREATE INDEX IF NOT EXISTS idx_routers_clickup_task_status ON routers(clickup_task_status);
