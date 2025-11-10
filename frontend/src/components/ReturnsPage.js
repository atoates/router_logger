import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import api from '../services/api';
import './ReturnsPage.css';

function ReturnsPage() {
  const [routers, setRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState({});
  const [savingNotes, setSavingNotes] = useState({});

  useEffect(() => {
    loadReturns();
  }, []);

  const loadReturns = async () => {
    try {
      setLoading(true);
      const res = await api.get('/routers/being-returned');
      const data = res.data;
      
      if (data.success) {
        setRouters(data.routers);
      } else {
        toast.error('Failed to load returns');
      }
    } catch (error) {
      console.error('Error loading returns:', error);
      toast.error('Failed to load returns');
    } finally {
      setLoading(false);
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
        notes: editingNotes[routerId] || ''
      });

      const data = res.data;
      
      if (data.success) {
        // Update the router in state
        setRouters(prev => prev.map(r => 
          r.router_id === routerId ? data.router : r
        ));
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

  const markAsInstalled = async (routerId) => {
    if (!window.confirm('Mark this router as installed? It will be removed from the returns list.')) {
      return;
    }

    try {
      const res = await api.patch(`/routers/${routerId}/status`, {
        status: 'installed'
      });

      const data = res.data;
      
      if (data.success) {
        toast.success('Router marked as installed');
        loadReturns(); // Reload the list
      } else {
        toast.error('Failed to update status');
      }
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status');
    }
  };

  const getStatusBadge = (status) => {
    if (!status) return <span className="status-badge status-unknown">Unknown</span>;
    
    const isOnline = ['online', 'Online', '1'].includes(status);
    return (
      <span className={`status-badge ${isOnline ? 'status-online' : 'status-offline'}`}>
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
      <div className="returns-page">
        <div className="returns-loading">Loading returns...</div>
      </div>
    );
  }

  return (
    <div className="returns-page">
      <div className="returns-header">
        <h1>🔄 Routers Being Returned</h1>
        <div className="returns-count">
          {routers.length} router{routers.length !== 1 ? 's' : ''} being returned
        </div>
      </div>

      {routers.length === 0 ? (
        <div className="returns-empty">
          <p>No routers currently marked as being returned</p>
        </div>
      ) : (
        <div className="returns-list">
          {routers.map(router => (
            <div key={router.router_id} className="return-card">
              <div className="return-header">
                <div className="return-title">
                  <h3>{router.name || router.router_id}</h3>
                  {getStatusBadge(router.current_status)}
                </div>
                <button 
                  onClick={() => markAsInstalled(router.router_id)}
                  className="btn-mark-installed"
                  title="Mark as installed"
                >
                  ✅ Mark Installed
                </button>
              </div>

              <div className="return-details">
                <div className="detail-row">
                  <span className="detail-label">Router ID:</span>
                  <span className="detail-value">{router.router_id}</span>
                </div>
                {router.serial && (
                  <div className="detail-row">
                    <span className="detail-label">Serial:</span>
                    <span className="detail-value">{router.serial}</span>
                  </div>
                )}
                {router.imei && (
                  <div className="detail-row">
                    <span className="detail-label">IMEI:</span>
                    <span className="detail-value">{router.imei}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="detail-label">Last Seen:</span>
                  <span className="detail-value">{formatDate(router.last_seen)}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Updated:</span>
                  <span className="detail-value">{formatDate(router.updated_at)}</span>
                </div>
              </div>

              <div className="return-notes">
                <label htmlFor={`notes-${router.router_id}`}>Notes:</label>
                <textarea
                  id={`notes-${router.router_id}`}
                  value={editingNotes[router.router_id] !== undefined ? editingNotes[router.router_id] : (router.notes || '')}
                  onChange={(e) => handleNotesChange(router.router_id, e.target.value)}
                  placeholder="Add notes about this return..."
                  rows={3}
                  disabled={savingNotes[router.router_id]}
                />
                <button 
                  onClick={() => saveNotes(router.router_id)}
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

export default ReturnsPage;
