-- Migration 018: Partition router_logs by month (RANGE on timestamp)
--
-- Strategy (safe-ish for production):
-- - Create a new partitioned parent table router_logs
-- - Create monthly partitions for recent months + a few months ahead
-- - Move only the most recent 3 months of rows into the monthly partitions
-- - Attach the remaining historical table as a single "legacy" partition
--
-- This gives partition pruning benefits for the hot data (last 90ish days)
-- without forcing a full-table rewrite/copy for the entire history.

DO $$
DECLARE
  v_is_partitioned BOOLEAN;
  v_cutoff TIMESTAMP;
  v_start TIMESTAMP;
  v_end TIMESTAMP;
  v_partition_name TEXT;
  v_months_ahead INT := 6;
  v_rows_moved BIGINT := 0;
  v_seq_name TEXT;
  v_max_id BIGINT;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'router_logs'
  ) INTO v_is_partitioned;

  IF v_is_partitioned THEN
    RAISE NOTICE 'Migration 018: router_logs is already partitioned; skipping.';
    RETURN;
  END IF;

  -- Start of month, two months ago => keeps last 3 calendar months "hot".
  v_cutoff := date_trunc('month', NOW() - INTERVAL '2 months');

  -- Keep the existing serial sequence (if any) so IDs remain unique-ish.
  v_seq_name := pg_get_serial_sequence('router_logs', 'id');

  -- Rename the existing table (and its existing indexes/constraints stay with it).
  ALTER TABLE router_logs RENAME TO router_logs__legacy;

  -- Drop legacy constraint names that would conflict with the new parent.
  -- (Constraint names are schema-global in Postgres.)
  EXECUTE 'ALTER TABLE router_logs__legacy DROP CONSTRAINT IF EXISTS router_logs_pkey';
  EXECUTE 'ALTER TABLE router_logs__legacy DROP CONSTRAINT IF EXISTS router_logs_router_id_fkey';

  -- Recreate router_logs as a partitioned parent with identical columns/defaults.
  -- NOTE: we intentionally do NOT carry over constraints from the legacy table,
  -- because its primary key (id) is not valid for a partitioned table.
  -- Use INCLUDING DEFAULTS only (not INCLUDING CONSTRAINTS) to avoid copying the old PK.
  EXECUTE 'CREATE TABLE router_logs (LIKE router_logs__legacy INCLUDING DEFAULTS) PARTITION BY RANGE (timestamp)';

  -- Constraints on the parent.
  -- Unique/PK constraints on partitioned tables must include the partition key.
  EXECUTE 'ALTER TABLE router_logs ADD CONSTRAINT router_logs_router_id_fkey FOREIGN KEY (router_id) REFERENCES routers(router_id) ON DELETE CASCADE';
  EXECUTE 'ALTER TABLE router_logs ADD CONSTRAINT router_logs_pkey PRIMARY KEY (id, timestamp)';

  -- Default partition as a safety net (future months not yet created).
  EXECUTE 'CREATE TABLE IF NOT EXISTS router_logs_default PARTITION OF router_logs DEFAULT';

  -- Create monthly partitions from cutoff through cutoff + months_ahead.
  v_start := v_cutoff;
  FOR i IN 0..v_months_ahead LOOP
    v_end := v_start + INTERVAL '1 month';
    v_partition_name := format('router_logs_%s', to_char(v_start, 'YYYY_MM'));

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF router_logs FOR VALUES FROM (%L) TO (%L)',
      v_partition_name,
      v_start,
      v_end
    );

    -- Per-partition indexes (keeps the migration from reindexing the entire legacy history).
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (router_id, timestamp DESC)',
      v_partition_name || '_router_ts',
      v_partition_name
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I USING brin (timestamp)',
      v_partition_name || '_ts_brin',
      v_partition_name
    );

    v_start := v_end;
  END LOOP;

  -- Move recent rows (>= cutoff) from legacy into the monthly partitions.
  -- This is the only data copy this migration performs.
  EXECUTE format(
    'INSERT INTO router_logs SELECT * FROM router_logs__legacy WHERE timestamp >= %L',
    v_cutoff
  );

  GET DIAGNOSTICS v_rows_moved = ROW_COUNT;

  EXECUTE format(
    'DELETE FROM router_logs__legacy WHERE timestamp >= %L',
    v_cutoff
  );

  -- Prepare legacy table for attach as a single historical partition.
  -- Ensure legacy conforms to its range before attaching.
  EXECUTE format(
    'ALTER TABLE router_logs__legacy ADD CONSTRAINT router_logs__legacy_ts_check CHECK (timestamp < %L)',
    v_cutoff
  );

  -- Attach as legacy partition for all history before cutoff.
  EXECUTE format(
    'ALTER TABLE router_logs ATTACH PARTITION router_logs__legacy FOR VALUES FROM (MINVALUE) TO (%L)',
    v_cutoff
  );

  -- Bump sequence to max(id) seen so new inserts don''t collide.
  IF v_seq_name IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(MAX(id), 0) FROM router_logs' INTO v_max_id;
    EXECUTE format('SELECT setval(%L, %s, true)', v_seq_name, GREATEST(v_max_id, 1));
  END IF;

  RAISE NOTICE 'Migration 018: Partitioned router_logs. cutoff=%, moved_recent_rows=%', v_cutoff, v_rows_moved;
END $$;
