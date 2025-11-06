/**
 * Property Service - SIMPLIFIED
 * Handles:
 * 1. Linking routers to location tasks
 * 2. Assigning routers to ClickUp users (syncs with ClickUp assignees)
 * NO property history logging
 */

const { pool, logger } = require('../config/database');
const clickupClient = require('./clickupClient');

/**
 * Link router to a ClickUp location task
 * When linked: Remove assignee from router task (if any)
 * @param {Object} linkage - Location linkage details
 * @returns {Promise<Object>} Update result
 */
async function linkRouterToLocation(linkage) {
  const {
    routerId,
    locationTaskId,
    locationTaskName,
    linkedBy = null,
    notes = null
  } = linkage;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get router's ClickUp task ID
    const routerResult = await client.query(
      'SELECT clickup_task_id FROM routers WHERE router_id = $1',
      [routerId]
    );

    if (routerResult.rows.length === 0) {
      throw new Error(`Router ${routerId} not found`);
    }

    const clickupTaskId = routerResult.rows[0].clickup_task_id;

    // Note: locationTaskId is actually a ClickUp list ID (lists represent properties)
    logger.info('Linking router to location list', { 
      routerId,
      locationTaskId, // This is actually a list ID
      locationTaskName 
    });

    // Update router with location task info
    const result = await client.query(
      `UPDATE routers 
       SET clickup_location_task_id = $1,
           clickup_location_task_name = $2,
           location_linked_at = $3
       WHERE router_id = $4
       RETURNING *`,
      [locationTaskId, locationTaskName, new Date(), routerId]
    );

    await client.query('COMMIT');

    logger.info('Router linked to location task', { 
      routerId, 
      locationTaskId,
      locationTaskName
    });

    // Get current assignees from router task to remove them
    if (clickupTaskId) {
      try {
        const task = await clickupClient.getTask(clickupTaskId);
        const assigneeIds = task.assignees?.map(a => a.id).filter(id => id) || [];
        
        if (assigneeIds.length > 0) {
          await clickupClient.updateTaskAssignees(
            clickupTaskId,
            { rem: assigneeIds },
            'default'
          );
          logger.info('Removed ClickUp task assignees (router now at location)', { 
            routerId, 
            clickupTaskId, 
            locationTaskId,
            removedAssignees: assigneeIds
          });
        }
      } catch (clickupError) {
        logger.warn('Failed to remove ClickUp task assignees (location link still recorded)', {
          routerId,
          clickupTaskId,
          error: clickupError.message
        });
      }
    }

    return result.rows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error linking router to location:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Unlink router from ClickUp location task
 * @param {Object} unlinkage - Location unlinkage details
 * @returns {Promise<Object>} Update result
 */
async function unlinkRouterFromLocation(unlinkage) {
  const {
    routerId,
    unlinkedBy = null,
    notes = null
  } = unlinkage;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get router's current state
    const routerResult = await client.query(
      `SELECT clickup_task_id, clickup_location_task_id
       FROM routers WHERE router_id = $1`,
      [routerId]
    );

    if (routerResult.rows.length === 0) {
      throw new Error(`Router ${routerId} not found`);
    }

    const router = routerResult.rows[0];
    const wasLinkedToLocation = router.clickup_location_task_id;

    if (!wasLinkedToLocation) {
      throw new Error(`Router ${routerId} is not linked to any location`);
    }

    // Update router to remove location link
    const result = await client.query(
      `UPDATE routers 
       SET clickup_location_task_id = NULL,
           clickup_location_task_name = NULL,
           location_linked_at = NULL
       WHERE router_id = $1
       RETURNING *`,
      [routerId]
    );

    await client.query('COMMIT');

    logger.info('Router unlinked from location task', { 
      routerId, 
      wasLinkedTo: wasLinkedToLocation
    });

    return result.rows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error unlinking router from location:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get current location for a router
 * @param {string} routerId - Router ID
 * @returns {Promise<Object|null>} Location info or null
 */
async function getCurrentLocation(routerId) {
  try {
    const result = await pool.query(
      `SELECT clickup_location_task_id, clickup_location_task_name, location_linked_at
       FROM routers 
       WHERE router_id = $1`,
      [routerId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const router = result.rows[0];
    if (!router.clickup_location_task_id) {
      return null;
    }

    // Fetch date_installed from ClickUp
    const clickupClient = require('./clickupClient');
    const DATE_INSTALLED_FIELD_ID = '9f31c21a-630d-49f2-8a79-354de03e24d1';
    let dateInstalled = null;
    
    try {
      const rawDate = await clickupClient.getListCustomFieldValue(
        router.clickup_location_task_id,
        DATE_INSTALLED_FIELD_ID,
        'default'
      );
      // Convert string timestamp to number (ClickUp returns Unix timestamp in ms as string)
      dateInstalled = rawDate ? Number(rawDate) : null;
    } catch (error) {
      logger.warn('Error fetching date_installed for router location:', { 
        router_id: routerId, 
        error: error.message 
      });
    }

    return {
      location_task_id: router.clickup_location_task_id,
      location_task_name: router.clickup_location_task_name,
      linked_at: router.location_linked_at,
      date_installed: dateInstalled
    };
  } catch (error) {
    logger.error('Error getting current location:', error);
    throw error;
  }
}

/**
 * Assign router to ClickUp user(s)
 * Updates the ClickUp task assignees field
 * @param {Object} assignment - Assignment details
 * @returns {Promise<Object>} Update result
 */
async function assignRouterToUsers(assignment) {
  const {
    routerId,
    assigneeUserIds,  // Array of ClickUp user IDs
    assigneeUsernames = []  // Array of usernames for logging
  } = assignment;

  try {
    // Get router's ClickUp task ID
    const result = await pool.query(
      'SELECT clickup_task_id FROM routers WHERE router_id = $1',
      [routerId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Router ${routerId} not found`);
    }

    const clickupTaskId = result.rows[0].clickup_task_id;

    if (!clickupTaskId) {
      throw new Error(`Router ${routerId} does not have a ClickUp task`);
    }

    // Update ClickUp task assignees
    const userIds = assigneeUserIds.map(id => parseInt(id));
    
    // First, get current assignees to replace them completely
    const task = await clickupClient.getTask(clickupTaskId);
    const currentAssigneeIds = task.assignees?.map(a => a.id).filter(id => id) || [];
    
    // Remove all current assignees and add new ones
    await clickupClient.updateTaskAssignees(
      clickupTaskId,
      { 
        rem: currentAssigneeIds,
        add: userIds 
      },
      'default'
    );

    logger.info('Router assignees updated in ClickUp', { 
      routerId, 
      clickupTaskId,
      removedAssignees: currentAssigneeIds,
      addedAssignees: userIds,
      usernames: assigneeUsernames
    });

    return {
      success: true,
      routerId,
      clickupTaskId,
      assignedTo: assigneeUsernames
    };

  } catch (error) {
    logger.error('Error assigning router to users:', error);
    throw error;
  }
}

/**
 * Remove all assignees from router's ClickUp task
 * @param {string} routerId - Router ID
 * @returns {Promise<Object>} Update result
 */
async function removeRouterAssignees(routerId) {
  try {
    // Get router's ClickUp task ID
    const result = await pool.query(
      'SELECT clickup_task_id FROM routers WHERE router_id = $1',
      [routerId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Router ${routerId} not found`);
    }

    const clickupTaskId = result.rows[0].clickup_task_id;

    if (!clickupTaskId) {
      throw new Error(`Router ${routerId} does not have a ClickUp task`);
    }

    // Get current assignees to remove them
    const task = await clickupClient.getTask(clickupTaskId);
    const currentAssigneeIds = task.assignees?.map(a => a.id).filter(id => id) || [];
    
    if (currentAssigneeIds.length === 0) {
      return {
        success: true,
        routerId,
        clickupTaskId,
        message: 'No assignees to remove'
      };
    }

    // Remove all current assignees
    await clickupClient.updateTaskAssignees(
      clickupTaskId,
      { 
        rem: currentAssigneeIds,
        add: [] 
      },
      'default'
    );

    logger.info('Router assignees removed from ClickUp', { 
      routerId, 
      clickupTaskId,
      removedAssignees: currentAssigneeIds
    });

    return {
      success: true,
      routerId,
      clickupTaskId,
      removedCount: currentAssigneeIds.length
    };

  } catch (error) {
    logger.error('Error removing router assignees:', error);
    throw error;
  }
}

module.exports = {
  linkRouterToLocation,
  unlinkRouterFromLocation,
  getCurrentLocation,
  assignRouterToUsers,
  removeRouterAssignees
};
