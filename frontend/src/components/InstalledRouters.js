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

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'short', 
      year: 'numeric' 
    });
  };

  const getDaysInstalled = (installedDate) => {
    if (!installedDate) return null;
    const date = new Date(installedDate);
    const now = new Date();
    const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    return days;
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
                <th>Linked</th>
                <th>Days</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {installedRouters.map((router) => {
                const daysInstalled = getDaysInstalled(router.location_linked_at);
                
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
                    <td>{formatDate(router.location_linked_at)}</td>
                    <td>
                      {daysInstalled !== null && (
                        <span className={`ir-days-badge ${daysInstalled > 92 ? 'ir-days-warning' : ''}`}>
                          {daysInstalled}d
                        </span>
                      )}
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
