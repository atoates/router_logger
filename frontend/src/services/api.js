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

// Simple in-module cache for routers with TTL and in-flight dedupe
let _routersCache = { data: null, expiresAt: 0 };
let _routersInflight = null;
const ROUTERS_TTL_MS = (Number(process.env.REACT_APP_ROUTERS_TTL_SECONDS) || 90) * 1000;

// Routers
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

// Logs
export const getLogs = (params) => api.get('/logs', { params });

// Statistics
export const getUsageStats = (params) => api.get('/stats/usage', { params });
export const getUptimeData = (params) => api.get('/stats/uptime', { params });
export const getStorageStats = (params) => api.get('/stats/storage', { params });
export const getTopRouters = (params) => api.get('/stats/top-routers', { params });
export const getNetworkUsage = (params) => api.get('/stats/network-usage', { params });
export const getOperators = (params) => api.get('/stats/operators', { params });
export const getNetworkUsageRolling = (params) => api.get('/stats/network-usage-rolling', { params });
export const getTopRoutersRolling = (params) => api.get('/stats/top-routers-rolling', { params });
export const getOperatorsRolling = (params) => api.get('/stats/operators-rolling', { params });

// Inspections
export const getInspectionStatus = () => api.get('/stats/inspections');
export const logInspection = (routerId, data) => api.post(`/inspections/${routerId}`, data);
export const getInspectionHistory = (routerId) => api.get(`/inspections/${routerId}`);

// Router Status
export const getRouterStatusSummary = () => api.get('/routers/status-summary');

// Monitoring
export const getRMSUsage = () => api.get('/monitoring/rms-usage');
export const getClickUpUsage = () => api.get('/monitoring/clickup-usage');

// ClickUp Integration
export const getClickUpAuthStatus = () => api.get('/clickup/auth/status');
export const getClickUpAuthUrl = () => api.get('/clickup/auth/url');
export const clickUpAuthCallback = (code, state) => api.get('/clickup/auth/callback', { params: { code, state } });
export const disconnectClickUp = () => api.post('/clickup/auth/disconnect');
export const getClickUpWorkspaces = () => api.get('/clickup/workspaces');
export const getClickUpRoutersList = (workspaceId) => api.get(`/clickup/lists/${workspaceId}`);
export const getClickUpTasks = (listId, search = '') => api.get(`/clickup/tasks/${listId}`, { params: { search } });
export const createClickUpTask = (listId, taskData) => api.post(`/clickup/tasks/${listId}`, taskData);
export const linkRouterToTask = (routerId, taskId, listId) => api.post('/clickup/link-router', { routerId, taskId, listId });
export const unlinkRouterFromTask = (routerId) => api.delete(`/clickup/link-router/${routerId}`);
export const getRouterTask = (routerId) => api.get(`/clickup/router-task/${routerId}`);

// Submit log (for testing)
export const submitLog = (data) => api.post('/log', data);

// Router Assignment (for mobile app)
export const assignRouter = (routerId, userId) => api.post(`/routers/${routerId}/assign`, { userId });
export const removeRouterAssignees = (routerId) => api.post(`/routers/${routerId}/remove-assignees`);

// Router Status Updates
export const updateRouterStatus = (routerId, status, notes) => api.patch(`/routers/${routerId}/status`, { status, notes });

// Admin - Cache Management
export const clearRouterCache = () => {
  // Clear frontend cache immediately
  _routersCache = { data: null, expiresAt: 0 };
  // Clear backend cache
  return api.post('/admin/clear-cache');
};

// Admin - Deduplication Report
export const getDeduplicationReport = () => api.get('/admin/deduplication-report');

// Force refresh routers (bypass cache)
export const forceRefreshRouters = async () => {
  _routersCache = { data: null, expiresAt: 0 };
  return api.get('/routers');
};

export default api;
