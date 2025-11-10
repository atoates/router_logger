import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import api from '../services/api';
import './RMSAuthButton.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

/**
 * RMS OAuth Authentication Button
 * Handles OAuth login/logout flow with RMS
 */
function RMSAuthButton({ variant = 'panel' }) {
  const [authStatus, setAuthStatus] = useState({
    loading: true,
    authenticated: false,
    configured: false,
    scope: null
  });

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  // Handle OAuth callback from redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authSuccess = params.get('auth_success');
    const authError = params.get('auth_error');

    if (authSuccess) {
      toast.success('Successfully authenticated with RMS!');
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
      // Refresh auth status
      checkAuthStatus();
    }

    if (authError) {
      toast.error(`Authentication failed: ${authError}`);
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const checkAuthStatus = async () => {
    console.log('RMSAuthButton: Checking auth status...');
    try {
      const response = await api.get('/auth/rms/status');
      const data = response.data;
      console.log('RMSAuthButton: Auth status data:', data);
      
      setAuthStatus({
        loading: false,
        authenticated: data.authenticated || false,
        configured: data.configured || false,
        scope: data.scope || null
      });
    } catch (error) {
      console.error('RMSAuthButton: Error checking auth status:', error);
      setAuthStatus({
        loading: false,
        authenticated: false,
        configured: false,
        scope: null
      });
    }
  };

  const handleLogin = () => {
    // Redirect to OAuth login endpoint
    window.location.href = `${API_URL}/api/auth/rms/login`;
  };

  const handleLogout = async () => {
    try {
      const response = await fetch(`${API_URL}/api/auth/rms/logout`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        toast.success('Logged out successfully');
        setAuthStatus({
          ...authStatus,
          authenticated: false,
          scope: null
        });
      } else {
        toast.error('Failed to logout');
      }
    } catch (error) {
      console.error('Error logging out:', error);
      toast.error('Error logging out');
    }
  };

  if (authStatus.loading) {
    return variant === 'header' ? (
      <div className="rms-auth-loading" style={{ fontSize: '0.9rem' }}>Checking…</div>
    ) : (
      <div className="rms-auth-loading">Checking authentication...</div>
    );
  }

  if (!authStatus.configured) {
    if (variant === 'header') {
      return (
        <button onClick={handleLogin} className="rms-auth-button login" style={{ fontSize: '0.85rem' }}>
          Configure RMS
        </button>
      );
    }
    return (
      <div className="rms-auth-not-configured">
        <span className="rms-auth-icon">⚙️</span>
        <span className="rms-auth-text">OAuth not configured</span>
        <div className="rms-auth-hint">
          Set RMS_OAUTH_CLIENT_ID, RMS_OAUTH_CLIENT_SECRET, and RMS_OAUTH_REDIRECT_URI
        </div>
      </div>
    );
  }

  if (authStatus.authenticated) {
    if (variant === 'header') {
      return (
        <div className="rms-pill" style={{ marginRight: '8px' }} title="Connected to RMS">
          <span>RMS</span>
          <span className="tick">✓</span>
        </div>
      );
    }
    return (
      <div className="rms-auth-container authenticated">
        <div className="rms-auth-status">
          <span className="rms-auth-icon">✓</span>
          <span className="rms-auth-text">Connected to RMS</span>
        </div>
        {authStatus.scope && (
          <div className="rms-auth-scope">
            Scopes: {authStatus.scope}
          </div>
        )}
        <button onClick={handleLogout} className="rms-auth-button logout">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    variant === 'header' ? (
      <button onClick={handleLogin} className="rms-pill" style={{ background:'transparent', color:'#ffffff', border:'1.5px solid rgba(255,255,255,0.6)', marginRight: '8px' }} title="Connect to RMS">
        <span>RMS</span>
        <span className="tick" style={{ background:'rgba(255,255,255,0.15)' }}>🔒</span>
      </button>
    ) : (
      <div className="rms-auth-container">
        <div className="rms-auth-status">
          <span className="rms-auth-icon">🔒</span>
          <span className="rms-auth-text">Not connected to RMS</span>
        </div>
        <button onClick={handleLogin} className="rms-auth-button login">Connect</button>
        <div className="rms-auth-hint">
          Sign in to access full device monitoring data
        </div>
      </div>
    )
  );
}

export default RMSAuthButton;
