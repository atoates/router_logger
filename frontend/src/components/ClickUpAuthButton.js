import React, { useState, useEffect } from 'react';
import { 
  getClickUpAuthStatus, 
  getClickUpAuthUrl, 
  disconnectClickUp 
} from '../services/api';
import './ClickUpAuthButton.css';

const ClickUpAuthButton = ({ onAuthChange }) => {
  const [status, setStatus] = useState({ authorized: false, workspace: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await getClickUpAuthStatus();
      setStatus(response.data);
      if (onAuthChange) {
        onAuthChange(response.data.authorized);
      }
    } catch (error) {
      console.error('Error checking ClickUp auth status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      setLoading(true);
      const response = await getClickUpAuthUrl();
      const { authUrl, state } = response.data;
      
      // Store state for verification on callback
      sessionStorage.setItem('clickup_oauth_state', state);
      
      // Redirect to ClickUp OAuth
      window.location.href = authUrl;
    } catch (error) {
      console.error('Error initiating ClickUp OAuth:', error);
      alert('Failed to connect to ClickUp. Please try again.');
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect ClickUp? Linked tasks will remain but won\'t update.')) {
      return;
    }

    try {
      setLoading(true);
      await disconnectClickUp();
      setStatus({ authorized: false, workspace: null });
      if (onAuthChange) {
        onAuthChange(false);
      }
      alert('ClickUp disconnected successfully');
    } catch (error) {
      console.error('Error disconnecting ClickUp:', error);
      alert('Failed to disconnect ClickUp');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <button className="clickup-auth-btn loading" disabled>
        <span className="status-dot"></span>
        Loading...
      </button>
    );
  }

  if (status.authorized && status.workspace) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button className="clickup-auth-btn connected">
          <span className="status-dot"></span>
          <div className="workspace-info">
            <span>ClickUp Connected</span>
            <span className="workspace-name">{status.workspace.workspace_name || 'VacatAd'}</span>
          </div>
        </button>
        <button className="clickup-disconnect" onClick={handleDisconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button className="clickup-auth-btn" onClick={handleConnect}>
      <span className="status-dot"></span>
      Connect ClickUp
    </button>
  );
};

export default ClickUpAuthButton;
