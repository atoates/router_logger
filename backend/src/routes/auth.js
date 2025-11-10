/**
 * OAuth Authentication Routes
 * Handles RMS OAuth 2.0 flow
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('./session');
const oauthService = require('../services/oauthService');

// All OAuth routes require admin access
router.use(requireAdmin);
const { startRMSSync, isRMSSyncRunning } = require('../services/rmsSync');
const { logger } = require('../config/database');

// Server-side state storage for OAuth (fixes mobile cookie issues)
const oauthStates = new Map();

// Clean up expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStates.entries()) {
    if (data.expiresAt <= now) {
      oauthStates.delete(state);
    }
  }
}, 5 * 60 * 1000);

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
    
    // Store state server-side for CSRF protection (mobile-friendly)
    oauthStates.set(state, {
      createdAt: Date.now(),
      expiresAt: Date.now() + (10 * 60 * 1000) // 10 minutes
    });
    
    // Also set cookie as backup for desktop
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
    // Check server-side store first (mobile-friendly), then cookie (desktop fallback)
    const serverState = oauthStates.get(state);
    const cookieState = req.cookies.oauth_state;
    
    const isValidState = (serverState && serverState.expiresAt > Date.now()) || (cookieState === state);
    
    if (!isValidState) {
      logger.error('State mismatch - possible CSRF attack', {
        received: state,
        hasServerState: !!serverState,
        serverStateExpired: serverState ? serverState.expiresAt <= Date.now() : null,
        hasCookieState: !!cookieState,
        cookieMatches: cookieState === state
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid state parameter'
      });
    }

    // Clear state from both stores
    oauthStates.delete(state);
    res.clearCookie('oauth_state');

    // Exchange code for token
    const tokenData = await oauthService.exchangeCodeForToken(code, state);
    
    // For now, use a default user ID
    // In production, you'd extract user info from the token or make an API call
    const userId = 'default_rms_user';
    
    // Store token in database
    await oauthService.storeToken(userId, tokenData);
    
    logger.info('OAuth flow completed successfully', { userId });
    
    // Ensure RMS sync is running now that OAuth token exists
    const interval = parseInt(process.env.RMS_SYNC_INTERVAL_MINUTES || '15', 10);
    if (!isRMSSyncRunning()) {
      startRMSSync(interval);
      logger.info('RMS sync started after OAuth');
    }
    
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

/**
 * GET /api/auth/status
 * Check OAuth token status for debugging
 */
router.get('/status', async (req, res) => {
  try {
    const status = {
      rms: { connected: false, error: null },
      clickup: { connected: false, error: null }
    };

    // Check RMS token
    try {
      const rmsToken = await oauthService.getValidToken('default_rms_user');
      status.rms.connected = !!rmsToken;
      if (rmsToken) {
        status.rms.hasToken = true;
        status.rms.tokenType = 'oauth';
      }
    } catch (error) {
      status.rms.error = error.message;
      logger.error('RMS token check failed:', error);
    }

    // Check ClickUp token
    try {
      const clickupOAuthService = require('../services/clickupOAuthService');
      const hasToken = await clickupOAuthService.hasValidToken('default');
      status.clickup.connected = hasToken;
      if (hasToken) {
        status.clickup.hasToken = true;
      }
    } catch (error) {
      status.clickup.error = error.message;
      logger.error('ClickUp token check failed:', error);
    }

    res.json(status);
  } catch (error) {
    logger.error('Error checking auth status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/auth/clickup/callback
 * Redirect for ClickUp OAuth callback (fallback for misconfigured redirect URI)
 * Redirects to correct callback endpoint
 */
router.get('/clickup/callback', (req, res) => {
  const { code, state } = req.query;
  logger.info('Redirecting ClickUp OAuth callback to correct endpoint', { 
    hasCode: !!code, 
    hasState: !!state 
  });
  
  // Redirect to the correct ClickUp callback endpoint
  const redirectUrl = `/api/clickup/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  res.redirect(redirectUrl);
});

module.exports = router;
