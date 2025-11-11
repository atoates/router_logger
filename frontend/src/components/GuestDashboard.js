import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './GuestDashboard.css';

function GuestDashboard() {
  const [routers, setRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { currentUser, getAuthHeaders, API_URL } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchMyRouters();
  }, []);

  const fetchMyRouters = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${API_URL}/api/users/${currentUser.id}/routers`,
        {
          headers: getAuthHeaders()
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch routers');
      }

      const data = await response.json();
      setRouters(data.routers || []);
    } catch (err) {
      console.error('Error loading routers:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRouterClick = (routerId) => {
    navigate(`/router/${routerId}`);
  };

  const getStatusIndicator = (status) => {
    const isOnline = ['online', 'Online', '1', 1, true].includes(status);
    return (
      <span className={`guest-status-dot ${isOnline ? 'online' : 'offline'}`}>
        {isOnline ? '🟢 Online' : '🔴 Offline'}
      </span>
    );
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <div className="guest-dashboard">
        <div className="guest-loading">Loading your routers...</div>
      </div>
    );
  }

  return (
    <div className="guest-dashboard">
      <div className="guest-header">
        <h1>📱 My Routers</h1>
        <p className="guest-subtitle">
          Welcome, {currentUser?.full_name || currentUser?.username}!
        </p>
      </div>

      {error && (
        <div className="guest-error">
          Error: {error}
        </div>
      )}

      {routers.length === 0 ? (
        <div className="guest-empty">
          <div className="guest-empty-icon">📭</div>
          <h2>No Routers Assigned</h2>
          <p>You don't have any routers assigned to you yet.</p>
          <p className="guest-contact">
            Please contact <strong>VacatAd</strong> to get routers assigned to your account.
          </p>
        </div>
      ) : (
        <div className="guest-routers-grid">
          {routers.map((router) => (
            <div
              key={router.router_id}
              className="guest-router-card"
              onClick={() => handleRouterClick(router.router_id)}
            >
              <div className="guest-router-header">
                <h3>{router.name || `Router #${router.router_id}`}</h3>
                {getStatusIndicator(router.current_status)}
              </div>

              <div className="guest-router-details">
                <div className="guest-detail-row">
                  <span className="guest-label">Router ID:</span>
                  <span className="guest-value">{router.router_id}</span>
                </div>

                {router.imei && (
                  <div className="guest-detail-row">
                    <span className="guest-label">IMEI:</span>
                    <span className="guest-value">{router.imei}</span>
                  </div>
                )}

                {router.mac_address && (
                  <div className="guest-detail-row">
                    <span className="guest-label">MAC Address:</span>
                    <span className="guest-value">{router.mac_address}</span>
                  </div>
                )}

                <div className="guest-detail-row">
                  <span className="guest-label">Last Seen:</span>
                  <span className="guest-value">{formatDate(router.last_seen)}</span>
                </div>

                {router.clickup_location_task_name && (
                  <div className="guest-detail-row">
                    <span className="guest-label">Location:</span>
                    <span className="guest-value">{router.clickup_location_task_name}</span>
                  </div>
                )}
              </div>

              <button className="guest-view-button">
                View Details →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default GuestDashboard;
