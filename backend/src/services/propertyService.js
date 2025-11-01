/**
 * Property Service
 * Manages router-property assignments and history
 */

const { pool, logger } = require('../config/database');
const clickupClient = require('./clickupClient');

/**
 * Check if event_type column exists (for migration compatibility)
 */
async function hasEventTypeColumn() {
  try {
    const result = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'router_property_assignments' 
        AND column_name = 'event_type'
    `);
    return result.rows.length > 0;
  } catch (error) {
    logger.warn('Error checking for event_type column:', error);
    return false;
  }
}

/**
 * Validate that a property (list) exists in ClickUp
 * @param {string} propertyListId - ClickUp list ID (each property is a list)
 * @returns {Promise<Object>} List details if valid
 */
async function validatePropertyTask(propertyListId) {
  try {
    // Properties are lists, not tasks - get list details instead
    const client = await clickupClient.getAuthorizedClient('default');
    const response = await client.get(`/list/${propertyListId}`);
    const list = response.data;
    
    logger.info('Property list validated', { listId: propertyListId, name: list.name });
    return { id: list.id, name: list.name, url: `https://app.clickup.com/${list.id}` };
  } catch (error) {
    throw new Error(`Failed to validate property: ${error.message}`);
  }
}

/**
 * Store router with a person (out of service)
 * @param {Object} storage - Storage details
 * @returns {Promise<Object>} Created storage event
 */
async function storeRouterWith(storage) {
  const {
    routerId,
    storedWithUserId,
    storedWithUsername,
    storedAt = new Date(),
    storedBy = null,
    notes = null
  } = storage;

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Check if event-based system is in place
    const hasEvents = await hasEventTypeColumn();
    
    if (!hasEvents) {
      // Legacy: just update routers table
      logger.warn('event_type column does not exist yet - using legacy approach');
      
      await client.query(
        `UPDATE routers 
         SET service_status = 'out-of-service',
             out_of_service_date = $1,
             out_of_service_notes = $2
         WHERE router_id = $3`,
        [storedAt, `Stored with ${storedWithUsername}. ${notes || ''}`.trim(), routerId]
      );
      
      await client.query('COMMIT');
      
      return {
        router_id: routerId,
        stored_with_username: storedWithUsername,
        event_date: storedAt,
        notes
      };
    }

    // Modern event-based approach:
    // 1. If router is at a property, create a property_remove event
    // 2. Create a storage_assign event
    // 3. Update router current state

    // Check if router is currently at a property
    const propertyCheck = await client.query(
      `SELECT * FROM router_property_assignments 
       WHERE router_id = $1 
         AND event_type = 'property_assign'
       ORDER BY event_date DESC
       LIMIT 1`,
      [routerId]
    );

    // Check if there's a more recent remove event
    if (propertyCheck.rows.length > 0) {
      const lastAssign = propertyCheck.rows[0];
      
      const removeCheck = await client.query(
        `SELECT * FROM router_property_assignments 
         WHERE router_id = $1 
           AND event_type = 'property_remove'
           AND event_date > $2
         ORDER BY event_date DESC
         LIMIT 1`,
        [routerId, lastAssign.event_date]
      );

      // If no remove event after the last assign, router is still at property
      if (removeCheck.rows.length === 0) {
        // Create property_remove event first
        await client.query(
          `INSERT INTO router_property_assignments 
           (router_id, event_type, event_date, property_clickup_task_id, property_name, removed_by, notes)
           VALUES ($1, 'property_remove', $2, $3, $4, $5, $6)`,
          [routerId, storedAt, lastAssign.property_clickup_task_id, lastAssign.property_name, storedBy, 'Removed to store with person']
        );
      }
    }

    // Create storage_assign event
    const storageResult = await client.query(
      `INSERT INTO router_property_assignments 
       (router_id, event_type, event_date, stored_with_user_id, stored_with_username, installed_by, notes)
       VALUES ($1, 'storage_assign', $2, $3, $4, $5, $6)
       RETURNING *`,
      [routerId, storedAt, storedWithUserId, storedWithUsername, storedBy, notes]
    );

    // Update routers table current state
    await client.query(
      `UPDATE routers 
       SET current_state = 'stored',
           current_property_task_id = NULL,
           current_property_name = NULL,
           current_stored_with_user_id = $1,
           current_stored_with_username = $2,
           state_updated_at = $3,
           service_status = 'out-of-service',
           out_of_service_date = $3,
           out_of_service_notes = $4
       WHERE router_id = $5`,
      [storedWithUserId, storedWithUsername, storedAt, `Stored with ${storedWithUsername}. ${notes || ''}`.trim(), routerId]
    );

    await client.query('COMMIT');

    logger.info('Router stored with user (event created)', { 
      routerId, 
      storedWithUserId,
      storedWithUsername,
      storedAt
    });

    return storageResult.rows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error storing router with user:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Clear router storage (bring back in service)
 * @param {Object} clearance - Clearance details
 * @returns {Promise<Object>} Storage remove event
 */
async function clearStoredWith(clearance) {
  const {
    routerId,
    clearedAt = new Date(),
    clearedBy = null,
    notes = null
  } = clearance;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if event-based system is in place
    const hasEvents = await hasEventTypeColumn();
    
    if (!hasEvents) {
      // Legacy: just update routers table
      logger.warn('event_type column does not exist yet - only updating routers table');
      
      await client.query(
        `UPDATE routers 
         SET service_status = 'operational',
             out_of_service_date = NULL,
             out_of_service_notes = NULL
         WHERE router_id = $1`,
        [routerId]
      );
      
      await client.query('COMMIT');
      
      return {
        router_id: routerId,
        event_date: clearedAt
      };
    }

    // Modern event-based approach: Create storage_remove event

    // Verify router is actually stored
    const storageCheck = await client.query(
      `SELECT * FROM router_property_assignments 
       WHERE router_id = $1 
         AND event_type = 'storage_assign'
       ORDER BY event_date DESC
       LIMIT 1`,
      [routerId]
    );

    if (storageCheck.rows.length === 0) {
      throw new Error(`Router ${routerId} has no storage assignment record`);
    }

    const lastStorageAssign = storageCheck.rows[0];

    // Check if there's already a storage_remove event after this assign
    const removeCheck = await client.query(
      `SELECT * FROM router_property_assignments 
       WHERE router_id = $1 
         AND event_type = 'storage_remove'
         AND event_date > $2
       ORDER BY event_date DESC
       LIMIT 1`,
      [routerId, lastStorageAssign.event_date]
    );

    if (removeCheck.rows.length > 0) {
      throw new Error(`Router ${routerId} is not currently stored with anyone`);
    }

    // Create storage_remove event
    const removeResult = await client.query(
      `INSERT INTO router_property_assignments 
       (router_id, event_type, event_date, stored_with_user_id, stored_with_username, removed_by, notes)
       VALUES ($1, 'storage_remove', $2, $3, $4, $5, $6)
       RETURNING *`,
      [routerId, clearedAt, lastStorageAssign.stored_with_user_id, lastStorageAssign.stored_with_username, clearedBy, notes]
    );

    // Update routers table current state
    await client.query(
      `UPDATE routers 
       SET current_state = 'unassigned',
           current_stored_with_user_id = NULL,
           current_stored_with_username = NULL,
           state_updated_at = $1,
           service_status = 'operational',
           out_of_service_date = NULL,
           out_of_service_notes = NULL
       WHERE router_id = $2`,
      [clearedAt, routerId]
    );

    await client.query('COMMIT');

    logger.info('Router storage cleared (event created)', { 
      routerId,
      storedWithUsername: lastStorageAssign.stored_with_username
    });

    return removeResult.rows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error clearing router storage:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Assign router to a property
 * @param {Object} assignment - Assignment details
 * @param {boolean} validateClickUp - Whether to validate property exists in ClickUp (default: true)
 * @returns {Promise<Object>} Created assignment record
 */
async function assignRouterToProperty(assignment, validateClickUp = true) {
  const {
    routerId,
    propertyTaskId,
    propertyName,
    installedAt = null, // Will use ClickUp "Date installed" custom field if not provided
    installedBy = null,
    notes = null
  } = assignment;

  const client = await pool.connect();
  
  try {
    // Get router's ClickUp task to fetch the "Date installed" custom field
    const routerResult = await client.query(
      'SELECT clickup_task_id FROM routers WHERE router_id = $1',
      [routerId]
    );

    if (routerResult.rows.length === 0) {
      throw new Error(`Router ${routerId} not found`);
    }

    const routerTaskId = routerResult.rows[0].clickup_task_id;
    if (!routerTaskId) {
      throw new Error(`Router ${routerId} does not have a linked ClickUp task`);
    }

    // Fetch the router's ClickUp task to get the "Date installed" custom field
    let actualInstalledAt = installedAt;
    if (!actualInstalledAt) {
      try {
        const clickupTask = await clickupClient.getTask(routerTaskId);
        
        // Look for "Date installed" custom field
        const dateInstalledField = clickupTask.custom_fields?.find(
          field => field.name === 'Date installed' || field.name === 'date installed'
        );
        
        if (dateInstalledField && dateInstalledField.value) {
          // ClickUp date fields return timestamps in milliseconds
          actualInstalledAt = new Date(parseInt(dateInstalledField.value));
          logger.info('Using ClickUp "Date installed" custom field as installed_at', { 
            routerId, 
            taskId: routerTaskId,
            dateInstalled: actualInstalledAt 
          });
        } else {
          // No "Date installed" field, use current date
          actualInstalledAt = new Date();
          logger.warn('ClickUp task has no "Date installed" custom field, using current date', { 
            routerId, 
            taskId: routerTaskId,
            availableFields: clickupTask.custom_fields?.map(f => f.name) || []
          });
        }
      } catch (error) {
        logger.error('Error fetching ClickUp task custom fields, using current date', { 
          routerId, 
          taskId: routerTaskId,
          error: error.message 
        });
        actualInstalledAt = new Date();
      }
    }

    // Validate property task in ClickUp if requested
    let validatedPropertyName = propertyName;
    if (validateClickUp) {
      const propertyTask = await validatePropertyTask(propertyTaskId);
      validatedPropertyName = propertyTask.name; // Use official name from ClickUp
      logger.info('Property task validated', { 
        propertyTaskId, 
        propertyName: validatedPropertyName 
      });
    }

    await client.query('BEGIN');

    // Check if migration has run
    const hasMigration = await hasAssignmentTypeColumn();
    
    if (hasMigration) {
      // Check if router is currently stored with someone
      const storageCheck = await client.query(
        `SELECT id, stored_with_username 
         FROM router_property_assignments 
         WHERE router_id = $1 AND removed_at IS NULL AND assignment_type = 'storage'`,
        [routerId]
      );

      if (storageCheck.rows.length > 0) {
        const storage = storageCheck.rows[0];
        throw new Error(
          `Router ${routerId} is currently stored with ${storage.stored_with_username}. ` +
          `Clear storage before assigning to a property.`
        );
      }

      // Check if router already has an active property assignment
      const existingResult = await client.query(
        `SELECT id, property_clickup_task_id, property_name 
         FROM router_property_assignments 
         WHERE router_id = $1 AND removed_at IS NULL AND assignment_type = 'property'`,
        [routerId]
      );

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        throw new Error(
          `Router ${routerId} is already assigned to property "${existing.property_name}" (${existing.property_clickup_task_id}). ` +
          `Remove from current property first.`
        );
      }
    } else {
      // Old migration - just check for any active assignment
      const existingResult = await client.query(
        `SELECT id, property_clickup_task_id, property_name 
         FROM router_property_assignments 
         WHERE router_id = $1 AND removed_at IS NULL`,
        [routerId]
      );

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        throw new Error(
          `Router ${routerId} is already assigned to property "${existing.property_name}" (${existing.property_clickup_task_id}). ` +
          `Remove from current property first.`
        );
      }
    }

    // Create new assignment record
    const insertQuery = hasMigration
      ? `INSERT INTO router_property_assignments 
         (router_id, assignment_type, property_clickup_task_id, property_name, installed_at, installed_by, notes)
         VALUES ($1, 'property', $2, $3, $4, $5, $6)
         RETURNING *`
      : `INSERT INTO router_property_assignments 
         (router_id, property_clickup_task_id, property_name, installed_at, installed_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`;
    
    const insertParams = hasMigration
      ? [routerId, propertyTaskId, validatedPropertyName, actualInstalledAt, installedBy, notes]
      : [routerId, propertyTaskId, validatedPropertyName, actualInstalledAt, installedBy, notes];
    
    const assignmentResult = await client.query(insertQuery, insertParams);

    const newAssignment = assignmentResult.rows[0];

    // Update routers table with current property (denormalized)
    await client.query(
      `UPDATE routers 
       SET current_property_task_id = $1,
           current_property_name = $2,
           property_installed_at = $3
       WHERE router_id = $4`,
      [propertyTaskId, validatedPropertyName, actualInstalledAt, routerId]
    );

    await client.query('COMMIT');

    logger.info('Router assigned to property', { 
      routerId, 
      propertyTaskId, 
      propertyName: validatedPropertyName,
      installedAt: actualInstalledAt
    });

    // TODO: Sync with ClickUp - update property's "Installed Routers" relationship field
    // and router's "Current Property" relationship field

    return newAssignment;

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error assigning router to property:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Remove router from its current property
 * @param {Object} removal - Removal details
 * @returns {Promise<Object>} Updated assignment record
 */
async function removeRouterFromProperty(removal) {
  const {
    routerId,
    removedAt = new Date(),
    removedBy = null,
    notes = null
  } = removal;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Find current property assignment (not storage)
    const currentResult = await client.query(
      `SELECT * FROM router_property_assignments 
       WHERE router_id = $1 AND removed_at IS NULL AND assignment_type = 'property'`,
      [routerId]
    );

    if (currentResult.rows.length === 0) {
      throw new Error(`Router ${routerId} is not currently assigned to any property`);
    }

    const currentAssignment = currentResult.rows[0];

    // Update assignment with removal info
    const updateResult = await client.query(
      `UPDATE router_property_assignments 
       SET removed_at = $1, removed_by = $2, notes = COALESCE($3, notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [removedAt, removedBy, notes, currentAssignment.id]
    );

    // Clear current property from routers table
    await client.query(
      `UPDATE routers 
       SET current_property_task_id = NULL,
           current_property_name = NULL,
           property_installed_at = NULL
       WHERE router_id = $1`,
      [routerId]
    );

    await client.query('COMMIT');

    logger.info('Router removed from property', { 
      routerId, 
      propertyTaskId: currentAssignment.property_clickup_task_id,
      propertyName: currentAssignment.property_name
    });

    return updateResult.rows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error removing router from property:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Move router from one property to another (convenience method)
 * @param {Object} move - Move details
 * @param {boolean} validateClickUp - Whether to validate property exists in ClickUp
 * @returns {Promise<Object>} New assignment record
 */
async function moveRouterToProperty(move, validateClickUp = true) {
  const {
    routerId,
    newPropertyTaskId,
    newPropertyName,
    movedAt = new Date(),
    movedBy = null,
    notes = null
  } = move;

  // Remove from current property
  await removeRouterFromProperty({
    routerId,
    removedAt: movedAt,
    removedBy: movedBy,
    notes: notes ? `Moving to ${newPropertyName}. ${notes}` : `Moving to ${newPropertyName}`
  });

  // Assign to new property
  return await assignRouterToProperty({
    routerId,
    propertyTaskId: newPropertyTaskId,
    propertyName: newPropertyName,
    installedAt: movedAt,
    installedBy: movedBy,
    notes
  }, validateClickUp);
}

/**
 * Get current property assignment for a router
 * @param {string} routerId - Router ID
 * @returns {Promise<Object|null>} Current assignment or null
 */
async function getCurrentProperty(routerId) {
  try {
    const result = await pool.query(
      `SELECT * FROM router_property_assignments 
       WHERE router_id = $1 AND removed_at IS NULL AND assignment_type = 'property'`,
      [routerId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const assignment = result.rows[0];
    const daysSinceInstalled = Math.floor(
      (Date.now() - new Date(assignment.installed_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      ...assignment,
      daysSinceInstalled
    };

  } catch (error) {
    logger.error('Error getting current property:', error);
    throw error;
  }
}

/**
 * Get current storage status for a router
 * @param {string} routerId - Router ID
 * @returns {Promise<Object|null>} Current storage or null
 */
async function getCurrentStorage(routerId) {
  try {
    const result = await pool.query(
      `SELECT * FROM router_property_assignments 
       WHERE router_id = $1 AND removed_at IS NULL AND assignment_type = 'storage'`,
      [routerId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const storage = result.rows[0];
    const daysSinceStored = Math.floor(
      (Date.now() - new Date(storage.installed_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      ...storage,
      daysSinceStored
    };

  } catch (error) {
    logger.error('Error getting current storage:', error);
    throw error;
  }
}

/**
 * Get property assignment history for a router
 * @param {string} routerId - Router ID
 * @returns {Promise<Object>} History with current and past assignments
 */
async function getPropertyHistory(routerId) {
  try {
    const hasEvents = await hasEventTypeColumn();
    
    if (!hasEvents) {
      // Legacy: use old removed_at based system
      const result = await pool.query(
        `SELECT * FROM router_property_assignments 
         WHERE router_id = $1 
         ORDER BY installed_at DESC`,
        [routerId]
      );

      const assignments = result.rows.map(assignment => ({
        id: assignment.id,
        eventType: assignment.removed_at ? 'property_remove' : 'property_assign',
        eventDate: assignment.removed_at || assignment.installed_at,
        propertyTaskId: assignment.property_clickup_task_id,
        propertyName: assignment.property_name,
        notes: assignment.notes,
        by: assignment.removed_at ? assignment.removed_by : assignment.installed_by
      }));

      return {
        routerId,
        history: assignments,
        totalEvents: assignments.length
      };
    }

    // Modern event-based system: Just fetch all events chronologically
    const result = await pool.query(
      `SELECT * FROM router_property_assignments 
       WHERE router_id = $1 
       ORDER BY event_date DESC`,
      [routerId]
    );

    const events = result.rows.map(event => {
      const baseEvent = {
        id: event.id,
        eventType: event.event_type,
        eventDate: event.event_date,
        notes: event.notes
      };

      // Add type-specific fields
      if (event.event_type === 'property_assign' || event.event_type === 'property_remove') {
        return {
          ...baseEvent,
          propertyTaskId: event.property_clickup_task_id,
          propertyName: event.property_name,
          by: event.event_type === 'property_assign' ? event.installed_by : event.removed_by
        };
      } else if (event.event_type === 'storage_assign' || event.event_type === 'storage_remove') {
        return {
          ...baseEvent,
          storedWithUserId: event.stored_with_user_id,
          storedWithUsername: event.stored_with_username,
          by: event.event_type === 'storage_assign' ? event.installed_by : event.removed_by
        };
      }

      return baseEvent;
    });

    // Calculate some summary stats
    const propertyAssignments = events.filter(e => e.eventType === 'property_assign').length;
    const storageAssignments = events.filter(e => e.eventType === 'storage_assign').length;
    const currentEvent = events.length > 0 ? events[0] : null;

    return {
      routerId,
      history: events,
      totalEvents: events.length,
      totalPropertyAssignments: propertyAssignments,
      totalStorageAssignments: storageAssignments,
      currentEvent
    };

  } catch (error) {
    logger.error('Error getting property history:', error);
    throw error;
  }
}

/**
 * Get all routers currently at a property
 * @param {string} propertyTaskId - Property ClickUp task ID
 * @returns {Promise<Array>} List of routers at this property
 */
async function getRoutersAtProperty(propertyTaskId) {
  try {
    const result = await pool.query(
      `SELECT 
         rpa.*,
         r.name as router_name,
         r.imei,
         r.firmware_version,
         r.current_status,
         r.last_seen
       FROM router_property_assignments rpa
       JOIN routers r ON r.router_id = rpa.router_id
       WHERE rpa.property_clickup_task_id = $1 
         AND rpa.removed_at IS NULL
         AND rpa.assignment_type = 'property'
       ORDER BY rpa.installed_at DESC`,
      [propertyTaskId]
    );

    return result.rows.map(row => ({
      routerId: row.router_id,
      routerName: row.router_name || `Router #${row.router_id}`,
      imei: row.imei,
      firmwareVersion: row.firmware_version,
      currentStatus: row.current_status,
      lastSeen: row.last_seen,
      installedAt: row.installed_at,
      installedBy: row.installed_by,
      daysSinceInstalled: Math.floor(
        (Date.now() - new Date(row.installed_at).getTime()) / (1000 * 60 * 60 * 24)
      ),
      notes: row.notes
    }));

  } catch (error) {
    logger.error('Error getting routers at property:', error);
    throw error;
  }
}

/**
 * Get all routers currently installed (assigned to properties)
 * @returns {Promise<Array>} List of all currently installed routers
 */
async function getAllInstalledRouters() {
  try {
    const hasMigration = await hasAssignmentTypeColumn();
    
    const query = hasMigration
      ? `SELECT 
           rpa.*,
           r.name as router_name,
           r.imei,
           r.firmware_version,
           r.last_seen
         FROM router_property_assignments rpa
         JOIN routers r ON r.router_id = rpa.router_id
         WHERE rpa.removed_at IS NULL
           AND rpa.assignment_type = 'property'
         ORDER BY rpa.installed_at DESC`
      : `SELECT 
           rpa.*,
           r.name as router_name,
           r.imei,
           r.firmware_version,
           r.last_seen
         FROM router_property_assignments rpa
         JOIN routers r ON r.router_id = rpa.router_id
         WHERE rpa.removed_at IS NULL
         ORDER BY rpa.installed_at DESC`;
    
    const result = await pool.query(query);

    return result.rows.map(row => ({
      routerId: row.router_id,
      routerName: row.router_name,
      imei: row.imei,
      propertyName: row.property_name,
      propertyTaskId: row.property_clickup_task_id,
      installedAt: row.installed_at,
      installedBy: row.installed_by,
      daysSinceInstalled: Math.floor(
        (Date.now() - new Date(row.installed_at).getTime()) / (1000 * 60 * 60 * 24)
      ),
      notes: row.notes
    }));

  } catch (error) {
    logger.error('Error getting all installed routers:', error);
    throw error;
  }
}

/**
 * Get property assignment statistics
 * @returns {Promise<Object>} Statistics about property assignments
 */
async function getPropertyStats() {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(DISTINCT router_id) as total_routers_assigned,
        COUNT(DISTINCT router_id) FILTER (WHERE removed_at IS NULL) as currently_assigned,
        COUNT(DISTINCT property_clickup_task_id) as total_properties,
        COUNT(DISTINCT property_clickup_task_id) FILTER (WHERE removed_at IS NULL) as active_properties,
        AVG(EXTRACT(EPOCH FROM (COALESCE(removed_at, CURRENT_TIMESTAMP) - installed_at)) / 86400)::int as avg_deployment_days
      FROM router_property_assignments
    `);

    return result.rows[0];

  } catch (error) {
    logger.error('Error getting property stats:', error);
    throw error;
  }
}

/**
 * Delete a property assignment record
 * @param {number} assignmentId - Assignment record ID
 * @returns {Promise<Object>} Deleted record
 */
async function deleteAssignment(assignmentId) {
  try {
    const result = await pool.query(
      'DELETE FROM router_property_assignments WHERE id = $1 RETURNING *',
      [assignmentId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    logger.info('Property assignment deleted', { assignmentId });
    return result.rows[0];

  } catch (error) {
    logger.error('Error deleting property assignment:', error);
    throw error;
  }
}

module.exports = {
  storeRouterWith,
  clearStoredWith,
  assignRouterToProperty,
  removeRouterFromProperty,
  moveRouterToProperty,
  getCurrentProperty,
  getCurrentStorage,
  getPropertyHistory,
  getRoutersAtProperty,
  getAllInstalledRouters,
  getPropertyStats,
  validatePropertyTask,
  deleteAssignment
};
