/**
 * ClickUp API Client
 * Handles all interactions with the ClickUp API
 */

const axios = require('axios');
const FormData = require('form-data');
const clickupOAuthService = require('./clickupOAuthService');
const logger = require('../config/database').logger;
const { trackClickUpCall } = require('../routes/monitoring');

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

/**
 * Retry function with exponential backoff for rate limiting
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {string} operation - Description of operation for logging
 * @returns {Promise<any>} Result of the function
 */
async function retryWithBackoff(fn, maxRetries = 3, operation = 'API call') {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimited = error.response?.status === 429;
      const isLastAttempt = attempt === maxRetries;
      
      if (isRateLimited && !isLastAttempt) {
        // Get retry-after from header or use exponential backoff
        const retryAfter = error.response?.headers?.['retry-after'];
        const backoffDelay = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(1000 * Math.pow(2, attempt), 60000);
        
        logger.warn(`Rate limited on ${operation}, retrying in ${backoffDelay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      } else {
        // Not rate limited, or last attempt - throw error
        throw error;
      }
    }
  }
}

class ClickUpClient {
  /**
   * Get axios instance with authorization header
   * @param {string} userId - User identifier for token lookup
   * @returns {Promise<axios.AxiosInstance>}
   */
  async getAuthorizedClient(userId = 'default') {
    const token = await clickupOAuthService.getToken(userId);
    
    if (!token) {
      throw new Error('No ClickUp token found. Please authorize the application.');
    }

    const client = axios.create({
      baseURL: CLICKUP_API_BASE,
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    // Add response interceptor to handle auth errors
    client.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status === 401) {
          logger.error('ClickUp token is invalid or expired - please re-authorize');
          error.message = 'ClickUp authentication expired. Please reconnect ClickUp.';
        } else if (error.code === 'ECONNABORTED') {
          logger.error('ClickUp API request timed out', { url: error.config?.url });
          error.message = 'ClickUp API request timed out. Please try again.';
        }
        throw error;
      }
    );

    return client;
  }

  /**
   * Get authorized workspaces (teams)
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} List of authorized workspaces
   */
  async getWorkspaces(userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      const response = await client.get('/team');
      
      logger.info('Retrieved ClickUp workspaces', { count: response.data.teams?.length });
      return response.data.teams || [];
    } catch (error) {
      logger.error('Error getting ClickUp workspaces:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get workspace/team members
   * @param {string} workspaceId - Workspace/Team ID
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} List of workspace members
   */
  async getWorkspaceMembers(workspaceId, userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      const response = await client.get(`/team/${workspaceId}`);
      
      const members = response.data.team?.members || [];
      logger.info('Retrieved workspace members', { workspaceId, count: members.length });
      return members;
    } catch (error) {
      logger.error('Error getting workspace members:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get spaces in a workspace
   * @param {string} workspaceId - Workspace/Team ID
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} List of spaces
   */
  async getSpaces(workspaceId, userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      const response = await client.get(`/team/${workspaceId}/space`, {
        params: { archived: false }
      });
      
      logger.info('Retrieved ClickUp spaces', { workspaceId, count: response.data.spaces?.length });
      return response.data.spaces || [];
    } catch (error) {
      logger.error('Error getting ClickUp spaces:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get lists in a space
   * @param {string} spaceId - Space ID
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} List of lists
   */
  async getLists(spaceId, userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      const response = await client.get(`/space/${spaceId}/list`, {
        params: { archived: false }
      });
      
      logger.info('Retrieved ClickUp lists', { spaceId, count: response.data.lists?.length });
      return response.data.lists || [];
    } catch (error) {
      logger.error('Error getting ClickUp lists:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get full list details including dates
   * @param {string} listId - List ID
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} List details
   */
  async getList(listId, userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      const response = await client.get(`/list/${listId}`);
      
      logger.info('Retrieved ClickUp list details', { listId, name: response.data.name });
      return response.data;
    } catch (error) {
      logger.error('Error getting ClickUp list details:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Find a list by name across all spaces in a workspace
   * @param {string} workspaceId - Workspace ID
   * @param {string} listName - List name to search for
   * @param {string} userId - User identifier
   * @returns {Promise<Object|null>} List object or null if not found
   */
  async findListByName(workspaceId, listName, userId = 'default') {
    try {
      const spaces = await this.getSpaces(workspaceId, userId);
      
      for (const space of spaces) {
        const lists = await this.getLists(space.id, userId);
        const foundList = lists.find(list => list.name === listName);
        if (foundList) {
          logger.info('Found ClickUp list', { listName, listId: foundList.id });
          return foundList;
        }
      }
      
      logger.warn('ClickUp list not found', { listName, workspaceId });
      return null;
    } catch (error) {
      logger.error('Error finding ClickUp list:', error.message);
      throw error;
    }
  }

  /**
   * Get custom field value from a list
   * @param {string} listId - List ID
   * @param {string} fieldId - Custom field ID (e.g., "9f31c21a-630d-49f2-8a79-354de03e24d1" for Date Installed)
   * @param {string} userId - User identifier
   * @returns {Promise<any>} Custom field value or null
   */
  async getListCustomFieldValue(listId, fieldId, userId = 'default') {
    try {
      // Get the first task in the list to retrieve custom field values
      const tasks = await this.getTasks(listId, { page: 0, limit: 1 }, userId);
      
      if (!tasks || tasks.length === 0) {
        logger.warn('No tasks found in list', { listId });
        return null;
      }
      
      const task = tasks[0];
      const customField = task.custom_fields?.find(field => field.id === fieldId);
      
      if (!customField) {
        logger.warn('Custom field not found in task', { listId, fieldId, taskId: task.id });
        return null;
      }
      
      // Return the value - for date fields, this is typically in milliseconds timestamp
      return customField.value || null;
    } catch (error) {
      logger.error('Error getting custom field value:', error.message);
      return null;
    }
  }  /**
   * Get tasks from a list
   * @param {string} listId - List ID
   * @param {Object} options - Query options (page, archived, etc.)
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} List of tasks
   */
  async getTasks(listId, options = {}, userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      const response = await client.get(`/list/${listId}/task`, {
        params: {
          archived: false,
          page: 0,
          ...options
        }
      });
      
      logger.info('Retrieved ClickUp tasks', { listId, count: response.data.tasks?.length });
      return response.data.tasks || [];
    } catch (error) {
      logger.error('Error getting ClickUp tasks:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get a specific task by ID
   * @param {string} taskId - Task ID
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Task object
   */
  async getTask(taskId, userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      const response = await client.get(`/task/${taskId}`);
      
      trackClickUpCall('getTask', response.status);
      logger.info('Retrieved ClickUp task', { taskId });
      return response.data;
    } catch (error) {
      trackClickUpCall('getTask', error.response?.status || 500);
      logger.error('Error getting ClickUp task:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create a new task
   * @param {string} listId - List ID where task will be created
   * @param {Object} taskData - Task data (name, description, assignees, etc.)
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Created task
   */
  async createTask(listId, taskData, userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      
      // Debug log the task data being sent
      logger.info('Creating ClickUp task with data:', { 
        listId, 
        taskName: taskData.name,
        hasCustomFields: !!taskData.custom_fields,
        customFieldsCount: taskData.custom_fields?.length || 0,
        customFields: taskData.custom_fields
      });
      
      const response = await client.post(`/list/${listId}/task`, taskData);
      
      trackClickUpCall('createTask', response.status);
      logger.info('Created ClickUp task', { listId, taskId: response.data.id });
      return response.data;
    } catch (error) {
      trackClickUpCall('createTask', error.response?.status || 500);
      logger.error('Error creating ClickUp task:', error.response?.data || error.message);
      // Re-throw with ClickUp's actual error message
      if (error.response?.data) {
        const clickupError = new Error(error.response.data.err || error.response.data.error || 'ClickUp API error');
        clickupError.clickupData = error.response.data;
        clickupError.status = error.response.status;
        throw clickupError;
      }
      throw error;
    }
  }

  /**
   * Update a task
   * @param {string} taskId - Task ID to update
   * @param {Object} updates - Fields to update
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Updated task
   */
  async updateTask(taskId, updates, userId = 'default') {
    let attempt = 0;
    return retryWithBackoff(async () => {
      const isRetry = attempt > 0;
      attempt++;
      
      try {
        const client = await this.getAuthorizedClient(userId);
        
        // Log detailed request info
        logger.info('ClickUp updateTask request:', {
          taskId,
          updateKeys: Object.keys(updates),
          hasCustomFields: !!updates.custom_fields,
          customFieldsCount: updates.custom_fields?.length || 0,
          customFields: updates.custom_fields
        });
        
        const response = await client.put(`/task/${taskId}`, updates);
        
        trackClickUpCall('updateTask', response.status, isRetry);
        
        // Log response
        logger.info('ClickUp updateTask response:', {
          taskId,
          status: response.status,
          statusText: response.statusText,
          hasData: !!response.data
        });
        
        return response.data;
      } catch (error) {
        trackClickUpCall('updateTask', error.response?.status || 500, isRetry);
        logger.error('Error updating ClickUp task:', {
          taskId,
          status: error.response?.status,
          statusText: error.response?.statusText,
          errorData: error.response?.data,
          message: error.message
        });
        throw error;
      }
    }, 3, `updateTask(${taskId})`);
  }

  /**
   * Update task assignees
   * @param {string} taskId - Task ID
   * @param {Object} options - Assignee options
   * @param {Array<number>} options.add - User IDs to add as assignees
   * @param {Array<number>} options.rem - User IDs to remove as assignees
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Updated task
   */
  async updateTaskAssignees(taskId, { add = [], rem = [] }, userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      
      // Build assignees payload
      const payload = { assignees: {} };
      
      if (add.length > 0) {
        payload.assignees.add = add;
      }
      if (rem.length > 0) {
        payload.assignees.rem = rem;
      }
      
      logger.info('ClickUp updateTaskAssignees request:', {
        taskId,
        payloadStringified: JSON.stringify(payload),
        add,
        rem
      });
      
      const response = await client.put(`/task/${taskId}`, payload);
      
      logger.info('ClickUp updateTaskAssignees response:', {
        taskId,
        status: response.status,
        assignees: response.data.assignees?.map(a => a.username)
      });
      
      return response.data;
    } catch (error) {
      logger.error('Error updating task assignees:', {
        taskId,
        add,
        rem,
        status: error.response?.status,
        errorData: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }

  /**
   * Update a single custom field value
   * @param {string} taskId - Task ID
   * @param {string} fieldId - Custom field ID
   * @param {any} value - New value for the field
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Response
   */
  async updateCustomField(taskId, fieldId, value, userId = 'default') {
    let attempt = 0;
    return retryWithBackoff(async () => {
      const isRetry = attempt > 0;
      attempt++;
      
      try {
        const client = await this.getAuthorizedClient(userId);
        
        logger.info('ClickUp updateCustomField request:', {
          taskId,
          fieldId,
          value,
          valueType: typeof value
        });
        
        const response = await client.post(`/task/${taskId}/field/${fieldId}`, { value });
        
        trackClickUpCall('updateCustomField', response.status, isRetry);
        
        logger.info('ClickUp updateCustomField response:', {
          taskId,
          fieldId,
          status: response.status,
          hasData: !!response.data
        });
        
        return response.data;
      } catch (error) {
        trackClickUpCall('updateCustomField', error.response?.status || 500, isRetry);
        logger.error('Error updating custom field:', {
          taskId,
          fieldId,
          value,
          status: error.response?.status,
          errorData: error.response?.data,
          message: error.message
        });
        throw error;
      }
    }, 3, `updateCustomField(${taskId}, ${fieldId})`);
  }

  /**
   * Create a comment on a task
   * @param {string} taskId - Task ID
   * @param {string} commentText - Comment text
   * @param {Object} options - Additional options
   * @param {boolean} options.notifyAll - Notify all task members (default: false)
   * @param {number} options.assignee - ClickUp user ID to assign the comment to
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Created comment
   */
  async createTaskComment(taskId, commentText, options = {}, userId = 'default') {
    let attempt = 0;
    return retryWithBackoff(async () => {
      const isRetry = attempt > 0;
      attempt++;
      
      try {
        const client = await this.getAuthorizedClient(userId);
        
        const payload = {
          comment_text: commentText,
          notify_all: options.notifyAll || false
        };
        
        if (options.assignee) {
          payload.assignee = options.assignee;
        }
        
        logger.info('ClickUp createTaskComment request:', {
          taskId,
          commentLength: commentText.length,
          notifyAll: payload.notify_all,
          hasAssignee: !!options.assignee
        });
        
        const response = await client.post(`/task/${taskId}/comment`, payload);
        
        trackClickUpCall('createTaskComment', response.status, isRetry);
        
        logger.info('ClickUp createTaskComment response:', {
          taskId,
          commentId: response.data?.id,
          status: response.status
        });
        
        return response.data;
      } catch (error) {
        trackClickUpCall('createTaskComment', error.response?.status || 500, isRetry);
        logger.error('Error creating task comment:', {
          taskId,
          status: error.response?.status,
          errorData: error.response?.data,
          message: error.message
        });
        throw error;
      }
    }, 3, `createTaskComment(${taskId})`);
  }

  /**
   * Get comments from a task
   * @param {string} taskId - Task ID
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Task comments
   */
  async getTaskComments(taskId, userId = 'default') {
    let attempt = 0;
    return retryWithBackoff(async () => {
      const isRetry = attempt > 0;
      attempt++;
      
      try {
        const client = await this.getAuthorizedClient(userId);
        
        logger.info('ClickUp getTaskComments request:', { taskId });
        
        const response = await client.get(`/task/${taskId}/comment`);
        
        trackClickUpCall('getTaskComments', response.status, isRetry);
        
        logger.info('ClickUp getTaskComments response:', {
          taskId,
          commentCount: response.data?.comments?.length || 0,
          status: response.status
        });
        
        return response.data;
      } catch (error) {
        trackClickUpCall('getTaskComments', error.response?.status || 500, isRetry);
        logger.error('Error getting task comments:', {
          taskId,
          status: error.response?.status,
          errorData: error.response?.data,
          message: error.message
        });
        throw error;
      }
    }, 3, `getTaskComments(${taskId})`);
  }

  /**
   * Upload an attachment to a task
   * @param {string} taskId - Task ID
   * @param {Buffer} fileBuffer - File data as buffer
   * @param {string} filename - Name for the file
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Uploaded attachment info
   */
  async uploadTaskAttachment(taskId, fileBuffer, filename, userId = 'default') {
    let attempt = 0;
    return retryWithBackoff(async () => {
      const isRetry = attempt > 0;
      attempt++;
      
      try {
        const token = await clickupOAuthService.getToken(userId);
        if (!token) {
          throw new Error('No ClickUp token found. Please authorize the application.');
        }

        const form = new FormData();
        form.append('attachment', fileBuffer, {
          filename: filename,
          contentType: 'application/pdf'
        });

        logger.info('ClickUp uploadTaskAttachment request:', {
          taskId,
          filename,
          fileSize: fileBuffer.length
        });

        const response = await axios.post(
          `${CLICKUP_API_BASE}/task/${taskId}/attachment`,
          form,
          {
            headers: {
              'Authorization': token,
              ...form.getHeaders()
            },
            timeout: 30000 // 30 second timeout for file uploads
          }
        );

        trackClickUpCall('uploadTaskAttachment', response.status, isRetry);

        logger.info('ClickUp uploadTaskAttachment response:', {
          taskId,
          filename,
          attachmentId: response.data?.id,
          status: response.status
        });

        return response.data;
      } catch (error) {
        trackClickUpCall('uploadTaskAttachment', error.response?.status || 500, isRetry);
        logger.error('Error uploading task attachment:', {
          taskId,
          filename,
          status: error.response?.status,
          errorData: error.response?.data,
          message: error.message
        });
        throw error;
      }
    }, 3, `uploadTaskAttachment(${taskId})`);
  }

  /**
   * Create a comment with attachment on a task
   * First uploads the attachment, then creates a comment referencing it
   * @param {string} taskId - Task ID
   * @param {string} commentText - Comment text
   * @param {Buffer} fileBuffer - File data as buffer
   * @param {string} filename - Name for the file
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Result with attachment and comment info
   */
  async createCommentWithAttachment(taskId, commentText, fileBuffer, filename, userId = 'default') {
    try {
      // First upload the attachment
      const attachment = await this.uploadTaskAttachment(taskId, fileBuffer, filename, userId);
      
      // Then create a comment
      const comment = await this.createTaskComment(taskId, commentText, { notifyAll: false }, userId);
      
      logger.info('Created comment with attachment:', {
        taskId,
        attachmentId: attachment?.id,
        commentId: comment?.id
      });
      
      return { attachment, comment };
    } catch (error) {
      logger.error('Error creating comment with attachment:', {
        taskId,
        filename,
        message: error.message
      });
      throw error;
    }
  }

  /**
   * Search tasks across workspace
   * @param {string} workspaceId - Workspace ID
   * @param {Object} filters - Search filters
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} Matching tasks
```
  async searchTasks(workspaceId, filters = {}, userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      const response = await client.get(`/team/${workspaceId}/task`, {
        params: filters
      });
      
      logger.info('Searched ClickUp tasks', { workspaceId, count: response.data.tasks?.length });
      return response.data.tasks || [];
    } catch (error) {
      logger.error('Error searching ClickUp tasks:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Search for property lists (not tasks) across a space
   * In Active Accounts, each property is a LIST (e.g., "#70 | 56 Burleigh Street, Cambridge")
   * @param {string} spaceId - Space ID to search in
   * @param {string} searchQuery - Optional search query for list name
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} Property lists from the space
   */
  async searchPropertyTasks(spaceId, searchQuery = '', userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      
      // Get all folderless lists in the space
      const listsResponse = await client.get(`/space/${spaceId}/list`, {
        params: { archived: false }
      });
      
      let lists = listsResponse.data.lists || [];
      
      // Also get lists from folders
      const foldersResponse = await retryWithBackoff(
        () => client.get(`/space/${spaceId}/folder`, { params: { archived: false } }),
        `getSpaceFolders(${spaceId})`
      );
      const folders = foldersResponse.data.folders || [];
      
      // Get lists from each folder with delays to prevent rate limiting
      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        
        // Add delay between requests (except for first one)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay between folder requests
        }
        
        try {
          const folderListsResponse = await retryWithBackoff(
            () => client.get(`/folder/${folder.id}/list`, { params: { archived: false } }),
            `getFolderLists(${folder.id})`
          );
          const folderLists = folderListsResponse.data.lists || [];
          lists = lists.concat(folderLists.map(list => ({
            ...list,
            folder_name: folder.name,
            folder_id: folder.id
          })));
        } catch (error) {
          // If rate limited, stop processing and return partial results
          if (error.response?.status === 429) {
            logger.error(`Rate limit reached while fetching folder ${folder.id}. Returning partial lists.`);
            // Return what we have so far
            break;
          }
          logger.warn(`Error getting lists from folder ${folder.id}:`, error.message);
        }
      }
      
      logger.info('All lists in space', { spaceId, listCount: lists.length });
      
      // Filter out "Routers" list and archived/template lists
      let filteredLists = lists.filter(list => {
        const name = list.name.toLowerCase();
        // Exclude Routers list, templates, and archived
        if (name === 'routers' || 
            name.includes('template') || 
            name === 'list' ||
            list.folder_name?.toLowerCase() === 'archived') {
          return false;
        }
        return true;
      });
      
      // Apply search filter if provided
      if (searchQuery && searchQuery.length >= 2) {
        const searchLower = searchQuery.toLowerCase();
        filteredLists = filteredLists.filter(list => 
          list.name.toLowerCase().includes(searchLower)
        );
      }
      
      // Format as "property tasks" for backward compatibility with frontend
      const propertyTasks = filteredLists.map(list => ({
        id: list.id,
        name: list.name,
        url: `https://app.clickup.com/${list.id}`,
        status: list.status,
        task_count: list.task_count,
        folder_name: list.folder_name,
        folder_id: list.folder_id,
        // Add these for frontend compatibility
        list_name: list.name,
        list_id: list.id
      }));
      
      logger.info('Found property lists in space', { 
        spaceId, 
        total: lists.length, 
        filtered: propertyTasks.length,
        searchQuery,
        sampleLists: propertyTasks.slice(0, 3).map(p => p.name)
      });
      
      return propertyTasks;
    } catch (error) {
      logger.error('Error searching property lists in space:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Search tasks across entire workspace
   * @param {string} workspaceId - Workspace ID
   * @param {string} searchQuery - Search query for task name
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} Matching tasks
   */
  async searchAllTasks(workspaceId, searchQuery = '', userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      
      // Get all spaces in the workspace
      const spacesResponse = await this.getSpaces(workspaceId, userId);
      const spaces = spacesResponse || [];
      
      let allTasks = [];
      
      // Get tasks from each space
      for (const space of spaces) {
        try {
          // Get all lists in the space
          const listsResponse = await client.get(`/space/${space.id}/list`, {
            params: { archived: false }
          });
          
          const lists = listsResponse.data.lists || [];
          
          // Get tasks from each list (with pagination)
          for (const list of lists) {
            try {
              let page = 0;
              let hasMore = true;
              
              while (hasMore) {
                const tasksResponse = await client.get(`/list/${list.id}/task`, {
                  params: {
                    archived: false,
                    subtasks: false,
                    include_closed: false,
                    page
                  }
                });
                
                const tasks = tasksResponse.data.tasks || [];
                if (tasks.length === 0) {
                  hasMore = false;
                } else {
                  allTasks = allTasks.concat(tasks.map(task => ({
                    ...task,
                    list: { id: list.id, name: list.name },
                    space: { id: space.id, name: space.name }
                  })));
                  
                  // ClickUp returns up to 100 tasks per page
                  if (tasks.length < 100) {
                    hasMore = false;
                  } else {
                    page++;
                  }
                }
              }
            } catch (error) {
              logger.warn(`Error getting tasks from list ${list.id}:`, error.message);
            }
          }
        } catch (error) {
          logger.warn(`Error getting lists from space ${space.id}:`, error.message);
        }
      }
      
      // Apply search filter if provided and exclude router tasks
      let filteredTasks = allTasks;
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase();
        filteredTasks = allTasks.filter(task => {
          // Exclude tasks from "Routers" list
          if (task.list?.name?.toLowerCase() === 'routers') {
            return false;
          }
          
          return task.name.toLowerCase().includes(searchLower) ||
                 task.description?.toLowerCase().includes(searchLower) ||
                 task.list?.name?.toLowerCase().includes(searchLower);
        });
      } else {
        // Even without search query, exclude router tasks
        filteredTasks = allTasks.filter(task => 
          task.list?.name?.toLowerCase() !== 'routers'
        );
      }
      
      logger.info('Searched all tasks in workspace', { 
        workspaceId,
        totalTasks: allTasks.length,
        filteredTasks: filteredTasks.length,
        searchQuery 
      });
      
      return filteredTasks;
    } catch (error) {
      logger.error('Error searching all tasks:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get custom fields for a list
   * @param {string} listId - List ID
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} Custom fields configuration
   */
  async getCustomFields(listId, userId = 'default') {
    try {
      const client = await this.getAuthorizedClient(userId);
      const response = await client.get(`/list/${listId}/field`);
      
      logger.info('Retrieved custom fields', { listId, count: response.data.fields?.length });
      return response.data.fields || [];
    } catch (error) {
      logger.error('Error getting custom fields:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new ClickUpClient();
