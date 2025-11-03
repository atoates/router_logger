#!/usr/bin/env node
/**
 * Run migration 012 - Add location task tracking
 * This can be run on Railway or locally with production DATABASE_URL
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, logger } = require('../src/config/database');

async function runMigration() {
  const client = await pool.connect();
  
  try {
    const migrationPath = path.join(__dirname, '../src/database/migrations/012_add_location_task_tracking.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('🚀 Running migration 012: Add location task tracking');
    console.log('='.repeat(60));
    
    await client.query(sql);
    
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('New fields added to routers table:');
    console.log('  - clickup_location_task_id');
    console.log('  - clickup_location_task_name');
    console.log('  - location_linked_at');
    console.log('');
    console.log('Router location tracking is now ready! 🎉');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('');
    console.error('Full error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('');
    console.log('Migration script completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('');
    console.error('Migration script failed.');
    process.exit(1);
  });
