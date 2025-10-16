const { pool, logger } = require('../config/database');

// Insert or update router information
async function upsertRouter(routerData) {
  const query = `
    INSERT INTO routers (
      router_id, device_serial, imei, name, location, 
      site_id, firmware_version, last_seen
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    ON CONFLICT (router_id) 
    DO UPDATE SET 
      device_serial = COALESCE($2, routers.device_serial),
      imei = COALESCE($3, routers.imei),
      name = COALESCE($4, routers.name),
      location = COALESCE($5, routers.location),
      site_id = COALESCE($6, routers.site_id),
      firmware_version = COALESCE($7, routers.firmware_version),
      last_seen = CURRENT_TIMESTAMP
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
      routerData.firmware_version
    ]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error upserting router:', error);
    throw error;
  }
}

// Insert router log entry (RUT200 format)
async function insertLog(logData) {
  const query = `
    INSERT INTO router_logs (
      router_id, imei, timestamp, wan_ip, operator, mcc, mnc, network_type,
      lac, tac, cell_id, rsrp, rsrq, rssi, sinr,
      latitude, longitude, location_accuracy,
      total_tx_bytes, total_rx_bytes,
      uptime_seconds, firmware_version, cpu_usage, memory_free, status,
      wifi_clients, wifi_client_count, raw_data,
      iccid, imsi, cpu_temp_c, board_temp_c, input_voltage_mv, conn_uptime_seconds,
      wan_type, wan_ipv6, vpn_status, vpn_name, eth_link_up
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15,
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
    logData.eth_link_up
  ];
  
  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    logger.error('Error inserting log:', error);
    throw error;
  }
}

// Get all routers
async function getAllRouters() {
  const query = `
    SELECT r.*, 
      (SELECT COUNT(*) FROM router_logs WHERE router_id = r.router_id) as log_count,
      (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as current_status
    FROM routers r
    ORDER BY r.last_seen DESC;
  `;
  
  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching routers:', error);
    throw error;
  }
}

// Get logs with filters
async function getLogs(filters = {}) {
  let query = `SELECT * FROM router_logs WHERE 1=1`;
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
    WITH ordered_logs AS (
      SELECT 
        timestamp,
        total_tx_bytes,
        total_rx_bytes,
        LAG(total_tx_bytes) OVER (ORDER BY timestamp) as prev_tx,
        LAG(total_rx_bytes) OVER (ORDER BY timestamp) as prev_rx
      FROM router_logs
      WHERE router_id = $1
        AND timestamp >= $2
        AND timestamp <= $3
      ORDER BY timestamp
    ),
    deltas AS (
      SELECT
        SUM(GREATEST(total_tx_bytes - COALESCE(prev_tx, 0), 0)) as period_tx_bytes,
        SUM(GREATEST(total_rx_bytes - COALESCE(prev_rx, 0), 0)) as period_rx_bytes
      FROM ordered_logs
    )
    SELECT 
      $1 as router_id,
      COUNT(*) as total_logs,
      d.period_tx_bytes,
      d.period_rx_bytes,
      (d.period_tx_bytes + d.period_rx_bytes) as total_data_usage,
      AVG(rsrp) as avg_rsrp,
      AVG(rsrq) as avg_rsrq,
      AVG(rssi) as avg_rssi,
      AVG(sinr) as avg_sinr,
      AVG(uptime_seconds) as avg_uptime,
      AVG(wifi_client_count) as avg_clients,
      MIN(timestamp) as first_log,
      MAX(timestamp) as last_log
    FROM router_logs, deltas d
    WHERE router_id = $1
      AND timestamp >= $2
      AND timestamp <= $3
    GROUP BY d.period_tx_bytes, d.period_rx_bytes;
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
  insertLog,
  getAllRouters,
  getLogs,
  getUsageStats,
  getUptimeData,
  getLatestLog
};
