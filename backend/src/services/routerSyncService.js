/**
 * Router Sync Service
 * Handles synchronization of router data between database and external services (ClickUp)
 */

const { pool, logger } = require('../config/database');
const clickupClient = require('./clickupClient');
const cacheManager = require('./cacheManager');
const { CLICKUP_FIELD_IDS, RATE_LIMITS } = require('../config/constants');

/**
 * Sync date_installed from ClickUp to database for all routers with location assignments
 * @returns {Promise<Object>} Sync results summary
 */
async function syncDateInstalledFromClickUp() {
  logger.info('Starting date_installed sync from ClickUp');
  
  // Get all routers with location assignments
  const result = await pool.query(
    `SELECT router_id, clickup_location_task_id 
     FROM routers 
     WHERE clickup_location_task_id IS NOT NULL`
  );
  
  const routers = result.rows;
  logger.info(`Found ${routers.length} routers with location assignments to sync`);
  
  let updated = 0;
  let failed = 0;
  const results = [];
  
  for (const router of routers) {
    try {
      // Fetch date_installed from ClickUp
      const rawDate = await clickupClient.getListCustomFieldValue(
        router.clickup_location_task_id,
        CLICKUP_FIELD_IDS.DATE_INSTALLED,
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
      
      // Rate limiting to avoid API throttling
      await rateLimitDelay(RATE_LIMITS.CLICKUP_API_DELAY_MS);
      
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
  
  // Clear router caches after sync
  cacheManager.invalidateAllRouterCaches();
  
  logger.info('Date sync completed and cache cleared', { 
    updated, 
    failed, 
    total: routers.length 
  });
  
  return {
    summary: { updated, failed, total: routers.length },
    cacheCleared: true,
    results
  };
}

/**
 * Rate limiting helper - adds delay between API calls
 * @param {number} ms - Milliseconds to delay
 */
async function rateLimitDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  syncDateInstalledFromClickUp
};

