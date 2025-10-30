/**
 * ClickUp OAuth Service
 * Handles OAuth 2.0 authorization flow for ClickUp API access
 */

const axios = require('axios');
const { pool } = require('../config/database');
const logger = require('../config/database').logger;

const CLICKUP_AUTH_URL = 'https://app.clickup.com/api';
const CLICKUP_TOKEN_URL = 'https://api.clickup.com/api/v2/oauth/token';

class ClickUpOAuthService {
  constructor() {
    this.clientId = process.env.CLICKUP_CLIENT_ID;
    this.clientSecret = process.env.CLICKUP_CLIENT_SECRET;
    this.redirectUri = process.env.CLICKUP_REDIRECT_URI;

    if (!this.clientId || !this.clientSecret) {
      logger.warn('ClickUp OAuth credentials not configured');
    }
  }

  /**
   * Generate authorization URL for OAuth flow
   * @param {string} state - Random state for CSRF protection
   * @returns {string} Authorization URL
   */
  getAuthorizationUrl(state) {
    // Manually encode only what's necessary - redirect_uri should be encoded once
    const encodedRedirectUri = encodeURIComponent(this.redirectUri);
    
    return `${CLICKUP_AUTH_URL}?client_id=${this.clientId}&redirect_uri=${encodedRedirectUri}&state=${state}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from callback
   * @returns {Promise<Object>} Token response with access_token
   */
  async exchangeCodeForToken(code) {
    try {
      const response = await axios.post(CLICKUP_TOKEN_URL, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code
      });

      return response.data;
    } catch (error) {
      logger.error('Error exchanging code for token:', error.response?.data || error.message);
      throw new Error('Failed to exchange authorization code for token');
    }
  }

  /**
   * Store OAuth token in database
   * @param {string} userId - User identifier (can use 'default' for single-user)
   * @param {string} accessToken - ClickUp access token
   * @param {Object} workspaceInfo - Workspace details
   */
  async storeToken(userId, accessToken, workspaceInfo = {}) {
    const query = `
      INSERT INTO clickup_oauth_tokens (user_id, access_token, workspace_id, workspace_name, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        access_token = EXCLUDED.access_token,
        workspace_id = EXCLUDED.workspace_id,
        workspace_name = EXCLUDED.workspace_name,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const values = [
      userId,
      accessToken,
      workspaceInfo.workspace_id || null,
      workspaceInfo.workspace_name || null
    ];

    try {
      const result = await pool.query(query, values);
      logger.info('ClickUp token stored successfully', { userId });
      return result.rows[0];
    } catch (error) {
      logger.error('Error storing ClickUp token:', error);
      throw error;
    }
  }

  /**
   * Retrieve stored access token
   * @param {string} userId - User identifier
   * @returns {Promise<string|null>} Access token or null
   */
  async getToken(userId = 'default') {
    try {
      const result = await pool.query(
        'SELECT access_token FROM clickup_oauth_tokens WHERE user_id = $1',
        [userId]
      );

      return result.rows[0]?.access_token || null;
    } catch (error) {
      logger.error('Error retrieving ClickUp token:', error);
      return null;
    }
  }

  /**
   * Check if user has valid token
   * @param {string} userId - User identifier
   * @returns {Promise<boolean>}
   */
  async hasValidToken(userId = 'default') {
    const token = await this.getToken(userId);
    return !!token;
  }

  /**
   * Delete stored token (logout)
   * @param {string} userId - User identifier
   */
  async deleteToken(userId = 'default') {
    try {
      await pool.query(
        'DELETE FROM clickup_oauth_tokens WHERE user_id = $1',
        [userId]
      );
      logger.info('ClickUp token deleted', { userId });
    } catch (error) {
      logger.error('Error deleting ClickUp token:', error);
      throw error;
    }
  }
}

module.exports = new ClickUpOAuthService();
