/**
 * ClickUp Debug Routes
 * Gated behind ENABLE_DEBUG_ENDPOINTS=true
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../session');
const clickupClient = require('../../services/clickupClient');
const logger = require('../../config/database').logger;
const { sanitizeError } = require('../../utils/errorLogger');

// Require admin AND debug flag
router.use(requireAdmin);
router.use((req, res, next) => {
  if (process.env.ENABLE_DEBUG_ENDPOINTS === 'true') return next();
  return res.status(404).json({ error: 'Not found' });
});

/**
 * GET /api/clickup/debug/space-lists/:spaceId
 * Debug endpoint to check what lists are in a space
 * Includes rate limiting protection with retries and delays
 */
router.get('/debug/space-lists/:spaceId', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const client = await clickupClient.getAuthorizedClient('default');

    // Helper function to retry API calls with backoff
    const retryWithBackoff = async (fn, operation, maxRetries = 3) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await fn();
        } catch (error) {
          const isRateLimited = error.response?.status === 429;
          const isLastAttempt = attempt === maxRetries;

          if (isRateLimited && !isLastAttempt) {
            const retryAfter = error.response?.headers?.['retry-after'];
            const backoffDelay = retryAfter
              ? parseInt(retryAfter) * 1000
              : Math.min(1000 * Math.pow(2, attempt), 60000);

            logger.warn(
              `Rate limited on ${operation}, retrying in ${backoffDelay}ms (attempt ${attempt}/${maxRetries})`
            );
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
          } else {
            throw error;
          }
        }
      }
    };

    // Get space details with retry
    const spaceResponse = await retryWithBackoff(
      () => client.get(`/space/${spaceId}`),
      `getSpace(${spaceId})`
    );
    const space = spaceResponse.data;

    // Get lists (folderless) with retry
    const listsResponse = await retryWithBackoff(
      () => client.get(`/space/${spaceId}/list`, { params: { archived: false } }),
      `getSpaceLists(${spaceId})`
    );
    const lists = listsResponse.data.lists || [];

    // Get folders with retry
    const foldersResponse = await retryWithBackoff(
      () => client.get(`/space/${spaceId}/folder`, { params: { archived: false } }),
      `getSpaceFolders(${spaceId})`
    );
    const folders = foldersResponse.data.folders || [];

    // Get lists from each folder with retry and delays to prevent rate limiting
    const folderLists = [];
    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];

      // Add delay between requests (except for first one)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      try {
        const folderListsResponse = await retryWithBackoff(
          () => client.get(`/folder/${folder.id}/list`, { params: { archived: false } }),
          `getFolderLists(${folder.id})`
        );
        const fLists = folderListsResponse.data.lists || [];
        folderLists.push({
          folder: { id: folder.id, name: folder.name },
          lists: fLists.map(l => ({ id: l.id, name: l.name, task_count: l.task_count }))
        });
      } catch (error) {
        if (error.response?.status === 429) {
          logger.error(`Rate limit reached while fetching folder ${folder.id}. Returning partial results.`);
          res.status(429).json({
            error: 'Rate limit reached',
            message: 'ClickUp API rate limit exceeded. Please try again later.',
            partial: true,
            space: { id: space.id, name: space.name },
            folderlessLists: lists.map(l => ({ id: l.id, name: l.name, task_count: l.task_count })),
            folders: folderLists,
            failedAtFolder: folder.name,
            retryAfter: error.response?.headers?.['retry-after'] || 60
          });
          return;
        }
        logger.warn(`Error fetching lists for folder ${folder.id}:`, error.message);
      }
    }

    res.json({
      space: { id: space.id, name: space.name },
      folderlessLists: lists.map(l => ({ id: l.id, name: l.name, task_count: l.task_count })),
      folders: folderLists,
      summary: {
        folderlessListCount: lists.length,
        folderCount: folders.length,
        totalListsInFolders: folderLists.reduce((sum, f) => sum + f.lists.length, 0)
      }
    });
  } catch (error) {
    if (error.response?.status === 429) {
      const retryAfter = error.response?.headers?.['retry-after'] || 60;
      logger.error('Rate limit reached getting space structure:', {
        spaceId: req.params.spaceId,
        retryAfter,
        error: error.response?.data
      });
      res.status(429).json({
        error: 'Rate limit reached',
        message: 'ClickUp API rate limit exceeded. Please try again later.',
        retryAfter: parseInt(retryAfter)
      });
      return;
    }

    logger.error('Error getting space structure:', sanitizeError(error));
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

/**
 * GET /api/clickup/debug/task/:taskId
 * Get full task details including custom fields for debugging
 */
router.get('/debug/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await clickupClient.getTask(taskId, 'default');

    if (req.query.raw === 'true') {
      return res.json(task);
    }

    const opStatus = task.custom_fields?.find(f => f.name === 'Operational Status');

    return res.json({
      taskId: task.id,
      name: task.name,
      operationalStatus: opStatus,
      allCustomFields: task.custom_fields
    });
  } catch (error) {
    logger.error('Error getting task details:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/debug/custom-fields/:taskId
 * Debug endpoint to inspect all custom fields of a task
 */
router.get('/debug/custom-fields/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await clickupClient.getTask(taskId, 'default');

    const fieldsInfo = task.custom_fields?.map(field => ({
      id: field.id,
      name: field.name,
      type: field.type,
      type_config: field.type_config,
      value: field.value,
      value_type: typeof field.value
    })) || [];

    const dataUsageField = task.custom_fields?.find(
      f => f.id === 'c58206db-e995-4717-8e62-d36e15d0a3e2'
    );

    res.json({
      taskId: task.id,
      taskName: task.name,
      totalCustomFields: fieldsInfo.length,
      dataUsageField: dataUsageField || 'NOT FOUND',
      allFields: fieldsInfo
    });
  } catch (error) {
    logger.error('Error inspecting custom fields:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/debug/list-tasks/:listId
 * Explore tasks (properties) within a list (location)
 * This shows the ClickUp hierarchy: List -> Tasks
 */
router.get('/debug/list-tasks/:listId', async (req, res) => {
  try {
    const { listId } = req.params;
    const client = await clickupClient.getAuthorizedClient('default');

    // First get the list info
    const listRes = await client.get(`/list/${listId}`);
    const list = listRes.data;

    // Get tasks within this list
    const tasksRes = await client.get(`/list/${listId}/task`, {
      params: { archived: false, page: 0 }
    });
    const tasks = tasksRes.data.tasks || [];

    res.json({
      list: {
        id: list.id,
        name: list.name,
        task_count: list.task_count,
        folder: list.folder,
        space: list.space
      },
      tasks: tasks.map(t => ({
        id: t.id,
        name: t.name,
        status: t.status?.status,
        url: t.url,
        custom_fields_count: t.custom_fields?.length || 0
      })),
      first_task_full: tasks[0] || null
    });
  } catch (error) {
    logger.error('Error getting list tasks:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/clickup/debug/explore-hierarchy
 * Full exploration of ClickUp hierarchy for first space with tasks
 */
router.get('/debug/explore-hierarchy', async (req, res) => {
  try {
    const client = await clickupClient.getAuthorizedClient('default');

    // Get workspaces
    const workspacesRes = await client.get('/team');
    const workspaceId = workspacesRes.data.teams[0].id;

    // Get spaces
    const spacesRes = await client.get(`/team/${workspaceId}/space`);
    const spaces = spacesRes.data.spaces;

    // Find Active Accounts or first space
    const activeSpace = spaces.find(s => s.name.includes('Active')) || spaces[0];

    // Get folderless lists
    const listsRes = await client.get(`/space/${activeSpace.id}/list`, { params: { archived: false } });
    const allLists = listsRes.data.lists;

    // Find a list with tasks
    const listWithTasks = allLists.find(l => l.task_count > 0);
    let tasksPreview = null;

    if (listWithTasks) {
      const tasksRes = await client.get(`/list/${listWithTasks.id}/task`, {
        params: { archived: false, page: 0 }
      });
      const tasks = tasksRes.data.tasks || [];
      tasksPreview = {
        list_name: listWithTasks.name,
        list_id: listWithTasks.id,
        task_count: tasks.length,
        tasks: tasks.slice(0, 5).map(t => ({
          id: t.id,
          name: t.name,
          status: t.status?.status,
          url: t.url
        })),
        first_task_full: tasks[0] || null
      };
    }

    res.json({
      workspace_id: workspaceId,
      space: { id: activeSpace.id, name: activeSpace.name },
      lists_count: allLists.length,
      first_5_lists: allLists.slice(0, 5).map(l => ({
        id: l.id,
        name: l.name,
        task_count: l.task_count
      })),
      tasks_preview: tasksPreview
    });
  } catch (error) {
    logger.error('Error exploring hierarchy:', sanitizeError(error));
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;



