import React, { useState, useEffect } from 'react';
import { 
  getRouters, 
  getStorageStats, 
  getInspectionStatus, 
  getRMSUsage, 
  getClickUpUsage, 
  getRouterStatusSummary,
  getClickUpAuthStatus
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
      <span className="status-indicator">{isHealthy ? '●' : '○'}</span>
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

export default function SystemStatusPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // System Health
  const [apiHealth, setApiHealth] = useState(null);
  const [dbHealth, setDbHealth] = useState(null);
  
  // Integrations
  const [rmsStatus, setRmsStatus] = useState(null);
  const [clickupStatus, setClickupStatus] = useState(null);
  const [rmsUsage, setRmsUsage] = useState(null);
  const [clickupUsage, setClickupUsage] = useState(null);
  
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
        apiHealthRes
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
        api.get('/health')
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
      
    } catch (err) {
      console.error('Error fetching system status:', err);
      setError(err.message || 'Failed to load system status');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !routers.length) {
    return (
      <div className="system-status-page">
        <div className="status-loading">Loading system status...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="system-status-page">
        <div className="status-error">Error: {error}</div>
        <button onClick={fetchAllData} className="retry-button">Retry</button>
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

  return (
    <div className="system-status-page">
      <div className="status-header">
        <h1>System Status</h1>
        <button onClick={fetchAllData} className="refresh-button" disabled={loading}>
          {loading ? '🔄 Refreshing...' : '🔄 Refresh'}
        </button>
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
            color="var(--accent-primary)"
          />
          <MetricCard
            label="Installed Routers"
            value={installedRouters}
            sub={statusSummary ? `${statusSummary.current?.online || 0} online` : ''}
            icon="🏠"
            color="var(--accent-secondary)"
          />
          {storage && (
            <MetricCard
              label="Total Logs"
              value={storage.total_logs?.toLocaleString() || '0'}
              sub={formatBytes(storage.total_size || 0)}
              icon="📊"
              color="var(--accent-tea)"
            />
          )}
          {dbSize && (
            <MetricCard
              label="Database Size"
              value={formatBytes(dbSize.db_bytes || 0)}
              sub={`${dbSize.tables?.length || 0} tables`}
              icon="💾"
              color="var(--accent-primary)"
            />
          )}
        </div>
      </div>

      {/* RMS Integration Status */}
      {rmsStatus && (
        <div className="status-section">
          <h2>RMS Integration</h2>
          <div className="integration-card">
            <div className="integration-header">
              <StatusBadge 
                status={rmsStatus.enabled ? 'enabled' : 'disabled'} 
                label={rmsStatus.enabled ? 'Enabled' : 'Disabled'} 
              />
              <span className="integration-type">{rmsStatus.tokenType || 'none'}</span>
            </div>
            {rmsStatus.enabled && rmsStatus.syncStats && (
              <div className="integration-details">
                <div className="detail-row">
                  <span className="detail-label">Last Sync:</span>
                  <span className="detail-value">
                    {formatTimeAgo(rmsStatus.syncStats.lastSyncTime)}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Sync Interval:</span>
                  <span className="detail-value">{rmsStatus.syncInterval || 5} minutes</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Last Sync:</span>
                  <span className="detail-value">
                    {rmsStatus.syncStats.lastSyncSuccess || 0} of {rmsStatus.syncStats.lastSyncTotal || 0} routers
                  </span>
                </div>
                {rmsStatus.syncStats.lastSyncErrors > 0 && (
                  <div className="detail-row error">
                    <span className="detail-label">Errors:</span>
                    <span className="detail-value">{rmsStatus.syncStats.lastSyncErrors}</span>
                  </div>
                )}
                {rmsStatus.syncStats.lastSyncDuration && (
                  <div className="detail-row">
                    <span className="detail-label">Duration:</span>
                    <span className="detail-value">{rmsStatus.syncStats.lastSyncDuration}ms</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="detail-label">24h Syncs:</span>
                  <span className="detail-value">{rmsStatus.syncStats.totalSyncs24h || 0}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ClickUp Integration Status */}
      {clickupStatus && (
        <div className="status-section">
          <h2>ClickUp Integration</h2>
          <div className="integration-card">
            <div className="integration-header">
              <StatusBadge 
                status={clickupStatus.connected ? 'connected' : 'disconnected'} 
                label={clickupStatus.connected ? 'Connected' : 'Disconnected'} 
              />
            </div>
            {clickupUsage && clickupUsage.syncStats && (
              <div className="integration-details">
                <div className="detail-row">
                  <span className="detail-label">Last Sync:</span>
                  <span className="detail-value">
                    {formatTimeAgo(clickupUsage.syncStats.lastSyncTime)}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Total Syncs:</span>
                  <span className="detail-value">{clickupUsage.syncStats.totalSyncs || 0}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Last Updated:</span>
                  <span className="detail-value">{clickupUsage.syncStats.lastSyncUpdated || 0} routers</span>
                </div>
                {clickupUsage.syncStats.lastSyncErrors > 0 && (
                  <div className="detail-row error">
                    <span className="detail-label">Errors:</span>
                    <span className="detail-value">{clickupUsage.syncStats.lastSyncErrors}</span>
                  </div>
                )}
                {clickupUsage.syncStats.lastSyncDuration && (
                  <div className="detail-row">
                    <span className="detail-label">Duration:</span>
                    <span className="detail-value">{clickupUsage.syncStats.lastSyncDuration}ms</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* API Usage Monitoring */}
      <div className="status-section">
        <h2>API Usage</h2>
        <div className="usage-grid">
          {rmsUsage && rmsUsage.apiUsage && (
            <div className="usage-card">
              <h3>RMS API</h3>
              <div className="usage-details">
                <div className="usage-metric">
                  <span className="usage-label">Total Calls:</span>
                  <span className="usage-value">{rmsUsage.apiUsage.total?.toLocaleString() || 0}</span>
                </div>
                {rmsUsage.apiUsage.estimates && (
                  <>
                    <div className="usage-metric">
                      <span className="usage-label">Daily Estimate:</span>
                      <span className="usage-value">{rmsUsage.apiUsage.estimates.dailyRate?.toLocaleString() || 0}</span>
                    </div>
                    <div className="usage-metric">
                      <span className="usage-label">Monthly Estimate:</span>
                      <span className="usage-value">{rmsUsage.apiUsage.estimates.monthlyRate?.toLocaleString() || 0}</span>
                    </div>
                    <div className="usage-metric">
                      <span className="usage-label">Quota Usage:</span>
                      <span className="usage-value">{rmsUsage.apiUsage.estimates.percentOfQuota || '0%'}</span>
                    </div>
                    {rmsUsage.apiUsage.rateLimitHits > 0 && (
                      <div className="usage-metric error">
                        <span className="usage-label">Rate Limit Hits:</span>
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
                  <span className="usage-label">Total Calls:</span>
                  <span className="usage-value">{clickupUsage.apiUsage.total?.toLocaleString() || 0}</span>
                </div>
                {clickupUsage.apiUsage.estimates && (
                  <>
                    <div className="usage-metric">
                      <span className="usage-label">Rate per Minute:</span>
                      <span className="usage-value">{clickupUsage.apiUsage.estimates.currentRatePerMinute || '0'}</span>
                    </div>
                    <div className="usage-metric">
                      <span className="usage-label">Daily Estimate:</span>
                      <span className="usage-value">{clickupUsage.apiUsage.estimates.dailyRate?.toLocaleString() || 0}</span>
                    </div>
                    {clickupUsage.apiUsage.rateLimitHits > 0 && (
                      <div className="usage-metric error">
                        <span className="usage-label">Rate Limit Hits:</span>
                        <span className="usage-value">{clickupUsage.apiUsage.rateLimitHits}</span>
                      </div>
                    )}
                    {clickupUsage.apiUsage.retries > 0 && (
                      <div className="usage-metric">
                        <span className="usage-label">Retries:</span>
                        <span className="usage-value">{clickupUsage.apiUsage.retries}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Database Health */}
      {dbHealth && (
        <div className="status-section">
          <h2>Database Health</h2>
          <div className="health-card">
            <div className="health-metrics">
              <div className="health-metric">
                <span className="health-label">Routers:</span>
                <span className="health-value">{dbHealth.database?.routers || 0}</span>
              </div>
              <div className="health-metric">
                <span className="health-label">Total Logs:</span>
                <span className="health-value">{dbHealth.database?.totalLogs?.toLocaleString() || 0}</span>
              </div>
              <div className="health-metric">
                <span className="health-label">Logs (24h):</span>
                <span className="health-value">{dbHealth.database?.logsLast24h?.toLocaleString() || 0}</span>
              </div>
              <div className="health-metric">
                <span className="health-label">Latest Data:</span>
                <span className="health-value">{dbHealth.database?.dataAge || 'Unknown'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Database Inspections */}
      {inspections && inspections.length > 0 && (
        <div className="status-section">
          <h2>Database Health Checks</h2>
          <div className="inspections-list">
            {inspections.map((inspection, i) => (
              <div key={i} className={`inspection-item ${inspection.status === 'healthy' ? 'healthy' : 'warning'}`}>
                <div className="inspection-header">
                  <span className="inspection-name">{inspection.check_name}</span>
                  <StatusBadge 
                    status={inspection.status} 
                    label={inspection.status === 'healthy' ? '✓ Healthy' : '⚠ Warning'} 
                  />
                </div>
                {inspection.description && (
                  <div className="inspection-description">{inspection.description}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Database Storage Breakdown */}
      {dbSize && dbSize.tables && (
        <div className="status-section">
          <h2>Database Storage</h2>
          <div className="storage-card">
            <div className="storage-summary">
              <div className="storage-total">
                <span className="storage-label">Total Size:</span>
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
        </div>
      )}

      {/* Router Status Summary */}
      {statusSummary && (
        <div className="status-section">
          <h2>Installed Router Status</h2>
          <div className="status-summary-card">
            <div className="summary-metrics">
              <div className="summary-metric">
                <span className="summary-label">Currently Online:</span>
                <span className="summary-value online">{statusSummary.current?.online || 0}</span>
              </div>
              <div className="summary-metric">
                <span className="summary-label">Currently Offline:</span>
                <span className="summary-value offline">{statusSummary.current?.offline || 0}</span>
              </div>
              {statusSummary.change && (
                <>
                  <div className="summary-metric">
                    <span className="summary-label">Change (48h):</span>
                    <span className={`summary-value ${statusSummary.change.online >= 0 ? 'positive' : 'negative'}`}>
                      {statusSummary.change.online >= 0 ? '+' : ''}{statusSummary.change.online}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
