require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') 
    ? { rejectUnauthorized: false } 
    : false
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('Running migration 013: Add date_installed column');
    
    // Run the migration SQL
    const fs = require('fs');
    const path = require('path');
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, 'src/database/migrations/013_add_date_installed.sql'),
      'utf8'
    );
    
    await client.query(migrationSQL);
    
    console.log('Migration 013 completed successfully');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
