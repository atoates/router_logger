-- Migration: Add fields to support self-hosted RADIUS / Captive Portal
-- Date: 2026-01-01

-- Add new columns to ironwifi_sessions for captive portal support
ALTER TABLE ironwifi_sessions 
ADD COLUMN IF NOT EXISTS email VARCHAR(255),
ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS guest_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS session_type VARCHAR(50) DEFAULT 'unknown',  -- 'free', 'registered', 'voucher', 'unknown'
ADD COLUMN IF NOT EXISTS session_duration INTEGER,  -- Expected duration in seconds
ADD COLUMN IF NOT EXISTS voucher_code VARCHAR(50),
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'ironwifi',  -- 'ironwifi', 'self-hosted'
ADD COLUMN IF NOT EXISTS ap_mac VARCHAR(50),  -- Alias for router_mac_address
ADD COLUMN IF NOT EXISTS user_mac VARCHAR(50);  -- Alias for user_device_mac

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_email ON ironwifi_sessions(email);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_session_type ON ironwifi_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_ironwifi_sessions_source ON ironwifi_sessions(source);

-- Add guest_count and last_guest_activity to routers table
ALTER TABLE routers
ADD COLUMN IF NOT EXISTS guest_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_guest_activity TIMESTAMP;

-- =============================================================================
-- Captive Portal Verification Codes (for persistent storage)
-- =============================================================================
CREATE TABLE IF NOT EXISTS captive_verification_codes (
    id SERIAL PRIMARY KEY,
    identifier VARCHAR(255) NOT NULL,  -- email or phone
    identifier_type VARCHAR(20) NOT NULL,  -- 'email' or 'phone'
    code VARCHAR(10) NOT NULL,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    -- Additional context
    guest_name VARCHAR(255),
    client_mac VARCHAR(50),
    router_mac VARCHAR(50),
    router_id VARCHAR(255),
    -- Timing
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP,
    -- Indexes
    UNIQUE(identifier, code)
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_identifier ON captive_verification_codes(identifier);
CREATE INDEX IF NOT EXISTS idx_verification_codes_expires ON captive_verification_codes(expires_at);

-- =============================================================================
-- Captive Portal Free Tier Usage Tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS captive_free_usage (
    id SERIAL PRIMARY KEY,
    -- Identifier (MAC address, email, or device fingerprint)
    identifier_type VARCHAR(20) NOT NULL,  -- 'mac', 'email', 'fingerprint'
    identifier_value VARCHAR(255) NOT NULL,
    -- Usage tracking
    sessions_used INTEGER DEFAULT 1,
    total_time_used INTEGER DEFAULT 0,  -- seconds
    last_session_start TIMESTAMP,
    last_session_end TIMESTAMP,
    last_guest_id VARCHAR(255),
    -- Cooldown tracking
    next_free_available TIMESTAMP,  -- When they can get free access again
    -- Location context
    router_id VARCHAR(255),
    property_id VARCHAR(255),
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(identifier_type, identifier_value)
);

CREATE INDEX IF NOT EXISTS idx_free_usage_identifier ON captive_free_usage(identifier_type, identifier_value);
CREATE INDEX IF NOT EXISTS idx_free_usage_next_available ON captive_free_usage(next_free_available);

-- =============================================================================
-- Captive Portal Ad Tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS captive_ad_impressions (
    id SERIAL PRIMARY KEY,
    ad_id VARCHAR(100) NOT NULL,
    ad_position VARCHAR(50) NOT NULL,  -- 'top-banner', 'in-card', 'bottom-banner', 'success-page'
    page VARCHAR(50) NOT NULL,  -- 'portal', 'success', 'terms', etc.
    -- Context
    router_id VARCHAR(255),
    session_id VARCHAR(255),
    client_mac VARCHAR(50),
    client_ip VARCHAR(45),
    user_agent TEXT,
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_impressions_ad_id ON captive_ad_impressions(ad_id);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_created ON captive_ad_impressions(created_at DESC);

CREATE TABLE IF NOT EXISTS captive_ad_clicks (
    id SERIAL PRIMARY KEY,
    ad_id VARCHAR(100) NOT NULL,
    ad_position VARCHAR(50) NOT NULL,
    page VARCHAR(50) NOT NULL,
    -- Context
    router_id VARCHAR(255),
    session_id VARCHAR(255),
    client_mac VARCHAR(50),
    client_ip VARCHAR(45),
    user_agent TEXT,
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_clicks_ad_id ON captive_ad_clicks(ad_id);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_created ON captive_ad_clicks(created_at DESC);

-- =============================================================================
-- Captive Portal Ads Configuration
-- =============================================================================
CREATE TABLE IF NOT EXISTS captive_ads (
    id SERIAL PRIMARY KEY,
    ad_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    -- Ad content
    ad_type VARCHAR(20) NOT NULL,  -- 'image', 'html', 'promo'
    image_url TEXT,
    link_url TEXT,
    alt_text VARCHAR(255),
    html_content TEXT,
    -- Promo-specific fields
    promo_icon_url TEXT,
    promo_title VARCHAR(255),
    promo_description TEXT,
    promo_cta VARCHAR(100),
    -- Targeting
    positions TEXT[],  -- Array of positions: 'top-banner', 'in-card', etc.
    pages TEXT[],  -- Array of pages: 'portal', 'success', etc.
    router_ids TEXT[],  -- Specific routers, or empty for all
    -- Scheduling
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0,  -- Higher = shown first
    -- Stats
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ads_active ON captive_ads(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ads_priority ON captive_ads(priority DESC);

-- Insert sample ad for testing
INSERT INTO captive_ads (ad_id, name, ad_type, promo_title, promo_description, promo_cta, link_url, positions, pages, is_active)
VALUES (
    'sample-promo-1',
    'Sample Promotion',
    'promo',
    'Special Offer!',
    'Get 20% off your first order with code WIFI20',
    'Shop Now',
    'https://example.com/offer',
    ARRAY['in-card'],
    ARRAY['portal', 'success'],
    TRUE
) ON CONFLICT (ad_id) DO NOTHING;

