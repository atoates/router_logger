import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import './SystemStatusIndicator.css';

/**
 * Shows status dots in the header for key integrations
 * - RMS (router sync)
 * - ClickUp (property management)
 * - Database (connectivity)
 */
function SystemStatusIndicator() {
  const [status, setStatus] = useState({
    rms: { healthy: null, message: 'Checking...' },
    clickup: { healthy: null, message: 'Checking...' },
    database: { healthy: null, message: 'Checking...' }
  });
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    checkAllStatus();
    
    // Check every 2 minutes
    const interval = setInterval(checkAllStatus, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setExpanded(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const checkAllStatus = async () => {
    // Check RMS
    try {
      const rmsRes = await api.get('/api/rms/status');
      setStatus(prev => ({
        ...prev,
        rms: {
          healthy: rmsRes.data.healthy && rmsRes.data.enabled,
          message: rmsRes.data.healthy 
            ? `Syncing every ${rmsRes.data.syncInterval} min`
            : (rmsRes.data.enabled ? 'Sync stale' : 'Not configured')
        }
      }));
    } catch (err) {
      setStatus(prev => ({
        ...prev,
        rms: { healthy: false, message: 'API error' }
      }));
    }

    // Check ClickUp
    try {
      const clickupRes = await api.get('/api/clickup/auth/status');
      setStatus(prev => ({
        ...prev,
        clickup: {
          healthy: clickupRes.data.valid,
          message: clickupRes.data.valid 
            ? 'Connected'
            : (clickupRes.data.authorized ? 'Token expired' : 'Not connected')
        }
      }));
    } catch (err) {
      setStatus(prev => ({
        ...prev,
        clickup: { healthy: false, message: 'API error' }
      }));
    }

    // Check Database (use a simple endpoint)
    try {
      const dbRes = await api.get('/api/routers?limit=1');
      setStatus(prev => ({
        ...prev,
        database: { healthy: true, message: 'Connected' }
      }));
    } catch (err) {
      setStatus(prev => ({
        ...prev,
        database: { healthy: false, message: 'Connection error' }
      }));
    }
  };

  const getStatusClass = (healthy) => {
    if (healthy === null) return 'status-unknown';
    return healthy ? 'status-healthy' : 'status-unhealthy';
  };

  const allHealthy = status.rms.healthy && status.clickup.healthy && status.database.healthy;
  const anyUnhealthy = status.rms.healthy === false || status.clickup.healthy === false || status.database.healthy === false;

  return (
    <div className="system-status-indicator" ref={containerRef}>
      <button 
        className={`status-trigger ${anyUnhealthy ? 'has-issues' : ''}`}
        onClick={() => setExpanded(!expanded)}
        title="System Status"
      >
        <div className="status-dots">
          <span className={`status-dot ${getStatusClass(status.rms.healthy)}`} title="RMS" />
          <span className={`status-dot ${getStatusClass(status.clickup.healthy)}`} title="ClickUp" />
          <span className={`status-dot ${getStatusClass(status.database.healthy)}`} title="Database" />
        </div>
        {anyUnhealthy && <span className="status-alert">!</span>}
      </button>

      {expanded && (
        <div className="status-dropdown">
          <div className="status-header">
            <span>System Status</span>
            <span className={`overall-status ${allHealthy ? 'healthy' : 'unhealthy'}`}>
              {allHealthy ? '✓ All Systems Go' : '⚠ Issues Detected'}
            </span>
          </div>
          
          <div className="status-items">
            <div className={`status-item ${getStatusClass(status.rms.healthy)}`}>
              <span className={`status-dot ${getStatusClass(status.rms.healthy)}`} />
              <span className="status-name">RMS Sync</span>
              <span className="status-message">{status.rms.message}</span>
            </div>
            
            <div className={`status-item ${getStatusClass(status.clickup.healthy)}`}>
              <span className={`status-dot ${getStatusClass(status.clickup.healthy)}`} />
              <span className="status-name">ClickUp</span>
              <span className="status-message">{status.clickup.message}</span>
            </div>
            
            <div className={`status-item ${getStatusClass(status.database.healthy)}`}>
              <span className={`status-dot ${getStatusClass(status.database.healthy)}`} />
              <span className="status-name">Database</span>
              <span className="status-message">{status.database.message}</span>
            </div>
          </div>
          
          <button className="refresh-btn" onClick={checkAllStatus}>
            ↻ Refresh
          </button>
        </div>
      )}
    </div>
  );
}

export default SystemStatusIndicator;
