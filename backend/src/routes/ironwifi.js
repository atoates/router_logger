/**
 * IronWifi API Routes
 * Endpoints for accessing user connection data from IronWifi captive portal
 */

const express = require('express');
const router = express.Router();
const { getIronWifiClient, isIronWifiEnabled } = require('../services/ironwifiClient');
const { syncIronWifiSessions, updateDailyStats, isSyncRunning } = require('../services/ironwifiSync');
const { pool, logger } = require('../config/database');

// Check if IronWifi is enabled
router.use((req, res, next) => {
  if (!isIronWifiEnabled()) {
    return res.status(503).json({
      error: 'IronWifi integration not configured',
      message: 'Set IRONWIFI_API_KEY and IRONWIFI_NETWORK_ID environment variables'
    });
  }
  next();
});

/**
 * GET /api/ironwifi/status
 * Check IronWifi API connectivity and sync status
 */
router.get('/status', async (req, res) => {
  try {
    const { IronWifiClient } = require('../services/ironwifiClient');
    const ironwifi = getIronWifiClient();
    const connectionTest = await ironwifi.testConnection();
    
    // Get API usage statistics
    const apiUsage = IronWifiClient.getApiUsage();
    
    // Get last sync time
    const lastSyncResult = await pool.query(
      `SELECT value FROM settings WHERE key = 'ironwifi_last_sync'`
    );
    const lastSync = lastSyncResult.rows[0]?.value || null;

    // Get total active sessions
    const activeSessionsResult = await pool.query(
      `SELECT COUNT(*) as count FROM ironwifi_sessions WHERE is_active = true`
    );
    const activeSessions = parseInt(activeSessionsResult.rows[0]?.count || 0);

    res.json({
      enabled: isIronWifiEnabled(),
      apiConnected: connectionTest.success,
      syncRunning: isSyncRunning(),
      lastSync: lastSync ? new Date(lastSync) : null,
      activeSessions,
      apiUsage,
      ...connectionTest
    });
  } catch (error) {
    logger.error('Error checking IronWifi status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ironwifi/sync
 * Manually trigger IronWifi session sync
 */
router.post('/sync', async (req, res) => {
  try {
    if (isSyncRunning()) {
      return res.status(409).json({ error: 'Sync already in progress' });
    }

    logger.info('Manual IronWifi sync triggered');
    const result = await syncIronWifiSessions();
    res.json(result);
  } catch (error) {
    logger.error('Manual IronWifi sync failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/router/:routerId/active-users
 * Get currently active users on a specific router
 */
router.get('/router/:routerId/active-users', async (req, res) => {
  try {
    const { routerId } = req.params;

    const result = await pool.query(
      `SELECT 
        session_id,
        username,
        user_device_mac,
        user_device_name,
        session_start,
        last_seen,
        duration_seconds,
        bytes_total,
        ip_address,
        ssid
       FROM ironwifi_sessions
       WHERE router_id = $1 AND is_active = true
       ORDER BY session_start DESC`,
      [routerId]
    );

    res.json({
      routerId,
      activeUsers: result.rows.length,
      sessions: result.rows
    });
  } catch (error) {
    logger.error(`Error getting active users for router ${req.params.routerId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/router/:routerId/sessions
 * Get session history for a router
 */
router.get('/router/:routerId/sessions', async (req, res) => {
  try {
    const { routerId } = req.params;
    const { start_date, end_date, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT 
        session_id,
        username,
        user_device_mac,
        user_device_name,
        session_start,
        session_end,
        last_seen,
        is_active,
        duration_seconds,
        bytes_uploaded,
        bytes_downloaded,
        bytes_total,
        ip_address,
        ssid,
        auth_method
       FROM ironwifi_sessions
       WHERE router_id = $1
    `;
    const params = [routerId];
    let paramIndex = 2;

    if (start_date) {
      query += ` AND session_start >= $${paramIndex}`;
      params.push(new Date(start_date));
      paramIndex++;
    }

    if (end_date) {
      query += ` AND session_start <= $${paramIndex}`;
      params.push(new Date(end_date));
      paramIndex++;
    }

    query += ` ORDER BY session_start DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM ironwifi_sessions WHERE router_id = $1`,
      [routerId]
    );

    res.json({
      routerId,
      sessions: result.rows,
      total: parseInt(countResult.rows[0]?.total || 0),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    logger.error(`Error getting sessions for router ${req.params.routerId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/router/:routerId/stats
 * Get user connection statistics for a router
 */
router.get('/router/:routerId/stats', async (req, res) => {
  try {
    const { routerId } = req.params;
    const { period = '7' } = req.query; // days

    const daysAgo = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    // Get daily stats
    const dailyStatsResult = await pool.query(
      `SELECT 
        date,
        total_sessions,
        unique_users,
        unique_devices,
        total_bytes_transferred,
        avg_session_duration_seconds,
        peak_concurrent_users
       FROM router_user_stats
       WHERE router_id = $1 AND date >= $2
       ORDER BY date DESC`,
      [routerId, startDate.toISOString().split('T')[0]]
    );

    // Get current active users
    const activeUsersResult = await pool.query(
      `SELECT active_sessions, unique_active_devices 
       FROM router_active_users 
       WHERE router_id = $1`,
      [routerId]
    );

    // Get totals for the period
    const totalsResult = await pool.query(
      `SELECT 
        COUNT(DISTINCT username) as total_unique_users,
        COUNT(DISTINCT user_device_mac) as total_unique_devices,
        COUNT(*) as total_sessions,
        SUM(bytes_total) as total_bytes,
        AVG(duration_seconds)::INTEGER as avg_duration
       FROM ironwifi_sessions
       WHERE router_id = $1 AND session_start >= $2`,
      [routerId, startDate]
    );

    res.json({
      routerId,
      period: `${daysAgo} days`,
      currentActive: {
        sessions: parseInt(activeUsersResult.rows[0]?.active_sessions || 0),
        devices: parseInt(activeUsersResult.rows[0]?.unique_active_devices || 0)
      },
      totals: totalsResult.rows[0] || {},
      daily: dailyStatsResult.rows
    });
  } catch (error) {
    logger.error(`Error getting stats for router ${req.params.routerId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/network/active-users
 * Get all active users across the entire network
 */
router.get('/network/active-users', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        router_id,
        router_name,
        active_sessions,
        unique_active_devices,
        active_usernames,
        total_bytes,
        last_activity
       FROM router_active_users
       WHERE active_sessions > 0
       ORDER BY active_sessions DESC`
    );

    const totalSessions = result.rows.reduce((sum, r) => sum + parseInt(r.active_sessions || 0), 0);
    const totalDevices = result.rows.reduce((sum, r) => sum + parseInt(r.unique_active_devices || 0), 0);

    res.json({
      totalActiveSessions: totalSessions,
      totalActiveDevices: totalDevices,
      routersWithUsers: result.rows.length,
      routers: result.rows
    });
  } catch (error) {
    logger.error('Error getting network active users:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/network/stats
 * Get network-wide statistics
 */
router.get('/network/stats', async (req, res) => {
  try {
    const { period = '7' } = req.query;
    const daysAgo = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    // Get totals across all routers
    const totalsResult = await pool.query(
      `SELECT 
        COUNT(DISTINCT router_id) as routers_with_users,
        COUNT(DISTINCT username) as total_unique_users,
        COUNT(DISTINCT user_device_mac) as total_unique_devices,
        COUNT(*) as total_sessions,
        SUM(bytes_total) as total_bytes,
        AVG(duration_seconds)::INTEGER as avg_session_duration
       FROM ironwifi_sessions
       WHERE session_start >= $1`,
      [startDate]
    );

    // Get top routers by user count
    const topRoutersResult = await pool.query(
      `SELECT 
        r.router_id,
        r.name as router_name,
        COUNT(DISTINCT s.username) as unique_users,
        COUNT(*) as total_sessions,
        SUM(s.bytes_total) as total_bytes
       FROM ironwifi_sessions s
       JOIN routers r ON s.router_id = r.router_id
       WHERE s.session_start >= $1
       GROUP BY r.router_id, r.name
       ORDER BY unique_users DESC
       LIMIT 10`,
      [startDate]
    );

    res.json({
      period: `${daysAgo} days`,
      totals: totalsResult.rows[0] || {},
      topRouters: topRoutersResult.rows
    });
  } catch (error) {
    logger.error('Error getting network stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ironwifi/update-daily-stats
 * Manually trigger daily stats update
 */
router.post('/update-daily-stats', async (req, res) => {
  try {
    await updateDailyStats();
    res.json({ success: true, message: 'Daily stats updated' });
  } catch (error) {
    logger.error('Error updating daily stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ironwifi/routers-with-mac
 * Get list of routers that have MAC addresses configured
 */
router.get('/routers-with-mac', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT router_id, name, mac_address, ironwifi_ap_id, ironwifi_ap_name
       FROM routers
       WHERE mac_address IS NOT NULL
       ORDER BY name`
    );

    res.json({
      count: result.rows.length,
      routers: result.rows
    });
  } catch (error) {
    logger.error('Error getting routers with MAC:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
