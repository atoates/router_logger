const { upsertRouter, insertLog } = require('../models/router');
const { getCellLocation } = require('./geoService');
const { logger } = require('../config/database');

/**
 * Process incoming RUT200 telemetry data
 * Expected format matches the RUT200 Data to Server JSON structure
 */
async function processRouterTelemetry(data) {
  try {
    // Validate required fields
    if (!data.device_id) {
      throw new Error('device_id is required');
    }

    // Upsert router information
    await upsertRouter({
      router_id: data.device_id,
      device_serial: data.device_id,
      imei: data.imei,
      name: data.name,
      location: data.location,
      site_id: data.site_id,
      firmware_version: data.fw_version || data.firmware_version,
      rms_created_at: data.rms_created_at || null,
      mac_address: data.mac_address || null
    });

    // Enrich with geolocation if cell info is available
    let geoData = null;
    if (data.cell && data.mcc && data.mnc) {
      geoData = await getCellLocation({
        mcc: data.mcc,
        mnc: data.mnc,
        lac: data.cell.lac,
        tac: data.cell.tac,
        cell_id: data.cell.cid || data.cell.cell_id
      });
    }

    // Prepare log data
    const logData = {
      router_id: data.device_id,
      imei: data.imei,
      timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
      
      // WAN & Network
      wan_ip: data.wan_ip,
      operator: data.operator,
      mcc: data.mcc,
      mnc: data.mnc,
      network_type: data.network_type,
      
      // Cell Tower Info
      lac: data.cell?.lac,
      tac: data.cell?.tac,
      cell_id: data.cell?.cid || data.cell?.cell_id,
      rsrp: data.cell?.rsrp,
      rsrq: data.cell?.rsrq,
      rssi: data.cell?.rssi,
      sinr: data.cell?.sinr,
      
      // Location (enriched)
      latitude: geoData?.latitude,
      longitude: geoData?.longitude,
      location_accuracy: geoData?.accuracy,
      
  // Data Counters
      total_tx_bytes: data.counters?.total_tx_bytes || 0,
      total_rx_bytes: data.counters?.total_rx_bytes || 0,
      
      // Device Status
      uptime_seconds: data.uptime,
      firmware_version: data.fw_version || data.firmware_version,
      cpu_usage: data.cpu_usage,
      memory_free: data.memory_free,
  status: (data.status === 'online' || data.status === 1 || data.status === '1' || data.status === true) ? 'online' : 'offline',
      
      // Wi-Fi Clients
      wifi_clients: data.clients ? JSON.stringify(data.clients) : null,
      wifi_client_count: data.clients ? data.clients.length : 0,
      
      // Store raw data for reference (but without unnecessary fields)
      raw_data: JSON.stringify({
        ...data,
        iccid: undefined,
        imsi: undefined,
        cpu_temp_c: undefined,
        board_temp_c: undefined,
        input_voltage_mv: undefined,
        wan_type: undefined,
        wan_ipv6: undefined,
        vpn_status: undefined,
        vpn_name: undefined
      })
    };

    // Insert log entry
    const log = await insertLog(logData);
    logger.info(`Processed telemetry from router ${data.device_id}`);
    
    return log;
  } catch (error) {
    logger.error('Error processing telemetry:', error);
    throw error;
  }
}

/**
 * Calculate data usage delta between two log entries
 */
function calculateDataDelta(currentLog, previousLog) {
  if (!previousLog) {
    return {
      tx_delta: 0,
      rx_delta: 0,
      time_delta_seconds: 0
    };
  }

  const txDelta = Math.max(0, currentLog.total_tx_bytes - previousLog.total_tx_bytes);
  const rxDelta = Math.max(0, currentLog.total_rx_bytes - previousLog.total_rx_bytes);
  const timeDelta = Math.floor((new Date(currentLog.timestamp) - new Date(previousLog.timestamp)) / 1000);

  return {
    tx_delta: txDelta,
    rx_delta: rxDelta,
    total_delta: txDelta + rxDelta,
    time_delta_seconds: timeDelta,
    tx_rate_bps: timeDelta > 0 ? (txDelta * 8) / timeDelta : 0,
    rx_rate_bps: timeDelta > 0 ? (rxDelta * 8) / timeDelta : 0
  };
}

module.exports = {
  processRouterTelemetry,
  calculateDataDelta
};
