/**
 * Property Service
 * Manages router-property assignments and history
 */

const { pool, logger } = require('../config/database');
const clickupClient = require('./clickupClient');

/**
 * Check if assignment_type column exists (for migration compatibility)
 */
async function hasAssignmentTypeColumn() {
  try {
    const result = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'router_property_assignments' 
        AND column_name = 'assignment_type'
    `);
    return result.rows.length > 0;
  } catch (error) {
    logger.warn('Error checking for assignment_type column:', error);
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
 * @returns {Promise<Object>} Created storage record
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

    // Check if migration has run
    const hasMigration = await hasAssignmentTypeColumn();
    
    if (!hasMigration) {
      // Migration hasn't run yet - use old stored_with column
      logger.warn('assignment_type column does not exist yet - using legacy stored_with column');
      
      await client.query(
        `UPDATE routers 
         SET stored_with = $1,
             service_status = 'out-of-service',
             out_of_service_date = $2,
             out_of_service_notes = $3
         WHERE router_id = $4`,
        [storedWithUsername, storedAt, notes, routerId]
      );
      
      await client.query('COMMIT');
      
      return {
        router_id: routerId,
        stored_with_username: storedWithUsername,
        installed_at: storedAt,
        notes
      };
    }

    // Check if router is currently assigned to a property
    const propertyCheck = await client.query(
      `SELECT id, property_clickup_task_id, property_name, assignment_type 
       FROM router_property_assignments 
       WHERE router_id = $1 AND removed_at IS NULL AND assignment_type = 'property'`,
      [routerId]
    );

    if (propertyCheck.rows.length > 0) {
      const property = propertyCheck.rows[0];
      throw new Error(
        `Router ${routerId} is currently installed at property "${property.property_name}". ` +
        `Remove from property before storing with a person.`
      );
    }

    // Check if already stored with someone
    const storageCheck = await client.query(
      `SELECT id, stored_with_username 
       FROM router_property_assignments 
       WHERE router_id = $1 AND removed_at IS NULL AND assignment_type = 'storage'`,
      [routerId]
    );

    if (storageCheck.rows.length > 0) {
      const existing = storageCheck.rows[0];
      throw new Error(
        `Router ${routerId} is already stored with ${existing.stored_with_username}. ` +
        `Clear current storage first.`
      );
    }

    // Create storage record in property_assignments table
    const storageResult = await client.query(
      `INSERT INTO router_property_assignments 
       (router_id, assignment_type, stored_with_user_id, stored_with_username, installed_at, installed_by, notes)
       VALUES ($1, 'storage', $2, $3, $4, $5, $6)
       RETURNING *`,
      [routerId, storedWithUserId, storedWithUsername, storedAt, storedBy, notes]
    );

    const newStorage = storageResult.rows[0];

    // Update routers table with current storage info
    await client.query(
      `UPDATE routers 
       SET stored_with_user_id = $1,
           stored_with_username = $2,
           service_status = 'out-of-service'
       WHERE router_id = $3`,
      [storedWithUserId, storedWithUsername, routerId]
    );

    await client.query('COMMIT');

    logger.info('Router stored with user', { 
      routerId, 
      storedWithUserId,
      storedWithUsername,
      storedAt
    });

    return newStorage;

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
 * @returns {Promise<Object>} Updated storage record
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

    // Check if migration has run
    const hasMigration = await hasAssignmentTypeColumn();
    
    if (!hasMigration) {
      // Migration hasn't run yet - use old stored_with column
      logger.warn('assignment_type column does not exist yet - using legacy stored_with column');
      
      await client.query(
        `UPDATE routers 
         SET stored_with = NULL,
             service_status = 'operational',
             out_of_service_date = NULL,
             out_of_service_notes = NULL
         WHERE router_id = $1`,
        [routerId]
      );
      
      await client.query('COMMIT');
      
      return {
        router_id: routerId,
        removed_at: clearedAt
      };
    }

    // Find current storage record
    const currentResult = await client.query(
      `SELECT * FROM router_property_assignments 
       WHERE router_id = $1 AND removed_at IS NULL AND assignment_type = 'storage'`,
      [routerId]
    );

    if (currentResult.rows.length === 0) {
      throw new Error(`Router ${routerId} is not currently stored with anyone`);
    }

    const currentStorage = currentResult.rows[0];

    // Update storage record with removal info
    const updateResult = await client.query(
      `UPDATE router_property_assignments 
       SET removed_at = $1, removed_by = $2, notes = COALESCE($3, notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [clearedAt, clearedBy, notes, currentStorage.id]
    );

    // Clear storage info from routers table
    await client.query(
      `UPDATE routers 
       SET stored_with_user_id = NULL,
           stored_with_username = NULL,
           service_status = 'operational'
       WHERE router_id = $1`,
      [routerId]
    );

    await client.query('COMMIT');

    logger.info('Router storage cleared', { 
      routerId,
      storedWithUsername: currentStorage.stored_with_username
    });

    return updateResult.rows[0];

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
    const result = await pool.query(
      `SELECT * FROM router_property_assignments 
       WHERE router_id = $1 
       ORDER BY installed_at DESC`,
      [routerId]
    );

    const assignments = result.rows.map(assignment => {
      const installedAt = new Date(assignment.installed_at);
      const removedAt = assignment.removed_at ? new Date(assignment.removed_at) : new Date();
      const durationMs = removedAt - installedAt;
      const durationDays = Math.floor(durationMs / (1000 * 60 * 60 * 24));

      const baseRecord = {
        id: assignment.id,
        assignmentType: assignment.assignment_type,
        installedAt: assignment.installed_at,
        removedAt: assignment.removed_at,
        durationDays,
        installedBy: assignment.installed_by,
        removedBy: assignment.removed_by,
        notes: assignment.notes,
        current: assignment.removed_at === null
      };

      if (assignment.assignment_type === 'property') {
        return {
          ...baseRecord,
          propertyTaskId: assignment.property_clickup_task_id,
          propertyName: assignment.property_name
        };
      } else {
        return {
          ...baseRecord,
          storedWithUserId: assignment.stored_with_user_id,
          storedWithUsername: assignment.stored_with_username
        };
      }
    });

    const currentProperty = assignments.find(a => a.current && a.assignmentType === 'property') || null;
    const currentStorage = assignments.find(a => a.current && a.assignmentType === 'storage') || null;
    const totalDaysDeployed = assignments
      .filter(a => a.assignmentType === 'property')
      .reduce((sum, a) => sum + a.durationDays, 0);

    return {
      routerId,
      currentProperty,
      currentStorage,
      history: assignments,
      totalProperties: assignments.filter(a => a.assignmentType === 'property').length,
      totalDaysDeployed
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
