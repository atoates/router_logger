/**
 * IronWifi API Client
 * Handles authentication and API requests to IronWifi captive portal service
 * 
 * API Documentation: https://api.ironwifi.com/
 * 
 * Key Endpoints (to be confirmed):
 * - GET /networks - List networks
 * - GET /networks/:id/access-points - List APs
 * - GET /networks/:id/sessions - Get active sessions
 * - GET /sessions/:id - Get session details
 * - GET /users - List users
 */

const axios = require('axios');
const { logger } = require('../config/database');

// Rate limiting tracking
let apiCallCount = 0;
let apiCallResetTime = Date.now() + 60 * 60 * 1000; // Reset every hour
const API_CALL_LIMIT_PER_HOUR = parseInt(process.env.IRONWIFI_HOURLY_LIMIT || '1000', 10);
const API_CALL_WARNING_THRESHOLD = API_CALL_LIMIT_PER_HOUR * 0.8; // Warn at 80%

class IronWifiClient {
  constructor() {
    this.baseURL = process.env.IRONWIFI_API_URL || 'https://api.ironwifi.com';
    this.apiKey = process.env.IRONWIFI_API_KEY;
    this.apiSecret = process.env.IRONWIFI_API_SECRET;
    this.networkId = process.env.IRONWIFI_NETWORK_ID;
    
    if (!this.apiKey) {
      logger.warn('IronWifi API key not configured. Set IRONWIFI_API_KEY in environment.');
    }

    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      }
    });

    // Add request interceptor for authentication and rate limiting
    this.client.interceptors.request.use((config) => {
      // Reset counter if time window expired
      if (Date.now() > apiCallResetTime) {
        logger.info(`IronWifi API call counter reset. Previous hour: ${apiCallCount} calls`);
        apiCallCount = 0;
        apiCallResetTime = Date.now() + 60 * 60 * 1000;
      }

      // Check rate limit
      if (apiCallCount >= API_CALL_LIMIT_PER_HOUR) {
        const minutesUntilReset = Math.ceil((apiCallResetTime - Date.now()) / 60000);
        const error = new Error(`IronWifi API rate limit exceeded (${API_CALL_LIMIT_PER_HOUR}/hour). Resets in ${minutesUntilReset} minutes.`);
        error.isRateLimitError = true;
        error.resetTime = apiCallResetTime;
        logger.error(error.message);
        throw error;
      }

      // Warn when approaching limit
      if (apiCallCount >= API_CALL_WARNING_THRESHOLD && apiCallCount % 10 === 0) {
        const remaining = API_CALL_LIMIT_PER_HOUR - apiCallCount;
        logger.warn(`IronWifi API usage: ${apiCallCount}/${API_CALL_LIMIT_PER_HOUR} calls (${remaining} remaining)`);
      }

      // Increment counter
      apiCallCount++;
      logger.debug(`IronWifi API call #${apiCallCount}: ${config.method?.toUpperCase()} ${config.url}`);

      if (this.apiKey) {
        // IronWifi typically uses X-API-Key or Authorization Bearer
        config.headers['X-API-Key'] = this.apiKey;
        
        // Some APIs use Basic Auth or Bearer token
        if (this.apiSecret) {
          const token = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
          config.headers['Authorization'] = `Basic ${token}`;
        }
      }
      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        // Handle rate limit responses from server
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'];
          const retryMinutes = retryAfter ? Math.ceil(parseInt(retryAfter) / 60) : 'unknown';
          logger.error(`IronWifi API rate limit (429) - Retry after: ${retryMinutes} minutes`);
          error.isRateLimitError = true;
        }
        
        if (error.response) {
          logger.error('IronWifi API error:', {
            status: error.response.status,
            data: error.response.data,
            url: error.config?.url
          });
        } else if (error.request) {
          logger.error('IronWifi API no response:', error.message);
        } else {
          logger.error('IronWifi API request error:', error.message);
        }
        throw error;
      }
    );
  }

  /**
   * Get current API usage statistics
   */
  static getApiUsage() {
    const now = Date.now();
    const minutesUntilReset = Math.ceil((apiCallResetTime - now) / 60000);
    return {
      callsMade: apiCallCount,
      limit: API_CALL_LIMIT_PER_HOUR,
      remaining: Math.max(0, API_CALL_LIMIT_PER_HOUR - apiCallCount),
      percentageUsed: ((apiCallCount / API_CALL_LIMIT_PER_HOUR) * 100).toFixed(1),
      resetInMinutes: minutesUntilReset > 0 ? minutesUntilReset : 0,
      resetTime: new Date(apiCallResetTime).toISOString()
    };
  }

  /**
   * Test API connectivity and authentication
   */
  async testConnection() {
    try {
      logger.info('Testing IronWifi API connection...');
      
      // Try common health/info endpoints
      const endpoints = [
        '/v1/networks',
        '/networks',
        '/api/v1/networks',
        '/health',
        '/status'
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await this.client.get(endpoint);
          logger.info(`IronWifi API connected successfully via ${endpoint}`, {
            status: response.status
          });
          return {
            success: true,
            endpoint,
            status: response.status,
            data: response.data
          };
        } catch (err) {
          logger.debug(`Endpoint ${endpoint} failed: ${err.message}`);
        }
      }

      throw new Error('Could not find working IronWifi API endpoint');
    } catch (error) {
      logger.error('IronWifi API connection test failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get list of networks
   */
  async getNetworks() {
    try {
      const response = await this.client.get('/v1/networks');
      return response.data;
    } catch (error) {
      logger.error('Failed to get networks:', error.message);
      throw error;
    }
  }

  /**
   * Get network details
   */
  async getNetwork(networkId = null) {
    try {
      const id = networkId || this.networkId;
      if (!id) {
        throw new Error('Network ID not provided');
      }
      const response = await this.client.get(`/v1/networks/${id}`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to get network ${networkId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all access points (routers) in the network
   * Returns list of APs with MAC addresses
   */
  async getAccessPoints(networkId = null) {
    try {
      const id = networkId || this.networkId;
      if (!id) {
        throw new Error('Network ID not provided');
      }
      
      const response = await this.client.get(`/v1/networks/${id}/access-points`);
      logger.info(`Retrieved ${response.data?.length || 0} access points from IronWifi`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get access points:', error.message);
      throw error;
    }
  }

  /**
   * Get active sessions across the network
   * Sessions contain user connection data including MAC addresses
   */
  async getActiveSessions(networkId = null) {
    try {
      const id = networkId || this.networkId;
      if (!id) {
        throw new Error('Network ID not provided');
      }

      const response = await this.client.get(`/v1/networks/${id}/sessions`, {
        params: {
          status: 'active',
          limit: 1000
        }
      });

      const sessions = Array.isArray(response.data) ? response.data : response.data.sessions || [];
      logger.info(`Retrieved ${sessions.length} active sessions from IronWifi`);
      return sessions;
    } catch (error) {
      logger.error('Failed to get active sessions:', error.message);
      throw error;
    }
  }

  /**
   * Get sessions for a specific access point (router) by MAC address
   */
  async getSessionsByAPMac(apMacAddress, options = {}) {
    try {
      const id = this.networkId;
      if (!id) {
        throw new Error('Network ID not provided');
      }

      const params = {
        ap_mac: apMacAddress.toLowerCase().replace(/[:-]/g, ''),
        ...options
      };

      const response = await this.client.get(`/v1/networks/${id}/sessions`, { params });
      
      const sessions = Array.isArray(response.data) ? response.data : response.data.sessions || [];
      logger.info(`Retrieved ${sessions.length} sessions for AP ${apMacAddress}`);
      return sessions;
    } catch (error) {
      logger.error(`Failed to get sessions for AP ${apMacAddress}:`, error.message);
      throw error;
    }
  }

  /**
   * Get session history for a date range
   */
  async getSessionHistory(networkId = null, startDate, endDate) {
    try {
      const id = networkId || this.networkId;
      if (!id) {
        throw new Error('Network ID not provided');
      }

      const params = {
        start_date: startDate ? startDate.toISOString() : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        end_date: endDate ? endDate.toISOString() : new Date().toISOString(),
        limit: 1000
      };

      const response = await this.client.get(`/v1/networks/${id}/sessions`, { params });
      
      const sessions = Array.isArray(response.data) ? response.data : response.data.sessions || [];
      logger.info(`Retrieved ${sessions.length} historical sessions`);
      return sessions;
    } catch (error) {
      logger.error('Failed to get session history:', error.message);
      throw error;
    }
  }

  /**
   * Get users (registered users if using user authentication)
   */
  async getUsers(networkId = null) {
    try {
      const id = networkId || this.networkId;
      if (!id) {
        throw new Error('Network ID not provided');
      }

      const response = await this.client.get(`/v1/networks/${id}/users`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get users:', error.message);
      throw error;
    }
  }

  /**
   * Get statistics for the network
   */
  async getNetworkStats(networkId = null, period = '24h') {
    try {
      const id = networkId || this.networkId;
      if (!id) {
        throw new Error('Network ID not provided');
      }

      const response = await this.client.get(`/v1/networks/${id}/statistics`, {
        params: { period }
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to get network statistics:', error.message);
      throw error;
    }
  }

  /**
   * Get current user count for a specific AP by MAC address
   */
  async getCurrentUserCount(apMacAddress) {
    try {
      const sessions = await this.getSessionsByAPMac(apMacAddress, { status: 'active' });
      return sessions.length;
    } catch (error) {
      logger.error(`Failed to get user count for AP ${apMacAddress}:`, error.message);
      return 0;
    }
  }
}

// Singleton instance
let ironwifiClientInstance = null;

/**
 * Get or create IronWifi client instance
 */
function getIronWifiClient() {
  if (!ironwifiClientInstance) {
    ironwifiClientInstance = new IronWifiClient();
  }
  return ironwifiClientInstance;
}

/**
 * Check if IronWifi integration is enabled
 */
function isIronWifiEnabled() {
  return !!(process.env.IRONWIFI_API_KEY && process.env.IRONWIFI_NETWORK_ID);
}

module.exports = {
  IronWifiClient,
  getIronWifiClient,
  isIronWifiEnabled
};
