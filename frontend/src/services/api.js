import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Routers
export const getRouters = () => api.get('/routers');

// Logs
export const getLogs = (params) => api.get('/logs', { params });

// Statistics
export const getUsageStats = (params) => api.get('/stats/usage', { params });
export const getUptimeData = (params) => api.get('/stats/uptime', { params });
export const getStorageStats = (params) => api.get('/stats/storage', { params });
export const getTopRouters = (params) => api.get('/stats/top-routers', { params });
export const getNetworkUsage = (params) => api.get('/stats/network-usage', { params });
export const getOperators = (params) => api.get('/stats/operators', { params });

// Submit log (for testing)
export const submitLog = (data) => api.post('/log', data);

export default api;
