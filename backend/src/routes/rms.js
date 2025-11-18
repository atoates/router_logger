const express = require('express');
const router = express.Router();
const { requireAdmin } = require('./session');

// All RMS routes require admin access
router.use(requireAdmin);
const { syncFromRMS } = require('../services/rmsSync');
const { mergeDuplicateRouters } = require('../models/router');
const RMSClient = require('../services/rmsClient');
const oauthService = require('../services/oauthService');
const { logger } = require('../config/database');

// Manual trigger for RMS sync
async function handleSync(req, res) {
  try {
    logger.info('Manual RMS sync triggered');
    const result = await syncFromRMS();
    res.json({
      success: true,
      message: 'RMS sync completed',
      ...result
    });
  } catch (error) {
    logger.error('Manual RMS sync failed:', error);
    res.status(500).json({
      success: false,
      error: 'RMS sync failed',
      message: error.message
    });
  }
}

router.post('/sync', handleSync);
router.get('/sync', handleSync);

// Get RMS sync status
router.get('/status', async (req, res) => {
  const hasPat = !!process.env.RMS_ACCESS_TOKEN;
  const hasOAuth = !!(await oauthService.getValidToken('default_rms_user'));
  const rmsEnabled = hasPat || hasOAuth;
  
  // Import sync stats
  const { getRMSSyncStats } = require('../services/rmsSync');
  const syncStats = getRMSSyncStats();
  
  res.json({
    enabled: rmsEnabled,
    syncInterval: process.env.RMS_SYNC_INTERVAL_MINUTES || 5,
    tokenType: hasOAuth ? 'oauth' : (hasPat ? 'pat' : 'none'),
    message: rmsEnabled 
      ? `RMS integration is enabled via ${hasOAuth ? 'OAuth' : 'PAT'}` 
      : 'RMS integration is disabled (no token)',
    syncStats: {
      lastSyncTime: syncStats.lastSyncTime,
      lastSyncSuccess: syncStats.lastSyncSuccess,
      lastSyncErrors: syncStats.lastSyncErrors,
      lastSyncTotal: syncStats.lastSyncTotal,
      lastSyncDuration: syncStats.lastSyncDuration,
      totalSyncs24h: syncStats.totalSyncs24h,
      isRunning: syncStats.isRunning
    }
  });
});

// Quick RMS API connectivity test
router.get('/test', async (req, res) => {
  try {
    const rms = await RMSClient.createWithAuth();
    
    // Try to fetch devices list
    const devicesResp = await rms.getDevices(5);
    const devices = Array.isArray(devicesResp) ? devicesResp : devicesResp?.data || [];
    
    res.json({
      success: true,
      message: `Successfully fetched ${devices.length} devices`,
      sampleDevice: devices[0] || null
    });
  } catch (err) {
    logger.error('RMS test failed:', err.message);
    res.status(500).json({
      success: false,
      error: 'RMS API test failed',
      message: err.message,
      status: err.response?.status,
      data: err.response?.data
    });
  }
});

// Debug endpoint to view raw RMS data for a device
router.get('/debug/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const minutes = parseInt(req.query.minutes || '60', 10);
    const to = new Date();
    const from = new Date(Date.now() - minutes * 60 * 1000);

    const rms = await RMSClient.createWithAuth();
    // Note: getDeviceMonitoring was removed to save API quota
    // Monitoring data is now included in the device list response
    const [device, dataUsage, statistics] = await Promise.allSettled([
      rms.getDevice(deviceId),
      rms.getDeviceDataUsage(deviceId, from.toISOString(), to.toISOString()),
      rms.getDeviceStatistics(deviceId, from.toISOString(), to.toISOString())
    ]);

    const settled = (p) => (p.status === 'fulfilled' ? p.value : { error: p.reason?.message || 'Failed' });

    res.json({
      device: settled(device),
      dataUsage: settled(dataUsage),
      statisticsSample: Array.isArray(settled(statistics)) ? settled(statistics).slice(0, 10) : settled(statistics)
    });
  } catch (err) {
    logger.error('RMS debug failed:', err.message);
    res.status(500).json({ error: 'RMS debug failed', message: err.message });
  }
});

// Refresh single router from RMS
router.post('/refresh/:routerId', async (req, res) => {
  try {
    const { routerId } = req.params;
    const pool = require('../config/database').pool;
    
    // Check if router exists - router_id IS the device ID (serial number)
    const routerResult = await pool.query(
      'SELECT * FROM routers WHERE router_id = $1',
      [routerId]
    );
    
    if (!routerResult.rows.length) {
      return res.status(404).json({ error: 'Router not found' });
    }
    
    // Try to fetch fresh data from RMS, but don't fail if router not in RMS
    const rms = await RMSClient.createWithAuth();
    
    let deviceData = null;
    let fromRMS = false;
    try {
      deviceData = await rms.getDevice(routerId);
      fromRMS = true;
      logger.info(`Router ${routerId} data fetched from RMS`);
    } catch (rmsError) {
      logger.warn(`Router ${routerId} not in RMS, using database data only:`, rmsError.message);
      // Don't fail - just use database data
      // Return current database record
      const refreshedRouter = await pool.query(
        'SELECT * FROM routers WHERE router_id = $1',
        [routerId]
      );
      
      return res.json({
        success: true,
        message: 'Router refreshed from database (not available in RMS)',
        router: refreshedRouter.rows[0],
        fromRMS: false
      });
    }
    
    // Get monitoring data if available
    const monitoring = deviceData.monitoring || {};
    const cellular = monitoring.cellular || monitoring.mobile || {};
    
    // Update router with fresh data
    const updateQuery = `
      UPDATE routers SET
        name = $1,
        serial = $2,
        imei = $3,
        current_status = $4,
        last_seen = $5,
        operator = $6,
        wan_ip = $7
      WHERE router_id = $8
      RETURNING *
    `;
    
    const updatedRouter = await pool.query(updateQuery, [
      deviceData.name || routerId,
      deviceData.serial || deviceData.serial_number || routerId,
      deviceData.imei || cellular.imei,
      deviceData.status?.toLowerCase() || 'offline',
      deviceData.last_connection ? new Date(deviceData.last_connection) : new Date(),
      cellular.operator || cellular.network_name,
      monitoring.network?.wan_ip || monitoring.network?.ip,
      routerId
    ]);
    
    logger.info(`Router ${routerId} refreshed from RMS`);
    res.json({
      success: true,
      message: 'Router refreshed from RMS',
      router: updatedRouter.rows[0],
      fromRMS: true
    });
  } catch (error) {
    logger.error(`Failed to refresh router ${req.params.routerId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh router',
      message: error.message
    });
  }
});

/**
 * POST /api/rms/status/:routerId
 * FAST endpoint - Only fetch critical status (online/offline, last_seen)
 * Use for frequent polling
 */
router.post('/status/:routerId', async (req, res) => {
  try {
    const { routerId } = req.params;
    const pool = require('../config/database').pool;
    
    // Quick database check
    const routerResult = await pool.query(
      'SELECT router_id, current_status, last_seen FROM routers WHERE router_id = $1',
      [routerId]
    );
    
    if (!routerResult.rows.length) {
      return res.status(404).json({ error: 'Router not found' });
    }

    // Fetch only status from RMS
    const rms = await RMSClient.createWithAuth();
    
    try {
      const deviceData = await rms.getDevice(routerId);
      const status = deviceData.status || 'unknown';
      const lastSeen = deviceData.last_activity || null;
      
      // Get previous status to detect changes
      const previousResult = await pool.query(
        'SELECT current_status, clickup_task_id FROM routers WHERE router_id = $1',
        [routerId]
      );
      
      const previousStatus = previousResult.rows[0]?.current_status || null;
      
      // Normalize status values for comparison
      const normalizeStatus = (s) => {
        if (!s) return null;
        const normalized = String(s).toLowerCase();
        return (normalized === 'online' || normalized === '1' || normalized === 'true') ? 'online' : 'offline';
      };
      
      const prevStatusNormalized = normalizeStatus(previousStatus);
      const newStatusNormalized = normalizeStatus(status);
      
      // Update only status fields
      await pool.query(
        `UPDATE routers SET 
          current_status = $1,
          last_seen = $2
        WHERE router_id = $3`,
        [status, lastSeen, routerId]
      );
      
      // Check if status changed between online and offline
      if (prevStatusNormalized && newStatusNormalized && prevStatusNormalized !== newStatusNormalized) {
        // Status changed - add comment to ClickUp task
        const clickupTaskId = previousResult.rows[0]?.clickup_task_id;
        if (clickupTaskId) {
          try {
            const clickupClient = require('../services/clickupClient');
            const statusEmoji = newStatusNormalized === 'online' ? '🟢' : '🔴';
            const statusText = newStatusNormalized === 'online' ? 'Online' : 'Offline';
            const previousStatusText = prevStatusNormalized === 'online' ? 'Online' : 'Offline';
            
            const commentText = `${statusEmoji} **System:** Router status changed\n\n` +
              `**Previous:** ${previousStatusText}\n` +
              `**Current:** ${statusText}\n\n` +
              `🕐 Changed at: ${new Date().toLocaleString()}`;
            
            await clickupClient.createTaskComment(
              clickupTaskId,
              commentText,
              { notifyAll: false },
              'default'
            );
            
            logger.info('Added status change comment to router task', {
              routerId,
              clickupTaskId,
              previousStatus: prevStatusNormalized,
              newStatus: newStatusNormalized
            });
          } catch (commentError) {
            logger.warn('Failed to add status change comment (status still updated)', {
              routerId,
              error: commentError.message
            });
            // Don't fail the status update if comment fails
          }
        }
      }
      
      logger.info(`Router ${routerId} status updated: ${status}`);
      
      res.json({
        success: true,
        router_id: routerId,
        status,
        last_seen: lastSeen,
        fromRMS: true,
        timestamp: new Date().toISOString()
      });
      
    } catch (rmsError) {
      logger.warn(`Router ${routerId} status check failed, using DB:`, rmsError.message);
      
      // Return database values
      const dbRouter = routerResult.rows[0];
      res.json({
        success: true,
        router_id: routerId,
        status: dbRouter.current_status,
        last_seen: dbRouter.last_seen,
        fromRMS: false,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    logger.error('Error fetching router status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch status',
      message: error.message
    });
  }
});

/**
 * POST /api/rms/usage/:routerId
 * MEDIUM priority - Fetch data usage statistics
 * Use for periodic updates
 */
router.post('/usage/:routerId', async (req, res) => {
  try {
    const { routerId } = req.params;
    const pool = require('../config/database').pool;
    
    const routerResult = await pool.query(
      'SELECT router_id FROM routers WHERE router_id = $1',
      [routerId]
    );
    
    if (!routerResult.rows.length) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const rms = await RMSClient.createWithAuth();
    
    try {
      const deviceData = await rms.getDevice(routerId);
      const monitoring = deviceData.monitoring || {};
      const cellular = monitoring.cellular || monitoring.mobile || {};
      
      // Extract usage data
      const txBytes = cellular.sent || cellular.tx_bytes || 0;
      const rxBytes = cellular.received || cellular.rx_bytes || 0;
      const operator = cellular.operator || null;
      const signalStrength = cellular.signal_strength || null;
      
      // Log the data usage
      await pool.query(
        `INSERT INTO router_logs (router_id, status, tx_bytes, rx_bytes, operator, signal_strength, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [routerId, deviceData.status, txBytes, rxBytes, operator, signalStrength]
      );
      
      logger.info(`Router ${routerId} usage logged: TX=${txBytes}, RX=${rxBytes}`);
      
      res.json({
        success: true,
        router_id: routerId,
        usage: {
          tx_bytes: txBytes,
          rx_bytes: rxBytes,
          operator,
          signal_strength: signalStrength
        },
        fromRMS: true,
        timestamp: new Date().toISOString()
      });
      
    } catch (rmsError) {
      logger.warn(`Router ${routerId} usage fetch failed:`, rmsError.message);
      
      // Get latest usage from database
      const latestLog = await pool.query(
        `SELECT tx_bytes, rx_bytes, operator, signal_strength, timestamp 
         FROM router_logs 
         WHERE router_id = $1 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [routerId]
      );
      
      const usage = latestLog.rows[0] || {};
      res.json({
        success: true,
        router_id: routerId,
        usage: {
          tx_bytes: usage.tx_bytes || 0,
          rx_bytes: usage.rx_bytes || 0,
          operator: usage.operator || null,
          signal_strength: usage.signal_strength || null
        },
        fromRMS: false,
        timestamp: usage.timestamp || new Date().toISOString()
      });
    }
    
  } catch (error) {
    logger.error('Error fetching router usage:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch usage',
      message: error.message
    });
  }
});

/**
 * POST /api/rms/details/:routerId
 * SLOW endpoint - Fetch infrequently changing data (firmware, config)
 * Use for manual refresh or on-demand
 */
router.post('/details/:routerId', async (req, res) => {
  try {
    const { routerId } = req.params;
    const pool = require('../config/database').pool;
    
    const routerResult = await pool.query(
      'SELECT * FROM routers WHERE router_id = $1',
      [routerId]
    );
    
    if (!routerResult.rows.length) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const rms = await RMSClient.createWithAuth();
    
    try {
      const deviceData = await rms.getDevice(routerId);
      const monitoring = deviceData.monitoring || {};
      
      // Extract static/slow-changing data
      const firmware = monitoring.system?.firmware || deviceData.firmware || null;
      const model = deviceData.model || null;
      const wan_ip = monitoring.network?.wan_ip || null;
      
      // Update router details
      await pool.query(
        `UPDATE routers SET
          name = $1,
          firmware = $2,
          model = $3,
          wan_ip = $4
        WHERE router_id = $5`,
        [deviceData.name || routerId, firmware, model, wan_ip, routerId]
      );
      
      logger.info(`Router ${routerId} details updated`);
      
      res.json({
        success: true,
        router_id: routerId,
        details: {
          name: deviceData.name || routerId,
          firmware,
          model,
          wan_ip
        },
        fromRMS: true,
        timestamp: new Date().toISOString()
      });
      
    } catch (rmsError) {
      logger.warn(`Router ${routerId} details fetch failed:`, rmsError.message);
      
      const dbRouter = routerResult.rows[0];
      res.json({
        success: true,
        router_id: routerId,
        details: {
          name: dbRouter.name,
          firmware: dbRouter.firmware,
          model: dbRouter.model,
          wan_ip: dbRouter.wan_ip
        },
        fromRMS: false,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    logger.error('Error fetching router details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch details',
      message: error.message
    });
  }
});

/**
 * GET /api/rms/static/:routerId
 * STATIC endpoint - Fetch never-changing data (IMEI, Serial)
 * Cache this on the client side
 */
router.get('/static/:routerId', async (req, res) => {
  try {
    const { routerId } = req.params;
    const pool = require('../config/database').pool;
    
    const routerResult = await pool.query(
      'SELECT router_id, serial, imei FROM routers WHERE router_id = $1',
      [routerId]
    );
    
    if (!routerResult.rows.length) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const router = routerResult.rows[0];
    
    // Set cache headers - this data never changes
    res.set('Cache-Control', 'public, max-age=86400'); // 24 hours
    
    res.json({
      success: true,
      router_id: routerId,
      static_data: {
        serial: router.serial || routerId,
        imei: router.imei
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error fetching static router data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch static data',
      message: error.message
    });
  }
});

// Admin: merge duplicate routers by name into serial-like ID
router.post('/admin/merge-routers', async (req, res) => {
  try {
    const result = await mergeDuplicateRouters();
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Merge duplicate routers failed:', err.message);
    res.status(500).json({ success: false, error: 'Merge failed', message: err.message });
  }
});

module.exports = router;
