/**
 * RMS OAuth Service
 * Handles OAuth 2.0 Authorization Code Flow with PKCE for Teltonika RMS
 * 
 * Based on RMS OAuth documentation:
 * - Authorization endpoint: https://rms.teltonika-networks.com/oauth/authorize
 * - Token endpoint: https://rms.teltonika-networks.com/oauth/token
 * - Requires PKCE (code_challenge, code_verifier)
 */

const crypto = require('crypto');
const axios = require('axios');
const { logger } = require('../config/database');
const db = require('../database/db');

class RMSOAuthService {
  constructor() {
    this.clientId = process.env.RMS_OAUTH_CLIENT_ID;
    this.clientSecret = process.env.RMS_OAUTH_CLIENT_SECRET;
    this.redirectUri = process.env.RMS_OAUTH_REDIRECT_URI;
    this.authUrl = 'https://rms.teltonika-networks.com/oauth/authorize';
    this.tokenUrl = 'https://rms.teltonika-networks.com/oauth/token';
    this.revokeUrl = 'https://rms.teltonika-networks.com/oauth/revoke';
    
    // In-memory PKCE storage (in production, use Redis or DB)
    this.pkceStore = new Map();
  }

  /**
   * Generate PKCE code verifier and challenge
   * @returns {Object} { codeVerifier, codeChallenge }
   */
  generatePKCE() {
    // Generate random 128-character code verifier
    const codeVerifier = crypto
      .randomBytes(96)
      .toString('base64url');
    
    // Generate SHA256 hash of verifier as challenge
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    
    return { codeVerifier, codeChallenge };
  }

  /**
   * Generate random state for CSRF protection
   * @returns {string} Random state string
   */
  generateState() {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Get authorization URL for user to visit
   * @param {string} state - CSRF protection state
   * @returns {Object} { authUrl, state, codeVerifier }
   */
  getAuthorizationUrl(state = null) {
    if (!this.clientId || !this.redirectUri) {
      throw new Error('RMS OAuth not configured. Set RMS_OAUTH_CLIENT_ID and RMS_OAUTH_REDIRECT_URI');
    }

    const generatedState = state || this.generateState();
    const { codeVerifier, codeChallenge } = this.generatePKCE();
    
    // Store PKCE verifier for later use in token exchange
    this.pkceStore.set(generatedState, {
      codeVerifier,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    // Clean up expired PKCE entries
    this.cleanupExpiredPKCE();

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state: generatedState,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: 'devices:read monitoring:read statistics:read company_device_statistics:read'
    });

    const authUrl = `${this.authUrl}?${params.toString()}`;
    
    logger.info('Generated OAuth authorization URL', { state: generatedState });
    
    return {
      authUrl,
      state: generatedState,
      codeVerifier // For testing purposes
    };
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from callback
   * @param {string} state - State from callback for verification
   * @returns {Object} Token response
   */
  async exchangeCodeForToken(code, state) {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new Error('RMS OAuth not configured');
    }

    // Retrieve and validate PKCE verifier
    const pkceData = this.pkceStore.get(state);
    if (!pkceData) {
      throw new Error('Invalid or expired state parameter');
    }

    if (Date.now() > pkceData.expiresAt) {
      this.pkceStore.delete(state);
      throw new Error('PKCE verifier expired');
    }

    const { codeVerifier } = pkceData;
    this.pkceStore.delete(state); // Use once only

    try {
      const response = await axios.post(
        this.tokenUrl,
        {
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.redirectUri,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code_verifier: codeVerifier
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const tokenData = response.data;
      
      logger.info('Successfully exchanged code for OAuth token', {
        tokenType: tokenData.token_type,
        expiresIn: tokenData.expires_in,
        scope: tokenData.scope
      });

      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenType: tokenData.token_type || 'Bearer',
        expiresIn: tokenData.expires_in, // seconds
        scope: tokenData.scope
      };
    } catch (error) {
      logger.error('Error exchanging code for token', {
        error: error.message,
        response: error.response?.data
      });
      throw new Error('Failed to exchange authorization code for token');
    }
  }

  /**
   * Refresh an expired access token
   * @param {string} refreshToken - Refresh token
   * @returns {Object} New token response
   */
  async refreshAccessToken(refreshToken) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('RMS OAuth not configured');
    }

    try {
      const response = await axios.post(
        this.tokenUrl,
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const tokenData = response.data;
      
      logger.info('Successfully refreshed OAuth token', {
        expiresIn: tokenData.expires_in
      });

      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || refreshToken, // Some providers don't return new refresh token
        tokenType: tokenData.token_type || 'Bearer',
        expiresIn: tokenData.expires_in,
        scope: tokenData.scope
      };
    } catch (error) {
      logger.error('Error refreshing token', {
        error: error.message,
        response: error.response?.data
      });
      throw new Error('Failed to refresh access token');
    }
  }

  /**
   * Revoke a token (logout)
   * @param {string} token - Access or refresh token to revoke
   * @param {string} tokenTypeHint - 'access_token' or 'refresh_token'
   */
  async revokeToken(token, tokenTypeHint = 'access_token') {
    try {
      await axios.post(
        this.revokeUrl,
        {
          token,
          token_type_hint: tokenTypeHint,
          client_id: this.clientId,
          client_secret: this.clientSecret
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      logger.info('Successfully revoked OAuth token', { tokenTypeHint });
    } catch (error) {
      logger.error('Error revoking token', {
        error: error.message,
        response: error.response?.data
      });
      // Don't throw - revocation failures are non-critical
    }
  }

  /**
   * Store OAuth token in database
   * @param {string} userId - User identifier (email or RMS user ID)
   * @param {Object} tokenData - Token data from OAuth
   */
  async storeToken(userId, tokenData) {
    const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);

    const query = `
      INSERT INTO oauth_tokens (user_id, access_token, refresh_token, token_type, expires_at, scope)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_type = EXCLUDED.token_type,
        expires_at = EXCLUDED.expires_at,
        scope = EXCLUDED.scope,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `;

    const values = [
      userId,
      tokenData.accessToken,
      tokenData.refreshToken,
      tokenData.tokenType,
      expiresAt,
      tokenData.scope
    ];

    try {
      const result = await db.query(query, values);
      logger.info('Stored OAuth token for user', { userId, expiresAt });
      return result.rows[0];
    } catch (error) {
      logger.error('Error storing OAuth token', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Get valid OAuth token for user (auto-refreshes if needed)
   * @param {string} userId - User identifier
   * @returns {Object} Valid token data or null
   */
  async getValidToken(userId) {
    const query = `
      SELECT * FROM oauth_tokens
      WHERE user_id = $1
      LIMIT 1
    `;

    try {
      const result = await db.query(query, [userId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const tokenRow = result.rows[0];
      const now = new Date();
      const expiresAt = new Date(tokenRow.expires_at);
      
      // Token still valid (with 5-minute buffer)
      if (expiresAt > new Date(now.getTime() + 5 * 60 * 1000)) {
        return {
          accessToken: tokenRow.access_token,
          tokenType: tokenRow.token_type,
          scope: tokenRow.scope
        };
      }

      // Token expired, try to refresh
      if (tokenRow.refresh_token) {
        logger.info('Token expired, refreshing...', { userId });
        
        try {
          const newTokenData = await this.refreshAccessToken(tokenRow.refresh_token);
          await this.storeToken(userId, newTokenData);
          
          return {
            accessToken: newTokenData.accessToken,
            tokenType: newTokenData.tokenType,
            scope: newTokenData.scope
          };
        } catch (error) {
          logger.error('Failed to refresh token', { error: error.message, userId });
          // Delete invalid token
          await this.deleteToken(userId);
          return null;
        }
      }

      // No refresh token available
      logger.warn('Token expired and no refresh token available', { userId });
      await this.deleteToken(userId);
      return null;
      
    } catch (error) {
      logger.error('Error getting valid token', { error: error.message, userId });
      return null;
    }
  }

  /**
   * Delete OAuth token for user
   * @param {string} userId - User identifier
   */
  async deleteToken(userId) {
    const query = 'DELETE FROM oauth_tokens WHERE user_id = $1';
    
    try {
      await db.query(query, [userId]);
      logger.info('Deleted OAuth token for user', { userId });
    } catch (error) {
      logger.error('Error deleting OAuth token', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Clean up expired PKCE entries from memory
   */
  cleanupExpiredPKCE() {
    const now = Date.now();
    for (const [state, data] of this.pkceStore.entries()) {
      if (now > data.expiresAt) {
        this.pkceStore.delete(state);
      }
    }
  }

  /**
   * Check if OAuth is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!(this.clientId && this.clientSecret && this.redirectUri);
  }
}

module.exports = new RMSOAuthService();
