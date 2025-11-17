/**
 * Simple Session Authentication Routes
 * Basic password-based login for mobile access
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { logger, pool } = require('../config/database');
const authService = require('../services/authService');

// Simple in-memory session store (use Redis in production)
const sessions = new Map();

// Session expiry: 7 days
const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000;

// Feature flag for authentication (set via environment)
const AUTH_ENABLED = process.env.ENABLE_AUTH === 'true';

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

    // Store session with user info
    sessions.set(sessionToken, {
      createdAt: Date.now(),
      expiresAt,
      userId: user.id,
      username: user.username,
      role: user.role
    });

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
  
  if (sessionToken) {
    sessions.delete(sessionToken);
  }

  res.json({ success: true });
});

/**
 * GET /api/session/verify
 * Verify session token is valid
 */
router.get('/verify', (req, res) => {
  const sessionToken = req.headers.authorization?.replace('Bearer ', '');
  
  if (!sessionToken) {
    return res.status(401).json({ valid: false, error: 'No session token' });
  }

  const session = sessions.get(sessionToken);
  
  if (!session) {
    return res.status(401).json({ valid: false, error: 'Invalid session' });
  }

  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionToken);
    return res.status(401).json({ valid: false, error: 'Session expired' });
  }

  res.json({
    valid: true,
    expiresAt: new Date(session.expiresAt).toISOString()
  });
});

/**
 * Middleware to validate session (any authenticated user)
 */
function requireAuth(req, res, next) {
  // If auth is disabled, allow all requests
  if (!AUTH_ENABLED) {
    req.user = { id: 1, username: 'admin', role: 'admin' }; // Mock admin user
    return next();
  }

  const sessionToken = req.headers.authorization?.replace('Bearer ', '');
  
  if (!sessionToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const session = sessions.get(sessionToken);
  
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(sessionToken);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  // Attach user info to request
  req.user = {
    id: session.userId,
    username: session.username,
    role: session.role
  };

  next();
}

/**
 * Middleware to require admin role
 */
function requireAdmin(req, res, next) {
  // If auth is disabled, allow all requests
  if (!AUTH_ENABLED) {
    req.user = { id: 1, username: 'admin', role: 'admin' };
    return next();
  }

  const sessionToken = req.headers.authorization?.replace('Bearer ', '');
  
  if (!sessionToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const session = sessions.get(sessionToken);
  
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(sessionToken);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  // Check if user is admin
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Attach user info to request
  req.user = {
    id: session.userId,
    username: session.username,
    role: session.role
  };

  next();
}

/**
 * Middleware to check router access for current user
 * Use this on routes that access specific routers
 */
function requireRouterAccess(req, res, next) {
  // If auth is disabled, allow all requests
  if (!AUTH_ENABLED) {
    req.user = { id: 1, username: 'admin', role: 'admin' };
    return next();
  }

  const sessionToken = req.headers.authorization?.replace('Bearer ', '');
  
  if (!sessionToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const session = sessions.get(sessionToken);
  
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(sessionToken);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  // Attach user info to request
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
  // Extract router_id from params or body
  const routerId = req.params.routerId || req.body.router_id || req.query.router_id;

  if (!routerId) {
    return res.status(400).json({ error: 'Router ID required' });
  }

  // Check access asynchronously
  authService.hasRouterAccess(session.userId, routerId)
    .then(hasAccess => {
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied to this router' });
      }
      next();
    })
    .catch(error => {
      logger.error('Error checking router access:', error);
      res.status(500).json({ error: 'Failed to verify access' });
    });
}

// Backwards compatibility alias
function requireSession(req, res, next) {
  return requireAuth(req, res, next);
}

// Cleanup expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}, 60 * 60 * 1000);

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;
module.exports.requireRouterAccess = requireRouterAccess;
module.exports.requireSession = requireSession; // Backwards compatibility
