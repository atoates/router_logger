const axios = require('axios');
const { logger } = require('../config/database');

// Allow overriding the RMS API base and prefix via env for compatibility with API changes
const RMS_API_BASE_URL = process.env.RMS_API_BASE_URL || 'https://api.rms.teltonika-networks.com';
const RMS_API_PREFIX = process.env.RMS_API_PREFIX || '/v3'; // common prefix in newer docs; fallbacks are implemented

class RMSClient {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.client = axios.create({
      baseURL: RMS_API_BASE_URL,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      // Slightly longer timeout for RMS API
      timeout: 15000
    });
  }

  // Helper: try multiple paths (for different API prefixes) until one succeeds
  async requestWithFallback(method, candidates, options = {}) {
    let lastErr;
    for (const path of candidates) {
      try {
        const res = await this.client.request({ method, url: path, ...options });
        if (res && res.status >= 200 && res.status < 300) return res;
      } catch (err) {
        const status = err.response?.status;
        const data = err.response?.data;
        // 404 means wrong path; try next candidate. Other statuses should break early.
        if (status === 404) {
          logger.warn(`RMS ${method.toUpperCase()} ${path} -> 404 Not Found, trying next candidate`);
          lastErr = err;
          continue;
        }
        // Rate limit or auth or other error, surface it
        logger.error(
          `RMS ${method.toUpperCase()} ${path} failed: ${status || ''} ${data ? JSON.stringify(data) : err.message}`
        );
        throw err;
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
        `${RMS_API_PREFIX}/devices`,
        '/devices',
        '/api/devices'
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
        `${RMS_API_PREFIX}/devices/${deviceId}`,
        `/devices/${deviceId}`,
        `/api/devices/${deviceId}`
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
      const response = await this.requestWithFallback('get', [
        `${RMS_API_PREFIX}/devices/${deviceId}/monitoring`,
        `/devices/${deviceId}/monitoring`,
        `/api/devices/${deviceId}/monitoring`
      ]);
      return response.data;
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
      const params = { from, to };
      const response = await this.requestWithFallback('get', [
        `${RMS_API_PREFIX}/devices/${deviceId}/statistics`,
        `/devices/${deviceId}/statistics`,
        `/api/devices/${deviceId}/statistics`
      ], { params });
      return response.data;
    } catch (error) {
      logger.error(`Error fetching statistics for device ${deviceId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get device configuration
   */
  async getDeviceConfig(deviceId) {
    try {
      const response = await this.requestWithFallback('get', [
        `${RMS_API_PREFIX}/devices/${deviceId}/config`,
        `/devices/${deviceId}/config`,
        `/api/devices/${deviceId}/config`
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
