import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './DecommissionedPage.css';

function DecommissionedPage() {
  const [routers, setRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchDecommissionedRouters();
  }, []);

  const fetchDecommissionedRouters = async () => {
    try {
      setLoading(true);
      const response = await api.get('/routers/decommissioned');
      const data = response.data;
      setRouters(data.routers || data);
      setError(null);
    } catch (err) {
      console.error('Error fetching decommissioned routers:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRouterClick = (routerId) => {
    navigate(`/?router=${routerId}`);
  };

  const handleReactivate = async (routerId, e) => {
    e.stopPropagation();
    
    if (!window.confirm('Are you sure you want to reactivate this router? It will be marked as "ready" and can be deployed again.')) {
      return;
    }

    try {
      await api.patch(`/routers/${routerId}/status`, { 
        status: 'ready',
        notes: 'Reactivated from decommissioned status'
      });

      // Refresh the list
      await fetchDecommissionedRouters();
      alert('Router reactivated successfully and marked as ready for deployment');
    } catch (err) {
      console.error('Error reactivating router:', err);
      alert(`Failed to reactivate router: ${err.message}`);
    }
  };

  const filteredRouters = routers.filter(router => 
    router.router_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    router.location_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    router.notes?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="decommissioned-page">
        <div className="loading">Loading decommissioned routers...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="decommissioned-page">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="decommissioned-page">
      <div className="decommissioned-header">
        <div className="header-content">
          <h1>⚠️ Decommissioned Routers</h1>
          <p className="subtitle">
            {routers.length} router{routers.length !== 1 ? 's' : ''} permanently retired
          </p>
        </div>
        <button className="back-button" onClick={() => navigate('/')}>
          ← Back to Dashboard
        </button>
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Search by Router ID, location, or notes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {filteredRouters.length === 0 ? (
        <div className="no-routers">
          {searchTerm ? 'No matching routers found' : 'No decommissioned routers'}
        </div>
      ) : (
        <div className="routers-grid">
          {filteredRouters.map(router => (
            <div 
              key={router.id} 
              className="router-card"
              onClick={() => handleRouterClick(router.router_id)}
            >
              <div className="router-header">
                <h3 className="router-id">{router.name || `Router #${router.router_id}`}</h3>
                <span className="status-badge decommissioned">Decommissioned</span>
              </div>

              <div className="router-info">
                <div className="info-row">
                  <span className="info-label">Serial:</span>
                  <span className="info-value">{router.router_id || 'N/A'}</span>
                </div>

                <div className="info-row">
                  <span className="info-label">IMEI:</span>
                  <span className="info-value">{router.imei || 'N/A'}</span>
                </div>

                <div className="info-row">
                  <span className="info-label">Firmware:</span>
                  <span className="info-value">{router.firmware_version || 'N/A'}</span>
                </div>

                {router.clickup_task_url && (
                  <div className="info-row">
                    <span className="info-label">ClickUp Task:</span>
                    <a 
                      href={router.clickup_task_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="info-value"
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: '#60a5fa', textDecoration: 'none' }}
                    >
                      View Task →
                    </a>
                  </div>
                )}
              </div>

              <button
                className="reactivate-button"
                onClick={(e) => handleReactivate(router.router_id, e)}
                title="Reactivate this router and mark as ready"
              >
                ♻️ Reactivate
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DecommissionedPage;
