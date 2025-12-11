/**
 * Simple Session Authentication Routes
 * Basic password-based login for mobile access
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { logger, pool } = require('../config/database');
const authService = require('../services/authService');

// Session expiry: 7 days
const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000;

// Feature flag for authentication (set via environment)
const AUTH_ENABLED = process.env.ENABLE_AUTH === 'true';

function hashSessionToken(sessionToken) {
  return crypto.createHash('sha256').update(String(sessionToken)).digest('hex');
}

async function getSessionFromRequest(req) {
  const sessionToken = req.headers.authorization?.replace('Bearer ', '');
  if (!sessionToken) return null;

  const tokenHash = hashSessionToken(sessionToken);
  const result = await pool.query(
    `SELECT user_id, username, role, expires_at
     FROM user_sessions
     WHERE session_token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const expiresAt = new Date(row.expires_at);

  if (expiresAt.getTime() < Date.now()) {
    // Expired - cleanup
    await pool.query('DELETE FROM user_sessions WHERE session_token_hash = $1', [tokenHash]);
    return null;
  }

  // Update last_seen asynchronously (best-effort)
  pool.query(
    'UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_token_hash = $1',
    [tokenHash]
  ).catch(() => {});

  return {
    tokenHash,
    userId: row.user_id,
    username: row.username,
    role: row.role,
    expiresAt
  };
}

/**
 * POST /api/session/login
 * User authentication with username/password
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Get client info for logging
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Authenticate user
    const user = await authService.authenticateUser(username, password, ipAddress, userAgent);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Generate session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_EXPIRY;
    const tokenHash = hashSessionToken(sessionToken);

    // Store session in database (deploy/scale safe)
    await pool.query(
      `INSERT INTO user_sessions (session_token_hash, user_id, username, role, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_token_hash) DO NOTHING`,
      [tokenHash, user.id, user.username, user.role, new Date(expiresAt)]
    );

    logger.info(`User logged in: ${user.username} (${user.role})`);

    res.json({
      success: true,
      sessionToken,
      expiresAt: new Date(expiresAt).toISOString(),
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        fullName: user.full_name
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/session/logout
 * Logout and invalidate session
 */
router.post('/logout', (req, res) => {
  const { sessionToken } = req.body;

  if (!sessionToken) {
    return res.json({ success: true });
  }

  const tokenHash = hashSessionToken(sessionToken);
  pool.query('DELETE FROM user_sessions WHERE session_token_hash = $1', [tokenHash])
    .catch((err) => logger.warn('Failed to delete session during logout', { error: err.message }));

  return res.json({ success: true });
});

/**
 * GET /api/session/verify
 * Verify session token is valid
 */
router.get('/verify', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);

    if (!session) {
      return res.status(401).json({ valid: false, error: 'Invalid or expired session' });
    }

    return res.json({
      valid: true,
      expiresAt: session.expiresAt.toISOString()
    });
  } catch (error) {
    logger.error('Session verify error:', error);
    return res.status(500).json({ valid: false, error: 'Failed to verify session' });
  }
});

/**
 * Middleware to validate session (any authenticated user)
 */
async function requireAuth(req, res, next) {
  // If auth is disabled, allow all requests
  if (!AUTH_ENABLED) {
    req.user = { id: 1, username: 'admin', role: 'admin' }; // Mock admin user
    return next();
  }

  try {
    const session = await getSessionFromRequest(req);

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.user = {
      id: session.userId,
      username: session.username,
      role: session.role
    };

    return next();
  } catch (error) {
    logger.error('Authentication error:', error);
    return res.status(500).json({ error: 'Failed to authenticate' });
  }
}

/**
 * Middleware to require admin role
 */
async function requireAdmin(req, res, next) {
  // If auth is disabled, allow all requests
  if (!AUTH_ENABLED) {
    req.user = { id: 1, username: 'admin', role: 'admin' };
    return next();
  }

  try {
    const session = await getSessionFromRequest(req);

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    if (session.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = {
      id: session.userId,
      username: session.username,
      role: session.role
    };

    return next();
  } catch (error) {
    logger.error('Admin auth error:', error);
    return res.status(500).json({ error: 'Failed to authenticate' });
  }
}

/**
 * Middleware to check router access for current user
 * Use this on routes that access specific routers
 */
async function requireRouterAccess(req, res, next) {
  // If auth is disabled, allow all requests
  if (!AUTH_ENABLED) {
    req.user = { id: 1, username: 'admin', role: 'admin' };
    return next();
  }

  try {
    const session = await getSessionFromRequest(req);

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.user = {
      id: session.userId,
      username: session.username,
      role: session.role
    };

    // Admins have access to all routers
    if (session.role === 'admin') {
      return next();
    }

    // For guests, check router assignment
    const routerId = req.params.routerId || req.body.router_id || req.query.router_id;
    if (!routerId) {
      return res.status(400).json({ error: 'Router ID required' });
    }

    const hasAccess = await authService.hasRouterAccess(session.userId, routerId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied to this router' });
    }

    return next();
  } catch (error) {
    logger.error('Error checking router access:', error);
    return res.status(500).json({ error: 'Failed to verify access' });
  }
}

// Backwards compatibility alias
function requireSession(req, res, next) {
  return requireAuth(req, res, next);
}

// Cleanup expired sessions every hour (DB)
setInterval(() => {
  pool.query('DELETE FROM user_sessions WHERE expires_at < NOW()')
    .catch((err) => logger.warn('Failed to cleanup expired sessions', { error: err.message }));
}, 60 * 60 * 1000);

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;
module.exports.requireRouterAccess = requireRouterAccess;
module.exports.requireSession = requireSession; // Backwards compatibility
