/**
 * Guest WiFi Routes
 *
 * Handles webhooks from the self-hosted RADIUS/captive portal
 * and provides API endpoints for guest session data.
 */

const express = require('express');
const router = express.Router();
const { pool, logger } = require('../config/database');

// =============================================================================
// CAPTIVE PORTAL WEBHOOK
// =============================================================================

/**
 * POST /api/guests/captive-portal/event (or /api/ironwifi/webhook for legacy compatibility)
 * Receive events from self-hosted captive portal (RADIUS server)
 *
 * Event types:
 * - registration_completed: Guest registered and connected
 * - free_access_granted: Guest connected with free access
 * - guest_login: Guest logged in
 * - guest_logout: Guest disconnected
 * - session_expired: Session timed out
 */
const captivePortalEventHandler = async (req, res) => {
  try {
    const event = req.body;
    const receivedAt = new Date().toISOString();

    logger.info('Captive portal event received', {
      type: event.type,
      username: event.username || event.guest_id,
      mac: event.mac_address,
      routerMac: event.router_mac,
      receivedAt
    });

    // Acknowledge immediately
    res.status(200).json({
      success: true,
      message: 'Event received',
      timestamp: receivedAt
    });

    // Process event asynchronously
    processGuestEvent(event).catch(error => {
      logger.error('Error processing guest event:', error);
    });

  } catch (error) {
    logger.error('Error handling captive portal event:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Register the handler on multiple paths for compatibility
router.post('/captive-portal/event', captivePortalEventHandler);
router.post('/webhook', captivePortalEventHandler);  // Legacy path for RADIUS server

// Debug endpoint to check session data
router.get('/debug/sessions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, email, username, user_mac, router_id, bytes_total, 
             session_end IS NULL as active, created_at
      FROM wifi_guest_sessions 
      ORDER BY created_at DESC LIMIT 10
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to fix MAC address for a session
router.post('/debug/fix-mac', async (req, res) => {
  try {
    const { email, new_mac } = req.body;
    if (!email || !new_mac) {
      return res.status(400).json({ error: 'email and new_mac required' });
    }
    const normalizedMac = new_mac.toLowerCase().replace(/-/g, ':');
    const result = await pool.query(`
      UPDATE wifi_guest_sessions 
      SET user_mac = $1, updated_at = NOW()
      WHERE email = $2 AND session_end IS NULL
      RETURNING id, email, user_mac
    `, [normalizedMac, email]);
    res.json({ updated: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Normalize MAC address to lowercase with colons
 */
function normalizeMac(mac) {
  if (!mac) return null;
  return mac.toLowerCase().replace(/-/g, ':');
}

/**
 * Find router by MAC address
 * Teltonika routers have different MACs for LAN/WAN/WiFi interfaces
 * that typically only differ in the last octet, so we do fuzzy matching
 */
async function findRouterByMac(mac) {
  if (!mac) return null;

  const normalizedMac = normalizeMac(mac);
  logger.info(`🔍 findRouterByMac: Looking up ${mac} -> normalized: ${normalizedMac}`);

  // Try exact match first with multiple MAC formats
  let result = await pool.query(`
    SELECT router_id, name FROM routers
    WHERE LOWER(REPLACE(mac_address, '-', ':')) = $1
       OR LOWER(REPLACE(mac_address, ':', '-')) = REPLACE($1, ':', '-')
       OR LOWER(REPLACE(mac_address, ':', '')) = REPLACE($1, ':', '')
  `, [normalizedMac]);

  if (result.rows.length > 0) {
    logger.info(`✅ Exact MAC match found: ${result.rows[0].router_id} (${result.rows[0].name})`);
    return result.rows[0];
  }

  // Fuzzy match: match on first 5 octets (first 14 chars like "20:97:27:88:d5")
  // This handles Teltonika routers where LAN/WAN/WiFi MACs differ only in last octet
  const macPrefix = normalizedMac.substring(0, 14); // "xx:xx:xx:xx:xx"
  logger.info(`🔍 Trying fuzzy match with prefix: ${macPrefix}`);
  
  if (macPrefix.length === 14) {
    result = await pool.query(`
      SELECT router_id, name, mac_address FROM routers
      WHERE LOWER(SUBSTRING(REPLACE(mac_address, '-', ':'), 1, 14)) = $1
    `, [macPrefix]);

    if (result.rows.length > 0) {
      logger.info(`✅ Fuzzy MAC match: ${mac} -> ${result.rows[0].name} (${result.rows[0].router_id}) with DB MAC ${result.rows[0].mac_address}`);
      return result.rows[0];
    } else {
      logger.warn(`❌ No fuzzy match for prefix ${macPrefix}`);
    }
  }

  return null;
}

/**
 * Process events from captive portal and RADIUS accounting
 */
async function processGuestEvent(event) {
  const {
    type,
    username,
    guest_id,
    email,
    phone,
    name,
    mac_address,
    router_mac,
    router_id,
    session_id,
    session_duration,
    timestamp,
    // Data consumption fields (from RADIUS accounting)
    bytes_uploaded,
    bytes_downloaded,
    input_octets,
    output_octets,
    // RADIUS accounting specific fields
    acct_status_type,
    acctsessionid,
    calledstationid,
    callingstationid,
    acctsessiontime,
    acctinputoctets,
    acctoutputoctets,
    acctterminatecause
  } = event;

  // For RADIUS accounting, map fields to standard names
  const effectiveSessionId = session_id || acctsessionid;
  const effectiveUsername = username || guest_id;
  // RADIUS username (guest_id) is different from display username (email)
  const radiusUsername = guest_id || username;
  const effectiveRouterMac = router_mac || calledstationid;
  const effectiveMacAddress = mac_address || callingstationid;
  const effectiveSessionDuration = session_duration || acctsessiontime;

  // Debug logging for MAC address tracking
  logger.info(`Processing ${type} event - MAC debug`, {
    mac_address,
    callingstationid,
    effectiveMacAddress,
    type
  });

  // Normalize MAC addresses
  const userMac = normalizeMac(effectiveMacAddress);
  const apMac = normalizeMac(effectiveRouterMac);

  // Find router by MAC or use provided router_id
  let routerId = router_id;
  let routerName = null;

  logger.info(`🔍 Router lookup - router_id: ${router_id}, apMac: ${apMac}`);

  if (!routerId && apMac) {
    const router = await findRouterByMac(apMac);
    if (router) {
      routerId = router.router_id;
      routerName = router.name;
      logger.info(`✅ Matched router by MAC: ${apMac} -> ${routerId} (${routerName})`);
    } else {
      logger.warn(`❌ No router found matching MAC: ${apMac} - checking all routers in DB...`);
      
      // Debug: List all routers to help diagnose
      const allRouters = await pool.query('SELECT router_id, name, mac_address FROM routers LIMIT 5');
      logger.warn(`Available routers: ${JSON.stringify(allRouters.rows)}`);
    }
  } else if (routerId === 'guest') {
    logger.warn(`⚠️ Router ID is "guest" (NAS ID) - attempting MAC lookup anyway with ${apMac}`);
    const router = await findRouterByMac(apMac);
    if (router) {
      routerId = router.router_id;
      routerName = router.name;
      logger.info(`✅ Resolved "guest" to router: ${routerId} (${routerName}) via MAC`);
    }
  }

  // Calculate bytes (support RADIUS accounting field names)
  const bytesUp = bytes_uploaded || output_octets || parseInt(acctoutputoctets) || 0;
  const bytesDown = bytes_downloaded || input_octets || parseInt(acctinputoctets) || 0;

  // Handle different event types
  switch (type) {
    case 'registration_completed':
    case 'free_access_granted':
    case 'guest_registration':
    case 'guest_login':
    case 'radius_auth':
      await upsertGuestSession({
        sessionId: effectiveSessionId,
        username: effectiveUsername || email,
        radiusUsername,  // Store RADIUS username separately for accounting match
        email,
        phone,
        name,
        userMac,
        apMac,
        routerId,
        sessionDuration: effectiveSessionDuration,
        timestamp,
        eventType: type
      });
      break;

    case 'radius_accounting':
      // Handle RADIUS accounting packets (Start, Interim-Update, Stop)
      await handleRadiusAccounting({
        statusType: acct_status_type,
        sessionId: effectiveSessionId,
        username: effectiveUsername,
        userMac,
        apMac,
        routerId,
        sessionDuration: parseInt(acctsessiontime) || 0,
        bytesUploaded: bytesUp,
        bytesDownloaded: bytesDown,
        terminateCause: acctterminatecause,
        timestamp
      });
      break;

    case 'accounting_update':
    case 'session_update':
      await updateSessionAccounting({
        sessionId: effectiveSessionId,
        username: effectiveUsername,
        bytesUploaded: bytesUp,
        bytesDownloaded: bytesDown,
        sessionDuration: effectiveSessionDuration
      });
      break;

    case 'guest_logout':
    case 'session_expired':
      await endGuestSession({
        sessionId: effectiveSessionId,
        username: effectiveUsername,
        userMac,
        routerId,
        timestamp,
        reason: type === 'session_expired' ? 'timeout' : 'logout',
        bytesUploaded: bytesUp,
        bytesDownloaded: bytesDown
      });
      break;

    default:
      logger.warn('Unknown guest event type:', type);
  }
}

/**
 * Insert or update a guest session
 */
async function upsertGuestSession({ sessionId, username, email, phone, name, userMac, apMac, routerId, sessionDuration, timestamp, eventType }) {
  try {
    logger.info(`Upserting guest session`, { sessionId, username, email, userMac, routerId, eventType });
    
    // Insert into wifi_guest_sessions table
    await pool.query(`
      INSERT INTO wifi_guest_sessions (
        session_id, username, email, phone, guest_name,
        user_mac, router_mac, router_id,
        session_start, session_duration_seconds, event_type,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      ON CONFLICT (session_id) DO UPDATE SET
        session_duration_seconds = COALESCE(EXCLUDED.session_duration_seconds, wifi_guest_sessions.session_duration_seconds),
        updated_at = NOW()
    `, [
      sessionId,
      username,
      email,
      phone,
      name,
      userMac,
      apMac,
      routerId,
      timestamp || new Date().toISOString(),
      sessionDuration,
      eventType
    ]);

    // Update router's guest activity
    if (routerId) {
      await pool.query(`
        UPDATE routers SET
          last_guest_activity = NOW()
        WHERE router_id = $1
      `, [routerId]);
    }

    logger.info(`Guest session recorded: ${username} on router ${routerId || 'unknown'}`);

  } catch (error) {
    logger.error('Error recording guest session:', error);
    throw error;
  }
}

/**
 * End a guest session
 * Match by RADIUS session_id for accurate per-session tracking
 */
async function endGuestSession({ sessionId, username, userMac, routerId, timestamp, reason, bytesUploaded = 0, bytesDownloaded = 0 }) {
  try {
    const bytesTotal = (bytesUploaded || 0) + (bytesDownloaded || 0);
    
    // First try to match by session_id (most accurate)
    let result = await pool.query(`
      UPDATE wifi_guest_sessions
      SET session_end = $1,
          end_reason = $2,
          bytes_uploaded = COALESCE($4, bytes_uploaded, 0),
          bytes_downloaded = COALESCE($5, bytes_downloaded, 0),
          bytes_total = COALESCE($6, bytes_total, 0),
          last_accounting_update = NOW(),
          updated_at = NOW()
      WHERE session_id = $3
        AND session_end IS NULL
    `, [timestamp || new Date().toISOString(), reason, sessionId, bytesUploaded || null, bytesDownloaded || null, bytesTotal || null]);

    // Fallback: match by MAC for the MOST RECENT active session only
    if (result.rowCount === 0 && userMac) {
      result = await pool.query(`
        UPDATE wifi_guest_sessions
        SET session_end = $1,
            end_reason = $2,
            bytes_uploaded = COALESCE($4, bytes_uploaded, 0),
            bytes_downloaded = COALESCE($5, bytes_downloaded, 0),
            bytes_total = COALESCE($6, bytes_total, 0),
            last_accounting_update = NOW(),
            updated_at = NOW()
        WHERE id = (
          SELECT id 
          FROM wifi_guest_sessions 
          WHERE LOWER(REPLACE(user_mac, '-', ':')) = LOWER(REPLACE($3, '-', ':'))
            AND session_end IS NULL
          ORDER BY session_start DESC
          LIMIT 1
        )
      `, [timestamp || new Date().toISOString(), reason, userMac, bytesUploaded || null, bytesDownloaded || null, bytesTotal || null]);
    }

    if (result.rowCount > 0) {
      logger.info(`Guest session ended: ${userMac} (${username}) - ${reason}, data: ${formatBytes(bytesTotal)}`);
    } else {
      logger.warn(`No active session found for MAC ${userMac} to end`);
    }
  } catch (error) {
    logger.error('Error ending guest session:', error);
    throw error;
  }
}

/**
 * Update session accounting (data consumption)
 * Match by RADIUS session_id for accurate per-session tracking
 */
async function updateSessionAccounting({ sessionId, username, userMac, bytesUploaded = 0, bytesDownloaded = 0, sessionDuration }) {
  try {
    const bytesTotal = (bytesUploaded || 0) + (bytesDownloaded || 0);
    
    // First try to match by session_id (most accurate - unique per RADIUS session)
    let result = await pool.query(`
      UPDATE wifi_guest_sessions
      SET bytes_uploaded = $2,
          bytes_downloaded = $3,
          bytes_total = $4,
          session_duration_seconds = COALESCE($5, session_duration_seconds),
          last_accounting_update = NOW(),
          updated_at = NOW()
      WHERE session_id = $1
        AND session_end IS NULL
    `, [sessionId, bytesUploaded, bytesDownloaded, bytesTotal, sessionDuration]);

    // Fallback: if session_id doesn't match (captive portal may use different ID),
    // match by MAC and username for the MOST RECENT active session only
    if (result.rowCount === 0 && userMac) {
      result = await pool.query(`
        UPDATE wifi_guest_sessions
        SET bytes_uploaded = $2,
            bytes_downloaded = $3,
            bytes_total = $4,
            session_duration_seconds = COALESCE($5, session_duration_seconds),
            last_accounting_update = NOW(),
            updated_at = NOW()
        WHERE id = (
          SELECT id 
          FROM wifi_guest_sessions 
          WHERE LOWER(REPLACE(user_mac, '-', ':')) = LOWER(REPLACE($1, '-', ':'))
            AND session_end IS NULL
          ORDER BY session_start DESC
          LIMIT 1
        )
      `, [userMac, bytesUploaded, bytesDownloaded, bytesTotal, sessionDuration]);
    }

    if (result.rowCount > 0) {
      logger.debug(`Session accounting updated: ${userMac} (${username}), data: ${formatBytes(bytesTotal)}`);
    } else {
      logger.warn(`No active session found for MAC ${userMac} to update accounting`);
    }
  } catch (error) {
    logger.error('Error updating session accounting:', error);
    throw error;
  }
}

/**
 * Handle RADIUS accounting packets
 * Status types: Start, Interim-Update, Stop
 */
async function handleRadiusAccounting({ statusType, sessionId, username, userMac, apMac, routerId, sessionDuration, bytesUploaded, bytesDownloaded, terminateCause, timestamp }) {
  const bytesTotal = (bytesUploaded || 0) + (bytesDownloaded || 0);
  
  switch (statusType) {
    case 'Start':
      // Session starting - create or update the session record
      logger.info(`RADIUS Start: ${username} on router ${routerId || apMac}`);
      // The session should already exist from captive portal auth
      // Just ensure we have the session_id linked
      await pool.query(`
        UPDATE wifi_guest_sessions
        SET updated_at = NOW()
        WHERE session_id = $1 OR (username = $2 AND session_end IS NULL)
      `, [sessionId, username]);
      break;

    case 'Interim-Update':
      // Periodic update with current usage
      logger.debug(`RADIUS Interim: ${userMac} (${username}), ${formatBytes(bytesTotal)}`);
      await updateSessionAccounting({
        sessionId,
        username,
        userMac,
        bytesUploaded,
        bytesDownloaded,
        sessionDuration
      });
      break;

    case 'Stop':
      // Session ended
      logger.info(`RADIUS Stop: ${username}, duration: ${sessionDuration}s, data: ${formatBytes(bytesTotal)}, cause: ${terminateCause}`);
      await endGuestSession({
        sessionId,
        username,
        userMac,
        routerId,
        timestamp,
        reason: terminateCause || 'session_end',
        bytesUploaded,
        bytesDownloaded
      });
      break;

    default:
      logger.warn(`Unknown RADIUS accounting status: ${statusType}`);
  }
}

/**
 * Format bytes for logging
 */
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
  return n + ' B';
}

/**
 * Auto-expire stale sessions
 * Marks sessions as ended if they've been active for > 25 hours (24h timeout + 1h buffer)
 * or if last accounting update was > 2 hours ago
 */
async function expireStaleSessionsTask() {
  try {
    // Expire sessions that have been active for more than 25 hours
    const expireByDurationResult = await pool.query(`
      UPDATE wifi_guest_sessions
      SET 
        session_end = session_start + INTERVAL '25 hours',
        terminate_reason = 'timeout_auto_expired',
        updated_at = NOW()
      WHERE session_end IS NULL
        AND session_start < NOW() - INTERVAL '25 hours'
      RETURNING id, username, user_mac
    `);

    // Expire sessions with no accounting updates for 2+ hours
    const expireByAccountingResult = await pool.query(`
      UPDATE wifi_guest_sessions
      SET 
        session_end = last_accounting_update + INTERVAL '5 minutes',
        terminate_reason = 'idle_auto_expired',
        updated_at = NOW()
      WHERE session_end IS NULL
        AND last_accounting_update IS NOT NULL
        AND last_accounting_update < NOW() - INTERVAL '2 hours'
      RETURNING id, username, user_mac
    `);

    const totalExpired = expireByDurationResult.rowCount + expireByAccountingResult.rowCount;
    if (totalExpired > 0) {
      logger.info(`Auto-expired ${totalExpired} stale sessions (${expireByDurationResult.rowCount} by duration, ${expireByAccountingResult.rowCount} by idle)`);
    }
    
    return totalExpired;
  } catch (error) {
    logger.error('Error expiring stale sessions:', error);
    return 0;
  }
}

// =============================================================================
// API ENDPOINTS
// =============================================================================

/**
 * GET /api/guests
 * Get all guest sessions with optional filtering
 */
router.get('/', async (req, res) => {
  try {
    const { router_id, limit = 100, offset = 0, active_only } = req.query;
    
    let query = `
      SELECT 
        s.*,
        r.name as router_name
      FROM wifi_guest_sessions s
      LEFT JOIN routers r ON s.router_id = r.router_id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (router_id) {
      query += ` AND s.router_id = $${paramIndex++}`;
      params.push(router_id);
    }
    
    if (active_only === 'true') {
      query += ` AND s.session_end IS NULL`;
    }
    
    query += ` ORDER BY s.session_start DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await pool.query(query, params);
    
    // Get total count
    let countQuery = `SELECT COUNT(*) FROM wifi_guest_sessions WHERE 1=1`;
    const countParams = [];
    let countParamIndex = 1;
    
    if (router_id) {
      countQuery += ` AND router_id = $${countParamIndex++}`;
      countParams.push(router_id);
    }
    if (active_only === 'true') {
      countQuery += ` AND session_end IS NULL`;
    }
    
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      guests: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    logger.error('Error fetching guests:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/guests/stats
 * Get guest statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const { router_id, days = 30 } = req.query;
    
    // Auto-expire stale sessions before calculating stats
    await expireStaleSessionsTask();
    
    let whereClause = `WHERE session_start > NOW() - INTERVAL '${parseInt(days)} days'`;
    const params = [];
    
    if (router_id) {
      whereClause += ` AND router_id = $1`;
      params.push(router_id);
    }
    
    // Overall stats
    const statsQuery = `
      SELECT 
        COUNT(*) as total_sessions,
        COUNT(DISTINCT username) as unique_guests,
        COUNT(DISTINCT router_id) as routers_used,
        COUNT(DISTINCT user_mac) as unique_devices,
        AVG(session_duration_seconds) as avg_session_duration,
        COUNT(*) FILTER (WHERE session_end IS NULL) as active_sessions
      FROM wifi_guest_sessions
      ${whereClause}
    `;
    
    const statsResult = await pool.query(statsQuery, params);
    
    // Sessions by router
    const byRouterQuery = `
      SELECT 
        s.router_id,
        r.name as router_name,
        COUNT(*) as session_count,
        COUNT(DISTINCT s.username) as unique_guests,
        COALESCE(SUM(s.bytes_total), 0) as total_bytes
      FROM wifi_guest_sessions s
      LEFT JOIN routers r ON s.router_id = r.router_id
      ${whereClause}
      GROUP BY s.router_id, r.name
      ORDER BY session_count DESC
      LIMIT 10
    `;
    
    const byRouterResult = await pool.query(byRouterQuery, params);
    
    // Sessions over time (daily)
    const timelineQuery = `
      SELECT 
        DATE(session_start) as date,
        COUNT(*) as sessions,
        COUNT(DISTINCT username) as unique_guests
      FROM wifi_guest_sessions
      ${whereClause}
      GROUP BY DATE(session_start)
      ORDER BY date DESC
      LIMIT 30
    `;
    
    const timelineResult = await pool.query(timelineQuery, params);
    
    res.json({
      summary: statsResult.rows[0],
      byRouter: byRouterResult.rows,
      timeline: timelineResult.rows,
      period: `${days} days`
    });
    
  } catch (error) {
    logger.error('Error fetching guest stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/guests/router/:routerId
 * Get guests for a specific router
 */
router.get('/router/:routerId', async (req, res) => {
  try {
    const { routerId } = req.params;
    const { limit = 50, days = 7 } = req.query;
    
    const result = await pool.query(`
      SELECT 
        session_id,
        username,
        email,
        phone,
        guest_name,
        user_mac,
        session_start,
        session_end,
        session_duration_seconds,
        event_type,
        bytes_uploaded,
        bytes_downloaded,
        bytes_total
      FROM wifi_guest_sessions
      WHERE router_id = $1
        AND session_start > NOW() - INTERVAL '${parseInt(days)} days'
      ORDER BY session_start DESC
      LIMIT $2
    `, [routerId, parseInt(limit)]);
    
    // Get summary stats for this router
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_sessions,
        COUNT(DISTINCT username) as unique_guests,
        COUNT(*) FILTER (WHERE session_end IS NULL) as active_sessions,
        COALESCE(SUM(bytes_uploaded), 0) as total_bytes_uploaded,
        COALESCE(SUM(bytes_downloaded), 0) as total_bytes_downloaded,
        COALESCE(SUM(bytes_total), 0) as total_bytes
      FROM wifi_guest_sessions
      WHERE router_id = $1
        AND session_start > NOW() - INTERVAL '${parseInt(days)} days'
    `, [routerId]);
    
    res.json({
      routerId,
      guests: result.rows,
      stats: statsResult.rows[0],
      period: `${days} days`
    });
    
  } catch (error) {
    logger.error('Error fetching router guests:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/guests/recent
 * Get most recent guest sessions across all routers
 */
router.get('/recent', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    // Auto-expire stale sessions before returning results
    await expireStaleSessionsTask();
    
    const result = await pool.query(`
      SELECT 
        s.*,
        r.name as router_name
      FROM wifi_guest_sessions s
      LEFT JOIN routers r ON s.router_id = r.router_id
      ORDER BY s.session_start DESC
      LIMIT $1
    `, [parseInt(limit)]);
    
    res.json({
      guests: result.rows,
      count: result.rows.length
    });
    
  } catch (error) {
    logger.error('Error fetching recent guests:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// RADIUS ACCOUNTING SYNC ENDPOINTS
// =============================================================================

const radiusSync = require('../services/radiusAccountingSync');

/**
 * POST /api/guests/sync-accounting
 * Manually trigger accounting sync for all active sessions
 */
router.post('/sync-accounting', async (req, res) => {
  try {
    const result = await radiusSync.syncAllActiveSessions();
    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error syncing accounting:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/guests/:username/sync
 * Sync accounting data for a specific user
 */
router.post('/:username/sync', async (req, res) => {
  try {
    const { username } = req.params;
    const result = await radiusSync.syncAccountingForUser(username);
    
    if (result) {
      res.json({
        success: true,
        session: result,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Session not found or no accounting data available'
      });
    }
  } catch (error) {
    logger.error(`Error syncing accounting for ${req.params.username}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/guests/:username/reset-usage
 * Reset data usage for a specific user (admin action)
 */
router.post('/:username/reset-usage', async (req, res) => {
  try {
    const { username } = req.params;
    const adminUser = req.user?.username || req.body.admin_user || 'api';
    
    const result = await radiusSync.resetUserDataUsage(username, adminUser);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error(`Error resetting usage for ${req.params.username}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/guests/:username/usage
 * Get real-time usage for a specific user from RADIUS
 */
router.get('/:username/usage', async (req, res) => {
  try {
    const { username } = req.params;
    const usage = await radiusSync.getRealTimeUsage(username);

    if (usage) {
      res.json({
        success: true,
        usage,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'No active session found'
      });
    }
  } catch (error) {
    logger.error(`Error getting usage for ${req.params.username}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/guests/session/:sessionId
 * Delete a guest session by ID
 */
router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const result = await pool.query(
      'DELETE FROM wifi_guest_sessions WHERE id = $1 RETURNING id, username, email',
      [sessionId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    logger.info(`Guest session deleted: ${result.rows[0].email || result.rows[0].username} (ID: ${sessionId})`);

    res.json({
      success: true,
      deleted: result.rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error deleting session ${req.params.sessionId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

