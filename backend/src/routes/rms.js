const express = require('express');
const router = express.Router();
const { syncFromRMS } = require('../services/rmsSync');
const RMSClient = require('../services/rmsClient');
const oauthService = require('../services/oauthService');
const { logger } = require('../config/database');

// Manual trigger for RMS sync
router.post('/sync', async (req, res) => {
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
});

// Get RMS sync status
router.get('/status', async (req, res) => {
  const hasPat = !!process.env.RMS_ACCESS_TOKEN;
  const hasOAuth = !!(await oauthService.getValidToken('default_rms_user'));
  const rmsEnabled = hasPat || hasOAuth;
  res.json({
    enabled: rmsEnabled,
    syncInterval: process.env.RMS_SYNC_INTERVAL_MINUTES || 15,
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
    const [device, monitoring, dataUsage, statistics] = await Promise.allSettled([
      rms.getDevice(deviceId),
      rms.getDeviceMonitoring(deviceId),
      rms.getDeviceDataUsage(deviceId, from.toISOString(), to.toISOString()),
      rms.getDeviceStatistics(deviceId, from.toISOString(), to.toISOString())
    ]);

    const settled = (p) => (p.status === 'fulfilled' ? p.value : { error: p.reason?.message || 'Failed' });

    res.json({
      device: settled(device),
      monitoring: settled(monitoring),
      dataUsage: settled(dataUsage),
      statisticsSample: Array.isArray(settled(statistics)) ? settled(statistics).slice(0, 10) : settled(statistics)
    });
  } catch (err) {
    logger.error('RMS debug failed:', err.message);
    res.status(500).json({ error: 'RMS debug failed', message: err.message });
  }
});

module.exports = router;
