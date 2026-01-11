const { upsertRouter, insertLog, updateRouterLastSeen, getLatestLog } = require('../models/router');
const { getCellLocation } = require('./geoService');
const { logger, pool } = require('../config/database');
const clickupClient = require('./clickupClient');

// Track last geolocation lookup time per router (in-memory, 24h throttle)
const lastGeoLookup = new Map();
const GEO_LOOKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Distance threshold for "significant" location change (in meters)
const LOCATION_CHANGE_THRESHOLD_METERS = 500;

// Track disconnection events for frequent disconnection alerts
// Map: router_id -> { events: [{timestamp}], lastAlertTime }
const disconnectionTracker = new Map();
const DISCONNECTION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const DISCONNECTION_THRESHOLD = 5; // Alert after 5 disconnections in 24h
const DISCONNECTION_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // Only alert once per 24h

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Get the current active location for a router
 */
async function getActiveLocation(routerId) {
  try {
    const result = await pool.query(`
      SELECT id, latitude, longitude, accuracy, cell_id, started_at
      FROM router_locations 
      WHERE router_id = $1 AND ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1
    `, [routerId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.warn('Error fetching active location:', { error: error.message });
    return null;
  }
}

/**
 * Create or update location record based on whether location has changed
 */
async function updateLocationRecord(routerId, geoData, cellInfo) {
  if (!geoData || !geoData.latitude || !geoData.longitude) {
    return null;
  }
  
  try {
    const activeLocation = await getActiveLocation(routerId);
    
    if (activeLocation) {
      // Calculate distance from current location
      const distance = calculateDistance(
        parseFloat(activeLocation.latitude),
        parseFloat(activeLocation.longitude),
        geoData.latitude,
        geoData.longitude
      );
      
      if (distance < LOCATION_CHANGE_THRESHOLD_METERS) {
        // Same location - increment sample count and update timestamp
        await pool.query(`
          UPDATE router_locations 
          SET sample_count = sample_count + 1, 
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [activeLocation.id]);
        
        logger.debug(`Location unchanged for ${routerId} (distance: ${Math.round(distance)}m)`);
        return { type: 'unchanged', locationId: activeLocation.id, distance };
      } else {
        // Location changed - close old record and create new one
        await pool.query(`
          UPDATE router_locations 
          SET ended_at = CURRENT_TIMESTAMP, 
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [activeLocation.id]);
        
        logger.info(`Location changed for ${routerId}: ${Math.round(distance)}m from previous`);
      }
    }
    
    // Create new location record
    const result = await pool.query(`
      INSERT INTO router_locations (
        router_id, latitude, longitude, accuracy,
        cell_id, tac, lac, mcc, mnc, operator, network_type,
        started_at, sample_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, 1)
      RETURNING id
    `, [
      routerId,
      geoData.latitude,
      geoData.longitude,
      geoData.accuracy,
      cellInfo?.cell_id,
      cellInfo?.tac,
      cellInfo?.lac,
      cellInfo?.mcc,
      cellInfo?.mnc,
      cellInfo?.operator,
      cellInfo?.network_type
    ]);
    
    logger.info(`New location recorded for ${routerId}: ${geoData.latitude}, ${geoData.longitude}`);
    return { type: 'new', locationId: result.rows[0].id };
    
  } catch (error) {
    logger.error('Error updating location record:', { error: error.message, routerId });
    return null;
  }
}

/**
 * Check if we should do a geolocation lookup for this router
 * Returns true if 24h has passed since last lookup OR if we have no location data
 */
async function shouldDoGeoLookup(routerId) {
  // Check in-memory cache first
  const lastLookup = lastGeoLookup.get(routerId);
  if (lastLookup && Date.now() - lastLookup < GEO_LOOKUP_INTERVAL_MS) {
    return false; // Too recent
  }
  
  // Check if we already have recent location data in DB
  try {
    const result = await pool.query(`
      SELECT latitude, longitude, timestamp 
      FROM router_logs 
      WHERE router_id = $1 
        AND latitude IS NOT NULL 
        AND longitude IS NOT NULL
      ORDER BY timestamp DESC 
      LIMIT 1
    `, [routerId]);
    
    if (result.rows.length > 0) {
      const lastLocationTime = new Date(result.rows[0].timestamp).getTime();
      if (Date.now() - lastLocationTime < GEO_LOOKUP_INTERVAL_MS) {
        // Update in-memory cache
        lastGeoLookup.set(routerId, lastLocationTime);
        return false; // Have recent location
      }
    }
  } catch (error) {
    logger.warn('Error checking last location time:', { error: error.message });
  }
  
  return true; // Do the lookup
}

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

    // Enrich with geolocation if cell info is available (throttled to once per 24h)
    let geoData = null;
    if (data.cell && data.mcc && data.mnc) {
      const shouldLookup = await shouldDoGeoLookup(data.device_id);
      
      if (shouldLookup) {
        geoData = await getCellLocation({
          mcc: data.mcc,
          mnc: data.mnc,
          lac: data.cell.lac,
          tac: data.cell.tac,
          cell_id: data.cell.cid || data.cell.cell_id,
          // Additional params for better accuracy
          network_type: data.network_type,
          rsrp: data.cell.rsrp,
          pci: data.cell.pc_id || data.cell.pci || data.cell.phys_cell_id,
          earfcn: data.cell.earfcn
        });
        
        if (geoData) {
          // Update in-memory cache
          lastGeoLookup.set(data.device_id, Date.now());
          logger.info(`Geolocation updated for ${data.device_id}: ${geoData.latitude}, ${geoData.longitude}`);
          
          // Update location tracking table (handles change detection)
          await updateLocationRecord(data.device_id, geoData, {
            cell_id: data.cell?.cid || data.cell?.cell_id,
            tac: data.cell?.tac,
            lac: data.cell?.lac,
            mcc: data.mcc,
            mnc: data.mnc,
            operator: data.operator,
            network_type: data.network_type
          });
        }
      } else {
        logger.debug(`Skipping geolocation for ${data.device_id} (within 24h throttle)`);
      }
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
      earfcn: data.cell?.earfcn,
      pc_id: data.cell?.pc_id || data.cell?.pci || data.cell?.phys_cell_id,
      
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
    
    // Update router's last_seen ONLY when status is online
    // This ensures the "Last Online" field in ClickUp shows when router was actually functioning
    if (newStatusNormalized === 'online') {
      await updateRouterLastSeen(data.device_id, logData.timestamp);
    }
    
    // Check if status changed between online and offline
    if (prevStatusNormalized && newStatusNormalized && prevStatusNormalized !== newStatusNormalized) {
      // Status changed - handle ClickUp notifications
      try {
        // Get router's ClickUp task ID
        const routerResult = await pool.query(
          'SELECT clickup_task_id FROM routers WHERE router_id = $1',
          [data.device_id]
        );
        
        if (routerResult.rows.length > 0 && routerResult.rows[0].clickup_task_id) {
          const clickupTaskId = routerResult.rows[0].clickup_task_id;
          const routerId = data.device_id;
          
          if (newStatusNormalized === 'online') {
            // Router came back online - post notification immediately
            const commentText = `🟢 **System:** Router status changed\n\n` +
              `**Previous:** Offline\n` +
              `**Current:** Online\n\n` +
              `🕐 Changed at: ${new Date(logData.timestamp).toLocaleString()}`;
            
            await clickupClient.createTaskComment(
              clickupTaskId,
              commentText,
              { notifyAll: false },
              'default'
            );
            
            logger.info('Added online status comment to router task', {
              routerId,
              clickupTaskId
            });
            
          } else {
            // Router went offline - post notification immediately
            const commentText = `🔴 **System:** Router status changed\n\n` +
              `**Previous:** Online\n` +
              `**Current:** Offline\n\n` +
              `🕐 Changed at: ${new Date(logData.timestamp).toLocaleString()}`;
            
            await clickupClient.createTaskComment(
              clickupTaskId,
              commentText,
              { notifyAll: false },
              'default'
            );
            
            logger.info('Added offline status comment to router task', {
              routerId,
              clickupTaskId
            });
          }
          
          // IMMEDIATELY update Operational Status custom field in ClickUp
          // This always happens regardless of comment delay
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
              newStatus: newStatusNormalized,
              fieldValue: statusValue
            });
          } catch (fieldError) {
            logger.warn('Failed to update Operational Status field', {
              routerId: data.device_id,
              error: fieldError.message
            });
            // Don't fail if just the custom field update fails
          }
        }
      } catch (commentError) {
        logger.warn('Failed to handle status change notification (telemetry still processed)', {
          routerId: data.device_id,
          error: commentError.message
        });
        // Don't fail the telemetry processing if comment fails
      }
      
      // Track disconnection for frequent disconnection alerts
      if (newStatusNormalized === 'offline' && prevStatusNormalized === 'online') {
        trackDisconnection(data.device_id);
      }
    }
    
    // Check for cell tower change
    if (previousLog && logData.cell_id && previousLog.cell_id && logData.cell_id !== previousLog.cell_id) {
      await postCellTowerChangeComment(data.device_id, previousLog.cell_id, logData.cell_id, logData.operator);
    }
    
    // Check for operator change
    if (previousLog && logData.operator && previousLog.operator && 
        logData.operator !== previousLog.operator && 
        previousLog.operator !== 'Unknown' && logData.operator !== 'Unknown') {
      await postOperatorChangeComment(data.device_id, previousLog.operator, logData.operator);
    }
    
    // Check for frequent disconnections alert
    await checkFrequentDisconnections(data.device_id);
    
    logger.info(`Processed telemetry from router ${data.device_id}, last_seen updated to ${logData.timestamp}`);
    
    return log;
  } catch (error) {
    logger.error('Error processing telemetry:', error);
    throw error;
  }
}

/**
 * Track a disconnection event for a router
 */
function trackDisconnection(routerId) {
  const now = Date.now();
  let tracker = disconnectionTracker.get(routerId);
  
  if (!tracker) {
    tracker = { events: [], lastAlertTime: 0 };
    disconnectionTracker.set(routerId, tracker);
  }
  
  // Add new event
  tracker.events.push({ timestamp: now });
  
  // Clean up old events outside the window
  tracker.events = tracker.events.filter(e => now - e.timestamp < DISCONNECTION_WINDOW_MS);
  
  logger.debug(`Tracked disconnection for ${routerId}, total in window: ${tracker.events.length}`);
}

/**
 * Check if a router has frequent disconnections and post alert
 */
async function checkFrequentDisconnections(routerId) {
  const tracker = disconnectionTracker.get(routerId);
  if (!tracker) return;
  
  const now = Date.now();
  const recentEvents = tracker.events.filter(e => now - e.timestamp < DISCONNECTION_WINDOW_MS);
  
  // Check if threshold exceeded and cooldown has passed
  if (recentEvents.length >= DISCONNECTION_THRESHOLD && 
      now - tracker.lastAlertTime > DISCONNECTION_ALERT_COOLDOWN_MS) {
    
    try {
      const routerResult = await pool.query(
        'SELECT clickup_task_id, name FROM routers WHERE router_id = $1',
        [routerId]
      );
      
      if (routerResult.rows.length > 0 && routerResult.rows[0].clickup_task_id) {
        const clickupTaskId = routerResult.rows[0].clickup_task_id;
        const routerName = routerResult.rows[0].name || routerId;
        
        const commentText = `⚠️ **System:** Frequent disconnections detected\n\n` +
          `📊 **${recentEvents.length} disconnections** in the last 24 hours\n\n` +
          `This may indicate:\n` +
          `• Unstable power supply\n` +
          `• Poor cellular signal\n` +
          `• Network congestion\n` +
          `• Hardware issues\n\n` +
          `🕐 Alert time: ${new Date().toLocaleString()}`;
        
        await clickupClient.createTaskComment(
          clickupTaskId,
          commentText,
          { notifyAll: false },
          'default'
        );
        
        tracker.lastAlertTime = now;
        
        logger.info('Posted frequent disconnection alert', {
          routerId,
          routerName,
          disconnectionCount: recentEvents.length,
          clickupTaskId
        });
      }
    } catch (error) {
      logger.warn('Failed to post frequent disconnection alert', {
        routerId,
        error: error.message
      });
    }
  }
}

/**
 * Post comment when cell tower changes
 */
async function postCellTowerChangeComment(routerId, oldCellId, newCellId, operator) {
  try {
    const routerResult = await pool.query(
      'SELECT clickup_task_id, name FROM routers WHERE router_id = $1',
      [routerId]
    );
    
    if (routerResult.rows.length > 0 && routerResult.rows[0].clickup_task_id) {
      const clickupTaskId = routerResult.rows[0].clickup_task_id;
      
      const commentText = `📡 **System:** Cell tower changed\n\n` +
        `**Previous Cell ID:** ${oldCellId}\n` +
        `**New Cell ID:** ${newCellId}\n` +
        (operator ? `**Operator:** ${operator}\n` : '') +
        `\n🕐 Changed at: ${new Date().toLocaleString()}`;
      
      await clickupClient.createTaskComment(
        clickupTaskId,
        commentText,
        { notifyAll: false },
        'default'
      );
      
      logger.info('Posted cell tower change comment', {
        routerId,
        oldCellId,
        newCellId,
        clickupTaskId
      });
    }
  } catch (error) {
    logger.warn('Failed to post cell tower change comment', {
      routerId,
      error: error.message
    });
  }
}

/**
 * Post comment when network operator changes
 */
async function postOperatorChangeComment(routerId, oldOperator, newOperator) {
  try {
    const routerResult = await pool.query(
      'SELECT clickup_task_id, name FROM routers WHERE router_id = $1',
      [routerId]
    );
    
    if (routerResult.rows.length > 0 && routerResult.rows[0].clickup_task_id) {
      const clickupTaskId = routerResult.rows[0].clickup_task_id;
      
      const commentText = `📶 **System:** Network operator changed\n\n` +
        `**Previous Operator:** ${oldOperator}\n` +
        `**New Operator:** ${newOperator}\n\n` +
        `This may indicate a SIM swap or network roaming.\n\n` +
        `🕐 Changed at: ${new Date().toLocaleString()}`;
      
      await clickupClient.createTaskComment(
        clickupTaskId,
        commentText,
        { notifyAll: false },
        'default'
      );
      
      logger.info('Posted operator change comment', {
        routerId,
        oldOperator,
        newOperator,
        clickupTaskId
      });
    }
  } catch (error) {
    logger.warn('Failed to post operator change comment', {
      routerId,
      error: error.message
    });
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
