const { upsertRouter, insertLog, updateRouterLastSeen, getLatestLog } = require('../models/router');
const { getCellLocation } = require('./geoService');
const { logger, pool } = require('../config/database');
const clickupClient = require('./clickupClient');

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

    // Get previous status to detect changes
    const previousLog = await getLatestLog(data.device_id);
    const previousStatus = previousLog?.status || null;
    const newStatus = logData.status;
    
    // Normalize status values for comparison
    const normalizeStatus = (status) => {
      if (!status) return null;
      const s = String(status).toLowerCase();
      return (s === 'online' || s === '1' || s === 'true') ? 'online' : 'offline';
    };
    
    const prevStatusNormalized = normalizeStatus(previousStatus);
    const newStatusNormalized = normalizeStatus(newStatus);
    
    // Insert log entry
    const log = await insertLog(logData);
    
    // Update router's last_seen to use the log's timestamp only if status is online
    // This ensures last_seen reflects when the router was actually functioning/online
    if (newStatusNormalized === 'online') {
      await updateRouterLastSeen(data.device_id, logData.timestamp);
    }
    
    // Check if status changed between online and offline
    if (prevStatusNormalized && newStatusNormalized && prevStatusNormalized !== newStatusNormalized) {
      // Status changed - add comment to ClickUp task AND update Operational Status field immediately
      try {
        // Get router's ClickUp task ID
        const routerResult = await pool.query(
          'SELECT clickup_task_id FROM routers WHERE router_id = $1',
          [data.device_id]
        );
        
        if (routerResult.rows.length > 0 && routerResult.rows[0].clickup_task_id) {
          const clickupTaskId = routerResult.rows[0].clickup_task_id;
          
          const statusEmoji = newStatusNormalized === 'online' ? '🟢' : '🔴';
          const statusText = newStatusNormalized === 'online' ? 'Online' : 'Offline';
          const previousStatusText = prevStatusNormalized === 'online' ? 'Online' : 'Offline';
          
          const commentText = `${statusEmoji} **System:** Router status changed\n\n` +
            `**Previous:** ${previousStatusText}\n` +
            `**Current:** ${statusText}\n\n` +
            `🕐 Changed at: ${new Date(logData.timestamp).toLocaleString()}`;
          
          // Post comment to ClickUp
          await clickupClient.createTaskComment(
            clickupTaskId,
            commentText,
            { notifyAll: false },
            'default'
          );
          
          logger.info('Added status change comment to router task', {
            routerId: data.device_id,
            clickupTaskId,
            previousStatus: prevStatusNormalized,
            newStatus: newStatusNormalized
          });
          
          // IMMEDIATELY update Operational Status custom field in ClickUp
          // Don't wait for the scheduled sync - status changes should be reflected in real-time
          try {
            const { CLICKUP_FIELD_IDS } = require('../config/constants');
            const STATUS_OPTIONS = {
              ONLINE: 0,
              OFFLINE: 1
            };
            
            const statusValue = newStatusNormalized === 'online' ? STATUS_OPTIONS.ONLINE : STATUS_OPTIONS.OFFLINE;
            
            await clickupClient.updateCustomField(
              clickupTaskId,
              CLICKUP_FIELD_IDS.OPERATIONAL_STATUS,
              statusValue,
              'default'
            );
            
            logger.info('Immediately updated Operational Status field in ClickUp', {
              routerId: data.device_id,
              clickupTaskId,
              newStatus: statusText,
              fieldValue: statusValue
            });
          } catch (fieldError) {
            logger.warn('Failed to update Operational Status field (comment still posted)', {
              routerId: data.device_id,
              error: fieldError.message
            });
            // Don't fail if just the custom field update fails
          }
        }
      } catch (commentError) {
        logger.warn('Failed to add status change comment (telemetry still processed)', {
          routerId: data.device_id,
          error: commentError.message
        });
        // Don't fail the telemetry processing if comment fails
      }
    }
    
    logger.info(`Processed telemetry from router ${data.device_id}, last_seen updated to ${logData.timestamp}`);
    
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
