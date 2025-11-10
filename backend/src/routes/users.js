/**
 * User Management Routes
 * Admin routes for managing users and router assignments
 */

const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { requireAuth, requireAdmin } = require('./session');
const { logger } = require('../config/database');

/**
 * GET /api/users/me
 * Get current user info
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await authService.getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    logger.error('Error getting current user:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * GET /api/users
 * List all users (admin only)
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const users = await authService.listUsers({ includeInactive });

    res.json({
      success: true,
      users
    });
  } catch (error) {
    logger.error('Error listing users:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * POST /api/users
 * Create new user (admin only)
 */
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { username, password, role, email, fullName } = req.body;

    // Validation
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (!role || !['admin', 'guest'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin" or "guest"' });
    }

    // Create user
    const user = await authService.createUser({
      username,
      password,
      role,
      email,
      fullName,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      user
    });
  } catch (error) {
    if (error.message === 'Username already exists') {
      return res.status(409).json({ error: error.message });
    }
    logger.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * GET /api/users/:userId
 * Get user details (admin only)
 */
router.get('/:userId', requireAdmin, async (req, res) => {
  try {
    const user = await authService.getUserById(req.params.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    logger.error('Error getting user:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * PATCH /api/users/:userId
 * Update user (admin only)
 */
router.patch('/:userId', requireAdmin, async (req, res) => {
  try {
    const { email, fullName, isActive } = req.body;

    const updates = {};
    if (email !== undefined) updates.email = email;
    if (fullName !== undefined) updates.full_name = fullName;
    if (isActive !== undefined) updates.is_active = isActive;

    const user = await authService.updateUser(req.params.userId, updates);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    logger.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * POST /api/users/:userId/password
 * Change user password (admin only)
 */
router.post('/:userId/password', requireAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    await authService.changePassword(req.params.userId, newPassword);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    logger.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

/**
 * DELETE /api/users/:userId
 * Deactivate user (admin only)
 */
router.delete('/:userId', requireAdmin, async (req, res) => {
  try {
    // Prevent self-deactivation
    if (parseInt(req.params.userId) === req.user.id) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    await authService.deactivateUser(req.params.userId);

    res.json({
      success: true,
      message: 'User deactivated successfully'
    });
  } catch (error) {
    logger.error('Error deactivating user:', error);
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

/**
 * POST /api/users/:userId/reactivate
 * Reactivate user (admin only)
 */
router.post('/:userId/reactivate', requireAdmin, async (req, res) => {
  try {
    await authService.reactivateUser(req.params.userId);

    res.json({
      success: true,
      message: 'User reactivated successfully'
    });
  } catch (error) {
    logger.error('Error reactivating user:', error);
    res.status(500).json({ error: 'Failed to reactivate user' });
  }
});

/**
 * GET /api/users/:userId/routers
 * Get user's assigned routers
 */
router.get('/:userId/routers', requireAdmin, async (req, res) => {
  try {
    const routers = await authService.getUserRouters(req.params.userId);

    res.json({
      success: true,
      routers
    });
  } catch (error) {
    logger.error('Error getting user routers:', error);
    res.status(500).json({ error: 'Failed to get user routers' });
  }
});

/**
 * POST /api/users/:userId/routers/:routerId
 * Assign router to user (admin only)
 */
router.post('/:userId/routers/:routerId', requireAdmin, async (req, res) => {
  try {
    const { notes } = req.body;

    const assignment = await authService.assignRouter(
      req.params.userId,
      req.params.routerId,
      req.user.id,
      notes
    );

    res.json({
      success: true,
      assignment
    });
  } catch (error) {
    if (error.message === 'User or router not found') {
      return res.status(404).json({ error: error.message });
    }
    logger.error('Error assigning router:', error);
    res.status(500).json({ error: 'Failed to assign router' });
  }
});

/**
 * DELETE /api/users/:userId/routers/:routerId
 * Unassign router from user (admin only)
 */
router.delete('/:userId/routers/:routerId', requireAdmin, async (req, res) => {
  try {
    await authService.unassignRouter(req.params.userId, req.params.routerId);

    res.json({
      success: true,
      message: 'Router unassigned successfully'
    });
  } catch (error) {
    logger.error('Error unassigning router:', error);
    res.status(500).json({ error: 'Failed to unassign router' });
  }
});

/**
 * GET /api/users/:userId/login-history
 * Get user's login history (admin only)
 */
router.get('/:userId/login-history', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = await authService.getLoginHistory(req.params.userId, limit);

    res.json({
      success: true,
      history
    });
  } catch (error) {
    logger.error('Error getting login history:', error);
    res.status(500).json({ error: 'Failed to get login history' });
  }
});

module.exports = router;
