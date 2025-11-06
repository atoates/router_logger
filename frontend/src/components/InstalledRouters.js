import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './InstalledRouters.css';

const API_BASE = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';

const InstalledRouters = () => {
  const [installedRouters, setInstalledRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchInstalledRouters();
  }, []);

  const fetchInstalledRouters = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/routers/with-locations`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch installed routers (${response.status})`);
      }
      const data = await response.json();
      setInstalledRouters(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching installed routers:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateValue) => {
    if (!dateValue) return 'Date not set';
    
    // Handle Unix timestamp (milliseconds) - convert string to number if needed
    let timestamp = dateValue;
    if (typeof dateValue === 'string') {
      timestamp = parseInt(dateValue, 10);
    }
    
    const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(dateValue);
    
    // Check for invalid date or Unix epoch (01/01/1970)
    if (isNaN(date.getTime()) || date.getTime() === 0 || date.getFullYear() === 1970) {
      return 'Date not set';
    }
    
    // Format as DD/MM/YYYY (UK format)
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
  };

  const getUninstallDate = (installedDate) => {
    if (!installedDate) return 'Date not set';
    
    // Handle Unix timestamp (milliseconds) - convert string to number if needed
    let timestamp = installedDate;
    if (typeof installedDate === 'string') {
      timestamp = parseInt(installedDate, 10);
    }
    
    const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(installedDate);
    
    // Check for invalid date or Unix epoch (01/01/1970)
    if (isNaN(date.getTime()) || date.getTime() === 0 || date.getFullYear() === 1970) {
      return 'Date not set';
    }
    
    // Add 92 days
    const uninstallDate = new Date(date);
    uninstallDate.setDate(uninstallDate.getDate() + 92);
    
    return formatDate(uninstallDate);
  };

  const isDueSoon = (installedDate) => {
    if (!installedDate) return false;
    
    // Handle Unix timestamp (milliseconds) - convert string to number if needed
    let timestamp = installedDate;
    if (typeof installedDate === 'string') {
      timestamp = parseInt(installedDate, 10);
    }
    
    const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(installedDate);
    
    // Check for invalid date or Unix epoch (01/01/1970) - don't flag as overdue
    if (isNaN(date.getTime()) || date.getTime() === 0 || date.getFullYear() === 1970) {
      return false;
    }
    
    const now = new Date();
    const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    return days > 92;
  };

  const isRouterOnline = (lastSeen) => {
    if (!lastSeen) return false;
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const minutesSinceLastSeen = (now - lastSeenDate) / (1000 * 60);
    // Consider online if seen in last 60 minutes (1 hour)
    return minutesSinceLastSeen < 60;
  };

  const handleRouterClick = (routerId) => {
    navigate(`/router/${routerId}`);
  };

  if (loading) {
    return (
      <div className="installed-routers-card">
        <h3 className="installed-routers-title">Installed Routers</h3>
        <div className="installed-routers-loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="installed-routers-card">
        <h3 className="installed-routers-title">Installed Routers</h3>
        <div className="installed-routers-error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="installed-routers-card">
      <h3 className="installed-routers-title">
        Installed Routers
        <span className="installed-routers-count">{installedRouters.length}</span>
      </h3>
      
      {installedRouters.length === 0 ? (
        <div className="installed-routers-empty">
          No routers currently installed
        </div>
      ) : (
        <div className="installed-routers-table-wrap">
          <table className="installed-routers-table">
            <thead>
              <tr>
                <th>Router</th>
                <th>Location</th>
                <th>Status</th>
                <th>Install Date</th>
                <th>Uninstall Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {installedRouters.map((router) => {
                // Use date_installed if available, fallback to location_linked_at
                const installDate = router.date_installed || router.location_linked_at;
                const uninstallDate = getUninstallDate(installDate);
                const online = isRouterOnline(router.last_seen);
                const overdue = isDueSoon(installDate);
                
                return (
                  <tr key={router.router_id}>
                    <td>
                      <div className="ir-router-info">
                        <div className="ir-router-id">#{router.router_id}</div>
                        {router.name && (
                          <div className="ir-router-name">{router.name}</div>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="ir-property-name">{router.clickup_location_task_name || 'Unknown'}</div>
                    </td>
                    <td>
                      <div className="ir-status-indicator">
                        <span 
                          className={`ir-status-dot ${online ? 'ir-status-online' : 'ir-status-offline'}`}
                          title={online ? 'Online' : 'Offline'}
                        ></span>
                      </div>
                    </td>
                    <td>{formatDate(installDate)}</td>
                    <td>
                      <span className={overdue ? 'ir-date-overdue' : ''}>{uninstallDate}</span>
                    </td>
                    <td>
                      <button
                        className="ir-view-btn"
                        onClick={() => handleRouterClick(router.router_id)}
                        title="View router details"
                      >
                        View Router
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default InstalledRouters;
