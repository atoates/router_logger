/**
 * ClickUp Admin Routes
 * Operational ClickUp API endpoints (admin-only).
 *
 * NOTE: Debug endpoints live in clickupDebugRoutes.js (gated by ENABLE_DEBUG_ENDPOINTS).
 * NOTE: OAuth endpoints live in clickupAuthRoutes.js.
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { requireAdmin } = require('../session');
const clickupClient = require('../../services/clickupClient');
const { syncAllRoutersToClickUp, getSyncStats, syncAssigneesFromClickUp } = require('../../services/clickupSync');
const { pool } = require('../../config/database');
const logger = require('../../config/database').logger;
const { sanitizeError } = require('../../utils/errorLogger');

router.use(requireAdmin);

/**
 * GET /api/clickup/current-user
 * Get current ClickUp user info
 */
router.get('/current-user', async (req, res) => {
  try {
    const client = await clickupClient.getAuthorizedClient('default');
    const userResponse = await client.get('/user');
    const user = userResponse.data.user;

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      color: user.color,
      profilePicture: user.profilePicture
    });
  } catch (error) {
    logger.error('Error getting current user:', sanitizeError(error));
    res.status(error.message.includes('No ClickUp token') ? 401 : 500)
      .json({ error: error.message });
  }
});

/**
 * GET /api/clickup/workspaces
 * Get authorized workspaces
 */
router.get('/workspaces', async (req, res) => {
  try {
    const workspaces = await clickupClient.getWorkspaces('default');
    res.json({ workspaces });
  } catch (error) {
    logger.error('Error getting workspaces:', sanitizeError(error));
    res.status(error.message.includes('No ClickUp token') ? 401 : 500)
      .json({ error: error.message });
  }
});

/**
 * GET /api/clickup/workspaces/:workspaceId/members
 * Get workspace members
 */
router.get('/workspaces/:workspaceId/members', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const members = await clickupClient.getWorkspaceMembers(workspaceId, 'default');
    res.json({ members });
  } catch (error) {
    logger.error('Error getting workspace members:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/spaces/:workspaceId
 * Get spaces in a workspace
 */
router.get('/spaces/:workspaceId', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const spaces = await clickupClient.getSpaces(workspaceId, 'default');
    res.json({ spaces });
  } catch (error) {
    logger.error('Error getting spaces:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/space-lists/:spaceId
 * Get lists (folderless + folders) in a space.
 * Used by the mobile installer flow (this is NOT gated behind ENABLE_DEBUG_ENDPOINTS).
 *
 * Response shape intentionally matches mobile expectations:
 * - { folderless: [...], folders: [{ folder: {id,name}, lists: [...] }, ...] }
 */
router.get('/space-lists/:spaceId', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const client = await clickupClient.getAuthorizedClient('default');

    // Folderless lists
    const listsResponse = await client.get(`/space/${spaceId}/list`, { params: { archived: false } });
    const folderless = (listsResponse.data.lists || []).map(l => ({
      id: l.id,
      name: l.name,
      task_count: l.task_count
    }));

    // Folders + their lists
    const foldersResponse = await client.get(`/space/${spaceId}/folder`, { params: { archived: false } });
    const folders = foldersResponse.data.folders || [];

    const folderResults = [];
    for (const folder of folders) {
      try {
        const folderListsResponse = await client.get(`/folder/${folder.id}/list`, { params: { archived: false } });
        const lists = (folderListsResponse.data.lists || []).map(l => ({
          id: l.id,
          name: l.name,
          task_count: l.task_count
        }));
        folderResults.push({
          folder: { id: folder.id, name: folder.name },
          lists
        });
      } catch (err) {
        logger.warn('Failed to fetch folder lists (continuing)', { folderId: folder.id, error: err.message });
      }
    }

    res.json({
      folderless,
      folders: folderResults
    });
  } catch (error) {
    logger.error('Error getting space lists:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/lists/:workspaceId
 * Get "Routers" list in workspace
 */
router.get('/lists/:workspaceId', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const list = await clickupClient.findListByName(workspaceId, 'Routers', 'default');

    if (!list) {
      return res.status(404).json({ error: 'Routers list not found in workspace' });
    }

    res.json({ list });
  } catch (error) {
    logger.error('Error getting Routers list:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/tasks/:listId
 * Get tasks from a list
 */
router.get('/tasks/:listId', async (req, res) => {
  try {
    const { listId } = req.params;
    const { page = 0, search } = req.query;

    const tasks = await clickupClient.getTasks(listId, { page }, 'default');

    // Filter by search if provided
    let filteredTasks = tasks;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredTasks = tasks.filter(task => task.name.toLowerCase().includes(searchLower));
    }

    res.json({ tasks: filteredTasks });
  } catch (error) {
    logger.error('Error getting tasks:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/clickup/tasks/:listId
 * Create a new task in the Routers list
 */
router.post('/tasks/:listId', async (req, res) => {
  try {
    const { listId } = req.params;
    const taskData = req.body;

    if (!taskData?.name) {
      return res.status(400).json({ error: 'Task name is required' });
    }

    // Pass all task data through to ClickUp (including custom_fields)
    const task = await clickupClient.createTask(listId, taskData, 'default');
    logger.info('Created ClickUp task', { taskId: task.id, name: taskData.name });

    res.json({ task });
  } catch (error) {
    logger.error('Error creating task:', sanitizeError(error));
    const errorMessage = error.clickupData?.err || error.clickupData?.error || error.message;
    res.status(error.status || 500).json({
      error: errorMessage,
      clickupError: error.clickupData
    });
  }
});

/**
 * PUT /api/clickup/task/:taskId
 * Update a ClickUp task (including custom fields)
 */
router.put('/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const updateData = req.body;

    const updatedTask = await clickupClient.updateTask(taskId, updateData, 'default');
    logger.info('Updated ClickUp task', { taskId });

    res.json({ task: updatedTask });
  } catch (error) {
    logger.error('Error updating task:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/clickup/link-router
 * Link a router to a ClickUp task
 */
router.post('/link-router', async (req, res) => {
  try {
    const { routerId, taskId, listId } = req.body;

    if (!routerId || !taskId) {
      return res.status(400).json({ error: 'Router ID and Task ID are required' });
    }

    // Get task details to build URL
    const task = await clickupClient.getTask(taskId, 'default');
    const taskUrl = task.url || `https://app.clickup.com/t/${taskId}`;

    // Update router with ClickUp task info
    const result = await pool.query(
      `UPDATE routers
       SET clickup_task_id = $1,
           clickup_task_url = $2,
           clickup_list_id = $3
       WHERE router_id = $4
       RETURNING *`,
      [taskId, taskUrl, listId, routerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Router not found' });
    }

    logger.info('Linked router to ClickUp task', { routerId, taskId });

    res.json({
      success: true,
      router: result.rows[0],
      task: {
        id: task.id,
        name: task.name,
        status: task.status?.status,
        url: taskUrl
      }
    });
  } catch (error) {
    logger.error('Error linking router to task:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/clickup/reset-all-links
 * Clear all ClickUp task links (for re-creation)
 */
router.post('/reset-all-links', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE routers
       SET clickup_task_id = NULL,
           clickup_task_url = NULL,
           clickup_list_id = NULL
       WHERE clickup_task_id IS NOT NULL
       RETURNING router_id`
    );

    logger.info('Reset all ClickUp links', { count: result.rows.length });

    res.json({
      success: true,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Error resetting ClickUp links:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/clickup/link-router/:routerId
 * Unlink a router from its ClickUp task
 */
router.delete('/link-router/:routerId', async (req, res) => {
  try {
    const { routerId } = req.params;

    const result = await pool.query(
      `UPDATE routers
       SET clickup_task_id = NULL,
           clickup_task_url = NULL,
           clickup_list_id = NULL
       WHERE router_id = $1
       RETURNING *`,
      [routerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Router not found' });
    }

    logger.info('Unlinked router from ClickUp task', { routerId });

    res.json({
      success: true,
      router: result.rows[0]
    });
  } catch (error) {
    logger.error('Error unlinking router:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/router-task/:routerId
 * Get ClickUp task details for a router
 */
router.get('/router-task/:routerId', async (req, res) => {
  try {
    const { routerId } = req.params;

    const result = await pool.query(
      'SELECT clickup_task_id, clickup_task_url FROM routers WHERE router_id = $1',
      [routerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const routerRow = result.rows[0];
    if (!routerRow.clickup_task_id) {
      return res.json({ linked: false });
    }

    const task = await clickupClient.getTask(routerRow.clickup_task_id, 'default');

    res.json({
      linked: true,
      task: {
        id: task.id,
        name: task.name,
        status: task.status?.status,
        priority: task.priority,
        due_date: task.due_date,
        assignees: task.assignees?.map(a => ({ id: a.id, username: a.username, email: a.email })),
        url: routerRow.clickup_task_url || task.url
      }
    });
  } catch (error) {
    logger.error('Error getting router task:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/properties/search
 * Search for properties across all spaces (for mobile app)
 */
router.get('/properties/search', async (req, res) => {
  try {
    const { query = '' } = req.query;

    logger.info('Property search request:', { query });

    if (!query || query.length < 2) {
      return res.json({ properties: [] });
    }

    let workspaces;
    try {
      workspaces = await clickupClient.getWorkspaces('default');
      logger.info('Got workspaces:', { count: workspaces?.length });
    } catch (error) {
      logger.error('Failed to get ClickUp workspaces:', { error: error.message, stack: error.stack });
      return res.status(500).json({
        error: 'Failed to connect to ClickUp',
        message: error.message,
        hint: 'Check if ClickUp OAuth token is valid at /api/clickup/auth/status'
      });
    }

    if (!workspaces || workspaces.length === 0) {
      logger.warn('No ClickUp workspaces found');
      return res.status(400).json({ error: 'No ClickUp workspace configured' });
    }

    const workspaceId = workspaces[0].id;
    logger.info('Searching in workspace:', { workspaceId, query });

    const tasks = await clickupClient.searchAllTasks(workspaceId, query, 'default');
    logger.info('Search results:', { taskCount: tasks?.length });

    const propertyListNames = ['properties', 'locations', 'addresses', 'lettings'];

    const properties = tasks
      .filter(task => {
        const name = (task.name || '').toLowerCase();
        const listName = (task.list?.name || '').toLowerCase();

        const isInPropertyList = propertyListNames.some(propList => listName.includes(propList));
        const hasAddressKeywords = name.includes('flat') || name.includes('street') ||
          name.includes('avenue') || name.includes('road') ||
          name.includes('#') || name.includes('apt') ||
          name.includes('unit') || name.includes('property');

        const hasAddressField = task.custom_fields?.some(f =>
          f.name?.toLowerCase().includes('address') ||
          f.name?.toLowerCase().includes('postcode') ||
          f.name?.toLowerCase().includes('property')
        );

        return isInPropertyList || hasAddressKeywords || hasAddressField;
      })
      .map(task => ({
        id: task.id,
        name: task.name,
        status: task.status?.status,
        url: task.url,
        list_id: task.list?.id,
        list_name: task.list?.name
      }));

    res.json({
      properties,
      count: properties.length
    });
  } catch (error) {
    logger.error('Error searching properties:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/properties/:listId
 * Search for property tasks in a list
 */
router.get('/properties/:listId', async (req, res) => {
  try {
    const { listId } = req.params;
    const { search = '' } = req.query;

    const propertyTasks = await clickupClient.searchPropertyTasks(listId, search, 'default');

    const properties = propertyTasks.map(task => ({
      id: task.id,
      name: task.name,
      status: task.status?.status,
      url: task.url,
      description: task.description,
      tags: task.tags?.map(t => t.name),
      list_name: task.list_name,
      list_id: task.list_id,
      custom_fields: task.custom_fields
    }));

    res.json({
      properties,
      count: properties.length
    });
  } catch (error) {
    logger.error('Error searching property tasks:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/search-tasks/:workspaceId
 * Search tasks across entire workspace
 */
router.get('/search-tasks/:workspaceId', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { search = '' } = req.query;

    const tasks = await clickupClient.searchAllTasks(workspaceId, search, 'default');

    const formattedTasks = tasks.map(task => ({
      id: task.id,
      name: task.name,
      status: task.status?.status,
      url: task.url,
      description: task.description,
      tags: task.tags?.map(t => t.name) || [],
      list: task.list ? { id: task.list.id, name: task.list.name } : null,
      space: task.space ? { id: task.space.id, name: task.space.name } : null,
      folder: task.folder ? { id: task.folder.id, name: task.folder.name } : null
    }));

    res.json({
      tasks: formattedTasks,
      count: formattedTasks.length
    });
  } catch (error) {
    logger.error('Error searching tasks:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/list/:listId
 * Get full list details including dates
 */
router.get('/list/:listId', async (req, res) => {
  try {
    const { listId } = req.params;
    const list = await clickupClient.getList(listId, 'default');
    res.json({ list });
  } catch (error) {
    logger.error('Error getting list details:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/custom-fields/:listId
 * Get custom fields configuration for a list
 */
router.get('/custom-fields/:listId', async (req, res) => {
  try {
    const { listId } = req.params;
    const fields = await clickupClient.getCustomFields(listId, 'default');
    res.json({ fields });
  } catch (error) {
    logger.error('Error getting custom fields:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/sync/stats
 * Get ClickUp sync statistics
 * Note: Must be before /sync/:routerId to avoid matching "stats" as a router ID
 */
router.get('/sync/stats', (req, res) => {
  try {
    const stats = getSyncStats();
    res.json(stats);
  } catch (error) {
    logger.error('Error getting sync stats:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/clickup/sync
 * Manually trigger ClickUp sync for all routers
 */
router.post('/sync', async (req, res) => {
  try {
    logger.info('Manual ClickUp sync triggered (FORCE MODE)');

    syncAllRoutersToClickUp(true).catch(err => {
      logger.error('Error during background ClickUp sync:', sanitizeError(err));
    });

    res.json({
      success: true,
      message: 'Sync started in background',
      status: 'running'
    });
  } catch (error) {
    logger.error('Error triggering ClickUp sync:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/clickup/sync/assignees
 * Sync assignees from ClickUp to local database
 */
router.post('/sync/assignees', async (req, res) => {
  try {
    logger.info('Manual ClickUp assignee sync triggered');
    const result = await syncAssigneesFromClickUp();
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Error during assignee sync:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/clickup/sync/mac-addresses
 * Sync MAC addresses FROM ClickUp TO local database
 */
router.post('/sync/mac-addresses', async (req, res) => {
  try {
    logger.info('Manual ClickUp MAC address sync triggered');
    const { syncMacAddressesFromClickUp } = require('../../services/clickupSync');
    const result = await syncMacAddressesFromClickUp();
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Error during MAC address sync:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/clickup/sync/:routerId
 * Manually sync a single router to ClickUp (for debugging, but operationally useful)
 */
router.post('/sync/:routerId', async (req, res) => {
  try {
    const { routerId } = req.params;
    const { syncRouterToClickUp } = require('../../services/clickupSync');

    // Get router data
    const result = await pool.query(
      `SELECT
         r.router_id,
         r.clickup_task_id,
         r.imei,
         r.firmware_version,
         r.last_seen,
         r.name,
         (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as current_status
       FROM routers r
       WHERE r.router_id = $1`,
      [routerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Router not found' });
    }

    const routerRow = result.rows[0];
    logger.info(`Syncing single router ${routerId}:`, routerRow);

    const syncResult = await syncRouterToClickUp(routerRow);

    res.json({
      success: syncResult.success,
      router: {
        id: routerRow.router_id,
        name: routerRow.name,
        current_status: routerRow.current_status,
        clickup_task_id: routerRow.clickup_task_id
      },
      result: syncResult
    });
  } catch (error) {
    logger.error('Error syncing single router:', sanitizeError(error));
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

/**
 * GET /api/clickup/settings/smart-sync
 * Get the smart sync setting
 */
router.get('/settings/smart-sync', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT value FROM settings WHERE key = $1',
      ['smart_sync_enabled']
    );

    const enabled = result.rows.length > 0 ? result.rows[0].value === 'true' : true;
    res.json({ enabled });
  } catch (error) {
    logger.error('Error getting smart sync setting:', sanitizeError(error));
    res.status(500).json({ error: 'Failed to get smart sync setting' });
  }
});

/**
 * PUT /api/clickup/settings/smart-sync
 * Update the smart sync setting
 */
router.put('/settings/smart-sync', async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    await pool.query(
      `INSERT INTO settings (key, value, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      ['smart_sync_enabled', enabled.toString(), 'Enable smart sync to skip ClickUp updates for routers that haven\'t changed']
    );

    logger.info(`Smart sync setting updated to: ${enabled}`);
    res.json({ enabled });
  } catch (error) {
    logger.error('Error updating smart sync setting:', sanitizeError(error));
    res.status(500).json({ error: 'Failed to update smart sync setting' });
  }
});

/**
 * POST /api/clickup/create-missing-tasks
 * Create ClickUp tasks for all routers that don't have one
 * Useful for initial setup or after adding multiple routers
 */
router.post('/create-missing-tasks', async (req, res) => {
  try {
    logger.info('Manual create missing ClickUp tasks triggered');
    
    // Check if CLICKUP_ROUTERS_LIST_ID is configured
    if (!process.env.CLICKUP_ROUTERS_LIST_ID) {
      return res.status(400).json({
        error: 'CLICKUP_ROUTERS_LIST_ID not configured',
        message: 'Set the CLICKUP_ROUTERS_LIST_ID environment variable to the ID of your "Routers" list in ClickUp',
        hint: 'Find the list ID by opening the list in ClickUp and copying from the URL'
      });
    }
    
    const { createMissingClickUpTasks } = require('../../services/clickupSync');
    const result = await createMissingClickUpTasks();
    
    res.json({
      success: true,
      message: `Created ${result.created} ClickUp tasks`,
      ...result
    });
  } catch (error) {
    logger.error('Error creating missing tasks:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/clickup/create-task/:routerId
 * Create a ClickUp task for a specific router (if it doesn't have one)
 */
router.post('/create-task/:routerId', async (req, res) => {
  try {
    const { routerId } = req.params;
    
    // Check if CLICKUP_ROUTERS_LIST_ID is configured
    if (!process.env.CLICKUP_ROUTERS_LIST_ID) {
      return res.status(400).json({
        error: 'CLICKUP_ROUTERS_LIST_ID not configured',
        message: 'Set the CLICKUP_ROUTERS_LIST_ID environment variable'
      });
    }
    
    // Get router data
    const routerResult = await pool.query(
      `SELECT 
        r.router_id,
        r.name,
        r.imei,
        r.firmware_version,
        r.last_seen,
        r.mac_address,
        r.current_status,
        r.clickup_task_id,
        (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as latest_status
      FROM routers r
      WHERE r.router_id = $1`,
      [routerId]
    );
    
    if (routerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Router not found' });
    }
    
    const router = routerResult.rows[0];
    
    if (router.clickup_task_id) {
      return res.status(400).json({
        error: 'Router already has a ClickUp task',
        clickup_task_id: router.clickup_task_id
      });
    }
    
    const { autoCreateClickUpTask } = require('../../services/clickupSync');
    const routerWithStatus = {
      ...router,
      current_status: router.current_status || router.latest_status || 'offline'
    };
    
    const task = await autoCreateClickUpTask(routerWithStatus);
    
    if (!task) {
      return res.status(500).json({ error: 'Failed to create ClickUp task' });
    }
    
    logger.info(`Created ClickUp task ${task.id} for router ${routerId}`);
    
    res.json({
      success: true,
      message: 'ClickUp task created',
      task: {
        id: task.id,
        name: task.name,
        url: task.url
      },
      router_id: routerId
    });
  } catch (error) {
    logger.error(`Error creating task for router ${req.params.routerId}:`, sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/auto-create-status
 * Get the status of auto-create functionality
 */
router.get('/auto-create-status', async (req, res) => {
  try {
    const autoCreateEnabled = process.env.CLICKUP_AUTO_CREATE_TASKS !== 'false';
    const routersListId = process.env.CLICKUP_ROUTERS_LIST_ID;
    
    // Count routers without tasks
    const countResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM routers
      WHERE clickup_task_id IS NULL
        AND (clickup_task_status IS NULL OR LOWER(clickup_task_status) NOT IN ('decommissioned'))
    `);
    
    const routersWithoutTasks = parseInt(countResult.rows[0].count);
    
    res.json({
      autoCreateEnabled,
      routersListConfigured: !!routersListId,
      routersListId: routersListId || null,
      routersWithoutTasks,
      status: autoCreateEnabled && routersListId 
        ? 'ready' 
        : autoCreateEnabled && !routersListId 
          ? 'missing_list_id'
          : 'disabled'
    });
  } catch (error) {
    logger.error('Error getting auto-create status:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


