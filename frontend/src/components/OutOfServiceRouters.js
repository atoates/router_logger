import React, { useState, useEffect } from 'react';
import './OutOfServiceRouters.css';

const API_BASE = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';

const OutOfServiceRouters = () => {
  const [outOfServiceRouters, setOutOfServiceRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchOutOfServiceRouters();
  }, []);

  const fetchOutOfServiceRouters = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/out-of-service`);
      if (!response.ok) throw new Error('Failed to fetch out-of-service routers');
      const data = await response.json();
      setOutOfServiceRouters(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching out-of-service routers:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReturnToService = async (routerId) => {
    if (!window.confirm(`Return router ${routerId} to service?`)) return;
    
    try {
      const response = await fetch(`${API_BASE}/api/routers/${routerId}/return-to-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) throw new Error('Failed to return router to service');
      
      // Refresh the list
      fetchOutOfServiceRouters();
    } catch (err) {
      console.error('Error returning router to service:', err);
      alert('Failed to return router to service');
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

  const getDaysOutOfService = (dateString) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const now = new Date();
    const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    return days;
  };

  if (loading) {
    return (
      <div className="oos-card">
        <h3 className="oos-title">Out of Service Routers</h3>
        <div className="oos-loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="oos-card">
        <h3 className="oos-title">Out of Service Routers</h3>
        <div className="oos-error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="oos-card">
      <h3 className="oos-title">
        Out of Service Routers
        <span className="oos-count">{outOfServiceRouters.length}</span>
      </h3>
      
      {outOfServiceRouters.length === 0 ? (
        <div className="oos-empty">
          All routers are currently in service
        </div>
      ) : (
        <div className="oos-table-wrap">
          <table className="oos-table">
            <thead>
              <tr>
                <th>Router</th>
                <th>IMEI</th>
                <th>Stored With</th>
                <th>Out Since</th>
                <th>Days</th>
                <th>Location</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {outOfServiceRouters.map((router) => {
                const days = getDaysOutOfService(router.out_of_service_date);
                const storedWith = router.stored_with_username || router.stored_with || 'Not specified';
                
                return (
                  <tr key={router.router_id}>
                    <td>
                      <div className="oos-router-name">{router.name || router.router_id}</div>
                      {router.current_property_name && (
                        <div className="oos-router-meta">
                          Last at: {router.current_property_name}
                        </div>
                      )}
                    </td>
                    <td className="oos-imei">{router.imei || 'N/A'}</td>
                    <td>
                      <span className={`oos-person-badge oos-person-${storedWith?.toLowerCase()}`}>
                        {storedWith}
                      </span>
                    </td>
                    <td>{formatDate(router.out_of_service_date)}</td>
                    <td>
                      {days !== null && (
                        <span className={`oos-days-badge ${days > 30 ? 'oos-days-warning' : ''}`}>
                          {days}d
                        </span>
                      )}
                    </td>
                    <td className="oos-reason">
                      {router.current_property_name || 'Not specified'}
                      {router.out_of_service_notes && (
                        <div className="oos-notes">{router.out_of_service_notes}</div>
                      )}
                    </td>
                    <td>
                      <button
                        className="oos-return-btn"
                        onClick={() => handleReturnToService(router.router_id)}
                        title="Return to service"
                      >
                        Return to Service
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

export default OutOfServiceRouters;
