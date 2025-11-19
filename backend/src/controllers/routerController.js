/**
 * Router Controller
 * Handles main router CRUD operations
 */

const crypto = require('crypto');
const { logger } = require('../config/database');
const { processRouterTelemetry } = require('../services/telemetryProcessor');
const cacheManager = require('../services/cacheManager');
const { getAllRouters } = require('../models/router');

/**
 * POST /log
 * Router telemetry data endpoint (HTTPS Data to Server)
 */
async function logTelemetry(req, res) {
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
}

/**
 * GET /routers
 * Get all routers with deduplication, caching, and ETag support
 */
async function getRouters(req, res) {
  try {
    const ROUTERS_CACHE_TTL_SECONDS = parseInt(
      process.env.ROUTERS_CACHE_TTL_SECONDS || '60', 
      10
    );
    
    // Check cache first
    const now = Date.now();
    const cached = cacheManager.getRoutersCache();
    
    if (cached) {
      // ETag support
      if (req.headers['if-none-match'] && req.headers['if-none-match'] === cached.etag) {
        return res.status(304).end();
      }
      
      res.set('ETag', cached.etag);
      res.set('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    // Fetch and deduplicate
    const routers = await getAllRouters();
    const deduplicatedRouters = deduplicateRoutersByName(routers);
    
    // Generate ETag
    const hash = crypto
      .createHash('sha1')
      .update(JSON.stringify(deduplicatedRouters))
      .digest('hex');
    const etag = `W/"${hash}"`;
    
    // Cache the result
    cacheManager.setRoutersCache(
      deduplicatedRouters, 
      etag, 
      ROUTERS_CACHE_TTL_SECONDS
    );
    
    res.set('ETag', etag);
    res.set('X-Cache', 'MISS');
    return res.json(deduplicatedRouters);
  } catch (error) {
    logger.error('Error fetching routers:', error);
    res.status(500).json({ error: 'Failed to fetch routers' });
  }
}

/**
 * Deduplicate routers by name
 * Prefers: serial-like IDs > more logs > more recent last_seen
 */
function deduplicateRoutersByName(routers) {
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
    
    // Prefer serial-like IDs
    if (newIsSerial !== curIsSerial) {
      if (newIsSerial) byName.set(key, r);
      continue;
    }
    
    // Prefer more logs
    const curLogs = Number(cur.log_count || 0);
    const newLogs = Number(r.log_count || 0);
    if (newLogs !== curLogs) {
      if (newLogs > curLogs) byName.set(key, r);
      continue;
    }
    
    // Prefer more recent
    const curSeen = cur.last_seen ? new Date(cur.last_seen).getTime() : 0;
    const newSeen = r.last_seen ? new Date(r.last_seen).getTime() : 0;
    if (newSeen > curSeen) byName.set(key, r);
  }
  
  return Array.from(byName.values());
}

module.exports = {
  logTelemetry,
  getRouters
};

