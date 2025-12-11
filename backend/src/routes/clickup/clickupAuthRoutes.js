/**
 * ClickUp Auth Routes
 * - OAuth status
 * - OAuth start (redirect / return URL)
 * - OAuth callback
 * - Disconnect
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { requireAdmin } = require('../session');
const clickupOAuthService = require('../../services/clickupOAuthService');
const clickupClient = require('../../services/clickupClient');
const { pool } = require('../../config/database');
const logger = require('../../config/database').logger;
const { sanitizeError } = require('../../utils/errorLogger');

// All ClickUp routes require admin access
router.use(requireAdmin);

// OAuth state is persisted in Postgres via oauth_state_store (deploy/scale safe)
const CLICKUP_OAUTH_STATE_PROVIDER = 'clickup';

async function storeOAuthState(state, data, ttlMs) {
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.query(
    `INSERT INTO oauth_state_store (provider, state, data, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, state)
     DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    [CLICKUP_OAUTH_STATE_PROVIDER, state, data || null, expiresAt]
  );
}

async function getOAuthState(state) {
  const result = await pool.query(
    `SELECT data, expires_at
     FROM oauth_state_store
     WHERE provider = $1 AND state = $2 AND expires_at > NOW()
     LIMIT 1`,
    [CLICKUP_OAUTH_STATE_PROVIDER, state]
  );
  return result.rows[0] || null;
}

async function deleteOAuthState(state) {
  await pool.query(
    'DELETE FROM oauth_state_store WHERE provider = $1 AND state = $2',
    [CLICKUP_OAUTH_STATE_PROVIDER, state]
  );
}

// Cleanup expired states periodically
setInterval(() => {
  pool.query(
    'DELETE FROM oauth_state_store WHERE provider = $1 AND expires_at < NOW()',
    [CLICKUP_OAUTH_STATE_PROVIDER]
  ).catch((err) => logger.warn('Failed to cleanup expired ClickUp OAuth states', { error: err.message }));
}, 2 * 60 * 1000);

/**
 * GET /api/clickup/auth/status
 * Check ClickUp authorization status (backwards compatible response)
 */
router.get('/auth/status', async (req, res) => {
  try {
    const hasToken = await clickupOAuthService.hasValidToken('default');

    let workspaceInfo = null;
    if (hasToken) {
      const result = await pool.query(
        'SELECT workspace_id, workspace_name, created_at FROM clickup_oauth_tokens WHERE user_id = $1',
        ['default']
      );
      workspaceInfo = result.rows[0] || null;
    }

    if (!hasToken) {
      return res.json({
        authorized: false,
        workspace: null,
        connected: false,
        valid: false,
        message: 'Not connected to ClickUp'
      });
    }

    // Test the token by making a simple API call
    try {
      const client = await clickupClient.getAuthorizedClient('default');
      await client.get('/user');

      return res.json({
        authorized: true,
        workspace: workspaceInfo,
        connected: true,
        valid: true,
        message: 'ClickUp connection is active'
      });
    } catch (error) {
      // Token exists but is invalid
      if (error.response?.status === 401) {
        return res.json({
          authorized: true,
          workspace: workspaceInfo,
          connected: true,
          valid: false,
          message: 'ClickUp token expired. Please reconnect.'
        });
      }
      throw error;
    }
  } catch (error) {
    logger.error('Error checking ClickUp status:', sanitizeError(error));
    res.status(500).json({ error: 'Failed to check ClickUp status' });
  }
});

/**
 * GET /api/clickup/auth
 * Direct redirect to ClickUp OAuth (for mobile/simple flows)
 */
router.get('/auth', async (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    await storeOAuthState(state, { mobile: true }, 10 * 60 * 1000);

    logger.info('Generating ClickUp OAuth state', { state });

    const authUrl = clickupOAuthService.getAuthorizationUrl(state);
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Error generating auth URL:', sanitizeError(error));
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

/**
 * GET /api/clickup/auth/url
 * Get OAuth authorization URL (returns JSON for SPA)
 */
router.get('/auth/url', async (req, res) => {
  try {
    const { mobile } = req.query;
    const state = crypto.randomBytes(16).toString('hex');
    await storeOAuthState(state, { mobile: mobile === 'true' }, 20 * 60 * 1000);

    logger.info('Generating ClickUp OAuth state for URL endpoint', {
      state,
      mobile: mobile === 'true'
    });

    const authUrl = clickupOAuthService.getAuthorizationUrl(state);
    res.json({ authUrl, state });
  } catch (error) {
    logger.error('Error generating auth URL:', sanitizeError(error));
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

/**
 * GET /api/clickup/auth/callback
 * OAuth callback endpoint
 */
router.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  try {
    logger.info('ClickUp OAuth callback received', {
      hasCode: !!code,
      hasState: !!state,
      state
    });

    const storedState = await getOAuthState(state);
    const isMobile = storedState?.data?.mobile || false;

    logger.info('State verification', {
      state,
      found: !!storedState,
      expired: storedState ? new Date(storedState.expires_at).getTime() < Date.now() : null,
      mobile: isMobile,
      statesInMemory: 'db'
    });

    if (!storedState) {
      logger.error('State validation failed', { state, found: false, expired: null });

      if (req.headers['user-agent']?.match(/Mobile|Android|iPhone/i)) {
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 20px;
              }
              .container {
                background: white;
                border-radius: 16px;
                padding: 32px;
                max-width: 400px;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              }
              .error-icon { font-size: 64px; margin-bottom: 16px; }
              h1 { color: #dc2626; margin: 0 0 12px 0; font-size: 24px; }
              p { color: #6b7280; margin: 0 0 24px 0; line-height: 1.5; }
              button {
                width: 100%;
                padding: 14px;
                background: #667eea;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="error-icon">❌</div>
              <h1>Connection Failed</h1>
              <p>Invalid state parameter - possible CSRF attack</p>
              <p style="font-size: 14px;">Redirecting to dashboard...</p>
              <button onclick="window.location.href='/'">Go to Dashboard</button>
            </div>
            <script>
              setTimeout(() => { window.location.href = '/'; }, 3000);
            </script>
          </body>
          </html>
        `);
      }

      return res.status(400).json({
        error: 'Invalid or expired state parameter',
        details: storedState ? 'State expired' : 'State not found'
      });
    }

    await deleteOAuthState(state);

    if (!code) {
      return res.status(400).json({ error: 'Authorization code not provided' });
    }

    const tokenData = await clickupOAuthService.exchangeCodeForToken(code);

    const client = await axios.create({
      baseURL: 'https://api.clickup.com/api/v2',
      headers: { Authorization: tokenData.access_token }
    });

    const workspacesResponse = await client.get('/team');
    const workspace = workspacesResponse.data.teams?.[0];

    await clickupOAuthService.storeToken('default', tokenData.access_token, {
      workspace_id: workspace?.id,
      workspace_name: workspace?.name
    });

    logger.info('ClickUp OAuth authorization successful', {
      workspace: workspace?.name,
      mobile: isMobile
    });

    if (isMobile || req.headers['user-agent']?.match(/Mobile|Android|iPhone/i)) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 16px;
              padding: 32px;
              max-width: 400px;
              text-align: center;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            .success-icon { font-size: 64px; margin-bottom: 16px; }
            h1 { color: #10b981; margin: 0 0 12px 0; font-size: 24px; }
            p { color: #6b7280; margin: 0 0 24px 0; line-height: 1.5; }
            button {
              width: 100%;
              padding: 14px;
              background: #10b981;
              color: white;
              border: none;
              border-radius: 8px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Connected Successfully!</h1>
            <p>ClickUp workspace: <strong>${workspace?.name || 'Connected'}</strong></p>
            <p style="font-size: 14px;">Redirecting to dashboard...</p>
            <button onclick="window.location.href='/'">Go to Dashboard</button>
          </div>
          <script>
            setTimeout(() => { window.location.href = '/'; }, 2000);
          </script>
        </body>
        </html>
      `);
    }

    return res.json({
      success: true,
      workspace: {
        id: workspace?.id,
        name: workspace?.name
      }
    });
  } catch (error) {
    logger.error('Error in OAuth callback:', sanitizeError(error));

    if (req.headers['user-agent']?.match(/Mobile|Android|iPhone/i)) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 16px;
              padding: 32px;
              max-width: 400px;
              text-align: center;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            .error-icon { font-size: 64px; margin-bottom: 16px; }
            h1 { color: #dc2626; margin: 0 0 12px 0; font-size: 24px; }
            p { color: #6b7280; margin: 0 0 24px 0; line-height: 1.5; }
            button {
              width: 100%;
              padding: 14px;
              background: #667eea;
              color: white;
              border: none;
              border-radius: 8px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-icon">❌</div>
            <h1>Authorization Failed</h1>
            <p>${error.message || 'Something went wrong during authentication'}</p>
            <button onclick="window.location.href='/'">Return to Dashboard</button>
          </div>
        </body>
        </html>
      `);
    }

    return res.status(500).json({ error: 'Authorization failed' });
  }
});

/**
 * POST /api/clickup/auth/disconnect
 * Disconnect ClickUp integration
 */
router.post('/auth/disconnect', async (req, res) => {
  try {
    await clickupOAuthService.deleteToken('default');
    logger.info('ClickUp disconnected');
    res.json({ success: true });
  } catch (error) {
    logger.error('Error disconnecting ClickUp:', sanitizeError(error));
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

module.exports = router;


