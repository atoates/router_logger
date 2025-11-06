const express = require('express');
const crypto = require('crypto');
const router = express.Router();
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
const { linkRouterToLocation, unlinkRouterFromLocation, assignRouterToUsers, removeRouterAssignees } = require('../services/propertyService');
const { processRouterTelemetry } = require('../services/telemetryProcessor');
const { logger, pool } = require('../config/database');

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
    res.json(stats);
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

module.exports = router;

