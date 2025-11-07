import React, { useState, useEffect } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || '';

const MobileSettings = () => {
  const [authStatus, setAuthStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/api/auth/status`);
      if (!response.ok) {
        throw new Error('Failed to check auth status');
      }
      const data = await response.json();
      setAuthStatus(data);
    } catch (err) {
      console.error('Failed to check auth status:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRMSLogin = () => {
    window.location.href = `${API_BASE}/api/auth/rms/login`;
  };

  const handleClickUpLogin = () => {
    window.location.href = `${API_BASE}/api/clickup/auth`;
  };

  const handleRMSDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect RMS?')) return;
    
    try {
      const response = await fetch(`${API_BASE}/api/auth/rms/disconnect`, {
        method: 'POST',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to disconnect');
      await checkAuthStatus();
    } catch (err) {
      alert(`Failed to disconnect: ${err.message}`);
    }
  };

  const handleClickUpDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect ClickUp?')) return;
    
    try {
      const response = await fetch(`${API_BASE}/api/clickup/auth/disconnect`, {
        method: 'POST',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to disconnect');
      await checkAuthStatus();
    } catch (err) {
      alert(`Failed to disconnect: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '16px' }}>
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#6b7280' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', paddingBottom: '80px' }}>
      <h2 style={{ margin: '0 0 24px 0', fontSize: '24px', fontWeight: '700', color: '#111827' }}>
        Settings
      </h2>

      {error && (
        <div style={{
          background: '#fee2e2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '16px',
          color: '#991b1b',
          fontSize: '14px'
        }}>
          {error}
        </div>
      )}

      {/* RMS Connection */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#374151' }}>
          RMS Connection
        </h3>
        
        <div style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '16px'
        }}>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Status</div>
            <div style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: '12px',
              fontSize: '13px',
              fontWeight: '600',
              background: authStatus?.rms?.connected ? '#d1fae5' : '#fee2e2',
              color: authStatus?.rms?.connected ? '#065f46' : '#991b1b'
            }}>
              {authStatus?.rms?.connected ? '✓ Connected' : '✗ Not Connected'}
            </div>
          </div>

          {authStatus?.rms?.error && (
            <div style={{ 
              fontSize: '13px', 
              color: '#dc2626', 
              marginBottom: '12px',
              padding: '8px',
              background: '#fef2f2',
              borderRadius: '6px'
            }}>
              Error: {authStatus.rms.error}
            </div>
          )}

          {authStatus?.rms?.connected ? (
            <button
              onClick={handleRMSDisconnect}
              style={{
                width: '100%',
                padding: '12px',
                background: '#fff',
                border: '1px solid #dc2626',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: '600',
                color: '#dc2626',
                cursor: 'pointer'
              }}
            >
              Disconnect RMS
            </button>
          ) : (
            <button
              onClick={handleRMSLogin}
              style={{
                width: '100%',
                padding: '12px',
                background: '#10b981',
                border: 'none',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: '600',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              Connect to RMS
            </button>
          )}
        </div>
      </div>

      {/* ClickUp Connection */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#374151' }}>
          ClickUp Connection
        </h3>
        
        <div style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '16px'
        }}>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Status</div>
            <div style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: '12px',
              fontSize: '13px',
              fontWeight: '600',
              background: authStatus?.clickup?.connected ? '#d1fae5' : '#fee2e2',
              color: authStatus?.clickup?.connected ? '#065f46' : '#991b1b'
            }}>
              {authStatus?.clickup?.connected ? '✓ Connected' : '✗ Not Connected'}
            </div>
          </div>

          {authStatus?.clickup?.workspace && (
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
              Workspace: {authStatus.clickup.workspace}
            </div>
          )}

          {authStatus?.clickup?.error && (
            <div style={{ 
              fontSize: '13px', 
              color: '#dc2626', 
              marginBottom: '12px',
              padding: '8px',
              background: '#fef2f2',
              borderRadius: '6px'
            }}>
              Error: {authStatus.clickup.error}
            </div>
          )}

          {authStatus?.clickup?.connected ? (
            <button
              onClick={handleClickUpDisconnect}
              style={{
                width: '100%',
                padding: '12px',
                background: '#fff',
                border: '1px solid #dc2626',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: '600',
                color: '#dc2626',
                cursor: 'pointer'
              }}
            >
              Disconnect ClickUp
            </button>
          ) : (
            <button
              onClick={handleClickUpLogin}
              style={{
                width: '100%',
                padding: '12px',
                background: '#6366f1',
                border: 'none',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: '600',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              Connect to ClickUp
            </button>
          )}
        </div>
      </div>

      {/* Refresh Button */}
      <button
        onClick={checkAuthStatus}
        style={{
          width: '100%',
          padding: '12px',
          background: '#f3f4f6',
          border: '1px solid #d1d5db',
          borderRadius: '8px',
          fontSize: '15px',
          fontWeight: '600',
          color: '#374151',
          cursor: 'pointer'
        }}
      >
        🔄 Refresh Status
      </button>

      {/* App Info */}
      <div style={{
        marginTop: '32px',
        padding: '16px',
        background: '#f9fafb',
        borderRadius: '8px',
        fontSize: '13px',
        color: '#6b7280'
      }}>
        <div style={{ marginBottom: '8px' }}>
          <strong>VacatAd Router Logger</strong>
        </div>
        <div>
          Monitor router network and property assignments
        </div>
      </div>
    </div>
  );
};

export default MobileSettings;
