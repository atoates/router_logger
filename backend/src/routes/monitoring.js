const express = require('express');
const router = express.Router();
const { pool, logger } = require('../config/database');

// Track API call metrics (in-memory for now)
let apiMetrics = {
  rmsApiCalls: 0,
  lastReset: new Date(),
  callsByType: {},
  rateLimitHits: 0,
  lastRateLimit: null
};

// Middleware to track RMS API calls (to be used in rmsClient)
function trackRMSCall(endpoint, status) {
  apiMetrics.rmsApiCalls++;
  
  // Track by endpoint type
  const type = endpoint.includes('/monitoring') ? 'monitoring' : 
               endpoint.includes('/statistics') ? 'statistics' :
               endpoint.includes('/data-usage') ? 'data-usage' : 'other';
  
  apiMetrics.callsByType[type] = (apiMetrics.callsByType[type] || 0) + 1;
  
  // Track rate limits
  if (status === 429) {
    apiMetrics.rateLimitHits++;
    apiMetrics.lastRateLimit = new Date();
  }
}

// Get current API usage metrics
router.get('/api/monitoring/rms-usage', async (req, res) => {
  try {
    // Calculate daily and monthly estimates
    const now = new Date();
    const hoursSinceReset = (now - apiMetrics.lastReset) / (1000 * 60 * 60);
    const dailyEstimate = hoursSinceReset > 0 ? Math.round((apiMetrics.rmsApiCalls / hoursSinceReset) * 24) : 0;
    const monthlyEstimate = dailyEstimate * 30;
    
    // Get recent sync stats from logs
    const recentSyncs = await pool.query(`
      SELECT 
        DATE_TRUNC('hour', timestamp) as hour,
        COUNT(*) as log_count
      FROM router_logs
      WHERE timestamp > NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour DESC
      LIMIT 24
    `);
    
    // Get total logs by router
    const logsByRouter = await pool.query(`
      SELECT 
        r.router_id,
        r.name,
        COUNT(rl.*) as total_logs,
        MAX(rl.timestamp) as last_log
      FROM routers r
      LEFT JOIN router_logs rl ON r.router_id = rl.router_id
      GROUP BY r.router_id, r.name
      ORDER BY total_logs DESC
    `);
    
    res.json({
      apiUsage: {
        total: apiMetrics.rmsApiCalls,
        since: apiMetrics.lastReset,
        hoursSinceReset: hoursSinceReset.toFixed(2),
        callsByType: apiMetrics.callsByType,
        rateLimitHits: apiMetrics.rateLimitHits,
        lastRateLimit: apiMetrics.lastRateLimit,
        estimates: {
          dailyRate: dailyEstimate,
          monthlyRate: monthlyEstimate,
          percentOfQuota: ((monthlyEstimate / 100000) * 100).toFixed(2) + '%',
          quotaRemaining: 100000 - monthlyEstimate
        }
      },
      recentActivity: recentSyncs.rows,
      routerStats: logsByRouter.rows
    });
  } catch (error) {
    logger.error('Error fetching monitoring data:', error);
    res.status(500).json({ error: 'Failed to fetch monitoring data' });
  }
});

// Reset metrics (for testing or monthly reset)
router.post('/api/monitoring/reset-metrics', (req, res) => {
  apiMetrics = {
    rmsApiCalls: 0,
    lastReset: new Date(),
    callsByType: {},
    rateLimitHits: 0,
    lastRateLimit: null
  };
  res.json({ message: 'Metrics reset successfully', metrics: apiMetrics });
});

module.exports = { router, trackRMSCall, apiMetrics };
