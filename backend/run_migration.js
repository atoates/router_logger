#!/usr/bin/env node

/**
 * Run database migration using Node.js (no psql required)
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    
    console.log('Running migration: 007_add_ironwifi_tables.sql');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, 'database', 'migrations', '007_add_ironwifi_tables.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await client.query(sql);
    
    console.log('✅ Migration completed successfully!');
    
    // Verify the changes
    console.log('\nVerifying changes...');
    
    const checkColumn = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'routers' 
        AND column_name IN ('mac_address', 'ironwifi_ap_id', 'ironwifi_ap_name')
      ORDER BY column_name
    `);
    
    console.log('✅ Columns added to routers table:');
    checkColumn.rows.forEach(row => {
      console.log(`   - ${row.column_name} (${row.data_type})`);
    });
    
    const checkTables = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
        AND tablename LIKE 'ironwifi%'
      ORDER BY tablename
    `);
    
    console.log('\n✅ IronWifi tables created:');
    checkTables.rows.forEach(row => {
      console.log(`   - ${row.tablename}`);
    });
    
    const checkView = await client.query(`
      SELECT matviewname 
      FROM pg_matviews 
      WHERE schemaname = 'public' 
        AND matviewname LIKE 'router_active%'
    `);
    
    console.log('\n✅ Materialized views created:');
    checkView.rows.forEach(row => {
      console.log(`   - ${row.matviewname}`);
    });
    
    client.release();
    await pool.end();
    
    console.log('\n🎉 Migration complete! RMS sync should now work correctly.');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
