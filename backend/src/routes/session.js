/**
 * Simple Session Authentication Routes
 * Basic password-based login for mobile access
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { logger, pool } = require('../config/database');

// Simple in-memory session store (use Redis in production)
const sessions = new Map();

// Session expiry: 7 days
const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000;

/**
 * POST /api/session/login
 * Simple password-based login
 */
router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    // Check against environment variable password
    const correctPassword = process.env.MOBILE_PASSWORD || 'router123';
    
    if (password !== correctPassword) {
      logger.warn('Failed login attempt');
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Generate session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_EXPIRY;

    // Store session
    sessions.set(sessionToken, {
      createdAt: Date.now(),
      expiresAt,
      userId: 'default_user'
    });

    logger.info('User logged in successfully');

    res.json({
      success: true,
      sessionToken,
      expiresAt: new Date(expiresAt).toISOString()
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
 * Middleware to validate session
 */
function requireSession(req, res, next) {
  const sessionToken = req.headers.authorization?.replace('Bearer ', '');
  
  if (!sessionToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const session = sessions.get(sessionToken);
  
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(sessionToken);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  req.userId = session.userId;
  next();
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
module.exports.requireSession = requireSession;
