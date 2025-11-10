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

// Trust Railway proxy for rate limiting and secure cookies
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
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
  logger.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Initialize database and start server
async function startServer() {
  try {
    await initializeDatabase();
    logger.info('Database initialized successfully');
    
    // Run migrations on startup
    try {
      const fs = require('fs');
      const path = require('path');
      const { pool } = require('./config/database');
      
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
        
        // Update admin user passwords (fixes placeholder passwords from migration)
        try {
          const authService = require('./services/authService');
          const bcrypt = require('bcrypt');
          
          logger.info('Ensuring admin users have proper passwords...');
          
          const admin1Password = process.env.ADMIN1_PASSWORD || 'VacatAd2025!Admin1';
          const admin2Password = process.env.ADMIN2_PASSWORD || 'VacatAd2025!Admin2';
          const admin3Password = process.env.ADMIN3_PASSWORD || 'VacatAd2025!Admin3';
          
          // Hash passwords
          const admin1Hash = await bcrypt.hash(admin1Password, 10);
          const admin2Hash = await bcrypt.hash(admin2Password, 10);
          const admin3Hash = await bcrypt.hash(admin3Password, 10);
          
          // Update passwords (upsert with proper hashes)
          await pool.query(`
            INSERT INTO users (username, password_hash, role, email, full_name, is_active)
            VALUES 
              ('admin1', $1, 'admin', 'admin1@vacatracker.com', 'Administrator 1', TRUE),
              ('admin2', $2, 'admin', 'admin2@vacatracker.com', 'Administrator 2', TRUE),
              ('admin3', $3, 'admin', 'admin3@vacatracker.com', 'Administrator 3', TRUE)
            ON CONFLICT (username) 
            DO UPDATE SET 
              password_hash = EXCLUDED.password_hash,
              email = EXCLUDED.email,
              full_name = EXCLUDED.full_name,
              is_active = EXCLUDED.is_active
          `, [admin1Hash, admin2Hash, admin3Hash]);
          
          logger.info('✅ Admin user passwords updated successfully');
          logger.info('   - admin1 / VacatAd2025!Admin1');
          logger.info('   - admin2 / VacatAd2025!Admin2');
          logger.info('   - admin3 / VacatAd2025!Admin3');
        } catch (seedError) {
          logger.warn('Failed to update admin passwords:', seedError.message);
          // Don't exit - server can still start
        }
      }
    } catch (migrationError) {
      // Check if error is because columns/tables already exist (safe to ignore)
      if (migrationError.code === '42701' || migrationError.code === '42P07' || migrationError.code === '42P16') {
        logger.info('Migration already applied, skipping');
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
    
    // Initialize MQTT if configured
    initMQTT();
    
    // Start RMS sync if PAT or OAuth token is available
  const rmsSyncInterval = process.env.RMS_SYNC_INTERVAL_MINUTES || 60;
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
