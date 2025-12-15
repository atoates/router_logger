import React, { useState } from 'react';
import { unlinkRouterFromLocation } from '../services/api';
import './RouterDetailModal.css';

function RouterDetailModal({ router, onClose, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  if (!router) return null;

  // Handle various formats: 'online', 'offline', 1, 0, '1', '0', true, false, 'Online'
  const state = router.current_status || router.current_state;
  const isOnline = state === 'online' || 
                   state === 'Online' ||
                   state === 1 || 
                   state === '1' || 
                   state === true ||
                   (typeof state === 'string' && state.toLowerCase() === 'online');

  // Determine router status
  const taskStatus = router.clickup_task_status?.toLowerCase() || '';
  const hasLocation = !!router.clickup_location_task_id;
  const isInstalled = hasLocation && (taskStatus === 'installed' || taskStatus === '');
  const isBeingReturned = taskStatus === 'being returned';
  const isDecommissioned = taskStatus === 'decommissioned';
  const isReady = taskStatus === 'ready';

  const handleUninstall = async () => {
    if (!window.confirm(`Are you sure you want to uninstall router #${router.router_id}? This will unlink it from its current location.`)) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      await unlinkRouterFromLocation(router.router_id, {
        notes: 'Uninstalled via mobile app'
      });

      setSuccess('Router uninstalled successfully');
      
      // Refresh router data
      if (onUpdate) {
        await onUpdate();
      }
      
      // Close modal after a short delay
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to uninstall router');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateValue) => {
    if (!dateValue) return 'N/A';
    try {
      let date;
      // Handle numeric strings (BIGINT from PostgreSQL)
      if (typeof dateValue === 'string' && /^\d+$/.test(dateValue)) {
        const numValue = Number(dateValue);
        date = new Date(numValue > 1000000000000 ? numValue : numValue * 1000);
      } else if (typeof dateValue === 'number') {
        date = new Date(dateValue > 1000000000000 ? dateValue : dateValue * 1000);
      } else {
        date = new Date(dateValue);
      }
      
      if (isNaN(date.getTime())) return 'Invalid date';
      
      return date.toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return 'Invalid date';
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Router #{router.router_id}</h2>
          <button 
            className="modal-close" 
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="alert alert-error">
              {error}
            </div>
          )}

          {success && (
            <div className="alert alert-success">
              {success}
            </div>
          )}

          {/* Status Badge */}
          <div className="detail-section">
            <div className="status-badge-container">
              <span className={`status-badge ${isOnline ? 'status-online' : 'status-offline'}`}>
                {isOnline ? '● Online' : '○ Offline'}
              </span>
              {isInstalled && (
                <span className="status-badge status-installed">Installed</span>
              )}
              {isBeingReturned && (
                <span className="status-badge status-returning">Being Returned</span>
              )}
              {isDecommissioned && (
                <span className="status-badge status-decommissioned">Decommissioned</span>
              )}
              {isReady && (
                <span className="status-badge status-ready">Ready</span>
              )}
            </div>
          </div>

          {/* Basic Info */}
          <div className="detail-section">
            <h3>Basic Information</h3>
            <div className="detail-row">
              <span className="detail-label">Router ID:</span>
              <span className="detail-value">#{router.router_id}</span>
            </div>
            {router.name && (
              <div className="detail-row">
                <span className="detail-label">Name:</span>
                <span className="detail-value">{router.name}</span>
              </div>
            )}
            {router.firmware_version && (
              <div className="detail-row">
                <span className="detail-label">Firmware:</span>
                <span className="detail-value">{router.firmware_version}</span>
              </div>
            )}
            <div className="detail-row">
              <span className="detail-label">Last Seen:</span>
              <span className="detail-value">{formatDate(router.last_seen)}</span>
            </div>
          </div>

          {/* Location Info */}
          {hasLocation && (
            <div className="detail-section">
              <h3>Location</h3>
              <div className="detail-row">
                <span className="detail-label">Location:</span>
                <span className="detail-value">{router.clickup_location_task_name || 'Unknown'}</span>
              </div>
              {router.location_linked_at && (
                <div className="detail-row">
                  <span className="detail-label">Linked At:</span>
                  <span className="detail-value">{formatDate(router.location_linked_at)}</span>
                </div>
              )}
              {router.date_installed && (
                <div className="detail-row">
                  <span className="detail-label">Installed:</span>
                  <span className="detail-value">{formatDate(router.date_installed)}</span>
                </div>
              )}
            </div>
          )}

          {/* Assignees */}
          {router.clickup_assignees && (
            <div className="detail-section">
              <h3>Assigned To</h3>
              <div className="detail-row">
                <span className="detail-value">
                  {(() => {
                    try {
                      let assignees = router.clickup_assignees;
                      if (typeof assignees === 'string') {
                        assignees = JSON.parse(assignees);
                      }
                      if (Array.isArray(assignees)) {
                        return assignees.map(a => a.username || a.name || a).join(', ') || 'None';
                      }
                      return assignees || 'None';
                    } catch {
                      return router.clickup_assignees || 'None';
                    }
                  })()}
                </span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="detail-section">
            <h3>Actions</h3>
            {isInstalled && (
              <button
                onClick={handleUninstall}
                disabled={loading}
                className="action-button action-button-danger"
              >
                {loading ? 'Uninstalling...' : 'Uninstall Router'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RouterDetailModal;

