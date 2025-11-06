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

// Track ClickUp API call metrics
let clickupMetrics = {
  apiCalls: 0,
  lastReset: new Date(),
  callsByType: {
    updateTask: 0,
    updateCustomField: 0,
    getTask: 0,
    createTask: 0,
    other: 0
  },
  rateLimitHits: 0,
  lastRateLimit: null,
  retries: 0
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

// Middleware to track ClickUp API calls
function trackClickUpCall(callType, status, isRetry = false) {
  clickupMetrics.apiCalls++;
  
  // Track by call type
  const type = callType || 'other';
  if (clickupMetrics.callsByType.hasOwnProperty(type)) {
    clickupMetrics.callsByType[type]++;
  } else {
    clickupMetrics.callsByType.other++;
  }
  
  // Track rate limits
  if (status === 429) {
    clickupMetrics.rateLimitHits++;
    clickupMetrics.lastRateLimit = new Date();
  }
  
  // Track retries
  if (isRetry) {
    clickupMetrics.retries++;
  }
}

// Check if we're approaching quota limit
function isApproachingQuota() {
  const now = new Date();
  const hoursSinceReset = (now - apiMetrics.lastReset) / (1000 * 60 * 60);
  
  if (hoursSinceReset === 0) return false;
  
  const monthlyEstimate = (apiMetrics.rmsApiCalls / hoursSinceReset) * 730; // hours in 30 days
  const quotaLimit = 100000;
  const quotaPercentage = (monthlyEstimate / quotaLimit) * 100;
  
  // Return true if we're at 90% or higher
  return quotaPercentage >= 90;
}

// Get current quota status
function getQuotaStatus() {
  const now = new Date();
  const hoursSinceReset = (now - apiMetrics.lastReset) / (1000 * 60 * 60);
  
  if (hoursSinceReset === 0) return { approaching: false, percentage: 0, estimate: 0 };
  
  const monthlyEstimate = (apiMetrics.rmsApiCalls / hoursSinceReset) * 730;
  const quotaLimit = 100000;
  const quotaPercentage = (monthlyEstimate / quotaLimit) * 100;
  
  return {
    approaching: quotaPercentage >= 90,
    percentage: quotaPercentage,
    estimate: monthlyEstimate,
    limit: quotaLimit,
    current: apiMetrics.rmsApiCalls
  };
}


// Get current API usage metrics
router.get('/api/monitoring/rms-usage', async (req, res) => {
  try {
    // Calculate daily and monthly estimates
    const now = new Date();
    const hoursSinceReset = (now - apiMetrics.lastReset) / (1000 * 60 * 60);
    const dailyEstimate = hoursSinceReset > 0 ? Math.round((apiMetrics.rmsApiCalls / hoursSinceReset) * 24) : 0;
    const monthlyEstimate = dailyEstimate * 30;
    const quotaLimit = 100000; // RMS API monthly limit
    
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
        quotaLimit,
        estimates: {
          hourlyRate: hoursSinceReset > 0 ? Math.round(apiMetrics.rmsApiCalls / hoursSinceReset) : 0,
          dailyRate: dailyEstimate,
          monthlyRate: monthlyEstimate,
          percentOfQuota: ((monthlyEstimate / quotaLimit) * 100).toFixed(2) + '%',
          quotaRemaining: quotaLimit - monthlyEstimate
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

// Get ClickUp API usage metrics
router.get('/api/monitoring/clickup-usage', async (req, res) => {
  try {
    const now = new Date();
    const hoursSinceReset = (now - clickupMetrics.lastReset) / (1000 * 60 * 60);
    const minutesSinceReset = (now - clickupMetrics.lastReset) / (1000 * 60);
    const dailyEstimate = hoursSinceReset > 0 ? Math.round((clickupMetrics.apiCalls / hoursSinceReset) * 24) : 0;
    const monthlyEstimate = dailyEstimate * 30;
    const quotaLimit = 100; // ClickUp rate limit: 100 requests per minute
    const currentRate = minutesSinceReset > 0 ? (clickupMetrics.apiCalls / minutesSinceReset) : 0;
    
    // Get ClickUp sync stats
    const syncStats = require('../services/clickupSync').getSyncStats();
    
    res.json({
      apiUsage: {
        total: clickupMetrics.apiCalls,
        since: clickupMetrics.lastReset,
        hoursSinceReset: hoursSinceReset.toFixed(2),
        minutesSinceReset: minutesSinceReset.toFixed(2),
        callsByType: clickupMetrics.callsByType,
        rateLimitHits: clickupMetrics.rateLimitHits,
        lastRateLimit: clickupMetrics.lastRateLimit,
        retries: clickupMetrics.retries,
        quotaLimit, // Per minute limit
        estimates: {
          currentRatePerMinute: currentRate.toFixed(2),
          hourlyRate: hoursSinceReset > 0 ? Math.round(clickupMetrics.apiCalls / hoursSinceReset) : 0,
          dailyRate: dailyEstimate,
          monthlyRate: monthlyEstimate,
          percentOfRateLimit: ((currentRate / quotaLimit) * 100).toFixed(2) + '%'
        }
      },
      syncStats: {
        totalSyncs: syncStats.totalSyncs,
        lastSyncUpdated: syncStats.lastSyncUpdated,
        lastSyncErrors: syncStats.lastSyncErrors,
        lastSyncDuration: syncStats.lastSyncDuration,
        lastSyncTime: syncStats.lastSyncTime,
        isRunning: syncStats.isRunning
      }
    });
  } catch (error) {
    logger.error('Error fetching ClickUp monitoring data:', error);
    res.status(500).json({ error: 'Failed to fetch ClickUp monitoring data' });
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

// Database health check - see if we have any data
router.get('/api/monitoring/db-health', async (req, res) => {
  try {
    const [routerCount, logCount, recentLogs, oldestLog, newestLog] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM routers'),
      pool.query('SELECT COUNT(*) as count FROM router_logs'),
      pool.query('SELECT COUNT(*) as count FROM router_logs WHERE timestamp > NOW() - INTERVAL \'24 hours\''),
      pool.query('SELECT MIN(timestamp) as oldest FROM router_logs'),
      pool.query('SELECT MAX(timestamp) as newest FROM router_logs')
    ]);

    res.json({
      database: {
        routers: parseInt(routerCount.rows[0]?.count || 0),
        totalLogs: parseInt(logCount.rows[0]?.count || 0),
        logsLast24h: parseInt(recentLogs.rows[0]?.count || 0),
        oldestLog: oldestLog.rows[0]?.oldest,
        newestLog: newestLog.rows[0]?.newest,
        dataAge: newestLog.rows[0]?.newest 
          ? Math.round((Date.now() - new Date(newestLog.rows[0].newest)) / 60000) + ' minutes ago'
          : 'No data'
      },
      status: parseInt(logCount.rows[0]?.count || 0) > 0 ? 'OK' : 'NO_DATA'
    });
  } catch (error) {
    logger.error('Error checking DB health:', error);
    res.status(500).json({ error: 'Failed to check database health' });
  }
});

module.exports = { router, trackRMSCall, trackClickUpCall, apiMetrics, clickupMetrics, isApproachingQuota, getQuotaStatus };
