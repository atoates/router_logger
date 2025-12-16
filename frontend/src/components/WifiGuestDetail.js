import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getIronwifiGuestDetail } from '../services/api';
import './WifiGuestDetail.css';

function WifiGuestDetail() {
  const { guestId } = useParams();
  const navigate = useNavigate();
  const [guest, setGuest] = useState(null);
  const [loginHistory, setLoginHistory] = useState([]);
  const [routerSummary, setRouterSummary] = useState([]);
  const [devices, setDevices] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('history');

  useEffect(() => {
    fetchGuestDetails();
  }, [guestId]);

  const fetchGuestDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getIronwifiGuestDetail(guestId);
      
      if (response.data.success) {
        setGuest(response.data.guest);
        setLoginHistory(response.data.loginHistory || []);
        setRouterSummary(response.data.routerSummary || []);
        setDevices(response.data.devices || []);
        setStats(response.data.stats);
      } else {
        setError('Failed to load guest details');
      }
    } catch (err) {
      console.error('Error fetching guest details:', err);
      setError(err.response?.data?.error || 'Failed to load guest details');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatRelativeTime = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  };

  if (loading) {
    return (
      <div className="guest-detail-container">
        <div className="guest-detail-loading">
          <div className="loading-spinner"></div>
          <p>Loading guest details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="guest-detail-container">
        <div className="guest-detail-error">
          <h2>❌ Error</h2>
          <p>{error}</p>
          <button onClick={() => navigate('/wifi-guests')} className="back-btn">
            ← Back to Guests
          </button>
        </div>
      </div>
    );
  }

  if (!guest) {
    return (
      <div className="guest-detail-container">
        <div className="guest-detail-error">
          <h2>Guest not found</h2>
          <button onClick={() => navigate('/wifi-guests')} className="back-btn">
            ← Back to Guests
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="guest-detail-container">
      {/* Header */}
      <div className="guest-detail-header">
        <button onClick={() => navigate('/wifi-guests')} className="back-btn">
          ← Back
        </button>
        <div className="guest-detail-title">
          <h1>{guest.fullname || guest.username || guest.email}</h1>
          <p className="guest-subtitle">
            {guest.email !== guest.username && guest.email && (
              <span className="guest-email">{guest.email}</span>
            )}
            {guest.phone && <span className="guest-phone">📱 {guest.phone}</span>}
          </p>
        </div>
        <button onClick={fetchGuestDetails} className="refresh-btn">
          ↻ Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="guest-stats-cards">
        <div className="guest-stat-card">
          <div className="guest-stat-icon">📊</div>
          <div className="guest-stat-content">
            <div className="guest-stat-value">{stats?.totalLogins || 0}</div>
            <div className="guest-stat-label">Total Logins</div>
          </div>
        </div>
        <div className="guest-stat-card">
          <div className="guest-stat-icon">📡</div>
          <div className="guest-stat-content">
            <div className="guest-stat-value">{stats?.uniqueRouters || 0}</div>
            <div className="guest-stat-label">Routers Used</div>
          </div>
        </div>
        <div className="guest-stat-card">
          <div className="guest-stat-icon">📱</div>
          <div className="guest-stat-content">
            <div className="guest-stat-value">{stats?.uniqueDevices || 0}</div>
            <div className="guest-stat-label">Devices</div>
          </div>
        </div>
        <div className="guest-stat-card">
          <div className="guest-stat-icon">🕐</div>
          <div className="guest-stat-content">
            <div className="guest-stat-value">{formatRelativeTime(guest.first_seen_at)}</div>
            <div className="guest-stat-label">First Seen</div>
          </div>
        </div>
      </div>

      {/* Guest Info Card */}
      <div className="guest-info-card">
        <h3>👤 Guest Information</h3>
        <div className="guest-info-grid">
          <div className="guest-info-item">
            <span className="info-label">Username</span>
            <span className="info-value">{guest.username || '-'}</span>
          </div>
          <div className="guest-info-item">
            <span className="info-label">Email</span>
            <span className="info-value">{guest.email || '-'}</span>
          </div>
          <div className="guest-info-item">
            <span className="info-label">Full Name</span>
            <span className="info-value">{guest.fullname || '-'}</span>
          </div>
          <div className="guest-info-item">
            <span className="info-label">Phone</span>
            <span className="info-value">{guest.phone || '-'}</span>
          </div>
          <div className="guest-info-item">
            <span className="info-label">First Seen</span>
            <span className="info-value">{formatDate(guest.first_seen_at)}</span>
          </div>
          <div className="guest-info-item">
            <span className="info-label">Last Seen</span>
            <span className="info-value">{formatDate(guest.last_seen_at)}</span>
          </div>
          <div className="guest-info-item">
            <span className="info-label">Current Router</span>
            <span className="info-value">{guest.current_router || 'Not linked'}</span>
          </div>
          <div className="guest-info-item">
            <span className="info-label">Auth Count</span>
            <span className="info-value">{guest.auth_count || 1}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="guest-detail-tabs">
        <button 
          className={`guest-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          📜 Login History ({loginHistory.length})
        </button>
        <button 
          className={`guest-tab ${activeTab === 'routers' ? 'active' : ''}`}
          onClick={() => setActiveTab('routers')}
        >
          📡 Routers ({routerSummary.length})
        </button>
        <button 
          className={`guest-tab ${activeTab === 'devices' ? 'active' : ''}`}
          onClick={() => setActiveTab('devices')}
        >
          📱 Devices ({devices.length})
        </button>
      </div>

      {/* Login History Tab */}
      {activeTab === 'history' && (
        <div className="guest-panel">
          {loginHistory.length === 0 ? (
            <div className="guest-empty">
              <p>No login history found</p>
            </div>
          ) : (
            <div className="guest-table-container">
              <table className="guest-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Router</th>
                    <th>Location</th>
                    <th>Device MAC</th>
                    <th>Public IP</th>
                    <th>Portal</th>
                  </tr>
                </thead>
                <tbody>
                  {loginHistory.map((login, index) => (
                    <tr key={login.id || index}>
                      <td>
                        <div className="login-date">
                          {formatRelativeTime(login.creation_date)}
                        </div>
                        <div className="login-date-full">
                          {formatDate(login.creation_date)}
                        </div>
                      </td>
                      <td>
                        {login.router_name ? (
                          <Link 
                            to={`/router/${login.router_id}`}
                            className="router-link"
                          >
                            {login.router_name}
                          </Link>
                        ) : (
                          <span className="not-linked">
                            {login.ap_mac || 'Unknown'}
                          </span>
                        )}
                      </td>
                      <td>{login.router_location || '-'}</td>
                      <td>
                        <code className="mac-address">{login.client_mac || '-'}</code>
                      </td>
                      <td>{login.public_ip || '-'}</td>
                      <td>{login.captive_portal_name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Routers Tab */}
      {activeTab === 'routers' && (
        <div className="guest-panel">
          {routerSummary.length === 0 ? (
            <div className="guest-empty">
              <p>No router connections found</p>
              <p className="empty-hint">This user hasn't been linked to any routers yet</p>
            </div>
          ) : (
            <div className="router-cards">
              {routerSummary.map((router, index) => (
                <div key={router.router_id || index} className="router-card">
                  <div className="router-card-header">
                    <Link 
                      to={`/router/${router.router_id}`}
                      className="router-card-name"
                    >
                      📡 {router.router_name}
                    </Link>
                    <span className="router-login-count">
                      {router.login_count} login{router.login_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="router-card-body">
                    {router.router_location && (
                      <div className="router-card-location">
                        📍 {router.router_location}
                      </div>
                    )}
                    <div className="router-card-dates">
                      <span>First: {formatDate(router.first_login)}</span>
                      <span>Last: {formatDate(router.last_login)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Devices Tab */}
      {activeTab === 'devices' && (
        <div className="guest-panel">
          {devices.length === 0 ? (
            <div className="guest-empty">
              <p>No devices found</p>
              <p className="empty-hint">Device MAC addresses are captured from login data</p>
            </div>
          ) : (
            <div className="device-cards">
              {devices.map((device, index) => (
                <div key={device.client_mac || index} className="device-card">
                  <div className="device-card-icon">📱</div>
                  <div className="device-card-content">
                    <code className="device-mac">{device.client_mac}</code>
                    <div className="device-stats">
                      <span>{device.login_count} login{device.login_count !== 1 ? 's' : ''}</span>
                      <span>•</span>
                      <span>First: {formatRelativeTime(device.first_seen)}</span>
                      <span>•</span>
                      <span>Last: {formatRelativeTime(device.last_seen)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WifiGuestDetail;

