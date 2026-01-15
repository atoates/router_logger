import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
// Reuse returns page styling for consistent cards
import './ReturnsPage.css';
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
      // Don't set error for 401 - the interceptor handles redirect to login
      if (err.response?.status === 401) {
        return;
      }
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
    <div className="returns-page">{/* reuse layout container */}
      <div className="returns-header">
        <h1>⚠️ Decommissioned Routers</h1>
        <div className="returns-count">
          {routers.length} router{routers.length !== 1 ? 's' : ''} decommissioned
        </div>
      </div>

      <div className="search-bar" style={{ marginBottom: '24px' }}>
        <input
          type="text"
          placeholder="Search by Router ID, name, or IMEI..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {filteredRouters.length === 0 ? (
        <div className="returns-empty">
          {searchTerm ? 'No matching routers found' : 'No decommissioned routers'}
        </div>
      ) : (
        <div className="returns-list">
          {filteredRouters.map(router => (
            <div key={router.router_id} className="return-card" onClick={() => handleRouterClick(router.router_id)}>
              <div className="return-header">
                <div className="return-title">
                  <h3>{router.name || `Router #${router.router_id}`}</h3>
                  <span className="status-badge status-offline">Decommissioned</span>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleReactivate(router.router_id, e); }}
                  className="btn-mark-installed btn-reactivate"
                  title="Reactivate router"
                >
                  ♻️ Reactivate
                </button>
              </div>

              <div className="return-details">
                <div className="detail-row">
                  <span className="detail-label">Router ID:</span>
                  <span className="detail-value">{router.router_id}</span>
                </div>
                {router.imei && (
                  <div className="detail-row">
                    <span className="detail-label">IMEI:</span>
                    <span className="detail-value">{router.imei}</span>
                  </div>
                )}
                {router.firmware_version && (
                  <div className="detail-row">
                    <span className="detail-label">Firmware:</span>
                    <span className="detail-value">{router.firmware_version}</span>
                  </div>
                )}
                {router.clickup_task_url && (
                  <div className="detail-row">
                    <span className="detail-label">ClickUp Task:</span>
                    <span className="detail-value">
                      <a
                        href={router.clickup_task_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: '#60a5fa', textDecoration: 'none' }}
                      >
                        View Task →
                      </a>
                    </span>
                  </div>
                )}
                {router.notes && (
                  <div className="detail-row notes-row">
                    <span className="detail-label">Notes:</span>
                    <span className="detail-value notes-value">{router.notes}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DecommissionedPage;
