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
      const urlCandidates = [
        `${RMS_API_PREFIX}/devices/${deviceId}/monitoring`,
        `${RMS_API_PREFIX}/devices/${deviceId}/monitoring/data`,
        `${RMS_API_PREFIX}/devices/${deviceId}/monitoring/values`,
        `${RMS_API_PREFIX}/devices/${deviceId}/realtime`,
        `/devices/${deviceId}/monitoring`,
        `/devices/${deviceId}/monitoring/data`,
        `/devices/${deviceId}/monitoring/values`,
        `/devices/${deviceId}/realtime`,
        `/api/devices/${deviceId}/monitoring`,
        `/api/devices/${deviceId}/monitoring/data`,
        `/api/devices/${deviceId}/monitoring/values`,
        `/api/devices/${deviceId}/realtime`,
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
        `${RMS_API_PREFIX}/devices/${deviceId}/statistics`,
        `${RMS_API_PREFIX}/devices/${deviceId}/statistics/traffic`,
        `${RMS_API_PREFIX}/devices/${deviceId}/traffic`,
        `/devices/${deviceId}/statistics`,
        `/devices/${deviceId}/statistics/traffic`,
        `/devices/${deviceId}/traffic`,
        `/api/devices/${deviceId}/statistics`,
        `/api/devices/${deviceId}/statistics/traffic`,
        `/api/devices/${deviceId}/traffic`,
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
        `${RMS_API_PREFIX}/statistics/companies/${companyId}/devices/${deviceId}`,
        `${RMS_API_PREFIX}/companies/${companyId}/devices/${deviceId}/statistics`,
        `${RMS_API_PREFIX}/companies/${companyId}/statistics/devices/${deviceId}`,
        `${RMS_API_PREFIX}/statistics/companies/${companyId}/devices`,
        `${RMS_API_PREFIX}/companies/${companyId}/statistics/devices`,
        `${RMS_API_PREFIX}/statistics/devices`,
        `/statistics/companies/${companyId}/devices/${deviceId}`,
        `/companies/${companyId}/devices/${deviceId}/statistics`,
        `/companies/${companyId}/statistics/devices/${deviceId}`,
        `/statistics/companies/${companyId}/devices`,
        `/companies/${companyId}/statistics/devices`,
        `/statistics/devices`,
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
