-- Migration: Populate router_locations from existing router_logs data
-- This migrates existing location data to the new tracking table

-- Insert distinct locations from router_logs, grouping by approximate location
-- Uses a CTE to identify location changes based on significant distance (approx 500m)
-- For simplicity, we'll insert the first occurrence of each unique lat/lon per router

INSERT INTO router_locations (
  router_id,
  latitude,
  longitude,
  accuracy,
  cell_id,
  tac,
  lac,
  mcc,
  mnc,
  operator,
  network_type,
  started_at,
  ended_at,
  sample_count,
  created_at,
  updated_at
)
SELECT 
  router_id,
  latitude,
  longitude,
  COALESCE(location_accuracy::integer, 1000) as accuracy,
  cell_id,
  tac,
  lac,
  mcc,
  mnc,
  operator,
  network_type,
  MIN(timestamp) as started_at,
  CASE 
    WHEN MAX(timestamp) = (SELECT MAX(timestamp) FROM router_logs rl2 WHERE rl2.router_id = router_logs.router_id AND rl2.latitude IS NOT NULL)
    THEN NULL  -- Current location has no end time
    ELSE MAX(timestamp)
  END as ended_at,
  COUNT(*) as sample_count,
  NOW() as created_at,
  NOW() as updated_at
FROM router_logs
WHERE latitude IS NOT NULL 
  AND longitude IS NOT NULL
GROUP BY 
  router_id,
  -- Round to ~100m precision for grouping (0.001 degree ≈ 111m)
  ROUND(latitude::numeric, 3),
  ROUND(longitude::numeric, 3),
  latitude,
  longitude,
  location_accuracy,
  cell_id,
  tac,
  lac,
  mcc,
  mnc,
  operator,
  network_type
ORDER BY router_id, MIN(timestamp)
ON CONFLICT DO NOTHING;

-- Log migration result
DO $$
DECLARE
  migrated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO migrated_count FROM router_locations;
  RAISE NOTICE 'Migrated % location records to router_locations table', migrated_count;
END $$;
