const RMSClient = require('./rmsClient');
const { processRouterTelemetry } = require('./telemetryProcessor');
const { getLatestLog } = require('../models/router');
const { logger } = require('../config/database');

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

  const total_tx_bytes =
    pickBytes(network, txCandidates) || pickBytes(cellular, txCandidates) || 0;
  const total_rx_bytes =
    pickBytes(network, rxCandidates) || pickBytes(cellular, rxCandidates) || 0;

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
      total_tx_bytes,
      total_rx_bytes
    },
    
    // WiFi Clients
    clients: wifi.clients || [],
    
    // System Info
    fw_version: device.firmware_version || system.firmware,
    uptime: system.uptime || 0,
    status: device.status || (monitoring?.online ? 'online' : 'offline'),

    // Extras
    iccid: cellular.iccid || cellular.sim_iccid,
    imsi: cellular.imsi,
    cpu_temp_c: system.cpu_temp || hw.cpu_temp,
    board_temp_c: system.board_temp || hw.board_temp,
    input_voltage_mv: hw.input_voltage_mv || hw.voltage_mv || system.input_voltage_mv,
    conn_uptime_seconds: network.conn_uptime || network.connection_uptime || 0,
    wan_type: network.wan_type || network.primary || network.interface,
    wan_ipv6: network.ipv6,
    vpn_status: vpn.status,
    vpn_name: vpn.name,
    eth_link_up: eth.link_up || eth.link || false
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

        // If monitoring did not provide cumulative counters, try to derive from statistics API
        const tx0 = Number(telemetry?.counters?.total_tx_bytes || 0);
        const rx0 = Number(telemetry?.counters?.total_rx_bytes || 0);
        const bothZero = (!isFinite(tx0) || tx0 === 0) && (!isFinite(rx0) || rx0 === 0);
        try {
          if (bothZero) {
            const deviceId = device.id || device.device_id || device.uuid || device.serial_number || telemetry.device_id;
            const latest = await getLatestLog(String(telemetry.device_id));
            const fromIso = latest?.timestamp ? new Date(latest.timestamp).toISOString() : new Date(Date.now() - 15 * 60 * 1000).toISOString();
            const toIso = new Date().toISOString();
            const stats = await rmsClient.getDeviceStatistics(deviceId, fromIso, toIso);
            // Normalize stats list
            const list = Array.isArray(stats) ? stats : stats?.data || stats?.items || stats?.rows || [];
            let addTx = 0, addRx = 0;
            for (const s of list) {
              const vals = typeof s === 'object' && s ? s : {};
              const tx = Number(vals.tx_bytes ?? vals.tx ?? 0);
              const rx = Number(vals.rx_bytes ?? vals.rx ?? 0);
              if (isFinite(tx)) addTx += tx;
              if (isFinite(rx)) addRx += rx;
            }
            const baseTx = latest?.total_tx_bytes ? Number(latest.total_tx_bytes) : 0;
            const baseRx = latest?.total_rx_bytes ? Number(latest.total_rx_bytes) : 0;
            telemetry.counters.total_tx_bytes = baseTx + addTx;
            telemetry.counters.total_rx_bytes = baseRx + addRx;
          }
        } catch (statsErr) {
          // Non-fatal; proceed with whatever we have
          logger.warn(`Stats fallback failed for device ${device.id}: ${statsErr.message}`);
        }
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
