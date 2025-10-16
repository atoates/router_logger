const express = require('express');
const router = express.Router();
const { syncFromRMS } = require('../services/rmsSync');
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
