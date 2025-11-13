require('dotenv').config();
// Force redeploy: 2025-11-07 18:50 UTC
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { logger } = require('./config/database');
const { initializeDatabase } = require('./database/migrate');
const { initMQTT, closeMQTT } = require('./services/mqttService');
const { startRMSSync } = require('./services/rmsSync');
const { startClickUpSync } = require('./services/clickupSync');
const oauthService = require('./services/oauthService');
const routerRoutes = require('./routes/router');
const rmsRoutes = require('./routes/rms');
const authRoutes = require('./routes/auth');
const clickupRoutes = require('./routes/clickup');
const sessionRoutes = require('./routes/session');
const userRoutes = require('./routes/users');
const ironwifiWebhookRoutes = require('./routes/ironwifiWebhook');
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
// In production: require FRONTEND_URL (fail if missing)
// In development: allow wildcard for local testing
const corsOrigin = (() => {
  if (process.env.NODE_ENV === 'production') {
    // Production: require explicit FRONTEND_URL
    if (!process.env.FRONTEND_URL) {
      logger.warn('⚠️  FRONTEND_URL not set in production - CORS will reject all origins');
      return false; // Reject all origins if not configured
    }
    return process.env.FRONTEND_URL;
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
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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
    
    // Get pool for migrations and seeding
    const fs = require('fs');
    const path = require('path');
    const { pool } = require('./config/database');
    
    // Run migrations on startup
    try {
      logger.info('Running database migrations...');
      
      // Run migration 007 (IronWifi tables)
      const migration007Path = path.join(__dirname, '../database/migrations/007_add_ironwifi_tables.sql');
      if (fs.existsSync(migration007Path)) {
        const sql = fs.readFileSync(migration007Path, 'utf8');
        await pool.query(sql);
        logger.info('✅ Migration 007_add_ironwifi_tables.sql completed successfully');
      }
      
      // Run migration 008 (User authentication)
      const migration008Path = path.join(__dirname, '../database/migrations/008_add_user_authentication.sql');
      if (fs.existsSync(migration008Path)) {
        const sql = fs.readFileSync(migration008Path, 'utf8');
        await pool.query(sql);
        logger.info('✅ Migration 008_add_user_authentication.sql completed successfully');
      }
    } catch (migrationError) {
      // Check if error is because columns/tables/triggers already exist (safe to ignore)
      // 42701 = duplicate column
      // 42P07 = duplicate table
      // 42P16 = invalid table definition
      // 42710 = duplicate object (triggers, functions, etc)
      const safeErrorCodes = ['42701', '42P07', '42P16', '42710'];
      
      if (safeErrorCodes.includes(migrationError.code)) {
        logger.info('Migration already applied (duplicate object exists), skipping');
      } else {
        logger.error('Migration failed:', {
          message: migrationError.message,
          code: migrationError.code,
          detail: migrationError.detail,
          stack: migrationError.stack
        });
        // Don't exit - allow server to start anyway
      }
    }
    
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
      startRMSSync(parseInt(rmsSyncInterval));
      logger.info('RMS sync scheduler started');
    }
    
    // Start ClickUp sync (every 30 minutes by default)
    // Don't run on startup - all data is persistent in database
    // This avoids delaying deployments by 3+ minutes
    const clickupSyncInterval = process.env.CLICKUP_SYNC_INTERVAL_MINUTES || 30;
    startClickUpSync(parseInt(clickupSyncInterval), false); // false = skip initial sync
    logger.info(`ClickUp sync scheduler started (every ${clickupSyncInterval} minutes, no startup sync)`);
    
    // IronWifi: Webhook-only integration (no API polling)
    // Configure webhook in IronWifi Console → Reports → Report Scheduler
    // Webhook URL: /api/ironwifi/webhook
    logger.info('IronWifi webhook endpoint ready at /api/ironwifi/webhook');
    
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
      // Mark server as ready for health checks
      isServerReady = true;
      console.log(`📊 Ready to receive RUT200 telemetry via:`);
      console.log(`   - MQTT (if configured)`);
      console.log(`   - HTTPS POST to /api/log`);
      console.log(`   - RMS API Sync (if configured)`);
      console.log(`   - IronWifi Session Sync (if configured)`);
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
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  closeMQTT();
  process.exit(0);
});

startServer();

module.exports = app;
