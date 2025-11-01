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
 * Backward-compat: Check if assignment_type column exists (migration 010)
 * NOTE: Some legacy code paths still test for this. We'll keep this check
 * and prefer the event-based logic when event_type exists.
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

    const hasEvents = await hasEventTypeColumn();

    if (hasEvents) {
      // Event-based: ensure not currently stored
      const lastStorageAssign = await client.query(
        `SELECT event_date, stored_with_username FROM router_property_assignments
         WHERE router_id = $1 AND event_type = 'storage_assign'
         ORDER BY event_date DESC LIMIT 1`,
        [routerId]
      );
      if (lastStorageAssign.rows.length > 0) {
        const assign = lastStorageAssign.rows[0];
        const cleared = await client.query(
          `SELECT 1 FROM router_property_assignments
           WHERE router_id = $1 AND event_type = 'storage_remove' AND event_date > $2
           ORDER BY event_date DESC LIMIT 1`,
          [routerId, assign.event_date]
        );
        if (cleared.rows.length === 0) {
          throw new Error(`Router ${routerId} is currently stored with ${assign.stored_with_username}. Clear storage before assigning.`);
        }
      }

      // Ensure not already assigned to any property currently
      const lastPropAssign = await client.query(
        `SELECT property_clickup_task_id, property_name, event_date FROM router_property_assignments
         WHERE router_id = $1 AND event_type = 'property_assign'
         ORDER BY event_date DESC LIMIT 1`,
        [routerId]
      );
      if (lastPropAssign.rows.length > 0) {
        const a = lastPropAssign.rows[0];
        const removed = await client.query(
          `SELECT 1 FROM router_property_assignments
           WHERE router_id = $1 AND event_type = 'property_remove' AND event_date > $2
           ORDER BY event_date DESC LIMIT 1`,
          [routerId, a.event_date]
        );
        if (removed.rows.length === 0) {
          throw new Error(`Router ${routerId} is already assigned to property "${a.property_name}" (${a.property_clickup_task_id}). Remove from current property first.`);
        }
      }

      // Insert property_assign event
      const assignmentResult = await client.query(
        `INSERT INTO router_property_assignments
         (router_id, event_type, event_date, property_clickup_task_id, property_name, installed_by, notes)
         VALUES ($1, 'property_assign', $2, $3, $4, $5, $6)
         RETURNING *`,
        [routerId, actualInstalledAt, propertyTaskId, validatedPropertyName, installedBy, notes]
      );

      // Update routers current state
      await client.query(
        `UPDATE routers SET 
           current_state = 'assigned',
           current_property_task_id = $1,
           current_property_name = $2,
           current_stored_with_user_id = NULL,
           current_stored_with_username = NULL,
           state_updated_at = $3
         WHERE router_id = $4`,
        [propertyTaskId, validatedPropertyName, actualInstalledAt, routerId]
      );

      await client.query('COMMIT');

      logger.info('Router assigned to property (event-based)', {
        routerId,
        propertyTaskId,
        propertyName: validatedPropertyName,
        installedAt: actualInstalledAt
      });

      return assignmentResult.rows[0];
    }

    // Legacy behavior (no events): fall back to removed_at/assignment_type if present, else oldest schema
    const hasAssignType = await hasAssignmentTypeColumn();

    if (hasAssignType) {
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

      const assignmentResult = await client.query(
        `INSERT INTO router_property_assignments 
         (router_id, assignment_type, property_clickup_task_id, property_name, installed_at, installed_by, notes)
         VALUES ($1, 'property', $2, $3, $4, $5, $6)
         RETURNING *`,
        [routerId, propertyTaskId, validatedPropertyName, actualInstalledAt, installedBy, notes]
      );

      await client.query(
        `UPDATE routers 
         SET current_property_task_id = $1,
             current_property_name = $2,
             property_installed_at = $3
         WHERE router_id = $4`,
        [propertyTaskId, validatedPropertyName, actualInstalledAt, routerId]
      );

      await client.query('COMMIT');

      logger.info('Router assigned to property (legacy with assignment_type)', { 
        routerId, propertyTaskId, propertyName: validatedPropertyName 
      });

      return assignmentResult.rows[0];
    }

    // Very old legacy (no assignment_type): just insert without type column
    const assignmentResult = await client.query(
      `INSERT INTO router_property_assignments 
       (router_id, property_clickup_task_id, property_name, installed_at, installed_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [routerId, propertyTaskId, validatedPropertyName, actualInstalledAt, installedBy, notes]
    );

    await client.query(
      `UPDATE routers 
       SET current_property_task_id = $1,
           current_property_name = $2,
           property_installed_at = $3
       WHERE router_id = $4`,
      [propertyTaskId, validatedPropertyName, actualInstalledAt, routerId]
    );

    await client.query('COMMIT');

    logger.info('Router assigned to property (very old legacy)', { 
      routerId, propertyTaskId, propertyName: validatedPropertyName 
    });

    return assignmentResult.rows[0];

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

    const hasEvents = await hasEventTypeColumn();

    if (hasEvents) {
      // Find last property_assign
      const lastAssign = await client.query(
        `SELECT property_clickup_task_id, property_name, event_date FROM router_property_assignments
         WHERE router_id = $1 AND event_type = 'property_assign'
         ORDER BY event_date DESC LIMIT 1`,
        [routerId]
      );
      if (lastAssign.rows.length === 0) {
        throw new Error(`Router ${routerId} is not currently assigned to any property`);
      }
      const a = lastAssign.rows[0];
      // Ensure not already removed
      const removed = await client.query(
        `SELECT 1 FROM router_property_assignments
         WHERE router_id = $1 AND event_type = 'property_remove' AND event_date > $2
         ORDER BY event_date DESC LIMIT 1`,
        [routerId, a.event_date]
      );
      if (removed.rows.length > 0) {
        throw new Error(`Router ${routerId} is not currently assigned to any property`);
      }

      const updateResult = await client.query(
        `INSERT INTO router_property_assignments
         (router_id, event_type, event_date, property_clickup_task_id, property_name, removed_by, notes)
         VALUES ($1, 'property_remove', $2, $3, $4, $5, $6)
         RETURNING *`,
        [routerId, removedAt, a.property_clickup_task_id, a.property_name, removedBy, notes]
      );

      // Clear current property from routers
      await client.query(
        `UPDATE routers 
         SET current_state = 'unassigned',
             current_property_task_id = NULL,
             current_property_name = NULL,
             property_installed_at = NULL,
             state_updated_at = $2
         WHERE router_id = $1`,
        [routerId, removedAt]
      );

      await client.query('COMMIT');

      logger.info('Router removed from property (event-based)', { routerId, propertyTaskId: a.property_clickup_task_id });
      return updateResult.rows[0];
    }

    // Legacy path with assignment_type/removed_at
    const hasAssignType = await hasAssignmentTypeColumn();
    const query = hasAssignType
      ? `SELECT * FROM router_property_assignments 
         WHERE router_id = $1 AND removed_at IS NULL AND assignment_type = 'property'`
      : `SELECT * FROM router_property_assignments 
         WHERE router_id = $1 AND removed_at IS NULL`;
    
    const currentResult = await client.query(query, [routerId]);

    if (currentResult.rows.length === 0) {
      throw new Error(`Router ${routerId} is not currently assigned to any property`);
    }

    const currentAssignment = currentResult.rows[0];

    const updateResult = await client.query(
      `UPDATE router_property_assignments 
       SET removed_at = $1, removed_by = $2, notes = COALESCE($3, notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [removedAt, removedBy, notes, currentAssignment.id]
    );

    await client.query(
      `UPDATE routers 
       SET current_property_task_id = NULL,
           current_property_name = NULL,
           property_installed_at = NULL
       WHERE router_id = $1`,
      [routerId]
    );

    await client.query('COMMIT');

    logger.info('Router removed from property (legacy)', { routerId });
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
    const hasEvents = await hasEventTypeColumn();
    if (hasEvents) {
      // Find latest property_assign without a subsequent remove
      const lastAssign = await pool.query(
        `SELECT * FROM router_property_assignments
         WHERE router_id = $1 AND event_type = 'property_assign'
         ORDER BY event_date DESC LIMIT 1`,
        [routerId]
      );
      if (lastAssign.rows.length === 0) return null;
      const a = lastAssign.rows[0];
      const removed = await pool.query(
        `SELECT 1 FROM router_property_assignments WHERE router_id = $1 AND event_type = 'property_remove' AND event_date > $2
         ORDER BY event_date DESC LIMIT 1`,
        [routerId, a.event_date]
      );
      if (removed.rows.length > 0) return null;
      const daysSinceInstalled = Math.floor((Date.now() - new Date(a.event_date).getTime()) / (1000 * 60 * 60 * 24));
      return { ...a, installed_at: a.event_date, daysSinceInstalled };
    }

    // Legacy - check if assignment_type exists
    const hasAssignType = await hasAssignmentTypeColumn();
    const query = hasAssignType
      ? `SELECT * FROM router_property_assignments 
         WHERE router_id = $1 AND removed_at IS NULL AND assignment_type = 'property'`
      : `SELECT * FROM router_property_assignments 
         WHERE router_id = $1 AND removed_at IS NULL`;
    
    const result = await pool.query(query, [routerId]);
    if (result.rows.length === 0) return null;
    const assignment = result.rows[0];
    const daysSinceInstalled = Math.floor((Date.now() - new Date(assignment.installed_at).getTime()) / (1000 * 60 * 60 * 24));
    return { ...assignment, daysSinceInstalled };

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
    const hasEvents = await hasEventTypeColumn();
    if (hasEvents) {
      const lastAssign = await pool.query(
        `SELECT * FROM router_property_assignments
         WHERE router_id = $1 AND event_type = 'storage_assign'
         ORDER BY event_date DESC LIMIT 1`,
        [routerId]
      );
      if (lastAssign.rows.length === 0) return null;
      const a = lastAssign.rows[0];
      const removed = await pool.query(
        `SELECT 1 FROM router_property_assignments WHERE router_id = $1 AND event_type = 'storage_remove' AND event_date > $2
         ORDER BY event_date DESC LIMIT 1`,
        [routerId, a.event_date]
      );
      if (removed.rows.length > 0) return null;
      const daysSinceStored = Math.floor((Date.now() - new Date(a.event_date).getTime()) / (1000 * 60 * 60 * 24));
      return { ...a, installed_at: a.event_date, daysSinceStored };
    }

    // Legacy - check if assignment_type exists
    const hasAssignType = await hasAssignmentTypeColumn();
    const query = hasAssignType
      ? `SELECT * FROM router_property_assignments 
         WHERE router_id = $1 AND removed_at IS NULL AND assignment_type = 'storage'`
      : `SELECT * FROM router_property_assignments 
         WHERE router_id = $1 AND removed_at IS NULL`;
    
    const result = await pool.query(query, [routerId]);
    if (result.rows.length === 0) return null;
    const storage = result.rows[0];
    const daysSinceStored = Math.floor((Date.now() - new Date(storage.installed_at).getTime()) / (1000 * 60 * 60 * 24));
    return { ...storage, daysSinceStored };

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
    const hasEvents = await hasEventTypeColumn();
    let result;
    if (hasEvents) {
      // Active property assignments for the specific property (event-based)
      result = await pool.query(
        `SELECT 
           rpa.*, rpa.event_date AS installed_at, r.name as router_name, r.imei, r.firmware_version, r.current_status, r.last_seen
         FROM router_property_assignments rpa
         JOIN routers r ON r.router_id = rpa.router_id
         WHERE rpa.property_clickup_task_id = $1
           AND rpa.event_type = 'property_assign'
           AND NOT EXISTS (
             SELECT 1 FROM router_property_assignments rpa2
             WHERE rpa2.router_id = rpa.router_id
               AND rpa2.property_clickup_task_id = rpa.property_clickup_task_id
               AND rpa2.event_type = 'property_remove'
               AND rpa2.event_date > rpa.event_date
           )
         ORDER BY rpa.event_date DESC`,
        [propertyTaskId]
      );
    } else {
      // Legacy - check if assignment_type exists
      const hasAssignType = await hasAssignmentTypeColumn();
      const query = hasAssignType
        ? `SELECT 
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
           ORDER BY rpa.installed_at DESC`
        : `SELECT 
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
           ORDER BY rpa.installed_at DESC`;
      
      result = await pool.query(query, [propertyTaskId]);
    }

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
    const hasEvents = await hasEventTypeColumn();
    let result;
    if (hasEvents) {
      result = await pool.query(
        `SELECT rpa.*, rpa.event_date AS installed_at, r.name as router_name, r.imei, r.firmware_version, r.last_seen
         FROM router_property_assignments rpa
         JOIN routers r ON r.router_id = rpa.router_id
         WHERE rpa.event_type = 'property_assign'
           AND NOT EXISTS (
             SELECT 1 FROM router_property_assignments rpa2
             WHERE rpa2.router_id = rpa.router_id
               AND rpa2.event_type = 'property_remove'
               AND rpa2.event_date > rpa.event_date
               AND rpa2.property_clickup_task_id = rpa.property_clickup_task_id
           )
         ORDER BY rpa.event_date DESC`
      );
    } else {
      const hasAssignType = await hasAssignmentTypeColumn();
      const query = hasAssignType
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
      result = await pool.query(query);
    }

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
    const hasEvents = await hasEventTypeColumn();
    if (hasEvents) {
      const result = await pool.query(`
        WITH assigns AS (
          SELECT router_id, property_clickup_task_id, event_date AS installed_at
          FROM router_property_assignments
          WHERE event_type = 'property_assign'
        ), removals AS (
          SELECT router_id, property_clickup_task_id, event_date AS removed_at
          FROM router_property_assignments
          WHERE event_type = 'property_remove'
        ), pairs AS (
          SELECT a.router_id, a.property_clickup_task_id, a.installed_at,
                 (SELECT MIN(r.removed_at) FROM removals r
                  WHERE r.router_id = a.router_id
                    AND r.property_clickup_task_id = a.property_clickup_task_id
                    AND r.removed_at > a.installed_at) AS removed_at
          FROM assigns a
        ), active AS (
          SELECT a.router_id, a.property_clickup_task_id FROM assigns a
          WHERE NOT EXISTS (
            SELECT 1 FROM removals r
            WHERE r.router_id = a.router_id
              AND r.property_clickup_task_id = a.property_clickup_task_id
              AND r.removed_at > a.installed_at
          )
        )
        SELECT 
          (SELECT COUNT(DISTINCT router_id) FROM assigns) AS total_routers_assigned,
          (SELECT COUNT(DISTINCT router_id) FROM active) AS currently_assigned,
          (SELECT COUNT(DISTINCT property_clickup_task_id) FROM assigns) AS total_properties,
          (SELECT COUNT(DISTINCT property_clickup_task_id) FROM active) AS active_properties,
          (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(removed_at, NOW()) - installed_at)) / 86400)::int, 0) FROM pairs) AS avg_deployment_days
      `);
      return result.rows[0];
    }

    // Legacy stats
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
