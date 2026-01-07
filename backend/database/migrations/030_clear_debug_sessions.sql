-- Clear debug sessions and reset cooldowns
-- Run this to start fresh during testing

-- Clear all free usage tracking (removes cooldowns)
DELETE FROM captive_free_usage;

-- Clear recent test sessions from last 24 hours
DELETE FROM wifi_guest_sessions WHERE session_start >= NOW() - INTERVAL '24 hours';

-- Show remaining data
SELECT 
    (SELECT COUNT(*) FROM wifi_guest_sessions) as total_sessions,
    (SELECT COUNT(*) FROM captive_free_usage) as cooldown_entries;
