/**
 * OAuth Authentication Routes
 * Handles RMS OAuth 2.0 flow
 */

const express = require('express');
const router = express.Router();
const oauthService = require('../services/oauthService');
const logger = require('../utils/logger');

/**
 * GET /api/auth/rms/login
 * Redirect user to RMS OAuth authorization page
 */
router.get('/rms/login', (req, res) => {
  try {
    if (!oauthService.isConfigured()) {
      return res.status(500).json({
        success: false,
        error: 'OAuth not configured. Set RMS_OAUTH_CLIENT_ID, RMS_OAUTH_CLIENT_SECRET, and RMS_OAUTH_REDIRECT_URI'
      });
    }

    const { authUrl, state } = oauthService.getAuthorizationUrl();
    
    // Store state in session cookie for CSRF protection
    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000 // 10 minutes
    });

    logger.info('Redirecting user to RMS OAuth', { state });
    
    // Redirect to RMS login
    res.redirect(authUrl);
    
  } catch (error) {
    logger.error('Error initiating OAuth flow', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to initiate OAuth flow'
    });
  }
});

/**
 * GET /api/auth/rms/callback
 * Handle OAuth callback from RMS
 * Query params: code, state
 */
router.get('/rms/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    
    // Check for OAuth errors
    if (error) {
      logger.error('OAuth authorization error', { error, error_description });
      
      // Redirect to frontend with error
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(error_description || error)}`);
    }

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing code or state parameter'
      });
    }

    // Verify state matches (CSRF protection)
    const storedState = req.cookies.oauth_state;
    if (!storedState || storedState !== state) {
      logger.error('State mismatch - possible CSRF attack', {
        received: state,
        stored: storedState
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid state parameter'
      });
    }

    // Clear state cookie
    res.clearCookie('oauth_state');

    // Exchange code for token
    const tokenData = await oauthService.exchangeCodeForToken(code, state);
    
    // For now, use a default user ID
    // In production, you'd extract user info from the token or make an API call
    const userId = 'default_rms_user';
    
    // Store token in database
    await oauthService.storeToken(userId, tokenData);
    
    logger.info('OAuth flow completed successfully', { userId });
    
    // Redirect to frontend with success
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}?auth_success=true`);
    
  } catch (error) {
    logger.error('Error handling OAuth callback', { error: error.message });
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent('Failed to complete authentication')}`);
  }
});

/**
 * GET /api/auth/rms/status
 * Check if user has valid OAuth token
 */
router.get('/rms/status', async (req, res) => {
  try {
    const userId = 'default_rms_user'; // Replace with actual user from session
    
    const token = await oauthService.getValidToken(userId);
    
    res.json({
      success: true,
      authenticated: !!token,
      configured: oauthService.isConfigured(),
      scope: token?.scope || null
    });
    
  } catch (error) {
    logger.error('Error checking OAuth status', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to check authentication status'
    });
  }
});

/**
 * POST /api/auth/rms/logout
 * Revoke OAuth token and log out
 */
router.post('/rms/logout', async (req, res) => {
  try {
    const userId = 'default_rms_user'; // Replace with actual user from session
    
    const token = await oauthService.getValidToken(userId);
    
    if (token) {
      // Revoke the token with RMS
      await oauthService.revokeToken(token.accessToken, 'access_token');
    }
    
    // Delete from database
    await oauthService.deleteToken(userId);
    
    logger.info('User logged out', { userId });
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
    
  } catch (error) {
    logger.error('Error logging out', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to log out'
    });
  }
});

module.exports = router;
