import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getRouters, unlinkRouterFromLocation, removeRouterAssignees, getUsageStats } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import StatusBadge, { OnlineIndicator, getRouterStatus } from '../components/StatusBadge';
import AssignmentModal from '../components/AssignmentModal';
import './RouterDetailPage.css';

function RouterDetailPage() {
  const { routerId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [router, setRouter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [usageStats, setUsageStats] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState(null);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const { isAdmin } = useAuth();

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const shouldRefresh = searchParams.get('refresh');
    fetchRouter(!!shouldRefresh);
  }, [routerId, location.search]);

  // Refresh router data when component becomes visible (e.g., after navigation)
  useEffect(() => {
    const handleFocus = () => {
      if (routerId) {
        fetchRouter(true); // Force refresh to get latest assignee info
      }
    };
    
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [routerId]);

  const fetchRouter = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const response = await getRouters(forceRefresh);
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

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const fetchUsageStats = async (routerIdValue) => {
    try {
      setUsageLoading(true);
      setUsageError(null);

      const end = new Date();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

      const res = await getUsageStats({
        router_id: routerIdValue,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
      });

      const stats = res?.data?.data?.[0] || null;
      setUsageStats(stats);
    } catch (err) {
      setUsageStats(null);
      setUsageError(err.response?.data?.error || 'Failed to load usage stats');
    } finally {
      setUsageLoading(false);
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
      await fetchRouter(true);
      
      // Show assignment modal instead of just alert
      setShowAssignmentModal(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to uninstall router');
    } finally {
      setUninstalling(false);
    }
  };

  const handleAssignmentComplete = (result) => {
    setShowAssignmentModal(false);
    // Refresh router data to show new assignee
    fetchRouter(true);
  };

  const handleAssignmentClose = () => {
    setShowAssignmentModal(false);
  };

  const handleUnassign = async () => {
    if (!window.confirm(`Are you sure you want to unassign router #${router.router_id}?`)) {
      return;
    }

    try {
      setUnassigning(true);
      setError(null);

      await removeRouterAssignees(router.router_id);

      // Optimistic UI: clear assignees immediately
      setRouter(prev => (prev ? { ...prev, clickup_assignees: null } : prev));

      // Refresh router data
      await fetchRouter(true);
      
      alert('Router unassigned successfully');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to unassign router');
    } finally {
      setUnassigning(false);
    }
  };

  const handleAssign = () => {
    // Navigate to assign page for assigning router to a person
    navigate(`/assign?routerId=${router.router_id}`);
  };

  const handleInstall = () => {
    // Navigate to location page for linking router to a location
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

  const formatDate = (dateValue, includeTime = false) => {
    if (!dateValue) return 'N/A';
    try {
      // Handle different date formats
      let date;
      if (dateValue instanceof Date) {
        date = dateValue;
      } else if (typeof dateValue === 'string') {
        date = new Date(dateValue);
      } else if (typeof dateValue === 'number') {
        // Handle Unix timestamp (seconds or milliseconds)
        date = new Date(dateValue > 1000000000000 ? dateValue : dateValue * 1000);
      } else {
        return 'Invalid date';
      }
      
      // Validate the date
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
      
      const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      };
      
      if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
      }
      
      return date.toLocaleDateString('en-GB', options);
    } catch (error) {
      console.error('Error formatting date:', error, dateValue);
      return 'Invalid date';
    }
  };

  // Fetch 24h usage + network stats once router is loaded
  useEffect(() => {
    if (!router?.router_id) return;
    fetchUsageStats(router.router_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router?.router_id]);

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

  // Get unified status
  const routerStatus = getRouterStatus(router);
  
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
        <div className="page-header-content">
          <h1>{router.name || `Router #${router.router_id}`}</h1>
          {router.name && (
            <p className="page-subtitle">#{router.router_id}</p>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {/* Status Badges - Unified */}
      <div className="detail-section">
        <div className="status-badge-container">
          <StatusBadge router={router} size="large" />
          <span className={`online-badge ${isOnline ? 'online-yes' : 'online-no'}`}>
            {isOnline ? '● Online' : '○ Offline'}
          </span>
        </div>
      </div>

      {/* Basic Info */}
      <div className="detail-section">
        <h2>Basic Information</h2>
        <div className="detail-row">
          <span className="detail-label">Router ID:</span>
          <span className="detail-value">#{router.router_id}</span>
        </div>
        {router.firmware_version && (
          <div className="detail-row">
            <span className="detail-label">Firmware:</span>
            <span className="detail-value">{router.firmware_version}</span>
          </div>
        )}
        <div className="detail-row">
          <span className="detail-label">Last Seen:</span>
          <span className="detail-value">{formatDate(router.last_seen, true)}</span>
        </div>
      </div>

      {/* Data Usage + Network Stats (24h) */}
      <div className="detail-section">
        <h2>Data Usage & Network (24h)</h2>

        {usageError && (
          <div className="alert alert-error">{usageError}</div>
        )}

        {usageLoading ? (
          <LoadingSpinner text="Loading usage stats..." />
        ) : (
          <>
            <div className="detail-row">
              <span className="detail-label">Total Usage:</span>
              <span className="detail-value">{formatBytes(usageStats?.total_data_usage || 0)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Sent:</span>
              <span className="detail-value">↑ {formatBytes(usageStats?.period_tx_bytes || 0)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Received:</span>
              <span className="detail-value">↓ {formatBytes(usageStats?.period_rx_bytes || 0)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Operator:</span>
              <span className="detail-value">{router.operator || 'N/A'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">WAN IP:</span>
              <span className="detail-value">{router.wan_ip || 'N/A'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Cell:</span>
              <span className="detail-value">
                {router.cell_id || router.tac || router.mcc || router.mnc || router.earfcn || router.pc_id
                  ? `CID ${router.cell_id ?? 'N/A'} · TAC ${router.tac ?? 'N/A'} · MCC ${router.mcc ?? 'N/A'} · MNC ${router.mnc ?? 'N/A'} · EARFCN ${router.earfcn ?? 'N/A'} · PCI ${router.pc_id ?? 'N/A'}`
                  : 'N/A'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Avg Signal:</span>
              <span className="detail-value">
                {(usageStats?.avg_rsrp ?? null) !== null || (usageStats?.avg_rsrq ?? null) !== null || (usageStats?.avg_rssi ?? null) !== null || (usageStats?.avg_sinr ?? null) !== null
                  ? `RSRP ${usageStats?.avg_rsrp?.toFixed?.(1) ?? 'N/A'} · RSRQ ${usageStats?.avg_rsrq?.toFixed?.(1) ?? 'N/A'} · RSSI ${usageStats?.avg_rssi?.toFixed?.(1) ?? 'N/A'} · SINR ${usageStats?.avg_sinr?.toFixed?.(1) ?? 'N/A'}`
                  : 'N/A'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Avg Clients:</span>
              <span className="detail-value">{(usageStats?.avg_clients ?? null) === null ? 'N/A' : Number(usageStats.avg_clients).toFixed(1)}</span>
            </div>
          </>
        )}
      </div>

      {/* Location Info */}
      {hasLocation && (
        <div className="detail-section">
          <h2>Location</h2>
          <div className="detail-row">
            <span className="detail-label">Location:</span>
            <span className="detail-value">
              {router.clickup_location_task_id ? (
                <a
                  href={`https://app.clickup.com/t/${router.clickup_location_task_id}`}
                  className="detail-value-link"
                >
                  {router.clickup_location_task_name || 'Unknown'}
                </a>
              ) : (
                router.clickup_location_task_name || 'Unknown'
              )}
            </span>
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
          <div className="action-buttons">
            {/* Primary action based on state */}
            {hasLocation ? (
              // Installed router - primary action is Uninstall
              <button
                onClick={handleUninstall}
                disabled={uninstalling}
                className="action-button action-button-danger action-button-large"
              >
                {uninstalling ? '⏳ Uninstalling...' : '📤 Uninstall Router'}
              </button>
            ) : hasAssignees() ? (
              // Assigned but not installed - primary action is Install
              <button
                onClick={handleInstall}
                disabled={assigning}
                className="action-button action-button-primary action-button-large"
              >
                📍 Install at Location
              </button>
            ) : (
              // Not assigned, not installed - show both options
              <>
                <button
                  onClick={handleAssign}
                  disabled={assigning}
                  className="action-button action-button-primary action-button-large"
                >
                  👤 Assign Router
                </button>
                <button
                  onClick={handleInstall}
                  disabled={assigning}
                  className="action-button action-button-secondary"
                >
                  📍 Install at Location
                </button>
              </>
            )}
            
            {/* Secondary actions */}
            {hasAssignees() && !hasLocation && (
              <button
                onClick={handleUnassign}
                disabled={unassigning}
                className="action-button action-button-warning"
              >
                {unassigning ? 'Unassigning...' : '🔓 Unassign Router'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Assignment Modal - shown after uninstall */}
      {showAssignmentModal && router && (
        <AssignmentModal
          router={router}
          onClose={handleAssignmentClose}
          onAssigned={handleAssignmentComplete}
        />
      )}
    </div>
  );
}

export default RouterDetailPage;




