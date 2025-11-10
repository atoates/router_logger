/**
 * IronWifi Session Sync Service
 * Periodically syncs user session data from IronWifi API to database
 * Tracks active users connected through routers
 */

const { getIronWifiClient, isIronWifiEnabled } = require('./ironwifiClient');
const { pool, logger } = require('../config/database');

let syncIntervalId = null;
let isCurrentlySyncing = false;

/**
 * Normalize MAC address to consistent format (lowercase, colon-separated)
 */
function normalizeMac(mac) {
  if (!mac) return null;
  // Remove any separators and convert to lowercase
  const cleaned = mac.toLowerCase().replace(/[:-]/g, '');
  // Add colons every 2 characters
  return cleaned.match(/.{1,2}/g)?.join(':') || null;
}

/**
 * Map IronWifi session data to our database format
 */
function mapSessionData(session, routerId = null) {
  return {
    router_id: routerId,
    router_mac_address: normalizeMac(session.ap_mac || session.ap_mac_address || session.nas_identifier),
    ap_name: session.ap_name || session.access_point_name,
    session_id: session.session_id || session.id || `${session.username}_${session.start_time}_${Math.random()}`,
    ironwifi_session_id: session.id,
    user_id: session.user_id,
    username: session.username || session.user_name,
    user_email: session.user_email || session.email,
    user_device_mac: normalizeMac(session.mac_address || session.client_mac || session.calling_station_id),
    user_device_name: session.device_name || session.client_hostname,
    user_device_type: session.device_type || session.client_type,
    session_start: new Date(session.start_time || session.session_start || session.created_at),
    session_end: session.end_time ? new Date(session.end_time) : null,
    last_seen: new Date(session.last_activity || session.last_seen || Date.now()),
    is_active: session.status === 'active' || session.is_active === true,
    bytes_uploaded: parseInt(session.bytes_uploaded || session.output_octets || 0),
    bytes_downloaded: parseInt(session.bytes_downloaded || session.input_octets || 0),
    bytes_total: parseInt(session.bytes_total || session.total_octets || 0),
    duration_seconds: parseInt(session.duration || session.session_time || 0),
    ssid: session.ssid || session.wifi_ssid,
    location_name: session.location || session.location_name,
    ip_address: session.ip_address || session.framed_ip_address,
    auth_method: session.auth_method || session.authentication_method,
    auth_provider: session.auth_provider || session.identity_provider,
    raw_data: session
  };
}

/**
 * Sync sessions from IronWifi to database
 */
async function syncIronWifiSessions() {
  if (!isIronWifiEnabled()) {
    logger.warn('IronWifi integration is not enabled. Set IRONWIFI_API_KEY and IRONWIFI_NETWORK_ID.');
    return { success: false, error: 'IronWifi not configured' };
  }

  if (isCurrentlySyncing) {
    logger.warn('IronWifi sync already in progress, skipping...');
    return { success: false, error: 'Sync already in progress' };
  }

  isCurrentlySyncing = true;
  const startTime = Date.now();

  try {
    logger.info('Starting IronWifi session sync...');
    
    // Check API usage before starting
    const IronWifiClient = require('./ironwifiClient').IronWifiClient;
    const apiUsage = IronWifiClient.getApiUsage();
    logger.info(`IronWifi API usage: ${apiUsage.callsMade}/${apiUsage.limit} (${apiUsage.percentageUsed}% used, resets in ${apiUsage.resetInMinutes} min)`);
    
    // Skip sync if we're over 90% of limit
    if (apiUsage.callsMade >= apiUsage.limit * 0.9) {
      logger.warn(`IronWifi sync skipped - approaching rate limit (${apiUsage.percentageUsed}% used). Will retry in ${apiUsage.resetInMinutes} minutes.`);
      return { 
        success: false, 
        skipped: true,
        reason: 'Rate limit approaching', 
        apiUsage 
      };
    }
    
    const ironwifi = getIronWifiClient();
    
    // 1. Get all active sessions from IronWifi
    const activeSessions = await ironwifi.getActiveSessions();
    logger.info(`Fetched ${activeSessions.length} active sessions from IronWifi`);

    // 2. Get all routers with MAC addresses from our database
    const routersResult = await pool.query(
      `SELECT router_id, mac_address, name FROM routers WHERE mac_address IS NOT NULL`
    );
    const routers = routersResult.rows;
    
    // Create MAC to router_id mapping
    const macToRouterId = {};
    routers.forEach(router => {
      const normalizedMac = normalizeMac(router.mac_address);
      if (normalizedMac) {
        macToRouterId[normalizedMac] = router.router_id;
      }
    });

    logger.info(`Found ${routers.length} routers with MAC addresses`);

    // 3. Process each session
    let newSessions = 0;
    let updatedSessions = 0;
    let unmatchedSessions = 0;

    for (const session of activeSessions) {
      try {
        const sessionData = mapSessionData(session);
        
        // Try to match session to router by MAC address
        const routerMac = sessionData.router_mac_address;
        if (routerMac && macToRouterId[routerMac]) {
          sessionData.router_id = macToRouterId[routerMac];
        } else if (routerMac) {
          logger.debug(`No router found for MAC ${routerMac}`);
          unmatchedSessions++;
        }

        // Upsert session
        await pool.query(
          `INSERT INTO ironwifi_sessions (
            router_id, router_mac_address, ap_name, session_id, ironwifi_session_id,
            user_id, username, user_email, user_device_mac, user_device_name, user_device_type,
            session_start, session_end, last_seen, is_active,
            bytes_uploaded, bytes_downloaded, bytes_total, duration_seconds,
            ssid, location_name, ip_address, auth_method, auth_provider, raw_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
          ON CONFLICT (session_id) DO UPDATE SET
            last_seen = EXCLUDED.last_seen,
            is_active = EXCLUDED.is_active,
            session_end = EXCLUDED.session_end,
            bytes_uploaded = EXCLUDED.bytes_uploaded,
            bytes_downloaded = EXCLUDED.bytes_downloaded,
            bytes_total = EXCLUDED.bytes_total,
            duration_seconds = EXCLUDED.duration_seconds,
            raw_data = EXCLUDED.raw_data,
            updated_at = CURRENT_TIMESTAMP
          RETURNING (xmax = 0) as is_new`,
          [
            sessionData.router_id, sessionData.router_mac_address, sessionData.ap_name,
            sessionData.session_id, sessionData.ironwifi_session_id,
            sessionData.user_id, sessionData.username, sessionData.user_email,
            sessionData.user_device_mac, sessionData.user_device_name, sessionData.user_device_type,
            sessionData.session_start, sessionData.session_end, sessionData.last_seen, sessionData.is_active,
            sessionData.bytes_uploaded, sessionData.bytes_downloaded, sessionData.bytes_total,
            sessionData.duration_seconds, sessionData.ssid, sessionData.location_name,
            sessionData.ip_address, sessionData.auth_method, sessionData.auth_provider,
            JSON.stringify(sessionData.raw_data)
          ]
        ).then(result => {
          if (result.rows[0]?.is_new) {
            newSessions++;
          } else {
            updatedSessions++;
          }
        });

      } catch (error) {
        logger.error('Error processing session:', error.message);
      }
    }

    // 4. Mark sessions as inactive if they're no longer in the active list
    const activeSessionIds = activeSessions.map(s => 
      s.session_id || s.id || `${s.username}_${s.start_time}_${Math.random()}`
    );

    if (activeSessionIds.length > 0) {
      const deactivateResult = await pool.query(
        `UPDATE ironwifi_sessions 
         SET is_active = false, session_end = COALESCE(session_end, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
         WHERE is_active = true AND session_id != ALL($1)
         RETURNING session_id`,
        [activeSessionIds]
      );
      logger.info(`Marked ${deactivateResult.rowCount} sessions as inactive`);
    }

    // 5. Refresh materialized view for quick active users lookup
    try {
      await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY router_active_users');
      logger.debug('Refreshed router_active_users materialized view');
    } catch (error) {
      logger.warn('Failed to refresh materialized view (may need to be created first):', error.message);
    }

    // 6. Update sync timestamp
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('ironwifi_last_sync', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [new Date().toISOString()]
    );

    const duration = Date.now() - startTime;
    const result = {
      success: true,
      newSessions,
      updatedSessions,
      deactivatedSessions: activeSessionIds.length > 0 ? 'checked' : 0,
      unmatchedSessions,
      totalActiveSessions: activeSessions.length,
      routersWithMac: routers.length,
      duration
    };

    logger.info('IronWifi sync completed', result);
    return result;

  } catch (error) {
    // Handle rate limit errors gracefully
    if (error.isRateLimitError) {
      logger.error('IronWifi sync failed due to rate limit:', error.message);
      return {
        success: false,
        skipped: true,
        error: error.message,
        reason: 'Rate limit exceeded',
        duration: Date.now() - startTime
      };
    }
    
    logger.error('IronWifi sync failed:', error);
    return {
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    };
  } finally {
    isCurrentlySyncing = false;
  }
}

/**
 * Update daily statistics for all routers
 */
async function updateDailyStats() {
  try {
    const today = new Date().toISOString().split('T')[0];

    await pool.query(`
      INSERT INTO router_user_stats (
        router_id, date,
        total_sessions, unique_users, unique_devices,
        total_bytes_transferred, total_bytes_uploaded, total_bytes_downloaded,
        avg_session_duration_seconds, max_session_duration_seconds, min_session_duration_seconds,
        peak_concurrent_users
      )
      SELECT 
        router_id,
        $1 as date,
        COUNT(*) as total_sessions,
        COUNT(DISTINCT username) as unique_users,
        COUNT(DISTINCT user_device_mac) as unique_devices,
        SUM(bytes_total) as total_bytes_transferred,
        SUM(bytes_uploaded) as total_bytes_uploaded,
        SUM(bytes_downloaded) as total_bytes_downloaded,
        AVG(duration_seconds)::INTEGER as avg_session_duration_seconds,
        MAX(duration_seconds) as max_session_duration_seconds,
        MIN(duration_seconds) as min_session_duration_seconds,
        (SELECT COUNT(DISTINCT s2.session_id) 
         FROM ironwifi_sessions s2 
         WHERE s2.router_id = s1.router_id 
         AND DATE(s2.session_start) = $1
         AND s2.is_active = true
         GROUP BY router_id
         ORDER BY COUNT(*) DESC LIMIT 1) as peak_concurrent_users
      FROM ironwifi_sessions s1
      WHERE DATE(session_start) = $1 AND router_id IS NOT NULL
      GROUP BY router_id
      ON CONFLICT (router_id, date) DO UPDATE SET
        total_sessions = EXCLUDED.total_sessions,
        unique_users = EXCLUDED.unique_users,
        unique_devices = EXCLUDED.unique_devices,
        total_bytes_transferred = EXCLUDED.total_bytes_transferred,
        total_bytes_uploaded = EXCLUDED.total_bytes_uploaded,
        total_bytes_downloaded = EXCLUDED.total_bytes_downloaded,
        avg_session_duration_seconds = EXCLUDED.avg_session_duration_seconds,
        max_session_duration_seconds = EXCLUDED.max_session_duration_seconds,
        min_session_duration_seconds = EXCLUDED.min_session_duration_seconds,
        peak_concurrent_users = EXCLUDED.peak_concurrent_users,
        updated_at = CURRENT_TIMESTAMP
    `, [today]);

    logger.info('Updated daily user statistics');
  } catch (error) {
    logger.error('Failed to update daily stats:', error);
  }
}

/**
 * Start periodic IronWifi sync
 */
function startIronWifiSync(intervalMinutes = 5) {
  if (!isIronWifiEnabled()) {
    logger.warn('IronWifi sync not started - integration not configured');
    return null;
  }

  if (syncIntervalId) {
    logger.info('IronWifi sync scheduler already running');
    return syncIntervalId;
  }

  logger.info(`Starting IronWifi sync scheduler (every ${intervalMinutes} minutes)`);

  // Run initial sync
  syncIronWifiSessions().catch(err => 
    logger.error('Initial IronWifi sync failed:', err)
  );

  // Schedule periodic sync
  syncIntervalId = setInterval(() => {
    syncIronWifiSessions().catch(err => 
      logger.error('Scheduled IronWifi sync failed:', err)
    );
  }, intervalMinutes * 60 * 1000);

  // Update daily stats once per day (at midnight)
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight - now;

  setTimeout(() => {
    updateDailyStats();
    // Then run daily
    setInterval(updateDailyStats, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  return syncIntervalId;
}

/**
 * Stop periodic sync
 */
function stopIronWifiSync() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    logger.info('IronWifi sync scheduler stopped');
  }
}

/**
 * Check if sync is currently running
 */
function isSyncRunning() {
  return isCurrentlySyncing;
}

module.exports = {
  syncIronWifiSessions,
  updateDailyStats,
  startIronWifiSync,
  stopIronWifiSync,
  isSyncRunning
};
