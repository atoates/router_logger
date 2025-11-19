const { pool, logger } = require('../config/database');
const fs = require('fs');
const path = require('path');

// Initialize database tables from schema file
async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    logger.info('Initializing database schema...');
    
    // Read and execute the complete schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    await client.query(schema);
    
    logger.info('✅ Database schema initialized successfully');

    // Create settings table for system configuration
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Insert default value for smart sync (enabled by default)
    await client.query(`
      INSERT INTO settings (key, value, description)
      VALUES ('smart_sync_enabled', 'true', 'Enable smart sync to skip ClickUp updates for routers that haven''t changed')
      ON CONFLICT (key) DO NOTHING;
    `);

    logger.info('Database tables created successfully');
  } catch (error) {
    logger.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create migrations tracking table
 */
async function createMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW()
    );
  `);
  logger.info('Migrations tracking table ready');
}

/**
 * Get list of already-applied migrations
 */
async function getAppliedMigrations() {
  const result = await pool.query('SELECT filename FROM migrations ORDER BY id');
  return result.rows.map(row => row.filename);
}

/**
 * Mark a migration as applied
 */
async function recordMigration(filename) {
  await pool.query(
    'INSERT INTO migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
    [filename]
  );
}

/**
 * Run a single SQL migration file
 */
async function runSQLMigration(filePath, filename) {
  const sql = fs.readFileSync(filePath, 'utf8');
  await pool.query(sql);
  await recordMigration(filename);
  logger.info(`✅ Applied migration: ${filename}`);
}

/**
 * Run a single JavaScript migration file
 */
async function runJSMigration(filePath, filename) {
  const migration = require(filePath);
  if (typeof migration.up !== 'function') {
    throw new Error(`Migration ${filename} is missing 'up' function`);
  }
  await migration.up(pool);
  await recordMigration(filename);
  logger.info(`✅ Applied migration: ${filename}`);
}

/**
 * Run all pending migrations in order
 */
async function runMigrations() {
  try {
    // Ensure migrations table exists
    await createMigrationsTable();
    
    // Get list of already-applied migrations
    const appliedMigrations = await getAppliedMigrations();
    logger.info(`Found ${appliedMigrations.length} previously applied migrations`);
    
    // Get all migration files and sort them
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql') || f.endsWith('.js'))
      .sort(); // Alphabetical order (relies on numeric prefixes like 005_, 006_, etc.)
    
    logger.info(`Found ${files.length} total migration files`);
    
    // Run pending migrations
    let appliedCount = 0;
    for (const filename of files) {
      if (appliedMigrations.includes(filename)) {
        logger.debug(`Skipping already-applied migration: ${filename}`);
        continue;
      }
      
      const filePath = path.join(migrationsDir, filename);
      logger.info(`Running migration: ${filename}`);
      
      try {
        if (filename.endsWith('.sql')) {
          await runSQLMigration(filePath, filename);
        } else if (filename.endsWith('.js')) {
          await runJSMigration(filePath, filename);
        }
        appliedCount++;
      } catch (error) {
        // Check if error is due to duplicate objects (safe to ignore and record)
        const safeErrorCodes = ['42701', '42P07', '42P16', '42710', '42P17'];
        
        if (safeErrorCodes.includes(error.code)) {
          logger.info(`Migration ${filename} already applied (duplicate object), recording...`);
          await recordMigration(filename);
        } else {
          logger.error(`Failed to apply migration ${filename}:`, {
            message: error.message,
            code: error.code,
            detail: error.detail
          });
          // Don't throw - log error but continue server startup
          // This matches the old behavior where server continues even if migrations fail
        }
      }
    }
    
    if (appliedCount > 0) {
      logger.info(`✅ Successfully applied ${appliedCount} new migration(s)`);
    } else {
      logger.info('✅ All migrations up to date');
    }
    
  } catch (error) {
    logger.error('Migration system failed:', error);
    // Don't throw - log error but allow server to start
    // This matches the old behavior where failures don't crash the server
    logger.warn('⚠️  Server will continue despite migration errors');
  }
}

module.exports = { initializeDatabase, runMigrations };
