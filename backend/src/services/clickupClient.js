/**
 * ClickUp API Client
 * Handles all interactions with the ClickUp API
 */

const axios = require('axios');
const clickupOAuthService = require('./clickupOAuthService');
const logger = require('../config/database').logger;

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

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

    return axios.create({
      baseURL: CLICKUP_API_BASE,
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
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
   * Find list by name across all spaces in workspace
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
      
      logger.info('Retrieved ClickUp task', { taskId });
      return response.data;
    } catch (error) {
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
      
      logger.info('Created ClickUp task', { listId, taskId: response.data.id });
      return response.data;
    } catch (error) {
      logger.error('Error creating ClickUp task:', error.response?.data || error.message);
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
    try {
      const client = await this.getAuthorizedClient(userId);
      const response = await client.put(`/task/${taskId}`, updates);
      
      logger.info('Updated ClickUp task', { taskId });
      return response.data;
    } catch (error) {
      logger.error('Error updating ClickUp task:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Search tasks across workspace
   * @param {string} workspaceId - Workspace ID
   * @param {Object} filters - Search filters
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} Matching tasks
   */
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
}

module.exports = new ClickUpClient();
