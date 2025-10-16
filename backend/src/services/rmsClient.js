const axios = require('axios');
const { logger } = require('../config/database');

const RMS_API_BASE_URL = 'https://api.rms.teltonika-networks.com';

class RMSClient {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.client = axios.create({
      baseURL: RMS_API_BASE_URL,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Get all devices from RMS
   */
  async getDevices(limit = 100, offset = 0) {
    try {
      const response = await this.client.get('/api/devices', {
        params: { limit, offset }
      });
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
      const response = await this.client.get(`/api/devices/${deviceId}`);
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
      const response = await this.client.get(`/api/devices/${deviceId}/monitoring`);
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
      const response = await this.client.get(`/api/devices/${deviceId}/statistics`, {
        params: { from, to }
      });
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
      const response = await this.client.get(`/api/devices/${deviceId}/config`);
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
      const devices = devicesResponse.data || devicesResponse;

      const devicesWithMonitoring = await Promise.all(
        devices.map(async (device) => {
          try {
            const monitoring = await this.getDeviceMonitoring(device.id);
            return {
              ...device,
              monitoring
            };
          } catch (error) {
            logger.warn(`Could not fetch monitoring for device ${device.id}`);
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
