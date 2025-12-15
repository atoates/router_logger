-- Add MAC address fields and router linking to ironwifi_guests
-- These fields come from IronWifi Guest Registrations report

-- client_mac = Calling-Station-Id = User's device MAC
ALTER TABLE ironwifi_guests ADD COLUMN IF NOT EXISTS client_mac VARCHAR(50);

-- ap_mac = Called-Station-Id = Router/AP MAC (for router linking)  
ALTER TABLE ironwifi_guests ADD COLUMN IF NOT EXISTS ap_mac VARCHAR(50);

-- router_id = Matched router from ap_mac
ALTER TABLE ironwifi_guests ADD COLUMN IF NOT EXISTS router_id INTEGER REFERENCES routers(router_id);

-- Additional context fields
ALTER TABLE ironwifi_guests ADD COLUMN IF NOT EXISTS captive_portal_name VARCHAR(255);
ALTER TABLE ironwifi_guests ADD COLUMN IF NOT EXISTS venue_id VARCHAR(100);
ALTER TABLE ironwifi_guests ADD COLUMN IF NOT EXISTS public_ip VARCHAR(50);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_client_mac ON ironwifi_guests(client_mac);
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_ap_mac ON ironwifi_guests(ap_mac);
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_router_id ON ironwifi_guests(router_id);
CREATE INDEX IF NOT EXISTS idx_ironwifi_guests_venue ON ironwifi_guests(venue_id);

