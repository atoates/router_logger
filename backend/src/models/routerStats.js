/**
 * Router Statistics Model
 * Contains all statistics and reporting queries for router data
 */

const { pool, logger } = require('../config/database');

/**
 * Compute storage-related stats:
 * - totalRouters, totalLogs
 * - logsPerDay7, logsPerDay30
 * - avgLogJsonSizeBytes, estimatedCurrentJsonBytes
 * - projections (30/90 day)
 */
async function getStorageStats(sampleSize = 1000) {
  try {
    // Totals
    const totalsRes = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM routers) AS total_routers,
        (SELECT COUNT(*) FROM router_logs) AS total_logs;
    `);
    const totals = totalsRes.rows[0] || { total_routers: 0, total_logs: 0 };

    // Per-day counts for last 7 days (inclusive today)
    const perDay7Res = await pool.query(`
      WITH days AS (
        SELECT generate_series::date AS day
        FROM generate_series((CURRENT_DATE - INTERVAL '6 days')::date, CURRENT_DATE::date, '1 day')
      ), counts AS (
        SELECT date_trunc('day', timestamp)::date AS day, COUNT(*) AS cnt
        FROM router_logs
        WHERE timestamp >= (CURRENT_DATE - INTERVAL '6 days')
        GROUP BY 1
      )
      SELECT d.day, COALESCE(c.cnt, 0) AS count
      FROM days d
      LEFT JOIN counts c ON c.day = d.day
      ORDER BY d.day ASC;
    `);

    // Per-day counts for last 30 days (inclusive today)
    const perDay30Res = await pool.query(`
      WITH days AS (
        SELECT generate_series::date AS day
        FROM generate_series((CURRENT_DATE - INTERVAL '29 days')::date, CURRENT_DATE::date, '1 day')
      ), counts AS (
        SELECT date_trunc('day', timestamp)::date AS day, COUNT(*) AS cnt
        FROM router_logs
        WHERE timestamp >= (CURRENT_DATE - INTERVAL '29 days')
        GROUP BY 1
      )
      SELECT d.day, COALESCE(c.cnt, 0) AS count
      FROM days d
      LEFT JOIN counts c ON c.day = d.day
      ORDER BY d.day ASC;
    `);

    // Average JSON size per log (sample latest N rows)
    const avgSizeRes = await pool.query(
      `SELECT AVG(octet_length(row_to_json(t)::text))::bigint AS avg_bytes
       FROM (
         SELECT * FROM router_logs
         ORDER BY timestamp DESC
         LIMIT $1
       ) t;`,
      [Math.max(1, Math.min(10000, Number(sampleSize) || 1000))]
    );
    const avgBytes = Number(avgSizeRes.rows[0]?.avg_bytes || 0);

    // Compute averages and projections
    const logsPerDay7 = perDay7Res.rows.map(r => ({ date: r.day.toISOString?.() || r.day, count: Number(r.count) }));
    const logsPerDay30 = perDay30Res.rows.map(r => ({ date: r.day.toISOString?.() || r.day, count: Number(r.count) }));

    const sum = (arr) => arr.reduce((a, b) => a + b, 0);
    const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);

    const avgDaily7 = avg(logsPerDay7.map(d => d.count));
    const avgDaily30 = avg(logsPerDay30.map(d => d.count));

    const estimatedCurrentJsonBytes = Math.round(Number(totals.total_logs || 0) * avgBytes);
    const projected30DaysBytes_7dAvg = Math.round(avgDaily7 * 30 * avgBytes);
    const projected90DaysBytes_7dAvg = Math.round(avgDaily7 * 90 * avgBytes);
    const projected30DaysBytes_30dAvg = Math.round(avgDaily30 * 30 * avgBytes);
    const projected90DaysBytes_30dAvg = Math.round(avgDaily30 * 90 * avgBytes);

    // Get storage breakdown by router
    const routerStorageRes = await pool.query(`
      SELECT 
        r.router_id,
        r.name,
        COUNT(l.router_id) AS log_count,
        COUNT(l.router_id) * $1::bigint AS estimated_size_bytes
      FROM routers r
      LEFT JOIN router_logs l ON l.router_id = r.router_id
      GROUP BY r.router_id, r.name
      HAVING COUNT(l.router_id) > 0
      ORDER BY estimated_size_bytes DESC
      LIMIT 50;
    `, [avgBytes > 0 ? avgBytes : 1000]);
    
    const by_router = routerStorageRes.rows.map(r => ({
      router_id: r.router_id,
      name: r.name || `Router ${r.router_id}`,
      log_count: Number(r.log_count || 0),
      total_size: Number(r.estimated_size_bytes || 0)
    }));

    // Calculate growth metrics
    const growth7Res = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE timestamp >= CURRENT_DATE - INTERVAL '7 days') AS last_7_days,
        COUNT(*) FILTER (WHERE timestamp >= CURRENT_DATE - INTERVAL '14 days' AND timestamp < CURRENT_DATE - INTERVAL '7 days') AS prev_7_days
      FROM router_logs;
    `);
    const growth7 = growth7Res.rows[0] || { last_7_days: 0, prev_7_days: 0 };
    const recordsLast7Days = Number(growth7.last_7_days || 0);
    const recordsPrev7Days = Number(growth7.prev_7_days || 0);
    const recordsPerDay = recordsLast7Days / 7;
    const recordsGrowthRate = recordsPrev7Days > 0 
      ? ((recordsLast7Days - recordsPrev7Days) / recordsPrev7Days) * 100 
      : (recordsLast7Days > 0 ? 100 : 0);
    
    const sizePerDay = recordsPerDay * avgBytes;
    const sizeGrowthRate = recordsGrowthRate;

    return {
      totalRouters: Number(totals.total_routers || 0),
      totalLogs: Number(totals.total_logs || 0),
      logsPerDay7,
      logsPerDay30,
      avgLogJsonSizeBytes: Number.isFinite(avgBytes) ? Number(avgBytes) : 0,
      estimatedCurrentJsonBytes,
      total_size: estimatedCurrentJsonBytes,
      by_router,
      growth: {
        recordsPerDay: Math.round(recordsPerDay),
        recordsLast7Days,
        recordsPrev7Days,
        recordsGrowthRate: Math.round(recordsGrowthRate * 100) / 100,
        sizePerDay: Math.round(sizePerDay),
        sizeGrowthRate: Math.round(sizeGrowthRate * 100) / 100
      },
      projections: {
        using7DayAvg: {
          projected30DaysBytes: projected30DaysBytes_7dAvg,
          projected90DaysBytes: projected90DaysBytes_7dAvg
        },
        using30DayAvg: {
          projected30DaysBytes: projected30DaysBytes_30dAvg,
          projected90DaysBytes: projected90DaysBytes_30dAvg
        }
      }
    };
  } catch (error) {
    logger.error('Error computing storage stats:', error);
    throw error;
  }
}

/**
 * Top routers by data usage over the last N days.
 */
async function getTopRoutersByUsage(days = 7, limit = 5) {
  try {
    const daysInt = Math.max(1, Math.min(365, Number(days) || 7));
    const limInt = Math.max(1, Math.min(100, Number(limit) || 5));
    const query = `
      WITH params AS (
        SELECT NOW() - ($1::int || ' days')::interval AS start_ts
      ), base AS (
        SELECT l.router_id, l.total_tx_bytes AS base_tx, l.total_rx_bytes AS base_rx
        FROM router_logs l
        JOIN (
          SELECT router_id, MAX(timestamp) AS ts
          FROM router_logs, params
          WHERE timestamp < (SELECT start_ts FROM params)
          GROUP BY router_id
        ) b ON b.router_id = l.router_id AND b.ts = l.timestamp
      ), win AS (
        SELECT l.router_id, l.timestamp, l.total_tx_bytes, l.total_rx_bytes,
               LAG(l.total_tx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS prev_tx,
               LAG(l.total_rx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS prev_rx,
               FIRST_VALUE(l.total_tx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS first_tx,
               FIRST_VALUE(l.total_rx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS first_rx
        FROM router_logs l, params
        WHERE l.timestamp >= (SELECT start_ts FROM params)
      ), deltas AS (
        SELECT 
          w.router_id,
          SUM(CASE WHEN w.prev_tx IS NULL THEN 0 ELSE GREATEST(w.total_tx_bytes - w.prev_tx, 0) END) AS sum_tx_deltas,
          SUM(CASE WHEN w.prev_rx IS NULL THEN 0 ELSE GREATEST(w.total_rx_bytes - w.prev_rx, 0) END) AS sum_rx_deltas,
          MAX(w.first_tx) AS first_tx,
          MAX(w.first_rx) AS first_rx
        FROM win w
        GROUP BY w.router_id
      ), totals AS (
        SELECT d.router_id,
               (GREATEST(d.first_tx - COALESCE(b.base_tx, d.first_tx), 0) + COALESCE(d.sum_tx_deltas, 0))::bigint AS tx_bytes,
               (GREATEST(d.first_rx - COALESCE(b.base_rx, d.first_rx), 0) + COALESCE(d.sum_rx_deltas, 0))::bigint AS rx_bytes
        FROM deltas d
        LEFT JOIN base b ON b.router_id = d.router_id
      ),
      last_online AS (
        SELECT DISTINCT ON (router_id)
          router_id,
          timestamp as last_online_time
        FROM router_logs
        WHERE LOWER(TRIM(status)) IN ('online', '1') OR status::text = 'true'
        ORDER BY router_id, timestamp DESC
      )
      SELECT r.router_id, r.name,
             r.clickup_location_task_id,
             r.clickup_location_task_name,
             COALESCE(lo.last_online_time, r.last_seen) as last_seen,
             totals.tx_bytes,
             totals.rx_bytes,
             (totals.tx_bytes + totals.rx_bytes) AS total_bytes
      FROM totals
      JOIN routers r ON r.router_id = totals.router_id
      LEFT JOIN last_online lo ON lo.router_id = r.router_id
      ORDER BY total_bytes DESC
      LIMIT $2;
    `;
    const result = await pool.query(query, [daysInt, limInt]);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching top routers by usage:', error);
    throw error;
  }
}

/**
 * Aggregate network-wide usage by day for the last N days.
 */
async function getNetworkUsageByDay(days = 7) {
  try {
    const daysInt = Math.max(1, Math.min(90, Number(days) || 7));
    const query = `
      WITH params AS (
        SELECT (CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day') AS start_ts
      ), base AS (
        SELECT l.router_id, l.total_tx_bytes AS base_tx, l.total_rx_bytes AS base_rx
        FROM router_logs l
        JOIN (
          SELECT router_id, MAX(timestamp) AS ts
          FROM router_logs, params
          WHERE timestamp < (SELECT start_ts FROM params)
          GROUP BY router_id
        ) b ON b.router_id = l.router_id AND b.ts = l.timestamp
      ), ordered AS (
        SELECT 
          l.router_id, 
          date_trunc('day', l.timestamp)::date AS day,
          l.timestamp, 
          l.total_tx_bytes, 
          l.total_rx_bytes,
          LAG(l.total_tx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS prev_tx,
          LAG(l.total_rx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS prev_rx
        FROM router_logs l, params
        WHERE l.timestamp >= (SELECT start_ts FROM params)
      ), deltas AS (
        SELECT 
          o.day,
          CASE 
            WHEN o.prev_tx IS NOT NULL THEN GREATEST(o.total_tx_bytes - o.prev_tx, 0)
            ELSE GREATEST(o.total_tx_bytes - COALESCE(b.base_tx, o.total_tx_bytes), 0)
          END AS tx_delta,
          CASE 
            WHEN o.prev_rx IS NOT NULL THEN GREATEST(o.total_rx_bytes - o.prev_rx, 0)
            ELSE GREATEST(o.total_rx_bytes - COALESCE(b.base_rx, o.total_rx_bytes), 0)
          END AS rx_delta
        FROM ordered o
        LEFT JOIN base b ON b.router_id = o.router_id
      )
      SELECT 
        day AS date,
        SUM(tx_delta)::bigint AS tx_bytes,
        SUM(rx_delta)::bigint AS rx_bytes,
        SUM(tx_delta + rx_delta)::bigint AS total_bytes
      FROM deltas
      GROUP BY day
      ORDER BY day ASC;
    `;
    const result = await pool.query(query, [daysInt]);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching network usage by day:', error);
    throw error;
  }
}

/**
 * Operator distribution and usage for last N days.
 */
async function getOperatorDistribution(days = 7) {
  try {
    const daysInt = Math.max(1, Math.min(90, Number(days) || 7));
    const latestPerRouter = `
      SELECT DISTINCT ON (router_id) router_id, operator
      FROM router_logs
      WHERE operator IS NOT NULL AND operator <> ''
      ORDER BY router_id, timestamp DESC
    `;

    const countsQuery = `
      SELECT operator, COUNT(*)::int AS router_count
      FROM (${latestPerRouter}) t
      GROUP BY operator
      ORDER BY router_count DESC;
    `;
    const countsRes = await pool.query(countsQuery);

    const usageQuery = `
      WITH latest AS (${latestPerRouter}),
      base AS (
        SELECT l.router_id, l.total_tx_bytes AS base_tx, l.total_rx_bytes AS base_rx
        FROM router_logs l
        JOIN (
          SELECT router_id, MAX(timestamp) AS ts
          FROM router_logs
          WHERE timestamp < (CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day')
          GROUP BY router_id
        ) b ON b.router_id = l.router_id AND b.ts = l.timestamp
      ),
      filtered AS (
        SELECT l.router_id, l.timestamp, l.total_tx_bytes, l.total_rx_bytes, lat.operator
        FROM router_logs l
        JOIN latest lat ON lat.router_id = l.router_id
        WHERE l.timestamp >= (CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day')
      ), ordered AS (
        SELECT 
          router_id, operator, timestamp, total_tx_bytes, total_rx_bytes,
          LAG(total_tx_bytes) OVER (PARTITION BY router_id ORDER BY timestamp) AS prev_tx,
          LAG(total_rx_bytes) OVER (PARTITION BY router_id ORDER BY timestamp) AS prev_rx
        FROM filtered
      ), deltas AS (
        SELECT 
          o.operator,
          CASE 
            WHEN o.prev_tx IS NOT NULL THEN GREATEST(o.total_tx_bytes - o.prev_tx, 0)
            ELSE GREATEST(o.total_tx_bytes - COALESCE(b.base_tx, o.total_tx_bytes), 0)
          END AS tx_delta,
          CASE 
            WHEN o.prev_rx IS NOT NULL THEN GREATEST(o.total_rx_bytes - o.prev_rx, 0)
            ELSE GREATEST(o.total_rx_bytes - COALESCE(b.base_rx, o.total_rx_bytes), 0)
          END AS rx_delta
        FROM ordered o
        LEFT JOIN base b ON b.router_id = o.router_id
      )
      SELECT operator,
             SUM(tx_delta)::bigint AS tx_bytes,
             SUM(rx_delta)::bigint AS rx_bytes,
             SUM(tx_delta + rx_delta)::bigint AS total_bytes
      FROM deltas
      GROUP BY operator
      ORDER BY total_bytes DESC;
    `;
    const usageRes = await pool.query(usageQuery, [daysInt]);

    const usageMap = new Map((usageRes.rows || []).map(r => [r.operator || 'Unknown', r]));
    const out = (countsRes.rows || []).map(r => {
      const u = usageMap.get(r.operator || 'Unknown') || { tx_bytes: 0, rx_bytes: 0, total_bytes: 0 };
      return {
        operator: r.operator || 'Unknown',
        router_count: Number(r.router_count) || 0,
        tx_bytes: Number(u.tx_bytes) || 0,
        rx_bytes: Number(u.rx_bytes) || 0,
        total_bytes: Number(u.total_bytes) || 0
      };
    });
    return out;
  } catch (error) {
    logger.error('Error fetching operator distribution:', error);
    throw error;
  }
}

/**
 * Rolling window network usage, grouped by bucket (hour or day).
 */
async function getNetworkUsageRolling(hours = 24, bucket = 'hour') {
  try {
    const hrs = Math.max(1, Math.min(24 * 30, Number(hours) || 24));
    // Validate bucket to prevent SQL injection - only allow 'day' or 'hour'
    const buck = bucket === 'day' ? 'day' : 'hour';
    const query = `
      WITH params AS (
        SELECT NOW() - ($1::int || ' hours')::interval AS start_ts
      ), base AS (
        SELECT l.router_id, l.total_tx_bytes AS base_tx, l.total_rx_bytes AS base_rx
        FROM router_logs l
        JOIN (
          SELECT router_id, MAX(timestamp) AS ts
          FROM router_logs, params
          WHERE timestamp < (SELECT start_ts FROM params)
          GROUP BY router_id
        ) b ON b.router_id = l.router_id AND b.ts = l.timestamp
      ), ordered AS (
        SELECT 
          l.router_id,
          date_trunc('${buck}', l.timestamp) AS bucket_ts,
          l.timestamp,
          l.total_tx_bytes, l.total_rx_bytes,
          LAG(l.total_tx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS prev_tx,
          LAG(l.total_rx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS prev_rx
        FROM router_logs l, params
        WHERE l.timestamp >= (SELECT start_ts FROM params)
      ), deltas AS (
        SELECT 
          o.bucket_ts,
          o.router_id,
          CASE 
            WHEN o.prev_tx IS NOT NULL THEN GREATEST(o.total_tx_bytes - o.prev_tx, 0)
            ELSE GREATEST(o.total_tx_bytes - COALESCE(b.base_tx, o.total_tx_bytes), 0)
          END AS tx_delta,
          CASE 
            WHEN o.prev_rx IS NOT NULL THEN GREATEST(o.total_rx_bytes - o.prev_rx, 0)
            ELSE GREATEST(o.total_rx_bytes - COALESCE(b.base_rx, o.total_rx_bytes), 0)
          END AS rx_delta
        FROM ordered o
        LEFT JOIN base b ON b.router_id = o.router_id
      )
      SELECT 
        bucket_ts AS date,
        SUM(tx_delta)::bigint AS tx_bytes,
        SUM(rx_delta)::bigint AS rx_bytes,
        SUM(tx_delta + rx_delta)::bigint AS total_bytes
      FROM deltas
      GROUP BY bucket_ts
      ORDER BY bucket_ts ASC;
    `;
    const result = await pool.query(query, [hrs]);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching rolling network usage:', error);
    throw error;
  }
}

/**
 * Rolling window top routers by usage in last N hours.
 */
async function getTopRoutersByUsageRolling(hours = 24, limit = 5) {
  try {
    const hrs = Math.max(1, Math.min(24 * 30, Number(hours) || 24));
    const lim = Math.max(1, Math.min(100, Number(limit) || 5));
    const query = `
      WITH params AS (
        SELECT NOW() - ($1::int || ' hours')::interval AS start_ts
      ), base AS (
        SELECT l.router_id, l.total_tx_bytes AS base_tx, l.total_rx_bytes AS base_rx
        FROM router_logs l
        JOIN (
          SELECT router_id, MAX(timestamp) AS ts
          FROM router_logs, params
          WHERE timestamp < (SELECT start_ts FROM params)
          GROUP BY router_id
        ) b ON b.router_id = l.router_id AND b.ts = l.timestamp
      ), win AS (
        SELECT l.router_id, l.timestamp, l.total_tx_bytes, l.total_rx_bytes,
               LAG(l.total_tx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS prev_tx,
               LAG(l.total_rx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS prev_rx,
               FIRST_VALUE(l.total_tx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS first_tx,
               FIRST_VALUE(l.total_rx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS first_rx
        FROM router_logs l, params
        WHERE l.timestamp >= (SELECT start_ts FROM params)
      ), deltas AS (
        SELECT 
          w.router_id,
          SUM(CASE WHEN w.prev_tx IS NULL THEN 0 ELSE GREATEST(w.total_tx_bytes - w.prev_tx, 0) END) AS sum_tx_deltas,
          SUM(CASE WHEN w.prev_rx IS NULL THEN 0 ELSE GREATEST(w.total_rx_bytes - w.prev_rx, 0) END) AS sum_rx_deltas,
          MAX(w.first_tx) AS first_tx,
          MAX(w.first_rx) AS first_rx
        FROM win w
        GROUP BY w.router_id
      ), totals AS (
        SELECT d.router_id,
               (GREATEST(d.first_tx - COALESCE(b.base_tx, d.first_tx), 0) + COALESCE(d.sum_tx_deltas, 0))::bigint AS tx_bytes,
               (GREATEST(d.first_rx - COALESCE(b.base_rx, d.first_rx), 0) + COALESCE(d.sum_rx_deltas, 0))::bigint AS rx_bytes
        FROM deltas d
        LEFT JOIN base b ON b.router_id = d.router_id
      ),
      last_online AS (
        SELECT DISTINCT ON (router_id)
          router_id,
          timestamp as last_online_time
        FROM router_logs
        WHERE LOWER(TRIM(status)) IN ('online', '1') OR status::text = 'true'
        ORDER BY router_id, timestamp DESC
      )
      SELECT r.router_id, r.name,
             r.clickup_location_task_id,
             r.clickup_location_task_name,
             COALESCE(lo.last_online_time, r.last_seen) as last_seen,
             totals.tx_bytes,
             totals.rx_bytes,
             (totals.tx_bytes + totals.rx_bytes) AS total_bytes
      FROM totals
      JOIN routers r ON r.router_id = totals.router_id
      LEFT JOIN last_online lo ON lo.router_id = r.router_id
      ORDER BY total_bytes DESC
      LIMIT $2;
    `;
    const result = await pool.query(query, [hrs, lim]);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching rolling top routers:', error);
    throw error;
  }
}

/**
 * True rolling window operator distribution for last N hours.
 */
async function getOperatorDistributionRolling(hours = 24) {
  try {
    const hrs = Math.max(1, Math.min(24 * 30, Number(hours) || 24));
    const query = `
      WITH params AS (
        SELECT NOW() - ($1::int || ' hours')::interval AS start_ts
      ), base AS (
        SELECT l.router_id, l.total_tx_bytes AS base_tx, l.total_rx_bytes AS base_rx
        FROM router_logs l
        JOIN (
          SELECT router_id, MAX(timestamp) AS ts
          FROM router_logs, params
          WHERE timestamp < (SELECT start_ts FROM params)
          GROUP BY router_id
        ) b ON b.router_id = l.router_id AND b.ts = l.timestamp
      ), ordered AS (
        SELECT 
          l.router_id,
          l.timestamp,
          COALESCE(NULLIF(TRIM(l.operator), ''), 'Unknown') AS operator,
          l.total_tx_bytes, l.total_rx_bytes,
          LAG(l.total_tx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS prev_tx,
          LAG(l.total_rx_bytes) OVER (PARTITION BY l.router_id ORDER BY l.timestamp) AS prev_rx
        FROM router_logs l, params
        WHERE l.timestamp >= (SELECT start_ts FROM params)
      ), deltas AS (
        SELECT 
          o.operator,
          CASE 
            WHEN o.prev_tx IS NOT NULL THEN GREATEST(o.total_tx_bytes - o.prev_tx, 0)
            ELSE GREATEST(o.total_tx_bytes - COALESCE(b.base_tx, o.total_tx_bytes), 0)
          END AS tx_delta,
          CASE 
            WHEN o.prev_rx IS NOT NULL THEN GREATEST(o.total_rx_bytes - o.prev_rx, 0)
            ELSE GREATEST(o.total_rx_bytes - COALESCE(b.base_rx, o.total_rx_bytes), 0)
          END AS rx_delta
        FROM ordered o
        LEFT JOIN base b ON b.router_id = o.router_id
      )
      SELECT operator,
             SUM(tx_delta)::bigint AS tx_bytes,
             SUM(rx_delta)::bigint AS rx_bytes,
             SUM(tx_delta + rx_delta)::bigint AS total_bytes
      FROM deltas
      GROUP BY operator
      ORDER BY total_bytes DESC;
    `;
    const result = await pool.query(query, [hrs]);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching rolling operator distribution:', error);
    throw error;
  }
}

/**
 * Database size statistics for key relations.
 */
async function getDatabaseSizeStats() {
  try {
    const sizesQuery = `
      SELECT
        c.relname AS name,
        pg_table_size(c.oid) AS table_bytes,
        pg_indexes_size(c.oid) AS index_bytes,
        (pg_total_relation_size(c.oid) - pg_table_size(c.oid) - pg_indexes_size(c.oid)) AS toast_bytes,
        pg_total_relation_size(c.oid) AS total_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY total_bytes DESC;`;
    const sizesRes = await pool.query(sizesQuery);

    const tableNames = (sizesRes.rows || []).map(r => r.name);
    const countQueries = tableNames.map(name => 
      `SELECT '${name}' AS name, COUNT(*)::bigint AS row_count FROM ${name}`
    ).join(' UNION ALL ');
    
    const countsRes = countQueries 
      ? await pool.query(countQueries)
      : { rows: [] };

    const dbSizeRes = await pool.query(`SELECT pg_database_size(current_database()) AS db_bytes;`);

    const countMap = new Map((countsRes.rows || []).map(r => [r.name, Number(r.row_count) || 0]));
    const tables = (sizesRes.rows || []).map(r => ({
      name: r.name,
      table_bytes: Number(r.table_bytes) || 0,
      index_bytes: Number(r.index_bytes) || 0,
      toast_bytes: Number(r.toast_bytes) || 0,
      total_bytes: Number(r.total_bytes) || 0,
      row_count: countMap.get(r.name) || 0
    }));

    return {
      db_bytes: Number(dbSizeRes.rows?.[0]?.db_bytes || 0),
      tables
    };
  } catch (error) {
    logger.error('Error computing database size stats:', error);
    throw error;
  }
}

/**
 * Get inspection status for all routers
 */
async function getInspectionStatus() {
  try {
    const query = `
      SELECT 
        r.router_id,
        r.name,
        r.location,
        r.created_at,
        r.rms_created_at,
        r.last_seen,
        COALESCE(
          (SELECT inspected_at FROM inspection_logs WHERE router_id = r.router_id ORDER BY inspected_at DESC LIMIT 1),
          r.rms_created_at,
          r.created_at
        ) AS last_inspection,
        COALESCE(
          (SELECT inspected_at FROM inspection_logs WHERE router_id = r.router_id ORDER BY inspected_at DESC LIMIT 1),
          r.rms_created_at,
          r.created_at
        ) + INTERVAL '365 days' AS inspection_due,
        EXTRACT(DAY FROM (
          COALESCE(
            (SELECT inspected_at FROM inspection_logs WHERE router_id = r.router_id ORDER BY inspected_at DESC LIMIT 1),
            r.rms_created_at,
            r.created_at
          ) + INTERVAL '365 days' - CURRENT_TIMESTAMP
        ))::INTEGER AS days_remaining,
        CASE 
          WHEN COALESCE(
            (SELECT inspected_at FROM inspection_logs WHERE router_id = r.router_id ORDER BY inspected_at DESC LIMIT 1),
            r.rms_created_at,
            r.created_at
          ) + INTERVAL '365 days' < CURRENT_TIMESTAMP THEN true
          ELSE false
        END AS overdue
      FROM routers r
      WHERE LOWER(COALESCE(r.clickup_task_status, '')) != 'decommissioned'
      ORDER BY days_remaining ASC;
    `;
    const result = await pool.query(query);
    return result.rows.map(r => ({
      router_id: r.router_id,
      name: r.name || r.router_id,
      location: r.location,
      created_at: r.last_inspection,
      last_seen: r.last_seen,
      inspection_due: r.inspection_due,
      days_remaining: Number(r.days_remaining) || 0,
      overdue: r.overdue
    }));
  } catch (error) {
    logger.error('Error getting inspection status:', error);
    throw error;
  }
}

/**
 * Log a new inspection for a router
 */
async function logInspection(routerId, inspectedBy = null, notes = null) {
  try {
    const query = `
      INSERT INTO inspection_logs (router_id, inspected_by, notes)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const result = await pool.query(query, [routerId, inspectedBy, notes]);
    logger.info(`Logged inspection for router ${routerId}`);
    
    // Post comment to ClickUp
    try {
      const clickupClient = require('../services/clickupClient');
      const routerResult = await pool.query(
        'SELECT clickup_task_id, name FROM routers WHERE router_id = $1',
        [routerId]
      );
      
      if (routerResult.rows.length > 0 && routerResult.rows[0].clickup_task_id) {
        const clickupTaskId = routerResult.rows[0].clickup_task_id;
        const routerName = routerResult.rows[0].name || routerId;
        
        const commentText = `✅ **System:** Inspection completed\n\n` +
          (inspectedBy ? `👤 **Inspected by:** ${inspectedBy}\n` : '') +
          (notes ? `📝 **Notes:** ${notes}\n` : '') +
          `\n🕐 Inspected at: ${new Date().toLocaleString()}`;
        
        await clickupClient.createTaskComment(
          clickupTaskId,
          commentText,
          { notifyAll: false },
          'default'
        );
        
        logger.info('Posted inspection comment to ClickUp', {
          routerId,
          routerName,
          clickupTaskId,
          inspectedBy
        });
      }
    } catch (clickupError) {
      logger.warn('Failed to post inspection comment to ClickUp (inspection still logged)', {
        routerId,
        error: clickupError.message
      });
    }
    
    return result.rows[0];
  } catch (error) {
    logger.error('Error logging inspection:', error);
    throw error;
  }
}

/**
 * Get inspection history for a router
 */
async function getInspectionHistory(routerId) {
  try {
    const query = `
      SELECT * FROM inspection_logs
      WHERE router_id = $1
      ORDER BY inspected_at DESC;
    `;
    const result = await pool.query(query, [routerId]);
    return result.rows;
  } catch (error) {
    logger.error('Error getting inspection history:', error);
    throw error;
  }
}

module.exports = {
  getStorageStats,
  getTopRoutersByUsage,
  getNetworkUsageByDay,
  getOperatorDistribution,
  getNetworkUsageRolling,
  getTopRoutersByUsageRolling,
  getOperatorDistributionRolling,
  getDatabaseSizeStats,
  getInspectionStatus,
  logInspection,
  getInspectionHistory
};

