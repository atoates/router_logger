const express = require('express');
const router = express.Router();
const os = require('os');
const v8 = require('v8');
const { requireAdmin } = require('./session');
const { pool, logger } = require('../config/database');

// Track server start time for uptime calculation
const serverStartTime = Date.now();

// Track event loop lag
let eventLoopLag = 0;
let lastLoopCheck = Date.now();
setInterval(() => {
  const now = Date.now();
  const expectedDelay = 100; // Check every 100ms
  eventLoopLag = Math.max(0, now - lastLoopCheck - expectedDelay);
  lastLoopCheck = now;
}, 100);

// Track request metrics
let requestMetrics = {
  total: 0,
  last5min: [],
  errors: 0
};

// All monitoring routes require admin access
router.use(requireAdmin);

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

// Auto-reset metrics daily at midnight UTC
setInterval(() => {
  const now = new Date();
  const hoursSinceReset = (now - apiMetrics.lastReset) / (1000 * 60 * 60);
  
  // Reset if more than 24 hours have passed
  if (hoursSinceReset >= 24) {
    logger.info(`Auto-resetting API metrics after ${hoursSinceReset.toFixed(2)} hours`);
    apiMetrics = {
      rmsApiCalls: 0,
      lastReset: new Date(),
      callsByType: {},
      rateLimitHits: 0,
      lastRateLimit: null
    };
    clickupMetrics = {
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
  }
}, 60 * 60 * 1000); // Check every hour

// Middleware to track RMS API calls (to be used in rmsClient)
async function trackRMSCall(endpoint, status) {
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
  
  // Log to database for persistent tracking
  try {
    await pool.query(
      'INSERT INTO api_call_log (service, call_type, status_code) VALUES ($1, $2, $3)',
      ['rms', type, status]
    );
  } catch (err) {
    // Don't fail the main request if logging fails
    logger.warn('Failed to log RMS API call to database:', err.message);
  }
}

// Middleware to track ClickUp API calls
async function trackClickUpCall(callType, status, isRetry = false) {
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
  
  // Log to database for persistent tracking
  try {
    await pool.query(
      'INSERT INTO api_call_log (service, call_type, status_code, is_retry) VALUES ($1, $2, $3, $4)',
      ['clickup', type, status, isRetry]
    );
  } catch (err) {
    // Don't fail the main request if logging fails
    logger.warn('Failed to log ClickUp API call to database:', err.message);
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
    // Get actual API calls from database (last 24 hours)
    const last24hCalls = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status_code = 429) as rate_limit_hits,
        COUNT(DISTINCT call_type) as unique_types,
        json_object_agg(call_type, count) as by_type
      FROM (
        SELECT call_type, status_code, COUNT(*) as count
        FROM api_call_log
        WHERE service = 'rms' 
          AND timestamp >= NOW() - INTERVAL '24 hours'
        GROUP BY call_type, status_code
      ) subq
    `);
    
    const callStats = last24hCalls.rows[0];
    const totalCalls = parseInt(callStats.total) || 0;
    const quotaLimit = 100000; // RMS monthly limit (100k)
    
    // Calculate monthly projection from 24h average
    const dailyAverage = totalCalls;
    const monthlyEstimate = dailyAverage * 30;
    const percentOfQuota = monthlyEstimate > 0 ? ((monthlyEstimate / quotaLimit) * 100).toFixed(2) + '%' : '0%';
    
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
        total: totalCalls,
        last24Hours: totalCalls,
        rateLimitHits: parseInt(callStats.rate_limit_hits) || 0,
        callsByType: callStats.by_type || {},
        quotaLimit,
        estimates: {
          dailyAverage: dailyAverage,
          monthlyProjection: monthlyEstimate,
          percentOfQuota,
          quotaRemaining: Math.max(0, quotaLimit - monthlyEstimate)
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
    // Get actual API calls from database (last 24 hours)
    const last24hCalls = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status_code = 429) as rate_limit_hits,
        COUNT(*) FILTER (WHERE is_retry = true) as retries,
        json_object_agg(call_type, count) as by_type
      FROM (
        SELECT call_type, status_code, is_retry, COUNT(*) as count
        FROM api_call_log
        WHERE service = 'clickup' 
          AND timestamp >= NOW() - INTERVAL '24 hours'
        GROUP BY call_type, status_code, is_retry
      ) subq
    `);
    
    // Get calls in last hour for rate calculation
    const lastHourCalls = await pool.query(`
      SELECT COUNT(*) as count
      FROM api_call_log
      WHERE service = 'clickup' 
        AND timestamp >= NOW() - INTERVAL '1 hour'
    `);
    
    const callStats = last24hCalls.rows[0];
    const totalCalls = parseInt(callStats.total) || 0;
    const hourlyRate = parseInt(lastHourCalls.rows[0]?.count) || 0;
    const currentRatePerMinute = (hourlyRate / 60).toFixed(2);
    const quotaLimit = 100; // ClickUp: 100 requests per minute
    
    // Get ClickUp sync stats
    const syncStats = require('../services/clickupSync').getSyncStats();
    
    res.json({
      apiUsage: {
        total: totalCalls,
        last24Hours: totalCalls,
        lastHour: hourlyRate,
        rateLimitHits: parseInt(callStats.rate_limit_hits) || 0,
        retries: parseInt(callStats.retries) || 0,
        callsByType: callStats.by_type || {},
        quotaLimit,
        estimates: {
          currentRatePerMinute: currentRatePerMinute,
          hourlyRate: hourlyRate,
          percentOfRateLimit: ((parseFloat(currentRatePerMinute) / quotaLimit) * 100).toFixed(2) + '%'
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

// DB activity snapshot (useful for investigating CPU/memory spikes)
router.get('/api/monitoring/db-activity', async (req, res) => {
  try {
    const [activity, connections, vacuumProgress, indexProgress] = await Promise.all([
      pool.query(`
        SELECT
          pid,
          usename,
          application_name,
          client_addr,
          state,
          wait_event_type,
          wait_event,
          query_start,
          NOW() - query_start AS runtime,
          LEFT(REGEXP_REPLACE(query, '\\s+', ' ', 'g'), 500) AS query
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state <> 'idle'
        ORDER BY query_start ASC;
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE state <> 'idle')::int AS active,
          COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL)::int AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database();
      `),
      pool.query(`
        SELECT
          pid,
          relid::regclass AS relation,
          phase,
          heap_blks_total,
          heap_blks_scanned,
          heap_blks_vacuumed,
          index_vacuum_count,
          max_dead_tuples
        FROM pg_stat_progress_vacuum
        ORDER BY pid;
      `),
      pool.query(`
        SELECT
          pid,
          command,
          phase,
          lockers_total,
          lockers_done,
          current_locker_pid,
          blocks_total,
          blocks_done
        FROM pg_stat_progress_create_index
        ORDER BY pid;
      `)
    ]);

    res.json({
      connections: connections.rows[0] || { total: 0, active: 0, waiting: 0 },
      activeQueries: activity.rows,
      vacuumProgress: vacuumProgress.rows,
      createIndexProgress: indexProgress.rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching DB activity:', error);
    res.status(500).json({ error: 'Failed to fetch DB activity' });
  }
});

// Key DB settings for memory + maintenance behavior
router.get('/api/monitoring/db-settings', async (req, res) => {
  try {
    const settings = await pool.query(`
      SELECT name, setting, unit, context
      FROM pg_settings
      WHERE name IN (
        'shared_buffers',
        'work_mem',
        'maintenance_work_mem',
        'autovacuum_work_mem',
        'temp_buffers',
        'effective_cache_size',
        'max_connections',
        'max_parallel_workers_per_gather',
        'max_parallel_workers',
        'max_worker_processes'
      )
      ORDER BY name;
    `);

    const stats = await pool.query(`
      SELECT
        numbackends,
        xact_commit,
        xact_rollback,
        blks_read,
        blks_hit,
        tup_returned,
        tup_fetched,
        tup_inserted,
        tup_updated,
        tup_deleted,
        deadlocks,
        temp_files,
        temp_bytes
      FROM pg_stat_database
      WHERE datname = current_database();
    `);

    res.json({
      settings: settings.rows,
      databaseStats: stats.rows[0] || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching DB settings:', error);
    res.status(500).json({ error: 'Failed to fetch DB settings' });
  }
});

// System performance metrics (CPU, Memory, Event Loop)
router.get('/api/monitoring/system', async (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const heapStats = v8.getHeapStatistics();
    
    // Calculate CPU percentage (rough approximation)
    const cpus = os.cpus();
    const cpuCount = cpus.length;
    
    // System memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    // Process uptime
    const uptimeSeconds = process.uptime();
    const serverUptimeMs = Date.now() - serverStartTime;
    
    // Format bytes to human readable
    const formatBytes = (bytes) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    };
    
    // Format uptime
    const formatUptime = (seconds) => {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      if (days > 0) return `${days}d ${hours}h ${mins}m`;
      if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
      if (mins > 0) return `${mins}m ${secs}s`;
      return `${secs}s`;
    };
    
    res.json({
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: formatUptime(uptimeSeconds),
        uptimeSeconds: Math.round(uptimeSeconds)
      },
      memory: {
        process: {
          rss: formatBytes(memUsage.rss),
          rssBytes: memUsage.rss,
          heapTotal: formatBytes(memUsage.heapTotal),
          heapUsed: formatBytes(memUsage.heapUsed),
          heapUsedPercent: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1) + '%',
          external: formatBytes(memUsage.external),
          arrayBuffers: formatBytes(memUsage.arrayBuffers || 0)
        },
        heap: {
          totalHeapSize: formatBytes(heapStats.total_heap_size),
          usedHeapSize: formatBytes(heapStats.used_heap_size),
          heapSizeLimit: formatBytes(heapStats.heap_size_limit),
          usedPercent: ((heapStats.used_heap_size / heapStats.heap_size_limit) * 100).toFixed(1) + '%',
          mallocedMemory: formatBytes(heapStats.malloced_memory)
        },
        system: {
          total: formatBytes(totalMem),
          used: formatBytes(usedMem),
          free: formatBytes(freeMem),
          usedPercent: ((usedMem / totalMem) * 100).toFixed(1) + '%'
        }
      },
      cpu: {
        cores: cpuCount,
        model: cpus[0]?.model || 'Unknown',
        userTime: (cpuUsage.user / 1000000).toFixed(2) + 's',
        systemTime: (cpuUsage.system / 1000000).toFixed(2) + 's',
        loadAvg: os.loadavg().map(l => l.toFixed(2))
      },
      eventLoop: {
        lagMs: eventLoopLag,
        status: eventLoopLag < 50 ? 'healthy' : eventLoopLag < 200 ? 'moderate' : 'stressed'
      },
      handles: {
        active: process._getActiveHandles?.()?.length || 'N/A',
        requests: process._getActiveRequests?.()?.length || 'N/A'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching system metrics:', error);
    res.status(500).json({ error: 'Failed to fetch system metrics' });
  }
});

// Combined performance dashboard
router.get('/api/monitoring/performance', async (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    // Get database pool stats
    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    };
    
    // Quick DB performance check
    const dbPerfStart = Date.now();
    await pool.query('SELECT 1');
    const dbLatency = Date.now() - dbPerfStart;
    
    // Get active query count
    const activeQueries = await pool.query(`
      SELECT COUNT(*)::int as count 
      FROM pg_stat_activity 
      WHERE datname = current_database() 
        AND state = 'active' 
        AND pid <> pg_backend_pid()
    `);
    
    // Calculate health scores (0-100)
    const memoryScore = 100 - ((memUsage.heapUsed / heapStats.heap_size_limit) * 100);
    const systemMemScore = 100 - (((totalMem - freeMem) / totalMem) * 100);
    const eventLoopScore = eventLoopLag < 10 ? 100 : eventLoopLag < 50 ? 80 : eventLoopLag < 200 ? 50 : 20;
    const dbScore = dbLatency < 10 ? 100 : dbLatency < 50 ? 80 : dbLatency < 200 ? 50 : 20;
    
    const overallScore = Math.round((memoryScore + systemMemScore + eventLoopScore + dbScore) / 4);
    
    res.json({
      health: {
        overall: overallScore,
        status: overallScore > 80 ? 'excellent' : overallScore > 60 ? 'good' : overallScore > 40 ? 'degraded' : 'critical',
        scores: {
          processMemory: Math.round(memoryScore),
          systemMemory: Math.round(systemMemScore),
          eventLoop: eventLoopScore,
          database: dbScore
        }
      },
      summary: {
        processMemory: `${(memUsage.heapUsed / 1024 / 1024).toFixed(0)} MB / ${(heapStats.heap_size_limit / 1024 / 1024).toFixed(0)} MB`,
        systemMemory: `${((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(1)} GB / ${(totalMem / 1024 / 1024 / 1024).toFixed(1)} GB`,
        eventLoopLag: `${eventLoopLag} ms`,
        dbLatency: `${dbLatency} ms`,
        dbConnections: `${poolStats.totalCount - poolStats.idleCount} active / ${poolStats.totalCount} total`,
        activeQueries: activeQueries.rows[0]?.count || 0,
        uptime: `${Math.round(process.uptime() / 60)} minutes`
      },
      recommendations: generateRecommendations({
        memoryScore, systemMemScore, eventLoopScore, dbScore, 
        poolStats, dbLatency, heapStats, memUsage, totalMem, freeMem
      }),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching performance dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch performance dashboard' });
  }
});

// Generate performance recommendations
function generateRecommendations(metrics) {
  const recs = [];
  
  if (metrics.memoryScore < 30) {
    recs.push({
      type: 'critical',
      area: 'memory',
      message: 'Process memory usage is very high. Consider increasing RAM or optimizing memory usage.'
    });
  } else if (metrics.memoryScore < 50) {
    recs.push({
      type: 'warning',
      area: 'memory',
      message: 'Process memory usage is elevated. Monitor for potential memory leaks.'
    });
  }
  
  if (metrics.systemMemScore < 20) {
    recs.push({
      type: 'critical',
      area: 'system',
      message: 'System memory is nearly exhausted. Upgrade VM or reduce workload immediately.'
    });
  } else if (metrics.systemMemScore < 40) {
    recs.push({
      type: 'warning',
      area: 'system',
      message: 'System memory is running low. Consider upgrading VM resources.'
    });
  }
  
  if (metrics.eventLoopScore < 50) {
    recs.push({
      type: 'warning',
      area: 'cpu',
      message: 'Event loop is delayed. CPU may be overloaded or blocking operations detected.'
    });
  }
  
  if (metrics.dbLatency > 100) {
    recs.push({
      type: 'warning',
      area: 'database',
      message: 'Database latency is high. Check for slow queries or connection issues.'
    });
  }
  
  if (metrics.poolStats.waitingCount > 0) {
    recs.push({
      type: 'warning',
      area: 'database',
      message: `${metrics.poolStats.waitingCount} queries waiting for connections. Consider increasing pool size.`
    });
  }
  
  if (recs.length === 0) {
    recs.push({
      type: 'info',
      area: 'overall',
      message: 'All systems operating normally. No immediate action required.'
    });
  }
  
  return recs;
}

// Location API status (Unwired Labs)
router.get('/api/monitoring/location-api', async (req, res) => {
  try {
    const { getLocationCacheStats } = require('../services/geoService');
    const axios = require('axios');
    
    const apiKey = process.env.LOCATION_API;
    const cacheStats = getLocationCacheStats();
    
    let balance = null;
    let balanceError = null;
    
    if (apiKey) {
      try {
        // Check Unwired Labs balance
        const balanceRes = await axios.get(
          `https://eu1.unwiredlabs.com/v2/balance?token=${apiKey}`,
          { timeout: 5000 }
        );
        if (balanceRes.data && balanceRes.data.status === 'ok') {
          balance = {
            geolocation: balanceRes.data.balance_geolocation,
            geocoding: balanceRes.data.balance_geocoding
          };
        }
      } catch (err) {
        balanceError = err.response?.data?.message || err.message;
      }
    }
    
    res.json({
      configured: !!apiKey,
      provider: 'Unwired Labs',
      endpoint: 'eu1.unwiredlabs.com',
      balance,
      balanceError,
      cache: cacheStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching location API status:', error);
    res.status(500).json({ error: 'Failed to fetch location API status' });
  }
});

// Current configuration and tuning recommendations
router.get('/api/monitoring/config', async (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    // Current sync intervals
    const rmsSyncInterval = parseInt(process.env.RMS_SYNC_INTERVAL_MINUTES || '5', 10);
    const clickupSyncInterval = parseInt(process.env.CLICKUP_SYNC_INTERVAL_MINUTES || '30', 10);
    
    // Database pool settings
    const dbPoolMax = parseInt(process.env.DB_POOL_MAX || '20', 10);
    const dbPoolMin = parseInt(process.env.DB_POOL_MIN || '2', 10);
    
    // Current utilization
    const memoryUtilization = (memUsage.heapUsed / heapStats.heap_size_limit) * 100;
    const systemMemUtilization = ((totalMem - freeMem) / totalMem) * 100;
    
    // Pool stats
    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    };
    
    const poolUtilization = poolStats.totalCount > 0 
      ? ((poolStats.totalCount - poolStats.idleCount) / dbPoolMax) * 100 
      : 0;
    
    // Generate recommendations
    const recommendations = [];
    
    // Memory-based recommendations
    if (memoryUtilization < 30 && systemMemUtilization < 50) {
      recommendations.push({
        area: 'memory',
        current: `${memoryUtilization.toFixed(0)}% heap used`,
        recommendation: 'You have headroom! Consider increasing Node memory with NODE_OPTIONS="--max-old-space-size=512" or higher',
        priority: 'low'
      });
    }
    
    // Database pool recommendations
    if (poolUtilization > 80) {
      recommendations.push({
        area: 'database',
        current: `${poolUtilization.toFixed(0)}% pool used`,
        recommendation: `Increase DB_POOL_MAX from ${dbPoolMax} to ${Math.min(50, dbPoolMax + 10)}`,
        priority: 'high'
      });
    } else if (poolUtilization < 20 && memoryUtilization < 50) {
      recommendations.push({
        area: 'database',
        current: `Only ${poolUtilization.toFixed(0)}% pool used`,
        recommendation: 'Pool is underutilized. Could handle more concurrent operations.',
        priority: 'info'
      });
    }
    
    // Sync interval recommendations
    if (rmsSyncInterval > 2 && systemMemUtilization < 60) {
      recommendations.push({
        area: 'rms_sync',
        current: `Every ${rmsSyncInterval} minutes`,
        recommendation: `Could reduce RMS_SYNC_INTERVAL_MINUTES to ${Math.max(1, rmsSyncInterval - 2)} for fresher data`,
        priority: 'medium'
      });
    }
    
    if (clickupSyncInterval > 15 && systemMemUtilization < 60) {
      recommendations.push({
        area: 'clickup_sync',
        current: `Every ${clickupSyncInterval} minutes`,
        recommendation: `Could reduce CLICKUP_SYNC_INTERVAL_MINUTES to ${Math.max(10, clickupSyncInterval - 10)} for faster updates`,
        priority: 'low'
      });
    }
    
    // CPU recommendations
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    const loadPercent = (loadAvg[0] / cpuCount) * 100;
    
    if (loadPercent < 30) {
      recommendations.push({
        area: 'cpu',
        current: `${loadPercent.toFixed(0)}% load average`,
        recommendation: 'CPU is underutilized. Could handle more frequent syncs or parallel operations.',
        priority: 'info'
      });
    }
    
    res.json({
      current: {
        syncIntervals: {
          rms: `${rmsSyncInterval} minutes`,
          clickup: `${clickupSyncInterval} minutes`
        },
        database: {
          poolMax: dbPoolMax,
          poolMin: dbPoolMin,
          currentConnections: poolStats.totalCount,
          activeConnections: poolStats.totalCount - poolStats.idleCount,
          waitingQueries: poolStats.waitingCount
        },
        resources: {
          heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(0)} MB`,
          heapLimit: `${(heapStats.heap_size_limit / 1024 / 1024).toFixed(0)} MB`,
          systemMemUsed: `${((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(1)} GB`,
          systemMemTotal: `${(totalMem / 1024 / 1024 / 1024).toFixed(1)} GB`,
          cpuCores: cpuCount,
          loadAverage: loadAvg.map(l => l.toFixed(2))
        }
      },
      utilization: {
        memory: `${memoryUtilization.toFixed(1)}%`,
        systemMemory: `${systemMemUtilization.toFixed(1)}%`,
        dbPool: `${poolUtilization.toFixed(1)}%`,
        cpu: `${loadPercent.toFixed(1)}%`
      },
      canPushHarder: memoryUtilization < 60 && systemMemUtilization < 70 && poolUtilization < 70 && loadPercent < 60,
      recommendations,
      suggestedEnvVars: recommendations.length > 0 ? {
        // Only suggest if we can push harder
        ...(memoryUtilization < 50 && { 'NODE_OPTIONS': '--max-old-space-size=512' }),
        ...(rmsSyncInterval > 2 && systemMemUtilization < 60 && { 'RMS_SYNC_INTERVAL_MINUTES': Math.max(1, rmsSyncInterval - 2).toString() }),
        ...(poolUtilization > 60 && { 'DB_POOL_MAX': Math.min(50, dbPoolMax + 10).toString() }),
        ...(clickupSyncInterval > 15 && { 'CLICKUP_SYNC_INTERVAL_MINUTES': Math.max(10, clickupSyncInterval - 10).toString() })
      } : {},
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

module.exports = { router, trackRMSCall, trackClickUpCall, apiMetrics, clickupMetrics, isApproachingQuota, getQuotaStatus };
