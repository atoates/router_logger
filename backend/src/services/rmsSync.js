const RMSClient = require('./rmsClient');
const { processRouterTelemetry } = require('./telemetryProcessor');
const { getLatestLog } = require('../models/router');
const { logger } = require('../config/database');
const { isApproachingQuota, getQuotaStatus } = require('../routes/monitoring');
const distributedLockService = require('./distributedLockService');

// Throttle RMS API requests to avoid rate limiting
// Delay between processing devices (configurable via env)
const DELAY_BETWEEN_DEVICES_MS = parseInt(process.env.RMS_SYNC_DELAY_MS || '500', 10);
const INITIAL_SYNC_DELAY_MS = parseInt(process.env.RMS_INITIAL_SYNC_DELAY_MS || '2000', 10); // Longer delay for initial sync
// NOTE: RMS /monitoring endpoint does not exist (returns 404)
// Cell info must come from device list or direct telemetry from routers
const FETCH_CELL_INFO = false; // Disabled - endpoint doesn't exist

// RMS Sync Statistics Tracking
let rmsSyncStats = {
  lastSyncTime: null,
  lastSyncSuccess: 0,
  lastSyncErrors: 0,
  lastSyncTotal: 0,
  lastSyncDuration: 0,
  totalSyncs24h: 0,
  syncHistory24h: [], // Array of { timestamp, success, errors, total, duration }
  isRunning: false
};

/**
 * Sleep helper for throttling
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Transform RMS device data to our telemetry format
 */
function transformRMSDeviceToTelemetry(device, monitoring) {
  // Look for cellular data in multiple places (monitoring, device root, modem)
  const cellular = monitoring?.cellular || monitoring?.mobile || device?.cellular || device?.modem || {};
  const network = monitoring?.network || device?.network || {};
  const system = monitoring?.system || {};
  const wifi = monitoring?.wifi || {};
  const hw = monitoring?.hardware || monitoring?.device || {};
  const vpn = monitoring?.vpn || {};
  const eth = monitoring?.ethernet || {};
  
  // Debug: Log cell info at debug level
  const hasCellInfo = !!(cellular.cell_id || cellular.cid || cellular.tac || cellular.mcc);
  if (hasCellInfo) {
    logger.debug(`Cell info for ${device.serial_number || device.id}: mcc=${cellular.mcc}, mnc=${cellular.mnc}, tac=${cellular.tac}, cid=${cellular.cell_id || cellular.cid}`);
  }

  // Helper to coerce to finite number
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Try multiple candidate keys for byte counters (RMS variants differ)
  const pickBytes = (obj, keys = []) => {
    for (const k of keys) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
        const v = num(obj[k]);
        if (v > 0) return v;
      }
    }
    return 0;
  };

  const txCandidates = [
    'tx_bytes','tx','bytes_sent','data_sent','upload','bytes_out','out'
  ];
  const rxCandidates = [
    'rx_bytes','rx','bytes_received','data_received','download','bytes_in','in'
  ];

  let total_tx_bytes =
    pickBytes(network, txCandidates) || pickBytes(cellular, txCandidates) || 0;
  let total_rx_bytes =
    pickBytes(network, rxCandidates) || pickBytes(cellular, rxCandidates) || 0;

  // Fallback: some RMS endpoints provide counters on the device root (e.g., 'sent'/'received')
  if ((total_tx_bytes === 0 && total_rx_bytes === 0) || (!Number.isFinite(total_tx_bytes) && !Number.isFinite(total_rx_bytes))) {
    const rootTx = pickBytes(device, ['sent','tx','tx_bytes','upload','bytes_sent','data_sent']);
    const rootRx = pickBytes(device, ['received','rx','rx_bytes','download','bytes_received','data_received']);
    if (rootTx > 0 || rootRx > 0) {
      total_tx_bytes = rootTx;
      total_rx_bytes = rootRx;
    }
  }

  // Use RMS's last_connection/last_activity timestamp when router is online
  // This ensures each router has its actual "last seen online" time, not the sync time
  const isOnline = String(device.status || (monitoring?.online ? 'online' : 'offline')).toLowerCase() === 'online';
  const rmsTimestamp = device.last_connection || device.last_activity || device.updated_at || device.last_seen;
  const timestamp = isOnline && rmsTimestamp 
    ? new Date(rmsTimestamp).toISOString() 
    : new Date().toISOString();

  return {
  device_id: device.serial_number || device.serial || device.id,
  imei: device.imei || cellular.imei,
    timestamp,
    name: device.name,
    location: device.location || device.group,
    site_id: device.group || device.company_id,
    rms_created_at: device.created_at || device.createdAt || device.created || null,
    
    // MAC Address (for Guest WiFi router matching)
    mac_address: device.mac_address || device.mac || hw.mac_address || network.mac || wifi.mac_address || null,
    
    // WAN & Network
  wan_ip: network.wan_ip || network.ip || device.wan_ip,
  operator: cellular.operator || cellular.network_name || device.operator,
    mcc: cellular.mcc || device.mcc,
    mnc: cellular.mnc || device.mnc,
    network_type: cellular.network_type || cellular.connection_type || device.network_type,
    
    // Cell Tower Info (check both cellular object and device root)
    cell: {
      lac: cellular.lac || device.lac,
      tac: cellular.tac || device.tac,
      cid: cellular.cell_id || cellular.cid || device.cell_id,
      rsrp: cellular.rsrp || device.rsrp,
      rsrq: cellular.rsrq || device.rsrq,
      rssi: cellular.rssi || device.rssi || device.signal_strength,
      sinr: cellular.sinr || device.sinr,
      earfcn: cellular.earfcn || device.earfcn,
      pc_id: cellular.pc_id || cellular.pci || cellular.phys_cell_id || device.pci
    },
    
    // Data Counters
    counters: {
      total_tx_bytes,
      total_rx_bytes
    },
    
    // WiFi Clients
    clients: wifi.clients || [],
    
    // System Info
  fw_version: device.firmware_version || device.firmware || system.firmware,
    uptime: system.uptime || 0,
    status: device.status || (monitoring?.online ? 'online' : 'offline'),

    // Extras (reduced)
    conn_uptime_seconds: network.conn_uptime || network.connection_uptime || 0,
    eth_link_up: eth.link_up || eth.link || false
  };
}

// Mutex to prevent concurrent syncs
let isSyncing = false;

/**
 * Sync data from RMS API
 */
async function syncFromRMS() {
  // Prevent overlapping syncs
  if (isSyncing) {
    logger.warn('RMS sync already in progress, skipping this run');
    return { skipped: true, reason: 'Already syncing' };
  }

  isSyncing = true;
  rmsSyncStats.isRunning = true;
  const startTime = Date.now();
  const syncId = Date.now().toString(36);

  try {
    logger.info(`[SYNC ${syncId}] ========== Starting RMS sync at ${new Date().toISOString()} ==========`);
    
    // Reset debug logging flag for this sync
    transformRMSDeviceToTelemetry._logged = false;
    
    // Check if we're approaching quota limit before starting sync
    if (isApproachingQuota()) {
      const quotaStatus = getQuotaStatus();
      logger.warn(`Skipping RMS sync - approaching quota limit: ${quotaStatus.percentage.toFixed(1)}% (${quotaStatus.estimate.toLocaleString()} estimated monthly calls)`);
      return { skipped: true, reason: 'Quota limit' };
    }
    
    // Use OAuth token if available, fallback to PAT
    const rmsClient = await RMSClient.createWithAuth();
    
    // Get all devices with monitoring data
    const fetchStart = Date.now();
    const devices = await rmsClient.getAllDevicesWithMonitoring();
    const fetchDuration = Date.now() - fetchStart;
    logger.info(`[SYNC ${syncId}] Fetched ${devices.length} devices from RMS in ${fetchDuration}ms`);
    
    // Process each device
    let successCount = 0;
    let errorCount = 0;
    let rateLimitHit = false;
    
    for (const device of devices) {
      // Circuit breaker: stop processing if rate limit hit
      if (rateLimitHit) {
        logger.error('Rate limit detected earlier in sync, aborting remaining devices to conserve quota');
        break;
      }
      
      try {
        // Throttle requests to avoid rate limiting
        // Use longer delay for initial sync when fetching stats
        if (successCount > 0 || errorCount > 0) {
          const latest = await getLatestLog(String(device.id || device.device_id || device.serial_number));
          const isInitialDevice = !latest || (!latest.total_tx_bytes && !latest.total_rx_bytes);
          const delay = isInitialDevice ? INITIAL_SYNC_DELAY_MS : DELAY_BETWEEN_DEVICES_MS;
          await sleep(delay);
        }
        
        // Optionally fetch full monitoring data for cell info (uses API quota)
        let monitoringData = device.monitoring;
        if (FETCH_CELL_INFO) {
          const deviceId = device.id || device.device_id || device.serial_number;
          const fullMonitoring = await rmsClient.getDeviceMonitoring(deviceId);
          if (fullMonitoring) {
            monitoringData = fullMonitoring;
          }
        }
        
        const telemetry = transformRMSDeviceToTelemetry(device, monitoringData);
        const deviceName = device.name || `Device ${device.id}`;

        // If monitoring did not provide cumulative counters, try to derive from statistics API
        // If counters are zero, use last known values from database
        const tx0 = Number(telemetry?.counters?.total_tx_bytes || 0);
        const rx0 = Number(telemetry?.counters?.total_rx_bytes || 0);
        const bothZero = (!isFinite(tx0) || tx0 === 0) && (!isFinite(rx0) || rx0 === 0);
        
        if (bothZero) {
          // Device reports zero counters - use last known values from database
          const latest = await getLatestLog(String(telemetry.device_id));
          const lastTx = latest?.total_tx_bytes ? Number(latest.total_tx_bytes) : 0;
          const lastRx = latest?.total_rx_bytes ? Number(latest.total_rx_bytes) : 0;
          
          telemetry.counters.total_tx_bytes = lastTx;
          telemetry.counters.total_rx_bytes = lastRx;
          
          logger.debug(`[SYNC ${syncId}] ${deviceName}: Zero counters → DB fallback: tx=${(lastTx/1024/1024).toFixed(2)}MB, rx=${(lastRx/1024/1024).toFixed(2)}MB`);
        } else {
          logger.debug(`[SYNC ${syncId}] ${deviceName}: tx=${(tx0/1024/1024).toFixed(2)}MB, rx=${(rx0/1024/1024).toFixed(2)}MB, status=${telemetry.status}`);
        }
        
        await processRouterTelemetry(telemetry);
        successCount++;
        
        // Log progress every 25 devices
        if (successCount % 25 === 0) {
          logger.info(`[SYNC ${syncId}] Progress: ${successCount}/${devices.length} devices processed`);
        }
      } catch (error) {
        // Special handling for rate limits
        if (error.response?.status === 429) {
          const deviceName = device.name || `Device ${device.id}`;
          logger.error(`[SYNC ${syncId}] RATE LIMIT HIT on ${deviceName}. Stopping sync immediately to conserve quota.`);
          rateLimitHit = true;
          errorCount++;
          break; // Stop processing remaining devices
        } else {
          const deviceName = device.name || `Device ${device.id}`;
          logger.error(`[SYNC ${syncId}] ERROR processing ${deviceName}: ${error.message}`);
        }
        errorCount++;
      }
    }
    
    const duration = Date.now() - startTime;
    const avgTimePerDevice = devices.length > 0 ? (duration / devices.length).toFixed(0) : 0;
    const successRate = ((successCount / devices.length) * 100).toFixed(1);
    
    logger.info(`[SYNC ${syncId}] ========== Sync Complete ==========`);
    logger.info(`[SYNC ${syncId}] Total devices: ${devices.length}`);
    logger.info(`[SYNC ${syncId}] Successful: ${successCount} (${successRate}%)`);
    logger.info(`[SYNC ${syncId}] Errors: ${errorCount}`);
    logger.info(`[SYNC ${syncId}] Duration: ${duration}ms (${avgTimePerDevice}ms/device)`);
    logger.info(`[SYNC ${syncId}] Timestamp: ${new Date().toISOString()}`);
    logger.info(`[SYNC ${syncId}] =====================================`);
    
    // Update sync statistics
    const now = new Date();
    rmsSyncStats.lastSyncTime = now;
    rmsSyncStats.lastSyncSuccess = successCount;
    rmsSyncStats.lastSyncErrors = errorCount;
    rmsSyncStats.lastSyncTotal = devices.length;
    rmsSyncStats.lastSyncDuration = duration;
    
    // Add to 24-hour history
    rmsSyncStats.syncHistory24h.push({
      timestamp: now,
      success: successCount,
      errors: errorCount,
      total: devices.length,
      duration
    });
    
    // Keep only last 24 hours of history
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    rmsSyncStats.syncHistory24h = rmsSyncStats.syncHistory24h.filter(
      sync => new Date(sync.timestamp).getTime() > twentyFourHoursAgo
    );
    
    rmsSyncStats.totalSyncs24h = rmsSyncStats.syncHistory24h.length;
    
    // Auto-merge any duplicate routers that may have been created
    // This handles cases where RMS changes serial numbers for existing routers
    let duplicatesMerged = 0;
    try {
      const { autoMergeDuplicatesIfNeeded } = require('../models/routerMaintenance');
      const mergeResult = await autoMergeDuplicatesIfNeeded();
      duplicatesMerged = mergeResult.routersMerged || 0;
    } catch (mergeError) {
      logger.warn('Failed to auto-merge duplicates (RMS sync still successful):', mergeError.message);
    }
    
    // Auto-create ClickUp tasks for any new routers without tasks
    // This runs after RMS sync completes to ensure new routers get tasks
    let clickupTasksCreated = 0;
    try {
      const { createMissingClickUpTasks } = require('./clickupSync');
      const clickupResult = await createMissingClickUpTasks();
      clickupTasksCreated = clickupResult.created || 0;
      if (clickupTasksCreated > 0) {
        logger.info(`Auto-created ${clickupTasksCreated} ClickUp tasks for new routers`);
      }
    } catch (clickupError) {
      logger.warn('Failed to auto-create ClickUp tasks (RMS sync still successful):', clickupError.message);
    }
    
    return { successCount, errorCount, total: devices.length, duration, clickupTasksCreated, duplicatesMerged };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`[SYNC ${syncId}] ========== SYNC FAILED ==========`);
    logger.error(`[SYNC ${syncId}] Error: ${error.message}`);
    logger.error(`[SYNC ${syncId}] Duration before failure: ${duration}ms`);
    logger.error(`[SYNC ${syncId}] =====================================`);
    
    // Track failed sync
    const now = new Date();
    rmsSyncStats.lastSyncTime = now;
    rmsSyncStats.lastSyncErrors = 1;
    rmsSyncStats.lastSyncSuccess = 0;
    rmsSyncStats.lastSyncTotal = 0;
    rmsSyncStats.lastSyncDuration = duration;
    
    throw error;
  } finally {
    isSyncing = false;
    rmsSyncStats.isRunning = false;
  }
}

// Keep a singleton interval so we don't start duplicates
let syncIntervalId = null;

/**
 * Start scheduled RMS sync (idempotent)
 */
async function startRMSSync(intervalMinutes = 15) {
  if (syncIntervalId) {
    logger.info('RMS sync scheduler already running');
    return syncIntervalId;
  }

  // Distributed singleton: only one instance should run RMS sync
  // Use stale-lock detection to automatically release locks from dead containers
  let acquired = await distributedLockService.tryAcquireWithStaleCheck('scheduler:rms_sync');
  
  if (!acquired) {
    // Wait 10 seconds and try again with stale check - covers deployment race conditions
    logger.info('RMS sync lock held by another instance, retrying in 10 seconds with stale-lock check...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    acquired = await distributedLockService.tryAcquireWithStaleCheck('scheduler:rms_sync');
  }
  
  if (!acquired) {
    logger.warn('RMS sync scheduler not started on this instance (lock held by active instance)');
    return null;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  logger.info(`Starting RMS sync scheduler (every ${intervalMinutes} minutes)`);

  // Run shortly after startup (delayed to not block server initialization)
  setTimeout(() => {
    logger.info('⏰ SCHEDULER: Triggering initial RMS sync (5s after startup)...');
    syncFromRMS().catch(error => {
      logger.error('⚠️  SCHEDULER: Initial RMS sync failed:', error.message);
    });
  }, 5000); // 5 second delay

  // Then run on schedule
  syncIntervalId = setInterval(async () => {
    const nextRun = new Date(Date.now() + intervalMs);
    logger.info(`⏰ SCHEDULER: Triggering scheduled RMS sync (next run at ${nextRun.toLocaleTimeString()})`);
    try {
      await syncFromRMS();
    } catch (error) {
      logger.error('⚠️  SCHEDULER: Scheduled RMS sync failed:', error.message, error.stack);
      // Don't let errors stop future syncs - the interval continues
    }
  }, intervalMs);

  return syncIntervalId;
}

function isRMSSyncRunning() {
  return !!syncIntervalId;
}

function getRMSSyncStats() {
  return {
    ...rmsSyncStats,
    syncHistory24h: rmsSyncStats.syncHistory24h.map(sync => ({
      ...sync,
      timestamp: sync.timestamp
    }))
  };
}

module.exports = {
  syncFromRMS,
  startRMSSync,
  isRMSSyncRunning,
  getRMSSyncStats,
  transformRMSDeviceToTelemetry
};
