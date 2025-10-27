const RMSClient = require('./rmsClient');
const { processRouterTelemetry } = require('./telemetryProcessor');
const { getLatestLog } = require('../models/router');
const { logger } = require('../config/database');
const { isApproachingQuota, getQuotaStatus } = require('../routes/monitoring');

// Throttle RMS API requests to avoid rate limiting
// Delay between processing devices (configurable via env)
const DELAY_BETWEEN_DEVICES_MS = parseInt(process.env.RMS_SYNC_DELAY_MS || '500', 10);
const INITIAL_SYNC_DELAY_MS = parseInt(process.env.RMS_INITIAL_SYNC_DELAY_MS || '2000', 10); // Longer delay for initial sync

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
  const cellular = monitoring?.cellular || monitoring?.mobile || {};
  const network = monitoring?.network || {};
  const system = monitoring?.system || {};
  const wifi = monitoring?.wifi || {};
  const hw = monitoring?.hardware || monitoring?.device || {};
  const vpn = monitoring?.vpn || {};
  const eth = monitoring?.ethernet || {};

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

  return {
  device_id: device.serial_number || device.serial || device.id,
  imei: device.imei || cellular.imei,
    timestamp: new Date().toISOString(),
    name: device.name,
    location: device.location || device.group,
    site_id: device.group || device.company_id,
    rms_created_at: device.created_at || device.createdAt || device.created || null,
    
    // WAN & Network
  wan_ip: network.wan_ip || network.ip || device.wan_ip,
  operator: cellular.operator || cellular.network_name || device.operator,
    mcc: cellular.mcc,
    mnc: cellular.mnc,
    network_type: cellular.network_type || cellular.connection_type,
    
    // Cell Tower Info
    cell: {
      lac: cellular.lac,
      tac: cellular.tac,
      cid: cellular.cell_id || cellular.cid,
      rsrp: cellular.rsrp,
      rsrq: cellular.rsrq,
      rssi: cellular.rssi,
      sinr: cellular.sinr
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

/**
 * Sync data from RMS API
 */
async function syncFromRMS() {
  try {
    logger.info('Starting RMS sync...');
    
    // Check if we're approaching quota limit before starting sync
    if (isApproachingQuota()) {
      const quotaStatus = getQuotaStatus();
      logger.warn(`Skipping RMS sync - approaching quota limit: ${quotaStatus.percentage.toFixed(1)}% (${quotaStatus.estimate.toLocaleString()} estimated monthly calls)`);
      return;
    }
    
    // Use OAuth token if available, fallback to PAT
    const rmsClient = await RMSClient.createWithAuth();
    
    // Get all devices with monitoring data
    const devices = await rmsClient.getAllDevicesWithMonitoring();
    logger.info(`Fetched ${devices.length} devices from RMS`);
    
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
        
        const telemetry = transformRMSDeviceToTelemetry(device, device.monitoring);

        // If monitoring did not provide cumulative counters, try to derive from statistics API
        // BUT: Only do this if we have no previous data to avoid wasting API quota
        const tx0 = Number(telemetry?.counters?.total_tx_bytes || 0);
        const rx0 = Number(telemetry?.counters?.total_rx_bytes || 0);
        const bothZero = (!isFinite(tx0) || tx0 === 0) && (!isFinite(rx0) || rx0 === 0);
        
        if (bothZero) {
          try {
            const deviceId = device.id || device.device_id || device.uuid || device.serial_number || telemetry.device_id;
            const latest = await getLatestLog(String(telemetry.device_id));
            
            // Only fetch stats if we have NO previous data at all
            // This saves API quota after initial sync
            if (!latest || (!latest.total_tx_bytes && !latest.total_rx_bytes)) {
              logger.info(`No previous data for device ${deviceId}, fetching initial statistics`);
              const fromIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
              const toIso = new Date().toISOString();
              
              // Try data-usage endpoint first (most reliable for usage totals)
              let usageData = null;
              try {
                logger.info(`Attempting data-usage fetch for device ${deviceId} from ${fromIso} to ${toIso}`);
                usageData = await rmsClient.getDeviceDataUsage(deviceId, fromIso, toIso);
                logger.info(`Data-usage response for ${deviceId}: ${usageData ? JSON.stringify(usageData).substring(0, 500) : 'null'}`);
              } catch (e) {
                logger.warn(`Data usage fetch failed for device ${deviceId}: ${e.message}`);
              }

              let addTx = 0, addRx = 0;
              
              if (usageData) {
                // Parse data-usage response (may be array of records or summary object)
                const records = Array.isArray(usageData) ? usageData : (usageData?.data || usageData?.items || usageData?.records || []);
                if (Array.isArray(records)) {
                  for (const rec of records) {
                    const vals = typeof rec === 'object' && rec ? rec : {};
                    const sent = Number(vals.sent || vals.tx || vals.tx_bytes || vals.upload || vals.data_sent || 0);
                    const received = Number(vals.received || vals.rx || vals.rx_bytes || vals.download || vals.data_received || 0);
                    if (isFinite(sent)) addTx += sent;
                    if (isFinite(received)) addRx += received;
                  }
                } else if (typeof usageData === 'object' && usageData) {
                  // If response is a summary object
                  const sent = Number(usageData.sent || usageData.tx || usageData.tx_bytes || usageData.upload || usageData.total_sent || 0);
                  const received = Number(usageData.received || usageData.rx || usageData.rx_bytes || usageData.download || usageData.total_received || 0);
                  if (isFinite(sent)) addTx = sent;
                  if (isFinite(received)) addRx = received;
                }
                logger.info(`Parsed usage for ${deviceId}: addTx=${addTx}, addRx=${addRx}`);
              }

              // Fallback to statistics if data-usage was empty
              if (addTx === 0 && addRx === 0) {
                let stats = await rmsClient.getDeviceStatistics(deviceId, fromIso, toIso);
                if (!stats || (Array.isArray(stats) && stats.length === 0)) {
                  // company-level fallback (uses site/company IDs when present)
                  const companyId = device.company_id || device.companyId || telemetry.site_id;
                  if (companyId) {
                    try {
                      stats = await rmsClient.getCompanyDeviceStatistics(companyId, deviceId, fromIso, toIso);
                    } catch (e) {
                      logger.warn(`Company stats fallback failed for device ${deviceId}: ${e.message}`);
                    }
                  }
                }
                // Normalize stats list
                const list = Array.isArray(stats) ? stats : stats?.data || stats?.items || stats?.rows || [];
                for (const s of list) {
                  const vals = typeof s === 'object' && s ? s : {};
                  const tx = Number(vals.tx_bytes ?? vals.tx ?? 0);
                  const rx = Number(vals.rx_bytes ?? vals.rx ?? 0);
                  if (isFinite(tx)) addTx += tx;
                  if (isFinite(rx)) addRx += rx;
                }
              }

              const baseTx = latest?.total_tx_bytes ? Number(latest.total_tx_bytes) : 0;
              const baseRx = latest?.total_rx_bytes ? Number(latest.total_rx_bytes) : 0;
              telemetry.counters.total_tx_bytes = baseTx + addTx;
              telemetry.counters.total_rx_bytes = baseRx + addRx;
              logger.info(`Final counters for ${deviceId}: TX=${telemetry.counters.total_tx_bytes}, RX=${telemetry.counters.total_rx_bytes}`);
            } else {
              // We have previous data, use it as baseline to save API quota
              logger.info(`Using previous data for device ${device.id}, skipping stats API calls to conserve quota`);
              const baseTx = latest?.total_tx_bytes ? Number(latest.total_tx_bytes) : 0;
              const baseRx = latest?.total_rx_bytes ? Number(latest.total_rx_bytes) : 0;
              telemetry.counters.total_tx_bytes = baseTx;
              telemetry.counters.total_rx_bytes = baseRx;
            }
          } catch (statsErr) {
            // Non-fatal; proceed with whatever we have
            // If it's a rate limit error, set flag and abort sync
            if (statsErr.response?.status === 429) {
              logger.error(`Rate limit hit during stats fetch for device ${device.id}. Aborting sync to prevent quota exhaustion.`);
              rateLimitHit = true;
              throw statsErr; // Re-throw to trigger outer catch and stop sync
            } else {
              logger.warn(`Stats fallback failed for device ${device.id}: ${statsErr.message}`);
            }
          }
        }
        
        await processRouterTelemetry(telemetry);
        successCount++;
      } catch (error) {
        // Special handling for rate limits
        if (error.response?.status === 429) {
          logger.error(`Rate limit error processing device ${device.id}. Stopping sync immediately to conserve quota.`);
          rateLimitHit = true;
          errorCount++;
          break; // Stop processing remaining devices
        } else {
          logger.error(`Error processing device ${device.id}:`, error.message);
        }
        errorCount++;
      }
    }
    
    logger.info(`RMS sync complete: ${successCount} successful, ${errorCount} errors`);
    return { successCount, errorCount, total: devices.length };
  } catch (error) {
    logger.error('RMS sync failed:', error.message);
    throw error;
  }
}

// Keep a singleton interval so we don't start duplicates
let syncIntervalId = null;

/**
 * Start scheduled RMS sync (idempotent)
 */
function startRMSSync(intervalMinutes = 15) {
  if (syncIntervalId) {
    logger.info('RMS sync scheduler already running');
    return syncIntervalId;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  logger.info(`Starting RMS sync scheduler (every ${intervalMinutes} minutes)`);

  // Run immediately on startup
  syncFromRMS().catch(error => {
    logger.error('Initial RMS sync failed:', error.message);
  });

  // Then run on schedule
  syncIntervalId = setInterval(() => {
    syncFromRMS().catch(error => {
      logger.error('Scheduled RMS sync failed:', error.message);
    });
  }, intervalMs);

  return syncIntervalId;
}

function isRMSSyncRunning() {
  return !!syncIntervalId;
}

module.exports = {
  syncFromRMS,
  startRMSSync,
  isRMSSyncRunning,
  transformRMSDeviceToTelemetry
};
