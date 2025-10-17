import React, { useState, useEffect } from 'react';
import { getRouters, getStorageStats, getNetworkUsageRolling, getOperators, getTopRoutersRolling } from '../services/api';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { toast } from 'react-toastify';
import '../DashboardV2.css';

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TB';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
  return n + ' B';
}

function formatNumber(num) {
  return new Intl.NumberFormat().format(num);
}

function MetricCard({ title, value, subtitle, trend, icon, color = '#667eea', loading = false }) {
  return (
    <div className="metric-card" style={{ borderLeftColor: color }}>
      <div className="metric-header">
        <span className="metric-icon" style={{ color }}>{icon}</span>
        <span className="metric-title">{title}</span>
      </div>
      {loading ? (
        <div className="metric-loading">...</div>
      ) : (
        <>
          <div className="metric-value">{value}</div>
          {subtitle && <div className="metric-subtitle">{subtitle}</div>}
          {trend && <div className="metric-trend" style={{ color: trend > 0 ? '#16a34a' : '#dc2626' }}>
            {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </div>}
        </>
      )}
    </div>
  );
}

function NetworkHealthScore({ online, total }) {
  const percentage = total > 0 ? Math.round((online / total) * 100) : 0;
  const getHealthColor = (pct) => {
    if (pct >= 90) return '#16a34a';
    if (pct >= 70) return '#eab308';
    return '#dc2626';
  };
  const color = getHealthColor(percentage);

  return (
    <div className="health-score-card">
      <div className="health-header">
        <h3>Network Health</h3>
        <span className="health-timestamp">Last updated: {new Date().toLocaleTimeString()}</span>
      </div>
      <div className="health-body">
        <div className="health-gauge">
          <svg viewBox="0 0 200 120" className="gauge-svg">
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="20"
              strokeLinecap="round"
            />
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke={color}
              strokeWidth="20"
              strokeLinecap="round"
              strokeDasharray={`${percentage * 2.51} 251`}
              style={{ transition: 'stroke-dasharray 0.5s ease' }}
            />
            <text x="100" y="85" textAnchor="middle" fontSize="36" fontWeight="bold" fill={color}>
              {percentage}%
            </text>
            <text x="100" y="105" textAnchor="middle" fontSize="12" fill="#64748b">
              {online} of {total} online
            </text>
          </svg>
        </div>
        <div className="health-status">
          <div className="status-item">
            <span className="status-dot" style={{ background: '#16a34a' }}></span>
            <span>Online: {online}</span>
          </div>
          <div className="status-item">
            <span className="status-dot" style={{ background: '#dc2626' }}></span>
            <span>Offline: {total - online}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AlertsPanel({ routers }) {
  const alerts = [];
  
  // Detect offline routers
  const offline = routers.filter(r => r.current_status !== 'online' && r.current_status !== 1 && r.current_status !== '1');
  if (offline.length > 0) {
    alerts.push({
      type: 'error',
      title: `${offline.length} router${offline.length > 1 ? 's' : ''} offline`,
      details: offline.slice(0, 3).map(r => r.name || r.router_id).join(', ') + (offline.length > 3 ? '...' : ''),
      timestamp: new Date()
    });
  }

  // Check for routers not seen recently (>24h)
  const stale = routers.filter(r => {
    if (!r.last_seen) return false;
    const hoursSince = (Date.now() - new Date(r.last_seen).getTime()) / (1000 * 60 * 60);
    return hoursSince > 24;
  });
  if (stale.length > 0) {
    alerts.push({
      type: 'warning',
      title: `${stale.length} router${stale.length > 1 ? 's' : ''} not seen in 24h`,
      details: stale.slice(0, 3).map(r => r.name || r.router_id).join(', '),
      timestamp: new Date()
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      type: 'success',
      title: 'All systems operational',
      details: 'No issues detected',
      timestamp: new Date()
    });
  }

  return (
    <div className="alerts-panel">
      <h3>🔔 Alerts & Notifications</h3>
      <div className="alerts-list">
        {alerts.map((alert, idx) => (
          <div key={idx} className={`alert alert-${alert.type}`}>
            <div className="alert-header">
              <span className="alert-title">{alert.title}</span>
              <span className="alert-time">{alert.timestamp.toLocaleTimeString()}</span>
            </div>
            <div className="alert-details">{alert.details}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RouterStatusTable({ routers, onSelectRouter }) {
  const [filter, setFilter] = useState('all'); // all | online | offline
  const [sortBy, setSortBy] = useState('name'); // name | status | logs

  const filtered = routers.filter(r => {
    if (filter === 'online') return r.current_status === 'online' || r.current_status === 1 || r.current_status === '1';
    if (filter === 'offline') return r.current_status !== 'online' && r.current_status !== 1 && r.current_status !== '1';
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return (a.name || a.router_id).localeCompare(b.name || b.router_id);
    if (sortBy === 'status') {
      const aOnline = a.current_status === 'online' || a.current_status === 1 ? 1 : 0;
      const bOnline = b.current_status === 'online' || b.current_status === 1 ? 1 : 0;
      return bOnline - aOnline;
    }
    if (sortBy === 'logs') return (Number(b.log_count) || 0) - (Number(a.log_count) || 0);
    return 0;
  });

  return (
    <div className="router-status-table">
      <div className="table-header">
        <h3>📡 Router Status</h3>
        <div className="table-controls">
          <div className="filter-group">
            <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
              All ({routers.length})
            </button>
            <button className={`filter-btn ${filter === 'online' ? 'active' : ''}`} onClick={() => setFilter('online')}>
              Online
            </button>
            <button className={`filter-btn ${filter === 'offline' ? 'active' : ''}`} onClick={() => setFilter('offline')}>
              Offline
            </button>
          </div>
          <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="name">Sort by Name</option>
            <option value="status">Sort by Status</option>
            <option value="logs">Sort by Logs</option>
          </select>
        </div>
      </div>
      <div className="table-body">
        <table>
          <thead>
            <tr>
              <th>Router</th>
              <th>Status</th>
              <th>Last Seen</th>
              <th>Logs</th>
              <th>Firmware</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 20).map(r => {
              const isOnline = r.current_status === 'online' || r.current_status === 1 || r.current_status === '1';
              const lastSeen = r.last_seen ? new Date(r.last_seen) : null;
              const timeAgo = lastSeen ? (() => {
                const mins = Math.floor((Date.now() - lastSeen.getTime()) / (1000 * 60));
                if (mins < 60) return `${mins}m ago`;
                const hours = Math.floor(mins / 60);
                if (hours < 24) return `${hours}h ago`;
                const days = Math.floor(hours / 24);
                return `${days}d ago`;
              })() : 'Never';

              return (
                <tr key={r.router_id}>
                  <td>
                    <div className="router-name">
                      <strong>{r.name || r.router_id}</strong>
                      {r.location && <div className="router-location">{r.location}</div>}
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${isOnline ? 'status-online' : 'status-offline'}`}>
                      {isOnline ? '● Online' : '○ Offline'}
                    </span>
                  </td>
                  <td>{timeAgo}</td>
                  <td>{formatNumber(Number(r.log_count) || 0)}</td>
                  <td><span className="firmware-badge">{r.firmware_version || 'N/A'}</span></td>
                  <td>
                    <button className="action-btn" onClick={() => onSelectRouter(r)} title="View Details">
                      👁️
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length > 20 && (
          <div className="table-footer">
            Showing 20 of {sorted.length} routers
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardV2() {
  const [routers, setRouters] = useState([]);
  const [storageStats, setStorageStats] = useState(null);
  const [networkUsage, setNetworkUsage] = useState([]);
  const [topRouters, setTopRouters] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDashboard = async () => {
      setLoading(true);
      try {
        const [routersRes, storageRes, usageRes, topRes, opsRes] = await Promise.all([
          getRouters(),
          getStorageStats({ sample_size: 1000 }),
          getNetworkUsageRolling({ hours: 24, bucket: 'hour' }),
          getTopRoutersRolling({ hours: 24, limit: 5 }),
          getOperators({ days: 1 })
        ]);

        setRouters(routersRes.data || []);
        setStorageStats(storageRes.data);
        setNetworkUsage(usageRes.data || []);
        setTopRouters(topRes.data || []);
        setOperators(opsRes.data || []);
      } catch (e) {
        console.error('Failed to load dashboard data', e);
        toast.error('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
    const interval = setInterval(loadDashboard, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const online = routers.filter(r => r.current_status === 'online' || r.current_status === 1 || r.current_status === '1').length;
  const total = routers.length;

  const totalDataBytes = networkUsage.reduce((sum, d) => sum + (Number(d.total_bytes) || 0), 0);

  const handleRouterSelect = (router) => {
    toast.info(`Selected: ${router.name || router.router_id}. Switch to V1 for detailed view.`);
  };

  const COLORS = ['#667eea', '#16a34a', '#eab308', '#f97316', '#06b6d4', '#8b5cf6'];

  return (
    <div className="dashboard-v2">
      <div className="dashboard-header">
        <div>
          <h1>📊 Network Dashboard V2</h1>
          <p>Real-time monitoring and analytics</p>
        </div>
        <div className="header-actions">
          <span className="last-update">Auto-refresh every 60s</span>
        </div>
      </div>

      {/* Hero Metrics */}
      <div className="metrics-grid">
        <MetricCard
          title="Network Health"
          value={`${total > 0 ? Math.round((online / total) * 100) : 0}%`}
          subtitle={`${online}/${total} routers online`}
          icon="💚"
          color="#16a34a"
          loading={loading}
        />
        <MetricCard
          title="24h Data Transfer"
          value={formatBytes(totalDataBytes)}
          subtitle="Last 24 hours"
          icon="📡"
          color="#667eea"
          loading={loading}
        />
        <MetricCard
          title="Total Routers"
          value={formatNumber(total)}
          subtitle={storageStats ? `${formatNumber(storageStats.totalLogs)} logs` : ''}
          icon="🌐"
          color="#06b6d4"
          loading={loading}
        />
        <MetricCard
          title="Storage"
          value={storageStats ? formatBytes(storageStats.estimatedCurrentJsonBytes) : '0 B'}
          subtitle={storageStats ? `${formatNumber(storageStats.totalLogs)} records` : ''}
          icon="💾"
          color="#8b5cf6"
          loading={loading}
        />
      </div>

      {/* Main Grid */}
      <div className="dashboard-grid">
        <div className="grid-left">
          <NetworkHealthScore online={online} total={total} />
          
          <AlertsPanel routers={routers} />

          {/* Operator Distribution */}
          {operators.length > 0 && (
            <div className="card-v2">
              <h3>📶 Operator Distribution</h3>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={operators.map((op, i) => ({ name: op.operator || 'Unknown', value: Number(op.total_bytes) || 0 }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {operators.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatBytes(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        <div className="grid-right">
          {/* Network Usage Chart */}
          <div className="card-v2">
            <h3>📈 Network Usage (Last 24h)</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={networkUsage}>
                  <defs>
                    <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#8884d8" stopOpacity={0.1}/>
                    </linearGradient>
                    <linearGradient id="colorRx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#82ca9d" stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 11 }}
                    tickFormatter={(t) => {
                      const d = new Date(t);
                      return d.getHours() + ':00';
                    }}
                  />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatBytes(v).split(' ')[0]} />
                  <Tooltip 
                    formatter={(v) => formatBytes(v)}
                    labelFormatter={(t) => new Date(t).toLocaleTimeString()}
                  />
                  <Area type="monotone" dataKey="tx_bytes" stroke="#8884d8" fill="url(#colorTx)" name="TX" />
                  <Area type="monotone" dataKey="rx_bytes" stroke="#82ca9d" fill="url(#colorRx)" name="RX" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top Routers */}
          <div className="card-v2">
            <h3>🏆 Top 5 Routers (Last 24h)</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topRouters} layout="horizontal" margin={{ bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    type="category" 
                    dataKey="name" 
                    angle={-15}
                    textAnchor="end"
                    height={60}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatBytes(v).split(' ')[0]} />
                  <Tooltip formatter={(v) => formatBytes(v)} />
                  <Legend />
                  <Bar dataKey="tx_bytes" stackId="a" fill="#8884d8" name="TX" />
                  <Bar dataKey="rx_bytes" stackId="a" fill="#82ca9d" name="RX" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Router Status Table */}
      <RouterStatusTable routers={routers} onSelectRouter={handleRouterSelect} />
    </div>
  );
}
