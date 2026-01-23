/**
 * Property Service
 * Handles:
 * 1. Linking routers to location tasks (with history tracking)
 * 2. Assigning routers to ClickUp users (syncs with ClickUp assignees)
 * 3. Property assignment history in router_property_assignments table
 */

const { pool, logger } = require('../config/database');
const clickupClient = require('./clickupClient');
const { CLICKUP_FIELD_IDS } = require('../config/constants');

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

    const linkDate = new Date();
    
    // Update router with location task info
    const result = await client.query(
      `UPDATE routers 
       SET clickup_location_task_id = $1,
           clickup_location_task_name = $2,
           location_linked_at = $3
       WHERE router_id = $4
       RETURNING *`,
      [locationTaskId, locationTaskName, linkDate, routerId]
    );

    // Record in property assignment history
    try {
      await client.query(
        `INSERT INTO router_property_assignments 
         (router_id, property_clickup_task_id, property_name, installed_at, installed_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [routerId, locationTaskId, locationTaskName, linkDate, linkedBy, notes]
      );
      logger.info('Recorded property assignment in history', { 
        routerId, 
        locationTaskId,
        installedAt: linkDate.toISOString()
      });
    } catch (historyError) {
      logger.warn('Failed to record property assignment history (link still recorded)', {
        routerId,
        error: historyError.message
      });
    }

    // Fetch and sync date_installed from ClickUp
    const DATE_INSTALLED_FIELD_ID = CLICKUP_FIELD_IDS.DATE_INSTALLED;
    try {
      const rawDate = await clickupClient.getListCustomFieldValue(
        locationTaskId,
        DATE_INSTALLED_FIELD_ID,
        'default'
      );
      const dateInstalled = rawDate ? Number(rawDate) : null;
      
      await client.query(
        `UPDATE routers SET date_installed = $1 WHERE router_id = $2`,
        [dateInstalled, routerId]
      );
      
      logger.info('Synced date_installed from ClickUp', { 
        routerId, 
        dateInstalled: dateInstalled ? new Date(dateInstalled).toISOString() : null 
      });
    } catch (dateError) {
      logger.warn('Failed to sync date_installed (location link still recorded)', {
        routerId,
        error: dateError.message
      });
    }

    await client.query('COMMIT');

    logger.info('Router linked to location task', { 
      routerId, 
      locationTaskId,
      locationTaskName
    });

    // Update ClickUp task status and remove assignees
    if (clickupTaskId) {
      try {
        const task = await clickupClient.getTask(clickupTaskId);
        
        // Update task status to "installed" (ClickUp statuses are case-insensitive)
        await clickupClient.updateTask(
          clickupTaskId,
          { status: 'installed' },
          'default'
        );
        logger.info('Updated ClickUp task status to INSTALLED', { 
          routerId, 
          clickupTaskId
        });

        // Remove assignees
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

        // Add comment to router task linking the location
        try {
          // Get workspace ID for proper ClickUp URL
          const workspaceResult = await client.query(
            'SELECT workspace_id FROM clickup_oauth_tokens WHERE user_id = $1',
            ['default']
          );
          const workspaceId = workspaceResult.rows[0]?.workspace_id;
          
          // Construct proper ClickUp list URL
          const locationUrl = workspaceId 
            ? `https://app.clickup.com/${workspaceId}/v/li/${locationTaskId}`
            : `https://app.clickup.com/list/${locationTaskId}`;
          
          const commentText = `🤖 **System:** Router assigned to location: **${locationTaskName}**\n\n` +
            `📍 Location: ${locationUrl}\n` +
            `🕐 Assigned at: ${new Date().toLocaleString()}` +
            (linkedBy ? `\n👤 Linked by: ${linkedBy}` : '') +
            (notes ? `\n\n📝 Notes: ${notes}` : '');

          await clickupClient.createTaskComment(
            clickupTaskId,
            commentText,
            { notifyAll: false },
            'default'
          );
          
          logger.info('Added location assignment comment to router task', {
            routerId,
            clickupTaskId,
            locationTaskId,
            locationTaskName
          });
        } catch (commentError) {
          logger.warn('Failed to add comment to router task (assignment still recorded)', {
            routerId,
            clickupTaskId,
            error: commentError.message
          });
        }
      } catch (clickupError) {
        logger.warn('Failed to update ClickUp task status/assignees (location link still recorded)', {
          routerId,
          clickupTaskId,
          error: clickupError.message
        });
      }
    }

    // Add installation comment to the LOCATION/PROPERTY task (if it's a task, not a list)
    // Task IDs are alphanumeric, list IDs are purely numeric
    const isTaskId = /[a-zA-Z]/.test(locationTaskId);
    if (isTaskId) {
      try {
        const router = result.rows[0];
        const dashboardUrl = `https://routerlogger-frontend-production.up.railway.app/router/${routerId}`;
        
        // Format last_seen nicely
        let lastSeenFormatted = 'Unknown';
        if (router.last_seen) {
          const lastSeenDate = new Date(router.last_seen);
          lastSeenFormatted = lastSeenDate.toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/London'
          });
        }
        
        // Determine online/offline status
        const isOnline = router.current_status === 'online' || router.current_status === 1;
        const statusEmoji = isOnline ? '🟢' : '🔴';
        const statusText = isOnline ? 'Online' : 'Offline';
        
        // Build rich comment
        const commentLines = [
          `✅ **Router #${routerId} Installed** ✅`,
          '',
          `📍 **Installation Details**`,
          `• Status: ${statusEmoji} ${statusText}`,
          `• Installed: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}`,
          `• Dashboard: ${dashboardUrl}`,
        ];
        
        // Add ClickUp task link if available
        if (clickupTaskId) {
          const clickupTaskUrl = `https://app.clickup.com/t/${clickupTaskId}`;
          commentLines.push(`• Router Task: ${clickupTaskUrl}`);
        }
        
        // Add last seen if available
        if (router.last_seen) {
          commentLines.push(`• Last Online: ${lastSeenFormatted}`);
        }
        
        // Add device info section
        commentLines.push('', `📱 **Device Info**`);
        if (router.name) {
          commentLines.push(`• Name: ${router.name}`);
        }
        if (router.serial) {
          commentLines.push(`• Serial: ${router.serial}`);
        }
        if (router.imei) {
          commentLines.push(`• IMEI: ${router.imei}`);
        }
        if (router.mac) {
          commentLines.push(`• MAC: ${router.mac}`);
        }
        
        // Add network info if available
        if (router.operator || router.signal_strength || router.connection_type) {
          commentLines.push('', `📶 **Network Info**`);
          if (router.operator) {
            commentLines.push(`• Operator: ${router.operator}`);
          }
          if (router.signal_strength) {
            commentLines.push(`• Signal: ${router.signal_strength} dBm`);
          }
          if (router.connection_type) {
            commentLines.push(`• Connection: ${router.connection_type}`);
          }
        }
        
        // Add location info if available
        if (router.latitude && router.longitude) {
          const mapsUrl = `https://www.google.com/maps?q=${router.latitude},${router.longitude}`;
          commentLines.push('', `🗺️ **Location**`);
          commentLines.push(`• Coordinates: ${router.latitude}, ${router.longitude}`);
          commentLines.push(`• Map: ${mapsUrl}`);
        }
        
        // Add notes if provided
        if (notes) {
          commentLines.push('', `📝 **Notes**`);
          commentLines.push(notes);
        }
        
        const commentText = commentLines.join('\n');
        
        await clickupClient.createTaskComment(
          locationTaskId,
          commentText,
          { notifyAll: false },
          'default'
        );
        
        logger.info('Added installation comment to property task', {
          routerId,
          locationTaskId,
          locationTaskName
        });
      } catch (commentError) {
        logger.warn('Failed to add installation comment to property task (link still recorded)', {
          routerId,
          locationTaskId,
          error: commentError.message
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
      `SELECT clickup_task_id, clickup_location_task_id, clickup_location_task_name
       FROM routers WHERE router_id = $1`,
      [routerId]
    );

    if (routerResult.rows.length === 0) {
      throw new Error(`Router ${routerId} not found`);
    }

    const router = routerResult.rows[0];
    const wasLinkedToLocation = router.clickup_location_task_id;
    const wasLinkedToLocationName = router.clickup_location_task_name;

    if (!wasLinkedToLocation) {
      throw new Error(`Router ${routerId} is not linked to any location`);
    }

    const unlinkDate = new Date();

    // Update router to remove location link (keep date_installed for history reference)
    const result = await client.query(
      `UPDATE routers 
       SET clickup_location_task_id = NULL,
           clickup_location_task_name = NULL,
           location_linked_at = NULL
       WHERE router_id = $1
       RETURNING *`,
      [routerId]
    );

    // Record the removal in property assignment history
    try {
      await client.query(
        `UPDATE router_property_assignments 
         SET removed_at = $1, removed_by = $2, notes = COALESCE(notes || E'\n', '') || $3
         WHERE router_id = $4 
           AND property_clickup_task_id = $5 
           AND removed_at IS NULL`,
        [unlinkDate, unlinkedBy, notes || '', routerId, wasLinkedToLocation]
      );
      logger.info('Recorded property removal in history', { 
        routerId, 
        locationTaskId: wasLinkedToLocation,
        removedAt: unlinkDate.toISOString()
      });
    } catch (historyError) {
      logger.warn('Failed to record property removal history (unlink still recorded)', {
        routerId,
        error: historyError.message
      });
    }

    await client.query('COMMIT');

    logger.info('Router unlinked from location task', { 
      routerId, 
      wasLinkedTo: wasLinkedToLocation
    });

    // Update ClickUp task status to "needs attention" when unlinked
    if (router.clickup_task_id) {
      try {
        await clickupClient.updateTask(
          router.clickup_task_id,
          { status: 'needs attention' },
          'default'
        );
        logger.info('Updated ClickUp task status to NEEDS ATTENTION', { 
          routerId, 
          clickupTaskId: router.clickup_task_id
        });

        // Add comment to router task about unlinking
        try {
          // Get workspace ID for proper ClickUp URL
          const workspaceResult = await client.query(
            'SELECT workspace_id FROM clickup_oauth_tokens WHERE user_id = $1',
            ['default']
          );
          const workspaceId = workspaceResult.rows[0]?.workspace_id;
          
          // Construct proper ClickUp list URL
          const locationUrl = workspaceId 
            ? `https://app.clickup.com/${workspaceId}/v/li/${wasLinkedToLocation}`
            : `https://app.clickup.com/list/${wasLinkedToLocation}`;
          
          const locationDisplay = wasLinkedToLocationName || wasLinkedToLocation;
          
          const commentText = `🤖 **System:** Router removed from location: **${locationDisplay}**\n\n` +
            `📍 Previous Location: ${locationUrl}\n` +
            `🕐 Unlinked at: ${new Date().toLocaleString()}` +
            (unlinkedBy ? `\n👤 Unlinked by: ${unlinkedBy}` : '') +
            (notes ? `\n\n📝 Notes: ${notes}` : '');

          await clickupClient.createTaskComment(
            router.clickup_task_id,
            commentText,
            { notifyAll: false },
            'default'
          );
          
          logger.info('Added unlink comment to router task', {
            routerId,
            clickupTaskId: router.clickup_task_id
          });
        } catch (commentError) {
          logger.warn('Failed to add unlink comment (unlink still recorded)', {
            routerId,
            error: commentError.message
          });
        }
      } catch (clickupError) {
        logger.warn('Failed to update ClickUp task status (unlink still recorded)', {
          routerId,
          clickupTaskId: router.clickup_task_id,
          error: clickupError.message
        });
      }
    }

    // Add uninstall comment to the LOCATION/PROPERTY task (if it was a task, not a list)
    const isTaskId = /[a-zA-Z]/.test(wasLinkedToLocation);
    if (isTaskId) {
      try {
        const dashboardUrl = `https://routerlogger-frontend-production.up.railway.app/router/${routerId}`;
        
        const commentLines = [
          `🔄 **Router #${routerId} Uninstalled** 🔄`,
          '',
          `📍 **Removal Details**`,
          `• Uninstalled: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}`,
          `• Dashboard: ${dashboardUrl}`,
        ];
        
        if (unlinkedBy) {
          commentLines.push(`• Removed by: ${unlinkedBy}`);
        }
        
        if (notes) {
          commentLines.push('', `📝 **Notes**`);
          commentLines.push(notes);
        }
        
        const commentText = commentLines.join('\n');
        
        await clickupClient.createTaskComment(
          wasLinkedToLocation,
          commentText,
          { notifyAll: false },
          'default'
        );
        
        logger.info('Added uninstall comment to property task', {
          routerId,
          locationTaskId: wasLinkedToLocation,
          locationTaskName: wasLinkedToLocationName
        });
      } catch (commentError) {
        logger.warn('Failed to add uninstall comment to property task (unlink still recorded)', {
          routerId,
          locationTaskId: wasLinkedToLocation,
          error: commentError.message
        });
      }
    }

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
      `SELECT clickup_location_task_id, clickup_location_task_name, location_linked_at, date_installed
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

    let dateInstalled = router.date_installed;

    // Fallback: if date_installed is missing, try to backfill it once from ClickUp
    if (!dateInstalled) {
      const DATE_INSTALLED_FIELD_ID = CLICKUP_FIELD_IDS.DATE_INSTALLED;
      try {
        const rawDate = await clickupClient.getListCustomFieldValue(
          router.clickup_location_task_id,
          DATE_INSTALLED_FIELD_ID,
          'default'
        );
        const fetchedDate = rawDate ? Number(rawDate) : null;

        if (fetchedDate) {
          dateInstalled = fetchedDate;
          await pool.query(
            `UPDATE routers SET date_installed = $1 WHERE router_id = $2`,
            [dateInstalled, routerId]
          );

          logger.info('Backfilled date_installed from ClickUp in getCurrentLocation', {
            routerId,
            locationTaskId: router.clickup_location_task_id,
            dateInstalled: new Date(dateInstalled).toISOString()
          });
        } else {
          logger.warn('No Date Installed value found in ClickUp for location', {
            routerId,
            locationTaskId: router.clickup_location_task_id
          });
        }
      } catch (dateError) {
        logger.warn('Failed to backfill date_installed from ClickUp (location still returned)', {
          routerId,
          locationTaskId: router.clickup_location_task_id,
          error: dateError.message
        });
      }
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

    // Fetch updated task to get full assignee details
    const updatedTask = await clickupClient.getTask(clickupTaskId);
    const updatedAssignees = updatedTask.assignees || [];

    // Update database with assignee information immediately
    try {
      await pool.query(
        'UPDATE routers SET clickup_assignees = $1 WHERE router_id = $2',
        [JSON.stringify(updatedAssignees), routerId]
      );
      
      logger.info('Database updated with assignee information', {
        routerId,
        assigneeCount: updatedAssignees.length
      });
    } catch (dbError) {
      logger.error('Failed to update database with assignee information', {
        routerId,
        error: dbError.message
      });
      // Don't throw - ClickUp update succeeded, database will sync later
    }

    // Add comment to router task about assignment
    try {
      const assigneeNames = assigneeUsernames.length > 0 
        ? assigneeUsernames.join(', ')
        : updatedAssignees.map(a => a.username || a.email || `User ${a.id}`).join(', ');
      
      const commentText = `👤 **System:** Router assigned to: **${assigneeNames}**\n\n` +
        `🕐 Assigned at: ${new Date().toLocaleString()}`;

      await clickupClient.createTaskComment(
        clickupTaskId,
        commentText,
        { notifyAll: false },
        'default'
      );
      
      logger.info('Added assignment comment to router task', {
        routerId,
        clickupTaskId,
        assignees: assigneeNames
      });
    } catch (commentError) {
      logger.warn('Failed to add assignment comment (assignment still recorded)', {
        routerId,
        clickupTaskId,
        error: commentError.message
      });
    }

    return {
      success: true,
      routerId,
      clickupTaskId,
      assignedTo: assigneeUsernames,
      assignees: updatedAssignees
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

    // Add comment to router task about unassignment
    try {
      // Get assignee names if available
      const assigneeNames = task.assignees?.map(a => a.username || a.email || `User ${a.id}`).join(', ') || 'assignees';
      
      const commentText = `👤 **System:** Router unassigned from: **${assigneeNames}**\n\n` +
        `🕐 Unassigned at: ${new Date().toLocaleString()}`;

      await clickupClient.createTaskComment(
        clickupTaskId,
        commentText,
        { notifyAll: false },
        'default'
      );
      
      logger.info('Added unassignment comment to router task', {
        routerId,
        clickupTaskId
      });
    } catch (commentError) {
      logger.warn('Failed to add unassignment comment (unassignment still recorded)', {
        routerId,
        clickupTaskId,
        error: commentError.message
      });
    }

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
