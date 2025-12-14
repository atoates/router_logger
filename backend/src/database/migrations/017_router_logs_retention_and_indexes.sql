-- Migration: Router logs growth controls (indexes + archival tooling)
-- Created: 2025-12-11
--
-- Goals:
-- 1) Improve time-range query performance with a BRIN index on timestamp (cheap + scalable).
-- 2) Provide an optional archive table and a safe batch archiver for retention policies.

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- BRIN is excellent for append-mostly time-series tables and keeps index size small.
CREATE INDEX IF NOT EXISTS idx_router_logs_timestamp_brin
  ON router_logs USING brin (timestamp);

-- ---------------------------------------------------------------------------
-- Archive table (optional)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS router_logs_archive (LIKE router_logs INCLUDING ALL);

-- Avoid cascading deletes from routers -> archive; archive is historical and may outlive router rows.
-- Drop and recreate FK without cascade (best-effort; safe if already correct).
DO $$
BEGIN
  -- If the FK exists, replace it.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'router_logs_archive' AND c.contype = 'f'
  ) THEN
    ALTER TABLE router_logs_archive DROP CONSTRAINT IF EXISTS router_logs_archive_router_id_fkey;
  END IF;
  ALTER TABLE router_logs_archive
    ADD CONSTRAINT router_logs_archive_router_id_fkey
    FOREIGN KEY (router_id) REFERENCES routers(router_id);
EXCEPTION WHEN others THEN
  -- If constraint manipulation fails (e.g., differing names), ignore; table is still usable.
END $$;

CREATE INDEX IF NOT EXISTS idx_router_logs_archive_router_ts
  ON router_logs_archive (router_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_router_logs_archive_timestamp_brin
  ON router_logs_archive USING brin (timestamp);

-- ---------------------------------------------------------------------------
-- Batch archiver function
-- ---------------------------------------------------------------------------
-- Moves rows older than a cutoff into archive, then deletes them from router_logs.
-- Use small batches to avoid long locks and massive WAL spikes.
CREATE OR REPLACE FUNCTION archive_router_logs(p_cutoff TIMESTAMPTZ, p_batch_size INTEGER DEFAULT 50000)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_moved INTEGER := 0;
BEGIN
  WITH to_move AS (
    SELECT *
    FROM router_logs
    WHERE timestamp < p_cutoff
    ORDER BY timestamp
    LIMIT GREATEST(p_batch_size, 1)
  ),
  inserted AS (
    INSERT INTO router_logs_archive
    SELECT * FROM to_move
    ON CONFLICT DO NOTHING
    RETURNING 1
  ),
  deleted AS (
    DELETE FROM router_logs
    WHERE id IN (SELECT id FROM to_move)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_moved FROM deleted;

  RETURN v_moved;
END;
$$;

COMMENT ON FUNCTION archive_router_logs IS
  'Archive router_logs rows older than cutoff into router_logs_archive in batches; returns number of rows moved.';



