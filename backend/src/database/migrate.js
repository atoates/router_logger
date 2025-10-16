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

    console.log('Database tables created successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { initializeDatabase };
