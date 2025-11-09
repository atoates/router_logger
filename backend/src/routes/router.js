const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { requireSession } = require('./session');
const { 
  upsertRouter, 
  insertLog, 
  getAllRouters, 
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
const { linkRouterToLocation, unlinkRouterFromLocation, assignRouterToUsers, removeRouterAssignees, getCurrentLocation } = require('../services/propertyService');
const { processRouterTelemetry } = require('../services/telemetryProcessor');
const { logger, pool } = require('../config/database');
const clickupClient = require('../services/clickupClient');

// Cache for routers with locations (15 minute TTL)
const routersWithLocationsCache = {
  data: null,
  timestamp: null,
  TTL: 15 * 60 * 1000 // 15 minutes
};

// Temporary endpoint to sync date_installed from ClickUp to database
router.post('/admin/sync-dates', async (req, res) => {
  const DATE_INSTALLED_FIELD_ID = '9f31c21a-630d-49f2-8a79-354de03e24d1';
  
  try {
    // Get all routers with location assignments
    const result = await pool.query(
      `SELECT router_id, clickup_location_task_id 
       FROM routers 
       WHERE clickup_location_task_id IS NOT NULL`
    );
    
    logger.info(`Syncing date_installed for ${result.rows.length} routers`);
    
    let updated = 0;
    let failed = 0;
    const results = [];
    
    for (const router of result.rows) {
      try {
        // Fetch date_installed from ClickUp
        const rawDate = await clickupClient.getListCustomFieldValue(
          router.clickup_location_task_id,
          DATE_INSTALLED_FIELD_ID,
          'default'
        );
        
        const dateInstalled = rawDate ? Number(rawDate) : null;
        
        // Update database
        await pool.query(
          `UPDATE routers 
           SET date_installed = $1 
           WHERE router_id = $2`,
          [dateInstalled, router.router_id]
        );
        
        results.push({
          router_id: router.router_id,
          date_installed: dateInstalled ? new Date(dateInstalled).toISOString() : null,
          status: 'success'
        });
        updated++;
        
        // Add 200ms delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        logger.error(`Failed to sync date for router ${router.router_id}:`, error.message);
        results.push({
          router_id: router.router_id,
          error: error.message,
          status: 'failed'
        });
        failed++;
      }
    }
    
    // Clear the cache after syncing
    routersWithLocationsCache.data = null;
    routersWithLocationsCache.timestamp = null;
    
    logger.info('Date sync completed and cache cleared', { updated, failed, total: result.rows.length });
    
    res.json({
      success: true,
      summary: { updated, failed, total: result.rows.length },
      cacheCleared: true,
      results
    });
    
  } catch (error) {
    logger.error('Date sync failed:', error);
    res.status(500).json({ error: 'Failed to sync dates', message: error.message });
  }
});

// POST endpoint for routers to send data (HTTPS Data to Server)
router.post('/log', async (req, res) => {
  try {
    const telemetryData = req.body;
    
    // Validate required fields
    if (!telemetryData.device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }
    
    // Process telemetry (same as MQTT handler)
    const log = await processRouterTelemetry(telemetryData);
    
    logger.info(`HTTPS log received from router ${telemetryData.device_id}`);
    res.status(201).json({ success: true, log });
  } catch (error) {
    logger.error('Error processing log:', error);
    res.status(500).json({ error: 'Failed to process log data' });
  }
});

// In-memory cache for /routers with TTL and ETag support
const ROUTERS_CACHE_TTL_SECONDS = parseInt(process.env.ROUTERS_CACHE_TTL_SECONDS || '60', 10);
let routersCache = { data: null, etag: null, expiresAt: 0 };

// GET all routers (deduplicated best-by-name) with cache/ETag
router.get('/routers', async (req, res) => {
  try {
    const now = Date.now();
    if (routersCache.data && routersCache.expiresAt > now) {
      // ETag support
      if (req.headers['if-none-match'] && req.headers['if-none-match'] === routersCache.etag) {
        res.status(304).end();
        return;
      }
      res.set('ETag', routersCache.etag);
      res.set('X-Cache', 'HIT');
      return res.json(routersCache.data);
    }

    const routers = await getAllRouters();
    // Merge duplicates by same name, prefer entries with logs, then latest seen
    const byName = new Map();
    const isSerialLike = (id) => /^(\d){9,}$/.test(String(id || ''));
    for (const r of routers) {
      const key = (r.name || '').toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, r);
        continue;
      }
      const cur = byName.get(key);
      const curIsSerial = isSerialLike(cur.router_id);
      const newIsSerial = isSerialLike(r.router_id);
      if (newIsSerial !== curIsSerial) {
        if (newIsSerial) byName.set(key, r);
        continue;
      }
      const curLogs = Number(cur.log_count || 0);
      const newLogs = Number(r.log_count || 0);
      if (newLogs !== curLogs) {
        if (newLogs > curLogs) byName.set(key, r);
        continue;
      }
      const curSeen = cur.last_seen ? new Date(cur.last_seen).getTime() : 0;
      const newSeen = r.last_seen ? new Date(r.last_seen).getTime() : 0;
      if (newSeen > curSeen) byName.set(key, r);
    }
    const data = Array.from(byName.values());
    const hash = crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');
    const etag = 'W/"' + hash + '"';
    routersCache = { data, etag, expiresAt: Date.now() + ROUTERS_CACHE_TTL_SECONDS * 1000 };
    res.set('ETag', etag);
    res.set('X-Cache', 'MISS');
    return res.json(data);
  } catch (error) {
    logger.error('Error fetching routers:', error);
    res.status(500).json({ error: 'Failed to fetch routers' });
  }
});

// GET logs with filters
router.get('/logs', async (req, res) => {
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

// GET usage statistics
router.get('/stats/usage', async (req, res) => {
  try {
    const { router_id, start_date, end_date } = req.query;
    
    if (!router_id || !start_date || !end_date) {
      return res.status(400).json({ 
        error: 'router_id, start_date, and end_date are required' 
      });
    }
    
    const stats = await getUsageStats(router_id, start_date, end_date);
    logger.info(`Usage stats for ${router_id}:`, stats);
    res.json({ data: [stats] }); // Wrap in data array for consistency
  } catch (error) {
    logger.error('Error fetching usage stats:', error);
    res.status(500).json({ error: 'Failed to fetch usage statistics' });
  }
});

// GET uptime data
router.get('/stats/uptime', async (req, res) => {
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

// GET storage stats (dashboard)
router.get('/stats/storage', async (req, res) => {
  try {
    const sampleSize = req.query.sample_size ? Number(req.query.sample_size) : 1000;
    const stats = await getStorageStats(sampleSize);
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching storage stats:', error);
    res.status(500).json({ error: 'Failed to fetch storage stats' });
  }
});

// GET top routers by data usage (last N days)
router.get('/stats/top-routers', async (req, res) => {
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

// GET network usage by day (last N days)
router.get('/stats/network-usage', async (req, res) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 7;
    const data = await getNetworkUsageByDay(days);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching network usage by day:', error);
    res.status(500).json({ error: 'Failed to fetch network usage' });
  }
});

// GET operator distribution (counts and usage)
router.get('/stats/operators', async (req, res) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 7;
    const data = await getOperatorDistribution(days);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching operator distribution:', error);
    res.status(500).json({ error: 'Failed to fetch operator distribution' });
  }
});

// GET true rolling operator distribution (hours)
router.get('/stats/operators-rolling', async (req, res) => {
  try {
    const hours = req.query.hours ? Number(req.query.hours) : 24;
    const data = await getOperatorDistributionRolling(hours);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching rolling operator distribution:', error);
    res.status(500).json({ error: 'Failed to fetch rolling operator distribution' });
  }
});

// GET rolling network usage (hours, bucket=hour|day)
router.get('/stats/network-usage-rolling', async (req, res) => {
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

// GET rolling top routers by usage (hours)
router.get('/stats/top-routers-rolling', async (req, res) => {
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

// GET database size statistics
router.get('/stats/db-size', async (req, res) => {
  try {
    const data = await getDatabaseSizeStats();
    res.json(data);
  } catch (error) {
    logger.error('Error fetching database size stats:', error);
    res.status(500).json({ error: 'Failed to fetch database size stats' });
  }
});

// GET inspection status for all routers
router.get('/stats/inspections', async (req, res) => {
  try {
    const data = await getInspectionStatus();
    res.json(data);
  } catch (error) {
    logger.error('Error fetching inspection status:', error);
    res.status(500).json({ error: 'Failed to fetch inspection status' });
  }
});

// POST log inspection for a router
router.post('/inspections/:routerId', async (req, res) => {
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
router.get('/inspections/:routerId', async (req, res) => {
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
router.post('/clear-clickup-tasks', async (req, res) => {
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

// GET current location for a router
router.get('/routers/:routerId/current-location', async (req, res) => {
  try {
    const { routerId } = req.params;
    const location = await getCurrentLocation(routerId);
    
    if (location) {
      res.json({ location });
    } else {
      res.json({ location: null });
    }
  } catch (error) {
    logger.error('Error getting current location:', error);
    res.status(500).json({ error: error.message || 'Failed to get current location' });
  }
});

// GET all routers with location links (installed routers)
router.get('/routers/with-locations', async (req, res) => {
  try {
    // Check if cache is still valid
    const now = Date.now();
    if (routersWithLocationsCache.data && 
        routersWithLocationsCache.timestamp && 
        (now - routersWithLocationsCache.timestamp) < routersWithLocationsCache.TTL) {
      logger.info('Returning cached routers-with-locations data', {
        age: Math.round((now - routersWithLocationsCache.timestamp) / 1000),
        count: routersWithLocationsCache.data.length
      });
      res.set('X-Cache', 'HIT');
      return res.json(routersWithLocationsCache.data);
    }

    logger.info('Cache miss, fetching fresh routers-with-locations data');
    
    const result = await pool.query(`
      SELECT 
        r.router_id,
        r.name,
        r.last_seen,
        l.status as current_state,
        r.clickup_task_id,
        r.clickup_task_url,
        r.clickup_location_task_id,
        r.clickup_location_task_name,
        r.location_linked_at,
        r.date_installed
      FROM routers r
      LEFT JOIN LATERAL (
        SELECT status
        FROM router_logs
        WHERE router_id = r.router_id
        ORDER BY timestamp DESC
        LIMIT 1
      ) l ON true
      WHERE r.clickup_location_task_id IS NOT NULL
      ORDER BY r.name ASC
    `);
    
    // Update cache
    routersWithLocationsCache.data = result.rows;
    routersWithLocationsCache.timestamp = Date.now();
    
    logger.info('Updated routers-with-locations cache', {
      count: result.rows.length
    });
    
    res.set('X-Cache', 'MISS');
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching routers with locations:', error);
    res.status(500).json({ error: 'Failed to fetch routers with locations' });
  }
});

// Cache for assignee data (1 week TTL - assignees rarely change)
const assigneeCache = {
  data: null,
  timestamp: null,
  TTL: 7 * 24 * 60 * 60 * 1000 // 1 week - assignees change max 2x/month
};

// Function to invalidate assignee cache (called after sync)
function invalidateAssigneeCache() {
  assigneeCache.data = null;
  assigneeCache.timestamp = null;
  logger.info('Assignee cache invalidated');
}

// GET all routers grouped by assignees (stored with)
router.get('/routers/by-assignees', async (req, res) => {
  try {
    // Check cache first
    const now = Date.now();
    if (assigneeCache.data && assigneeCache.timestamp && (now - assigneeCache.timestamp) < assigneeCache.TTL) {
      logger.info('Returning cached assignee data');
      return res.json(assigneeCache.data);
    }

    // Get all routers with their ClickUp tasks and assignees from DATABASE (no API calls!)
    const routersResult = await pool.query(`
      SELECT 
        r.router_id,
        r.name,
        r.last_seen,
        l.status as current_state,
        r.clickup_task_id,
        r.clickup_task_url,
        r.clickup_location_task_id,
        r.clickup_location_task_name,
        r.location_linked_at,
        r.clickup_assignees,
        r.clickup_task_status
      FROM routers r
      LEFT JOIN LATERAL (
        SELECT status
        FROM router_logs
        WHERE router_id = r.router_id
        ORDER BY timestamp DESC
        LIMIT 1
      ) l ON true
      WHERE r.clickup_task_id IS NOT NULL
      ORDER BY r.name ASC
    `);

    // Group routers by their assignees from DATABASE (no ClickUp API calls needed!)
    const routersByAssignee = {};
    const routers = routersResult.rows;
    
    for (const router of routers) {
      // Skip decommissioned routers entirely - they're gone and shouldn't appear anywhere
      const isDecommissioned = router.clickup_task_status?.toLowerCase() === 'decommissioned';
      if (isDecommissioned) {
        continue;
      }

      try {
        // Parse assignees from database
        let assignees = null;
        
        if (router.clickup_assignees) {
          // Handle both string and object formats
          if (typeof router.clickup_assignees === 'string') {
            assignees = JSON.parse(router.clickup_assignees);
          } else {
            assignees = router.clickup_assignees;
          }
        }
        
        if (assignees && Array.isArray(assignees) && assignees.length > 0) {
          for (const assignee of assignees) {
            const assigneeName = assignee.username || assignee.email || 'Unknown';
            if (!routersByAssignee[assigneeName]) {
              routersByAssignee[assigneeName] = [];
            }
            // Check if router is already in this assignee's list (avoid duplicates)
            const alreadyAdded = routersByAssignee[assigneeName].some(r => r.router_id === router.router_id);
            if (!alreadyAdded) {
              routersByAssignee[assigneeName].push(router);
            }
          }
        } else {
          // Unassigned routers (no assignees or empty array)
          if (!routersByAssignee['Unassigned']) {
            routersByAssignee['Unassigned'] = [];
          }
          routersByAssignee['Unassigned'].push(router);
        }
      } catch (parseError) {
        logger.warn(`Failed to parse assignees for router ${router.router_id}: ${parseError.message} - Data: ${JSON.stringify(router.clickup_assignees)?.substring(0, 100)}`);
        // Add to unassigned if we can't parse
        if (!routersByAssignee['Unassigned']) {
          routersByAssignee['Unassigned'] = [];
        }
        routersByAssignee['Unassigned'].push(router);
      }
    }
    
    // Cache the result
    assigneeCache.data = routersByAssignee;
    assigneeCache.timestamp = now;
    
    logger.info(`Grouped ${routers.length} routers by assignees from DATABASE (0 API calls)`);
    
    res.json(routersByAssignee);
  } catch (error) {
    logger.error('Error fetching routers by assignees:', error);
    res.status(500).json({ error: 'Failed to fetch routers by assignees' });
  }
});

// POST link router to a location (ClickUp location task)
// This will remove the assignee from the router task
router.post('/routers/:routerId/link-location', async (req, res) => {
  try {
    const { routerId } = req.params;
    const { location_task_id, location_task_name, notes } = req.body;
    
    if (!location_task_id) {
      return res.status(400).json({ 
        error: 'location_task_id is required' 
      });
    }
    
    // Use property service to link location
    const linkageRecord = await linkRouterToLocation({
      routerId,
      locationTaskId: location_task_id,
      locationTaskName: location_task_name || 'Unknown Location',
      linkedBy: null, // TODO: Add auth to track who made the change
      notes
    });
    
    logger.info(`Router ${routerId} linked to location ${location_task_id}`);
    res.json({ success: true, router: linkageRecord });
  } catch (error) {
    logger.error('Error linking router to location:', error);
    res.status(500).json({ error: error.message || 'Failed to link router to location' });
  }
});

// POST unlink router from location
// This will add assignee back if router is out-of-service
router.post('/routers/:routerId/unlink-location', async (req, res) => {
  try {
    const { routerId } = req.params;
    const { reassign_to_user_id, reassign_to_username, notes } = req.body;
    
    // Use property service to unlink location
    const unlinkageRecord = await unlinkRouterFromLocation({
      routerId,
      unlinkedBy: null, // TODO: Add auth to track who made the change
      reassignToUserId: reassign_to_user_id,
      reassignToUsername: reassign_to_username,
      notes
    });
    
    logger.info(`Router ${routerId} unlinked from location`);
    res.json({ success: true, router: unlinkageRecord });
  } catch (error) {
    logger.error('Error unlinking router from location:', error);
    res.status(500).json({ error: error.message || 'Failed to unlink router from location' });
  }
});

// POST assign router to ClickUp user(s)
// Updates the ClickUp task assignees field
router.post('/routers/:routerId/assign', async (req, res) => {
  try {
    const { routerId } = req.params;
    const { assignee_user_ids, assignee_usernames } = req.body;
    
    if (!assignee_user_ids || !Array.isArray(assignee_user_ids) || assignee_user_ids.length === 0) {
      return res.status(400).json({ 
        error: 'assignee_user_ids array is required and must contain at least one user ID' 
      });
    }
    
    const result = await assignRouterToUsers({
      routerId,
      assigneeUserIds: assignee_user_ids,
      assigneeUsernames: assignee_usernames || []
    });
    
    logger.info(`Router ${routerId} assigned to users`, { assignees: assignee_usernames });
    res.json(result);
  } catch (error) {
    logger.error('Error assigning router:', error);
    res.status(500).json({ error: error.message || 'Failed to assign router' });
  }
});

// POST remove all assignees from router
// Removes all assignees from the ClickUp task
router.post('/routers/:routerId/remove-assignees', async (req, res) => {
  try {
    const { routerId } = req.params;
    
    const result = await removeRouterAssignees(routerId);
    
    logger.info(`Router ${routerId} assignees removed`);
    res.json(result);
  } catch (error) {
    logger.error('Error removing router assignees:', error);
    res.status(500).json({ error: error.message || 'Failed to remove assignees' });
  }
});

// GET router online/offline status with 48h comparison
router.get('/routers/status-summary', async (req, res) => {
  try {
    // Get current status counts (only installed routers)
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

    // Get status counts from 48 hours ago (only installed routers)
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

// PATCH update router ClickUp task status (decommissioned, being returned, etc)
router.patch('/routers/:router_id/status', async (req, res) => {
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

    // If decommissioning, unlink from location and remove assignees
    if (normalizedStatus === 'decommissioned' && router.clickup_task_id) {
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
          logger.info(`Unlinked router ${router_id} from location`);
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
          logger.info(`Removed all assignees from router ${router_id}`);
        }
      } catch (unlinkError) {
        logger.error(`Error unlinking/unassigning decommissioned router:`, unlinkError);
        // Don't fail the request - status update was successful
      }
    }

    // If there's a ClickUp task linked, update the status there too
    if (router.clickup_task_id) {
      // This should NOT throw - all errors are caught
      try {
        const clickupStatus = normalizedStatus.toUpperCase().replace(/ /g, '_');
        logger.info(`Attempting to update ClickUp task ${router.clickup_task_id} status to "${clickupStatus}"`);
        
        await clickupClient.updateTask(
          router.clickup_task_id, 
          { status: clickupStatus },
          'default'
        );
        logger.info(`Successfully updated ClickUp task ${router.clickup_task_id} status to "${clickupStatus}"`);
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

// GET routers being returned
router.get('/routers/being-returned', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        r.*,
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

// GET decommissioned routers
router.get('/routers/decommissioned', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        r.*,
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

// GET routers that need attention
router.get('/routers/needs-attention', async (req, res) => {
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

// PATCH update router notes
router.patch('/routers/:router_id/notes', async (req, res) => {
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

module.exports = router;
module.exports.invalidateAssigneeCache = invalidateAssigneeCache;

