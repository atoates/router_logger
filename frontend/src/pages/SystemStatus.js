import React, { useState, useEffect } from 'react';
import { 
  getRouters, 
  getStorageStats, 
  getInspectionStatus, 
  getRMSUsage, 
  getClickUpUsage, 
  getRouterStatusSummary,
  getClickUpAuthStatus,
  getIronwifiStatus
} from '../services/api';
import api from '../services/api';
import './SystemStatus.css';

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
  return n + ' B';
}

function formatTimeAgo(dateString) {
  if (!dateString) return 'Never';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'Invalid date';
  }
}

function StatusBadge({ status, label }) {
  const isHealthy = status === 'healthy' || status === 'OK' || status === 'connected' || status === 'enabled';
  return (
    <div className={`status-badge ${isHealthy ? 'status-healthy' : 'status-warning'}`}>
      <span className="status-indicator">{isHealthy ? '🟢' : '🔴'}</span>
      <span className="status-label">{label}</span>
    </div>
  );
}

function MetricCard({ label, value, sub, icon, color }) {
  return (
    <div className="metric-card" style={{ borderLeftColor: color }}>
      <div className="metric-header">
        {icon && <span className="metric-icon">{icon}</span>}
        <span className="metric-label">{label}</span>
      </div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

function CollapsibleSection({ title, children, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="collapsible-section">
      <button 
        className="collapsible-header"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h2>{title}</h2>
        <span className="collapsible-icon">{isOpen ? '▼' : '▶'}</span>
      </button>
      {isOpen && <div className="collapsible-content">{children}</div>}
    </div>
  );
}

export default function SystemStatusPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  
  // System Health
  const [apiHealth, setApiHealth] = useState(null);
  const [dbHealth, setDbHealth] = useState(null);
  
  // Integrations
  const [rmsStatus, setRmsStatus] = useState(null);
  const [clickupStatus, setClickupStatus] = useState(null);
  const [rmsUsage, setRmsUsage] = useState(null);
  const [clickupUsage, setClickupUsage] = useState(null);
  const [ironwifiStatus, setIronwifiStatus] = useState(null);
  
  // Database
  const [storage, setStorage] = useState(null);
  const [dbSize, setDbSize] = useState(null);
  const [inspections, setInspections] = useState([]);
  
  // Routers
  const [routers, setRouters] = useState([]);
  const [statusSummary, setStatusSummary] = useState(null);

  useEffect(() => {
    fetchAllData();
    
    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchAllData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch all data in parallel
      const [
        routersRes,
        storageRes,
        dbSizeRes,
        inspectionsRes,
        rmsUsageRes,
        clickupUsageRes,
        statusSummaryRes,
        clickupAuthRes,
        rmsStatusRes,
        dbHealthRes,
        apiHealthRes,
        ironwifiStatusRes
      ] = await Promise.allSettled([
        getRouters(),
        getStorageStats({ sample_size: 800 }),
        api.get('/stats/db-size'),
        getInspectionStatus(),
        getRMSUsage(),
        getClickUpUsage(),
        getRouterStatusSummary(),
        getClickUpAuthStatus(),
        api.get('/rms/status'),
        api.get('/monitoring/db-health'),
        api.get('/health'),
        getIronwifiStatus()
      ]);
      
      if (routersRes.status === 'fulfilled') setRouters(routersRes.value.data || []);
      if (storageRes.status === 'fulfilled') setStorage(storageRes.value.data || null);
      if (dbSizeRes.status === 'fulfilled') setDbSize(dbSizeRes.value.data || null);
      if (inspectionsRes.status === 'fulfilled') setInspections(inspectionsRes.value.data || []);
      if (rmsUsageRes.status === 'fulfilled') setRmsUsage(rmsUsageRes.value.data || null);
      if (clickupUsageRes.status === 'fulfilled') setClickupUsage(clickupUsageRes.value.data || null);
      if (statusSummaryRes.status === 'fulfilled') setStatusSummary(statusSummaryRes.value.data || null);
      if (clickupAuthRes.status === 'fulfilled') setClickupStatus(clickupAuthRes.value.data || null);
      if (rmsStatusRes.status === 'fulfilled') setRmsStatus(rmsStatusRes.value.data || null);
      if (dbHealthRes.status === 'fulfilled') setDbHealth(dbHealthRes.value.data || null);
      if (apiHealthRes.status === 'fulfilled') setApiHealth(apiHealthRes.value.data || null);
      if (ironwifiStatusRes.status === 'fulfilled') setIronwifiStatus(ironwifiStatusRes.value.data || null);
      
      setLastUpdated(new Date());
      
    } catch (err) {
      // Don't set error for 401 - the interceptor handles redirect to login
      if (err.response?.status === 401) {
        return;
      }
      console.error('Error fetching system status:', err);
      setError(err.message || 'Failed to load system status');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !routers.length) {
    return (
      <div className="system-status-page">
        <div className="status-loading">
          <div className="loading-spinner"></div>
          <p>Loading system status...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="system-status-page">
        <div className="status-error">
          <span className="error-icon">⚠️</span>
          <p>Error: {error}</p>
          <button onClick={fetchAllData} className="retry-button">Retry</button>
        </div>
      </div>
    );
  }

  // Calculate router stats
  const onlineRouters = routers.filter(r => {
    const status = r.current_status;
    return status === 'online' || status === 1 || status === '1' || status === true;
  }).length;
  const offlineRouters = routers.length - onlineRouters;
  const installedRouters = routers.filter(r => 
    r.clickup_task_status?.toLowerCase() === 'installed'
  ).length;

  // Calculate total logs from db health (more accurate)
  const totalLogs = dbHealth?.database?.totalLogs || storage?.total_logs || 0;

  // Overall system health
  const allHealthy = 
    (apiHealth?.status === 'healthy' || apiHealth?.status === 'OK') &&
    (dbHealth?.status === 'healthy' || dbHealth?.status === 'OK') &&
    (!rmsStatus || rmsStatus.enabled) &&
    (clickupStatus?.connected) &&
    (!ironwifiStatus || !ironwifiStatus.configured || ironwifiStatus.apiConnected);

  return (
    <div className="system-status-page">
      <div className="status-header">
        <div>
          <h1>System Status</h1>
          {lastUpdated && (
            <p className="last-updated">Last updated: {formatTimeAgo(lastUpdated)}</p>
          )}
        </div>
        <button onClick={fetchAllData} className="refresh-button" disabled={loading}>
          {loading ? '🔄 Refreshing...' : '🔄 Refresh'}
        </button>
      </div>

      {/* Overall Health Alert */}
      <div className={`health-alert ${allHealthy ? 'healthy' : 'warning'}`}>
        <span className="alert-icon">{allHealthy ? '✅' : '⚠️'}</span>
        <div className="alert-content">
          <h3>{allHealthy ? 'All Systems Operational' : 'System Issues Detected'}</h3>
          <p>{allHealthy ? 'Everything is running smoothly' : 'Some services may need attention'}</p>
        </div>
      </div>

      {/* System Health Overview */}
      <div className="status-section">
        <h2>System Health</h2>
        <div className="status-grid">
          <StatusBadge 
            status={apiHealth?.status || 'unknown'} 
            label="API Server" 
          />
          <StatusBadge 
            status={dbHealth?.status || 'unknown'} 
            label="Database" 
          />
          <StatusBadge 
            status={rmsStatus?.enabled ? 'enabled' : 'disabled'} 
            label="RMS Integration" 
          />
          <StatusBadge 
            status={clickupStatus?.connected ? 'connected' : 'disconnected'} 
            label="ClickUp Integration" 
          />
          <StatusBadge 
            status={ironwifiStatus?.configured ? (ironwifiStatus.apiConnected ? 'connected' : 'disconnected') : 'disabled'} 
            label="IronWifi Integration" 
          />
        </div>
      </div>

      {/* Key Metrics */}
      <div className="status-section">
        <h2>Key Metrics</h2>
        <div className="metrics-grid">
          <MetricCard
            label="Total Routers"
            value={routers.length}
            sub={`${onlineRouters} online, ${offlineRouters} offline`}
            icon="📡"
            color="#5a7c5b"
          />
          <MetricCard
            label="Installed Routers"
            value={installedRouters}
            sub={statusSummary ? `${statusSummary.current?.online || 0} online now` : ''}
            icon="🏠"
            color="#7c9a5a"
          />
          <MetricCard
            label="Total Logs"
            value={totalLogs.toLocaleString()}
            sub={storage ? formatBytes(storage.total_size || 0) : 'Loading...'}
            icon="📊"
            color="#9a7c5a"
          />
          <MetricCard
            label="Database Size"
            value={dbSize ? formatBytes(dbSize.db_bytes || 0) : 'Loading...'}
            sub={dbSize ? `${dbSize.tables?.length || 0} tables` : ''}
            icon="💾"
            color="#7c5a9a"
          />
        </div>
      </div>

      {/* Database Health Checks */}
      {inspections && inspections.length > 0 && (
        <div className="status-section">
          <h2>Health Checks</h2>
          <div className="health-checks-grid">
            {inspections.map((inspection, i) => (
              <div key={i} className={`health-check ${inspection.status === 'healthy' ? 'healthy' : 'warning'}`}>
                <span className="check-icon">{inspection.status === 'healthy' ? '✓' : '⚠'}</span>
                <div className="check-content">
                  <div className="check-name">{inspection.check_name}</div>
                  {inspection.description && (
                    <div className="check-description">{inspection.description}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Integrations - Collapsible */}
      <CollapsibleSection title="Integration Status" defaultOpen={true}>
        <div className="integrations-grid">
          {/* RMS Integration */}
          {rmsStatus && (
            <div className="integration-card">
              <div className="integration-header">
                <div className="integration-title">
                  <span className="integration-icon">🔌</span>
                  <h3>RMS Integration</h3>
                </div>
                <StatusBadge 
                  status={rmsStatus.enabled ? 'enabled' : 'disabled'} 
                  label={rmsStatus.enabled ? 'Enabled' : 'Disabled'} 
                />
              </div>
              {rmsStatus.enabled && rmsStatus.syncStats && (
                <div className="integration-details">
                  <div className="detail-row">
                    <span className="detail-label">Last Sync</span>
                    <span className="detail-value">
                      {formatTimeAgo(rmsStatus.syncStats.lastSyncTime)}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Sync Interval</span>
                    <span className="detail-value">{rmsStatus.syncInterval || 5} minutes</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Success Rate</span>
                    <span className="detail-value">
                      {rmsStatus.syncStats.lastSyncSuccess || 0}/{rmsStatus.syncStats.lastSyncTotal || 0} routers
                    </span>
                  </div>
                  {rmsStatus.syncStats.lastSyncErrors > 0 && (
                    <div className="detail-row error">
                      <span className="detail-label">Errors</span>
                      <span className="detail-value">{rmsStatus.syncStats.lastSyncErrors}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* ClickUp Integration */}
          {clickupStatus && (
            <div className="integration-card">
              <div className="integration-header">
                <div className="integration-title">
                  <span className="integration-icon">✓</span>
                  <h3>ClickUp Integration</h3>
                </div>
                <StatusBadge 
                  status={clickupStatus.connected ? 'connected' : 'disconnected'} 
                  label={clickupStatus.connected ? 'Connected' : 'Disconnected'} 
                />
              </div>
              {clickupUsage && clickupUsage.syncStats && (
                <div className="integration-details">
                  <div className="detail-row">
                    <span className="detail-label">Last Sync</span>
                    <span className="detail-value">
                      {formatTimeAgo(clickupUsage.syncStats.lastSyncTime)}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Total Syncs</span>
                    <span className="detail-value">{clickupUsage.syncStats.totalSyncs || 0}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Updated</span>
                    <span className="detail-value">{clickupUsage.syncStats.lastSyncUpdated || 0} routers</span>
                  </div>
                  {clickupUsage.syncStats.lastSyncErrors > 0 && (
                    <div className="detail-row error">
                      <span className="detail-label">Errors</span>
                      <span className="detail-value">{clickupUsage.syncStats.lastSyncErrors}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* IronWifi Integration */}
          {ironwifiStatus && (
            <div className="integration-card">
              <div className="integration-header">
                <div className="integration-title">
                  <span className="integration-icon">📶</span>
                  <h3>IronWifi Integration</h3>
                </div>
                <StatusBadge 
                  status={ironwifiStatus.configured ? (ironwifiStatus.apiConnected ? 'connected' : 'disconnected') : 'disabled'} 
                  label={!ironwifiStatus.configured ? 'Not Configured' : (ironwifiStatus.apiConnected ? 'Connected' : 'Disconnected')} 
                />
              </div>
              {ironwifiStatus.configured && (
                <div className="integration-details">
                  <div className="detail-row">
                    <span className="detail-label">Last Sync</span>
                    <span className="detail-value">
                      {formatTimeAgo(ironwifiStatus.lastSync)}
                    </span>
                  </div>
                  {ironwifiStatus.syncSchedulerRunning && (
                    <div className="detail-row">
                      <span className="detail-label">Sync Interval</span>
                      <span className="detail-value">{ironwifiStatus.syncInterval} minutes</span>
                    </div>
                  )}
                  {ironwifiStatus.sessionStats && (
                    <>
                      <div className="detail-row">
                        <span className="detail-label">Sessions (24h)</span>
                        <span className="detail-value">{parseInt(ironwifiStatus.sessionStats.total_sessions || 0).toLocaleString()}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Unique Users</span>
                        <span className="detail-value">{parseInt(ironwifiStatus.sessionStats.unique_users || 0).toLocaleString()}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Active Sessions</span>
                        <span className="detail-value">{parseInt(ironwifiStatus.sessionStats.active_sessions || 0).toLocaleString()}</span>
                      </div>
                    </>
                  )}
                  {ironwifiStatus.apiMessage && (
                    <div className="detail-row">
                      <span className="detail-label">Status</span>
                      <span className="detail-value">{ironwifiStatus.apiMessage}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* API Usage - Collapsible */}
      <CollapsibleSection title="API Usage Monitoring" defaultOpen={false}>
        <div className="usage-grid">
          {rmsUsage && rmsUsage.apiUsage && (
            <div className="usage-card">
              <h3>RMS API</h3>
              <div className="usage-details">
                <div className="usage-metric">
                  <span className="usage-label">Total Calls</span>
                  <span className="usage-value">{rmsUsage.apiUsage.total?.toLocaleString() || 0}</span>
                </div>
                {rmsUsage.apiUsage.estimates && (
                  <>
                    <div className="usage-metric">
                      <span className="usage-label">Daily Estimate</span>
                      <span className="usage-value">{rmsUsage.apiUsage.estimates.dailyRate?.toLocaleString() || 0}</span>
                    </div>
                    <div className="usage-metric">
                      <span className="usage-label">Monthly Estimate</span>
                      <span className="usage-value">{rmsUsage.apiUsage.estimates.monthlyRate?.toLocaleString() || 0}</span>
                    </div>
                    <div className="usage-metric">
                      <span className="usage-label">Quota Usage</span>
                      <span className="usage-value">{rmsUsage.apiUsage.estimates.percentOfQuota || '0%'}</span>
                    </div>
                    {rmsUsage.apiUsage.rateLimitHits > 0 && (
                      <div className="usage-metric error">
                        <span className="usage-label">Rate Limit Hits</span>
                        <span className="usage-value">{rmsUsage.apiUsage.rateLimitHits}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          
          {clickupUsage && clickupUsage.apiUsage && (
            <div className="usage-card">
              <h3>ClickUp API</h3>
              <div className="usage-details">
                <div className="usage-metric">
                  <span className="usage-label">Total Calls</span>
                  <span className="usage-value">{clickupUsage.apiUsage.total?.toLocaleString() || 0}</span>
                </div>
                {clickupUsage.apiUsage.estimates && (
                  <>
                    <div className="usage-metric">
                      <span className="usage-label">Rate per Minute</span>
                      <span className="usage-value">{clickupUsage.apiUsage.estimates.currentRatePerMinute || '0'}</span>
                    </div>
                    <div className="usage-metric">
                      <span className="usage-label">Daily Estimate</span>
                      <span className="usage-value">{clickupUsage.apiUsage.estimates.dailyRate?.toLocaleString() || 0}</span>
                    </div>
                    {clickupUsage.apiUsage.rateLimitHits > 0 && (
                      <div className="usage-metric error">
                        <span className="usage-label">Rate Limit Hits</span>
                        <span className="usage-value">{clickupUsage.apiUsage.rateLimitHits}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          
          {ironwifiStatus && ironwifiStatus.configured && ironwifiStatus.apiUsage && (
            <div className="usage-card">
              <h3>IronWifi API</h3>
              <div className="usage-details">
                <div className="usage-metric">
                  <span className="usage-label">Calls This Hour</span>
                  <span className="usage-value">{ironwifiStatus.apiUsage.callsMade?.toLocaleString() || 0}</span>
                </div>
                <div className="usage-metric">
                  <span className="usage-label">Hourly Limit</span>
                  <span className="usage-value">{ironwifiStatus.apiUsage.limit?.toLocaleString() || 1000}</span>
                </div>
                <div className="usage-metric">
                  <span className="usage-label">Remaining</span>
                  <span className="usage-value">{ironwifiStatus.apiUsage.remaining?.toLocaleString() || 0}</span>
                </div>
                <div className="usage-metric">
                  <span className="usage-label">Usage</span>
                  <span className={`usage-value ${parseFloat(ironwifiStatus.apiUsage.percentageUsed || 0) > 80 ? 'warning' : ''}`}>
                    {ironwifiStatus.apiUsage.percentageUsed || '0'}%
                  </span>
                </div>
                <div className="usage-metric">
                  <span className="usage-label">Resets In</span>
                  <span className="usage-value">{ironwifiStatus.apiUsage.resetInMinutes || 0} minutes</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Database Storage - Collapsible */}
      {dbSize && dbSize.tables && (
        <CollapsibleSection title="Database Storage Details" defaultOpen={false}>
          <div className="storage-card">
            <div className="storage-summary">
              <div className="storage-total">
                <span className="storage-label">Total Size</span>
                <span className="storage-value">{formatBytes(dbSize.db_bytes || 0)}</span>
              </div>
            </div>
            <div className="storage-tables">
              {dbSize.tables.map((table) => {
                const total = table.total_bytes || 1;
                const tablePercent = ((table.table_bytes || 0) / total) * 100;
                const indexPercent = ((table.index_bytes || 0) / total) * 100;
                const toastPercent = ((table.toast_bytes || 0) / total) * 100;
                
                return (
                  <div key={table.name} className="storage-table">
                    <div className="table-header">
                      <span className="table-name">{table.name}</span>
                      <span className="table-size">{formatBytes(total)}</span>
                    </div>
                    <div className="table-breakdown">
                      <div className="breakdown-bar">
                        <div 
                          className="breakdown-segment table-segment" 
                          style={{ width: `${tablePercent}%` }}
                          title={`Table: ${formatBytes(table.table_bytes)}`}
                        />
                        <div 
                          className="breakdown-segment index-segment" 
                          style={{ width: `${indexPercent}%` }}
                          title={`Indexes: ${formatBytes(table.index_bytes)}`}
                        />
                        <div 
                          className="breakdown-segment toast-segment" 
                          style={{ width: `${toastPercent}%` }}
                          title={`TOAST: ${formatBytes(table.toast_bytes)}`}
                        />
                      </div>
                      <div className="table-details">
                        <span>{table.row_count?.toLocaleString() || 0} rows</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Router Status Summary */}
      {statusSummary && (
        <div className="status-section">
          <h2>Installed Router Status</h2>
          <div className="status-summary-card">
            <div className="summary-metrics">
              <div className="summary-metric">
                <span className="summary-label">Currently Online</span>
                <span className="summary-value online">{statusSummary.current?.online || 0}</span>
              </div>
              <div className="summary-metric">
                <span className="summary-label">Currently Offline</span>
                <span className="summary-value offline">{statusSummary.current?.offline || 0}</span>
              </div>
              {statusSummary.change && (
                <div className="summary-metric">
                  <span className="summary-label">Change (48h)</span>
                  <span className={`summary-value ${statusSummary.change.online >= 0 ? 'positive' : 'negative'}`}>
                    {statusSummary.change.online >= 0 ? '+' : ''}{statusSummary.change.online}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
