require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { logger } = require('./config/database');
const { initializeDatabase, runMigrations } = require('./database/migrate');
const { initMQTT, closeMQTT } = require('./services/mqttService');
const { startRMSSync } = require('./services/rmsSync');
const { startClickUpSync } = require('./services/clickupSync');
const distributedLockService = require('./services/distributedLockService');
const oauthService = require('./services/oauthService');
const routerRoutes = require('./routes/router');
const rmsRoutes = require('./routes/rms');
const authRoutes = require('./routes/auth');
const clickupRoutes = require('./routes/clickup');
const sessionRoutes = require('./routes/session');
const userRoutes = require('./routes/users');
const guestWifiRoutes = require('./routes/guestWifi');
const { router: monitoringRoutes } = require('./routes/monitoring');

const app = express();
const PORT = process.env.PORT || 3001;

// Validate critical environment variables
function validateEnvironment() {
  const required = ['DATABASE_URL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Warn about production security settings
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.FRONTEND_URL) {
      logger.warn('⚠️  FRONTEND_URL not set in production - CORS will be restricted for security');
    }
  }
  
  logger.info('Environment validation passed');
}

// Validate environment before starting
validateEnvironment();

// Trust Railway proxy for rate limiting and secure cookies
app.set('trust proxy', 1);

// CORS configuration - secure by default
const corsOrigin = (() => {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.FRONTEND_URL) {
      logger.warn('⚠️  FRONTEND_URL not set in production - CORS will reject all origins');
      return false;
    }
    
    const origins = [process.env.FRONTEND_URL];
    if (process.env.MOBILE_FRONTEND_URL) {
      origins.push(process.env.MOBILE_FRONTEND_URL);
      logger.info(`✅ CORS configured for desktop (${process.env.FRONTEND_URL}) and mobile (${process.env.MOBILE_FRONTEND_URL})`);
    } else {
      logger.info(`✅ CORS configured for desktop: ${process.env.FRONTEND_URL}`);
    }
    
    return origins;
  } else {
    return process.env.FRONTEND_URL || '*';
  }
})();

// Middleware
app.use(helmet());
app.use(compression()); // Gzip compression for responses
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
app.use(cookieParser());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting (configurable)
const RATE_LIMIT_WINDOW_MIN = parseInt(process.env.RATE_LIMIT_WINDOW_MIN || '15', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  max: RATE_LIMIT_MAX
});
app.use('/api/', limiter);

// Health check endpoint (for Railway health checks)
let isServerReady = false;
app.get('/health', (req, res) => {
  if (!isServerReady) {
    return res.status(503).json({ status: 'starting', message: 'Server is initializing...' });
  }
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'RUT200 Router Logger API',
    version: '2.0.0',
    endpoints: {
      routers: '/api/routers',
      logs: '/api/logs',
      submitLog: 'POST /api/log',
      usageStats: '/api/stats/usage',
      uptimeStats: '/api/stats/uptime',
      storageStats: '/api/stats/storage',
      topRouters: '/api/stats/top-routers',
      networkUsage: '/api/stats/network-usage',
      networkUsageRolling: '/api/stats/network-usage-rolling',
      operatorDistribution: '/api/stats/operators',
      oauthLogin: '/api/auth/rms/login',
      oauthStatus: '/api/auth/rms/status',
      rmsUsageMonitoring: '/api/monitoring/rms-usage',
      guestWifi: '/api/guests',
      captivePortalWebhook: 'POST /api/guests/captive-portal/event'
    }
  });
});

// Guest WiFi routes (webhook + API for session queries)
app.use('/api/guests', guestWifiRoutes);

// Other API routes
app.use('/api/rms', rmsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/clickup', clickupRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/users', userRoutes);
app.use('/api', routerRoutes);
app.use(monitoringRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Error caught by middleware:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(err.status || 500).json({
    error: isProduction ? 'Something went wrong!' : err.message,
    ...(isProduction ? {} : { stack: err.stack })
  });
});

/**
 * Diagnostic: Check network usage calculations
 */
async function runNetworkUsageDiagnostic() {
  const { pool } = require('./config/database');
  const routerStats = require('./models/routerStats');

  try {
    logger.info('🔍 Running network usage diagnostic...');

    // Check raw cumulative values for top routers
    const rawResult = await pool.query(`
      SELECT
        r.router_id,
        r.name,
        (SELECT total_tx_bytes FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as latest_tx,
        (SELECT total_rx_bytes FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as latest_rx,
        (SELECT total_tx_bytes FROM router_logs WHERE router_id = r.router_id AND timestamp < NOW() - INTERVAL '24 hours' ORDER BY timestamp DESC LIMIT 1) as tx_24h_ago,
        (SELECT total_rx_bytes FROM router_logs WHERE router_id = r.router_id AND timestamp < NOW() - INTERVAL '24 hours' ORDER BY timestamp DESC LIMIT 1) as rx_24h_ago
      FROM routers r
      WHERE EXISTS (SELECT 1 FROM router_logs WHERE router_id = r.router_id)
      LIMIT 5
    `);

    logger.info('📊 Raw cumulative values (top 5 routers):');
    for (const row of rawResult.rows) {
      const delta_tx = (Number(row.latest_tx) || 0) - (Number(row.tx_24h_ago) || 0);
      const delta_rx = (Number(row.latest_rx) || 0) - (Number(row.rx_24h_ago) || 0);
      const formatBytes = (b) => {
        const n = Number(b) || 0;
        if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
        return n + ' B';
      };
      logger.info(`   ${row.name}: Latest TX=${formatBytes(row.latest_tx)}, RX=${formatBytes(row.latest_rx)} | 24h Delta: TX=${formatBytes(delta_tx)}, RX=${formatBytes(delta_rx)}`);
    }

    // Check the aggregated 24h network usage
    const usage24h = await routerStats.getNetworkUsageRolling(24, 'hour');
    const total24h = usage24h.reduce((s, d) => s + (Number(d.total_bytes) || 0), 0);
    const formatBytes = (b) => {
      const n = Number(b) || 0;
      if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
      if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
      return n + ' B';
    };
    logger.info(`📈 Aggregated 24h network usage: ${formatBytes(total24h)} (${usage24h.length} hourly buckets)`);

  } catch (error) {
    logger.warn('Network usage diagnostic failed (non-fatal):', error.message);
  }
}

/**
 * Diagnostic: Check captive portal integration status on startup
 */
async function runCaptivePortalDiagnostic() {
  const { pool } = require('./config/database');

  try {
    logger.info('🔍 Running captive portal diagnostic...');

    // Check wifi_guest_sessions table
    const sessionsResult = await pool.query(`
      SELECT
        COUNT(*) as total_sessions,
        COUNT(*) FILTER (WHERE session_end IS NULL) as active_sessions,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h_sessions
      FROM wifi_guest_sessions
    `);
    const sessions = sessionsResult.rows[0];
    logger.info(`📊 Guest WiFi Sessions - Total: ${sessions.total_sessions}, Active: ${sessions.active_sessions}, Last 24h: ${sessions.last_24h_sessions}`);

    // Show recent sessions if any
    const recentResult = await pool.query(`
      SELECT username, email, user_mac, router_id, event_type, created_at
      FROM wifi_guest_sessions
      ORDER BY created_at DESC
      LIMIT 5
    `);
    if (recentResult.rows.length > 0) {
      logger.info('📋 Recent sessions:');
      recentResult.rows.forEach(row => {
        logger.info(`   - ${row.username || row.email || 'unknown'} (${row.event_type}) @ ${row.created_at}`);
      });
    } else {
      logger.warn('⚠️  No guest sessions found - webhook may not be receiving events');
      logger.info('   Expected webhook endpoint: POST /api/guests/captive-portal/event');
    }

    // Check if RADIUS sync is configured
    if (process.env.RADIUS_DB_HOST || process.env.RADIUS_DB_PASS) {
      logger.info('✅ RADIUS database configured - accounting sync enabled');
    } else {
      logger.info('ℹ️  RADIUS database not configured (expected if self-hosted)');
    }

  } catch (error) {
    logger.warn('Diagnostic failed (non-fatal):', error.message);
  }
}

// Initialize database and start server
async function startServer() {
  try {
    await initializeDatabase();
    logger.info('Database initialized successfully');
    
    // Run all pending migrations automatically
    await runMigrations();
    
    // Initialize MQTT if configured
    initMQTT();
    
    // Start RMS sync if PAT or OAuth token is available
    const rmsSyncInterval = process.env.RMS_SYNC_INTERVAL_MINUTES || 5;
    let canSync = false;
    if (process.env.RMS_ACCESS_TOKEN) {
      canSync = true;
      logger.info('RMS sync enabled via PAT');
    } else {
      const token = await oauthService.getValidToken('default_rms_user');
      if (token) {
        canSync = true;
        logger.info('RMS sync enabled via OAuth');
      } else {
        logger.warn('⚠️ RMS sync not started - no PAT or OAuth token available');
        logger.warn('⚠️ To enable RMS sync, either set RMS_ACCESS_TOKEN env var or complete OAuth at /api/rms/oauth/start');
      }
    }
    if (canSync) {
      const syncStarted = await startRMSSync(parseInt(rmsSyncInterval));
      if (syncStarted) {
        logger.info(`✅ RMS sync scheduler started successfully (every ${rmsSyncInterval} minutes)`);
      } else {
        logger.error('❌ RMS sync scheduler FAILED to start - check distributed lock status');
      }
    }
    
    // Start ClickUp sync (every 30 minutes by default)
    const clickupSyncInterval = process.env.CLICKUP_SYNC_INTERVAL_MINUTES || 30;
    startClickUpSync(parseInt(clickupSyncInterval), false);
    logger.info(`ClickUp sync scheduler startup attempted (every ${clickupSyncInterval} minutes, no startup sync)`);
    

    // Cleanup expired OAuth states every hour
    setInterval(async () => {
      try {
        const result = await require('./config/database').pool.query(
          'DELETE FROM oauth_state_store WHERE expires_at < NOW()'
        );
        if (result.rowCount > 0) {
          logger.info(`Cleaned up ${result.rowCount} expired OAuth states`);
        }
      } catch (error) {
        logger.warn('Failed to cleanup expired OAuth states:', { error: error.message });
      }
    }, 60 * 60 * 1000);

    // RADIUS accounting sync every 2 minutes
    const radiusSync = require('./services/radiusAccountingSync');
    setInterval(async () => {
      try {
        const result = await radiusSync.syncAllActiveSessions();
        if (result.synced > 0 || result.errors > 0) {
          logger.info(`RADIUS accounting sync: ${result.synced} synced, ${result.errors} errors`);
        }
      } catch (error) {
        logger.debug('RADIUS accounting sync skipped:', error.message);
      }
    }, 2 * 60 * 1000); // Every 2 minutes
    
    // One-time log integrity check for the last 7 days
    try {
      logger.info('📊 LOG INTEGRITY CHECK — Last 7 days');
      
      // Daily log counts and router counts
      const dailyResult = await pool.query(`
        SELECT 
          DATE(timestamp) as log_date,
          COUNT(*) as log_count,
          COUNT(DISTINCT router_id) as router_count,
          MIN(timestamp) as first_log,
          MAX(timestamp) as last_log
        FROM router_logs
        WHERE timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(timestamp)
        ORDER BY log_date
      `);
      
      if (dailyResult.rows.length === 0) {
        logger.warn('   ⚠️  NO LOGS found in the last 7 days!');
      } else {
        dailyResult.rows.forEach(row => {
          const date = new Date(row.log_date).toISOString().split('T')[0];
          logger.info(`   ${date}: ${row.log_count} logs from ${row.router_count} routers (${row.first_log.toISOString().substr(11,8)} → ${row.last_log.toISOString().substr(11,8)})`);
        });
      }

      // Total stats
      const totalResult = await pool.query(`
        SELECT 
          COUNT(*) as total_logs,
          COUNT(DISTINCT router_id) as total_routers,
          COUNT(DISTINCT DATE(timestamp)) as days_with_data
        FROM router_logs
        WHERE timestamp >= NOW() - INTERVAL '7 days'
      `);
      const t = totalResult.rows[0];
      logger.info(`   TOTAL: ${t.total_logs} logs, ${t.total_routers} routers, ${t.days_with_data}/7 days with data`);
      
      // Check for gaps (hours with no logs in the last 48h)
      const gapResult = await pool.query(`
        WITH hours AS (
          SELECT generate_series(
            date_trunc('hour', NOW() - INTERVAL '48 hours'),
            date_trunc('hour', NOW()),
            '1 hour'::interval
          ) as hour_start
        ),
        hourly_counts AS (
          SELECT h.hour_start, COUNT(l.id) as cnt
          FROM hours h
          LEFT JOIN router_logs l ON l.timestamp >= h.hour_start AND l.timestamp < h.hour_start + INTERVAL '1 hour'
          GROUP BY h.hour_start
        )
        SELECT hour_start, cnt FROM hourly_counts WHERE cnt = 0 ORDER BY hour_start
      `);
      
      if (gapResult.rows.length === 0) {
        logger.info('   ✅ No gaps found in last 48 hours — every hour has log data');
      } else {
        logger.warn(`   ⚠️  ${gapResult.rows.length} hours with ZERO logs in the last 48h:`);
        gapResult.rows.forEach(row => {
          logger.warn(`      ${new Date(row.hour_start).toISOString()}`);
        });
      }
      
      // router_current_status table check
      const statusResult = await pool.query(`
        SELECT 
          COUNT(*) as total_rows,
          MAX(updated_at) as newest_update,
          MIN(updated_at) as oldest_update,
          COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '1 hour') as updated_last_hour
        FROM router_current_status
      `);
      const s = statusResult.rows[0];
      const newestAge = s.newest_update ? ((Date.now() - new Date(s.newest_update).getTime()) / 60000).toFixed(1) : 'N/A';
      logger.info(`   router_current_status: ${s.total_rows} rows, newest ${newestAge} min ago, ${s.updated_last_hour} updated in last hour`);
      
      // Partition check
      const partResult = await pool.query(`
        SELECT c.relname as partition_name
        FROM pg_class c 
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class parent ON parent.oid = i.inhparent
        WHERE parent.relname = 'router_logs' AND n.nspname = 'public'
        ORDER BY c.relname
      `);
      if (partResult.rows.length > 0) {
        logger.info(`   Partitions: ${partResult.rows.map(r => r.partition_name).join(', ')}`);
      } else {
        logger.info('   router_logs is not partitioned (or no child tables found)');
      }
      
      // RMS sync health status
      const syncIntervalMinutes = parseInt(process.env.RMS_SYNC_INTERVAL_MINUTES || '5', 10);
      const threshold = syncIntervalMinutes * 3 + 15;
      logger.info(`   Sync healthy threshold: ${threshold} min (interval=${syncIntervalMinutes}×3+15)`);
      logger.info(`   Status endpoint will report: healthy=${newestAge !== 'N/A' && parseFloat(newestAge) < threshold}`);
      
    } catch (diagErr) {
      logger.warn('Log integrity check failed:', diagErr.message);
    }

    // Run startup diagnostic for captive portal integration
    await runCaptivePortalDiagnostic();

    // Run network usage diagnostic
    await runNetworkUsageDiagnostic();

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`🚀 Server is running on http://localhost:${PORT}`);
      isServerReady = true;
      logger.info(`📊 Ready to receive RUT200 telemetry via:`);
      logger.info(`   - MQTT (if configured)`);
      logger.info(`   - HTTPS POST to /api/log`);
      logger.info(`   - RMS API Sync (if configured)`);
      logger.info(`📶 Guest WiFi captive portal webhook ready`);
      logger.info(`📡 RADIUS accounting auto-sync enabled (every 2 minutes)`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`${signal} received: shutting down gracefully...`);
  
  try {
    // Stop accepting new connections
    closeMQTT();
    
    // Release distributed locks
    await distributedLockService.releaseAll().catch(() => {});
    
    // Close database pool
    const { gracefulShutdown } = require('./config/database');
    await gracefulShutdown();
    
    logger.info('Graceful shutdown complete');
  } catch (err) {
    // Ignore shutdown errors
  }
  
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer();

module.exports = app;
