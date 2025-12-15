/**
 * IronWifi API Client
 * 
 * Handles communication with IronWifi REST API for fetching RADIUS accounting
 * reports and user session data. Includes rate limiting protection.
 * 
 * API Documentation: https://console.ironwifi.com/api
 * Authentication: Bearer token from API Keys in IronWifi Console
 */

const axios = require('axios');
const https = require('https');
const { logger } = require('../config/database');

// Default configuration
const DEFAULT_API_URL = 'https://console.ironwifi.com/api';

// Create HTTPS agent that handles certificate issues
// IronWifi may use certificates that need special handling
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.IRONWIFI_REJECT_UNAUTHORIZED !== 'false'
});
const DEFAULT_HOURLY_LIMIT = 1000;

// Rate limit tracking
let apiCallCount = 0;
let hourlyResetTime = Date.now() + 60 * 60 * 1000; // 1 hour from now

/**
 * Get current API usage statistics
 */
function getApiUsage() {
  const now = Date.now();
  
  // Reset counter if hour has passed
  if (now >= hourlyResetTime) {
    logger.info(`IronWifi API call counter reset. Previous hour: ${apiCallCount} calls`);
    apiCallCount = 0;
    hourlyResetTime = now + 60 * 60 * 1000;
  }
  
  const limit = parseInt(process.env.IRONWIFI_HOURLY_LIMIT || DEFAULT_HOURLY_LIMIT, 10);
  const remaining = Math.max(0, limit - apiCallCount);
  const resetInMinutes = Math.ceil((hourlyResetTime - now) / (60 * 1000));
  
  return {
    callsMade: apiCallCount,
    limit,
    remaining,
    percentageUsed: ((apiCallCount / limit) * 100).toFixed(1),
    resetInMinutes,
    resetTime: new Date(hourlyResetTime).toISOString()
  };
}

/**
 * Check if we can make an API call (under rate limit)
 */
function canMakeApiCall() {
  const usage = getApiUsage();
  return usage.remaining > 0;
}

/**
 * Check if we're approaching the rate limit (>90%)
 */
function isApproachingLimit() {
  const usage = getApiUsage();
  return parseFloat(usage.percentageUsed) >= 90;
}

/**
 * Create configured axios instance for IronWifi API
 */
function createClient() {
  const apiKey = process.env.IRONWIFI_API_KEY;
  const apiUrl = process.env.IRONWIFI_API_URL || DEFAULT_API_URL;
  
  if (!apiKey) {
    throw new Error('IRONWIFI_API_KEY not configured');
  }
  
  const client = axios.create({
    baseURL: apiUrl,
    timeout: 30000,
    httpsAgent,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });
  
  // Request interceptor - rate limit check and logging
  client.interceptors.request.use((config) => {
    // Check rate limit before making call
    if (!canMakeApiCall()) {
      const usage = getApiUsage();
      const error = new Error(
        `IronWifi API rate limit exceeded (${usage.limit}/hour). Resets in ${usage.resetInMinutes} minutes.`
      );
      error.isRateLimitError = true;
      error.resetTime = usage.resetTime;
      throw error;
    }
    
    // Increment counter
    apiCallCount++;
    
    // Log usage
    const usage = getApiUsage();
    if (parseFloat(usage.percentageUsed) >= 80) {
      logger.warn(`IronWifi API usage at ${usage.percentageUsed}% (${usage.callsMade}/${usage.limit})`);
    } else {
      logger.debug(`IronWifi API call #${usage.callsMade}/${usage.limit}`);
    }
    
    return config;
  });
  
  // Response interceptor - handle rate limit responses
  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after'];
        logger.error('IronWifi API rate limit hit (429)', { retryAfter });
        error.isRateLimitError = true;
        error.retryAfter = retryAfter;
      }
      throw error;
    }
  );
  
  return client;
}

// Lazy-loaded client instance
let clientInstance = null;

function getClient() {
  if (!clientInstance) {
    clientInstance = createClient();
  }
  return clientInstance;
}

/**
 * Check if IronWifi integration is configured
 */
function isConfigured() {
  return !!process.env.IRONWIFI_API_KEY;
}

/**
 * Get list of users from IronWifi
 * @returns {Promise<{items: Array, total_items: number}>}
 */
async function getUsers() {
  const client = getClient();
  const response = await client.get('/users');
  return response.data;
}

/**
 * Get list of guests from IronWifi (captive portal users)
 * This is the main endpoint for guest WiFi session data
 * 
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.pageSize - Items per page (default: 100, max: 100)
 * @returns {Promise<{items: Array, total_items: number, page: number, page_count: number}>}
 */
async function getGuests(options = {}) {
  const client = getClient();
  const params = {
    page: options.page || 1,
    page_size: Math.min(options.pageSize || 100, 100) // Max 100 per page
  };
  
  logger.info('Fetching IronWifi guests', { page: params.page, pageSize: params.page_size });
  
  const response = await client.get('/guests', { params });
  
  // Extract guests from HAL format
  const guests = response.data._embedded?.users || [];
  
  return {
    items: guests,
    total_items: response.data.total_items || 0,
    page: response.data.page || 1,
    page_count: response.data.page_count || 1,
    page_size: response.data.page_size || 25
  };
}

/**
 * Get all guests (paginated fetch)
 * Fetches all pages up to a limit
 * 
 * @param {Object} options - Query options
 * @param {number} options.maxPages - Maximum pages to fetch (default: 10)
 * @param {number} options.pageSize - Items per page (default: 100)
 * @returns {Promise<Array>} All guests
 */
async function getAllGuests(options = {}) {
  const maxPages = options.maxPages || 10;
  const pageSize = options.pageSize || 100;
  
  let allGuests = [];
  let page = 1;
  
  while (page <= maxPages) {
    const result = await getGuests({ page, pageSize });
    allGuests = allGuests.concat(result.items);
    
    logger.info(`Fetched page ${page}/${result.page_count} (${result.items.length} guests)`);
    
    if (page >= result.page_count) {
      break; // No more pages
    }
    page++;
  }
  
  logger.info(`Total guests fetched: ${allGuests.length}`);
  return allGuests;
}

/**
 * Get recently authenticated guests (last 24 hours)
 * @returns {Promise<Array>} Recent guests
 */
async function getRecentGuests() {
  // Fetch first few pages to get recent authentications
  const allGuests = await getAllGuests({ maxPages: 5, pageSize: 100 });
  
  // Filter to last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const recentGuests = allGuests.filter(guest => {
    const authDate = guest.authdate ? new Date(guest.authdate) : null;
    return authDate && authDate > oneDayAgo;
  });
  
  logger.info(`Found ${recentGuests.length} guests authenticated in last 24 hours`);
  return recentGuests;
}

/**
 * Get list of networks from IronWifi
 * @returns {Promise<{items: Array, total_items: number}>}
 */
async function getNetworks() {
  const client = getClient();
  const response = await client.get('/networks');
  return response.data;
}

/**
 * Get list of devices (access points) from IronWifi
 * @returns {Promise<{items: Array, total_items: number}>}
 */
async function getDevices() {
  const client = getClient();
  const response = await client.get('/devices');
  return response.data;
}

/**
 * Get synchronous report data (up to 4 hours old)
 * Report 110 = RADIUS Accounting data
 * 
 * Note: This endpoint may not be available in all IronWifi accounts.
 * Falls back to returning empty array if report type not found.
 * 
 * @param {Object} options - Query options
 * @param {string} options.earliest - Start time (e.g., '-4h', '-1h')
 * @param {string} options.latest - End time (e.g., 'now')
 * @param {number} options.page - Page number (default: 1)
 * @returns {Promise<Array>} Array of accounting records
 */
async function getAccountingReport(options = {}) {
  const client = getClient();
  const params = {
    earliest: options.earliest || '-4h',
    latest: options.latest || 'now',
    page: options.page || 1,
    period: 1
  };
  
  logger.info('Fetching IronWifi accounting report', { params });
  
  try {
    // Try the standard report endpoint first
    const response = await client.get('/110', { params });
    return response.data;
  } catch (error) {
    const status = error.response?.status;
    
    // Handle various "not available" responses gracefully
    if (status === 404 || status === 405) {
      logger.warn(`IronWifi report endpoint returned ${status} - account may need configuration`, {
        message: 'Set up networks and devices in IronWifi Console first'
      });
      return []; // Return empty array - no data available yet
    }
    
    throw error;
  }
}

/**
 * Request asynchronous report generation
 * Report 115 = RADIUS Accounting with user details
 * 
 * @param {Object} options - Query options
 * @param {string} options.earliest - Start time (e.g., '-1d@d' for yesterday)
 * @param {string} options.latest - End time (e.g., 'now')
 * @param {string} options.format - Output format ('json', 'csvfile')
 * @param {string} options.columns - Comma-separated columns to include
 * @returns {Promise<{task_name: string}>} Task name for retrieval
 */
async function requestAsyncReport(options = {}) {
  const client = getClient();
  const params = {
    earliest: options.earliest || '-1d@d',
    latest: options.latest || 'now',
    format: options.format || 'json',
    page: 1,
    period: 1,
    columns: options.columns || 'username,client_mac,nas_identifier,acct_session_id,acct_start_time,acct_stop_time,acct_input_octets,acct_output_octets,acct_session_time,framed_ip_address'
  };
  
  logger.info('Requesting async IronWifi report', { params });
  
  const response = await client.get('/reports/115', { params });
  return response.data;
}

/**
 * Retrieve prepared async report data
 * 
 * @param {string} taskName - Task name from requestAsyncReport
 * @param {string} format - Format (json, csvfile)
 * @returns {Promise<Array>} Report data
 */
async function getAsyncReportData(taskName, format = 'json') {
  const client = getClient();
  const params = {
    format,
    task_name: taskName
  };
  
  logger.info('Retrieving async IronWifi report', { taskName });
  
  const response = await client.get('/reports/tasks', { params });
  return response.data;
}

/**
 * Get active sessions (users currently connected)
 * Uses the synchronous accounting report endpoint
 * 
 * @returns {Promise<Array>} Array of active session records
 */
async function getActiveSessions() {
  try {
    // Fetch recent data (last 4 hours - max for sync endpoint)
    const data = await getAccountingReport({ earliest: '-4h', latest: 'now' });
    
    // Filter to active sessions (no stop time)
    // IronWifi format varies, handle different structures
    let sessions = [];
    
    if (Array.isArray(data)) {
      sessions = data;
    } else if (data.items && Array.isArray(data.items)) {
      sessions = data.items;
    } else if (data.data && Array.isArray(data.data)) {
      sessions = data.data;
    } else if (data.records && Array.isArray(data.records)) {
      sessions = data.records;
    }
    
    logger.info(`Fetched ${sessions.length} session records from IronWifi`);
    return sessions;
    
  } catch (error) {
    if (error.isRateLimitError) {
      logger.warn('IronWifi API rate limit - skipping session fetch', {
        resetTime: error.resetTime || 'unknown'
      });
      throw error;
    }
    
    logger.error('Failed to fetch IronWifi sessions', {
      message: error.message,
      status: error.response?.status
    });
    throw error;
  }
}

/**
 * Test API connectivity
 * @returns {Promise<{connected: boolean, message: string}>}
 */
async function testConnection() {
  try {
    if (!isConfigured()) {
      return { connected: false, message: 'IRONWIFI_API_KEY not configured' };
    }
    
    const result = await getNetworks();
    return {
      connected: true,
      message: `Connected to IronWifi API. Found ${result.total_items || 0} networks.`,
      networks: result.total_items || 0
    };
  } catch (error) {
    return {
      connected: false,
      message: error.message,
      error: error.response?.status || 'unknown'
    };
  }
}

// Reset client on config change (for testing)
function resetClient() {
  clientInstance = null;
}

module.exports = {
  isConfigured,
  getApiUsage,
  canMakeApiCall,
  isApproachingLimit,
  getUsers,
  getGuests,
  getAllGuests,
  getRecentGuests,
  getNetworks,
  getDevices,
  getAccountingReport,
  requestAsyncReport,
  getAsyncReportData,
  getActiveSessions,
  testConnection,
  resetClient
};

