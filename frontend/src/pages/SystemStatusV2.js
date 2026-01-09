import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts';
import {
  getRouters,
  getStorageStats,
  getRMSUsage,
  getClickUpUsage,
  getRouterStatusSummary,
  getClickUpAuthStatus,
  getNetworkUsageRolling,
  getRadiusStatus
} from '../services/api';
import api from '../services/api';
import './SystemStatusV2.css';

// Utility functions
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const COLORS = {
  online: '#10b981',
  offline: '#ef4444',
  warning: '#f59e0b',
  primary: '#3b82f6',
  secondary: '#6366f1',
  gray: '#e5e7eb'
};

export default function SystemStatusV2() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [data, setData] = useState({
    routers: [],
    statusSummary: null,
    networkHistory: [],
    dbSize: null,
    storage: null,
    rmsUsage: null,
    clickupUsage: null,
    rmsStatus: null,
    clickupStatus: null,
    apiHealth: null,
    dbHealth: null,
    radiusStatus: null
  });

  const fetchAllData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [
        routersRes,
        statusSummaryRes,
        networkHistoryRes,
        dbSizeRes,
        storageRes,
        rmsUsageRes,
        clickupUsageRes,
        clickupAuthRes,
        rmsStatusRes,
        dbHealthRes,
        apiHealthRes,
        radiusStatusRes
      ] = await Promise.allSettled([
        getRouters(),
        getRouterStatusSummary(),
        getNetworkUsageRolling({ hours: 168, bucket: 'day' }),
        api.get('/stats/db-size'),
        getStorageStats({ sample_size: 500 }),
        getRMSUsage(),
        getClickUpUsage(),
        getClickUpAuthStatus(),
        api.get('/rms/status'),
        api.get('/monitoring/db-health'),
        api.get('/health'),
        getRadiusStatus()
      ]);

      const newData = {
        routers: routersRes.status === 'fulfilled' ? routersRes.value.data || [] : [],
        statusSummary: statusSummaryRes.status === 'fulfilled' ? statusSummaryRes.value.data : null,
        networkHistory: networkHistoryRes.status === 'fulfilled' ? networkHistoryRes.value.data || [] : [],
        dbSize: dbSizeRes.status === 'fulfilled' ? dbSizeRes.value.data : null,
        storage: storageRes.status === 'fulfilled' ? storageRes.value.data : null,
        rmsUsage: rmsUsageRes.status === 'fulfilled' ? rmsUsageRes.value.data : null,
        clickupUsage: clickupUsageRes.status === 'fulfilled' ? clickupUsageRes.value.data : null,
        clickupStatus: clickupAuthRes.status === 'fulfilled' ? clickupAuthRes.value.data : null,
        rmsStatus: rmsStatusRes.status === 'fulfilled' ? rmsStatusRes.value.data : null,
        dbHealth: dbHealthRes.status === 'fulfilled' ? dbHealthRes.value.data : null,
        apiHealth: apiHealthRes.status === 'fulfilled' ? apiHealthRes.value.data : null,
        radiusStatus: radiusStatusRes.status === 'fulfilled' ? radiusStatusRes.value.data : null,
      };

      setData(newData);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch system status:', err);
      setError('Failed to load system status. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 300000);
    return () => clearInterval(interval);
  }, []);

  // Process data for charts
  const statusData = useMemo(() => {
    if (!data.routers.length) return [];
    const online = data.routers.filter(r => r.current_status === 'online' || r.current_status === 1 || r.current_status === '1' || r.current_status === true).length;
    const offline = data.routers.length - online;
    return [
      { name: 'Online', value: online, color: COLORS.online },
      { name: 'Offline', value: offline, color: COLORS.offline }
    ];
  }, [data.routers]);

  const networkChartData = useMemo(() => {
    return data.networkHistory.map(item => ({
      date: new Date(item.date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
      tx: Number(item.tx_bytes),
      rx: Number(item.rx_bytes),
      total: Number(item.total_bytes)
    }));
  }, [data.networkHistory]);

  const dbTableData = useMemo(() => {
    if (!data.dbSize?.tables) return [];
    return data.dbSize.tables
      .sort((a, b) => b.total_bytes - a.total_bytes)
      .slice(0, 5)
      .map(t => ({
        name: t.name,
        size: t.total_bytes,
        formattedSize: formatBytes(t.total_bytes)
      }));
  }, [data.dbSize]);

  // Calculate Health Score
  const healthScore = useMemo(() => {
    let score = 100;
    let issues = [];

    if (data.apiHealth?.status !== 'healthy' && data.apiHealth?.status !== 'OK') {
      score -= 20;
      issues.push('Backend API');
    }
    if (data.dbHealth?.status !== 'healthy' && data.dbHealth?.status !== 'OK') {
      score -= 20;
      issues.push('Database');
    }
    if (!data.rmsStatus?.enabled) {
      score -= 10;
      issues.push('RMS Integration');
    }
    if (!data.clickupStatus?.connected) {
      score -= 10;
      issues.push('ClickUp');
    }
    if (data.radiusStatus?.radius && !data.radiusStatus.radius.connected) {
      score -= 15;
      issues.push('RADIUS Server');
    }

    return { score: Math.max(0, score), issues };
  }, [data]);

  if (loading && !lastUpdated) {
    return (
      <div className="system-status-v2 loading-container">
        <div className="loading-spinner"></div>
        <p>Loading system analytics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="system-status-v2 error-container">
        <h2>Something went wrong</h2>
        <p>{error}</p>
        <button className="retry-btn" onClick={fetchAllData}>Retry</button>
      </div>
    );
  }

  const onlineCount = data.routers.filter(r => r.current_status === 'online' || r.current_status === 1 || r.current_status === '1' || r.current_status === true).length;
  const totalRouters = data.routers.length;
  const onlinePercentage = totalRouters ? Math.round((onlineCount / totalRouters) * 100) : 0;

  return (
    <div className="system-status-v2">
      <div className="status-header">
        <div>
          <h1>System Dashboard</h1>
          <div className="last-updated">
            Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '-'}
          </div>
        </div>
        <button className="refresh-button" onClick={fetchAllData} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>

      {/* ===== SECTION: SYSTEM OVERVIEW ===== */}
      <section className="status-section">
        <h2 className="section-title">System Overview</h2>
        <div className="kpi-grid">
          <div className="kpi-card primary">
            <div className="kpi-header">
              <span className="kpi-title">Router Fleet</span>
              <span className="kpi-icon">📡</span>
            </div>
            <div className="kpi-value">{onlineCount} <span className="kpi-value-sub">/ {totalRouters}</span></div>
            <div className="kpi-sub">
              <span className={onlinePercentage > 90 ? 'text-success' : 'text-warning'}>
                {onlinePercentage}% Online
              </span>
            </div>
          </div>

          <div className="kpi-card info">
            <div className="kpi-header">
              <span className="kpi-title">Total Logs</span>
              <span className="kpi-icon">📊</span>
            </div>
            <div className="kpi-value">
              {data.dbHealth?.database?.totalLogs ? parseInt(data.dbHealth.database.totalLogs).toLocaleString() : '0'}
            </div>
            <div className="kpi-sub">
              {data.storage?.logsPerDay7 ? `~${Math.round(data.storage.logsPerDay7).toLocaleString()} / day` : 'Calculating...'}
            </div>
          </div>

          <div className="kpi-card warning">
            <div className="kpi-header">
              <span className="kpi-title">DB Size</span>
              <span className="kpi-icon">💾</span>
            </div>
            <div className="kpi-value">{formatBytes(data.dbSize?.db_bytes || 0)}</div>
            <div className="kpi-sub">
              {data.dbSize?.tables?.length || 0} Tables
            </div>
          </div>

          <div className={`kpi-card ${healthScore.score >= 90 ? 'success' : healthScore.score >= 70 ? 'warning' : 'danger'}`}>
            <div className="kpi-header">
              <span className="kpi-title">System Health</span>
              <span className="kpi-icon">❤️</span>
            </div>
            <div className="kpi-value">{healthScore.score}%</div>
            <div className="kpi-sub">
              {healthScore.issues.length === 0 ? 'All systems operational' : `${healthScore.issues.length} issue${healthScore.issues.length > 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION: ROUTER FLEET ===== */}
      <section className="status-section">
        <h2 className="section-title">Router Fleet</h2>
        <div className="charts-grid">
          <div className="chart-card">
            <div className="chart-header">
              <h3 className="chart-title">Status Distribution</h3>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <h3 className="chart-title">Network Traffic (Last 7 Days)</h3>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={networkChartData}>
                  <defs>
                    <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorRx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis
                    tickFormatter={(value) => formatBytes(value, 0)}
                    stroke="#9ca3af"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <Tooltip formatter={(value) => formatBytes(value)} />
                  <Area type="monotone" dataKey="rx" name="Download" stroke="#10b981" fillOpacity={1} fill="url(#colorRx)" />
                  <Area type="monotone" dataKey="tx" name="Upload" stroke="#3b82f6" fillOpacity={1} fill="url(#colorTx)" />
                  <Legend />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION: RADIUS SERVER / GUEST WIFI ===== */}
      <section className="status-section">
        <h2 className="section-title">RADIUS Server / Guest WiFi</h2>
        <div className="stats-grid three-col">
          {/* RADIUS Connection Status */}
          <div className="health-card">
            <div className="chart-header">
              <h3 className="chart-title">RADIUS Database</h3>
            </div>
            <div className="radius-status-grid">
              <div className={`health-item ${data.radiusStatus?.radius?.connected ? 'healthy' : 'error'}`}>
                <div className="health-indicator"></div>
                <span className="health-label">
                  {data.radiusStatus?.radius?.connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              <div className="metric-row">
                <span className="metric-label">Active Sessions</span>
                <span className="metric-val">{data.radiusStatus?.radius?.activeRadiusSessions || 0}</span>
              </div>

              <div className="metric-row">
                <span className="metric-label">Total Records</span>
                <span className="metric-val">{data.radiusStatus?.radius?.totalRadiusSessions?.toLocaleString() || 0}</span>
              </div>

              <div className="metric-row">
                <span className="metric-label">Last Update</span>
                <span className="metric-val" style={{fontSize: '12px'}}>
                  {data.radiusStatus?.radius?.lastAccountingUpdate
                    ? new Date(data.radiusStatus.radius.lastAccountingUpdate).toLocaleString()
                    : 'N/A'}
                </span>
              </div>

              {data.radiusStatus?.radius?.error && (
                <div className="error-message-small">
                  {data.radiusStatus.radius.error}
                </div>
              )}
            </div>
          </div>

          {/* Guest WiFi Stats (24h) */}
          <div className="health-card">
            <div className="chart-header">
              <h3 className="chart-title">Guest WiFi (24h)</h3>
            </div>
            <div className="radius-status-grid">
              <div className="metric-row highlight">
                <span className="metric-label">Active Sessions</span>
                <span className="metric-val text-success">{data.radiusStatus?.guestWifi?.last24Hours?.active_sessions || 0}</span>
              </div>

              <div className="metric-row">
                <span className="metric-label">Total Sessions</span>
                <span className="metric-val">{data.radiusStatus?.guestWifi?.last24Hours?.total_sessions || 0}</span>
              </div>

              <div className="metric-row">
                <span className="metric-label">Unique Guests</span>
                <span className="metric-val">{data.radiusStatus?.guestWifi?.last24Hours?.unique_guests || 0}</span>
              </div>

              <div className="metric-row">
                <span className="metric-label">Data Used</span>
                <span className="metric-val">{formatBytes(data.radiusStatus?.guestWifi?.last24Hours?.total_data || 0)}</span>
              </div>
            </div>
          </div>

          {/* Sessions by Router */}
          <div className="health-card">
            <div className="chart-header">
              <h3 className="chart-title">By Router (24h)</h3>
            </div>
            <div className="router-session-list">
              {data.radiusStatus?.guestWifi?.byRouter?.length > 0 ? (
                data.radiusStatus.guestWifi.byRouter.map((r, i) => (
                  <div key={i} className="router-session-item">
                    <span className="router-name">{r.router_name || `Router ${r.router_id}` || 'Unknown'}</span>
                    <span className="session-count">
                      {r.session_count} session{r.session_count !== 1 ? 's' : ''}
                      {r.active_count > 0 && <span className="active-badge">{r.active_count} active</span>}
                    </span>
                  </div>
                ))
              ) : (
                <div className="empty-state-small">No sessions in last 24h</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION: DATABASE & STORAGE ===== */}
      <section className="status-section">
        <h2 className="section-title">Database & Storage</h2>
        <div className="stats-grid">
          <div className="chart-card">
            <div className="chart-header">
              <h3 className="chart-title">Top Database Tables</h3>
            </div>
            <div className="chart-container" style={{ minHeight: '200px' }}>
               <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dbTableData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(val) => formatBytes(val, 0)} hide />
                  <YAxis type="category" dataKey="name" width={100} fontSize={12} />
                  <Tooltip formatter={(val) => formatBytes(val)} />
                  <Bar dataKey="size" name="Size" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="health-card">
            <div className="chart-header">
              <h3 className="chart-title">Storage Metrics</h3>
            </div>
            <div className="storage-metrics">
              <div className="metric-row">
                <span className="metric-label">Database Size</span>
                <span className="metric-val">{formatBytes(data.dbSize?.db_bytes || 0)}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Table Count</span>
                <span className="metric-val">{data.dbSize?.tables?.length || 0}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Logs/Day (7d avg)</span>
                <span className="metric-val">{data.storage?.logsPerDay7 ? Math.round(data.storage.logsPerDay7).toLocaleString() : '-'}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Total Logs</span>
                <span className="metric-val">{data.dbHealth?.database?.totalLogs ? parseInt(data.dbHealth.database.totalLogs).toLocaleString() : '-'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION: API & INTEGRATIONS ===== */}
      <section className="status-section">
        <h2 className="section-title">API & Integrations</h2>
        <div className="stats-grid three-col">
          {/* RMS Integration */}
          <div className="health-card">
            <div className="chart-header">
              <h3 className="chart-title">Teltonika RMS</h3>
            </div>
            <div className={`health-item ${data.rmsStatus?.enabled ? 'healthy' : 'warning'}`} style={{marginBottom: '16px'}}>
              <div className="health-indicator"></div>
              <span className="health-label">{data.rmsStatus?.enabled ? 'Connected' : 'Not Connected'}</span>
            </div>
            <div className="quota-section">
              <div className="metric-row">
                <span className="metric-label">Daily Quota Used</span>
                <span className="metric-val">{data.rmsUsage?.apiUsage?.estimates?.percentOfQuota || '0%'}</span>
              </div>
              <div className="progress-bar-container">
                <div
                  className={`progress-bar ${parseInt(data.rmsUsage?.apiUsage?.estimates?.percentOfQuota || 0) > 80 ? 'high' : ''}`}
                  style={{ width: data.rmsUsage?.apiUsage?.estimates?.percentOfQuota || '0%' }}
                />
              </div>
              <div className="metric-sub">
                {data.rmsUsage?.apiUsage?.last24Hours?.toLocaleString() || 0} calls in last 24h
              </div>
            </div>
          </div>

          {/* ClickUp Integration */}
          <div className="health-card">
            <div className="chart-header">
              <h3 className="chart-title">ClickUp</h3>
            </div>
            <div className={`health-item ${data.clickupStatus?.connected ? 'healthy' : 'warning'}`} style={{marginBottom: '16px'}}>
              <div className="health-indicator"></div>
              <span className="health-label">{data.clickupStatus?.connected ? 'Connected' : 'Not Connected'}</span>
            </div>
            <div className="quota-section">
              <div className="metric-row">
                <span className="metric-label">Rate (per min)</span>
                <span className="metric-val">{data.clickupUsage?.apiUsage?.estimates?.currentRatePerMinute || 0}</span>
              </div>
              <div className="progress-bar-container">
                <div
                  className="progress-bar"
                  style={{ width: `${Math.min(100, (data.clickupUsage?.apiUsage?.estimates?.currentRatePerMinute || 0))}%` }}
                />
              </div>
              <div className="metric-sub">
                {data.clickupUsage?.apiUsage?.last24Hours?.toLocaleString() || 0} calls in last 24h
              </div>
            </div>
          </div>

          {/* Backend API */}
          <div className="health-card">
            <div className="chart-header">
              <h3 className="chart-title">Backend API</h3>
            </div>
            <div className={`health-item ${data.apiHealth?.status === 'OK' || data.apiHealth?.status === 'healthy' ? 'healthy' : 'error'}`} style={{marginBottom: '16px'}}>
              <div className="health-indicator"></div>
              <span className="health-label">{data.apiHealth?.status || 'Unknown'}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Uptime</span>
              <span className="metric-val">{data.apiHealth?.uptime ? `${Math.floor(data.apiHealth.uptime / 3600)}h` : '-'}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Version</span>
              <span className="metric-val">{data.apiHealth?.version || '-'}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION: SYSTEM HEALTH ===== */}
      <section className="status-section">
        <h2 className="section-title">System Health</h2>
        <div className="health-card">
          <div className="health-grid">
            <div className={`health-item ${data.apiHealth?.status === 'OK' || data.apiHealth?.status === 'healthy' ? 'healthy' : 'error'}`}>
              <div className="health-indicator"></div>
              <span className="health-label">Backend API</span>
            </div>

            <div className={`health-item ${data.dbHealth?.status === 'OK' || data.dbHealth?.status === 'healthy' ? 'healthy' : 'error'}`}>
              <div className="health-indicator"></div>
              <span className="health-label">PostgreSQL</span>
            </div>

            <div className={`health-item ${data.rmsStatus?.enabled ? 'healthy' : 'warning'}`}>
              <div className="health-indicator"></div>
              <span className="health-label">RMS Sync</span>
            </div>

            <div className={`health-item ${data.clickupStatus?.connected ? 'healthy' : 'warning'}`}>
              <div className="health-indicator"></div>
              <span className="health-label">ClickUp Sync</span>
            </div>

            <div className={`health-item ${data.radiusStatus?.radius?.connected ? 'healthy' : 'error'}`}>
              <div className="health-indicator"></div>
              <span className="health-label">RADIUS Server</span>
            </div>

            <div className={`health-item ${data.radiusStatus?.guestWifi?.last24Hours?.active_sessions > 0 ? 'healthy' : 'warning'}`}>
              <div className="health-indicator"></div>
              <span className="health-label">Guest WiFi</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
