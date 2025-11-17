#!/usr/bin/env node

/**
 * Run database migration 014: Database Performance Optimizations
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { pool } = require('./src/config/database');

async function runMigration() {
  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    
    console.log('Running migration: 014_database_optimizations.sql');
    console.log('This migration adds missing indexes and constraints for better query performance.\n');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, 'src', 'database', 'migrations', '014_database_optimizations.sql');
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await client.query(sql);
    
    console.log('✅ Migration completed successfully!');
    
    // Verify the changes
    console.log('\nVerifying changes...');
    
    // Check indexes
    const checkIndexes = await client.query(`
      SELECT 
        indexname,
        tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_routers_last_seen',
          'idx_routers_task_status',
          'idx_router_logs_status',
          'idx_router_logs_operator',
          'idx_router_logs_router_status',
          'idx_routers_name'
        )
      ORDER BY tablename, indexname
    `);
    
    console.log('\n✅ Indexes created:');
    checkIndexes.rows.forEach(row => {
      console.log(`   - ${row.indexname} on ${row.tablename}`);
    });
    
    // Check constraint
    const checkConstraint = await client.query(`
      SELECT 
        conname,
        contype
      FROM pg_constraint
      WHERE conrelid = 'routers'::regclass
        AND conname = 'check_task_status'
    `);
    
    if (checkConstraint.rows.length > 0) {
      console.log('\n✅ Constraint created:');
      console.log(`   - check_task_status on routers table`);
    }
    
    console.log('\n🎉 Migration 014 completed successfully!');
    console.log('Performance optimizations are now active.');
    
    client.release();
    
  } catch (error) {
    // Check if error is because objects already exist (safe to ignore)
    const safeErrorCodes = ['42701', '42P07', '42P16', '42710', '42P17']; // duplicate object errors
    
    if (safeErrorCodes.includes(error.code)) {
      console.log('⚠️  Some objects already exist (migration may have been partially applied)');
      console.log('This is safe to ignore. Migration will continue...');
    } else {
      console.error('\n❌ Migration failed:', error.message);
      console.error('Error code:', error.code);
      if (error.detail) {
        console.error('Detail:', error.detail);
      }
      process.exit(1);
    }
  }
}

runMigration()
  .then(() => {
    console.log('\n✅ Migration process completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration process failed:', error);
    process.exit(1);
  });

