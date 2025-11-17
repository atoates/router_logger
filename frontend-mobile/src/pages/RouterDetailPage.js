import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRouters, unlinkRouterFromLocation, removeRouterAssignees } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import './RouterDetailPage.css';

function RouterDetailPage() {
  const { routerId } = useParams();
  const navigate = useNavigate();
  const [router, setRouter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const { isAdmin } = useAuth();

  useEffect(() => {
    fetchRouter();
  }, [routerId]);

  const fetchRouter = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getRouters();
      const routers = Array.isArray(response.data) ? response.data : [];
      const found = routers.find(r => r.router_id.toString() === routerId);
      
      if (!found) {
        setError('Router not found');
        return;
      }
      
      setRouter(found);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load router');
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = async () => {
    if (!window.confirm(`Are you sure you want to uninstall router #${router.router_id}? This will unlink it from its current location.`)) {
      return;
    }

    try {
      setUninstalling(true);
      setError(null);

      await unlinkRouterFromLocation(router.router_id, {
        notes: 'Uninstalled via mobile app'
      });

      // Refresh router data
      await fetchRouter();
      
      alert('Router uninstalled successfully');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to uninstall router');
    } finally {
      setUninstalling(false);
    }
  };

  const handleUnassign = async () => {
    if (!window.confirm(`Are you sure you want to unassign router #${router.router_id}?`)) {
      return;
    }

    try {
      setUnassigning(true);
      setError(null);

      await removeRouterAssignees(router.router_id);

      // Refresh router data
      await fetchRouter();
      
      alert('Router unassigned successfully');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to unassign router');
    } finally {
      setUnassigning(false);
    }
  };

  const handleAssign = () => {
    // Navigate to location page where assignment can be handled
    navigate(`/location?routerId=${router.router_id}`);
  };

  const handleInstall = () => {
    // Navigate to location page where installation can be handled
    navigate(`/location?routerId=${router.router_id}`);
  };

  const getAssignees = () => {
    if (!router.clickup_assignees) return null;
    
    try {
      let assignees = router.clickup_assignees;
      if (typeof assignees === 'string') {
        assignees = JSON.parse(assignees);
      }
      if (Array.isArray(assignees) && assignees.length > 0) {
        return assignees;
      }
      return null;
    } catch {
      return null;
    }
  };

  const hasAssignees = () => {
    const assignees = getAssignees();
    return assignees && assignees.length > 0;
  };

  const formatDate = (dateValue) => {
    if (!dateValue) return 'N/A';
    try {
      return new Date(dateValue).toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return 'Invalid date';
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <LoadingSpinner text="Loading router..." />
      </div>
    );
  }

  if (error && !router) {
    return (
      <div className="page-container">
        <ErrorMessage message={error} onRetry={fetchRouter} />
      </div>
    );
  }

  if (!router) {
    return (
      <div className="page-container">
        <ErrorMessage message="Router not found" />
      </div>
    );
  }

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

  return (
    <div className="page-container">
      <div className="page-header">
        <button 
          onClick={() => navigate(-1)}
          className="back-button"
        >
          ← Back
        </button>
        <h1>Router #{router.router_id}</h1>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {/* Status Badges */}
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
        <h2>Basic Information</h2>
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
          <h2>Location</h2>
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
      <div className="detail-section">
        <h2>Assigned To</h2>
        <div className="detail-row">
          <span className="detail-value">
            {hasAssignees() ? (
              getAssignees().map(a => a.username || a.name || a).join(', ')
            ) : (
              'Not assigned'
            )}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="detail-section">
        <h2>Actions</h2>
        {isAdmin && (
          <>
            {/* If router has assignees, show unassign button */}
            {hasAssignees() ? (
              <button
                onClick={handleUnassign}
                disabled={unassigning}
                className="action-button action-button-warning"
              >
                {unassigning ? 'Unassigning...' : 'Unassign Router'}
              </button>
            ) : (
              /* If router is not installed, show assign button */
              !hasLocation && (
                <button
                  onClick={handleAssign}
                  disabled={assigning}
                  className="action-button action-button-primary"
                >
                  Assign Router
                </button>
              )
            )}
            
            {/* If router has a location, show uninstall button */}
            {hasLocation ? (
              <button
                onClick={handleUninstall}
                disabled={uninstalling}
                className="action-button action-button-danger"
              >
                {uninstalling ? 'Uninstalling...' : 'Uninstall Router'}
              </button>
            ) : (
              /* If router has no assignees, show install button */
              !hasAssignees() && (
                <button
                  onClick={handleInstall}
                  disabled={assigning}
                  className="action-button action-button-primary"
                >
                  Install Router
                </button>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default RouterDetailPage;




