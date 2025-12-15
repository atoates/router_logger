/**
 * IronWifi Integration Routes
 * 
 * Supports two data ingestion methods:
 * 1. Webhook - Receives scheduled reports from IronWifi Report Scheduler
 * 2. API Polling - Fetches data from IronWifi REST API
 * 
 * Both methods store session data in ironwifi_sessions table.
 */

const express = require('express');
const router = express.Router();
const { pool, logger } = require('../config/database');
const { validateIronwifiWebhookPayload } = require('../utils/validation');
const ironwifiSync = require('../services/ironwifiSync');
const ironwifiClient = require('../services/ironwifiClient');

/**
 * POST /api/ironwifi/webhook
 * Receive webhook data from IronWifi Report Scheduler
 * 
 * IronWifi can send reports via webhook with various data:
 * - Device status reports
 * - RADIUS accounting data
 * - Session information
 * - Access point status
 */
router.post('/webhook', async (req, res) => {
  try {
    const webhookData = req.body;
    const receivedAt = new Date().toISOString();
    
    // Log webhook receipt with details for debugging
    logger.info('IronWifi webhook received', {
      bodyType: typeof webhookData,
      contentType: req.headers['content-type'],
      bodyLength: JSON.stringify(webhookData).length,
      isArray: Array.isArray(webhookData),
      recordCount: Array.isArray(webhookData) ? webhookData.length : 
                   (webhookData?.records?.length || webhookData?.data?.length || 'N/A'),
      sampleFields: webhookData && typeof webhookData === 'object' ? 
                    Object.keys(Array.isArray(webhookData) ? (webhookData[0] || {}) : webhookData).slice(0, 10) : [],
      receivedAt
    });
    
    // Store webhook receipt in database for debugging
    try {
      await pool.query(`
        INSERT INTO ironwifi_webhook_log (received_at, content_type, record_count, raw_sample, processed)
        VALUES ($1, $2, $3, $4, false)
      `, [
        receivedAt,
        req.headers['content-type'],
        Array.isArray(webhookData) ? webhookData.length : 1,
        JSON.stringify(webhookData).slice(0, 5000) // Store first 5KB for debugging
      ]);
    } catch (dbError) {
      // Table might not exist yet, log but continue
      logger.debug('Could not log webhook to database:', dbError.message);
    }

    // Validate basic shape; we always ACK 200 to avoid aggressive retries,
    // but we will skip processing invalid payloads to protect the DB.
    const validation = validateIronwifiWebhookPayload(webhookData);
    if (!validation.ok) {
      logger.warn('IronWifi webhook payload failed validation (skipping processing)', {
        errors: validation.errors,
        bodyType: typeof webhookData
      });
    }

    // Acknowledge receipt immediately
    res.status(200).json({
      success: true,
      message: 'Webhook received',
      timestamp: new Date().toISOString()
    });

    // Process webhook data asynchronously
    if (validation.ok) {
      processWebhookData(webhookData).catch(error => {
        logger.error('Error processing IronWifi webhook:', error);
      });
    }

  } catch (error) {
    logger.error('Error handling IronWifi webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Process webhook data from IronWifi
 * Handles different report types and formats
 */
async function processWebhookData(data) {
  logger.info('Processing IronWifi webhook data...');

  // IronWifi report format might be CSV, JSON, or other
  // We'll need to handle different formats based on what they send
  
  if (Array.isArray(data)) {
    // Array of records (likely JSON format)
    await processJsonReport(data);
  } else if (typeof data === 'string') {
    // Might be CSV or text format
    await processTextReport(data);
  } else if (data.records || data.data || data.rows) {
    // Wrapped in container object
    const records = data.records || data.data || data.rows;
    await processJsonReport(records);
  } else {
    logger.warn('Unknown webhook data format:', typeof data);
  }
}

/**
 * Process JSON-formatted report data
 * Supports both standard RADIUS accounting fields and IronWifi-specific fields
 */
async function processJsonReport(records) {
  logger.info(`Processing ${records.length} records from webhook`);

  for (const record of records) {
    try {
      // IronWifi RADIUS Accounting fields (actual format from your reports):
      // - calledstationid: AP MAC (router)
      // - callingstationid: User device MAC
      // - username: User email
      // - acctsessionid: Unique session ID
      // - acctstarttime: Session start (ISO format)
      // - acctstoptime: Session stop (ISO format)
      // - acctinputoctets: Bytes downloaded by user
      // - acctoutputoctets: Bytes uploaded by user
      // - acctsessiontime: Duration in seconds
      // - framedipaddress: User's IP address
      // - nasipaddress: NAS/Controller IP

      const sessionData = {
        // AP MAC (Router) - IronWifi uses calledstationid
        ap_mac: record.calledstationid || record.called_station_id || record.nas_identifier || record.ap_mac,
        // User device MAC
        user_mac: record.callingstationid || record.calling_station_id || record.mac_address,
        // Username
        username: record.username || record.user_name,
        // Session ID
        session_id: record.acctsessionid || record.acct_session_id || record.session_id,
        // Session timing
        session_start: record.acctstarttime || record.acct_start_time || record.start_time,
        session_stop: record.acctstoptime || record.acct_stop_time || record.stop_time,
        // Bandwidth (IronWifi: input=download, output=upload)
        bytes_in: parseInt(record.acctinputoctets || record.acct_input_octets || record.input_octets || 0),
        bytes_out: parseInt(record.acctoutputoctets || record.acct_output_octets || record.output_octets || 0),
        // Duration
        duration: parseInt(record.acctsessiontime || record.acct_session_time || record.session_time || 0),
        // Network info
        nas_ip: record.nasipaddress || record.nas_ip_address || record.nas_ip,
        framed_ip: record.framedipaddress || record.framed_ip_address || record.ip_address,
        // Termination reason
        terminate_cause: record.acctterminatecause || record.acct_terminate_cause || record.status
      };

      // If we have valid session data, store it
      if (sessionData.ap_mac || sessionData.session_id) {
        await storeSessionFromWebhook(sessionData);
      } else {
        logger.debug('Skipping record without AP MAC or session ID', record);
      }

    } catch (error) {
      logger.error('Error processing webhook record:', error, record);
    }
  }

  logger.info('Finished processing webhook records');
}

/**
 * Process text/CSV-formatted report data
 * Handles IronWifi RADIUS Accounting CSV format
 */
async function processTextReport(text) {
  logger.info('Processing text/CSV report from webhook');
  
  // Parse CSV format from IronWifi
  const lines = text.split('\n').filter(line => line.trim());
  const records = [];

  if (lines.length > 1) {
    // First line is headers
    const headers = lines[0].split(',').map(h => h.trim());
    logger.info(`CSV headers: ${headers.join(', ')}`);
    
    // Parse each data line
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      // Split by comma, handling quoted values
      const values = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
      const record = {};
      
      headers.forEach((header, index) => {
        let value = values[index] || '';
        // Remove quotes if present
        value = value.replace(/^"|"$/g, '').trim();
        record[header] = value;
      });
      
      records.push(record);
    }
  }

  logger.info(`Parsed ${records.length} records from CSV`);
  
  // Process the parsed records
  if (records.length > 0) {
    await processJsonReport(records);
  }
}

/**
 * Normalize MAC address to consistent format
 */
function normalizeMac(mac) {
  if (!mac) return null;
  const cleaned = mac.toLowerCase().replace(/[:-]/g, '');
  if (cleaned.length < 10 || !/^[0-9a-f]+$/.test(cleaned)) return null;
  const padded = cleaned.padEnd(12, '0').slice(0, 12);
  return padded.match(/.{1,2}/g).join(':');
}

/**
 * Get MAC prefix (first 5 bytes) for matching
 */
function getMacPrefix(mac) {
  const normalized = normalizeMac(mac);
  if (!normalized) return null;
  return normalized.slice(0, 14); // aa:bb:cc:dd:ee
}

/**
 * Store session data received from webhook
 */
async function storeSessionFromWebhook(sessionData) {
  try {
    const apMac = normalizeMac(sessionData.ap_mac);
    const userMac = normalizeMac(sessionData.user_mac);

    if (!apMac && !sessionData.session_id) {
      logger.debug('Skipping session - no identifiable MAC or session ID');
      return;
    }

    // Try to match to a router by MAC address using prefix matching
    let routerId = null;
    if (apMac) {
      // First try exact match
      let routerResult = await pool.query(
        'SELECT router_id, name FROM routers WHERE mac_address = $1',
        [apMac]
      );
      
      // If no exact match, try prefix match (first 5 bytes)
      if (routerResult.rows.length === 0) {
        const prefix = getMacPrefix(apMac);
        if (prefix) {
          routerResult = await pool.query(
            'SELECT router_id, name, mac_address FROM routers WHERE LEFT(mac_address, 14) = $1',
            [prefix]
          );
          if (routerResult.rows.length > 0) {
            logger.info(`Matched by MAC prefix: ${apMac} -> ${routerResult.rows[0].name} (${routerResult.rows[0].mac_address})`);
          }
        }
      }
      
      if (routerResult.rows.length > 0) {
        routerId = routerResult.rows[0].router_id;
      } else {
        logger.debug(`No router found for MAC: ${apMac} (prefix: ${getMacPrefix(apMac)})`);
      }
    }

    // Insert or update session
    await pool.query(
      `INSERT INTO ironwifi_sessions (
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
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (session_id) DO UPDATE SET
        router_id = COALESCE($1, ironwifi_sessions.router_id),
        session_end = COALESCE($7, ironwifi_sessions.session_end),
        last_seen = $8,
        is_active = $9,
        bytes_uploaded = $10,
        bytes_downloaded = $11,
        bytes_total = $12,
        duration_seconds = $13,
        updated_at = CURRENT_TIMESTAMP`,
      [
        routerId,
        apMac,
        sessionData.session_id || `webhook_${Date.now()}_${Math.random()}`,
        sessionData.username,
        userMac,
        sessionData.session_start ? new Date(sessionData.session_start) : new Date(),
        sessionData.session_stop ? new Date(sessionData.session_stop) : null,
        new Date(),
        !sessionData.session_stop, // is_active if no stop time
        parseInt(sessionData.bytes_out) || 0,
        parseInt(sessionData.bytes_in) || 0,
        (parseInt(sessionData.bytes_in) || 0) + (parseInt(sessionData.bytes_out) || 0),
        parseInt(sessionData.duration) || 0,
        sessionData.framed_ip
      ]
    );

    logger.debug('Stored session from webhook', {
      routerId,
      apMac,
      username: sessionData.username
    });

  } catch (error) {
    logger.error('Error storing webhook session:', error);
    throw error;
  }
}

/**
 * GET /api/ironwifi/webhook/test
 * Test endpoint to verify webhook is accessible
 */
router.get('/webhook/test', (req, res) => {
  res.json({
    success: true,
    message: 'IronWifi webhook endpoint is accessible',
    url: `${req.protocol}://${req.get('host')}/api/ironwifi/webhook`,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/ironwifi/webhook/stats
 * Get statistics about webhook data received
 */
router.get('/webhook/stats', async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT 
        COUNT(*) as total_sessions,
        COUNT(DISTINCT router_id) as unique_routers,
        COUNT(DISTINCT username) as unique_users,
        MAX(created_at) as last_received,
        SUM(bytes_total) as total_bytes
       FROM ironwifi_sessions
       WHERE created_at > NOW() - INTERVAL '24 hours'`
    );

    res.json({
      success: true,
      last24Hours: stats.rows[0]
    });
  } catch (error) {
    logger.error('Error getting webhook stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// API-BASED ENDPOINTS (for sync status, manual sync, and session queries)
// ============================================================================

/**
 * GET /api/ironwifi/status
 * Get current IronWifi integration status
 */
router.get('/status', async (req, res) => {
  try {
    const status = ironwifiSync.getStatus();
    const sessionStats = await ironwifiSync.getSessionStats();
    
    // Test API connection if configured
    let apiStatus = null;
    if (status.configured) {
      apiStatus = await ironwifiClient.testConnection();
    }
    
    res.json({
      success: true,
      ...status,
      apiConnected: apiStatus?.connected || false,
      apiMessage: apiStatus?.message,
      sessionStats
    });
  } catch (error) {
    logger.error('Error getting IronWifi status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ironwifi/sync
 * Trigger manual sync from IronWifi API
 */
router.post('/sync', async (req, res) => {
  try {
    logger.info('Manual IronWifi sync triggered');
    const result = await ironwifiSync.runSync();
    res.json(result);
  } catch (error) {
    logger.error('Error triggering IronWifi sync:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * GET /api/ironwifi/sessions
 * Get all sessions with optional filters
 */
router.get('/sessions', async (req, res) => {
  try {
    const { limit = 100, offset = 0, active, router_id } = req.query;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (active === 'true') {
      whereClause += ' AND is_active = true';
    } else if (active === 'false') {
      whereClause += ' AND is_active = false';
    }
    
    if (router_id) {
      whereClause += ` AND router_id = $${paramIndex}`;
      params.push(router_id);
      paramIndex++;
    }
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.session_id,
        s.router_id,
        r.name as router_name,
        s.username,
        s.user_device_mac,
        s.session_start,
        s.session_end,
        s.is_active,
        s.bytes_uploaded,
        s.bytes_downloaded,
        s.bytes_total,
        s.duration_seconds,
        s.ip_address,
        s.created_at
      FROM ironwifi_sessions s
      LEFT JOIN routers r ON s.router_id = r.router_id
      ${whereClause}
      ORDER BY s.session_start DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, parseInt(limit), parseInt(offset)]);
    
    const countResult = await pool.query(`
      SELECT COUNT(*) FROM ironwifi_sessions ${whereClause}
    `, params);
    
    res.json({
      success: true,
      sessions: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    logger.error('Error fetching sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/router/:routerId/active-users
 * Get active users for a specific router
 */
router.get('/router/:routerId/active-users', async (req, res) => {
  try {
    const { routerId } = req.params;
    const sessions = await ironwifiSync.getRouterActiveSessions(routerId);
    
    res.json({
      success: true,
      routerId,
      activeUsers: sessions.length,
      sessions
    });
  } catch (error) {
    logger.error('Error fetching router active users:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/router/:routerId/sessions
 * Get session history for a specific router
 */
router.get('/router/:routerId/sessions', async (req, res) => {
  try {
    const { routerId } = req.params;
    const { limit = 100, offset = 0, start_date, end_date } = req.query;
    
    const sessions = await ironwifiSync.getRouterSessionHistory(routerId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      startDate: start_date,
      endDate: end_date
    });
    
    res.json({
      success: true,
      routerId,
      sessions,
      count: sessions.length
    });
  } catch (error) {
    logger.error('Error fetching router session history:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/router/:routerId/stats
 * Get usage statistics for a specific router
 */
router.get('/router/:routerId/stats', async (req, res) => {
  try {
    const { routerId } = req.params;
    const { period = '7d' } = req.query;
    
    const stats = await ironwifiSync.getRouterStats(routerId, period);
    
    res.json({
      success: true,
      routerId,
      period,
      stats
    });
  } catch (error) {
    logger.error('Error fetching router stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/routers-with-mac
 * Get all routers that have MAC addresses configured
 */
router.get('/routers-with-mac', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT router_id, name, mac_address, last_seen
      FROM routers
      WHERE mac_address IS NOT NULL AND mac_address != ''
      ORDER BY name
    `);
    
    res.json({
      success: true,
      routers: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Error fetching routers with MAC:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/network/active-users
 * Get active users across all routers
 */
router.get('/network/active-users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        r.router_id,
        r.name as router_name,
        COUNT(s.id) as active_sessions,
        COUNT(DISTINCT s.username) as unique_users
      FROM routers r
      LEFT JOIN ironwifi_sessions s ON r.router_id = s.router_id AND s.is_active = true
      WHERE r.mac_address IS NOT NULL
      GROUP BY r.router_id, r.name
      HAVING COUNT(s.id) > 0
      ORDER BY active_sessions DESC
    `);
    
    const totalActive = result.rows.reduce((sum, r) => sum + parseInt(r.active_sessions), 0);
    
    res.json({
      success: true,
      totalActiveUsers: totalActive,
      routersWithUsers: result.rows.length,
      byRouter: result.rows
    });
  } catch (error) {
    logger.error('Error fetching network active users:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/network/stats
 * Get network-wide statistics
 */
router.get('/network/stats', async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    
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
        COUNT(DISTINCT router_id) as routers_used,
        COALESCE(SUM(bytes_total), 0) as total_bytes,
        COALESCE(AVG(duration_seconds), 0)::integer as avg_session_duration
      FROM ironwifi_sessions
      WHERE session_start >= NOW() - INTERVAL '${interval}'
    `);
    
    // Top routers
    const topRouters = await pool.query(`
      SELECT 
        s.router_id,
        r.name as router_name,
        COUNT(*) as session_count,
        COUNT(DISTINCT s.username) as unique_users
      FROM ironwifi_sessions s
      LEFT JOIN routers r ON s.router_id = r.router_id
      WHERE s.session_start >= NOW() - INTERVAL '${interval}'
      AND s.router_id IS NOT NULL
      GROUP BY s.router_id, r.name
      ORDER BY session_count DESC
      LIMIT 10
    `);
    
    res.json({
      success: true,
      period,
      stats: result.rows[0],
      topRouters: topRouters.rows
    });
  } catch (error) {
    logger.error('Error fetching network stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/webhook/history
 * View recent webhook receipts for debugging
 */
router.get('/webhook/history', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const result = await pool.query(`
      SELECT id, received_at, content_type, record_count, processed, error_message,
             LEFT(raw_sample, 500) as sample_preview
      FROM ironwifi_webhook_log
      ORDER BY received_at DESC
      LIMIT $1
    `, [parseInt(limit)]);
    
    res.json({
      success: true,
      webhooks: result.rows,
      count: result.rows.length,
      message: result.rows.length === 0 ? 
        'No webhooks received yet. Check IronWifi Console → Reports → Report Scheduler' : null
    });
  } catch (error) {
    // Table might not exist
    if (error.code === '42P01') {
      res.json({
        success: true,
        webhooks: [],
        count: 0,
        message: 'Webhook log table not created yet. Deploy and restart to create it.'
      });
    } else {
      logger.error('Error fetching webhook history:', error);
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * GET /api/ironwifi/guests
 * Get cached guest data from database
 * This is the main endpoint for displaying guest WiFi users
 */
router.get('/guests', async (req, res) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;
    
    let whereClause = '';
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      whereClause = `WHERE username ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR fullname ILIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    const result = await pool.query(`
      SELECT id, ironwifi_id, username, email, fullname, phone, 
             auth_date, creation_date, auth_count, first_seen_at, last_seen_at
      FROM ironwifi_guests
      ${whereClause}
      ORDER BY auth_date DESC NULLS LAST
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, parseInt(limit), parseInt(offset)]);
    
    const countResult = await pool.query(`
      SELECT COUNT(*) FROM ironwifi_guests ${whereClause}
    `, params);
    
    res.json({
      success: true,
      guests: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    if (error.code === '42P01') {
      res.json({
        success: true,
        guests: [],
        total: 0,
        message: 'Guest table not created yet. Deploy and restart to create it.'
      });
    } else {
      logger.error('Error fetching guests:', error);
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * GET /api/ironwifi/test-api-fields
 * Test endpoint to see what fields the /guests API returns
 * Use this to verify if ap_mac, client_mac etc are available
 */
router.get('/test-api-fields', async (req, res) => {
  try {
    const result = await ironwifiClient.getGuests({ page: 1, pageSize: 3 });
    
    if (result.items && result.items.length > 0) {
      const sample = result.items[0];
      const allFields = Object.keys(sample).sort();
      
      // Check for MAC-related fields
      const macFields = ['client_mac', 'ap_mac', 'mac', 'mac_address', 'calling_station_id', 
                        'called_station_id', 'venue_id', 'captive_portal_name', 'public_ip', 
                        'mobilephone', 'phone'];
      
      const foundMacFields = {};
      macFields.forEach(field => {
        if (sample[field] !== undefined) {
          foundMacFields[field] = sample[field];
        }
      });
      
      res.json({
        success: true,
        totalGuests: result.total_items,
        sampleGuestFields: allFields,
        sampleGuestData: sample,
        macRelatedFields: foundMacFields,
        message: Object.keys(foundMacFields).length > 0 
          ? 'Found MAC-related fields in API response' 
          : 'No MAC fields found - these may only be in webhook/report data'
      });
    } else {
      res.json({
        success: true,
        message: 'No guests found in API',
        rawResponse: result
      });
    }
  } catch (error) {
    logger.error('Error testing API fields:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ironwifi/sync/guests
 * Sync guests from IronWifi API to local database
 * This caches guest data to reduce API calls
 */
router.post('/sync/guests', async (req, res) => {
  try {
    const { pages = 5 } = req.body;
    
    logger.info('Starting guest sync from IronWifi API');
    
    // Fetch guests from API
    const allGuests = await ironwifiClient.getAllGuests({ maxPages: parseInt(pages), pageSize: 100 });
    
    let inserted = 0;
    let updated = 0;
    
    for (const guest of allGuests) {
      try {
        // Use creation_date from IronWifi as first_seen_at
        const creationDate = guest.creationdate ? new Date(guest.creationdate) : null;
        const authDate = guest.authdate ? new Date(guest.authdate) : null;
        
        // Normalize MAC addresses (ap_mac links to router)
        const clientMac = guest.client_mac ? normalizeMac(guest.client_mac) : null;
        const apMac = guest.ap_mac ? normalizeMac(guest.ap_mac) : null;
        
        // Try to match ap_mac to a router
        let routerId = null;
        if (apMac) {
          const prefix = getMacPrefix(apMac);
          if (prefix) {
            const routerResult = await pool.query(
              'SELECT router_id FROM routers WHERE LEFT(LOWER(REPLACE(mac_address, \':\', \'\')), 10) = LEFT(REPLACE($1, \':\', \'\'), 10)',
              [apMac]
            );
            if (routerResult.rows.length > 0) {
              routerId = routerResult.rows[0].router_id;
            }
          }
        }
        
        const result = await pool.query(`
          INSERT INTO ironwifi_guests (
            ironwifi_id, username, email, fullname, firstname, lastname,
            phone, auth_date, creation_date, source, owner_id, 
            client_mac, ap_mac, router_id, captive_portal_name, venue_id, public_ip,
            first_seen_at, last_seen_at, auth_count
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, 1)
          ON CONFLICT (ironwifi_id) DO UPDATE SET
            username = EXCLUDED.username,
            email = EXCLUDED.email,
            fullname = EXCLUDED.fullname,
            phone = EXCLUDED.phone,
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
      } catch (err) {
        logger.error('Error storing guest:', { id: guest.id, error: err.message });
      }
    }
    
    res.json({
      success: true,
      fetched: allGuests.length,
      inserted,
      updated,
      apiUsage: ironwifiClient.getApiUsage()
    });
  } catch (error) {
    logger.error('Error syncing guests:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ironwifi/reset-guests
 * Clear all guest data and re-sync fresh from IronWifi
 * Use this to fix incorrect first_seen_at or auth_count values
 */
router.post('/reset-guests', async (req, res) => {
  try {
    const { pages = 10, confirm } = req.body;
    
    if (confirm !== 'yes') {
      return res.status(400).json({
        error: 'Must confirm reset by sending { confirm: "yes" }',
        message: 'This will delete all cached guest data and re-sync from IronWifi'
      });
    }
    
    logger.info('Resetting guest data - deleting all records');
    
    // Delete all existing guests
    const deleteResult = await pool.query('DELETE FROM ironwifi_guests');
    const deletedCount = deleteResult.rowCount;
    
    logger.info(`Deleted ${deletedCount} guest records, starting fresh sync`);
    
    // Fetch and insert fresh from API
    const allGuests = await ironwifiClient.getAllGuests({ maxPages: parseInt(pages), pageSize: 100 });
    
    let inserted = 0;
    for (const guest of allGuests) {
      try {
        const creationDate = guest.creationdate ? new Date(guest.creationdate) : null;
        const authDate = guest.authdate ? new Date(guest.authdate) : null;
        
        await pool.query(`
          INSERT INTO ironwifi_guests (
            ironwifi_id, username, email, fullname, firstname, lastname,
            phone, auth_date, creation_date, source, owner_id, first_seen_at, last_seen_at, auth_count
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, 1)
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
          creationDate  // Use creation_date as first_seen_at
        ]);
        inserted++;
      } catch (err) {
        logger.error('Error inserting guest:', { id: guest.id, error: err.message });
      }
    }
    
    res.json({
      success: true,
      deleted: deletedCount,
      inserted,
      apiUsage: ironwifiClient.getApiUsage()
    });
  } catch (error) {
    logger.error('Error resetting guests:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ironwifi/update-daily-stats
 * Manually trigger daily stats recalculation
 */
router.post('/update-daily-stats', async (req, res) => {
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
      AND session_start >= CURRENT_DATE - INTERVAL '30 days'
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
    
    res.json({ success: true, message: 'Daily stats updated' });
  } catch (error) {
    logger.error('Error updating daily stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// API EXPLORATION ENDPOINTS (for finding MAC address data)
// ============================================================================

/**
 * GET /api/ironwifi/explore
 * Explore all available IronWifi API endpoints
 * Helps find where MAC address data is located
 */
router.get('/explore', async (req, res) => {
  try {
    logger.info('Exploring IronWifi API endpoints...');
    const results = await ironwifiClient.exploreApi();
    res.json(results);
  } catch (error) {
    logger.error('Error exploring API:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/guest/:guestId/details
 * Get full details for a specific guest including attributes
 */
router.get('/guest/:guestId/details', async (req, res) => {
  try {
    const { guestId } = req.params;
    
    // Fetch guest details, attributes, and authentications in parallel
    const [guest, attributes, authentications] = await Promise.all([
      ironwifiClient.getGuestById(guestId).catch(e => ({ error: e.message })),
      ironwifiClient.getUserAttributes(guestId).catch(e => null),
      ironwifiClient.getUserAuthentications(guestId).catch(e => null)
    ]);
    
    // Look for MAC-related fields in all data
    const allFields = {};
    const macFields = {};
    
    const extractFields = (obj, prefix = '') => {
      if (!obj || typeof obj !== 'object') return;
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        allFields[fullKey] = typeof value;
        
        if (key.toLowerCase().includes('mac') || 
            key.toLowerCase().includes('station') ||
            key.toLowerCase().includes('ap_') ||
            key.toLowerCase().includes('client_')) {
          macFields[fullKey] = value;
        }
      }
    };
    
    extractFields(guest);
    extractFields(attributes, 'attributes');
    if (Array.isArray(authentications)) {
      extractFields(authentications[0], 'authentications[0]');
    }
    
    res.json({
      guestId,
      guest,
      attributes,
      authentications: authentications ? {
        count: Array.isArray(authentications) ? authentications.length : 1,
        sample: Array.isArray(authentications) ? authentications.slice(0, 3) : authentications
      } : null,
      analysis: {
        allFields: Object.keys(allFields).sort(),
        macRelatedFields: macFields,
        hasMacData: Object.keys(macFields).length > 0
      }
    });
  } catch (error) {
    logger.error('Error fetching guest details:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/registrations
 * Try to get guest registrations report with MAC data
 */
router.get('/registrations', async (req, res) => {
  try {
    const { earliest = '-7d', latest = 'now', page = 1 } = req.query;
    
    const result = await ironwifiClient.getGuestRegistrations({
      earliest,
      latest,
      page: parseInt(page)
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error fetching registrations:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/radius-data
 * Try to get RADIUS accounting data which contains MAC addresses
 * This data can be linked to guests via username
 */
router.get('/radius-data', async (req, res) => {
  try {
    const { earliest = '-24h', latest = 'now' } = req.query;
    
    logger.info('Fetching RADIUS accounting data...');
    
    // Try the accounting report endpoint
    const accountingData = await ironwifiClient.getAccountingReport({
      earliest,
      latest
    });
    
    // Analyze what we got
    let records = [];
    if (Array.isArray(accountingData)) {
      records = accountingData;
    } else if (accountingData?.items) {
      records = accountingData.items;
    } else if (accountingData?.data) {
      records = accountingData.data;
    } else if (accountingData?._embedded) {
      const key = Object.keys(accountingData._embedded)[0];
      records = accountingData._embedded[key] || [];
    }
    
    // Check what fields we have
    const sampleRecord = records[0];
    const fields = sampleRecord ? Object.keys(sampleRecord).sort() : [];
    
    // Look for MAC-related fields
    const macFields = {};
    if (sampleRecord) {
      Object.entries(sampleRecord).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('mac') || 
            lowerKey.includes('station') ||
            lowerKey.includes('called') ||
            lowerKey.includes('calling') ||
            lowerKey.includes('nas')) {
          macFields[key] = value;
        }
      });
    }
    
    res.json({
      success: true,
      source: 'RADIUS Accounting Report',
      recordCount: records.length,
      fields: fields,
      macRelatedFields: macFields,
      sample: records.slice(0, 5),
      hasMacData: Object.keys(macFields).length > 0,
      canLinkToGuests: records.length > 0 && sampleRecord?.username,
      rawResponse: typeof accountingData === 'object' ? 
        { type: typeof accountingData, keys: Object.keys(accountingData) } : 
        typeof accountingData
    });
  } catch (error) {
    logger.error('Error fetching RADIUS data:', error);
    res.status(500).json({ 
      error: error.message,
      suggestion: 'RADIUS data may only be available via webhook reports'
    });
  }
});

/**
 * GET /api/ironwifi/test-all-endpoints
 * Comprehensive test of all possible IronWifi API endpoints for RADIUS/session data
 * Note: This is a public endpoint for testing purposes - no auth required
 */
router.get('/test-all-endpoints', async (req, res) => {
  try {
    const axios = require('axios');
    const https = require('https');
    
    const apiKey = process.env.IRONWIFI_API_KEY;
    const apiUrl = process.env.IRONWIFI_API_URL || 'https://console.ironwifi.com/api';
    
    const client = axios.create({
      baseURL: apiUrl,
      timeout: 15000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    // List of endpoints to test
    const endpoints = [
      // Core resources
      { path: '/accounting', name: 'Accounting' },
      { path: '/radius', name: 'RADIUS' },
      { path: '/radius/accounting', name: 'RADIUS Accounting' },
      { path: '/sessions', name: 'Sessions' },
      { path: '/authentications', name: 'Authentications' },
      { path: '/authorizations', name: 'Authorizations' },
      { path: '/connections', name: 'Connections' },
      
      // Report endpoints
      { path: '/reports', name: 'Reports List' },
      { path: '/reports/accounting', name: 'Reports Accounting' },
      { path: '/reports/sessions', name: 'Reports Sessions' },
      { path: '/reports/authentications', name: 'Reports Authentications' },
      { path: '/reports/guest-registrations', name: 'Reports Guest Registrations' },
      
      // Numbered reports (IronWifi specific)
      { path: '/110', name: 'Report 110 (RADIUS Accounting Sync)' },
      { path: '/115', name: 'Report 115 (RADIUS Accounting Async)' },
      { path: '/120', name: 'Report 120' },
      
      // Other resources
      { path: '/logs', name: 'Logs' },
      { path: '/events', name: 'Events' },
      { path: '/activity', name: 'Activity' }
    ];
    
    const results = {};
    
    for (const endpoint of endpoints) {
      try {
        const response = await client.get(endpoint.path, {
          params: { page: 1, page_size: 3, earliest: '-24h', latest: 'now' }
        });
        
        let count = 0;
        let sample = null;
        let fields = [];
        
        const data = response.data;
        if (Array.isArray(data)) {
          count = data.length;
          sample = data[0];
        } else if (data?._embedded) {
          const key = Object.keys(data._embedded)[0];
          count = data.total_items || data._embedded[key]?.length || 0;
          sample = data._embedded[key]?.[0];
        } else if (data?.items) {
          count = data.total_items || data.items.length;
          sample = data.items[0];
        }
        
        if (sample) {
          fields = Object.keys(sample).sort();
        }
        
        // Check for MAC fields
        const hasMacFields = fields.some(f => 
          f.toLowerCase().includes('mac') ||
          f.toLowerCase().includes('station') ||
          f.toLowerCase().includes('called') ||
          f.toLowerCase().includes('calling')
        );
        
        results[endpoint.path] = {
          name: endpoint.name,
          status: 'available',
          count,
          fields,
          hasMacFields,
          sample: sample ? Object.fromEntries(
            Object.entries(sample).slice(0, 10)
          ) : null
        };
        
      } catch (error) {
        results[endpoint.path] = {
          name: endpoint.name,
          status: error.response?.status === 404 ? 'not_found' :
                  error.response?.status === 405 ? 'method_not_allowed' :
                  error.response?.status === 401 ? 'unauthorized' :
                  'error',
          statusCode: error.response?.status,
          error: error.message
        };
      }
    }
    
    // Find endpoints with MAC data
    const endpointsWithMac = Object.entries(results)
      .filter(([_, v]) => v.hasMacFields)
      .map(([path, v]) => ({ path, name: v.name, count: v.count }));
    
    res.json({
      success: true,
      apiUrl,
      totalEndpointsTested: endpoints.length,
      endpointsWithMacData: endpointsWithMac,
      results
    });
    
  } catch (error) {
    logger.error('Error testing endpoints:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/captive-portals
 * Get captive portals list
 */
router.get('/captive-portals', async (req, res) => {
  try {
    const portals = await ironwifiClient.getCaptivePortals();
    res.json({ success: true, portals });
  } catch (error) {
    logger.error('Error fetching captive portals:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/venues
 * Get venues list
 */
router.get('/venues', async (req, res) => {
  try {
    const venues = await ironwifiClient.getVenues();
    res.json({ success: true, venues });
  } catch (error) {
    logger.error('Error fetching venues:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/sample-guests-with-auth
 * Get sample guests and fetch their authentication history
 * This is the best way to find MAC data associated with guests
 */
router.get('/sample-guests-with-auth', async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    
    // Get first few guests
    const guestsResult = await ironwifiClient.getGuests({ page: 1, pageSize: parseInt(limit) });
    const guests = guestsResult.items;
    
    if (!guests.length) {
      return res.json({
        success: true,
        message: 'No guests found',
        guests: []
      });
    }
    
    // For each guest, try to get their authentication history
    const guestsWithAuth = await Promise.all(
      guests.map(async (guest) => {
        try {
          const auths = await ironwifiClient.getUserAuthentications(guest.id);
          return {
            guest: {
              id: guest.id,
              username: guest.username,
              email: guest.email,
              authdate: guest.authdate,
              creationdate: guest.creationdate,
              allFields: Object.keys(guest).sort()
            },
            authentications: auths ? {
              count: Array.isArray(auths) ? auths.length : 1,
              sample: Array.isArray(auths) ? auths.slice(0, 2) : auths,
              fields: Array.isArray(auths) && auths[0] ? Object.keys(auths[0]).sort() : []
            } : null
          };
        } catch (error) {
          return {
            guest: {
              id: guest.id,
              username: guest.username,
              email: guest.email
            },
            authentications: { error: error.message }
          };
        }
      })
    );
    
    // Analyze what fields contain MAC data
    const allAuthFields = new Set();
    const macFieldsFound = {};
    
    guestsWithAuth.forEach(({ authentications }) => {
      if (authentications?.sample && Array.isArray(authentications.sample)) {
        authentications.sample.forEach(auth => {
          if (auth && typeof auth === 'object') {
            Object.entries(auth).forEach(([key, value]) => {
              allAuthFields.add(key);
              if (key.toLowerCase().includes('mac') || 
                  key.toLowerCase().includes('station') ||
                  key.toLowerCase().includes('ap_') ||
                  key.toLowerCase().includes('client_')) {
                macFieldsFound[key] = value;
              }
            });
          }
        });
      }
    });
    
    res.json({
      success: true,
      totalGuests: guestsResult.total_items,
      sampledGuests: guests.length,
      guests: guestsWithAuth,
      analysis: {
        authenticationFields: [...allAuthFields].sort(),
        macRelatedFieldsFound: macFieldsFound,
        hasMacData: Object.keys(macFieldsFound).length > 0,
        recommendation: Object.keys(macFieldsFound).length > 0 
          ? 'MAC data found in authentication records - can sync from API!'
          : 'No MAC data in API responses - webhook may be required'
      }
    });
  } catch (error) {
    logger.error('Error sampling guests with auth:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/analyze-sources
 * Analyze unique source/captive portal IDs from guests
 * Looking for patterns that might contain MAC addresses
 */
router.get('/analyze-sources', async (req, res) => {
  try {
    const { pages = 10, pageSize = 100 } = req.query;
    
    logger.info('Analyzing captive portal sources...');
    
    const sources = new Map(); // source -> count
    const cpIds = new Set();    // unique captive portal IDs
    const venueIds = new Set(); // unique venue/session IDs
    let totalGuests = 0;
    
    for (let page = 1; page <= parseInt(pages); page++) {
      const result = await ironwifiClient.getGuests({ page, pageSize: parseInt(pageSize) });
      
      for (const guest of result.items) {
        totalGuests++;
        const source = guest.source || '';
        
        // Count sources
        sources.set(source, (sources.get(source) || 0) + 1);
        
        // Parse source field: typically "cp-{uuid}|{uuid}" format
        if (source.includes('|')) {
          const [cpPart, venuePart] = source.split('|');
          if (cpPart) cpIds.add(cpPart);
          if (venuePart) venueIds.add(venuePart);
        } else if (source.startsWith('cp-')) {
          cpIds.add(source);
        }
      }
      
      if (page >= result.page_count) break;
    }
    
    // Sort sources by count
    const sortedSources = [...sources.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    
    // Analyze captive portal IDs for patterns
    const cpIdAnalysis = [...cpIds].map(cpId => {
      // Check if it might contain a MAC address pattern
      // MAC addresses are 12 hex chars, UUIDs contain hex chars too
      const cleanId = cpId.replace('cp-', '').replace(/-/g, '');
      
      // Look for MAC-like patterns (groups of hex chars)
      const hexGroups = cleanId.match(/[0-9a-f]{12}/gi) || [];
      
      return {
        cpId,
        length: cpId.length,
        containsHex12: hexGroups.length > 0,
        potentialMacs: hexGroups.map(h => 
          h.match(/.{2}/g).join(':')
        )
      };
    });
    
    // Check for MAC patterns in venue IDs too
    const venueIdAnalysis = [...venueIds].slice(0, 10).map(venueId => {
      const cleanId = venueId.replace(/-/g, '');
      const hexGroups = cleanId.match(/[0-9a-f]{12}/gi) || [];
      
      return {
        venueId,
        length: venueId.length,
        containsHex12: hexGroups.length > 0,
        potentialMacs: hexGroups.map(h => 
          h.match(/.{2}/g).join(':')
        )
      };
    });
    
    res.json({
      success: true,
      totalGuestsScanned: totalGuests,
      uniqueCaptivePortals: cpIds.size,
      uniqueVenueIds: venueIds.size,
      topSources: sortedSources.map(([source, count]) => ({ source, count })),
      captivePortalAnalysis: cpIdAnalysis,
      venueIdAnalysis: venueIdAnalysis,
      summary: {
        possibleMacInCpIds: cpIdAnalysis.filter(a => a.containsHex12).length,
        possibleMacInVenueIds: venueIdAnalysis.filter(a => a.containsHex12).length
      }
    });
  } catch (error) {
    logger.error('Error analyzing sources:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/scan-for-macs
 * Scan multiple guests to find ones with MAC data populated
 * This helps determine if MAC data is available in the API at all
 */
router.get('/scan-for-macs', async (req, res) => {
  try {
    const { pages = 3, pageSize = 50 } = req.query;
    
    logger.info(`Scanning ${pages} pages of guests for MAC data...`);
    
    const guestsWithMac = [];
    const guestsWithoutMac = [];
    let totalScanned = 0;
    
    for (let page = 1; page <= parseInt(pages); page++) {
      const guestsResult = await ironwifiClient.getGuests({ page, pageSize: parseInt(pageSize) });
      
      for (const guest of guestsResult.items) {
        totalScanned++;
        
        try {
          // Fetch full guest details to get MAC fields
          const fullGuest = await ironwifiClient.getGuestById(guest.id);
          
          const hasMac = fullGuest.client_mac || fullGuest.ap_mac || fullGuest.mac_address;
          
          if (hasMac) {
            guestsWithMac.push({
              id: guest.id,
              username: guest.username,
              email: guest.email,
              authdate: guest.authdate,
              client_mac: fullGuest.client_mac,
              ap_mac: fullGuest.ap_mac,
              mac_address: fullGuest.mac_address,
              source: fullGuest.source
            });
            
            // Found some! Log it
            logger.info(`Found guest with MAC data: ${guest.username}`, {
              client_mac: fullGuest.client_mac,
              ap_mac: fullGuest.ap_mac
            });
          } else {
            guestsWithoutMac.push({
              id: guest.id,
              username: guest.username,
              source: guest.source?.substring(0, 50)
            });
          }
        } catch (err) {
          logger.debug(`Error fetching guest ${guest.id}: ${err.message}`);
        }
      }
      
      // If we found some with MAC, report early
      if (guestsWithMac.length >= 5) {
        break;
      }
    }
    
    res.json({
      success: true,
      totalScanned,
      guestsWithMac: guestsWithMac.length,
      guestsWithoutMac: guestsWithoutMac.length,
      samplesWithMac: guestsWithMac.slice(0, 10),
      analysis: {
        macDataAvailable: guestsWithMac.length > 0,
        percentageWithMac: totalScanned > 0 ? ((guestsWithMac.length / totalScanned) * 100).toFixed(1) : 0,
        recommendation: guestsWithMac.length > 0
          ? `MAC data found! ${guestsWithMac.length}/${totalScanned} guests have MAC addresses. Can sync from API.`
          : 'No MAC data found in any guests. The webhook/RADIUS accounting is required for MAC data.'
      }
    });
  } catch (error) {
    logger.error('Error scanning for MACs:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;