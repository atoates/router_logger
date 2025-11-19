/**
 * Migration: Add last_clickup_sync_hash column for smart sync
 * Enables change detection to skip syncing unchanged routers
 */

const { logger } = require('../../config/database');

async function up(pool) {
  logger.info('Adding last_clickup_sync_hash column to routers table...');
  
  await pool.query(`
    ALTER TABLE routers 
    ADD COLUMN IF NOT EXISTS last_clickup_sync_hash TEXT;
  `);
  
  logger.info('✓ Added last_clickup_sync_hash column');
}

async function down(pool) {
  logger.info('Removing last_clickup_sync_hash column from routers table...');
  
  await pool.query(`
    ALTER TABLE routers 
    DROP COLUMN IF EXISTS last_clickup_sync_hash;
  `);
  
  logger.info('✓ Removed last_clickup_sync_hash column');
}

module.exports = { up, down };
