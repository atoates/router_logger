/**
 * Mobile API helper - lightweight fetch wrapper
 * Alternative to axios for simple requests
 */

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export const mobileFetch = async (url, options = {}) => {
  const sessionToken = localStorage.getItem('sessionToken');
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }
  
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers
  });
  
  // Handle 401 unauthorized - token expired
  if (response.status === 401) {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('sessionExpiry');
    window.location.reload(); // Force re-login
  }
  
  return response;
};

export { API_BASE };

