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

// Backwards compatibility: RADIUS server sends to /api/ironwifi/* endpoints
// Route these to the new /api/guests/* handlers
app.use('/api/ironwifi', guestWifiRoutes);

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
      logger.info('   Or legacy endpoint: POST /api/ironwifi/captive-portal/event');
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
        logger.info('RMS sync not started yet (no PAT or OAuth token)');
      }
    }
    if (canSync) {
      await startRMSSync(parseInt(rmsSyncInterval));
      logger.info('RMS sync scheduler startup attempted');
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
