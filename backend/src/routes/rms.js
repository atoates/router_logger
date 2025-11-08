const express = require('express');
const router = express.Router();
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
  res.json({
    enabled: rmsEnabled,
    syncInterval: process.env.RMS_SYNC_INTERVAL_MINUTES || 60,
    tokenType: hasOAuth ? 'oauth' : (hasPat ? 'pat' : 'none'),
    message: rmsEnabled 
      ? `RMS integration is enabled via ${hasOAuth ? 'OAuth' : 'PAT'}` 
      : 'RMS integration is disabled (no token)'
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
      // Return current database record with updated timestamp
      await pool.query(
        'UPDATE routers SET updated_at = NOW() WHERE router_id = $1',
        [routerId]
      );
      
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
        wan_ip = $7,
        updated_at = NOW()
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

module.exports = router;

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
