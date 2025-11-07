import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './OutOfServiceRouters.css';

const API_BASE = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';

const StoredWithRouters = () => {
  const [routersByAssignee, setRoutersByAssignee] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchRoutersByAssignees();
  }, []);

  const fetchRoutersByAssignees = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/routers/by-assignees`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch routers by assignees (${response.status})`);
      }
      const data = await response.json();
      
      // Filter out routers that have location assignments
      // Only show routers that are truly "stored with" someone (not installed at a location)
      const filteredData = {};
      Object.keys(data).forEach(assigneeName => {
        const routersWithoutLocation = data[assigneeName].filter(
          router => !router.clickup_location_task_id
        );
        if (routersWithoutLocation.length > 0) {
          filteredData[assigneeName] = routersWithoutLocation;
        }
      });
      
      setRoutersByAssignee(filteredData);
      setError(null);
    } catch (err) {
      console.error('Error fetching routers by assignees:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isRouterOnline = (currentState) => {
    // Use the current_state from the database (set by RMS sync)
    // This is the same logic used in RouterDashboard and InstalledRouters
    return currentState === 'online' || currentState === 1 || currentState === '1' || currentState === true;
  };

  const handleRouterClick = (routerId) => {
    navigate(`/router/${routerId}`);
  };

  const handleRefresh = async () => {
    try {
      setSyncing(true);
      setError(null);
      
      // Trigger ClickUp sync to refresh assignee data
      const syncResponse = await fetch(`${API_BASE}/api/clickup/sync`, {
        method: 'POST',
        credentials: 'include'
      });
      
      if (!syncResponse.ok) {
        throw new Error('Failed to sync with ClickUp');
      }
      
      // Wait a moment for the sync to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Fetch updated data
      await fetchRoutersByAssignees();
    } catch (err) {
      console.error('Error refreshing data:', err);
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="oos-card">
        <h3 className="oos-title">Stored With</h3>
        <div className="oos-loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="oos-card">
        <h3 className="oos-title">Stored With</h3>
        <div className="oos-error">Error: {error}</div>
      </div>
    );
  }

  const assigneeNames = Object.keys(routersByAssignee);
  const totalRouters = assigneeNames.reduce((sum, name) => sum + routersByAssignee[name].length, 0);

  return (
    <div className="oos-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 className="oos-title" style={{ margin: 0 }}>
          Stored With
          <span className="oos-count">{totalRouters} routers</span>
        </h3>
        <button
          onClick={handleRefresh}
          disabled={syncing}
          style={{
            padding: '8px 16px',
            background: syncing ? '#e5e7eb' : '#2563eb',
            color: syncing ? '#6b7280' : '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: syncing ? 'not-allowed' : 'pointer'
          }}
        >
          {syncing ? '🔄 Syncing...' : '🔄 Refresh'}
        </button>
      </div>
      
      {assigneeNames.length === 0 ? (
        <div className="oos-empty">
          No routers assigned to users
        </div>
      ) : (
        <div className="stored-with-groups">
          {assigneeNames.map((assigneeName) => (
            <div key={assigneeName} className="assignee-group">
              <h4 className="assignee-name">
                {assigneeName}
                <span className="assignee-router-count">
                  {routersByAssignee[assigneeName].length}
                </span>
              </h4>
              <div className="assignee-routers">
                {routersByAssignee[assigneeName].map((router) => {
                  const online = isRouterOnline(router.current_state);
                  
                  return (
                    <div 
                      key={router.router_id} 
                      className={`router-item ${online ? 'router-item-online' : 'router-item-offline'}`}
                      title={online ? 'Online' : 'Offline'}
                    >
                      <div className="router-item-header">
                        <span className="router-item-id">#{router.router_id}</span>
                        {router.name && <span className="router-item-name">{router.name}</span>}
                      </div>
                      <button
                        className="router-item-view-btn"
                        onClick={() => handleRouterClick(router.router_id)}
                      >
                        View Details
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StoredWithRouters;
