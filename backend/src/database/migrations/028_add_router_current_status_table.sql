-- Migration: Add router_current_status table for fast dashboard queries
-- 
-- Problem: The getAllRouters query does 6 DISTINCT ON operations across router_logs
-- which gets slower as the table grows (currently causing 10+ second load times)
--
-- Solution: Maintain a denormalized "current status" table that's updated on each
-- telemetry insert. Dashboard queries become O(1) per router instead of O(n logs).

-- Create the current status table
CREATE TABLE IF NOT EXISTS router_current_status (
    router_id VARCHAR(50) PRIMARY KEY REFERENCES routers(router_id) ON DELETE CASCADE,
    
    -- Latest status info
    current_status VARCHAR(20),
    last_seen TIMESTAMP WITH TIME ZONE,
    last_online TIMESTAMP WITH TIME ZONE,
    
    -- Network info
    wan_ip VARCHAR(45),
    operator VARCHAR(100),
    cell_id VARCHAR(50),
    tac VARCHAR(20),
    mcc VARCHAR(10),
    mnc VARCHAR(10),
    earfcn INTEGER,
    pc_id INTEGER,
    
    -- Location
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    location_accuracy INTEGER,
    
    -- Device info
    imei VARCHAR(20),
    firmware_version VARCHAR(50),
    
    -- Metadata
    log_count INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_router_current_status_last_seen 
    ON router_current_status(last_seen DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_router_current_status_last_online 
    ON router_current_status(last_online DESC NULLS LAST);

-- Populate from existing data (one-time migration)
INSERT INTO router_current_status (
    router_id, current_status, last_seen, last_online,
    wan_ip, operator, cell_id, tac, mcc, mnc, earfcn, pc_id,
    latitude, longitude, location_accuracy,
    imei, firmware_version, log_count, updated_at
)
SELECT 
    r.router_id,
    ll.status as current_status,
    ll.timestamp as last_seen,
    lo.last_online_time as last_online,
    ll.wan_ip,
    ll.operator,
    ll.cell_id,
    ll.tac,
    ll.mcc,
    ll.mnc,
    ll.earfcn,
    ll.pc_id,
    lloc.latitude,
    lloc.longitude,
    lloc.location_accuracy,
    COALESCE(li.imei, r.imei) as imei,
    COALESCE(lf.firmware_version, r.firmware_version) as firmware_version,
    COALESCE(lc.log_count, 0) as log_count,
    NOW()
FROM routers r
LEFT JOIN LATERAL (
    SELECT status, timestamp, wan_ip, operator, cell_id, tac, mcc, mnc, earfcn, pc_id
    FROM router_logs WHERE router_id = r.router_id
    ORDER BY timestamp DESC LIMIT 1
) ll ON true
LEFT JOIN LATERAL (
    SELECT timestamp as last_online_time
    FROM router_logs WHERE router_id = r.router_id AND LOWER(TRIM(status)) IN ('online', '1', 'true')
    ORDER BY timestamp DESC LIMIT 1
) lo ON true
LEFT JOIN LATERAL (
    SELECT latitude, longitude, location_accuracy
    FROM router_logs WHERE router_id = r.router_id AND latitude IS NOT NULL
    ORDER BY timestamp DESC LIMIT 1
) lloc ON true
LEFT JOIN LATERAL (
    SELECT imei FROM router_logs WHERE router_id = r.router_id AND imei IS NOT NULL
    ORDER BY timestamp DESC LIMIT 1
) li ON true
LEFT JOIN LATERAL (
    SELECT firmware_version FROM router_logs WHERE router_id = r.router_id AND firmware_version IS NOT NULL
    ORDER BY timestamp DESC LIMIT 1
) lf ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*) as log_count FROM router_logs WHERE router_id = r.router_id
) lc ON true
ON CONFLICT (router_id) DO UPDATE SET
    current_status = EXCLUDED.current_status,
    last_seen = EXCLUDED.last_seen,
    last_online = EXCLUDED.last_online,
    wan_ip = EXCLUDED.wan_ip,
    operator = EXCLUDED.operator,
    cell_id = EXCLUDED.cell_id,
    tac = EXCLUDED.tac,
    mcc = EXCLUDED.mcc,
    mnc = EXCLUDED.mnc,
    earfcn = EXCLUDED.earfcn,
    pc_id = EXCLUDED.pc_id,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    location_accuracy = EXCLUDED.location_accuracy,
    imei = EXCLUDED.imei,
    firmware_version = EXCLUDED.firmware_version,
    log_count = EXCLUDED.log_count,
    updated_at = NOW();

-- Comment on table
COMMENT ON TABLE router_current_status IS 'Denormalized current status for each router - updated on telemetry insert for fast dashboard queries';

