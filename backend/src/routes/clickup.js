/**
 * ClickUp Integration Routes
 * Handles OAuth flow and ClickUp API operations
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const clickupOAuthService = require('../services/clickupOAuthService');
const clickupClient = require('../services/clickupClient');
const { pool } = require('../config/database');
const logger = require('../config/database').logger;

// Store OAuth states temporarily (in production, use Redis)
const oauthStates = new Map();

/**
 * GET /api/clickup/auth/status
 * Check if user has authorized ClickUp
 */
router.get('/auth/status', async (req, res) => {
  try {
    const hasToken = await clickupOAuthService.hasValidToken('default');
    
    let workspaceInfo = null;
    if (hasToken) {
      const result = await pool.query(
        'SELECT workspace_id, workspace_name, created_at FROM clickup_oauth_tokens WHERE user_id = $1',
        ['default']
      );
      workspaceInfo = result.rows[0] || null;
    }

    res.json({
      authorized: hasToken,
      workspace: workspaceInfo
    });
  } catch (error) {
    logger.error('Error checking ClickUp auth status:', error);
    res.status(500).json({ error: 'Failed to check authorization status' });
  }
});

/**
 * GET /api/clickup/auth/url
 * Get OAuth authorization URL
 */
router.get('/auth/url', (req, res) => {
  try {
    // Generate random state for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');
    
    // Store state with expiration (5 minutes)
    oauthStates.set(state, {
      created: Date.now(),
      expires: Date.now() + 5 * 60 * 1000
    });

    const authUrl = clickupOAuthService.getAuthorizationUrl(state);
    
    res.json({ 
      authUrl,
      state 
    });
  } catch (error) {
    logger.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

/**
 * GET /api/clickup/auth/callback
 * OAuth callback endpoint
 */
router.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  try {
    // Verify state parameter
    const storedState = oauthStates.get(state);
    if (!storedState || Date.now() > storedState.expires) {
      return res.status(400).json({ error: 'Invalid or expired state parameter' });
    }
    
    // Clean up used state
    oauthStates.delete(state);

    if (!code) {
      return res.status(400).json({ error: 'Authorization code not provided' });
    }

    // Exchange code for token
    const tokenData = await clickupOAuthService.exchangeCodeForToken(code);
    
    // Get workspace info
    const client = await axios.create({
      baseURL: 'https://api.clickup.com/api/v2',
      headers: {
        'Authorization': tokenData.access_token
      }
    });
    
    const workspacesResponse = await client.get('/team');
    const workspace = workspacesResponse.data.teams?.[0]; // Get first workspace

    // Store token
    await clickupOAuthService.storeToken('default', tokenData.access_token, {
      workspace_id: workspace?.id,
      workspace_name: workspace?.name
    });

    logger.info('ClickUp OAuth authorization successful', { 
      workspace: workspace?.name 
    });

    res.json({ 
      success: true,
      workspace: {
        id: workspace?.id,
        name: workspace?.name
      }
    });
  } catch (error) {
    logger.error('Error in OAuth callback:', error);
    res.status(500).json({ error: 'Authorization failed' });
  }
});

/**
 * POST /api/clickup/auth/disconnect
 * Disconnect ClickUp integration
 */
router.post('/auth/disconnect', async (req, res) => {
  try {
    await clickupOAuthService.deleteToken('default');
    logger.info('ClickUp disconnected');
    res.json({ success: true });
  } catch (error) {
    logger.error('Error disconnecting ClickUp:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
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
    logger.error('Error getting workspaces:', error);
    res.status(error.message.includes('No ClickUp token') ? 401 : 500)
      .json({ error: error.message });
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
    logger.error('Error getting spaces:', error);
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
    logger.error('Error getting Routers list:', error);
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
      filteredTasks = tasks.filter(task => 
        task.name.toLowerCase().includes(searchLower)
      );
    }

    res.json({ tasks: filteredTasks });
  } catch (error) {
    logger.error('Error getting tasks:', error);
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

    if (!taskData.name) {
      return res.status(400).json({ error: 'Task name is required' });
    }

    // Pass all task data through to ClickUp (including custom_fields)
    const task = await clickupClient.createTask(listId, taskData, 'default');
    
    logger.info('Created ClickUp task', { taskId: task.id, name: taskData.name });

    res.json({ task });
  } catch (error) {
    logger.error('Error creating task:', error);
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
    logger.error('Error updating task:', error);
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
    logger.error('Error linking router to task:', error);
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
    logger.error('Error resetting ClickUp links:', error);
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
    logger.error('Error unlinking router:', error);
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

    const router = result.rows[0];
    
    if (!router.clickup_task_id) {
      return res.json({ linked: false });
    }

    // Get fresh task data from ClickUp
    const task = await clickupClient.getTask(router.clickup_task_id, 'default');

    res.json({
      linked: true,
      task: {
        id: task.id,
        name: task.name,
        status: task.status?.status,
        priority: task.priority,
        due_date: task.due_date,
        assignees: task.assignees?.map(a => ({ id: a.id, username: a.username, email: a.email })),
        url: router.clickup_task_url || task.url
      }
    });
  } catch (error) {
    logger.error('Error getting router task:', error);
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

    // Format for easy consumption
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
    logger.error('Error searching property tasks:', error);
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

    // Format for easy consumption
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
    logger.error('Error searching tasks:', error);
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
    logger.error('Error getting custom fields:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clean up expired OAuth states periodically
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStates.entries()) {
    if (now > data.expires) {
      oauthStates.delete(state);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

module.exports = router;
