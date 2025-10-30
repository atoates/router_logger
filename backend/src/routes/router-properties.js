/**
 * Router-Property Assignment Routes
 * Handles tracking which routers are installed at which properties
 */

const express = require('express');
const router = express.Router();
const propertyService = require('../services/propertyService');
const clickupClient = require('../services/clickupClient');
const { logger } = require('../config/database');

/**
 * GET /api/router-properties/:routerId/current
 * Get current property assignment for a router
 */
router.get('/:routerId/current', async (req, res) => {
  try {
    const { routerId } = req.params;
    const currentProperty = await propertyService.getCurrentProperty(routerId);

    if (!currentProperty) {
      return res.json({ 
        assigned: false,
        routerId 
      });
    }

    res.json({
      assigned: true,
      ...currentProperty
    });

  } catch (error) {
    logger.error('Error getting current property:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/router-properties/:routerId/history
 * Get property assignment history for a router
 */
router.get('/:routerId/history', async (req, res) => {
  try {
    const { routerId } = req.params;
    const history = await propertyService.getPropertyHistory(routerId);

    res.json(history);

  } catch (error) {
    logger.error('Error getting property history:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/router-properties/assign
 * Assign router to a property
 */
router.post('/assign', async (req, res) => {
  try {
    const {
      routerId,
      propertyTaskId,
      propertyName,
      installedAt,
      installedBy,
      notes
    } = req.body;

    if (!routerId || !propertyTaskId) {
      return res.status(400).json({ 
        error: 'routerId and propertyTaskId are required' 
      });
    }

    // Assign in database
    const assignment = await propertyService.assignRouterToProperty({
      routerId,
      propertyTaskId,
      propertyName,
      installedAt,
      installedBy,
      notes
    });

    // TODO: Sync to ClickUp (update relationship custom fields)
    // This will be implemented once ClickUp custom fields are set up

    res.json({
      success: true,
      assignment
    });

  } catch (error) {
    logger.error('Error assigning router to property:', error);
    res.status(error.message.includes('already assigned') ? 409 : 500)
      .json({ error: error.message });
  }
});

/**
 * POST /api/router-properties/remove
 * Remove router from its current property
 */
router.post('/remove', async (req, res) => {
  try {
    const {
      routerId,
      removedAt,
      removedBy,
      notes
    } = req.body;

    if (!routerId) {
      return res.status(400).json({ 
        error: 'routerId is required' 
      });
    }

    // Remove from database
    const assignment = await propertyService.removeRouterFromProperty({
      routerId,
      removedAt,
      removedBy,
      notes
    });

    // TODO: Sync to ClickUp (clear relationship custom fields)

    res.json({
      success: true,
      assignment
    });

  } catch (error) {
    logger.error('Error removing router from property:', error);
    res.status(error.message.includes('not currently assigned') ? 404 : 500)
      .json({ error: error.message });
  }
});

/**
 * POST /api/router-properties/move
 * Move router from current property to a new one
 */
router.post('/move', async (req, res) => {
  try {
    const {
      routerId,
      newPropertyTaskId,
      newPropertyName,
      movedAt,
      movedBy,
      notes
    } = req.body;

    if (!routerId || !newPropertyTaskId) {
      return res.status(400).json({ 
        error: 'routerId and newPropertyTaskId are required' 
      });
    }

    // Move in database (removes from old, assigns to new)
    const assignment = await propertyService.moveRouterToProperty({
      routerId,
      newPropertyTaskId,
      newPropertyName,
      movedAt,
      movedBy,
      notes
    });

    // TODO: Sync to ClickUp

    res.json({
      success: true,
      assignment
    });

  } catch (error) {
    logger.error('Error moving router to property:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/router-properties/property/:propertyTaskId/routers
 * Get all routers currently at a property
 */
router.get('/property/:propertyTaskId/routers', async (req, res) => {
  try {
    const { propertyTaskId } = req.params;
    const routers = await propertyService.getRoutersAtProperty(propertyTaskId);

    res.json({
      propertyTaskId,
      routerCount: routers.length,
      routers
    });

  } catch (error) {
    logger.error('Error getting routers at property:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/router-properties/bulk-assign
 * Assign multiple routers to a property at once
 */
router.post('/bulk-assign', async (req, res) => {
  try {
    const {
      propertyTaskId,
      propertyName,
      routerIds,
      installedAt,
      installedBy,
      notes
    } = req.body;

    if (!propertyTaskId || !routerIds || !Array.isArray(routerIds)) {
      return res.status(400).json({ 
        error: 'propertyTaskId and routerIds (array) are required' 
      });
    }

    const results = [];
    const errors = [];

    for (const routerId of routerIds) {
      try {
        const assignment = await propertyService.assignRouterToProperty({
          routerId,
          propertyTaskId,
          propertyName,
          installedAt,
          installedBy,
          notes
        });
        results.push({ routerId, success: true, assignment });
      } catch (error) {
        errors.push({ routerId, error: error.message });
      }
    }

    res.json({
      success: errors.length === 0,
      assigned: results.length,
      failed: errors.length,
      results,
      errors
    });

  } catch (error) {
    logger.error('Error bulk assigning routers:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/router-properties/stats
 * Get property assignment statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await propertyService.getPropertyStats();
    res.json(stats);
  } catch (error) {
    logger.error('Error getting property stats:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
