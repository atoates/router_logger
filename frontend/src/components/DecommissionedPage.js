import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './DecommissionedPage.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

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
      const response = await fetch(`${API_BASE}/api/routers/decommissioned`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch decommissioned routers');
      }
      
      const data = await response.json();
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
      const res = await fetch(`${API_BASE}/api/routers/${routerId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ 
          status: 'ready',
          notes: 'Reactivated from decommissioned status'
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to reactivate router');
      }

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
                <h3 className="router-id">{router.router_id}</h3>
                <span className="status-badge decommissioned">Decommissioned</span>
              </div>

              <div className="router-info">
                <div className="info-row">
                  <span className="info-label">Last Location:</span>
                  <span className="info-value">
                    {router.location_name || 'Unknown'}
                  </span>
                </div>

                <div className="info-row">
                  <span className="info-label">Last Seen:</span>
                  <span className="info-value">
                    {formatDate(router.last_seen)}
                  </span>
                </div>

                {router.notes && (
                  <div className="notes-section">
                    <span className="info-label">Notes:</span>
                    <p className="notes-text">{router.notes}</p>
                  </div>
                )}

                {router.clickup_task_id && (
                  <div className="info-row">
                    <span className="info-label">ClickUp Task:</span>
                    <span className="info-value task-id">
                      {router.clickup_task_id.substring(0, 8)}...
                    </span>
                  </div>
                )}
              </div>

              <div className="router-actions">
                <button
                  className="reactivate-button"
                  onClick={(e) => handleReactivate(router.router_id, e)}
                  title="Reactivate this router and mark as ready"
                >
                  ♻️ Reactivate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DecommissionedPage;
