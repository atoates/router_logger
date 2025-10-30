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
      notes,
      validateClickUp = true // Optional: validate against ClickUp
    } = req.body;

    if (!routerId || !propertyTaskId) {
      return res.status(400).json({ 
        error: 'routerId and propertyTaskId are required' 
      });
    }

    // Assign in database (validates property in ClickUp if requested)
    const assignment = await propertyService.assignRouterToProperty({
      routerId,
      propertyTaskId,
      propertyName,
      installedAt,
      installedBy,
      notes
    }, validateClickUp);

    // TODO: Sync to ClickUp (update relationship custom fields)
    // This will be implemented once ClickUp custom fields are set up

    res.json({
      success: true,
      assignment
    });

  } catch (error) {
    logger.error('Error assigning router to property:', error);
    
    // Return appropriate status codes
    let status = 500;
    if (error.message.includes('already assigned')) {
      status = 409; // Conflict
    } else if (error.message.includes('not a property task')) {
      status = 400; // Bad request
    } else if (error.message.includes('No ClickUp token')) {
      status = 401; // Unauthorized
    }
    
    res.status(status).json({ error: error.message });
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
      notes,
      validateClickUp = true
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
    }, validateClickUp);

    // TODO: Sync to ClickUp

    res.json({
      success: true,
      assignment
    });

  } catch (error) {
    logger.error('Error moving router to property:', error);
    
    let status = 500;
    if (error.message.includes('not a property task')) {
      status = 400;
    } else if (error.message.includes('No ClickUp token')) {
      status = 401;
    }
    
    res.status(status).json({ error: error.message });
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
      notes,
      validateClickUp = true
    } = req.body;

    if (!propertyTaskId || !routerIds || !Array.isArray(routerIds)) {
      return res.status(400).json({ 
        error: 'propertyTaskId and routerIds (array) are required' 
      });
    }

    // Validate property once before bulk operation (if requested)
    if (validateClickUp) {
      await propertyService.validatePropertyTask(propertyTaskId);
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
        }, false); // Skip per-router validation since we validated once above
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

/**
 * GET /api/router-properties/search-properties/:listId
 * Search for property tasks in ClickUp (Type = "property")
 */
router.get('/search-properties/:listId', async (req, res) => {
  try {
    const { listId } = req.params;
    const { search = '' } = req.query;

    const propertyTasks = await clickupClient.searchPropertyTasks(listId, search, 'default');

    // Format for easy selection in UI
    const properties = propertyTasks.map(task => ({
      id: task.id,
      name: task.name,
      status: task.status?.status,
      url: task.url,
      description: task.description,
      tags: task.tags?.map(t => t.name) || [],
      // Include any property-specific custom fields
      customFields: task.custom_fields?.reduce((acc, field) => {
        if (field.name && field.value !== null && field.value !== undefined) {
          acc[field.name] = field.value;
        }
        return acc;
      }, {})
    }));

    res.json({
      properties,
      count: properties.length,
      listId
    });

  } catch (error) {
    logger.error('Error searching property tasks:', error);
    
    let status = 500;
    if (error.message.includes('No ClickUp token')) {
      status = 401;
    }
    
    res.status(status).json({ error: error.message });
  }
});

module.exports = router;
