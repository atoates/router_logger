/**
 * Application Constants
 * Centralized configuration for magic numbers, UUIDs, and other constants
 */

// ClickUp Custom Field IDs
const CLICKUP_FIELD_IDS = {
  DATE_INSTALLED: '9f31c21a-630d-49f2-8a79-354de03e24d1',
  OPERATIONAL_STATUS: '8a661229-13f0-4693-a7cb-1df86725cfed',
  ROUTER_MODEL: 'f2cbe126-4e68-4be0-9c3b-fa230d289f51',
  FIRMWARE: '845f6619-e3ee-4634-b92a-a117f14fb8c7',
  LAST_MAINTENANCE_DATE: '49551d31-6e57-4620-af95-32c701e93488',
  IMEI: '687faa85-01c0-48c4-8f6e-60a78a570cab',
  ROUTER_ID: 'dfe0016c-4ab0-4dd9-bb38-b338411e9b47',
  LAST_ONLINE: '684e19a1-06c3-4bfd-94dd-6aca4a9b85fe',
  DATA_USAGE: 'c58206db-e995-4717-8e62-d36e15d0a3e2',
  ROUTER_DASHBOARD: 'b9cf2e41-dc79-4768-985a-bda52b9dad1f'
};

// Cache TTL values (in milliseconds)
const CACHE_TTL = {
  ROUTERS: 60 * 1000, // 60 seconds (from env or default)
  ROUTERS_WITH_LOCATIONS: 15 * 60 * 1000, // 15 minutes
  ASSIGNEES: 7 * 24 * 60 * 60 * 1000 // 1 week
};

// Router status values
const ROUTER_STATUS = {
  ONLINE: ['online', 'Online', '1', 'true'],
  VALID_TASK_STATUSES: ['decommissioned', 'being returned', 'installed', 'ready', 'needs attention']
};

// Rate limiting
const RATE_LIMITS = {
  CLICKUP_API_DELAY_MS: 200, // Delay between ClickUp API calls
  CLICKUP_REQUESTS_PER_MINUTE: 100
};

// Inspection intervals
const INSPECTION = {
  INTERVAL_DAYS: 365,
  WARNING_DAYS: 30
};

// Time intervals
const TIME_INTERVALS = {
  OFFLINE_THRESHOLD_HOURS: 1,
  STATUS_COMPARISON_HOURS: 48
};

module.exports = {
  CLICKUP_FIELD_IDS,
  CACHE_TTL,
  ROUTER_STATUS,
  RATE_LIMITS,
  INSPECTION,
  TIME_INTERVALS
};

