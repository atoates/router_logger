require('dotenv').config();
// Force redeploy: 2025-11-07 18:50 UTC
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { logger } = require('./config/database');
const { initializeDatabase, runMigrations } = require('./database/migrate');
const { initMQTT, closeMQTT } = require('./services/mqttService');
const { startRMSSync } = require('./services/rmsSync');
const { startClickUpSync } = require('./services/clickupSync');
const { startSyncScheduler: startIronWifiSync } = require('./services/ironwifiSync');
const distributedLockService = require('./services/distributedLockService');
const oauthService = require('./services/oauthService');
const routerRoutes = require('./routes/router');
const rmsRoutes = require('./routes/rms');
const authRoutes = require('./routes/auth');
const clickupRoutes = require('./routes/clickup');
const sessionRoutes = require('./routes/session');
const userRoutes = require('./routes/users');
const ironwifiWebhookRoutes = require('./routes/ironwifiWebhook');
const { router: monitoringRoutes } = require('./routes/monitoring');

// Async error handler utility available at: ./utils/asyncHandler.js
// Usage: router.get('/path', asyncHandler(async (req, res) => { ... }));

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
// In production: require FRONTEND_URL (fail if missing)
// Supports multiple origins: FRONTEND_URL (desktop) + MOBILE_FRONTEND_URL (mobile)
// In development: allow wildcard for local testing
const corsOrigin = (() => {
  if (process.env.NODE_ENV === 'production') {
    // Production: require explicit FRONTEND_URL
    if (!process.env.FRONTEND_URL) {
      logger.warn('⚠️  FRONTEND_URL not set in production - CORS will reject all origins');
      return false; // Reject all origins if not configured
    }
    
    // Support multiple origins: desktop + mobile
    const origins = [process.env.FRONTEND_URL];
    if (process.env.MOBILE_FRONTEND_URL) {
      origins.push(process.env.MOBILE_FRONTEND_URL);
      logger.info(`✅ CORS configured for desktop (${process.env.FRONTEND_URL}) and mobile (${process.env.MOBILE_FRONTEND_URL})`);
    } else {
      logger.info(`✅ CORS configured for desktop: ${process.env.FRONTEND_URL}`);
    }
    
    // Return array of allowed origins (cors library handles this natively)
    return origins;
  } else {
    // Development: allow wildcard for local testing
    return process.env.FRONTEND_URL || '*';
  }
})();

// Middleware
app.use(helmet());
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
// Returns 503 until server is fully initialized, then 200
let isServerReady = false;
app.get('/health', (req, res) => {
  if (!isServerReady) {
    return res.status(503).json({ status: 'starting', message: 'Server is initializing...' });
  }
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'RUT200 Router Logger API',
    version: '1.0.1', // Updated with OAuth support
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
      rmsUsageMonitoring: '/api/monitoring/rms-usage'
    }
  });
});

app.use('/api', routerRoutes);
app.use('/api/rms', rmsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/clickup', clickupRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ironwifi', ironwifiWebhookRoutes); // Webhook-only (no API polling)
app.use(monitoringRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  // Log full error details (always log for debugging)
  logger.error('Error caught by middleware:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  // In production, don't expose stack traces to clients
  // In development, include more details for debugging
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(err.status || 500).json({
    error: isProduction ? 'Something went wrong!' : err.message,
    ...(isProduction ? {} : { stack: err.stack })
  });
});

// Initialize database and start server
async function startServer() {
  try {
    await initializeDatabase();
    logger.info('Database initialized successfully');
    
    // Run all pending migrations automatically
    await runMigrations();
    
    // Admin users are now managed through the Users Management page
    // Migration 008 creates initial admin users via seed_admins.js
    // No need to update passwords on every server restart
    
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
    // Don't run on startup - all data is persistent in database
    // This avoids delaying deployments by 3+ minutes
    const clickupSyncInterval = process.env.CLICKUP_SYNC_INTERVAL_MINUTES || 30;
    startClickUpSync(parseInt(clickupSyncInterval), false); // lock-gated
    logger.info(`ClickUp sync scheduler startup attempted (every ${clickupSyncInterval} minutes, no startup sync)`);
    
    // IronWifi: Supports both Webhook and API polling
    // Webhook: Configure in IronWifi Console → Reports → Report Scheduler
    // API Polling: Set IRONWIFI_API_KEY environment variable
    const ironwifiSyncInterval = parseInt(process.env.IRONWIFI_SYNC_INTERVAL_MINUTES || '15', 10);
    if (process.env.IRONWIFI_API_KEY) {
      startIronWifiSync(ironwifiSyncInterval);
      logger.info(`IronWifi sync scheduler started (every ${ironwifiSyncInterval} minutes)`);
    } else {
      logger.info('IronWifi API sync not started (IRONWIFI_API_KEY not set)');
    }
    logger.info('IronWifi webhook endpoint ready at /api/ironwifi/webhook');
    
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
    }, 60 * 60 * 1000); // 1 hour
    
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`🚀 Server is running on http://localhost:${PORT}`);
      // Mark server as ready for health checks
      isServerReady = true;
      logger.info(`📊 Ready to receive RUT200 telemetry via:`);
      logger.info(`   - MQTT (if configured)`);
      logger.info(`   - HTTPS POST to /api/log`);
      logger.info(`   - RMS API Sync (if configured)`);
      logger.info(`   - IronWifi Session Sync (if configured)`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  closeMQTT();
  distributedLockService.releaseAll().catch(() => {});
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  closeMQTT();
  distributedLockService.releaseAll().catch(() => {});
  process.exit(0);
});

startServer();

module.exports = app;
