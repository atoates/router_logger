/**
 * ClickUp Sync Service
 * Automatically syncs router status to ClickUp custom fields on a schedule
 */

const { pool, logger } = require('../config/database');
const clickupClient = require('./clickupClient');
const crypto = require('crypto');

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
async function syncRouterToClickUp(router, dataUsageMap = {}) {
  try {
    if (!router.clickup_task_id) {
      return { success: false, error: 'No ClickUp task linked' };
    }

    // Calculate hash of current router data
    const currentDataHash = crypto.createHash('md5')
      .update(JSON.stringify({
        status: router.current_status,
        firmware: router.firmware_version,
        last_seen: router.last_seen,
        imei: router.imei,
        router_id: router.router_id
      }))
      .digest('hex');
    
    // Skip sync if data hasn't changed (smart sync)
    if (router.last_clickup_sync_hash && router.last_clickup_sync_hash === currentDataHash) {
      logger.debug(`Router ${router.router_id}: No changes detected, skipping sync`);
      return { success: true, skipped: true };
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

    // Data Usage (number) - last 30 days in GB (pre-calculated)
    if (dataUsageMap[router.router_id] !== undefined) {
      customFields.push({
        id: CUSTOM_FIELDS.DATA_USAGE,
        value: dataUsageMap[router.router_id]
      });
      logger.info(`Router ${router.router_id}: Adding data usage to sync - ${dataUsageMap[router.router_id]} GB`);
    } else {
      logger.warn(`Router ${router.router_id}: No data usage calculated (not in map)`);
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

    // Router Dashboard (URL) - will be updated separately (URL fields require individual API)
    const dashboardUrl = `${frontendUrl}/router/${router.router_id}`;

    // Update all custom fields EXCEPT Operational Status and Router Dashboard
    const updatePayload = {
      custom_fields: customFields
    };
    
    // Log the exact payload for Router #58 to debug
    if (router.router_id === '6004928162') {
      logger.info(`Router #58 ClickUp update payload:`, JSON.stringify(updatePayload, null, 2));
    }
    
    const updatedTask = await clickupClient.updateTask(router.clickup_task_id, updatePayload, 'default');

    // Note: updatedTask doesn't include assignees. Run /api/clickup/sync/assignees separately to update those.

    // Update task status based on location and assignee
    // Logic:
    // - Has location + online = 'installed'
    // - Has location + offline = 'needs attention'
    // - Has assignee (no location) = 'ready'
    // - No location and no assignee = 'needs attention'
    try {
      let desiredStatus;
      const hasLocation = !!router.clickup_location_task_id;
      const hasAssignee = updatedTask && updatedTask.assignees && updatedTask.assignees.length > 0;
      const isOnline = router.current_status === 'online';
      
      if (hasLocation) {
        // Router is at a location
        if (isOnline) {
          desiredStatus = 'installed';
        } else {
          desiredStatus = 'needs attention'; // Installed but offline
        }
      } else if (hasAssignee) {
        // Router is with someone (stored with)
        desiredStatus = 'ready';
      } else {
        // Router has no location and no assignee
        desiredStatus = 'needs attention';
      }
      
      // Only update if status is different from current
      const currentStatus = updatedTask && updatedTask.status ? updatedTask.status.status : null;
      if (currentStatus !== desiredStatus) {
        await clickupClient.updateTask(
          router.clickup_task_id,
          { status: desiredStatus },
          'default'
        );
        logger.info(`Updated task status for router ${router.router_id}: ${currentStatus} → ${desiredStatus.toUpperCase()}`, {
          hasLocation,
          hasAssignee,
          isOnline,
          locationTaskId: router.clickup_location_task_id
        });
      }
    } catch (statusError) {
      logger.warn(`Failed to update task status for router ${router.router_id}:`, statusError.message);
      // Don't fail the whole sync if status update fails
    }

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

    // Update Router Dashboard URL separately using the individual field API
    // URL fields require the individual field endpoint
    try {
      await clickupClient.updateCustomField(
        router.clickup_task_id,
        CUSTOM_FIELDS.ROUTER_DASHBOARD,
        dashboardUrl,
        'default'
      );
      logger.debug(`Updated Router Dashboard URL for router ${router.router_id} to ${dashboardUrl}`);
    } catch (urlError) {
      logger.error(`Failed to update Router Dashboard URL for router ${router.router_id}:`, urlError.message);
      // Don't fail the whole sync if just the URL field fails
    }

    // Store the hash in database for future comparison (smart sync)
    try {
      await pool.query(
        'UPDATE routers SET last_clickup_sync_hash = $1 WHERE router_id = $2',
        [currentDataHash, router.router_id]
      );
    } catch (hashError) {
      logger.warn(`Failed to update sync hash for router ${router.router_id}:`, hashError.message);
      // Don't fail sync if hash update fails
    }

    logger.debug(`Synced router ${router.router_id}: dbStatus=${router.current_status}, isOnline=${isOnline}, lastSeen=${router.last_seen}, clickupStatus=${statusValue}`);

    return { success: true };

  } catch (error) {
    logger.error(`Error syncing router ${router.router_id} to ClickUp:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Calculate 30-day data usage for all routers at once (FAST!)
 */
async function calculateAllRouterDataUsage() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();
  
  const usageQuery = `
    WITH params AS (
      SELECT $1::timestamp AS start_ts, $2::timestamp AS end_ts
    ),
    router_list AS (
      SELECT DISTINCT router_id FROM router_logs
    ),
    base AS (
      SELECT 
        rl.router_id,
        l.total_tx_bytes AS base_tx, 
        l.total_rx_bytes AS base_rx
      FROM router_list rl
      CROSS JOIN LATERAL (
        SELECT total_tx_bytes, total_rx_bytes
        FROM router_logs, params
        WHERE router_id = rl.router_id
          AND timestamp < (SELECT start_ts FROM params)
        ORDER BY timestamp DESC
        LIMIT 1
      ) l
    ),
    ordered_logs AS (
      SELECT 
        router_id,
        total_tx_bytes,
        total_rx_bytes,
        LAG(total_tx_bytes) OVER (PARTITION BY router_id ORDER BY timestamp) as prev_tx,
        LAG(total_rx_bytes) OVER (PARTITION BY router_id ORDER BY timestamp) as prev_rx,
        FIRST_VALUE(total_tx_bytes) OVER (PARTITION BY router_id ORDER BY timestamp) as first_tx,
        FIRST_VALUE(total_rx_bytes) OVER (PARTITION BY router_id ORDER BY timestamp) as first_rx
      FROM router_logs, params
      WHERE timestamp >= (SELECT start_ts FROM params)
        AND timestamp <= (SELECT end_ts FROM params)
    ),
    deltas AS (
      SELECT
        router_id,
        SUM(CASE WHEN prev_tx IS NULL THEN 0 ELSE GREATEST(total_tx_bytes - prev_tx, 0) END) as sum_tx_deltas,
        SUM(CASE WHEN prev_rx IS NULL THEN 0 ELSE GREATEST(total_rx_bytes - prev_rx, 0) END) as sum_rx_deltas,
        MAX(first_tx) as first_tx,
        MAX(first_rx) as first_rx
      FROM ordered_logs
      GROUP BY router_id
    )
    SELECT
      d.router_id,
      (GREATEST(d.first_tx - COALESCE(b.base_tx, d.first_tx), 0) + COALESCE(d.sum_tx_deltas, 0) +
       GREATEST(d.first_rx - COALESCE(b.base_rx, d.first_rx), 0) + COALESCE(d.sum_rx_deltas, 0))::bigint as total_bytes
    FROM deltas d
    LEFT JOIN base b ON d.router_id = b.router_id
  `;
  
  try {
    const result = await pool.query(usageQuery, [thirtyDaysAgo, now]);
    const dataUsageMap = {};
    
    logger.info(`Data usage query returned ${result.rows.length} routers`);
    
    for (const row of result.rows) {
      const totalGB = parseFloat((row.total_bytes / 1024 / 1024 / 1024).toFixed(2));
      dataUsageMap[row.router_id] = totalGB;
    }
    
    // Log a few sample values
    const sampleRouters = result.rows.slice(0, 3);
    for (const sample of sampleRouters) {
      const gb = dataUsageMap[sample.router_id];
      logger.info(`Sample data usage - Router ${sample.router_id}: ${gb} GB (${sample.total_bytes} bytes)`);
    }
    
    return dataUsageMap;
  } catch (error) {
    logger.error('Error calculating bulk data usage:', error);
    return {}; // Return empty map on error
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
         r.clickup_location_task_id,
         r.clickup_location_task_name,
         r.imei, 
         r.firmware_version, 
         r.last_seen, 
         r.name,
         r.last_clickup_sync_hash,
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

    // Calculate 30-day data usage for ALL routers at once (much faster!)
    logger.info('Calculating 30-day data usage for all routers...');
    const dataUsageMap = await calculateAllRouterDataUsage();
    logger.info(`Calculated data usage for ${Object.keys(dataUsageMap).length} routers`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // Sync routers sequentially with delays to avoid ClickUp rate limits
    // ClickUp allows 100 requests/minute, so we use 700ms delay = ~85 requests/minute safely
    const DELAY_BETWEEN_ROUTERS = 700; // milliseconds between each router sync
    
    logger.info(`Syncing ${routers.length} routers sequentially with ${DELAY_BETWEEN_ROUTERS}ms delays (smart sync enabled)...`);

    for (let i = 0; i < routers.length; i++) {
      const router = routers[i];
      
      try {
        const result = await syncRouterToClickUp(router, dataUsageMap);
        
        if (result.success) {
          if (result.skipped) {
            skipped++;
          } else {
            updated++;
          }
        } else {
          errors++;
          logger.warn(`Failed to sync router ${router.router_id}: ${result.error}`);
        }
      } catch (error) {
        errors++;
        logger.warn(`Failed to sync router ${router.router_id}: ${error.message}`);
      }

      // Delay between routers to avoid rate limiting (except after last router)
      // Skip delay for skipped routers to speed up sync
      if (i < routers.length - 1 && !result?.skipped) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ROUTERS));
      }
      
      // Log progress every 10 routers
      if ((i + 1) % 10 === 0) {
        logger.info(`Progress: ${i + 1}/${routers.length} routers processed (${updated} updated, ${skipped} skipped, ${errors} errors)`);
      }
    }

    const duration = Date.now() - startTime;
    lastSyncTime = new Date();
    syncStats.totalSyncs++;
    syncStats.lastSyncUpdated = updated;
    syncStats.lastSyncSkipped = skipped;
    syncStats.lastSyncErrors = errors;
    syncStats.lastSyncDuration = duration;

    logger.info(`ClickUp sync completed: ${updated} updated, ${skipped} skipped (no changes), ${errors} errors (${duration}ms)`);

    return {
      updated,
      skipped,
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
 * SIMPLIFIED - No longer tracks assignees (removed stored_with functionality)
 */
async function syncAssigneesFromClickUp() {
  try {
    logger.info('Starting assignee sync from ClickUp...');
    const startTime = Date.now();
    let synced = 0;
    let errors = 0;

    // Get all routers with ClickUp tasks
    const result = await pool.query(`
      SELECT router_id, clickup_task_id, name
      FROM routers
      WHERE clickup_task_id IS NOT NULL
    `);

    logger.info(`Found ${result.rows.length} routers with ClickUp tasks`);

    for (const router of result.rows) {
      try {
        // Fetch the full task to get assignees
        const task = await clickupClient.getTask(router.clickup_task_id, 'default');
        
        if (task && task.assignees) {
          // Store assignees in database
          await pool.query(
            'UPDATE routers SET clickup_assignees = $1 WHERE router_id = $2',
            [JSON.stringify(task.assignees), router.router_id]
          );
          synced++;
          
          if (task.assignees.length > 0) {
            const assigneeNames = task.assignees.map(a => a.username || a.email).join(', ');
            logger.info(`Router ${router.router_id} (${router.name}): Updated assignees - ${assigneeNames}`);
          }
        }
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        errors++;
        logger.warn(`Failed to sync assignees for router ${router.router_id}:`, error.message);
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`Assignee sync complete: ${synced} synced, ${errors} errors in ${duration}ms`);

    // Invalidate the assignee cache so users see fresh data immediately
    try {
      const routerRoutes = require('../routes/router');
      if (routerRoutes.invalidateAssigneeCache) {
        routerRoutes.invalidateAssigneeCache();
      }
    } catch (err) {
      logger.warn('Could not invalidate assignee cache:', err.message);
    }

    return {
      success: true,
      synced,
      errors,
      duration
    };
  } catch (error) {
    logger.error('Assignee sync failed:', error);
    throw error;
  }
}

/**
 * Start scheduled ClickUp sync (idempotent)
 * @param {number} intervalMinutes - Interval between syncs
 * @param {boolean} runImmediately - Whether to run sync immediately on start (default: false)
 */
function startClickUpSync(intervalMinutes = 30, runImmediately = false) {
  if (syncIntervalId) {
    logger.info('ClickUp sync scheduler already running');
    return;
  }

  logger.info(`Starting ClickUp sync scheduler (every ${intervalMinutes} minutes)`);

  // Optionally run immediately on start (disabled by default to avoid delaying deployments)
  if (runImmediately) {
    logger.info('Running initial ClickUp sync...');
    syncAllRoutersToClickUp().catch(error => {
      logger.error('Initial ClickUp sync failed:', error.message);
    });
  } else {
    logger.info('Skipping initial sync - will run on schedule. All data is persistent in database.');
  }

  // Run on schedule
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
