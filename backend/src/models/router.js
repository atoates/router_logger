/**
 * Router Model
 * Core CRUD operations for routers and logs
 * 
 * For statistics queries, see: ./routerStats.js
 * For maintenance utilities, see: ./routerMaintenance.js
 */

const { pool, logger } = require('../config/database');

// Re-export from split modules for backwards compatibility
const routerStats = require('./routerStats');
const routerMaintenance = require('./routerMaintenance');

// Cached detection of router_current_status availability to prevent 42P01 spam
let hasCurrentStatusTable = null; // null = unknown, boolean once checked
let lastStatusTableCheckAt = 0;
const STATUS_TABLE_CHECK_INTERVAL_MS = 60 * 1000; // re-check at most once per minute

async function isStatusTableAvailable(force = false) {
  const now = Date.now();
  if (!force && hasCurrentStatusTable !== null && (now - lastStatusTableCheckAt) < STATUS_TABLE_CHECK_INTERVAL_MS) {
    return hasCurrentStatusTable;
  }
  try {
    const res = await pool.query(`SELECT to_regclass('public.router_current_status') AS rel`);
    hasCurrentStatusTable = !!res.rows?.[0]?.rel;
  } catch (e) {
    // If metadata query fails for any reason, behave as if unavailable but don't spam
    hasCurrentStatusTable = false;
  } finally {
    lastStatusTableCheckAt = now;
  }
  return hasCurrentStatusTable;
}

// Insert or update router information
async function upsertRouter(routerData) {
  const query = `
    INSERT INTO routers (
      router_id, device_serial, imei, name, location, 
      site_id, firmware_version, rms_created_at, mac_address, last_seen
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
    ON CONFLICT (router_id) 
    DO UPDATE SET 
      device_serial = COALESCE($2, routers.device_serial),
      imei = COALESCE($3, routers.imei),
      name = COALESCE($4, routers.name),
      location = COALESCE($5, routers.location),
      site_id = COALESCE($6, routers.site_id),
      firmware_version = COALESCE($7, routers.firmware_version),
      rms_created_at = COALESCE($8, routers.rms_created_at),
      mac_address = COALESCE($9, routers.mac_address)
      -- Note: last_seen is NOT updated here - it's updated separately using updateRouterLastSeen
      -- with the actual log timestamp
    RETURNING *;
  `;
  
  try {
    const result = await pool.query(query, [
      routerData.router_id,
      routerData.device_serial,
      routerData.imei,
      routerData.name,
      routerData.location,
      routerData.site_id,
      routerData.firmware_version,
      routerData.rms_created_at || null,
      routerData.mac_address || null
    ]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error upserting router:', error);
    throw error;
  }
}

// Update router's last_seen timestamp
async function updateRouterLastSeen(routerId, timestamp) {
  const query = `
    UPDATE routers 
    SET last_seen = $1
    WHERE router_id = $2
    RETURNING *;
  `;
  
  try {
    const result = await pool.query(query, [timestamp, routerId]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error updating router last_seen:', error);
    throw error;
  }
}

// Insert router log entry (RUT200 format)
async function insertLog(logData) {
  const query = `
    INSERT INTO router_logs (
      router_id, imei, timestamp, wan_ip, operator, mcc, mnc, network_type,
      lac, tac, cell_id, rsrp, rsrq, rssi, sinr, earfcn, pc_id,
      latitude, longitude, location_accuracy,
      total_tx_bytes, total_rx_bytes,
      uptime_seconds, firmware_version, cpu_usage, memory_free, status,
      wifi_clients, wifi_client_count, raw_data,
      iccid, imsi, cpu_temp_c, board_temp_c, input_voltage_mv, conn_uptime_seconds,
      wan_type, wan_ipv6, vpn_status, vpn_name, eth_link_up
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $40, $41,
      $16, $17, $18,
      $19, $20,
      $21, $22, $23, $24, $25,
      $26, $27, $28,
      $29, $30, $31, $32, $33, $34,
      $35, $36, $37, $38, $39
    )
    RETURNING *;
  `;
  
  const values = [
    logData.router_id,
    logData.imei,
    logData.timestamp || new Date(),
    logData.wan_ip,
    logData.operator,
    logData.mcc,
    logData.mnc,
    logData.network_type,
    logData.lac,
    logData.tac,
    logData.cell_id,
    logData.rsrp,
    logData.rsrq,
    logData.rssi,
    logData.sinr,
    logData.latitude,
    logData.longitude,
    logData.location_accuracy,
    logData.total_tx_bytes || 0,
    logData.total_rx_bytes || 0,
    logData.uptime_seconds || 0,
    logData.firmware_version,
    logData.cpu_usage,
    logData.memory_free,
    logData.status || 'online',
    logData.wifi_clients,
    logData.wifi_client_count || 0,
    logData.raw_data,
    logData.iccid,
    logData.imsi,
    logData.cpu_temp_c,
    logData.board_temp_c,
    logData.input_voltage_mv,
    logData.conn_uptime_seconds,
    logData.wan_type,
    logData.wan_ipv6,
    logData.vpn_status,
    logData.vpn_name,
    logData.eth_link_up,
    logData.earfcn,
    logData.pc_id
  ];
  
  try {
    const result = await pool.query(query, values);
    
    // DEBUG: Log successful insert with ID
    if (result.rows[0]?.id) {
      logger.info('[INSERT_LOG_DEBUG] Successfully inserted log', {
        logId: result.rows[0].id,
        routerId: logData.router_id,
        timestamp: logData.timestamp
      });
    } else {
      logger.warn('[INSERT_LOG_DEBUG] Insert returned no rows!', {
        routerId: logData.router_id,
        rowCount: result.rowCount
      });
    }
    
    // Update the denormalized current status table for fast dashboard queries
    await updateRouterCurrentStatus(logData);
    
    return result.rows[0];
  } catch (error) {
    logger.error('[INSERT_LOG_DEBUG] Error inserting log:', {
      error: error.message,
      routerId: logData.router_id,
      code: error.code
    });
    throw error;
  }
}

// Track if we've already warned about missing table to avoid log spam
let hasWarnedAboutMissingStatusTable = false;

/**
 * Update the router_current_status table with latest telemetry data
 * This enables O(1) dashboard queries instead of scanning all logs
 */
async function updateRouterCurrentStatus(logData) {
  // If the denormalized table isn't available, skip quietly
  if (!(await isStatusTableAvailable())) {
    return;
  }
  const isOnline = ['online', '1', 'true'].includes(String(logData.status).toLowerCase().trim());
  
  const query = `
    INSERT INTO router_current_status (
      router_id, current_status, last_seen, last_online,
      wan_ip, operator, cell_id, tac, mcc, mnc, earfcn, pc_id,
      latitude, longitude, location_accuracy,
      imei, firmware_version, log_count, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 1, NOW()
    )
    ON CONFLICT (router_id) DO UPDATE SET
      current_status = EXCLUDED.current_status,
      last_seen = EXCLUDED.last_seen,
      last_online = CASE WHEN $4 IS NOT NULL THEN $4 ELSE router_current_status.last_online END,
      wan_ip = COALESCE(EXCLUDED.wan_ip, router_current_status.wan_ip),
      operator = COALESCE(EXCLUDED.operator, router_current_status.operator),
      cell_id = COALESCE(EXCLUDED.cell_id, router_current_status.cell_id),
      tac = COALESCE(EXCLUDED.tac, router_current_status.tac),
      mcc = COALESCE(EXCLUDED.mcc, router_current_status.mcc),
      mnc = COALESCE(EXCLUDED.mnc, router_current_status.mnc),
      earfcn = COALESCE(EXCLUDED.earfcn, router_current_status.earfcn),
      pc_id = COALESCE(EXCLUDED.pc_id, router_current_status.pc_id),
      latitude = COALESCE(EXCLUDED.latitude, router_current_status.latitude),
      longitude = COALESCE(EXCLUDED.longitude, router_current_status.longitude),
      location_accuracy = COALESCE(EXCLUDED.location_accuracy, router_current_status.location_accuracy),
      imei = COALESCE(EXCLUDED.imei, router_current_status.imei),
      firmware_version = COALESCE(EXCLUDED.firmware_version, router_current_status.firmware_version),
      log_count = router_current_status.log_count + 1,
      updated_at = NOW()
  `;
  
  try {
    await pool.query(query, [
      logData.router_id,
      logData.status || 'online',
      logData.timestamp || new Date(),
      isOnline ? (logData.timestamp || new Date()) : null,
      logData.wan_ip,
      logData.operator,
      logData.cell_id,
      logData.tac,
      logData.mcc,
      logData.mnc,
      logData.earfcn,
      logData.pc_id,
      logData.latitude,
      logData.longitude,
      logData.location_accuracy,
      logData.imei,
      logData.firmware_version
    ]);
  } catch (error) {
    // Don't fail the main insert if status update fails
    // Only warn once about missing table to avoid log spam
    if (error.code === '42P01' && !hasWarnedAboutMissingStatusTable) {
      logger.warn('router_current_status table not found - run migration 028. Telemetry will still be recorded.');
      hasWarnedAboutMissingStatusTable = true;
    } else if (error.code !== '42P01') {
      logger.warn('Failed to update router_current_status (non-fatal):', error.message);
    }
  }
}

// Get all routers - OPTIMIZED using denormalized router_current_status table
// This is O(n routers) instead of O(n logs) - dramatically faster for large databases
// Falls back to basic query if router_current_status table doesn't exist yet
async function getAllRouters() {
  // Prefer not to issue a query against a missing relation; check first
  const tableAvailable = await isStatusTableAvailable();
  // First, try the optimized query with the denormalized table
  const optimizedQuery = `
    SELECT 
      r.id, r.router_id, r.device_serial, r.name, r.location, r.site_id, 
      r.created_at, 
      COALESCE(s.last_online, s.last_seen, r.last_seen) as last_seen,
      r.rms_created_at, r.notes,
      r.clickup_task_id, r.clickup_task_url, r.clickup_list_id, 
      r.clickup_location_task_id, r.clickup_location_task_name, 
      r.location_linked_at, r.date_installed, r.last_clickup_sync_hash,
      r.clickup_assignees, r.clickup_task_status, r.mac_address,
      COALESCE(s.log_count, 0) as log_count,
      s.current_status,
      s.wan_ip,
      s.operator,
      s.latitude,
      s.longitude,
      s.location_accuracy,
      s.cell_id,
      s.tac,
      s.mcc,
      s.mnc,
      s.earfcn,
      s.pc_id,
      COALESCE(s.imei, r.imei) as imei,
      COALESCE(s.firmware_version, r.firmware_version) as firmware_version
    FROM routers r
    LEFT JOIN router_current_status s ON s.router_id = r.router_id
    WHERE LOWER(COALESCE(r.clickup_task_status, '')) != 'decommissioned'
    ORDER BY COALESCE(s.last_online, s.last_seen, r.last_seen) DESC NULLS LAST;
  `;
  
  // Fallback query if router_current_status doesn't exist
  // Uses LATERAL joins to get latest data from router_logs (slower but works without the new table)
  const fallbackQuery = `
    SELECT 
      r.id, r.router_id, r.device_serial, r.name, r.location, r.site_id, 
      r.created_at, 
      COALESCE(ll.timestamp, r.last_seen) as last_seen,
      r.rms_created_at, r.notes,
      r.clickup_task_id, r.clickup_task_url, r.clickup_list_id, 
      r.clickup_location_task_id, r.clickup_location_task_name, 
      r.location_linked_at, r.date_installed, r.last_clickup_sync_hash,
      r.clickup_assignees, r.clickup_task_status, r.mac_address,
      COALESCE(lc.log_count, 0) as log_count,
      ll.status as current_status,
      ll.wan_ip,
      ll.operator,
      lloc.latitude,
      lloc.longitude,
      lloc.location_accuracy,
      ll.cell_id,
      ll.tac,
      ll.mcc,
      ll.mnc,
      ll.earfcn,
      ll.pc_id,
      COALESCE(ll.imei, r.imei) as imei,
      COALESCE(ll.firmware_version, r.firmware_version) as firmware_version
    FROM routers r
    LEFT JOIN LATERAL (
      SELECT status, timestamp, wan_ip, operator, cell_id, tac, mcc, mnc, earfcn, pc_id, imei, firmware_version
      FROM router_logs WHERE router_id = r.router_id
      ORDER BY timestamp DESC LIMIT 1
    ) ll ON true
    LEFT JOIN LATERAL (
      SELECT latitude, longitude, location_accuracy
      FROM router_logs WHERE router_id = r.router_id AND latitude IS NOT NULL
      ORDER BY timestamp DESC LIMIT 1
    ) lloc ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as log_count FROM router_logs WHERE router_id = r.router_id
    ) lc ON true
    WHERE LOWER(COALESCE(r.clickup_task_status, '')) != 'decommissioned'
    ORDER BY COALESCE(ll.timestamp, r.last_seen) DESC NULLS LAST;
  `;

  try {
    if (tableAvailable) {
      const result = await pool.query(optimizedQuery);
      return result.rows;
    }
    // No table yet - go straight to fallback without triggering 42P01
    const fallbackResult = await pool.query(fallbackQuery);
    return fallbackResult.rows;
  } catch (error) {
    // If the error is because router_current_status doesn't exist, use fallback
    if (error.code === '42P01') { // relation does not exist
      logger.warn('router_current_status table not found, using fallback query');
      const fallbackResult = await pool.query(fallbackQuery);
      return fallbackResult.rows;
    }
    logger.error('Error fetching routers:', error);
    throw error;
  }
}

// Get routers visible to a given user (guests only see assigned routers; admins should use getAllRouters)
// OPTIMIZED using denormalized router_current_status table
// Falls back to basic query if router_current_status table doesn't exist yet
async function getRoutersForUser(userId) {
  const tableAvailable = await isStatusTableAvailable();
  const optimizedQuery = `
    SELECT 
      r.id, r.router_id, r.device_serial, r.name, r.location, r.site_id, 
      r.created_at, 
      COALESCE(s.last_online, s.last_seen, r.last_seen) as last_seen,
      r.rms_created_at, r.notes,
      r.clickup_task_id, r.clickup_task_url, r.clickup_list_id, 
      r.clickup_location_task_id, r.clickup_location_task_name, 
      r.location_linked_at, r.date_installed, r.last_clickup_sync_hash,
      r.clickup_assignees, r.clickup_task_status, r.mac_address,
      COALESCE(s.log_count, 0) as log_count,
      s.current_status,
      s.wan_ip,
      s.operator,
      s.latitude,
      s.longitude,
      s.location_accuracy,
      s.cell_id,
      s.tac,
      s.mcc,
      s.mnc,
      s.earfcn,
      s.pc_id,
      COALESCE(s.imei, r.imei) as imei,
      COALESCE(s.firmware_version, r.firmware_version) as firmware_version,
      ura.assigned_at,
      ura.notes as assignment_notes
    FROM user_router_assignments ura
    JOIN routers r ON r.router_id = ura.router_id
    LEFT JOIN router_current_status s ON s.router_id = r.router_id
    WHERE ura.user_id = $1
      AND LOWER(COALESCE(r.clickup_task_status, '')) != 'decommissioned'
    ORDER BY COALESCE(s.last_online, s.last_seen, r.last_seen) DESC NULLS LAST;
  `;

  // Fallback query uses LATERAL joins (slower but works without the new table)
  const fallbackQuery = `
    SELECT 
      r.id, r.router_id, r.device_serial, r.name, r.location, r.site_id, 
      r.created_at, 
      COALESCE(ll.timestamp, r.last_seen) as last_seen,
      r.rms_created_at, r.notes,
      r.clickup_task_id, r.clickup_task_url, r.clickup_list_id, 
      r.clickup_location_task_id, r.clickup_location_task_name, 
      r.location_linked_at, r.date_installed, r.last_clickup_sync_hash,
      r.clickup_assignees, r.clickup_task_status, r.mac_address,
      COALESCE(lc.log_count, 0) as log_count,
      ll.status as current_status,
      ll.wan_ip,
      ll.operator,
      lloc.latitude,
      lloc.longitude,
      lloc.location_accuracy,
      ll.cell_id,
      ll.tac,
      ll.mcc,
      ll.mnc,
      ll.earfcn,
      ll.pc_id,
      COALESCE(ll.imei, r.imei) as imei,
      COALESCE(ll.firmware_version, r.firmware_version) as firmware_version,
      ura.assigned_at,
      ura.notes as assignment_notes
    FROM user_router_assignments ura
    JOIN routers r ON r.router_id = ura.router_id
    LEFT JOIN LATERAL (
      SELECT status, timestamp, wan_ip, operator, cell_id, tac, mcc, mnc, earfcn, pc_id, imei, firmware_version
      FROM router_logs WHERE router_id = r.router_id
      ORDER BY timestamp DESC LIMIT 1
    ) ll ON true
    LEFT JOIN LATERAL (
      SELECT latitude, longitude, location_accuracy
      FROM router_logs WHERE router_id = r.router_id AND latitude IS NOT NULL
      ORDER BY timestamp DESC LIMIT 1
    ) lloc ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as log_count FROM router_logs WHERE router_id = r.router_id
    ) lc ON true
    WHERE ura.user_id = $1
      AND LOWER(COALESCE(r.clickup_task_status, '')) != 'decommissioned'
    ORDER BY COALESCE(ll.timestamp, r.last_seen) DESC NULLS LAST;
  `;

  try {
    if (tableAvailable) {
      const result = await pool.query(optimizedQuery, [userId]);
      return result.rows;
    }
    const fallbackResult = await pool.query(fallbackQuery, [userId]);
    return fallbackResult.rows;
  } catch (error) {
    // If the error is because router_current_status doesn't exist, use fallback
    if (error.code === '42P01') { // relation does not exist
      logger.warn('router_current_status table not found, using fallback query for user');
      const fallbackResult = await pool.query(fallbackQuery, [userId]);
      return fallbackResult.rows;
    }
    logger.error('Error fetching routers for user:', error);
    throw error;
  }
}

// Get logs with filters (excluding certain fields from response)
async function getLogs(filters = {}) {
  let query = `SELECT 
      router_id,
      imei,
      timestamp,
      wan_ip,
      operator,
      mcc,
      mnc,
      -- network_type excluded by request
      lac,
      tac,
      cell_id,
      rsrp,
      rsrq,
      rssi,
      sinr,
      latitude,
      longitude,
      location_accuracy,
      total_tx_bytes,
      total_rx_bytes,
      uptime_seconds,
      firmware_version,
      cpu_usage,
      memory_free,
      status,
      wifi_clients,
      wifi_client_count,
      raw_data,
      -- excluded: iccid, imsi, cpu_temp_c, board_temp_c, input_voltage_mv, wan_type, wan_ipv6, vpn_status, vpn_name
      conn_uptime_seconds,
      eth_link_up
    FROM router_logs WHERE 1=1`;
  const values = [];
  let paramCount = 1;
  
  if (filters.router_id) {
    query += ` AND router_id = $${paramCount}`;
    values.push(filters.router_id);
    paramCount++;
  }
  
  if (filters.start_date) {
    query += ` AND timestamp >= $${paramCount}`;
    values.push(filters.start_date);
    paramCount++;
  }
  
  if (filters.end_date) {
    query += ` AND timestamp <= $${paramCount}`;
    values.push(filters.end_date);
    paramCount++;
  }
  
  query += ` ORDER BY timestamp DESC`;
  
  if (filters.limit) {
    query += ` LIMIT $${paramCount}`;
    values.push(filters.limit);
  }
  
  try {
    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching logs:', error);
    throw error;
  }
}

// Get usage statistics with data deltas
async function getUsageStats(routerId, startDate, endDate) {
  const query = `
    WITH params AS (
      SELECT $2::timestamp AS start_ts, $3::timestamp AS end_ts
    ), base AS (
      SELECT l.total_tx_bytes AS base_tx, l.total_rx_bytes AS base_rx
      FROM router_logs l, params
      WHERE l.router_id = $1
        AND l.timestamp < (SELECT start_ts FROM params)
      ORDER BY l.timestamp DESC
      LIMIT 1
    ), ordered_logs AS (
      SELECT 
        timestamp,
        total_tx_bytes,
        total_rx_bytes,
        LAG(total_tx_bytes) OVER (ORDER BY timestamp) as prev_tx,
        LAG(total_rx_bytes) OVER (ORDER BY timestamp) as prev_rx,
        FIRST_VALUE(total_tx_bytes) OVER (ORDER BY timestamp) as first_tx,
        FIRST_VALUE(total_rx_bytes) OVER (ORDER BY timestamp) as first_rx
      FROM router_logs, params
      WHERE router_id = $1
        AND timestamp >= (SELECT start_ts FROM params)
        AND timestamp <= (SELECT end_ts FROM params)
      ORDER BY timestamp
    ),
    deltas AS (
      SELECT
        SUM(CASE WHEN prev_tx IS NULL THEN 0 ELSE GREATEST(total_tx_bytes - prev_tx, 0) END) as sum_tx_deltas,
        SUM(CASE WHEN prev_rx IS NULL THEN 0 ELSE GREATEST(total_rx_bytes - prev_rx, 0) END) as sum_rx_deltas,
        MAX(first_tx) as first_tx,
        MAX(first_rx) as first_rx
      FROM ordered_logs
    ),
    totals AS (
      SELECT
        (GREATEST(d.first_tx - COALESCE(b.base_tx, d.first_tx), 0) + COALESCE(d.sum_tx_deltas, 0))::bigint as period_tx_bytes,
        (GREATEST(d.first_rx - COALESCE(b.base_rx, d.first_rx), 0) + COALESCE(d.sum_rx_deltas, 0))::bigint as period_rx_bytes
      FROM deltas d
      LEFT JOIN base b ON true
    )
    SELECT 
      $1 as router_id,
      COUNT(*) as total_logs,
      t.period_tx_bytes,
      t.period_rx_bytes,
      (t.period_tx_bytes + t.period_rx_bytes) as total_data_usage,
      AVG(rsrp) as avg_rsrp,
      AVG(rsrq) as avg_rsrq,
      AVG(rssi) as avg_rssi,
      AVG(sinr) as avg_sinr,
      AVG(uptime_seconds) as avg_uptime,
      AVG(wifi_client_count) as avg_clients,
      MIN(timestamp) as first_log,
      MAX(timestamp) as last_log
    FROM router_logs, params, totals t
    WHERE router_id = $1
      AND timestamp >= (SELECT start_ts FROM params)
      AND timestamp <= (SELECT end_ts FROM params)
    GROUP BY t.period_tx_bytes, t.period_rx_bytes;
  `;
  
  try {
    const result = await pool.query(query, [routerId, startDate, endDate]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error fetching usage stats:', error);
    throw error;
  }
}

// Get uptime data
async function getUptimeData(routerId, startDate, endDate) {
  const query = `
    SELECT 
      timestamp,
      uptime_seconds,
      status
    FROM router_logs
    WHERE router_id = $1
      AND timestamp >= $2
      AND timestamp <= $3
    ORDER BY timestamp ASC;
  `;
  
  try {
    const result = await pool.query(query, [routerId, startDate, endDate]);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching uptime data:', error);
    throw error;
  }
}

// Get the latest log for a router
async function getLatestLog(routerId) {
  const query = `
    SELECT * FROM router_logs
    WHERE router_id = $1
    ORDER BY timestamp DESC
    LIMIT 1;
  `;
  try {
    const result = await pool.query(query, [routerId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error fetching latest log:', error);
    throw error;
  }
}

module.exports = {
  upsertRouter,
  updateRouterLastSeen,
  insertLog,
  getAllRouters,
  getRoutersForUser,
  getLogs,
  getUsageStats,
  getUptimeData,
  getLatestLog
};

// --- Admin/maintenance helpers ---
/**
 * Merge duplicate routers that share the same name; prefer serial-like IDs (>=9 digits).
 * Moves all logs to the preferred router_id and deletes the others from routers table.
 * Returns a summary of changes.
 */
async function mergeDuplicateRouters() {
  const summary = { groupsChecked: 0, routersMerged: 0, logsMoved: 0, details: [] };
  try {
    const routers = await getAllRouters();
    const groups = new Map();
    for (const r of routers) {
      const key = (r.name || '').toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const isSerialLike = (id) => /^(\d){9,}$/.test(String(id || ''));

    for (const [nameKey, list] of groups.entries()) {
      if (list.length < 2) continue;
      summary.groupsChecked++;
      // Choose preferred: highest log_count; tie-break with serial-like; then most recent last_seen
      const preferred = list.slice().sort((a, b) => {
        const aLogs = Number(a.log_count || 0);
        const bLogs = Number(b.log_count || 0);
        if (aLogs !== bLogs) return bLogs - aLogs;
        const aSerial = isSerialLike(a.router_id) ? 1 : 0;
        const bSerial = isSerialLike(b.router_id) ? 1 : 0;
        if (aSerial !== bSerial) return bSerial - aSerial;
        const aSeen = a.last_seen ? new Date(a.last_seen).getTime() : 0;
        const bSeen = b.last_seen ? new Date(b.last_seen).getTime() : 0;
        return bSeen - aSeen;
      })[0];
      const others = list.filter(r => String(r.router_id) !== String(preferred.router_id));
      if (others.length === 0) continue;

      for (const o of others) {
        // Move logs
        const moveRes = await pool.query(
          'UPDATE router_logs SET router_id = $1 WHERE router_id = $2',
          [preferred.router_id, o.router_id]
        );
        summary.logsMoved += moveRes.rowCount || 0;
        // Delete other router row
        await pool.query('DELETE FROM routers WHERE router_id = $1', [o.router_id]);
        summary.routersMerged += 1;
        summary.details.push({ name: preferred.name || nameKey, kept: preferred.router_id, removed: o.router_id, movedLogs: moveRes.rowCount || 0 });
      }
    }
    return summary;
  } catch (error) {
    logger.error('Error merging duplicate routers:', error);
    throw error;
  }
}

module.exports.mergeDuplicateRouters = mergeDuplicateRouters;

/**
 * Compute storage-related stats:
 * - totalRouters
 * - totalLogs
 * - logsPerDay7 (last 7 days inclusive)
 * - logsPerDay30 (last 30 days inclusive)
 * - avgLogJsonSizeBytes (approx, sampled from latest N rows via row_to_json)
 * - estimatedCurrentJsonBytes (totalLogs * avg size)
 * - projections (30/90 day) based on avg daily logs over last 7 and 30 days
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
    // Get record counts for last 7 days and previous 7 days for comparison
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
    
    // Estimate size growth
    const sizePerDay = recordsPerDay * avgBytes;
    const sizeGrowthRate = recordsGrowthRate; // Same as records growth rate

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

module.exports.getStorageStats = getStorageStats;

/**
 * Top routers by data usage over the last N days.
 * Returns router_id, name, tx_bytes, rx_bytes, total_bytes.
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

module.exports.getTopRoutersByUsage = getTopRoutersByUsage;

/**
 * Aggregate network-wide usage by day for the last N days.
 * Returns [{ date, tx_bytes, rx_bytes, total_bytes }].
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

module.exports.getNetworkUsageByDay = getNetworkUsageByDay;

/**
 * Operator distribution and usage for last N days.
 * Returns counts by operator and total usage assigned to the router's latest operator.
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
          operator,
          GREATEST(total_tx_bytes - COALESCE(prev_tx, 0), 0) AS tx_delta,
          GREATEST(total_rx_bytes - COALESCE(prev_rx, 0), 0) AS rx_delta
        FROM ordered
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

    // merge counts and usage by operator
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

module.exports.getOperatorDistribution = getOperatorDistribution;

/**
 * Rolling window network usage, grouped by bucket (hour or day).
 */
async function getNetworkUsageRolling(hours = 24, bucket = 'hour') {
  try {
    const hrs = Math.max(1, Math.min(24 * 30, Number(hours) || 24));
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

module.exports.getNetworkUsageRolling = getNetworkUsageRolling;

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

module.exports.getTopRoutersByUsageRolling = getTopRoutersByUsageRolling;

/**
 * True rolling window operator distribution for last N hours.
 * Attributes byte deltas to the operator present at each log within the window.
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

module.exports.getOperatorDistributionRolling = getOperatorDistributionRolling;

/**
 * Database size statistics for key relations.
 * Returns per-table sizes (table/index/total/toast) and row counts, plus database total size.
 */
async function getDatabaseSizeStats() {
  try {
    // Get all user tables, not just specific ones
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

    // Get row counts for all tables dynamically
    const tableNames = (sizesRes.rows || []).map(r => r.name);
    const countQueries = tableNames.map(name => 
      `SELECT '${name}' AS name, COUNT(*)::bigint AS row_count FROM ${name}`
    ).join(' UNION ALL ');
    
    const countsRes = countQueries 
      ? await pool.query(countQueries)
      : { rows: [] };

    const dbSizeRes = await pool.query(`SELECT pg_database_size(current_database()) AS db_bytes;`);

    // Merge counts into sizes map
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
 * Returns routers with days_remaining until reinspection (365 days from last inspection or created_at)
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

// Re-export stats functions from routerStats module
module.exports.getStorageStats = routerStats.getStorageStats;
module.exports.getTopRoutersByUsage = routerStats.getTopRoutersByUsage;
module.exports.getNetworkUsageByDay = routerStats.getNetworkUsageByDay;
module.exports.getOperatorDistribution = routerStats.getOperatorDistribution;
module.exports.getNetworkUsageRolling = routerStats.getNetworkUsageRolling;
module.exports.getTopRoutersByUsageRolling = routerStats.getTopRoutersByUsageRolling;
module.exports.getOperatorDistributionRolling = routerStats.getOperatorDistributionRolling;
module.exports.getDatabaseSizeStats = routerStats.getDatabaseSizeStats;
module.exports.getInspectionStatus = routerStats.getInspectionStatus;
module.exports.logInspection = routerStats.logInspection;
module.exports.getInspectionHistory = routerStats.getInspectionHistory;

// Re-export maintenance functions from routerMaintenance module
module.exports.mergeDuplicateRouters = routerMaintenance.mergeDuplicateRouters;
module.exports.getDeduplicationReport = routerMaintenance.getDeduplicationReport;
module.exports.archiveOldLogs = routerMaintenance.archiveOldLogs;
module.exports.purgeArchivedLogs = routerMaintenance.purgeArchivedLogs;
module.exports.cleanupOrphanedLogs = routerMaintenance.cleanupOrphanedLogs;
