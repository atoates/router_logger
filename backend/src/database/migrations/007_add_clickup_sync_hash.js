/**
 * Migration: Add last_clickup_sync_hash column for smart sync
 * Enables change detection to skip syncing unchanged routers
 */

async function up(pool) {
  console.log('Adding last_clickup_sync_hash column to routers table...');
  
  await pool.query(`
    ALTER TABLE routers 
    ADD COLUMN IF NOT EXISTS last_clickup_sync_hash TEXT;
  `);
  
  console.log('✓ Added last_clickup_sync_hash column');
}

async function down(pool) {
  console.log('Removing last_clickup_sync_hash column from routers table...');
  
  await pool.query(`
    ALTER TABLE routers 
    DROP COLUMN IF EXISTS last_clickup_sync_hash;
  `);
  
  console.log('✓ Removed last_clickup_sync_hash column');
}

module.exports = { up, down };
