import React, { createContext, useContext, useState, useEffect } from 'react';
import { login as apiLogin, logout as apiLogout, verifySession } from '../services/api';
import api from '../services/api';

const AuthContext = createContext(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('sessionToken');
      
      if (!token) {
        setLoading(false);
        return;
      }

      // Verify token
      const response = await verifySession();
      
      if (response.data.valid) {
        // Token is valid, but we need user info
        // Try to get user info from /api/users/me
        try {
          const userResponse = await api.get('/users/me');
          if (userResponse.data?.user) {
            setCurrentUser(userResponse.data.user);
          }
        } catch (err) {
          console.error('Error fetching user info:', err);
        }
      } else {
        // Token invalid
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('sessionExpiry');
        setCurrentUser(null);
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('sessionExpiry');
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (username, password) => {
    try {
      setError(null);
      
      const response = await apiLogin(username, password);
      
      // Store token
      localStorage.setItem('sessionToken', response.data.sessionToken);
      if (response.data.expiresAt) {
        localStorage.setItem('sessionExpiry', response.data.expiresAt);
      }
      
      // Set current user
      setCurrentUser(response.data.user);
      
      return { success: true };
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message || 'Login failed';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const logout = async () => {
    try {
      const token = localStorage.getItem('sessionToken');
      
      if (token) {
        await apiLogout(token);
      }
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('sessionExpiry');
      setCurrentUser(null);
    }
  };

  const value = {
    currentUser,
    loading,
    error,
    login,
    logout,
    checkAuth,
    isAdmin: currentUser?.role === 'admin',
    isGuest: currentUser?.role === 'guest'
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

