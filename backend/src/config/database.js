const { Pool } = require('pg');
const winston = require('winston');

// Database connection pool with configurable settings
// Railway default VMs can handle 20-50 connections easily
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,
  // Pool size configuration - increase for better throughput
  max: parseInt(process.env.DB_POOL_MAX || '20', 10), // Default: 10, increase for more concurrent queries
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),  // Keep some connections warm
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10), // 30s idle timeout
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '5000', 10), // 5s connect timeout
  // Statement timeout to prevent runaway queries (optional)
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '60000', 10) // 60s max query time
});

// Handle pool errors gracefully (e.g., connection terminated during deployment)
pool.on('error', (err, client) => {
  // 57P01 = admin_shutdown (connection terminated by administrator)
  // This happens during deployments when old containers are killed
  if (err.code === '57P01') {
    console.warn('Database connection terminated (deployment in progress)');
  } else {
    console.error('Unexpected database pool error:', err.message);
  }
  // Don't crash - the pool will create new connections as needed
});

// Track if we're shutting down to avoid noisy logs
let isShuttingDown = false;

const gracefulShutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  try {
    await pool.end();
    console.log('Database pool closed gracefully');
  } catch (err) {
    // Ignore errors during shutdown
  }
};

// Export shutdown function for server.js to use
module.exports.gracefulShutdown = gracefulShutdown;

// Logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Only add file transports in development (Railway has ephemeral storage)
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.File({ filename: 'error.log', level: 'error' }));
  logger.add(new winston.transports.File({ filename: 'combined.log' }));
}

module.exports = { pool, logger };
