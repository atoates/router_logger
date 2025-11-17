/**
 * Mobile API Service
 * Lightweight API client for mobile app - only includes what mobile needs
 */

import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add authentication token to all requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('sessionToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle 401 - auto logout
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('sessionExpiry');
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

// Simple cache for routers (mobile needs fast access)
let _routersCache = { data: null, expiresAt: 0 };
let _routersInflight = null;
const ROUTERS_TTL_MS = 30 * 1000; // 30 seconds (mobile refreshes more often)

// Routers - core mobile functionality
export const getRouters = async () => {
  const now = Date.now();
  if (_routersCache.data && _routersCache.expiresAt > now) {
    return { data: _routersCache.data, fromCache: true };
  }
  if (_routersInflight) {
    return _routersInflight;
  }
  _routersInflight = api.get('/routers')
    .then((res) => {
      _routersCache = { data: res.data, expiresAt: Date.now() + ROUTERS_TTL_MS };
      return res;
    })
    .finally(() => {
      _routersInflight = null;
    });
  return _routersInflight;
};

// Router Assignment (mobile installer workflow)
export const assignRouter = (routerId, data) => api.post(`/routers/${routerId}/assign`, data);
export const removeRouterAssignees = (routerId) => api.post(`/routers/${routerId}/remove-assignees`);

// Router Status Updates
export const updateRouterStatus = (routerId, status, notes) => 
  api.patch(`/routers/${routerId}/status`, { status, notes });

// Location linking (mobile installer workflow)
export const linkRouterToLocation = (routerId, data) => 
  api.post(`/routers/${routerId}/link-location`, {
    location_task_id: data.location_task_id || data.taskId,
    location_task_name: data.location_task_name || data.taskName || data.name,
    notes: data.notes || 'Assigned via mobile app'
  });

// Unlink location (uninstall)
export const unlinkRouterFromLocation = (routerId, data) =>
  api.post(`/routers/${routerId}/unlink-location`, {
    notes: data?.notes || 'Uninstalled via mobile app'
  });

// Get current location for router
export const getCurrentLocation = (routerId) => 
  api.get(`/routers/${routerId}/current-location`);

// ClickUp integration (for location search)
export const getClickUpSpaces = () => api.get('/clickup/workspaces');
export const getClickUpSpacesForWorkspace = (workspaceId) => api.get(`/clickup/spaces/${workspaceId}`);
export const getClickUpSpaceLists = (spaceId) => api.get(`/clickup/debug/space-lists/${spaceId}`);
export const getClickUpLists = (workspaceId) => api.get(`/clickup/lists/${workspaceId}`);
export const getClickUpTasks = (listId, search = '') => 
  api.get(`/clickup/tasks/${listId}`, { params: { search } });

// Statistics (for mobile stats view)
export const getUsageStats = (params) => api.get('/stats/usage', { params });
export const getUptimeData = (params) => api.get('/stats/uptime', { params });
export const getTopRouters = (days = 1, limit = 100) => 
  api.get('/stats/top-routers', { params: { days, limit } });

// Session management
export const login = (username, password) => 
  api.post('/session/login', { username, password });

export const logout = (sessionToken) => 
  api.post('/session/logout', { sessionToken });

export const verifySession = () => 
  api.get('/session/verify');

export default api;

