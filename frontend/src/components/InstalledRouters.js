import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './InstalledRouters.css';

const InstalledRouters = () => {
  const [installedRouters, setInstalledRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showOfflineOnly, setShowOfflineOnly] = useState(true);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const navigate = useNavigate();

  useEffect(() => {
    fetchInstalledRouters();
  }, []);

  const fetchInstalledRouters = async () => {
    try {
      setLoading(true);
      const response = await api.get('/routers/with-locations');
      setInstalledRouters(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching installed routers:', err);
      setError(err.response?.data?.error || err.message);
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

  const isRouterOnline = (currentState) => {
    // Use the current_state from the database (set by RMS sync)
    // This is the same logic used in RouterDashboard
    return currentState === 'online' || currentState === 1 || currentState === '1' || currentState === true;
  };

  const handleRouterClick = (routerId) => {
    navigate(`/router/${routerId}`);
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortedRouters = (routers) => {
    if (!sortConfig.key) return routers;

    const sorted = [...routers].sort((a, b) => {
      let aVal, bVal;

      switch (sortConfig.key) {
        case 'router':
          aVal = a.router_id || '';
          bVal = b.router_id || '';
          break;
        case 'location':
          aVal = (a.clickup_location_task_name || '').toLowerCase();
          bVal = (b.clickup_location_task_name || '').toLowerCase();
          break;
        case 'status':
          aVal = isRouterOnline(a.current_state) ? 1 : 0;
          bVal = isRouterOnline(b.current_state) ? 1 : 0;
          break;
        case 'install_date':
          aVal = a.date_installed || a.location_linked_at || 0;
          bVal = b.date_installed || b.location_linked_at || 0;
          // Convert to number if string
          aVal = typeof aVal === 'string' ? parseInt(aVal, 10) : aVal;
          bVal = typeof bVal === 'string' ? parseInt(bVal, 10) : bVal;
          break;
        case 'uninstall_date':
          const aInstall = a.date_installed || a.location_linked_at || 0;
          const bInstall = b.date_installed || b.location_linked_at || 0;
          aVal = typeof aInstall === 'string' ? parseInt(aInstall, 10) : aInstall;
          bVal = typeof bInstall === 'string' ? parseInt(bInstall, 10) : bInstall;
          // Add 92 days in milliseconds
          aVal = aVal ? aVal + (92 * 24 * 60 * 60 * 1000) : 0;
          bVal = bVal ? bVal + (92 * 24 * 60 * 60 * 1000) : 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  };

  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) {
      return <span className="sort-icon">⇅</span>;
    }
    return sortConfig.direction === 'asc' 
      ? <span className="sort-icon active">↑</span> 
      : <span className="sort-icon active">↓</span>;
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
      <div className="installed-routers-header">
        <h3 className="installed-routers-title">
          Installed Routers
          <span className="installed-routers-count">
            {showOfflineOnly 
              ? installedRouters.filter(r => !isRouterOnline(r.current_state)).length 
              : installedRouters.length}
          </span>
        </h3>
        
        <div className="ir-filter-controls">
          <button
            className={`ir-filter-btn ${showOfflineOnly ? 'active' : ''}`}
            onClick={() => setShowOfflineOnly(!showOfflineOnly)}
            title={showOfflineOnly ? 'Show all routers' : 'Show offline only'}
          >
            {showOfflineOnly ? '🔴 Offline Only' : '🔔'}
          </button>
        </div>
      </div>
      
      {(() => {
        const filteredRouters = installedRouters.filter((router) => {
          if (!showOfflineOnly) return true;
          const online = isRouterOnline(router.current_state);
          return !online;
        });

        const sortedRouters = getSortedRouters(filteredRouters);

        if (installedRouters.length === 0) {
          return (
            <div className="installed-routers-empty">
              No routers currently installed
            </div>
          );
        }

        if (filteredRouters.length === 0) {
          return (
            <div className="installed-routers-empty">
              No offline routers found
            </div>
          );
        }

        return (
          <div className="installed-routers-table-wrap">
            <table className="installed-routers-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('router')} style={{ cursor: 'pointer' }}>
                    Router {getSortIcon('router')}
                  </th>
                  <th onClick={() => handleSort('location')} style={{ cursor: 'pointer' }}>
                    Location {getSortIcon('location')}
                  </th>
                  <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>
                    Status {getSortIcon('status')}
                  </th>
                  <th onClick={() => handleSort('install_date')} style={{ cursor: 'pointer' }}>
                    Install Date {getSortIcon('install_date')}
                  </th>
                  <th onClick={() => handleSort('uninstall_date')} style={{ cursor: 'pointer' }}>
                    Uninstall Date {getSortIcon('uninstall_date')}
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRouters.map((router) => {
                  // Use date_installed if available, fallback to location_linked_at
                  const installDate = router.date_installed || router.location_linked_at;
                  const uninstallDate = getUninstallDate(installDate);
                  const online = isRouterOnline(router.current_state);
                  const overdue = isDueSoon(installDate);
                  
                  return (
                    <tr key={router.router_id}>
                      <td>
                        <div className="ir-router-info">
                          <div className="ir-router-id">{router.name || `Router #${router.router_id}`}</div>
                          <div className="ir-router-name">#{router.router_id}</div>
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
        );
      })()}
    </div>
  );
};

export default InstalledRouters;
