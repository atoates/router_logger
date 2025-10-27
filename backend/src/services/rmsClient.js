const axios = require('axios');
const { logger } = require('../config/database');
const oauthService = require('./oauthService');

// Import tracking function (will be set after module loads to avoid circular dependency)
let trackRMSCall = null;
try {
  const monitoring = require('../routes/monitoring');
  trackRMSCall = monitoring.trackRMSCall;
} catch (e) {
  // Monitoring not available yet, that's ok
}

// Allow overriding the RMS API base and prefix via env for compatibility with API changes
const RMS_API_BASE_URL = process.env.RMS_API_BASE_URL || 'https://api.rms.teltonika-networks.com';
const RMS_API_PREFIX = process.env.RMS_API_PREFIX || ''; // No prefix by default; RMS API uses /api/... directly

class RMSClient {
  constructor(accessToken, isOAuthToken = false) {
    this.accessToken = accessToken;
    this.isOAuthToken = isOAuthToken;
    this.client = axios.create({
      baseURL: RMS_API_BASE_URL,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      // Slightly longer timeout for RMS API
      timeout: 15000
    });
  }

  /**
   * Create RMSClient with OAuth token if available, fallback to PAT
   * @returns {Promise<RMSClient>}
   */
  static async createWithAuth() {
    const userId = 'default_rms_user'; // Replace with actual user management
    
    // Try to get OAuth token first
    const oauthToken = await oauthService.getValidToken(userId);
    
    if (oauthToken) {
      logger.info('Using OAuth token for RMS API');
      return new RMSClient(oauthToken.accessToken, true);
    }
    
    // Fallback to Personal Access Token
    const pat = process.env.RMS_ACCESS_TOKEN;
    if (pat) {
      logger.info('Using Personal Access Token for RMS API');
      return new RMSClient(pat, false);
    }
    
    throw new Error('No RMS authentication available (neither OAuth nor PAT)');
  }

  // Helper: try multiple paths (for different API prefixes) until one succeeds
  async requestWithFallback(method, candidates, options = {}, retries = 3) {
    let lastErr;
    for (const path of candidates) {
      let attempt = 0;
      while (attempt < retries) {
        try {
          const res = await this.client.request({ method, url: path, ...options });
          if (res && res.status >= 200 && res.status < 300) {
            // Track successful API call
            if (trackRMSCall) trackRMSCall(path, res.status);
            return res;
          }
        } catch (err) {
          const status = err.response?.status;
          const data = err.response?.data;
          
          // Track API call even on error
          if (trackRMSCall) trackRMSCall(path, status);
          
          // Handle rate limiting - don't retry, quota is exhausted
          if (status === 429) {
            logger.error(`RMS rate limit hit on ${path}. Monthly quota likely exhausted. Not retrying.`);
            throw err; // Immediately throw, don't waste quota on retries
          }
          
          // 404 means wrong path; try next candidate. Other statuses should break early.
          if (status === 404) {
            logger.warn(`RMS ${method.toUpperCase()} ${path} -> 404 Not Found, trying next candidate`);
            lastErr = err;
            break; // Break retry loop, try next path
          }
          
          // Auth or other error, surface it
          logger.error(
            `RMS ${method.toUpperCase()} ${path} failed: ${status || ''} ${data ? JSON.stringify(data) : err.message}`
          );
          throw err;
        }
      }
      
      // If we exhausted retries for this path due to errors, try next candidate
      // Note: 429 errors now throw immediately, so this won't be hit for rate limits
    }
    // If we exhausted candidates, throw last error or generic
    throw lastErr || new Error(`All RMS endpoints failed for candidates: ${candidates.join(', ')}`);
  }

  /**
   * Get all devices from RMS
   */
  async getDevices(limit = 100, offset = 0) {
    try {
      const params = { limit, offset };
      const response = await this.requestWithFallback('get', [
        `/api/devices`,
        `/devices`,
        `${RMS_API_PREFIX}/devices`
      ], { params });
      return response.data;
    } catch (error) {
      logger.error('Error fetching devices from RMS:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get specific device details
   */
  async getDevice(deviceId) {
    try {
      const response = await this.requestWithFallback('get', [
        `/api/devices/${deviceId}`,
        `/devices/${deviceId}`,
        `${RMS_API_PREFIX}/devices/${deviceId}`
      ]);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching device ${deviceId} from RMS:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * NOTE: getDeviceMonitoring() has been removed to save API quota.
   * Monitoring data is now extracted from the device list response.
   * See getAllDevicesWithMonitoring() for details.
   */

  /**
   * Get device statistics (data usage, etc.)
   * OPTIMIZED: Only try working endpoint to reduce API calls
   */
  async getDeviceStatistics(deviceId, from, to) {
    try {
      // Use only the known working endpoint
      const response = await this.requestWithFallback('get', [
        `/api/devices/${deviceId}/statistics`,
      ], { 
        params: { from, to }
      });
      
      const data = response.data;
      const list = Array.isArray(data) ? data : data?.data || data?.items || data?.rows || [];
      return list;
    } catch (error) {
      logger.error(`Error fetching statistics for device ${deviceId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get company device statistics (traffic) using company_device_statistics scope
   * OPTIMIZED: Only try working endpoint to reduce API calls
   */
  async getCompanyDeviceStatistics(companyId, deviceId, from, to) {
    try {
      // Use only the known working endpoint
      const response = await this.requestWithFallback('get', [
        `/api/companies/${companyId}/devices/${deviceId}/statistics`,
      ], { 
        params: { from, to }
      });
      
      const data = response.data;
      const list = Array.isArray(data) ? data : data?.data || data?.items || data?.rows || [];
      return list;
    } catch (error) {
      logger.error(`Error fetching company device statistics:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get device data usage (RMS Data usage tab endpoint)
   * This is the endpoint that powers the "Data usage" tab in RMS UI
   */
  /**
   * Get device data usage
   * OPTIMIZED: Only try working endpoint to reduce API calls
   */
  async getDeviceDataUsage(deviceId, fromDate, toDate) {
    try {
      // Use only the known working endpoint
      const response = await this.requestWithFallback('get', [
        `/api/devices/${deviceId}/data-usage`,
      ], { 
        params: { from: fromDate, to: toDate }
      });
      
      return response.data;
    } catch (error) {
      logger.error(`Error fetching data usage for device ${deviceId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get device configuration
   */
  async getDeviceConfig(deviceId) {
    try {
      const response = await this.requestWithFallback('get', [
        `/api/devices/${deviceId}/config`,
        `/devices/${deviceId}/config`,
        `${RMS_API_PREFIX}/devices/${deviceId}/config`
      ]);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching config for device ${deviceId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get all devices with their monitoring data
   */
  async getAllDevicesWithMonitoring() {
    try {
      const devicesResponse = await this.getDevices(1000); // Get up to 1000 devices
      // Normalize various possible list wrappers from RMS API
      const devices = Array.isArray(devicesResponse)
        ? devicesResponse
        : devicesResponse?.data || devicesResponse?.items || devicesResponse?.rows || [];

      logger.info(`Processing ${devices.length} devices (will skip monitoring calls to save API quota)`);
      
      // OPTIMIZATION: The devices list already contains status and basic info
      // We don't need to call /monitoring for each device every sync
      // The monitoring endpoint provides real-time data, but we're logging every hour anyway
      // So we can use the device list data directly to save 50-100 API calls per sync
      const devicesWithMonitoring = devices.map((device) => {
        return {
          ...device,
          // Use status from device list instead of separate monitoring call
          monitoring: {
            status: device.status || device.state || device.connection_state,
            last_seen: device.last_seen || device.last_activity || device.updated_at,
            // These fields may or may not be in the device list, but they're not critical
            uptime: device.uptime,
            signal_strength: device.signal_strength || device.rssi,
          }
        };
      });

      return devicesWithMonitoring;
    } catch (error) {
      logger.error('Error fetching devices with monitoring:', error.message);
      throw error;
    }
  }
}

module.exports = RMSClient;
