import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './OutOfServiceRouters.css';

const API_BASE = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';

const StoredWithRouters = () => {
  const [routersByAssignee, setRoutersByAssignee] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchRoutersByAssignees();
  }, []);

  const fetchRoutersByAssignees = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/routers/by-assignees`);
      if (!response.ok) throw new Error('Failed to fetch routers by assignees');
      const data = await response.json();
      setRoutersByAssignee(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching routers by assignees:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRouterClick = (routerId) => {
    navigate(`/router/${routerId}`);
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
      <h3 className="oos-title">
        Stored With
        <span className="oos-count">{totalRouters} routers</span>
      </h3>
      
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
                {routersByAssignee[assigneeName].map((router) => (
                  <div key={router.router_id} className="router-item">
                    <div className="router-item-header">
                      <span className="router-item-id">#{router.router_id}</span>
                      {router.name && <span className="router-item-name">{router.name}</span>}
                    </div>
                    {router.clickup_location_task_name && (
                      <div className="router-item-location">
                        📍 {router.clickup_location_task_name}
                      </div>
                    )}
                    <button
                      className="router-item-view-btn"
                      onClick={() => handleRouterClick(router.router_id)}
                    >
                      View Details
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StoredWithRouters;
