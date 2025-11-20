import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts';
import {
  getRouters,
  getStorageStats,
  getInspectionStatus,
  getRMSUsage,
  getClickUpUsage,
  getRouterStatusSummary,
  getClickUpAuthStatus,
  getNetworkUsageRolling
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

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

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
    inspections: [],
    rmsUsage: null,
    clickupUsage: null,
    rmsStatus: null,
    clickupStatus: null,
    apiHealth: null,
    dbHealth: null
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
        inspectionsRes,
        rmsUsageRes,
        clickupUsageRes,
        clickupAuthRes,
        rmsStatusRes,
        dbHealthRes,
        apiHealthRes
      ] = await Promise.allSettled([
        getRouters(),
        getRouterStatusSummary(),
        getNetworkUsageRolling({ hours: 168, bucket: 'day' }), // Last 7 days
        api.get('/stats/db-size'),
        getStorageStats({ sample_size: 500 }),
        getInspectionStatus(),
        getRMSUsage(),
        getClickUpUsage(),
        getClickUpAuthStatus(),
        api.get('/rms/status'),
        api.get('/monitoring/db-health'),
        api.get('/health')
      ]);

      const newData = {
        routers: routersRes.status === 'fulfilled' ? routersRes.value.data || [] : [],
        statusSummary: statusSummaryRes.status === 'fulfilled' ? statusSummaryRes.value.data : null,
        networkHistory: networkHistoryRes.status === 'fulfilled' ? networkHistoryRes.value.data || [] : [],
        dbSize: dbSizeRes.status === 'fulfilled' ? dbSizeRes.value.data : null,
        storage: storageRes.status === 'fulfilled' ? storageRes.value.data : null,
        inspections: inspectionsRes.status === 'fulfilled' ? inspectionsRes.value.data || [] : [],
        rmsUsage: rmsUsageRes.status === 'fulfilled' ? rmsUsageRes.value.data : null,
        clickupUsage: clickupUsageRes.status === 'fulfilled' ? clickupUsageRes.value.data : null,
        clickupStatus: clickupAuthRes.status === 'fulfilled' ? clickupAuthRes.value.data : null,
        rmsStatus: rmsStatusRes.status === 'fulfilled' ? rmsStatusRes.value.data : null,
        dbHealth: dbHealthRes.status === 'fulfilled' ? dbHealthRes.value.data : null,
        apiHealth: apiHealthRes.status === 'fulfilled' ? apiHealthRes.value.data : null,
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
    const interval = setInterval(fetchAllData, 300000); // Refresh every 5 mins
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
    let issues = 0;

    if (data.apiHealth?.status !== 'healthy' && data.apiHealth?.status !== 'OK') { score -= 20; issues++; }
    if (data.dbHealth?.status !== 'healthy' && data.dbHealth?.status !== 'OK') { score -= 20; issues++; }
    if (!data.rmsStatus?.enabled) { score -= 10; issues++; }
    if (!data.clickupStatus?.connected) { score -= 10; issues++; }
    
    // Inspection failures
    const failedInspections = data.inspections.filter(i => i.status !== 'healthy').length;
    score -= (failedInspections * 5);
    issues += failedInspections;

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

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card primary">
          <div className="kpi-header">
            <span className="kpi-title">Network Status</span>
            <span className="kpi-icon">📡</span>
          </div>
          <div className="kpi-value">{onlineCount} <span style={{fontSize: '16px', color: '#6b7280'}}>/ {totalRouters}</span></div>
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
            {healthScore.issues === 0 ? 'All systems operational' : `${healthScore.issues} issues detected`}
          </div>
        </div>
      </div>

      {/* Network Overview */}
      <div className="charts-grid">
        <div className="chart-card">
          <div className="chart-header">
            <h3 className="chart-title">Router Status Distribution</h3>
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

      {/* Infrastructure & API */}
      <div className="stats-grid">
        {/* Database Stats */}
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

        {/* API Usage */}
        <div className="health-card">
          <div className="chart-header">
            <h3 className="chart-title">API Quota Usage</h3>
          </div>
          
          <div className="quota-section">
            <div className="metric-row">
              <span className="metric-label">RMS API (Daily)</span>
              <span className="metric-val">
                {data.rmsUsage?.apiUsage?.estimates?.percentOfQuota || '0%'}
              </span>
            </div>
            <div className="progress-bar-container">
              <div 
                className={`progress-bar ${parseInt(data.rmsUsage?.apiUsage?.estimates?.percentOfQuota || 0) > 80 ? 'high' : ''}`}
                style={{ width: data.rmsUsage?.apiUsage?.estimates?.percentOfQuota || '0%' }}
              />
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
              {data.rmsUsage?.apiUsage?.total?.toLocaleString()} total calls
            </div>
          </div>

          <div className="quota-section" style={{ marginTop: '24px' }}>
            <div className="metric-row">
              <span className="metric-label">ClickUp API (Rate Limit)</span>
              <span className="metric-val">
                {data.clickupUsage?.apiUsage?.estimates?.currentRatePerMinute || 0} / min
              </span>
            </div>
            <div className="progress-bar-container">
              <div 
                className="progress-bar"
                style={{ width: `${Math.min(100, (data.clickupUsage?.apiUsage?.estimates?.currentRatePerMinute || 0) / 1)}%` }} // Assuming 100 is limit
              />
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
              {data.clickupUsage?.apiUsage?.total?.toLocaleString()} total calls
            </div>
          </div>
        </div>
      </div>

      {/* Health Checks Grid */}
      <div className="health-card">
        <div className="chart-header">
          <h3 className="chart-title">System Health Checks</h3>
        </div>
        <div className="health-grid">
          <div className={`health-item ${data.apiHealth?.status === 'OK' || data.apiHealth?.status === 'healthy' ? 'healthy' : 'error'}`}>
            <div className="health-indicator"></div>
            <span className="health-label">Backend API</span>
          </div>
          
          <div className={`health-item ${data.dbHealth?.status === 'OK' || data.dbHealth?.status === 'healthy' ? 'healthy' : 'error'}`}>
            <div className="health-indicator"></div>
            <span className="health-label">Database</span>
          </div>

          <div className={`health-item ${data.rmsStatus?.enabled ? 'healthy' : 'warning'}`}>
            <div className="health-indicator"></div>
            <span className="health-label">RMS Integration</span>
          </div>

          <div className={`health-item ${data.clickupStatus?.connected ? 'healthy' : 'warning'}`}>
            <div className="health-indicator"></div>
            <span className="health-label">ClickUp Integration</span>
          </div>

          {data.inspections.map((inspection, i) => (
            <div key={i} className={`health-item ${inspection.status === 'healthy' ? 'healthy' : 'warning'}`}>
              <div className="health-indicator"></div>
              <span className="health-label" title={inspection.description}>{inspection.check_name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

