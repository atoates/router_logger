/**
 * Run database migration 008 - Add property tracking
 * This creates the router_property_assignments table and adds property columns to routers table
 * 
 * Usage: 
 *   Production: DATABASE_URL=<prod-url> node run-migration-008.js
 *   Local: node run-migration-008.js (uses .env)
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false
  });

  try {
    console.log('Running migration 008: Add property tracking...\n');

    // Read migration SQL
    const migrationPath = path.join(__dirname, 'src/database/migrations/008_add_property_tracking.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute migration
    await pool.query(migrationSQL);

    console.log('✅ Migration completed successfully!\n');
    console.log('Created:');
    console.log('  - router_property_assignments table');
    console.log('  - Indexes for efficient queries');
    console.log('  - Added property columns to routers table');
    console.log('  - Unique constraint for active assignments\n');

    // Verify tables
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name = 'router_property_assignments'
    `);

    if (tableCheck.rows.length > 0) {
      console.log('✅ Verified: router_property_assignments table exists');
    }

    // Check columns
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'routers' 
        AND column_name IN ('current_property_task_id', 'current_property_name', 'property_installed_at')
    `);

    console.log(`✅ Verified: ${columnCheck.rows.length}/3 property columns added to routers table\n`);

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
