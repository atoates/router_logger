#!/usr/bin/env node
/**
 * Manual migration runner for SQL files
 * Usage: node run-migration.js <migration-file>
 * Example: node run-migration.js src/database/migrations/006_add_performance_indexes.sql
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./src/config/database');

async function runMigration(filePath) {
  const client = await pool.connect();
  
  try {
    const fullPath = path.resolve(__dirname, filePath);
    
    if (!fs.existsSync(fullPath)) {
      console.error(`Migration file not found: ${fullPath}`);
      process.exit(1);
    }

    const sql = fs.readFileSync(fullPath, 'utf8');
    
    console.log(`Running migration: ${filePath}`);
    console.log('='.repeat(60));
    
    await client.query(sql);
    
    console.log('✓ Migration completed successfully');
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Usage: node run-migration.js <migration-file>');
  console.error('Example: node run-migration.js src/database/migrations/006_add_performance_indexes.sql');
  process.exit(1);
}

runMigration(migrationFile)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
