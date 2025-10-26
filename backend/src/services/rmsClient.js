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
          
          // Handle rate limiting with exponential backoff
          if (status === 429) {
            const retryAfter = parseInt(err.response?.headers['retry-after'] || '60');
            const delay = Math.min(retryAfter * 1000, Math.pow(2, attempt) * 1000);
            logger.warn(`RMS rate limit hit on ${path}. Retry-After: ${retryAfter}s. Waiting ${delay}ms before retry ${attempt + 1}/${retries}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
            lastErr = err;
            continue;
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
      
      // If we exhausted retries for this path, try next candidate
      if (attempt >= retries && lastErr?.response?.status === 429) {
        logger.error(`Rate limit retries exhausted for ${path}, trying next candidate`);
        continue;
      }
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
   * Get device monitoring data (cellular, network, etc.)
   */
  async getDeviceMonitoring(deviceId) {
    try {
      const urlCandidates = [
        `/api/devices/${deviceId}/monitoring`,
        `/api/devices/${deviceId}/monitoring/data`,
        `/api/devices/${deviceId}/data`,
        `/devices/${deviceId}/monitoring`,
        `/devices/${deviceId}/monitoring/data`,
        `/devices/${deviceId}/data`,
        `${RMS_API_PREFIX}/devices/${deviceId}/monitoring`
      ];

      const paramsVariants = [
        {},
        { widgets: 'network,cellular,system,wifi,hardware,ethernet,vpn' },
        { modules: 'network,cellular,system,wifi,hardware,ethernet,vpn' },
        { keys: 'network.tx_bytes,network.rx_bytes,cellular.tx_bytes,cellular.rx_bytes,system.uptime,wifi.clients' },
        { all: true },
      ];

      let lastErr;
      for (const params of paramsVariants) {
        try {
          const response = await this.requestWithFallback('get', urlCandidates, { params });
          const data = response.data;
          if (data && Object.keys(data).length) return data;
          lastErr = new Error('Empty monitoring response');
        } catch (err) {
          lastErr = err;
          continue;
        }
      }
      if (lastErr) throw lastErr;
      return {};
    } catch (error) {
      logger.error(`Error fetching monitoring data for device ${deviceId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get device statistics (data usage, etc.)
   */
  async getDeviceStatistics(deviceId, from, to) {
    try {
      // Build parameter variants: ISO strings, epoch seconds, alternate keys
      const epochSec = (d) => Math.floor(new Date(d).getTime() / 1000);
      const paramVariants = [
        { from, to },
        { from: epochSec(from), to: epochSec(to) },
        { date_from: from, date_to: to },
        { start: from, end: to },
      ];

      const urlCandidates = [
        `/api/devices/${deviceId}/statistics`,
        `/api/devices/${deviceId}/statistics/traffic`,
        `/devices/${deviceId}/statistics`,
        `${RMS_API_PREFIX}/devices/${deviceId}/statistics`
      ];

      let lastErr;
      for (const params of paramVariants) {
        try {
          const response = await this.requestWithFallback('get', urlCandidates, { params });
          const data = response.data;
          const list = Array.isArray(data) ? data : data?.data || data?.items || data?.rows || [];
          if (Array.isArray(list) && list.length >= 1) {
            return list;
          }
          // If empty, try next param variant
          lastErr = new Error('Empty statistics response');
        } catch (err) {
          lastErr = err;
          continue;
        }
      }
      if (lastErr) throw lastErr;
      return [];
    } catch (error) {
      logger.error(`Error fetching statistics for device ${deviceId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get company device statistics (traffic) using company_device_statistics scope
   */
  async getCompanyDeviceStatistics(companyId, deviceId, from, to) {
    try {
      const epochSec = (d) => Math.floor(new Date(d).getTime() / 1000);
      const paramVariants = [
        { company_id: companyId, device_id: deviceId, from, to },
        { company_id: companyId, device_id: deviceId, from: epochSec(from), to: epochSec(to) },
        { companyId, deviceId, date_from: from, date_to: to },
        { companyId, deviceId, start: from, end: to },
      ];
      const urlCandidates = [
        `/api/statistics/companies/${companyId}/devices/${deviceId}`,
        `/api/companies/${companyId}/devices/${deviceId}/statistics`,
        `/statistics/companies/${companyId}/devices/${deviceId}`,
        `/companies/${companyId}/devices/${deviceId}/statistics`,
        `${RMS_API_PREFIX}/statistics/companies/${companyId}/devices/${deviceId}`
      ];

      let lastErr;
      for (const params of paramVariants) {
        try {
          const response = await this.requestWithFallback('get', urlCandidates, { params });
          const data = response.data;
          const list = Array.isArray(data) ? data : data?.data || data?.items || data?.rows || [];
          if (Array.isArray(list) && list.length >= 1) return list;
          lastErr = new Error('Empty company statistics response');
        } catch (err) {
          lastErr = err;
          continue;
        }
      }
      if (lastErr) throw lastErr;
      return [];
    } catch (error) {
      logger.error(`Error fetching company statistics for company ${companyId} device ${deviceId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get device data usage (RMS Data usage tab endpoint)
   * This is the endpoint that powers the "Data usage" tab in RMS UI
   */
  async getDeviceDataUsage(deviceId, fromDate, toDate) {
    try {
      // RMS data-usage endpoint typically uses date format YYYY-MM-DD or ISO
      const formatDate = (d) => {
        const dt = new Date(d);
        return dt.toISOString().split('T')[0]; // YYYY-MM-DD
      };

      const paramVariants = [
        { from: fromDate, to: toDate },
        { from: formatDate(fromDate), to: formatDate(toDate) },
        { date_from: fromDate, date_to: toDate },
        { start_date: fromDate, end_date: toDate },
      ];

      const urlCandidates = [
        `/api/devices/${deviceId}/data-usage`,
        `/api/devices/${deviceId}/usage`,
        `/api/devices/${deviceId}/data-usage/history`,
        `/devices/${deviceId}/data-usage`,
        `/devices/${deviceId}/usage`,
        `${RMS_API_PREFIX}/devices/${deviceId}/data-usage`
      ];

      let lastErr;
      for (const params of paramVariants) {
        try {
          const response = await this.requestWithFallback('get', urlCandidates, { params });
          const data = response.data;
          // Data usage response may be array of daily records or object with totals
          if (data && (Array.isArray(data) || (typeof data === 'object' && Object.keys(data).length))) {
            return data;
          }
          lastErr = new Error('Empty data usage response');
        } catch (err) {
          lastErr = err;
          continue;
        }
      }
      if (lastErr) throw lastErr;
      return null;
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

      const devicesWithMonitoring = await Promise.all(
        devices.map(async (device) => {
          try {
            const deviceId = device.id || device.device_id || device.uuid || device.serial_number;
            const monitoring = deviceId ? await this.getDeviceMonitoring(deviceId) : undefined;
            return {
              ...device,
              monitoring
            };
          } catch (error) {
            logger.warn(`Could not fetch monitoring for device ${device.id || device.device_id}`);
            return device;
          }
        })
      );

      return devicesWithMonitoring;
    } catch (error) {
      logger.error('Error fetching devices with monitoring:', error.message);
      throw error;
    }
  }
}

module.exports = RMSClient;
