const express = require('express');
const router = express.Router();
const { syncFromRMS } = require('../services/rmsSync');
const RMSClient = require('../services/rmsClient');
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
router.get('/status', (req, res) => {
  const rmsEnabled = !!process.env.RMS_ACCESS_TOKEN;
  res.json({
    enabled: rmsEnabled,
    syncInterval: process.env.RMS_SYNC_INTERVAL_MINUTES || 15,
    message: rmsEnabled 
      ? 'RMS integration is enabled' 
      : 'RMS integration is disabled (no access token)'
  });
});

module.exports = router;

// Debug endpoint to view raw RMS data for a device
router.get('/debug/:deviceId', async (req, res) => {
  try {
    if (!process.env.RMS_ACCESS_TOKEN) {
      return res.status(400).json({ error: 'RMS disabled' });
    }
    const { deviceId } = req.params;
    const minutes = parseInt(req.query.minutes || '60');
    const to = new Date();
    const from = new Date(Date.now() - minutes * 60 * 1000);

    const rms = new RMSClient(process.env.RMS_ACCESS_TOKEN);
    const [device, monitoring, statistics] = await Promise.all([
      rms.getDevice(deviceId).catch(() => null),
      rms.getDeviceMonitoring(deviceId).catch(() => null),
      rms.getDeviceStatistics(deviceId, from.toISOString(), to.toISOString()).catch(() => [])
    ]);

    res.json({ device, monitoring, statisticsSample: Array.isArray(statistics) ? statistics.slice(0, 10) : statistics });
  } catch (err) {
    logger.error('RMS debug failed:', err.message);
    res.status(500).json({ error: 'RMS debug failed', message: err.message });
  }
});
