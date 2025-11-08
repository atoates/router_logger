const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

// Initialize database tables from schema file
async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('Initializing database schema...');
    
    // Read and execute the complete schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    await client.query(schema);
    
    console.log('✅ Database schema initialized successfully');

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

    console.log('Database tables created successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { initializeDatabase };
