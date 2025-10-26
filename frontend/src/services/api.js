import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

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

// Submit log (for testing)
export const submitLog = (data) => api.post('/log', data);

export default api;
