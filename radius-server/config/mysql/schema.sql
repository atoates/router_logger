-- FreeRADIUS MySQL Schema
-- Based on official FreeRADIUS schema with extensions for captive portal

-- =====================================================
-- Core RADIUS Tables
-- =====================================================

-- Network Access Servers (Routers/APs)
CREATE TABLE IF NOT EXISTS nas (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    nasname VARCHAR(128) NOT NULL,
    shortname VARCHAR(32),
    type VARCHAR(30) DEFAULT 'other',
    ports INT,
    secret VARCHAR(60) DEFAULT 'secret',
    server VARCHAR(64),
    community VARCHAR(50),
    description VARCHAR(200) DEFAULT 'RADIUS Client',
    -- RouterLogger integration
    router_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX nasname (nasname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- User accounts (for captive portal)
CREATE TABLE IF NOT EXISTS radcheck (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT ':=',
    value VARCHAR(253) NOT NULL DEFAULT '',
    -- Extended fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX username (username(32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- User reply attributes
CREATE TABLE IF NOT EXISTS radreply (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT '=',
    value VARCHAR(253) NOT NULL DEFAULT '',
    INDEX username (username(32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Group definitions
CREATE TABLE IF NOT EXISTS radgroupcheck (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT ':=',
    value VARCHAR(253) NOT NULL DEFAULT '',
    INDEX groupname (groupname(32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Group reply attributes
CREATE TABLE IF NOT EXISTS radgroupreply (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT '=',
    value VARCHAR(253) NOT NULL DEFAULT '',
    INDEX groupname (groupname(32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- User to group mapping
CREATE TABLE IF NOT EXISTS radusergroup (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    priority INT NOT NULL DEFAULT 1,
    INDEX username (username(32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- Accounting Tables
-- =====================================================

-- RADIUS Accounting (session data)
CREATE TABLE IF NOT EXISTS radacct (
    radacctid BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    acctsessionid VARCHAR(64) NOT NULL DEFAULT '',
    acctuniqueid VARCHAR(32) NOT NULL DEFAULT '',
    username VARCHAR(64) NOT NULL DEFAULT '',
    realm VARCHAR(64) DEFAULT '',
    nasipaddress VARCHAR(15) NOT NULL DEFAULT '',
    nasportid VARCHAR(32) DEFAULT NULL,
    nasporttype VARCHAR(32) DEFAULT NULL,
    acctstarttime DATETIME NULL DEFAULT NULL,
    acctupdatetime DATETIME NULL DEFAULT NULL,
    acctstoptime DATETIME NULL DEFAULT NULL,
    acctinterval INT DEFAULT NULL,
    acctsessiontime INT UNSIGNED DEFAULT NULL,
    acctauthentic VARCHAR(32) DEFAULT NULL,
    connectinfo_start VARCHAR(128) DEFAULT NULL,
    connectinfo_stop VARCHAR(128) DEFAULT NULL,
    acctinputoctets BIGINT DEFAULT NULL,
    acctoutputoctets BIGINT DEFAULT NULL,
    calledstationid VARCHAR(50) NOT NULL DEFAULT '',
    callingstationid VARCHAR(50) NOT NULL DEFAULT '',
    acctterminatecause VARCHAR(32) NOT NULL DEFAULT '',
    servicetype VARCHAR(32) DEFAULT NULL,
    framedprotocol VARCHAR(32) DEFAULT NULL,
    framedipaddress VARCHAR(15) NOT NULL DEFAULT '',
    framedipv6address VARCHAR(45) NOT NULL DEFAULT '',
    framedipv6prefix VARCHAR(45) NOT NULL DEFAULT '',
    framedinterfaceid VARCHAR(44) NOT NULL DEFAULT '',
    delegatedipv6prefix VARCHAR(45) NOT NULL DEFAULT '',
    class VARCHAR(64) DEFAULT NULL,
    -- Extended fields for RouterLogger
    router_id VARCHAR(255),
    property_id VARCHAR(255),
    guest_name VARCHAR(255),
    guest_email VARCHAR(255),
    guest_phone VARCHAR(50),
    device_type VARCHAR(100),
    browser VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX username (username),
    INDEX framedipaddress (framedipaddress),
    INDEX acctsessionid (acctsessionid),
    INDEX acctsessiontime (acctsessiontime),
    INDEX acctstarttime (acctstarttime),
    INDEX acctinterval (acctinterval),
    INDEX acctstoptime (acctstoptime),
    INDEX nasipaddress (nasipaddress),
    INDEX callingstationid (callingstationid),
    INDEX router_id (router_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Post-auth logging
CREATE TABLE IF NOT EXISTS radpostauth (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    pass VARCHAR(64) NOT NULL DEFAULT '',
    reply VARCHAR(32) NOT NULL DEFAULT '',
    authdate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    class VARCHAR(64) DEFAULT NULL,
    INDEX username (username),
    INDEX class (class)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- Captive Portal Extensions
-- =====================================================

-- Guest registrations (captive portal users)
CREATE TABLE IF NOT EXISTS captive_guests (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    full_name VARCHAR(255),
    mac_address VARCHAR(17),
    -- Registration info
    registration_type ENUM('email', 'sms', 'social', 'voucher', 'open') DEFAULT 'email',
    verified BOOLEAN DEFAULT FALSE,
    verification_code VARCHAR(10),
    verification_expires DATETIME,
    -- Session limits
    session_timeout INT DEFAULT 86400,  -- seconds (24 hours default)
    bandwidth_limit_down INT,  -- kbps
    bandwidth_limit_up INT,    -- kbps
    data_limit BIGINT,         -- bytes
    -- Status
    status ENUM('active', 'expired', 'blocked') DEFAULT 'active',
    expires_at DATETIME,
    -- RouterLogger integration
    router_id VARCHAR(255),
    property_id VARCHAR(255),
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_seen DATETIME,
    UNIQUE INDEX username (username),
    INDEX email (email),
    INDEX mac_address (mac_address),
    INDEX router_id (router_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Voucher codes for guest access
CREATE TABLE IF NOT EXISTS captive_vouchers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(20) NOT NULL,
    batch_name VARCHAR(100),
    -- Limits
    max_uses INT DEFAULT 1,
    current_uses INT DEFAULT 0,
    session_timeout INT DEFAULT 86400,
    bandwidth_limit_down INT,
    bandwidth_limit_up INT,
    data_limit BIGINT,
    -- Validity
    valid_from DATETIME DEFAULT CURRENT_TIMESTAMP,
    valid_until DATETIME,
    status ENUM('active', 'used', 'expired', 'revoked') DEFAULT 'active',
    -- RouterLogger integration
    router_id VARCHAR(255),
    property_id VARCHAR(255),
    created_by VARCHAR(255),
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE INDEX code (code),
    INDEX batch_name (batch_name),
    INDEX status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- MAC address whitelist (bypass captive portal)
CREATE TABLE IF NOT EXISTS captive_mac_whitelist (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    mac_address VARCHAR(17) NOT NULL,
    description VARCHAR(255),
    router_id VARCHAR(255),
    property_id VARCHAR(255),
    created_by VARCHAR(255),
    expires_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE INDEX mac_address (mac_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Free tier usage tracking (prevents abuse)
CREATE TABLE IF NOT EXISTS captive_free_usage (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    -- Identifier (email, MAC, or device fingerprint)
    identifier_type ENUM('email', 'mac', 'fingerprint') NOT NULL,
    identifier_value VARCHAR(255) NOT NULL,
    -- Usage tracking
    sessions_used INT DEFAULT 1,
    total_time_used INT DEFAULT 0,  -- seconds
    last_session_start DATETIME,
    last_session_end DATETIME,
    -- Cooldown tracking
    next_free_available DATETIME,  -- When they can get free access again
    -- Location context
    router_id VARCHAR(255),
    property_id VARCHAR(255),
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX identifier (identifier_type, identifier_value),
    INDEX next_free_available (next_free_available),
    INDEX router_id (router_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Session upgrade requests (free to paid)
CREATE TABLE IF NOT EXISTS captive_upgrade_requests (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    email VARCHAR(255),
    mac_address VARCHAR(17),
    -- Current session info
    current_session_id VARCHAR(64),
    time_remaining INT,  -- seconds
    -- Upgrade info
    upgrade_type ENUM('voucher', 'payment', 'social_share') NOT NULL,
    upgrade_status ENUM('pending', 'completed', 'expired') DEFAULT 'pending',
    -- Timestamps
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    INDEX username (username),
    INDEX upgrade_status (upgrade_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- Default Data
-- =====================================================

-- Default admin user for daloRADIUS
INSERT INTO radcheck (username, attribute, op, value) VALUES 
('administrator', 'Cleartext-Password', ':=', 'radius')
ON DUPLICATE KEY UPDATE value = value;

-- Free tier group (24 hours, 500MB data limit)
INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES
('free-tier', 'Simultaneous-Use', ':=', '1'),
('free-tier', 'Session-Timeout', ':=', '86400')  -- 24 hours
ON DUPLICATE KEY UPDATE value = value;

INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES
('free-tier', 'Reply-Message', '=', 'Welcome! You have 500MB of free WiFi for 24 hours.'),
('free-tier', 'Session-Timeout', '=', '86400'),  -- 24 hours
('free-tier', 'Idle-Timeout', '=', '300'),      -- 5 min idle timeout
('free-tier', 'ChilliSpot-Max-Total-Octets', '=', '524288000'),  -- 500MB total data
('free-tier', 'WISPr-Bandwidth-Max-Down', '=', '5000000'),  -- 5 Mbps down
('free-tier', 'WISPr-Bandwidth-Max-Up', '=', '2000000')     -- 2 Mbps up
ON DUPLICATE KEY UPDATE value = value;

-- Premium/paid guest group (24 hours, full speed)
INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES
('guests', 'Simultaneous-Use', ':=', '1'),
('guests', 'Session-Timeout', ':=', '86400')  -- 24 hours
ON DUPLICATE KEY UPDATE value = value;

INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES
('guests', 'Reply-Message', '=', 'Welcome to Guest WiFi - Premium Access'),
('guests', 'Session-Timeout', '=', '86400'),
('guests', 'Idle-Timeout', '=', '1800')
ON DUPLICATE KEY UPDATE value = value;

-- Default NAS entry for testing
INSERT INTO nas (nasname, shortname, type, secret, description) VALUES
('0.0.0.0/0', 'default', 'other', 'testing123', 'Default - Accept all clients (CHANGE IN PRODUCTION)')
ON DUPLICATE KEY UPDATE secret = secret;

