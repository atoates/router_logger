/**
 * Guest WiFi Routes
 *
 * Provides API endpoints for querying guest session data.
 */

const express = require('express');
const router = express.Router();
const { pool, logger } = require('../config/database');

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
        COUNT(DISTINCT s.username) as unique_guests
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
        event_type
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
        COUNT(*) FILTER (WHERE session_end IS NULL) as active_sessions
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

module.exports = router;

