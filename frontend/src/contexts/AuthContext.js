import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Backend API URL
  const API_URL = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';

  // Check if user is authenticated on mount
  useEffect(() => {
    checkAuth();
  }, []);

  // Check authentication status
  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('sessionToken');
      
      if (!token) {
        setLoading(false);
        return;
      }

      // Verify token and get current user
      const response = await fetch(`${API_URL}/api/users/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentUser(data.user);
      } else {
        // Token invalid or expired
        localStorage.removeItem('sessionToken');
        setCurrentUser(null);
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      localStorage.removeItem('sessionToken');
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  };

  // Login function
  const login = async (username, password) => {
    try {
      setError(null);
      
      const response = await fetch(`${API_URL}/api/session/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Store token
      localStorage.setItem('sessionToken', data.sessionToken);
      
      // Set current user
      setCurrentUser(data.user);

      return { success: true };
    } catch (err) {
      const errorMessage = err.message || 'Login failed';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  // Logout function
  const logout = async () => {
    try {
      const token = localStorage.getItem('sessionToken');
      
      if (token) {
        // Call logout endpoint (optional - token is just deleted from storage)
        await fetch(`${API_URL}/api/session/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ sessionToken: token })
        });
      }
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      // Always clear local state
      localStorage.removeItem('sessionToken');
      setCurrentUser(null);
    }
  };

  // Helper to get auth headers
  const getAuthHeaders = () => {
    const token = localStorage.getItem('sessionToken');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

  // Helper to check if user is admin
  const isAdmin = currentUser?.role === 'admin';
  const isGuest = currentUser?.role === 'guest';

  const value = {
    currentUser,
    loading,
    error,
    login,
    logout,
    checkAuth,
    getAuthHeaders,
    isAdmin,
    isGuest,
    API_URL
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
