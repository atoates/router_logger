import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import api from '../services/api';
// Reuse returns page styling for consistent cards
import './ReturnsPage.css';
import './DecommissionedPage.css';

function DecommissionedPage() {
  const [routers, setRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingNotes, setEditingNotes] = useState({});
  const [savingNotes, setSavingNotes] = useState({});
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
      toast.success('Router reactivated successfully and marked as ready for deployment');
    } catch (err) {
      console.error('Error reactivating router:', err);
      toast.error(`Failed to reactivate router: ${err.message}`);
    }
  };

  const handleNotesChange = (routerId, value) => {
    setEditingNotes(prev => ({
      ...prev,
      [routerId]: value
    }));
  };

  const saveNotes = async (routerId) => {
    try {
      setSavingNotes(prev => ({ ...prev, [routerId]: true }));
      
      const res = await api.patch(`/routers/${routerId}/notes`, {
        notes: editingNotes[routerId] !== undefined ? editingNotes[routerId] : ''
      });

      const data = res.data;
      
      if (data.success) {
        // Update the router in state
        setRouters(prev => prev.map(r => 
          r.router_id === routerId ? data.router : r
        ));
        // Clear the editing state for this router
        setEditingNotes(prev => {
          const next = { ...prev };
          delete next[routerId];
          return next;
        });
        toast.success('Notes saved');
      } else {
        toast.error('Failed to save notes');
      }
    } catch (error) {
      console.error('Error saving notes:', error);
      toast.error('Failed to save notes');
    } finally {
      setSavingNotes(prev => ({ ...prev, [routerId]: false }));
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
              </div>

              <div className="return-notes">
                <label htmlFor={`notes-${router.router_id}`}>Notes:</label>
                <textarea
                  id={`notes-${router.router_id}`}
                  value={editingNotes[router.router_id] !== undefined ? editingNotes[router.router_id] : (router.notes || '')}
                  onChange={(e) => handleNotesChange(router.router_id, e.target.value)}
                  placeholder="Add notes about this decommissioned router..."
                  rows={3}
                  disabled={savingNotes[router.router_id]}
                  onClick={(e) => e.stopPropagation()}
                />
                <button 
                  onClick={(e) => { e.stopPropagation(); saveNotes(router.router_id); }}
                  className="btn-save-notes"
                  disabled={savingNotes[router.router_id]}
                >
                  {savingNotes[router.router_id] ? 'Saving...' : '💾 Save Notes'}
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
