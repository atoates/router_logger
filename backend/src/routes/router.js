/**
 * Router Routes - REFACTORED VERSION
 * 
 * This demonstrates the "thin routes" pattern where routes only:
 * 1. Define endpoints
 * 2. Apply middleware
 * 3. Delegate to controllers
 * 
 * Compare this to the original router.js (1,197 lines) - this is ~200 lines
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin, requireRouterAccess } = require('./session');

// Some endpoints are router-scoped (guests can access assigned routers), others are global (admin-only).
function requireAdminOrRouterAccess(req, res, next) {
  const routerId =
    req.params.routerId ||
    req.body?.router_id ||
    req.query?.router_id ||
    req.query?.routerId;

  if (routerId) {
    return requireRouterAccess(req, res, next);
  }
  return requireAdmin(req, res, next);
}

// Controllers (NEW - proper separation of concerns)
const adminController = require('../controllers/adminController');
const routerController = require('../controllers/routerController');

// Import services for endpoints that haven't been fully refactored yet
const { processRouterTelemetry } = require('../services/telemetryProcessor');
const { 
  linkRouterToLocation, 
  unlinkRouterFromLocation, 
  assignRouterToUsers, 
  removeRouterAssignees, 
  getCurrentLocation 
} = require('../services/propertyService');
const clickupClient = require('../services/clickupClient');
const { 
  getLogs,
  getUsageStats,
  getUptimeData,
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
} = require('../models/router');
const { logger, pool } = require('../config/database');
const cacheManager = require('../services/cacheManager');

// ============================================================================
// ADMIN ENDPOINTS - Fully refactored to controller pattern
// ============================================================================

/**
 * POST /admin/sync-dates
 * BEFORE: 75 lines of mixed concerns in route handler
 * AFTER: 1 line - delegate to controller
 */
router.post('/admin/sync-dates', requireAdmin, adminController.syncDates);

/**
 * POST /admin/clear-cache
 * BEFORE: 20 lines of cache manipulation in route
 * AFTER: 1 line - delegate to controller
 */
router.post('/admin/clear-cache', requireAdmin, adminController.clearCache);

/**
 * GET /admin/deduplication-report
 * BEFORE: 70 lines of logic in route
 * AFTER: 1 line - delegate to controller
 */
router.get('/admin/deduplication-report', requireAdmin, adminController.getDeduplicationReport);

// ============================================================================
// CORE ROUTER ENDPOINTS - Refactored
// ============================================================================

/**
 * POST /log - Router telemetry endpoint
 * BEFORE: Mixed validation + processing in route
 * AFTER: Controller handles it
 */
router.post('/log', routerController.logTelemetry);

/**
 * GET /routers - Get all routers with deduplication
 * BEFORE: 60 lines of caching, ETag, deduplication logic in route
 * AFTER: Controller handles it
 */
router.get('/routers', requireAuth, routerController.getRouters);

/**
 * GET /routers/geo - Get geolocation from IP
 */
router.get('/routers/geo', requireAuth, routerController.getRouterGeo);

// ============================================================================
// STATS ENDPOINTS - Still need refactoring (TODO: statsController.js)
// ============================================================================

router.get('/logs', requireAdminOrRouterAccess, async (req, res) => {
  try {
    const filters = {
      router_id: req.query.router_id,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      limit: req.query.limit ? parseInt(req.query.limit) : 1000
    };
    
    const logs = await getLogs(filters);
    res.json(logs);
  } catch (error) {
    logger.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

router.get('/stats/usage', requireRouterAccess, async (req, res) => {
  try {
    const { router_id, start_date, end_date } = req.query;
    
    if (!router_id || !start_date || !end_date) {
      return res.status(400).json({ 
        error: 'router_id, start_date, and end_date are required' 
      });
    }
    
    const stats = await getUsageStats(router_id, start_date, end_date);
    res.json({ data: [stats] });
  } catch (error) {
    logger.error('Error fetching usage stats:', error);
    res.status(500).json({ error: 'Failed to fetch usage statistics' });
  }
});

router.get('/stats/uptime', requireRouterAccess, async (req, res) => {
  try {
    const { router_id, start_date, end_date } = req.query;
    
    if (!router_id || !start_date || !end_date) {
      return res.status(400).json({ 
        error: 'router_id, start_date, and end_date are required' 
      });
    }
    
    const uptime = await getUptimeData(router_id, start_date, end_date);
    res.json(uptime);
  } catch (error) {
    logger.error('Error fetching uptime data:', error);
    res.status(500).json({ error: 'Failed to fetch uptime data' });
  }
});

router.get('/stats/storage', requireAdmin, async (req, res) => {
  try {
    const sampleSize = req.query.sample_size ? Number(req.query.sample_size) : 1000;
    const stats = await getStorageStats(sampleSize);
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching storage stats:', error);
    res.status(500).json({ error: 'Failed to fetch storage stats' });
  }
});

router.get('/stats/top-routers', requireAdmin, async (req, res) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 7;
    const limit = req.query.limit ? Number(req.query.limit) : 5;
    const top = await getTopRoutersByUsage(days, limit);
    res.json(top);
  } catch (error) {
    logger.error('Error fetching top routers by usage:', error);
    res.status(500).json({ error: 'Failed to fetch top routers' });
  }
});

router.get('/stats/network-usage', requireAdmin, async (req, res) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 7;
    const data = await getNetworkUsageByDay(days);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching network usage by day:', error);
    res.status(500).json({ error: 'Failed to fetch network usage' });
  }
});

router.get('/stats/operators', requireAdmin, async (req, res) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 7;
    const data = await getOperatorDistribution(days);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching operator distribution:', error);
    res.status(500).json({ error: 'Failed to fetch operator distribution' });
  }
});

router.get('/stats/operators-rolling', requireAdmin, async (req, res) => {
  try {
    const hours = req.query.hours ? Number(req.query.hours) : 24;
    const data = await getOperatorDistributionRolling(hours);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching rolling operator distribution:', error);
    res.status(500).json({ error: 'Failed to fetch rolling operator distribution' });
  }
});

router.get('/stats/network-usage-rolling', requireAdmin, async (req, res) => {
  try {
    const hours = req.query.hours ? Number(req.query.hours) : 24;
    const bucket = (req.query.bucket || 'hour').toString();
    const data = await getNetworkUsageRolling(hours, bucket);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching rolling network usage:', error);
    res.status(500).json({ error: 'Failed to fetch rolling network usage' });
  }
});

router.get('/stats/top-routers-rolling', requireAdmin, async (req, res) => {
  try {
    const hours = req.query.hours ? Number(req.query.hours) : 24;
    const limit = req.query.limit ? Number(req.query.limit) : 5;
    const data = await getTopRoutersByUsageRolling(hours, limit);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching rolling top routers:', error);
    res.status(500).json({ error: 'Failed to fetch rolling top routers' });
  }
});

router.get('/stats/db-size', requireAdmin, async (req, res) => {
  try {
    const data = await getDatabaseSizeStats();
    res.json(data);
  } catch (error) {
    logger.error('Error fetching database size stats:', error);
    res.status(500).json({ error: 'Failed to fetch database size stats' });
  }
});

router.get('/stats/inspections', requireAdmin, async (req, res) => {
  try {
    const data = await getInspectionStatus();
    res.json(data);
  } catch (error) {
    logger.error('Error fetching inspection status:', error);
    res.status(500).json({ error: 'Failed to fetch inspection status' });
  }
});

// ============================================================================
// PROPERTY/LOCATION ENDPOINTS - Using service layer (good pattern)
// ============================================================================

router.get('/routers/:routerId/current-location', requireRouterAccess, async (req, res) => {
  try {
    const { routerId } = req.params;
    const location = await getCurrentLocation(routerId);
    res.json({ location: location || null });
  } catch (error) {
    logger.error('Error getting current location:', error);
    res.status(500).json({ error: error.message || 'Failed to get current location' });
  }
});

// Get router's geolocation history (from cell tower lookups)
router.get('/routers/:routerId/geo-location', requireRouterAccess, async (req, res) => {
  try {
    const { routerId } = req.params;
    const { limit = 30 } = req.query;
    
    // Get location history (only entries with valid coordinates)
    const result = await pool.query(`
      SELECT 
        latitude,
        longitude,
        location_accuracy as accuracy,
        timestamp,
        operator,
        network_type,
        cell_id,
        rsrp,
        rssi
      FROM router_logs
      WHERE router_id = $1
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT $2
    `, [routerId, parseInt(limit, 10)]);
    
    // Get the most recent location as "current"
    const current = result.rows.length > 0 ? result.rows[0] : null;
    
    res.json({
      routerId,
      current,
      history: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Error fetching geo location:', error);
    res.status(500).json({ error: 'Failed to fetch geo location' });
  }
});

// Get router's location history with start/end times (from router_locations table)
// Falls back to router_logs if router_locations is empty
router.get('/routers/:routerId/location-history', requireRouterAccess, async (req, res) => {
  try {
    const { routerId } = req.params;
    const { start_date, end_date, limit = 50 } = req.query;
    
    // First try the router_locations table
    let query = `
      SELECT 
        id,
        latitude,
        longitude,
        accuracy,
        cell_id,
        tac,
        lac,
        mcc,
        mnc,
        operator,
        network_type,
        started_at,
        ended_at,
        sample_count,
        CASE WHEN ended_at IS NULL THEN true ELSE false END as is_current
      FROM router_locations
      WHERE router_id = $1
    `;
    
    const params = [routerId];
    let paramIndex = 2;
    
    // Filter by date range if provided
    if (start_date) {
      query += ` AND (ended_at >= $${paramIndex} OR ended_at IS NULL)`;
      params.push(start_date);
      paramIndex++;
    }
    
    if (end_date) {
      query += ` AND started_at <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    
    query += ` ORDER BY started_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit, 10));
    
    let result = await pool.query(query, params);
    
    // If router_locations is empty, fall back to router_logs
    if (result.rows.length === 0) {
      const fallbackResult = await pool.query(`
        SELECT 
          id,
          latitude,
          longitude,
          location_accuracy as accuracy,
          cell_id,
          tac,
          lac,
          mcc,
          mnc,
          operator,
          network_type,
          timestamp as started_at,
          NULL as ended_at,
          1 as sample_count,
          true as is_current
        FROM router_logs
        WHERE router_id = $1
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT $2
      `, [routerId, parseInt(limit, 10)]);
      
      if (fallbackResult.rows.length > 0) {
        // Mark only the first one as current
        const locations = fallbackResult.rows.map((loc, idx) => ({
          ...loc,
          is_current: idx === 0,
          duration_ms: 0,
          duration_readable: 'N/A (legacy data)'
        }));
        
        return res.json({
          routerId,
          current: locations[0] || null,
          locations,
          count: locations.length,
          source: 'router_logs' // Indicate fallback source
        });
      }
    }
    
    // Calculate duration for each location
    const locations = result.rows.map(loc => {
      const startTime = new Date(loc.started_at).getTime();
      const endTime = loc.ended_at ? new Date(loc.ended_at).getTime() : Date.now();
      const durationMs = endTime - startTime;
      
      return {
        ...loc,
        duration_ms: durationMs,
        duration_readable: formatDuration(durationMs)
      };
    });
    
    // Get the current active location
    const current = locations.find(loc => loc.is_current) || null;
    
    res.json({
      routerId,
      current,
      locations,
      count: locations.length,
      source: 'router_locations'
    });
  } catch (error) {
    logger.error('Error fetching location history:', error);
    res.status(500).json({ error: 'Failed to fetch location history' });
  }
});

// Helper function to format duration
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

router.get('/routers/with-locations', requireAdmin, async (req, res) => {
  try {
    // Check cache
    const cached = cacheManager.getRoutersWithLocationsCache();
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }

    // Fetch fresh data
    const result = await pool.query(`
      SELECT 
        r.router_id, r.name, r.last_seen,
        l.status as current_state,
        r.clickup_task_id, r.clickup_task_url,
        r.clickup_location_task_id, r.clickup_location_task_name,
        r.location_linked_at, r.date_installed
      FROM routers r
      LEFT JOIN LATERAL (
        SELECT status FROM router_logs
        WHERE router_id = r.router_id
        ORDER BY timestamp DESC LIMIT 1
      ) l ON true
      WHERE r.clickup_location_task_id IS NOT NULL
      ORDER BY r.name ASC
    `);
    
    cacheManager.setRoutersWithLocationsCache(result.rows);
    res.set('X-Cache', 'MISS');
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching routers with locations:', error);
    res.status(500).json({ error: 'Failed to fetch routers with locations' });
  }
});

router.get('/routers/by-assignees', requireAdmin, async (req, res) => {
  try {
    // Check cache
    const cached = cacheManager.getAssigneesCache();
    if (cached) {
      return res.json(cached);
    }

    // Fetch and group (this logic should move to service layer)
    const routersResult = await pool.query(`
      SELECT 
        r.router_id, r.name, r.last_seen,
        l.status as current_state,
        r.clickup_task_id, r.clickup_task_url,
        r.clickup_location_task_id, r.clickup_location_task_name,
        r.location_linked_at, r.clickup_assignees, r.clickup_task_status
      FROM routers r
      LEFT JOIN LATERAL (
        SELECT status FROM router_logs
        WHERE router_id = r.router_id
        ORDER BY timestamp DESC LIMIT 1
      ) l ON true
      WHERE r.clickup_task_id IS NOT NULL
      ORDER BY r.name ASC
    `);

    const routersByAssignee = {};
    const routers = routersResult.rows;
    
    for (const router of routers) {
      // Skip decommissioned and being returned routers
      const status = router.clickup_task_status?.toLowerCase();
      if (status === 'decommissioned' || status === 'being returned') continue;

      try {
        let assignees = null;
        if (router.clickup_assignees) {
          assignees = typeof router.clickup_assignees === 'string'
            ? JSON.parse(router.clickup_assignees)
            : router.clickup_assignees;
        }
        
        if (assignees && Array.isArray(assignees) && assignees.length > 0) {
          for (const assignee of assignees) {
            const assigneeName = assignee.username || assignee.email || 'Unknown';
            if (!routersByAssignee[assigneeName]) {
              routersByAssignee[assigneeName] = [];
            }
            const alreadyAdded = routersByAssignee[assigneeName]
              .some(r => r.router_id === router.router_id);
            if (!alreadyAdded) {
              routersByAssignee[assigneeName].push(router);
            }
          }
        } else {
          if (!routersByAssignee['Unassigned']) {
            routersByAssignee['Unassigned'] = [];
          }
          routersByAssignee['Unassigned'].push(router);
        }
      } catch (parseError) {
        logger.warn(`Failed to parse assignees for ${router.router_id}:`, parseError.message);
        if (!routersByAssignee['Unassigned']) {
          routersByAssignee['Unassigned'] = [];
        }
        routersByAssignee['Unassigned'].push(router);
      }
    }
    
    cacheManager.setAssigneesCache(routersByAssignee);
    res.json(routersByAssignee);
  } catch (error) {
    logger.error('Error fetching routers by assignees:', error);
    res.status(500).json({ error: 'Failed to fetch routers by assignees' });
  }
});

router.post('/routers/:routerId/link-location', requireAdmin, async (req, res) => {
  try {
    const { routerId } = req.params;
    const { location_task_id, location_task_name, notes } = req.body;
    
    if (!location_task_id) {
      return res.status(400).json({ error: 'location_task_id is required' });
    }
    
    const linkageRecord = await linkRouterToLocation({
      routerId,
      locationTaskId: location_task_id,
      locationTaskName: location_task_name || 'Unknown Location',
      linkedBy: null,
      notes
    });
    
    res.json({ success: true, router: linkageRecord });
  } catch (error) {
    logger.error('Error linking router to location:', error);
    res.status(500).json({ error: error.message || 'Failed to link router to location' });
  }
});

router.post('/routers/:routerId/unlink-location', requireAdmin, async (req, res) => {
  try {
    const { routerId } = req.params;
    const { reassign_to_user_id, reassign_to_username, notes } = req.body;
    
    const unlinkageRecord = await unlinkRouterFromLocation({
      routerId,
      unlinkedBy: null,
      reassignToUserId: reassign_to_user_id,
      reassignToUsername: reassign_to_username,
      notes
    });
    
    res.json({ success: true, router: unlinkageRecord });
  } catch (error) {
    logger.error('Error unlinking router from location:', error);
    res.status(500).json({ error: error.message || 'Failed to unlink router from location' });
  }
});

router.post('/routers/:routerId/assign', requireAdmin, async (req, res) => {
  try {
    const { routerId } = req.params;
    const { assignee_user_ids, assignee_usernames } = req.body;
    
    if (!assignee_user_ids || !Array.isArray(assignee_user_ids) || assignee_user_ids.length === 0) {
      return res.status(400).json({ 
        error: 'assignee_user_ids array is required' 
      });
    }
    
    const result = await assignRouterToUsers({
      routerId,
      assigneeUserIds: assignee_user_ids,
      assigneeUsernames: assignee_usernames || []
    });
    
    // Update status to 'ready'
    try {
      await pool.query(
        `UPDATE routers SET clickup_task_status = 'ready' WHERE router_id = $1`,
        [routerId]
      );
      
      const routerResult = await pool.query(
        'SELECT clickup_task_id FROM routers WHERE router_id = $1',
        [routerId]
      );
      
      if (routerResult.rows[0]?.clickup_task_id) {
        await clickupClient.updateTask(
          routerResult.rows[0].clickup_task_id,
          { status: 'ready' },
          'default'
        );
      }
    } catch (statusError) {
      logger.warn(`Failed to update status for ${routerId}:`, statusError.message);
    }
    
    res.json(result);
  } catch (error) {
    logger.error('Error assigning router:', error);
    res.status(500).json({ error: error.message || 'Failed to assign router' });
  }
});

router.post('/routers/:routerId/remove-assignees', requireAdmin, async (req, res) => {
  try {
    const { routerId } = req.params;
    const result = await removeRouterAssignees(routerId);
    res.json(result);
  } catch (error) {
    logger.error('Error removing router assignees:', error);
    res.status(500).json({ error: error.message || 'Failed to remove assignees' });
  }
});

// ============================================================================
// STATUS ENDPOINTS - Could be moved to statusController.js
// ============================================================================

// GET decommissioned routers
router.get('/routers/decommissioned', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        r.id, r.router_id, r.device_serial, r.name, r.location, r.site_id,
        r.created_at, r.last_seen, r.rms_created_at, r.notes,
        r.clickup_task_id, r.clickup_task_url, r.clickup_list_id,
        r.clickup_location_task_id, r.clickup_location_task_name,
        r.location_linked_at, r.date_installed, r.last_clickup_sync_hash,
        r.clickup_assignees, r.clickup_task_status, r.mac_address,
        COALESCE(
          (SELECT imei FROM router_logs WHERE router_id = r.router_id AND imei IS NOT NULL ORDER BY timestamp DESC LIMIT 1),
          r.imei
        ) as imei,
        COALESCE(
          (SELECT firmware_version FROM router_logs WHERE router_id = r.router_id AND firmware_version IS NOT NULL ORDER BY timestamp DESC LIMIT 1),
          r.firmware_version
        ) as firmware_version,
        (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as current_status,
        (SELECT timestamp FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as last_log_time
       FROM routers r
       WHERE LOWER(r.clickup_task_status) = 'decommissioned'
       ORDER BY r.last_seen DESC NULLS LAST, r.created_at DESC`
    );

    logger.info(`Retrieved ${result.rows.length} decommissioned routers`);
    res.json({ success: true, routers: result.rows });

  } catch (error) {
    logger.error('Error fetching decommissioned routers:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch decommissioned routers' });
  }
});

// GET routers being returned
router.get('/routers/being-returned', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        r.id, r.router_id, r.device_serial, r.name, r.location, r.site_id,
        r.created_at, r.last_seen, r.rms_created_at, r.notes,
        r.clickup_task_id, r.clickup_task_url, r.clickup_list_id,
        r.clickup_location_task_id, r.clickup_location_task_name,
        r.location_linked_at, r.date_installed, r.last_clickup_sync_hash,
        r.clickup_assignees, r.clickup_task_status, r.mac_address,
        COALESCE(
          (SELECT imei FROM router_logs WHERE router_id = r.router_id AND imei IS NOT NULL ORDER BY timestamp DESC LIMIT 1),
          r.imei
        ) as imei,
        COALESCE(
          (SELECT firmware_version FROM router_logs WHERE router_id = r.router_id AND firmware_version IS NOT NULL ORDER BY timestamp DESC LIMIT 1),
          r.firmware_version
        ) as firmware_version,
        (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as current_status,
        (SELECT timestamp FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as last_log_time
       FROM routers r
       WHERE LOWER(r.clickup_task_status) = 'being returned'
       ORDER BY r.last_seen DESC NULLS LAST, r.created_at DESC`
    );

    logger.info(`Retrieved ${result.rows.length} routers being returned`);
    res.json({ success: true, routers: result.rows });
  } catch (error) {
    logger.error('Error fetching routers being returned:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch routers being returned' });
  }
});

// GET routers that need attention
router.get('/routers/needs-attention', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        r.*,
        (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as current_status,
        (SELECT timestamp FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as last_log_time,
        CASE 
          WHEN r.clickup_location_task_id IS NOT NULL 
            AND (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) NOT IN ('online', 'Online', '1')
            AND (SELECT timestamp FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) < NOW() - INTERVAL '1 hour'
          THEN 'offline_at_location'
          WHEN r.clickup_location_task_id IS NULL AND r.clickup_assignees IS NULL
          THEN 'no_location_or_assignee'
          WHEN LOWER(r.clickup_task_status) = 'needs attention'
          THEN 'manually_flagged'
          ELSE NULL
        END as attention_reason
       FROM routers r
       WHERE 
         LOWER(r.clickup_task_status) != 'decommissioned'
         AND LOWER(r.clickup_task_status) != 'being returned'
         AND (
           -- Router has location but is offline for more than 1 hour
           (r.clickup_location_task_id IS NOT NULL 
            AND (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) NOT IN ('online', 'Online', '1')
            AND (SELECT timestamp FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) < NOW() - INTERVAL '1 hour')
           -- Router has no location or assignee
           OR (r.clickup_location_task_id IS NULL AND r.clickup_assignees IS NULL)
           -- Manually marked as needs attention
           OR LOWER(r.clickup_task_status) = 'needs attention'
         )
       ORDER BY 
         CASE 
           WHEN LOWER(r.clickup_task_status) = 'needs attention' THEN 1
           WHEN r.clickup_location_task_id IS NOT NULL THEN 2
           ELSE 3
         END,
         r.last_seen DESC NULLS LAST`
    );

    logger.info(`Retrieved ${result.rows.length} routers needing attention`);
    res.json({
      success: true,
      count: result.rows.length,
      routers: result.rows
    });

  } catch (error) {
    logger.error('Error fetching routers needing attention:', error);
    res.status(500).json({ error: 'Failed to fetch routers needing attention' });
  }
});

// PATCH update router ClickUp task status (decommissioned, being returned, etc)
router.patch('/routers/:router_id/status', requireAdmin, async (req, res) => {
  try {
    const { router_id } = req.params;
    const { status, notes } = req.body;

    logger.info(`Status update request for router ${router_id}: status="${status}", notes="${notes}"`);

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Validate status values
    const validStatuses = ['decommissioned', 'being returned', 'installed', 'ready', 'needs attention'];
    const normalizedStatus = status.toLowerCase();
    
    if (!validStatuses.includes(normalizedStatus)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    // Update the router's clickup_task_status and notes in the database
    logger.info(`Updating database for router ${router_id} with status="${normalizedStatus}", notes="${notes || 'none'}"`);
    
    // Try to update with notes, fallback to without notes if column doesn't exist
    let result;
    try {
      result = await pool.query(
        `UPDATE routers 
         SET clickup_task_status = $1,
             notes = COALESCE($2::text, notes)
         WHERE router_id = $3
         RETURNING *`,
        [normalizedStatus, notes, router_id]
      );
    } catch (notesError) {
      // If notes column doesn't exist yet, update without it
      if (notesError.message && notesError.message.includes('column "notes" does not exist')) {
        logger.warn('Notes column does not exist yet, updating without notes');
        result = await pool.query(
          `UPDATE routers 
           SET clickup_task_status = $1
           WHERE router_id = $2
           RETURNING *`,
          [normalizedStatus, router_id]
        );
      } else {
        throw notesError;
      }
    }

    if (result.rows.length === 0) {
      logger.warn(`Router ${router_id} not found in database`);
      return res.status(404).json({ error: 'Router not found' });
    }

    const router = result.rows[0];
    logger.info(`Database updated successfully for router ${router_id}`);

    // If decommissioning or being returned, unlink from location and remove assignees
    if ((normalizedStatus === 'decommissioned' || normalizedStatus === 'being returned') && router.clickup_task_id) {
      try {
        // Unlink from location
        if (router.clickup_location_task_id) {
          await pool.query(
            `UPDATE routers 
             SET clickup_location_task_id = NULL, 
                 clickup_location_task_name = NULL,
                 clickup_location_task_url = NULL
             WHERE router_id = $1`,
            [router_id]
          );
          logger.info(`Unlinked router ${router_id} from location (status: ${normalizedStatus})`);
        }

        // Remove assignees in ClickUp
        const assignees = router.clickup_assignees ? JSON.parse(router.clickup_assignees) : [];
        if (assignees.length > 0) {
          await clickupClient.updateTaskAssignees(
            router.clickup_task_id,
            { add: [], rem: assignees.map(a => a.id) },
            'default'
          );
          
          // Update database
          await pool.query(
            `UPDATE routers SET clickup_assignees = '[]' WHERE router_id = $1`,
            [router_id]
          );
          logger.info(`Removed all assignees from router ${router_id} (status: ${normalizedStatus})`);
        }
      } catch (unlinkError) {
        logger.error(`Error unlinking/unassigning router (status: ${normalizedStatus}):`, unlinkError);
        // Don't fail the request - status update was successful
      }
    }

    // If there's a ClickUp task linked, update the status there too
    if (router.clickup_task_id) {
      try {
        logger.info(`Attempting to update ClickUp task ${router.clickup_task_id} status to "${normalizedStatus}"`);
        
        await clickupClient.updateTask(
          router.clickup_task_id, 
          { status: normalizedStatus },
          'default'
        );
        logger.info(`Successfully updated ClickUp task ${router.clickup_task_id} status to "${normalizedStatus}"`);
        
        // Add comment to ClickUp task for significant status changes
        try {
          let commentText = '';
          if (normalizedStatus === 'decommissioned') {
            commentText = `🗑️ **Router Decommissioned**\n\nThis router has been permanently decommissioned and removed from service.`;
            if (notes) {
              commentText += `\n\n**Notes:** ${notes}`;
            }
          } else if (normalizedStatus === 'being returned') {
            commentText = `📦 **Router Being Returned**\n\nThis router is being returned and is no longer in use.`;
            if (notes) {
              commentText += `\n\n**Notes:** ${notes}`;
            }
          }
          
          if (commentText) {
            await clickupClient.createTaskComment(
              router.clickup_task_id,
              commentText,
              {},
              'default'
            );
            logger.info(`Added comment to ClickUp task ${router.clickup_task_id} for status change to ${normalizedStatus}`);
          }
        } catch (commentError) {
          logger.warn(`Failed to add comment to ClickUp task:`, commentError.message);
          // Don't fail the request
        }
      } catch (clickupError) {
        logger.error(`Failed to update ClickUp task status to "${normalizedStatus}":`, {
          error: clickupError.message,
          status: clickupError.response?.status,
          data: clickupError.response?.data,
          stack: clickupError.stack
        });
        // Continue anyway - database was updated
      }
    } else {
      logger.info(`No ClickUp task linked for router ${router_id}, skipping ClickUp sync`);
    }

    logger.info(`Sending success response for router ${router_id} status update`);
    res.json({ 
      success: true, 
      router: result.rows[0],
      message: `Router status updated to "${normalizedStatus}"`
    });

  } catch (error) {
    logger.error('CRITICAL ERROR updating router status:', {
      error: error.message,
      stack: error.stack,
      router_id: req.params.router_id,
      body: req.body
    });
    res.status(500).json({ error: 'Failed to update router status', details: error.message });
  }
});

// PATCH update router notes
router.patch('/routers/:router_id/notes', requireAdmin, async (req, res) => {
  try {
    const { router_id } = req.params;
    const { notes } = req.body;

    const result = await pool.query(
      `UPDATE routers 
       SET notes = $1
       WHERE router_id = $2
       RETURNING *`,
      [notes, router_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Router not found' });
    }

    logger.info(`Updated notes for router ${router_id}`);
    res.json({ 
      success: true, 
      router: result.rows[0]
    });

  } catch (error) {
    logger.error('Error updating router notes:', error);
    res.status(500).json({ error: 'Failed to update router notes' });
  }
});

// POST log inspection for a router
router.post('/inspections/:routerId', requireAdmin, async (req, res) => {
  try {
    const { routerId } = req.params;
    const { inspected_by, notes } = req.body;
    const inspection = await logInspection(routerId, inspected_by, notes);
    res.json({ success: true, inspection });
  } catch (error) {
    logger.error('Error logging inspection:', error);
    res.status(500).json({ error: 'Failed to log inspection' });
  }
});

// GET inspection history for a router
router.get('/inspections/:routerId', requireRouterAccess, async (req, res) => {
  try {
    const { routerId } = req.params;
    const history = await getInspectionHistory(routerId);
    res.json(history);
  } catch (error) {
    logger.error('Error fetching inspection history:', error);
    res.status(500).json({ error: 'Failed to fetch inspection history' });
  }
});

// POST clear all ClickUp task associations
router.post('/clear-clickup-tasks', requireAdmin, async (req, res) => {
  try {
    await pool.query(
      'UPDATE routers SET clickup_task_id = NULL, clickup_task_url = NULL, clickup_list_id = NULL'
    );
    logger.info('Cleared all ClickUp task associations');
    res.json({ success: true, message: 'Cleared all ClickUp task associations' });
  } catch (error) {
    logger.error('Error clearing task associations:', error);
    res.status(500).json({ error: 'Failed to clear task associations' });
  }
});

router.get('/routers/status-summary', requireAdmin, async (req, res) => {
  try {
    const currentResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE current_status IN ('online', 'Online', '1')) as online_count,
        COUNT(*) FILTER (WHERE current_status NOT IN ('online', 'Online', '1') OR current_status IS NULL) as offline_count,
        COUNT(*) as total_count
      FROM (
        SELECT 
          r.router_id,
          (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as current_status
        FROM routers r
        WHERE LOWER(r.clickup_task_status) = 'installed'
      ) counts
    `);

    const historicalResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE historical_status IN ('online', 'Online', '1')) as online_count,
        COUNT(*) FILTER (WHERE historical_status NOT IN ('online', 'Online', '1') OR historical_status IS NULL) as offline_count
      FROM (
        SELECT 
          r.router_id,
          (
            SELECT status 
            FROM router_logs 
            WHERE router_id = r.router_id 
              AND timestamp <= NOW() - INTERVAL '48 hours'
            ORDER BY timestamp DESC 
            LIMIT 1
          ) as historical_status
        FROM routers r
        WHERE LOWER(r.clickup_task_status) = 'installed'
      ) counts
    `);

    const current = currentResult.rows[0];
    const historical = historicalResult.rows[0];

    res.json({
      current: {
        online: parseInt(current.online_count) || 0,
        offline: parseInt(current.offline_count) || 0,
        total: parseInt(current.total_count) || 0
      },
      historical: {
        online: parseInt(historical.online_count) || 0,
        offline: parseInt(historical.offline_count) || 0
      },
      change: {
        online: (parseInt(current.online_count) || 0) - (parseInt(historical.online_count) || 0),
        offline: (parseInt(current.offline_count) || 0) - (parseInt(historical.offline_count) || 0)
      }
    });
  } catch (error) {
    logger.error('Error fetching router status summary:', error);
    res.status(500).json({ error: 'Failed to fetch router status summary' });
  }
});

/**
 * POST /routers/:routerId/upload-report
 * Upload a PDF report to the router's ClickUp task as a comment attachment
 */
router.post('/routers/:routerId/upload-report', requireAdmin, async (req, res) => {
  try {
    const { routerId } = req.params;
    const { pdfData, reportType, dateRange } = req.body;
    
    if (!pdfData) {
      return res.status(400).json({ error: 'PDF data is required' });
    }
    
    // Get router info including ClickUp task ID
    const routerResult = await pool.query(
      'SELECT router_id, name, clickup_task_id FROM routers WHERE router_id = $1',
      [routerId]
    );
    
    if (routerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Router not found' });
    }
    
    const router = routerResult.rows[0];
    
    if (!router.clickup_task_id) {
      return res.status(400).json({ error: 'Router is not linked to a ClickUp task' });
    }
    
    // Convert base64 PDF data to buffer
    const pdfBuffer = Buffer.from(pdfData, 'base64');
    
    // Generate filename
    const routerName = router.name || `Router-${routerId}`;
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${routerName.replace(/[^a-zA-Z0-9]/g, '-')}-${reportType || 'report'}-${timestamp}.pdf`;
    
    // Create comment text
    const commentText = `📄 **Report Generated**\n\n` +
      `📊 Report Type: ${reportType || 'Uptime & Coverage Report'}\n` +
      (dateRange ? `📅 Date Range: ${dateRange}\n` : '') +
      `🕐 Generated: ${new Date().toLocaleString()}\n` +
      (req.user?.username ? `👤 Generated by: ${req.user.username}\n` : '') +
      `\n📎 See attached PDF report.`;
    
    // Upload attachment and create comment
    const result = await clickupClient.createCommentWithAttachment(
      router.clickup_task_id,
      commentText,
      pdfBuffer,
      filename,
      'default'
    );
    
    logger.info('PDF report uploaded to ClickUp:', {
      routerId,
      clickupTaskId: router.clickup_task_id,
      filename,
      attachmentId: result.attachment?.id,
      commentId: result.comment?.id
    });
    
    res.json({
      success: true,
      message: 'Report uploaded to ClickUp',
      attachmentId: result.attachment?.id,
      commentId: result.comment?.id
    });
    
  } catch (error) {
    logger.error('Error uploading report to ClickUp:', error);
    res.status(500).json({ 
      error: 'Failed to upload report to ClickUp',
      message: error.message 
    });
  }
});

// Export router and any functions that need to be called from other modules
module.exports = router;

// Legacy export for backwards compatibility (now handled by cacheManager)
module.exports.invalidateAssigneeCache = function() {
  const cacheManager = require('../services/cacheManager');
  cacheManager.invalidateCache('assignees');
};

