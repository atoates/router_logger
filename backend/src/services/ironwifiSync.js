/**
 * IronWifi Sync Service
 * 
 * Periodically syncs user session data from IronWifi to the local database.
 * Matches sessions to routers via MAC address.
 * 
 * Supports both:
 * 1. API Polling - Fetches data from IronWifi REST API (with rate limiting)
 * 2. Webhook - Receives data pushed from IronWifi Report Scheduler
 */

const { pool, logger } = require('../config/database');
const ironwifiClient = require('./ironwifiClient');

// Sync scheduler reference
let syncInterval = null;
let lastSyncTime = null;
let lastSyncResult = null;

/**
 * Normalize MAC address to consistent format (lowercase, colon-separated)
 * @param {string} mac - MAC address in any format
 * @returns {string|null} Normalized MAC or null
 */
function normalizeMac(mac) {
  if (!mac) return null;
  // Remove all separators and convert to lowercase
  const cleaned = mac.toLowerCase().replace(/[:-]/g, '');
  // Validate length (allow 12 chars for full MAC)
  if (cleaned.length < 10 || !/^[0-9a-f]+$/.test(cleaned)) {
    return null;
  }
  // Pad to 12 chars if needed (shouldn't happen but safety)
  const padded = cleaned.padEnd(12, '0').slice(0, 12);
  // Format with colons
  return padded.match(/.{1,2}/g).join(':');
}

/**
 * Get MAC prefix (first 5 bytes / 10 characters) for matching
 * IronWifi Called-Station-Id may differ in last byte from router MAC
 * @param {string} mac - Normalized MAC address
 * @returns {string|null} MAC prefix for matching
 */
function getMacPrefix(mac) {
  const normalized = normalizeMac(mac);
  if (!normalized) return null;
  // Get first 5 bytes: aa:bb:cc:dd:ee (14 chars with colons, or first 10 hex chars)
  return normalized.slice(0, 14); // aa:bb:cc:dd:ee
}

/**
 * Get all routers that have MAC addresses configured
 * Returns both exact MAC map and prefix map for flexible matching
 * @returns {Promise<{exactMap: Map, prefixMap: Map}>}
 */
async function getRoutersWithMac() {
  const result = await pool.query(`
    SELECT router_id, name, mac_address
    FROM routers
    WHERE mac_address IS NOT NULL AND mac_address != ''
  `);
  
  const exactMap = new Map();   // Full MAC -> router
  const prefixMap = new Map();  // 5-byte prefix -> router
  
  for (const router of result.rows) {
    const normalizedMac = normalizeMac(router.mac_address);
    if (normalizedMac) {
      exactMap.set(normalizedMac, router);
      
      // Also add prefix for fuzzy matching
      const prefix = getMacPrefix(normalizedMac);
      if (prefix) {
        prefixMap.set(prefix, router);
      }
    }
  }
  
  logger.debug(`Found ${exactMap.size} routers with MAC addresses (${prefixMap.size} unique prefixes)`);
  return { exactMap, prefixMap };
}

/**
 * Match a Called-Station-Id to a router
 * First tries exact match, then prefix match (first 5 bytes)
 * @param {string} calledStationId - MAC from IronWifi (may have hyphens)
 * @param {Map} exactMap - Exact MAC -> router map
 * @param {Map} prefixMap - Prefix -> router map
 * @returns {object|null} Matched router or null
 */
function matchMacToRouter(calledStationId, exactMap, prefixMap) {
  const normalizedMac = normalizeMac(calledStationId);
  if (!normalizedMac) return null;
  
  // Try exact match first
  if (exactMap.has(normalizedMac)) {
    return exactMap.get(normalizedMac);
  }
  
  // Try prefix match (first 5 bytes)
  const prefix = getMacPrefix(normalizedMac);
  if (prefix && prefixMap.has(prefix)) {
    const router = prefixMap.get(prefix);
    logger.debug(`Matched MAC by prefix: ${calledStationId} -> ${router.router_id} (prefix: ${prefix})`);
    return router;
  }
  
  return null;
}

/**
 * Store or update a session in the database
 * @param {object} sessionData - Session data
 * @param {string|null} routerId - Router ID if matched
 * @returns {Promise<{inserted: boolean, updated: boolean}>}
 */
async function upsertSession(sessionData, routerId) {
  const {
    session_id,
    ap_mac,
    user_mac,
    username,
    session_start,
    session_end,
    bytes_in,
    bytes_out,
    duration,
    framed_ip,
    nas_ip,
    terminate_cause
  } = sessionData;
  
  // Determine if session is active (no end time or very recent)
  const isActive = !session_end;
  const bytesTotal = (bytes_in || 0) + (bytes_out || 0);
  
  const result = await pool.query(`
    INSERT INTO ironwifi_sessions (
      router_id,
      router_mac_address,
      session_id,
      username,
      user_device_mac,
      session_start,
      session_end,
      last_seen,
      is_active,
      bytes_uploaded,
      bytes_downloaded,
      bytes_total,
      duration_seconds,
      ip_address,
      nas_ip_address,
      terminate_cause,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (session_id) DO UPDATE SET
      router_id = COALESCE($1, ironwifi_sessions.router_id),
      session_end = COALESCE($7, ironwifi_sessions.session_end),
      last_seen = CURRENT_TIMESTAMP,
      is_active = $8,
      bytes_uploaded = $9,
      bytes_downloaded = $10,
      bytes_total = $11,
      duration_seconds = $12,
      terminate_cause = COALESCE($15, ironwifi_sessions.terminate_cause),
      updated_at = CURRENT_TIMESTAMP
    RETURNING (xmax = 0) AS inserted
  `, [
    routerId,
    ap_mac,
    session_id,
    username,
    user_mac,
    session_start ? new Date(session_start) : new Date(),
    session_end ? new Date(session_end) : null,
    isActive,
    bytes_out || 0,  // IronWifi: output = upload from user perspective
    bytes_in || 0,   // IronWifi: input = download from user perspective
    bytesTotal,
    duration || 0,
    framed_ip,
    nas_ip,
    terminate_cause
  ]);
  
  return {
    inserted: result.rows[0]?.inserted === true,
    updated: result.rows[0]?.inserted === false
  };
}

/**
 * Process a single session record from IronWifi
 * @param {object} record - Raw record from API or webhook
 * @param {object} routerMaps - { exactMap, prefixMap } for MAC matching
 * @returns {Promise<{matched: boolean, routerId: string|null}>}
 */
async function processSession(record, routerMaps) {
  const { exactMap, prefixMap } = routerMaps;
  
  // Extract fields - handle various IronWifi field name formats
  // IronWifi uses lowercase without underscores in API, but may vary in webhook
  const rawApMac = record.calledstationid || record.called_station_id || 
                   record.nas_identifier || record.ap_mac || record.CalledStationId;
  
  const sessionData = {
    // Session ID
    session_id: record.acctsessionid || record.acct_session_id || record.session_id,
    // AP MAC (router) - raw for matching, normalized for storage
    ap_mac: normalizeMac(rawApMac),
    // User device MAC
    user_mac: normalizeMac(
      record.callingstationid || record.calling_station_id || 
      record.client_mac || record.mac_address || record.CallingStationId
    ),
    // Username
    username: record.username || record.user_name || record.email,
    // Timing
    session_start: record.acctstarttime || record.acct_start_time || record.start_time || record.authdate,
    session_end: record.acctstoptime || record.acct_stop_time || record.stop_time,
    // Bandwidth
    bytes_in: parseInt(record.acctinputoctets || record.acct_input_octets || 0),
    bytes_out: parseInt(record.acctoutputoctets || record.acct_output_octets || 0),
    // Duration
    duration: parseInt(record.acctsessiontime || record.acct_session_time || 0),
    // Network
    framed_ip: record.framedipaddress || record.framed_ip_address || record.ip_address,
    nas_ip: record.nasipaddress || record.nas_ip_address,
    // Status
    terminate_cause: record.acctterminatecause || record.acct_terminate_cause
  };
  
  // Skip if no identifiable session
  if (!sessionData.session_id && !sessionData.ap_mac && !sessionData.username) {
    return { matched: false, routerId: null, skipped: true };
  }
  
  // Generate session ID if missing
  if (!sessionData.session_id) {
    const timestamp = sessionData.session_start ? new Date(sessionData.session_start).getTime() : Date.now();
    sessionData.session_id = `gen_${sessionData.username || 'unknown'}_${timestamp}`;
  }
  
  // Match to router by MAC using prefix matching
  let routerId = null;
  let matched = false;
  
  if (rawApMac) {
    const router = matchMacToRouter(rawApMac, exactMap, prefixMap);
    if (router) {
      routerId = router.router_id;
      matched = true;
      logger.debug(`Session matched to router: ${sessionData.username} -> ${router.name} (${router.router_id})`);
    }
  }
  
  // Store session
  await upsertSession(sessionData, routerId);
  
  return { matched, routerId };
}

/**
 * Mark old sessions as inactive if not seen in recent sync
 * Sessions not updated in last 2 sync cycles are marked inactive
 * 
 * @param {number} staleMinutes - Minutes after which to mark inactive
 */
async function markStaleSessions(staleMinutes = 30) {
  const result = await pool.query(`
    UPDATE ironwifi_sessions
    SET is_active = false, updated_at = CURRENT_TIMESTAMP
    WHERE is_active = true
    AND last_seen < NOW() - INTERVAL '${staleMinutes} minutes'
    AND session_end IS NULL
    RETURNING id
  `);
  
  if (result.rowCount > 0) {
    logger.info(`Marked ${result.rowCount} stale sessions as inactive`);
  }
}

/**
 * Update daily statistics for routers
 */
async function updateDailyStats() {
  try {
    await pool.query(`
      INSERT INTO router_user_stats (router_id, date, unique_users, total_sessions, 
        bytes_uploaded, bytes_downloaded, bytes_total, total_duration_seconds)
      SELECT 
        router_id,
        DATE(session_start) as date,
        COUNT(DISTINCT username) as unique_users,
        COUNT(*) as total_sessions,
        COALESCE(SUM(bytes_uploaded), 0) as bytes_uploaded,
        COALESCE(SUM(bytes_downloaded), 0) as bytes_downloaded,
        COALESCE(SUM(bytes_total), 0) as bytes_total,
        COALESCE(SUM(duration_seconds), 0) as total_duration_seconds
      FROM ironwifi_sessions
      WHERE router_id IS NOT NULL
      AND session_start >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY router_id, DATE(session_start)
      ON CONFLICT (router_id, date) DO UPDATE SET
        unique_users = EXCLUDED.unique_users,
        total_sessions = EXCLUDED.total_sessions,
        bytes_uploaded = EXCLUDED.bytes_uploaded,
        bytes_downloaded = EXCLUDED.bytes_downloaded,
        bytes_total = EXCLUDED.bytes_total,
        total_duration_seconds = EXCLUDED.total_duration_seconds,
        updated_at = CURRENT_TIMESTAMP
    `);
    
    logger.debug('Daily stats updated');
  } catch (error) {
    logger.error('Failed to update daily stats:', { message: error.message });
  }
}

/**
 * Sync guests from IronWifi API to ironwifi_guests table
 * Fetches ALL guests (not just recent) and stores them in the guests table
 * @param {number} maxPages - Maximum pages to fetch (default: 20)
 * @returns {Promise<object>} Sync result
 */
async function syncGuests(maxPages = 20) {
  const startTime = Date.now();
  
  try {
    if (!ironwifiClient.isConfigured()) {
      return { success: false, reason: 'Not configured' };
    }
    
    logger.info(`Syncing guests from IronWifi (up to ${maxPages} pages)...`);
    
    // Fetch ALL guests, not just recent ones
    const allGuests = await ironwifiClient.getAllGuests({ maxPages, pageSize: 100 });
    
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    
    for (const guest of allGuests) {
      try {
        // Parse dates
        const creationDate = guest.creationdate ? new Date(guest.creationdate) : null;
        const authDate = guest.authdate ? new Date(guest.authdate) : null;
        
        // Normalize MAC addresses if present (usually not in /guests API)
        const clientMac = guest.client_mac ? normalizeMac(guest.client_mac) : null;
        const apMac = guest.ap_mac ? normalizeMac(guest.ap_mac) : null;
        
        // Try to match ap_mac to a router (if available)
        let routerId = null;
        if (apMac) {
          const prefix = getMacPrefix(apMac);
          if (prefix) {
            const routerResult = await pool.query(
              `SELECT router_id FROM routers 
               WHERE LOWER(REPLACE(mac_address, '-', ':')) = LOWER($1)
               OR LEFT(LOWER(REPLACE(mac_address, '-', ':')), 14) = LEFT(LOWER($1), 14)`,
              [apMac]
            );
            if (routerResult.rows.length > 0) {
              routerId = routerResult.rows[0].router_id;
            }
          }
        }
        
        // Upsert into ironwifi_guests table
        const result = await pool.query(`
          INSERT INTO ironwifi_guests (
            ironwifi_id, username, email, fullname, firstname, lastname,
            phone, auth_date, creation_date, source, owner_id, 
            client_mac, ap_mac, router_id, captive_portal_name, venue_id, public_ip,
            first_seen_at, last_seen_at, auth_count
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, 1)
          ON CONFLICT (ironwifi_id) DO UPDATE SET
            username = COALESCE(EXCLUDED.username, ironwifi_guests.username),
            email = COALESCE(EXCLUDED.email, ironwifi_guests.email),
            fullname = COALESCE(EXCLUDED.fullname, ironwifi_guests.fullname),
            phone = COALESCE(EXCLUDED.phone, ironwifi_guests.phone),
            client_mac = COALESCE(EXCLUDED.client_mac, ironwifi_guests.client_mac),
            ap_mac = COALESCE(EXCLUDED.ap_mac, ironwifi_guests.ap_mac),
            router_id = COALESCE(EXCLUDED.router_id, ironwifi_guests.router_id),
            captive_portal_name = COALESCE(EXCLUDED.captive_portal_name, ironwifi_guests.captive_portal_name),
            venue_id = COALESCE(EXCLUDED.venue_id, ironwifi_guests.venue_id),
            public_ip = COALESCE(EXCLUDED.public_ip, ironwifi_guests.public_ip),
            last_seen_at = CURRENT_TIMESTAMP,
            -- Only increment auth_count if auth_date has changed (new authentication)
            auth_count = CASE 
              WHEN EXCLUDED.auth_date IS DISTINCT FROM ironwifi_guests.auth_date 
              THEN ironwifi_guests.auth_count + 1 
              ELSE ironwifi_guests.auth_count 
            END,
            auth_date = COALESCE(EXCLUDED.auth_date, ironwifi_guests.auth_date),
            updated_at = CURRENT_TIMESTAMP
          RETURNING (xmax = 0) AS was_inserted
        `, [
          guest.id,
          guest.username,
          guest.email,
          guest.fullname,
          guest.firstname,
          guest.lastname,
          guest.phone,
          authDate,
          creationDate,
          guest.source,
          guest.owner_id,
          clientMac,
          apMac,
          routerId,
          guest.captive_portal_name || null,
          guest.venue_id || null,
          guest.public_ip || null,
          creationDate  // Use creation_date as first_seen_at
        ]);
        
        if (result.rows[0]?.was_inserted) {
          inserted++;
        } else {
          updated++;
        }
      } catch (error) {
        errors++;
        logger.error('Error storing guest:', { message: error.message, guest: guest.username || guest.id });
      }
    }
    
    const duration = Date.now() - startTime;
    logger.info(`Guest sync complete: ${inserted} inserted, ${updated} updated, ${errors} errors in ${duration}ms`);
    
    return {
      success: true,
      guestsProcessed: allGuests.length,
      inserted,
      updated,
      errors,
      duration: `${duration}ms`
    };
  } catch (error) {
    logger.error('Guest sync failed:', { message: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Run a sync cycle - fetch sessions from IronWifi API and store locally
 * @returns {Promise<object>} Sync result
 */
async function runSync() {
  const startTime = Date.now();
  
  try {
    // Check if configured
    if (!ironwifiClient.isConfigured()) {
      return {
        success: false,
        skipped: true,
        reason: 'IronWifi not configured (missing IRONWIFI_API_KEY)'
      };
    }
    
    // Check rate limit before starting
    if (ironwifiClient.isApproachingLimit()) {
      const usage = ironwifiClient.getApiUsage();
      logger.warn('IronWifi sync skipped - approaching rate limit', usage);
      return {
        success: false,
        skipped: true,
        reason: 'Rate limit approaching',
        apiUsage: usage
      };
    }
    
    logger.info('Starting IronWifi sync...');
    
    // Get routers with MAC addresses for matching (now returns { exactMap, prefixMap })
    const routerMaps = await getRoutersWithMac();
    
    if (routerMaps.exactMap.size === 0) {
      logger.warn('No routers with MAC addresses - sessions cannot be matched to routers');
    }
    
    // Try to fetch sessions from IronWifi reports
    let sessions = [];
    try {
      sessions = await ironwifiClient.getActiveSessions();
    } catch (error) {
      if (error.isRateLimitError) {
        return {
          success: false,
          skipped: true,
          reason: 'Rate limit exceeded',
          apiUsage: ironwifiClient.getApiUsage()
        };
      }
      // Log but don't fail - sessions may come via webhook
      logger.warn('Could not fetch sessions from API, relying on webhook data', { error: error.message });
    }
    
    // Process each session
    let matchedCount = 0;
    let unmatchedCount = 0;
    let skippedCount = 0;
    
    for (const record of sessions) {
      try {
        const result = await processSession(record, routerMaps);
        
        if (result.skipped) {
          skippedCount++;
        } else if (result.matched) {
          matchedCount++;
        } else {
          unmatchedCount++;
        }
      } catch (error) {
        logger.error('Error processing session:', { 
          message: error.message,
          record: JSON.stringify(record).slice(0, 200)
        });
      }
    }
    
    // Sync guests to ironwifi_guests table (this is the main guest data store)
    // Use a higher page limit to ensure we get all guests, not just recent ones
    let guestResult = { success: false };
    try {
      // Fetch up to 20 pages (2000 guests) - adjust based on your IronWifi account size
      guestResult = await syncGuests(20);
    } catch (error) {
      logger.warn('Guest sync failed:', { message: error.message });
    }
    
    // Mark old sessions as inactive
    await markStaleSessions(30);
    
    // Update daily statistics
    await updateDailyStats();
    
    const duration = Date.now() - startTime;
    const result = {
      success: true,
      sessionsProcessed: sessions.length,
      matched: matchedCount,
      unmatched: unmatchedCount,
      skipped: skippedCount,
      guestsProcessed: guestResult.guestsProcessed || 0,
      routersWithMac: routerMaps.exactMap.size,
      duration: `${duration}ms`,
      apiUsage: ironwifiClient.getApiUsage(),
      note: sessions.length === 0 ? 'Session data comes via webhook - check webhook/stats endpoint' : null
    };
    
    lastSyncTime = new Date();
    lastSyncResult = result;
    
    logger.info('IronWifi sync completed', result);
    return result;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('IronWifi sync failed:', { 
      message: error.message,
      duration: `${duration}ms`
    });
    
    return {
      success: false,
      error: error.message,
      duration: `${duration}ms`
    };
  }
}

/**
 * Get current sync status
 */
function getStatus() {
  return {
    enabled: ironwifiClient.isConfigured(),
    configured: ironwifiClient.isConfigured(),
    syncSchedulerRunning: syncInterval !== null,
    lastSync: lastSyncTime?.toISOString() || null,
    lastSyncResult,
    apiUsage: ironwifiClient.isConfigured() ? ironwifiClient.getApiUsage() : null
  };
}

/**
 * Get session statistics
 */
async function getSessionStats() {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total_sessions,
      COUNT(*) FILTER (WHERE is_active = true) as active_sessions,
      COUNT(DISTINCT router_id) FILTER (WHERE router_id IS NOT NULL) as routers_with_sessions,
      COUNT(*) FILTER (WHERE router_id IS NULL) as unmatched_sessions,
      COUNT(DISTINCT username) as unique_users,
      COALESCE(SUM(bytes_total), 0) as total_bytes,
      MAX(created_at) as last_session_received
    FROM ironwifi_sessions
    WHERE created_at > NOW() - INTERVAL '24 hours'
  `);
  
  return result.rows[0];
}

/**
 * Get active sessions for a specific router
 * @param {string} routerId - Router ID
 */
async function getRouterActiveSessions(routerId) {
  const result = await pool.query(`
    SELECT 
      session_id,
      username,
      user_device_mac,
      session_start,
      last_seen,
      bytes_uploaded,
      bytes_downloaded,
      bytes_total,
      duration_seconds,
      ip_address
    FROM ironwifi_sessions
    WHERE router_id = $1 AND is_active = true
    ORDER BY session_start DESC
  `, [routerId]);
  
  return result.rows;
}

/**
 * Get session history for a router
 * @param {string} routerId - Router ID
 * @param {object} options - Query options
 */
async function getRouterSessionHistory(routerId, options = {}) {
  const { limit = 100, offset = 0, startDate, endDate } = options;
  
  let whereClause = 'WHERE router_id = $1';
  const params = [routerId];
  let paramIndex = 2;
  
  if (startDate) {
    whereClause += ` AND session_start >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  
  if (endDate) {
    whereClause += ` AND session_start <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  
  const result = await pool.query(`
    SELECT 
      session_id,
      username,
      user_device_mac,
      session_start,
      session_end,
      is_active,
      bytes_uploaded,
      bytes_downloaded,
      bytes_total,
      duration_seconds,
      ip_address
    FROM ironwifi_sessions
    ${whereClause}
    ORDER BY session_start DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, [...params, limit, offset]);
  
  return result.rows;
}

/**
 * Get router usage statistics
 * @param {string} routerId - Router ID
 * @param {string} period - Time period ('24h', '7d', '30d', '90d')
 */
async function getRouterStats(routerId, period = '7d') {
  const intervals = {
    '24h': '24 hours',
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days'
  };
  
  const interval = intervals[period] || '7 days';
  
  const result = await pool.query(`
    SELECT 
      COUNT(DISTINCT username) as unique_users,
      COUNT(*) as total_sessions,
      COALESCE(SUM(bytes_uploaded), 0) as bytes_uploaded,
      COALESCE(SUM(bytes_downloaded), 0) as bytes_downloaded,
      COALESCE(SUM(bytes_total), 0) as bytes_total,
      COALESCE(SUM(duration_seconds), 0) as total_duration_seconds,
      COALESCE(AVG(duration_seconds), 0)::integer as avg_session_duration
    FROM ironwifi_sessions
    WHERE router_id = $1
    AND session_start >= NOW() - INTERVAL '${interval}'
  `, [routerId]);
  
  return result.rows[0];
}

/**
 * Start the sync scheduler
 * @param {number} intervalMinutes - Sync interval in minutes
 */
function startSyncScheduler(intervalMinutes = 15) {
  if (syncInterval) {
    logger.warn('IronWifi sync scheduler already running');
    return;
  }
  
  if (!ironwifiClient.isConfigured()) {
    logger.info('IronWifi sync scheduler not started (not configured)');
    return;
  }
  
  const intervalMs = intervalMinutes * 60 * 1000;
  
  // Schedule periodic sync
  syncInterval = setInterval(async () => {
    try {
      await runSync();
    } catch (error) {
      logger.error('Scheduled IronWifi sync failed:', { message: error.message });
    }
  }, intervalMs);
  
  logger.info(`IronWifi sync scheduler started (every ${intervalMinutes} minutes)`);
  
  // Run initial sync after short delay
  setTimeout(async () => {
    try {
      await runSync();
    } catch (error) {
      logger.error('Initial IronWifi sync failed:', { message: error.message });
    }
  }, 10000); // 10 second delay for startup
}

/**
 * Stop the sync scheduler
 */
function stopSyncScheduler() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    logger.info('IronWifi sync scheduler stopped');
  }
}

module.exports = {
  runSync,
  syncGuests,
  getStatus,
  getSessionStats,
  getRouterActiveSessions,
  getRouterSessionHistory,
  getRouterStats,
  startSyncScheduler,
  stopSyncScheduler,
  normalizeMac,
  getMacPrefix,
  matchMacToRouter,
  getRoutersWithMac
};

