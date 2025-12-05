/**
 * Admin Controller
 * Handles admin-specific endpoints with proper separation of concerns
 */

const { logger, pool } = require('../config/database');
const routerSyncService = require('../services/routerSyncService');
const cacheManager = require('../services/cacheManager');

/**
 * POST /admin/sync-dates
 * Sync date_installed from ClickUp to database
 */
async function syncDates(req, res) {
  try {
    const result = await routerSyncService.syncDateInstalledFromClickUp();
    
    res.json({
      success: true,
      summary: result.summary,
      cacheCleared: result.cacheCleared,
      results: result.results
    });
  } catch (error) {
    logger.error('Date sync failed:', error);
    res.status(500).json({ 
      error: 'Failed to sync dates', 
      message: error.message 
    });
  }
}

/**
 * POST /admin/clear-cache
 * Clear all router-related caches
 */
async function clearCache(req, res) {
  try {
    cacheManager.invalidateAllRouterCaches();
    
    const stats = cacheManager.getCacheStats();
    
    res.json({ 
      success: true, 
      message: 'All router caches cleared',
      caches_cleared: Object.keys(stats),
      stats
    });
  } catch (error) {
    logger.error('Error clearing caches:', error);
    res.status(500).json({ 
      error: 'Failed to clear caches',
      message: error.message
    });
  }
}

/**
 * GET /admin/deduplication-report
 * Generate report showing which routers are being filtered by deduplication logic
 */
async function getDeduplicationReport(req, res) {
  try {
    // Get all routers (we'll need the model function for this)
    const { getAllRouters } = require('../models/router');
    const routers = await getAllRouters();
    
    // Group by name (same logic as /routers endpoint)
    const byName = new Map();
    const isSerialLike = (id) => /^(\d){9,}$/.test(String(id || ''));
    
    for (const r of routers) {
      const key = (r.name || '').toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, [r]);
      } else {
        byName.get(key).push(r);
      }
    }
    
    // Find groups with duplicates
    const duplicates = [];
    for (const [name, group] of byName.entries()) {
      if (group.length > 1) {
        // Sort same way as deduplication logic
        const sorted = group.sort((a, b) => {
          // Prefer serial-like IDs
          const aSerial = isSerialLike(a.router_id);
          const bSerial = isSerialLike(b.router_id);
          if (aSerial !== bSerial) return bSerial ? 1 : -1;
          
          // Then prefer more logs
          const aLogs = Number(a.log_count || 0);
          const bLogs = Number(b.log_count || 0);
          if (aLogs !== bLogs) return bLogs - aLogs;
          
          // Then prefer more recent
          const aSeen = a.last_seen ? new Date(a.last_seen).getTime() : 0;
          const bSeen = b.last_seen ? new Date(b.last_seen).getTime() : 0;
          return bSeen - aSeen;
        });
        
        duplicates.push({
          name: name || '(empty)',
          count: group.length,
          kept: {
            router_id: sorted[0].router_id,
            log_count: sorted[0].log_count,
            last_seen: sorted[0].last_seen,
            is_serial: isSerialLike(sorted[0].router_id)
          },
          hidden: sorted.slice(1).map(r => ({
            router_id: r.router_id,
            log_count: r.log_count,
            last_seen: r.last_seen,
            is_serial: isSerialLike(r.router_id)
          }))
        });
      }
    }
    
    res.json({
      success: true,
      total_routers: routers.length,
      after_deduplication: byName.size,
      duplicate_groups: duplicates.length,
      duplicates
    });
  } catch (error) {
    logger.error('Error generating deduplication report:', error);
    res.status(500).json({ 
      error: 'Failed to generate deduplication report',
      message: error.message
    });
  }
}

module.exports = {
  syncDates,
  clearCache,
  getDeduplicationReport
};


