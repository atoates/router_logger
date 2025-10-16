const RMSClient = require('./rmsClient');
const { processRouterTelemetry } = require('./telemetryProcessor');
const { logger } = require('../config/database');

/**
 * Transform RMS device data to our telemetry format
 */
function transformRMSDeviceToTelemetry(device, monitoring) {
  const cellular = monitoring?.cellular || monitoring?.mobile || {};
  const network = monitoring?.network || {};
  const system = monitoring?.system || {};
  const wifi = monitoring?.wifi || {};

  return {
    device_id: device.serial_number || device.id,
    imei: device.imei || cellular.imei,
    timestamp: new Date().toISOString(),
    name: device.name,
    location: device.location || device.group,
    site_id: device.group || device.company_id,
    
    // WAN & Network
    wan_ip: network.wan_ip || network.ip,
    operator: cellular.operator || cellular.network_name,
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
      total_tx_bytes: network.tx_bytes || cellular.tx_bytes || 0,
      total_rx_bytes: network.rx_bytes || cellular.rx_bytes || 0
    },
    
    // WiFi Clients
    clients: wifi.clients || [],
    
    // System Info
    fw_version: device.firmware_version || system.firmware,
    uptime: system.uptime || 0,
    status: device.status || (monitoring?.online ? 'online' : 'offline')
  };
}

/**
 * Sync data from RMS API
 */
async function syncFromRMS() {
  const accessToken = process.env.RMS_ACCESS_TOKEN;
  
  if (!accessToken) {
    logger.warn('RMS_ACCESS_TOKEN not configured, skipping RMS sync');
    return;
  }

  try {
    logger.info('Starting RMS sync...');
    const rmsClient = new RMSClient(accessToken);
    
    // Get all devices with monitoring data
    const devices = await rmsClient.getAllDevicesWithMonitoring();
    logger.info(`Fetched ${devices.length} devices from RMS`);
    
    // Process each device
    let successCount = 0;
    let errorCount = 0;
    
    for (const device of devices) {
      try {
        const telemetry = transformRMSDeviceToTelemetry(device, device.monitoring);
        await processRouterTelemetry(telemetry);
        successCount++;
      } catch (error) {
        logger.error(`Error processing device ${device.id}:`, error.message);
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

/**
 * Start scheduled RMS sync
 */
function startRMSSync(intervalMinutes = 15) {
  const intervalMs = intervalMinutes * 60 * 1000;
  
  logger.info(`Starting RMS sync scheduler (every ${intervalMinutes} minutes)`);
  
  // Run immediately on startup
  syncFromRMS().catch(error => {
    logger.error('Initial RMS sync failed:', error.message);
  });
  
  // Then run on schedule
  const intervalId = setInterval(() => {
    syncFromRMS().catch(error => {
      logger.error('Scheduled RMS sync failed:', error.message);
    });
  }, intervalMs);
  
  return intervalId;
}

module.exports = {
  syncFromRMS,
  startRMSSync,
  transformRMSDeviceToTelemetry
};
