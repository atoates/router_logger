/**
 * IronWifi Webhook Receiver
 * Receives scheduled reports from IronWifi via webhook
 * Processes device status, session data, and accounting information
 */

const express = require('express');
const router = express.Router();
const { pool, logger } = require('../config/database');

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
    
    logger.info('IronWifi webhook received', {
      headers: req.headers,
      bodyType: typeof webhookData,
      contentType: req.headers['content-type']
    });

    // IronWifi might send different report types
    // Log the full payload for debugging
    logger.info('IronWifi webhook payload:', JSON.stringify(webhookData, null, 2));

    // Acknowledge receipt immediately
    res.status(200).json({
      success: true,
      message: 'Webhook received',
      timestamp: new Date().toISOString()
    });

    // Process webhook data asynchronously
    processWebhookData(webhookData).catch(error => {
      logger.error('Error processing IronWifi webhook:', error);
    });

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
 * Store session data received from webhook
 */
async function storeSessionFromWebhook(sessionData) {
  try {
    // Normalize MAC address
    const normalizeMac = (mac) => {
      if (!mac) return null;
      return mac.toLowerCase().replace(/[:-]/g, '').match(/.{1,2}/g)?.join(':') || null;
    };

    const apMac = normalizeMac(sessionData.ap_mac);
    const userMac = normalizeMac(sessionData.user_mac);

    if (!apMac && !sessionData.session_id) {
      logger.debug('Skipping session - no identifiable MAC or session ID');
      return;
    }

    // Try to match to a router by MAC address
    let routerId = null;
    if (apMac) {
      const routerResult = await pool.query(
        'SELECT router_id FROM routers WHERE mac_address = $1',
        [apMac]
      );
      if (routerResult.rows.length > 0) {
        routerId = routerResult.rows[0].router_id;
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

module.exports = router;
