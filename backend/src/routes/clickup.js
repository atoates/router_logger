/**
 * ClickUp Routes (composed)
 *
 * This file stays intentionally small; it just mounts:
 * - clickupAuthRoutes
 * - clickupAdminRoutes
 * - clickupDebugRoutes (gated by ENABLE_DEBUG_ENDPOINTS=true)
 */

const express = require('express');
const router = express.Router();

const clickupAuthRoutes = require('./clickup/clickupAuthRoutes');
const clickupAdminRoutes = require('./clickup/clickupAdminRoutes');
const clickupDebugRoutes = require('./clickup/clickupDebugRoutes');

router.use(clickupAuthRoutes);
router.use(clickupAdminRoutes);

// Debug endpoints are gated. When disabled, we still respond 404 under /debug/*.
router.use('/debug', (req, res, next) => {
  if (process.env.ENABLE_DEBUG_ENDPOINTS === 'true') return next();
  return res.status(404).json({ error: 'Not found' });
});
router.use(clickupDebugRoutes);

module.exports = router;
