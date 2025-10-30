const { pool } = require('../config/database');

// Initialize database tables
async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    // Create routers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS routers (
        id SERIAL PRIMARY KEY,
        router_id VARCHAR(255) UNIQUE NOT NULL,
        device_serial VARCHAR(255),
        imei VARCHAR(255),
        name VARCHAR(255),
        location VARCHAR(255),
        site_id VARCHAR(255),
        firmware_version VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create router_logs table (RUT200 telemetry format)
    await client.query(`
      CREATE TABLE IF NOT EXISTS router_logs (
        id SERIAL PRIMARY KEY,
        router_id VARCHAR(255) NOT NULL,
        imei VARCHAR(255),
        timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        
        -- WAN & Network Info
        wan_ip VARCHAR(45),
        operator VARCHAR(100),
        mcc VARCHAR(10),
        mnc VARCHAR(10),
        network_type VARCHAR(50),
        
        -- Cell Tower Info
        lac VARCHAR(50),
        tac VARCHAR(50),
        cell_id VARCHAR(50),
        rsrp INTEGER,
        rsrq INTEGER,
        rssi INTEGER,
        sinr INTEGER,
        
        -- Location (enriched from cell tower)
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        location_accuracy VARCHAR(50),
        
        -- Data Counters (cumulative)
        total_tx_bytes BIGINT DEFAULT 0,
        total_rx_bytes BIGINT DEFAULT 0,
        
        -- Device Status
        uptime_seconds INTEGER DEFAULT 0,
        firmware_version VARCHAR(100),
        cpu_usage DECIMAL(5,2),
        memory_free INTEGER,
        status VARCHAR(50) DEFAULT 'online',
        
        -- Wi-Fi Clients (JSON array)
        wifi_clients JSONB,
        wifi_client_count INTEGER DEFAULT 0,
        
        -- Additional data
        raw_data JSONB,
        
        FOREIGN KEY (router_id) REFERENCES routers(router_id) ON DELETE CASCADE
      );
    `);

    // Add extra columns for additional RMS data (idempotent)
    await client.query(`ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS iccid VARCHAR(32);`);
    await client.query(`ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS imsi VARCHAR(32);`);
    await client.query(`ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS cpu_temp_c DECIMAL(5,2);`);
    await client.query(`ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS board_temp_c DECIMAL(5,2);`);
    await client.query(`ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS input_voltage_mv INTEGER;`);
    await client.query(`ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS conn_uptime_seconds INTEGER;`);
    await client.query(`ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS wan_type VARCHAR(50);`);
    await client.query(`ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS wan_ipv6 VARCHAR(45);`);
    await client.query(`ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS vpn_status VARCHAR(50);`);
    await client.query(`ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS vpn_name VARCHAR(100);`);
    await client.query(`ALTER TABLE router_logs ADD COLUMN IF NOT EXISTS eth_link_up BOOLEAN;`);

    // Add rms_created_at column to routers table for RMS device creation date (used for inspection tracking)
    await client.query(`ALTER TABLE routers ADD COLUMN IF NOT EXISTS rms_created_at TIMESTAMP;`);

    // Create inspection_logs table to track device inspections
    await client.query(`
      CREATE TABLE IF NOT EXISTS inspection_logs (
        id SERIAL PRIMARY KEY,
        router_id VARCHAR(255) NOT NULL,
        inspected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        inspected_by VARCHAR(255),
        notes TEXT,
        FOREIGN KEY (router_id) REFERENCES routers(router_id) ON DELETE CASCADE
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inspection_logs_router_id 
      ON inspection_logs(router_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inspection_logs_inspected_at 
      ON inspection_logs(inspected_at DESC);
    `);

    // Create oauth_tokens table for RMS OAuth authentication
    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL UNIQUE,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_type VARCHAR(50) DEFAULT 'Bearer',
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        scope TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_id 
      ON oauth_tokens(user_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires_at 
      ON oauth_tokens(expires_at);
    `);

    // Create trigger for oauth_tokens updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION update_oauth_tokens_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS oauth_tokens_updated_at ON oauth_tokens;
    `);

    await client.query(`
      CREATE TRIGGER oauth_tokens_updated_at
      BEFORE UPDATE ON oauth_tokens
      FOR EACH ROW
      EXECUTE FUNCTION update_oauth_tokens_updated_at();
    `);

    // Create indexes for better query performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_router_logs_router_id 
      ON router_logs(router_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_router_logs_timestamp 
      ON router_logs(timestamp);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_router_logs_router_timestamp 
      ON router_logs(router_id, timestamp);
    `);

    // Performance indexes for common query patterns (Migration 006)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_router_logs_router_ts 
      ON router_logs (router_id, timestamp DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_router_logs_ts 
      ON router_logs (timestamp DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inspection_logs_router_ts 
      ON inspection_logs (router_id, inspected_at DESC);
    `);

    // Migration 007: ClickUp integration support
    await client.query(`
      ALTER TABLE routers 
        ADD COLUMN IF NOT EXISTS clickup_task_id VARCHAR(50),
        ADD COLUMN IF NOT EXISTS clickup_task_url TEXT,
        ADD COLUMN IF NOT EXISTS clickup_list_id VARCHAR(50);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_routers_clickup_task 
        ON routers(clickup_task_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS clickup_oauth_tokens (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        access_token TEXT NOT NULL,
        token_type VARCHAR(50) DEFAULT 'Bearer',
        workspace_id VARCHAR(50),
        workspace_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_clickup_tokens_user 
        ON clickup_oauth_tokens(user_id);
    `);

    // Migration 008: Router-Property tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS router_property_assignments (
        id SERIAL PRIMARY KEY,
        router_id VARCHAR(50) NOT NULL,
        property_clickup_task_id VARCHAR(50) NOT NULL,
        property_name VARCHAR(255),
        installed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        removed_at TIMESTAMP,
        notes TEXT,
        installed_by VARCHAR(100),
        removed_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_router_property_router 
          FOREIGN KEY (router_id) 
          REFERENCES routers(router_id) 
          ON DELETE CASCADE,
        CONSTRAINT check_property_dates 
          CHECK (removed_at IS NULL OR removed_at >= installed_at)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_property_assignments_router 
        ON router_property_assignments(router_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_property_assignments_property 
        ON router_property_assignments(property_clickup_task_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_property_assignments_current 
        ON router_property_assignments(router_id, removed_at);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_assignment 
        ON router_property_assignments(router_id) 
        WHERE removed_at IS NULL;
    `);

    await client.query(`
      ALTER TABLE routers 
        ADD COLUMN IF NOT EXISTS current_property_task_id VARCHAR(50),
        ADD COLUMN IF NOT EXISTS current_property_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS property_installed_at TIMESTAMP;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_routers_current_property 
        ON routers(current_property_task_id);
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
