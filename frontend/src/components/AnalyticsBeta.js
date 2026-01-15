import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { 
  getRouters, 
  getNetworkUsageRolling, 
  getTopRoutersRolling, 
  getOperators, 
  getGuestWifiStats,
  getRouterStatusSummary
} from '../services/api';
import {
  AreaChart, Area, CartesianGrid, Legend,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Cell,
  PieChart, Pie, RadialBarChart, RadialBar, BarChart, Bar
} from 'recharts';
import './AnalyticsBeta.css';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
  return n + ' B';
}

function formatNumber(n) {
  return new Intl.NumberFormat().format(n || 0);
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

function getTimeAgo(date) {
  const now = new Date();
  const then = new Date(date);
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${mins}m ago`;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const COLORS = {
  primary: '#6366f1',
  success: '#10b981', 
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#06b6d4',
  purple: '#8b5cf6',
  pink: '#ec4899',
  orange: '#f97316'
};

const CHART_COLORS = [
  COLORS.primary, COLORS.success, COLORS.warning, 
  COLORS.info, COLORS.purple, COLORS.pink, COLORS.orange
];

const TIME_RANGES = [
  { label: '6H', hours: 6, days: 1 },
  { label: '24H', hours: 24, days: 1 },
  { label: '7D', hours: 168, days: 7 },
  { label: '30D', hours: 720, days: 30 },
  { label: '90D', hours: 2160, days: 90 }
];

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function TimeRangeSelector({ selected, onChange }) {
  return (
    <div className="beta-time-selector">
      {TIME_RANGES.map(range => (
        <button
          key={range.label}
          className={`time-btn ${selected.label === range.label ? 'active' : ''}`}
          onClick={() => onChange(range)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

function StatCard({ icon, label, value, subValue, color, trend, onClick, className = '' }) {
  return (
    <div className={`beta-stat-card ${className}`} style={{ '--accent': color }} onClick={onClick}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-content">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {subValue && <div className="stat-sub">{subValue}</div>}
      </div>
      {trend !== undefined && (
        <div className={`stat-trend ${trend >= 0 ? 'up' : 'down'}`}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function FleetHealthRing({ online, total, size = 120 }) {
  const percentage = total > 0 ? Math.round((online / total) * 100) : 0;
  const data = [{ name: 'Health', value: percentage, fill: percentage >= 80 ? COLORS.success : percentage >= 50 ? COLORS.warning : COLORS.danger }];
  
  return (
    <div className="fleet-health-ring">
      <ResponsiveContainer width={size} height={size}>
        <RadialBarChart 
          cx="50%" cy="50%" 
          innerRadius="70%" outerRadius="100%" 
          barSize={10} 
          data={data} 
          startAngle={90} 
          endAngle={-270}
        >
          <RadialBar
            background={{ fill: 'var(--bg-secondary)' }}
            clockWise
            dataKey="value"
            cornerRadius={5}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="ring-center">
        <div className="ring-value">{percentage}%</div>
        <div className="ring-label">Healthy</div>
      </div>
    </div>
  );
}

// UK Map showing router locations
function FleetMap({ routers, onRouterClick }) {
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapRef = React.useRef(null);
  const mapInstanceRef = React.useRef(null);

  // Get routers with valid coordinates
  const routersWithLocation = useMemo(() => {
    return routers.filter(r => r.latitude && r.longitude);
  }, [routers]);

  // Load Leaflet dynamically
  useEffect(() => {
    if (window.L) {
      setMapLoaded(true);
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    link.crossOrigin = '';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = '';
    script.onload = () => setMapLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Initialize/update map
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const L = window.L;

    // Clean up existing map
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // UK center coordinates
    const ukCenter = [54.5, -3.5];
    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false
    }).setView(ukCenter, 6);

    mapInstanceRef.current = map;

    // Dark mode tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    // Add zoom control to bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Add router markers - offline first, then online on top
    const offlineRouters = routersWithLocation.filter(r => 
      r.current_status !== 'online' && r.current_status !== 1
    );
    const onlineRouters = routersWithLocation.filter(r => 
      r.current_status === 'online' || r.current_status === 1
    );
    
    // Add offline markers first (so online appear on top)
    [...offlineRouters, ...onlineRouters].forEach(router => {
      const isOnline = router.current_status === 'online' || router.current_status === 1;
      const color = isOnline ? '#10b981' : '#ef4444';
      
      const marker = L.circleMarker([router.latitude, router.longitude], {
        radius: 2,
        fillColor: color,
        color: isOnline ? '#059669' : '#dc2626',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.9
      });

      marker.bindTooltip(`
        <strong>${router.name || router.router_id}</strong><br/>
        ${isOnline ? '🟢 Online' : '🔴 Offline'}<br/>
        ${router.location || 'No location set'}
      `, { direction: 'top', offset: [0, -8] });

      marker.on('click', () => onRouterClick && onRouterClick(router));
      marker.addTo(map);
    });

    // Fit bounds if we have routers
    if (routersWithLocation.length > 0) {
      const bounds = L.latLngBounds(routersWithLocation.map(r => [r.latitude, r.longitude]));
      map.fitBounds(bounds.pad(0.1), { maxZoom: 10 });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [mapLoaded, routersWithLocation, onRouterClick]);

  // Count from ALL routers for consistent legend (not just those with location)
  const totalOnline = routers.filter(r =>
    r.current_status === 'online' || r.current_status === 1 || r.current_status === '1'
  ).length;
  const totalOffline = routers.length - totalOnline;

  return (
    <div className="fleet-map-container">
      <div className="fleet-map" ref={mapRef} />
      <div className="map-legend">
        <div className="legend-item">
          <span className="legend-marker online" />
          <span>{totalOnline} Online</span>
        </div>
        <div className="legend-item">
          <span className="legend-marker offline" />
          <span>{totalOffline} Offline</span>
        </div>
      </div>
      {routersWithLocation.length === 0 && (
        <div className="map-no-data">
          No location data available
        </div>
      )}
    </div>
  );
}

function DataUsageChart({ data, dark }) {
  return (
    <div className="beta-chart-container">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="betaGradTx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.8}/>
              <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0.1}/>
            </linearGradient>
            <linearGradient id="betaGradRx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.8}/>
              <stop offset="95%" stopColor={COLORS.success} stopOpacity={0.1}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#334155' : '#e5e7eb'} />
          <XAxis 
            dataKey="date" 
            tickFormatter={(t) => {
              const d = new Date(t);
              return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            }}
            tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
            axisLine={{ stroke: dark ? '#475569' : '#cbd5e1' }}
          />
          <YAxis 
            tickFormatter={(v) => formatBytes(v).split(' ')[0]}
            tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
            axisLine={{ stroke: dark ? '#475569' : '#cbd5e1' }}
          />
          <Tooltip
            formatter={(v) => formatBytes(v)}
            labelFormatter={(t) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            contentStyle={{
              backgroundColor: dark ? '#1e293b' : '#ffffff',
              border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
          />
          <Legend />
          <Area 
            type="monotone" 
            dataKey="tx_bytes" 
            stroke={COLORS.primary} 
            fill="url(#betaGradTx)" 
            name="Upload (TX)"
            strokeWidth={2}
          />
          <Area 
            type="monotone" 
            dataKey="rx_bytes" 
            stroke={COLORS.success} 
            fill="url(#betaGradRx)" 
            name="Download (RX)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TopRoutersChart({ data, dark, onRouterClick }) {
  // Custom tick component for clickable router names
  const CustomYAxisTick = ({ x, y, payload }) => {
    const router = data.find(r => r.name === payload.value);
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={-6}
          y={0}
          dy={4}
          textAnchor="end"
          fill={dark ? '#94a3b8' : '#64748b'}
          fontSize={11}
          style={{ cursor: 'pointer' }}
          onClick={() => router && onRouterClick && onRouterClick(router)}
          className="clickable-router-name"
        >
          {payload.value}
        </text>
      </g>
    );
  };

  return (
    <div className="beta-chart-container">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#334155' : '#e5e7eb'} horizontal={false} />
          <XAxis 
            type="number" 
            tickFormatter={(v) => formatBytes(v).split(' ')[0]}
            tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
          />
          <YAxis 
            type="category" 
            dataKey="name" 
            width={140}
            tick={<CustomYAxisTick />}
          />
          <Tooltip 
            formatter={(v) => formatBytes(v)}
            contentStyle={{
              backgroundColor: dark ? '#1e293b' : '#ffffff',
              border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
              borderRadius: 8
            }}
          />
          <Bar 
            dataKey="tx_bytes" 
            stackId="a" 
            fill={COLORS.primary} 
            name="Upload"
            radius={[0, 0, 0, 0]}
          />
          <Bar 
            dataKey="rx_bytes" 
            stackId="a" 
            fill={COLORS.success} 
            name="Download"
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function OperatorDonut({ data, dark }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  
  return (
    <div className="operator-donut-container">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip 
            formatter={(v) => [formatBytes(v), 'Data']}
            contentStyle={{
              backgroundColor: dark ? '#1e293b' : '#ffffff',
              border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
              borderRadius: 8
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="operator-legend">
        {data.map((op, i) => (
          <div key={op.name} className="legend-item">
            <span className="legend-dot" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="legend-name">{op.name}</span>
            <span className="legend-value">{total > 0 ? Math.round((op.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuestSessionsChart({ timeline, dark }) {
  if (!timeline || timeline.length === 0) return null;
  
  // Reverse to get chronological order
  const data = [...timeline].reverse();
  
  // Calculate max value for better Y-axis scaling
  const maxSessions = Math.max(...data.map(d => d.sessions || 0), 1);
  const yAxisMax = Math.ceil(maxSessions * 1.2); // Add 20% headroom
  
  return (
    <div className="beta-chart-container">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
          <defs>
            <linearGradient id="sessionsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.4}/>
              <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0.05}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#334155' : '#e5e7eb'} vertical={false} />
          <XAxis 
            dataKey="date" 
            tickFormatter={(t) => {
              const d = new Date(t);
              return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            }}
            tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
            axisLine={{ stroke: dark ? '#475569' : '#cbd5e1' }}
            tickLine={{ stroke: dark ? '#475569' : '#cbd5e1' }}
          />
          <YAxis 
            tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
            allowDecimals={false}
            domain={[0, yAxisMax]}
            axisLine={{ stroke: dark ? '#475569' : '#cbd5e1' }}
            tickLine={{ stroke: dark ? '#475569' : '#cbd5e1' }}
            width={40}
          />
          <Tooltip 
            contentStyle={{
              backgroundColor: dark ? '#1e293b' : '#ffffff',
              border: `1px solid ${dark ? '#475569' : '#e2e8f0'}`,
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              padding: '10px 14px'
            }}
            labelStyle={{ color: dark ? '#e2e8f0' : '#1e293b', fontWeight: 600, marginBottom: 4 }}
            itemStyle={{ color: dark ? '#94a3b8' : '#64748b' }}
            labelFormatter={(t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          />
          <Area 
            type="monotone" 
            dataKey="sessions" 
            stroke={COLORS.purple} 
            strokeWidth={2.5}
            fill="url(#sessionsGradient)"
            dot={{ r: 5, fill: COLORS.purple, strokeWidth: 2, stroke: dark ? '#1e293b' : '#ffffff' }}
            activeDot={{ r: 7, fill: COLORS.purple, strokeWidth: 2, stroke: '#ffffff' }}
            name="Sessions"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function WiFiActivityHeatmap({ data, dark }) {
  // Build hourly activity from usage data
  const hourlyData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, value: 0 }));
    
    data.forEach(d => {
      const date = new Date(d.date);
      const hour = date.getHours();
      hours[hour].value += Number(d.total_bytes) || 0;
    });
    
    const max = Math.max(...hours.map(h => h.value), 1);
    return hours.map(h => ({ ...h, intensity: h.value / max }));
  }, [data]);

  return (
    <div className="activity-heatmap">
      <div className="heatmap-hours">
        {hourlyData.map(h => (
          <div 
            key={h.hour}
            className="heatmap-cell"
            style={{ 
              background: `rgba(99, 102, 241, ${0.1 + h.intensity * 0.9})`,
              color: h.intensity > 0.5 ? '#fff' : 'var(--text-secondary)'
            }}
            title={`${h.hour}:00 - ${formatBytes(h.value)}`}
          >
            {h.hour}
          </div>
        ))}
      </div>
      <div className="heatmap-label">Hour of Day Activity</div>
    </div>
  );
}

function DataUsageCard({ label, bytes, trend, color }) {
  const gb = bytes / 1e9;
  const costPerGB = 2.20;
  const cost = gb * costPerGB;

  return (
    <div className="data-usage-card" style={{ '--accent': color }}>
      <div className="data-usage-header">
        <div className="data-usage-icon">📊</div>
        <span className="data-usage-label">{label}</span>
        {trend !== undefined && (
          <span className={`data-usage-trend ${trend >= 0 ? 'up' : 'down'}`}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="data-usage-value">
        <span className="data-value-number">{gb.toFixed(2)}</span>
        <span className="data-value-unit">GB</span>
      </div>
      <div className="data-usage-details">
        <div className="detail-row">
          <span className="detail-label">Rate</span>
          <span className="detail-value">£{costPerGB.toFixed(2)}/GB</span>
        </div>
        <div className="detail-row highlight">
          <span className="detail-label">Estimated Cost</span>
          <span className="detail-value">£{cost.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AnalyticsBeta({ onOpenRouter }) {
  const [timeRange, setTimeRange] = useState(TIME_RANGES[1]); // Default 24H
  const [routers, setRouters] = useState([]);
  const [usage, setUsage] = useState([]);
  const [usagePrev, setUsagePrev] = useState([]);
  const [topRouters, setTopRouters] = useState([]);
  const [operators, setOperators] = useState([]);
  const [guestStats, setGuestStats] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [statusSummary, setStatusSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { hours, days } = timeRange;
      
      // Parallel data fetching
      const [
        routersRes,
        usageRes,
        topRes,
        operatorsRes,
        guestRes,
        statusRes
      ] = await Promise.all([
        getRouters(),
        getNetworkUsageRolling({ hours, bucket: hours <= 24 ? 'hour' : 'day' }),
        getTopRoutersRolling({ hours, limit: 8 }),
        getOperators({ days }),
        getGuestWifiStats(days).catch(() => ({ data: null })),
        getRouterStatusSummary().catch(() => ({ data: null }))
      ]);

      setRouters(routersRes.data || []);
      setUsage(usageRes.data || []);
      
      // Fetch previous period for comparison (optional - don't block on failure)
      try {
        const prevRes = await getNetworkUsageRolling({ hours, bucket: hours <= 24 ? 'hour' : 'day' });
        // For now, use same data as baseline - true comparison would need offset
        setUsagePrev(prevRes.data || []);
      } catch {
        setUsagePrev([]);
      }
      
      setTopRouters((topRes.data || []).map(r => ({
        router_id: r.router_id,
        name: r.name || r.router_id,
        tx_bytes: Number(r.tx_bytes) || 0,
        rx_bytes: Number(r.rx_bytes) || 0,
        total_bytes: Number(r.total_bytes) || 0
      })));
      
      setOperators((operatorsRes.data || []).map((x, i) => ({
        name: x.operator || 'Unknown',
        value: Number(x.total_bytes) || 0
      })));
      
      setGuestStats(guestRes.data || null);
      setStatusSummary(statusRes.data || null);
      setLastUpdated(new Date());
      
    } catch (e) {
      console.error('Failed to load analytics:', e);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Computed values
  const fleetMetrics = useMemo(() => {
    const online = routers.filter(r => 
      r.current_status === 'online' || r.current_status === 1 || r.current_status === '1'
    ).length;
    const offline = routers.length - online;
    const healthPercent = routers.length > 0 ? Math.round((online / routers.length) * 100) : 0;
    
    return { online, offline, total: routers.length, healthPercent };
  }, [routers]);

  const dataMetrics = useMemo(() => {
    const sumBytes = (arr) => arr.reduce((s, d) => s + (Number(d.total_bytes) || 0), 0);
    const current = sumBytes(usage);
    const previous = sumBytes(usagePrev);
    const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;
    
    return { current, previous, change };
  }, [usage, usagePrev]);

  const topRouterShare = useMemo(() => {
    if (topRouters.length === 0 || dataMetrics.current === 0) return 0;
    return Math.round((topRouters[0].total_bytes / dataMetrics.current) * 100);
  }, [topRouters, dataMetrics]);

  const handleRouterClick = useCallback((router) => {
    if (!onOpenRouter) return;
    const routerData = routers.find(r => 
      String(r.router_id) === String(router.router_id) || r.name === router.name
    );
    if (routerData) onOpenRouter(routerData);
  }, [onOpenRouter, routers]);

  return (
    <div className="analytics-beta">
      {/* Header */}
      <div className="beta-header">
        <div className="beta-title-section">
          <h1>Dashboard</h1>
          <p className="beta-subtitle">Real-time fleet monitoring and insights</p>
        </div>
        <div className="beta-controls">
          <TimeRangeSelector selected={timeRange} onChange={setTimeRange} />
          <button className="refresh-btn" onClick={loadData} disabled={loading}>
            {loading ? '⏳' : '↻'} {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Fleet Health Overview - New Layout with Map in Center */}
      <section className="beta-section fleet-overview">
        <div className="section-header">
          <h2>🌐 Fleet Overview</h2>
          {lastUpdated && (
            <span className="last-updated">Updated {getTimeAgo(lastUpdated)}</span>
          )}
        </div>
        <div className="fleet-overview-content-new">
          {/* Left Column - Stats */}
          <div className="fleet-left-column">
            <div className="fleet-health-card">
              <FleetHealthRing online={fleetMetrics.online} total={fleetMetrics.total} size={140} />
              <div className="fleet-counts-row">
                <div className="fleet-count online">
                  <span className="fleet-count-dot" />
                  <span className="fleet-count-value">{fleetMetrics.online}</span>
                  <span className="fleet-count-label">Online</span>
                </div>
                <div className="fleet-count offline">
                  <span className="fleet-count-dot" />
                  <span className="fleet-count-value">{fleetMetrics.offline}</span>
                  <span className="fleet-count-label">Offline</span>
                </div>
              </div>
            </div>
            <DataUsageCard
              label={`${timeRange.label} Data Usage`}
              bytes={dataMetrics.current}
              trend={dataMetrics.change}
              color={COLORS.primary}
            />
          </div>

          {/* Center - UK Map */}
          <div className="fleet-map-column">
            <FleetMap routers={routers} onRouterClick={handleRouterClick} />
          </div>

          {/* Right Column - More Stats */}
          <div className="fleet-right-column">
            <StatCard 
              icon="🏆" 
              label="Top Consumer"
              value={topRouters[0]?.name || '-'}
              subValue={`${topRouterShare}% of total traffic`}
              color={COLORS.warning}
              onClick={() => topRouters[0] && handleRouterClick(topRouters[0])}
              className="clickable"
            />
            <StatCard 
              icon="📡" 
              label="Fleet Size"
              value={`${fleetMetrics.total} Routers`}
              subValue={`${routers.filter(r => r.latitude && r.longitude).length} with GPS data`}
              color={COLORS.info}
            />
            <StatCard 
              icon="⚡" 
              label="Data Rate"
              value={`${formatBytes(dataMetrics.current / timeRange.hours)}/hr`}
              subValue={`£${((dataMetrics.current / 1e6) * 0.0022).toFixed(2)} total cost`}
              color={COLORS.purple}
            />
          </div>
        </div>
      </section>

      {/* Data Usage Section */}
      <section className="beta-section">
        <div className="section-header">
          <h2>📈 Network Usage</h2>
        </div>
        <div className="charts-grid">
          <div className="beta-card wide">
            <h3>Data Transfer Over Time</h3>
            <DataUsageChart data={usage} dark={true} />
          </div>
          <div className="beta-card">
            <h3>Top 8 Routers by Usage</h3>
            <TopRoutersChart 
              data={topRouters} 
              dark={true} 
              onRouterClick={handleRouterClick}
            />
          </div>
        </div>
      </section>

      {/* Operators & Activity */}
      <section className="beta-section">
        <div className="section-header">
          <h2>📡 Network Distribution</h2>
        </div>
        <div className="charts-grid three-col">
          <div className="beta-card">
            <h3>Operator Share</h3>
            {operators.length > 0 ? (
              <OperatorDonut data={operators} dark={true} />
            ) : (
              <div className="no-data">No operator data available</div>
            )}
          </div>
          <div className="beta-card">
            <h3>Peak Usage Hours</h3>
            <WiFiActivityHeatmap data={usage} dark={true} />
          </div>
          <div className="beta-card">
            <h3>Quick Stats</h3>
            <div className="quick-stats">
              <div className="quick-stat">
                <span className="qs-label">Avg per Router</span>
                <span className="qs-value">
                  {routers.length > 0 ? formatBytes(dataMetrics.current / routers.length) : '-'}
                </span>
              </div>
              <div className="quick-stat">
                <span className="qs-label">Active Operators</span>
                <span className="qs-value">{operators.length}</span>
              </div>
              <div className="quick-stat">
                <span className="qs-label">Data Rate</span>
                <span className="qs-value">
                  {formatBytes(dataMetrics.current / timeRange.hours)}/hr
                </span>
              </div>
              <div className="quick-stat">
                <span className="qs-label">Fleet Uptime</span>
                <span className="qs-value">{fleetMetrics.healthPercent}%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Guest WiFi Section */}
      {guestStats && (
        <section className="beta-section wifi-section">
          <div className="section-header">
            <h2>📶 Guest WiFi</h2>
            <span className="period-badge">{guestStats.period}</span>
          </div>
          <div className="wifi-grid">
            <StatCard 
              icon="👥" 
              label="Total Sessions"
              value={formatNumber(guestStats.summary?.total_sessions || 0)}
              color={COLORS.purple}
            />
            <StatCard 
              icon="🧑‍💻" 
              label="Unique Guests"
              value={formatNumber(guestStats.summary?.unique_guests || 0)}
              color={COLORS.info}
            />
            <StatCard 
              icon="📱" 
              label="Unique Devices"
              value={formatNumber(guestStats.summary?.unique_devices || 0)}
              color={COLORS.pink}
            />
            <StatCard 
              icon="⏱️" 
              label="Avg Session"
              value={formatDuration(guestStats.summary?.avg_session_duration || 0)}
              color={COLORS.success}
            />
            <StatCard 
              icon="🟢" 
              label="Active Now"
              value={formatNumber(guestStats.summary?.active_sessions || 0)}
              color={COLORS.success}
            />
            <StatCard 
              icon="📍" 
              label="Routers Used"
              value={formatNumber(guestStats.summary?.routers_used || 0)}
              color={COLORS.warning}
            />
          </div>
          
          {guestStats.timeline && guestStats.timeline.length > 0 && (
            <div className="beta-card" style={{ marginTop: 16 }}>
              <h3>Guest Sessions Over Time</h3>
              <GuestSessionsChart timeline={guestStats.timeline} dark={true} />
            </div>
          )}

          {guestStats.byRouter && guestStats.byRouter.length > 0 && (
            <div className="beta-card" style={{ marginTop: 16 }}>
              <h3>Top Routers by Guest WiFi Usage</h3>
              <div className="guest-router-table">
                <div className="table-header">
                  <span>Router</span>
                  <span>Sessions</span>
                  <span>Guests</span>
                  <span>Data</span>
                </div>
                {guestStats.byRouter.slice(0, 5).map((r, i) => (
                  <div key={r.router_id || i} className="table-row">
                    <span className="router-name">{r.router_name || r.router_id}</span>
                    <span>{formatNumber(r.session_count)}</span>
                    <span>{formatNumber(r.unique_guests)}</span>
                    <span>{formatBytes(r.total_bytes)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Footer */}
      <div className="beta-footer">
        <span>Analytics Beta • Auto-refreshes on time range change</span>
        {lastUpdated && (
          <span>Last updated: {lastUpdated.toLocaleTimeString('en-GB')}</span>
        )}
      </div>
    </div>
  );
}
