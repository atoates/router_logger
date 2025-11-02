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
  IMEI: '687faa85-01c0-48c4-8f6e-60a78a570cab', // Updated: was wrong ID
  ROUTER_ID: 'dfe0016c-4ab0-4dd9-bb38-b338411e9b47', // This is actually "Serial" in ClickUp
  LAST_ONLINE: '684e19a1-06c3-4bfd-94dd-6aca4a9b85fe',
  DATA_USAGE: 'c58206db-e995-4717-8e62-d36e15d0a3e2',
  ROUTER_DASHBOARD: 'b9cf2e41-dc79-4768-985a-bda52b9dad1f'
};

// Operational status options (dropdown orderindex values)
const STATUS_OPTIONS = {
  ONLINE: 0,
  OFFLINE: 1,
  MAINTENANCE: 2
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

    // IMEI (text - NOT number in ClickUp!)
    if (router.imei) {
      customFields.push({
        id: CUSTOM_FIELDS.IMEI,
        value: router.imei.toString()
      });
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

    // Operational Status (dropdown) - will be updated separately via individual field API
    // Calculate the value but don't add to customFields array
    const isOnline = router.current_status === 'online';
    const statusValue = isOnline ? STATUS_OPTIONS.ONLINE : STATUS_OPTIONS.OFFLINE;
    
    logger.info(`Router ${router.router_id}: current_status="${router.current_status}", sending ClickUp status="${isOnline ? 'ONLINE' : 'OFFLINE'}" (${statusValue})`);

    // Router Dashboard (URL) - direct link to router's page
    const dashboardUrl = `${frontendUrl}/router/${router.router_id}`;
    customFields.push({
      id: CUSTOM_FIELDS.ROUTER_DASHBOARD,
      value: dashboardUrl
    });

    // Update all custom fields EXCEPT Operational Status first
    const updatePayload = {
      custom_fields: customFields
    };
    
    // Log the exact payload for Router #58 to debug
    if (router.router_id === '6004928162') {
      logger.info(`Router #58 ClickUp update payload:`, JSON.stringify(updatePayload, null, 2));
    }
    
    await clickupClient.updateTask(router.clickup_task_id, updatePayload, 'default');

    // Update Operational Status separately using the individual field API
    // This is more reliable for dropdown fields
    try {
      await clickupClient.updateCustomField(
        router.clickup_task_id,
        CUSTOM_FIELDS.OPERATIONAL_STATUS,
        statusValue,
        'default'
      );
      logger.debug(`Updated Operational Status for router ${router.router_id} to ${statusValue} (${isOnline ? 'ONLINE' : 'OFFLINE'})`);
    } catch (fieldError) {
      logger.error(`Failed to update Operational Status for router ${router.router_id}:`, fieldError.message);
      // Don't fail the whole sync if just the status field fails
    }

    logger.debug(`Synced router ${router.router_id}: dbStatus=${router.current_status}, isOnline=${isOnline}, lastSeen=${router.last_seen}, clickupStatus=${statusValue}`);

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
 * Sync ClickUp task assignees to local database
 * Updates the stored_with fields based on task assignees
 */
async function syncAssigneesFromClickUp() {
  const startTime = Date.now();
  logger.info('Starting ClickUp assignee sync...');

  try {
    // Get all routers with ClickUp tasks
    const result = await pool.query(
      `SELECT router_id, clickup_task_id, current_stored_with_user_id, current_stored_with_username
       FROM routers 
       WHERE clickup_task_id IS NOT NULL
       ORDER BY router_id`
    );

    const routers = result.rows;
    logger.info(`Found ${routers.length} routers with ClickUp tasks`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const router of routers) {
      try {
        // Get task from ClickUp
        const task = await clickupClient.getTask(router.clickup_task_id, 'default');
        
        // Check if task has assignees
        const assignees = task.assignees || [];
        
        if (assignees.length > 0) {
          // Take first assignee as the one storing the router
          const assignee = assignees[0];
          const assigneeId = String(assignee.id);
          const assigneeName = assignee.username;

          // Only update if different from current
          if (router.current_stored_with_user_id !== assigneeId || 
              router.current_stored_with_username !== assigneeName) {
            
            await pool.query(
              `UPDATE routers 
               SET current_stored_with_user_id = $1,
                   current_stored_with_username = $2,
                   service_status = 'out-of-service'
               WHERE router_id = $3`,
              [assigneeId, assigneeName, router.router_id]
            );

            logger.info(`Synced assignee for router ${router.router_id}: ${assigneeName}`);
            syncedCount++;
          }
        } else {
          // No assignees - clear stored_with if it was set
          if (router.current_stored_with_user_id) {
            await pool.query(
              `UPDATE routers 
               SET current_stored_with_user_id = NULL,
                   current_stored_with_username = NULL,
                   service_status = 'in-service'
               WHERE router_id = $1`,
              [router.router_id]
            );

            logger.info(`Cleared assignee for router ${router.router_id}`);
            syncedCount++;
          }
        }
      } catch (error) {
        logger.error(`Error syncing assignee for router ${router.router_id}:`, error.message);
        errorCount++;
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const duration = Date.now() - startTime;
    logger.info(`ClickUp assignee sync completed: ${syncedCount} updated, ${errorCount} errors, ${duration}ms`);

    return {
      success: true,
      totalRouters: routers.length,
      syncedCount,
      errorCount,
      duration
    };

  } catch (error) {
    logger.error('Error during ClickUp assignee sync:', error);
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
  syncAssigneesFromClickUp,
  startClickUpSync,
  stopClickUpSync,
  getSyncStats
};
