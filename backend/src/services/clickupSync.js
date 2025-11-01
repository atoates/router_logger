/**
 * ClickUp Sync Service
 * Automatically syncs router status to ClickUp custom fields on a schedule
 */

const { pool, logger } = require('../config/database');
const clickupClient = require('./clickupClient');

// Custom field IDs from ClickUp
const CUSTOM_FIELDS = {
  OPERATIONAL_STATUS: '8a661229-13f0-4693-a7cb-1df86725cfed',
  ROUTER_MODEL: 'f2cbe126-4e68-4be0-9c3b-fa230d289f51',
  FIRMWARE: '845f6619-e3ee-4634-b92a-a117f14fb8c7',
  LAST_MAINTENANCE_DATE: '49551d31-6e57-4620-af95-32c701e93488',
  IMEI: '8b278eb1-ba02-43c7-81d6-0b739c089e7c',
  ROUTER_ID: 'dfe0016c-4ab0-4dd9-bb38-b338411e9b47',
  LAST_ONLINE: '684e19a1-06c3-4bfd-94dd-6aca4a9b85fe',
  DATA_USAGE: 'c58206db-e995-4717-8e62-d36e15d0a3e2',
  ROUTER_DASHBOARD: 'b9cf2e41-dc79-4768-985a-bda52b9dad1f'
};

// Operational status options (dropdown UUIDs)
const STATUS_OPTIONS = {
  ONLINE: 'b256bad4-2f9e-4e98-89b1-77a2a5443337',
  OFFLINE: '7149ad8d-db43-48ab-a038-a17162c7495d',
  MAINTENANCE: '38342970-fdd4-4c9f-bcea-738be4f6e2c5'
};

let syncIntervalId = null;
let lastSyncTime = null;
let syncStats = {
  totalSyncs: 0,
  lastSyncUpdated: 0,
  lastSyncErrors: 0,
  lastSyncDuration: 0
};

/**
 * Sync a single router's data to its ClickUp task
 */
async function syncRouterToClickUp(router) {
  try {
    if (!router.clickup_task_id) {
      return { success: false, error: 'No ClickUp task linked' };
    }

    const customFields = [];
    const frontendUrl = process.env.FRONTEND_URL || 'https://routerlogger-frontend-production.up.railway.app';

    // Router ID (text) - required
    customFields.push({
      id: CUSTOM_FIELDS.ROUTER_ID,
      value: router.router_id.toString()
    });

    // IMEI (number)
    if (router.imei) {
      const imeiNum = parseInt(router.imei);
      if (!isNaN(imeiNum)) {
        customFields.push({
          id: CUSTOM_FIELDS.IMEI,
          value: imeiNum
        });
      }
    }

    // Firmware (text)
    if (router.firmware_version) {
      customFields.push({
        id: CUSTOM_FIELDS.FIRMWARE,
        value: router.firmware_version
      });
    }

    // Last Online (date timestamp in milliseconds)
    if (router.last_seen) {
      customFields.push({
        id: CUSTOM_FIELDS.LAST_ONLINE,
        value: new Date(router.last_seen).getTime()
      });
    }

    // Operational Status (dropdown: use UUID option IDs)
    const statusValue = router.current_status === 'online' 
      ? STATUS_OPTIONS.ONLINE 
      : STATUS_OPTIONS.OFFLINE;
    customFields.push({
      id: CUSTOM_FIELDS.OPERATIONAL_STATUS,
      value: statusValue
    });

    // Router Dashboard (URL) - direct link to router's page
    const dashboardUrl = `${frontendUrl}/router/${router.router_id}`;
    customFields.push({
      id: CUSTOM_FIELDS.ROUTER_DASHBOARD,
      value: dashboardUrl
    });

    // Update task via ClickUp client
    await clickupClient.updateTask(router.clickup_task_id, {
      custom_fields: customFields
    }, 'default');

    return { success: true };

  } catch (error) {
    logger.error(`Error syncing router ${router.router_id} to ClickUp:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Sync all routers with linked ClickUp tasks
 */
async function syncAllRoutersToClickUp() {
  const startTime = Date.now();
  logger.info('Starting ClickUp sync for all routers...');

  try {
    // Get all routers with ClickUp tasks
    const result = await pool.query(
      `SELECT 
         r.router_id, 
         r.clickup_task_id, 
         r.imei, 
         r.firmware_version, 
         r.last_seen, 
         r.name,
         (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as current_status
       FROM routers r
       WHERE r.clickup_task_id IS NOT NULL
       ORDER BY r.router_id`
    );

    const routers = result.rows;
    logger.info(`Found ${routers.length} routers with ClickUp tasks`);

    if (routers.length === 0) {
      lastSyncTime = new Date();
      syncStats.lastSyncUpdated = 0;
      syncStats.lastSyncErrors = 0;
      syncStats.lastSyncDuration = Date.now() - startTime;
      return { updated: 0, errors: 0, total: 0 };
    }

    let updated = 0;
    let errors = 0;

    // Sync routers in batches to avoid overwhelming ClickUp API
    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES = 1000; // 1 second

    for (let i = 0; i < routers.length; i += BATCH_SIZE) {
      const batch = routers.slice(i, i + BATCH_SIZE);
      
      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(router => syncRouterToClickUp(router))
      );

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value.success) {
          updated++;
        } else {
          errors++;
          const router = batch[idx];
          const error = result.status === 'rejected' ? result.reason : result.value.error;
          logger.warn(`Failed to sync router ${router.router_id}: ${error}`);
        }
      });

      // Delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < routers.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    const duration = Date.now() - startTime;
    lastSyncTime = new Date();
    syncStats.totalSyncs++;
    syncStats.lastSyncUpdated = updated;
    syncStats.lastSyncErrors = errors;
    syncStats.lastSyncDuration = duration;

    logger.info(`ClickUp sync completed: ${updated} updated, ${errors} errors (${duration}ms)`);

    return {
      updated,
      errors,
      total: routers.length,
      duration
    };

  } catch (error) {
    logger.error('Error during ClickUp sync:', error);
    throw error;
  }
}

/**
 * Start scheduled ClickUp sync (idempotent)
 */
function startClickUpSync(intervalMinutes = 30) {
  if (syncIntervalId) {
    logger.info('ClickUp sync scheduler already running');
    return;
  }

  logger.info(`Starting ClickUp sync scheduler (every ${intervalMinutes} minutes)`);

  // Run immediately on start
  syncAllRoutersToClickUp().catch(error => {
    logger.error('Initial ClickUp sync failed:', error.message);
  });

  // Then run on schedule
  syncIntervalId = setInterval(() => {
    syncAllRoutersToClickUp().catch(error => {
      logger.error('Scheduled ClickUp sync failed:', error.message);
    });
  }, intervalMinutes * 60 * 1000);

  logger.info(`ClickUp sync will run every ${intervalMinutes} minutes`);
}

/**
 * Stop scheduled ClickUp sync
 */
function stopClickUpSync() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    logger.info('ClickUp sync scheduler stopped');
  }
}

/**
 * Get sync statistics
 */
function getSyncStats() {
  return {
    ...syncStats,
    lastSyncTime,
    isRunning: !!syncIntervalId
  };
}

module.exports = {
  syncRouterToClickUp,
  syncAllRoutersToClickUp,
  startClickUpSync,
  stopClickUpSync,
  getSyncStats
};
