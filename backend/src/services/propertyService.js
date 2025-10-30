/**
 * Property Service
 * Manages router-property assignments and history
 */

const { pool, logger } = require('../config/database');

/**
 * Assign router to a property
 * @param {Object} assignment - Assignment details
 * @returns {Promise<Object>} Created assignment record
 */
async function assignRouterToProperty(assignment) {
  const {
    routerId,
    propertyTaskId,
    propertyName,
    installedAt = new Date(),
    installedBy = null,
    notes = null
  } = assignment;

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Check if router already has an active assignment
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

    // Create new assignment record
    const assignmentResult = await client.query(
      `INSERT INTO router_property_assignments 
       (router_id, property_clickup_task_id, property_name, installed_at, installed_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [routerId, propertyTaskId, propertyName, installedAt, installedBy, notes]
    );

    const newAssignment = assignmentResult.rows[0];

    // Update routers table with current property (denormalized)
    await client.query(
      `UPDATE routers 
       SET current_property_task_id = $1,
           current_property_name = $2,
           property_installed_at = $3
       WHERE router_id = $4`,
      [propertyTaskId, propertyName, installedAt, routerId]
    );

    await client.query('COMMIT');

    logger.info('Router assigned to property', { 
      routerId, 
      propertyTaskId, 
      propertyName 
    });

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

    // Find current assignment
    const currentResult = await client.query(
      `SELECT * FROM router_property_assignments 
       WHERE router_id = $1 AND removed_at IS NULL`,
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
 * @returns {Promise<Object>} New assignment record
 */
async function moveRouterToProperty(move) {
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
  });
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
       WHERE router_id = $1 AND removed_at IS NULL`,
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

      return {
        id: assignment.id,
        propertyTaskId: assignment.property_clickup_task_id,
        propertyName: assignment.property_name,
        installedAt: assignment.installed_at,
        removedAt: assignment.removed_at,
        durationDays,
        installedBy: assignment.installed_by,
        removedBy: assignment.removed_by,
        notes: assignment.notes,
        current: assignment.removed_at === null
      };
    });

    const currentProperty = assignments.find(a => a.current) || null;
    const totalDaysDeployed = assignments.reduce((sum, a) => sum + a.durationDays, 0);

    return {
      routerId,
      currentProperty,
      history: assignments,
      totalProperties: assignments.length,
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

module.exports = {
  assignRouterToProperty,
  removeRouterFromProperty,
  moveRouterToProperty,
  getCurrentProperty,
  getPropertyHistory,
  getRoutersAtProperty,
  getPropertyStats
};
