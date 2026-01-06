import React, { useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell, ReferenceLine, ReferenceArea } from 'recharts';
import { getLogs, getUsageStats, getUptimeData, logInspection, getInspectionHistory, getGuestsByRouter } from '../services/api';
import { exportUptimeReportToPDF } from '../utils/exportUtils';
import { toast } from 'react-toastify';
import ClickUpTaskWidget from './ClickUpTaskWidget';
import PropertySearchWidget from './PropertySearchWidget';
import LocationMap from './LocationMap';
import { useNavigate } from 'react-router-dom';
import './RouterDashboard.css';

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
  return n + ' B';
}

function isoMinus({ hours = 0, days = 0 }) {
  const d = new Date();
  if (hours) d.setHours(d.getHours() - hours);
  if (days) d.setDate(d.getDate() - days);
  return d.toISOString();
}

function StatusPill({ status }) {
  const online = status === 'online' || status === 1 || status === '1' || status === true;
  return (
    <span className={`rd-pill ${online ? 'ok' : 'bad'}`}>{online ? '● Online' : '○ Offline'}</span>
  );
}

export default function RouterDashboard({ router }) {
  const navigate = useNavigate();
  const [range, setRange] = useState({ type: 'hours', value: 24 }); // hours|days|custom
  const [customStart, setCustomStart] = useState(null);
  const [customEnd, setCustomEnd] = useState(null);
  const [, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [uptime, setUptime] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [wifiGuests, setWifiGuests] = useState([]); // WiFi guest logins for this router
  const [showUserLogins, setShowUserLogins] = useState(true); // Toggle for showing user logins on chart
  const [showRawData, setShowRawData] = useState(false); // Toggle for chart scale (false = normalized)
  const [useRollingAverage, setUseRollingAverage] = useState(true); // Toggle for rolling average (true = smoothed by default)
  const [expandedSection, setExpandedSection] = useState('location'); // Accordion state: 'location', 'latest', 'uptime', 'inspections', or 'wifi-users'
  const propertyWidgetRef = useRef(null);

  const routerId = router?.router_id;

  const { start, end, label } = useMemo(() => {
    const nowIso = new Date().toISOString();
    if (range.type === 'custom') {
      const s = customStart ? new Date(customStart).toISOString() : isoMinus({ hours: 24 });
      const e = customEnd ? new Date(customEnd).toISOString() : nowIso;
      const lbl = customStart && customEnd
        ? `${new Date(s).toLocaleString()} → ${new Date(e).toLocaleString()}`
        : 'Custom (pick dates)';
      return { start: s, end: e, label: lbl };
    }
    if (range.type === 'hours') {
      const s = isoMinus({ hours: range.value || 24 });
      return { start: s, end: nowIso, label: `Last ${range.value}h` };
    }
    const s = isoMinus({ days: range.value || 7 });
    return { start: s, end: nowIso, label: `Last ${range.value}d` };
  }, [range, customStart, customEnd]);

  const loadSeqRef = useRef(0);
  useEffect(() => {
    let mounted = true;
    const seq = ++loadSeqRef.current; // mark this load as the latest

    // Debounce rapid changes (e.g., fast toggling timeframes)
    const timeout = setTimeout(async () => {
      if (!routerId) return;
      setLoading(true);
      try {
        const [logsRes, statsRes, upRes, inspRes, guestsRes] = await Promise.all([
          getLogs({ router_id: routerId, start_date: start, end_date: end, limit: 5000 }),
          getUsageStats({ router_id: routerId, start_date: start, end_date: end }),
          getUptimeData({ router_id: routerId, start_date: start, end_date: end }),
          getInspectionHistory(routerId),
          getGuestsByRouter(routerId, 500, 0).catch(() => ({ data: { guests: [] } }))
        ]);
        // Ignore if a newer load started or component unmounted
        if (!mounted || seq !== loadSeqRef.current) return;
        setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
        // Handle nested data structure: statsRes.data.data[0]
        const extractedStats = statsRes.data?.data?.[0] || statsRes.data?.[0] || statsRes.data || null;
        setStats(extractedStats);
        setUptime(Array.isArray(upRes.data) ? upRes.data : []);
        setInspections(Array.isArray(inspRes.data) ? inspRes.data : []);
        setWifiGuests(Array.isArray(guestsRes.data?.guests) ? guestsRes.data.guests : []);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load router dashboard', e);
        if (!mounted || seq !== loadSeqRef.current) return;
        setLogs([]);
        setStats(null);
        setUptime([]);
        setInspections([]);
        setWifiGuests([]);
      } finally {
        if (mounted && seq === loadSeqRef.current) setLoading(false);
      }
    }, 350);

    return () => { mounted = false; clearTimeout(timeout); };
  }, [routerId, start, end]);

  // Build deltas series from cumulative totals
  const series = useMemo(() => {
    if (!logs || logs.length === 0) return { txrx: [], latest: null };
    // logs endpoint orders DESC, so reverse to ASC
    const asc = [...logs].sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp));
    let prevTx = null, prevRx = null;
    const txrx = [];
    for (const l of asc) {
      const ts = new Date(l.timestamp);
      const tx = Number(l.total_tx_bytes)||0;
      const rx = Number(l.total_rx_bytes)||0;
      const dtx = prevTx == null ? 0 : Math.max(tx - prevTx, 0);
      const drx = prevRx == null ? 0 : Math.max(rx - prevRx, 0);
      txrx.push({ 
        date: ts.toISOString(), 
        tx_bytes: dtx, 
        rx_bytes: drx, 
        total_bytes: dtx + drx,
        // Inline fields to avoid timestamp matching later (no signal fields)
        operator: l.operator,
        wan_ip: l.wan_ip,
        status: l.status
      });
      prevTx = tx; prevRx = rx;
    }
    
    // Apply rolling average if enabled
    if (useRollingAverage && txrx.length > 1) {
      const windowSize = Math.max(3, Math.floor(txrx.length / 20)); // Adaptive window size
      for (let i = 0; i < txrx.length; i++) {
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(txrx.length, i + Math.ceil(windowSize / 2));
        const window = txrx.slice(start, end);
        
        const avgTx = window.reduce((sum, d) => sum + d.tx_bytes, 0) / window.length;
        const avgRx = window.reduce((sum, d) => sum + d.rx_bytes, 0) / window.length;
        
        txrx[i].tx_bytes = avgTx;
        txrx[i].rx_bytes = avgRx;
        txrx[i].total_bytes = avgTx + avgRx;
      }
    }
    
    // Remove outliers that skew the chart (only if NOT showing raw data)
    if (!showRawData) {
      const totalValues = txrx.map(d => d.total_bytes).filter(v => v > 0);
      if (totalValues.length > 0) {
        const sorted = [...totalValues].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const outlierThreshold = median * 5; // 5x median instead of 3x to be less aggressive
        
        // Filter out extreme outliers but keep the data points (just cap them)
        txrx.forEach(d => {
          if (d.tx_bytes > outlierThreshold) d.tx_bytes = outlierThreshold;
          if (d.rx_bytes > outlierThreshold) d.rx_bytes = outlierThreshold;
          d.total_bytes = d.tx_bytes + d.rx_bytes;
        });
      }
    }
    
    const latest = asc[asc.length-1];
    return { txrx, latest };
  }, [logs, showRawData, useRollingAverage]);

  const totalBytes = useMemo(() => {
    // Use stats if available (includes baseline jump), otherwise sum from logs
    if (stats?.total_data_usage != null) {
      return Number(stats.total_data_usage) || 0;
    }
    const summed = (series.txrx || []).reduce((s,d)=> s + (Number(d.total_bytes)||0), 0);
    return summed;
  }, [series, stats]);
  const onlinePct = useMemo(() => {
    if (!uptime || uptime.length === 0) {
      console.log('RouterDashboard - No uptime data available');
      return null;
    }
    const on = uptime.filter(u => (u.status === 'online' || u.status === 1 || u.status === '1' || u.status === true)).length;
    const pct = Math.round(on / uptime.length * 100);
    return pct;;
  }, [uptime]);

  const yMax = useMemo(() => {
    let m = 1; for (const d of series.txrx||[]) { if (d.tx_bytes>m) m=d.tx_bytes; if (d.rx_bytes>m) m=d.rx_bytes; } return Math.ceil(m*1.1);
  }, [series]);

  // Filter WiFi guests to those within the selected time range
  const filteredGuests = useMemo(() => {
    if (!wifiGuests || wifiGuests.length === 0) return [];
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    return wifiGuests.filter(guest => {
      const guestDate = new Date(guest.creation_date || guest.auth_date);
      return guestDate >= startDate && guestDate <= endDate;
    }).sort((a, b) => new Date(b.creation_date || b.auth_date) - new Date(a.creation_date || a.auth_date));
  }, [wifiGuests, start, end]);

  // Generate unique colors for users
  const userColors = useMemo(() => {
    const colors = [
      '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', 
      '#f97316', '#06b6d4', '#84cc16', '#a855f7', '#22c55e'
    ];
    const uniqueUsers = [...new Set(filteredGuests.map(g => g.username || g.email))];
    const colorMap = {};
    uniqueUsers.forEach((user, idx) => {
      colorMap[user] = colors[idx % colors.length];
    });
    return colorMap;
  }, [filteredGuests]);

  // Calculate inspection status
  const inspectionStatus = useMemo(() => {
    // Priority: 1) Last inspection log, 2) RMS created_at, 3) Local created_at
    let inspectionDate;
    if (inspections && inspections.length > 0) {
      // Use most recent inspection
      inspectionDate = inspections[0].inspected_at;
    } else {
      // Fallback to RMS created_at or local created_at
      inspectionDate = router?.rms_created_at || router?.created_at;
    }
    
    if (!inspectionDate) {
      return null;
    }
    const createdDate = new Date(inspectionDate);
    const inspectionDue = new Date(createdDate);
    inspectionDue.setFullYear(inspectionDue.getFullYear() + 1); // 365 days from inspection date
    const now = new Date();
    const msRemaining = inspectionDue - now;
    const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
    const overdue = daysRemaining < 0;
    return {
      createdDate,
      inspectionDue,
      daysRemaining,
      overdue
    };
  }, [router, inspections]);

  const latest = series.latest;

  // Load logo as data URL
  const loadLogoDataUrl = async () => {
    try {
      const url = (process.env.PUBLIC_URL || '') + '/Logo.png';
      const res = await fetch(url, { cache: 'no-store' });
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (_e) {
      return null;
    }
  };

  const handleExportUptime = async () => {
    const logoDataUrl = await loadLogoDataUrl();
    await exportUptimeReportToPDF(uptime || [], routerId, start, end, { 
      logoDataUrl,
      router,
      stats
    });
  };

  const handleLogInspection = async () => {
    try {
      await logInspection(routerId, {
        inspected_by: 'System User',
        notes: 'Inspection logged via dashboard'
      });
      toast.success('Inspection logged successfully! Counter will reset on next data refresh.');
      // Reload the page after a short delay to show updated inspection status
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      console.error('Failed to log inspection:', error);
      toast.error('Failed to log inspection');
    }
  };

  return (
    <div className="router-dash">
      <div className="rd-header">
        <div>
          <h2 className="router-title">{router?.name || routerId}</h2>
          <div className="rd-sub">
            <StatusPill status={router?.current_status} />
            {(router?.last_seen || latest?.timestamp) && (
              <span className="muted">
                Last seen {new Date(router?.last_seen || latest.timestamp).toLocaleString()}
              </span>
            )}
            {latest?.wan_ip && <span className="muted">WAN {latest.wan_ip}</span>}
          </div>
        </div>
        <div className="rd-range">
          <div className="seg">
            <button className={range.type==='hours'&&range.value===6?'active':''} onClick={()=>setRange({type:'hours', value:6})}>6h</button>
            <button className={range.type==='hours'&&range.value===24?'active':''} onClick={()=>setRange({type:'hours', value:24})}>24h</button>
            <button className={range.type==='days'&&range.value===7?'active':''} onClick={()=>setRange({type:'days', value:7})}>7d</button>
            <button className={range.type==='days'&&range.value===30?'active':''} onClick={()=>setRange({type:'days', value:30})}>30d</button>
            <button className={range.type==='days'&&range.value===92?'active':''} onClick={()=>setRange({type:'days', value:92})}>92d</button>
            <button className={range.type==='custom'?'active':''} onClick={()=>setRange({type:'custom'})}>Custom</button>
            <div style={{ marginLeft: 'auto' }}>
              <button className="btn btn-primary" onClick={handleExportUptime}>Export Uptime Report (PDF)</button>
            </div>
          </div>
          <span className="muted" style={{ marginLeft: 8 }}>{label}</span>
        </div>
      </div>

      {/* Two column layout: ClickUp Task | Location Assignment */}
      <div className="widgets-row">
        <ClickUpTaskWidget 
          router={router} 
          onStoredWith={() => propertyWidgetRef.current?.openStoredWithModal()}
        />
        <PropertySearchWidget 
          ref={propertyWidgetRef}
          router={router} 
          onAssigned={() => {
            // Optionally reload data when location is assigned
            console.log('Location assigned to router');
          }} 
        />
      </div>

      {/* Hero metrics */}
      <div className="rd-metrics">
        <div className="metric" style={{ borderLeftColor:'#6366f1' }}>
          <div className="label">Data Transfer</div>
          <div className="value">{formatBytes(totalBytes)}</div>
          <div className="sub">{label}</div>
        </div>
        <div className="metric" style={{ borderLeftColor:'#10b981' }}>
          <div className="label">Uptime</div>
          <div className="value">{onlinePct==null? '—' : `${onlinePct}%`}</div>
          <div className="sub">{uptime?.length || 0} samples</div>
        </div>
        <div className="metric" style={{ borderLeftColor:'#8b5cf6' }}>
          <div className="label">Logs</div>
          <div className="value">{stats?.total_logs?.toLocaleString?.() || (logs?.length||0)}</div>
          <div className="sub">in range</div>
        </div>
        <div className="metric" style={{ borderLeftColor: inspectionStatus?.overdue ? '#ef4444' : '#f59e0b' }}>
          <div className="label">Inspection Status</div>
          <div className="value">
            {inspectionStatus ? (
              inspectionStatus.overdue 
                ? `${Math.abs(inspectionStatus.daysRemaining)} days overdue` 
                : `${inspectionStatus.daysRemaining} days`
            ) : '—'}
          </div>
          <div className="sub">
            {inspectionStatus ? (
              <>
                {inspectionStatus.overdue 
                  ? 'OVERDUE - Reinspection Required' 
                  : 'until reinspection'}
                <br/>
                <span style={{ fontSize: '11px', marginTop: '4px', display: 'block' }}>
                  Due: {inspectionStatus.inspectionDue.toLocaleDateString()}
                </span>
              </>
            ) : 'No inspection date'}
          </div>
        </div>
      </div>

      {range.type==='custom' && (
        <div className="card" style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span className="muted">From</span>
            <DatePicker
              selected={customStart}
              onChange={(d)=> setCustomStart(d)}
              showTimeSelect
              timeIntervals={15}
              dateFormat="yyyy-MM-dd HH:mm"
              placeholderText="Select start"
              maxDate={customEnd || undefined}
              className="input"
            />
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span className="muted">To</span>
            <DatePicker
              selected={customEnd}
              onChange={(d)=> setCustomEnd(d)}
              showTimeSelect
              timeIntervals={15}
              dateFormat="yyyy-MM-dd HH:mm"
              placeholderText="Select end"
              minDate={customStart || undefined}
              className="input"
            />
          </div>
          <div style={{ display:'flex', gap:8, marginLeft:'auto' }}>
            <button 
              className="btn btn-secondary" 
              onClick={()=>{ setCustomStart(null); setCustomEnd(null); setRange({ type:'hours', value:24 }); }}
            >Reset</button>
            <button 
              className="btn btn-primary" 
              onClick={()=> setRange({ type:'custom', applied: Date.now() })}
              disabled={!(customStart && customEnd) || (customStart && customEnd && (new Date(customEnd) <= new Date(customStart)))}
            >Apply</button>
          </div>
        </div>
      )}

      {/* Accordion Sections */}
      <div className="rd-accordion">
        {/* Location Section - First and expanded by default */}
        <div className={`accordion-item ${expandedSection === 'location' ? 'expanded' : ''}`}>
          <div 
            className="accordion-header" 
            onClick={() => setExpandedSection(expandedSection === 'location' ? null : 'location')}
          >
            <span className="accordion-title">📍 Location</span>
            <span className="accordion-icon">{expandedSection === 'location' ? '▼' : '▶'}</span>
          </div>
          {expandedSection === 'location' && (
            <div className="accordion-content">
              <LocationMap routerId={routerId} />
            </div>
          )}
        </div>

        {/* Uptime Samples Section */}
        <div className={`accordion-item ${expandedSection === 'uptime' ? 'expanded' : ''}`}>
          <div 
            className="accordion-header" 
            onClick={() => setExpandedSection(expandedSection === 'uptime' ? null : 'uptime')}
          >
            <span className="accordion-title">Uptime Samples</span>
            <span className="accordion-icon">{expandedSection === 'uptime' ? '▼' : '▶'}</span>
          </div>
          {expandedSection === 'uptime' && (
            <div className="accordion-content">
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={(uptime||[]).map(d => {
                      const isOnline = (d.status === 'online' || d.status === 1 || d.status === '1' || d.status === true);
                      return {
                        ...d,
                        online: isOnline ? 1 : null,
                        offline: !isOnline ? 0 : null
                      };
                    })} 
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={(t)=> { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); }}
                      tick={{ fontSize: 10, fill: '#374151' }}
                      interval="preserveStartEnd"
                      minTickGap={20}
                    />
                    <YAxis 
                      domain={[0, 1]} 
                      ticks={[0, 1]} 
                      tickFormatter={(v) => v === 1 ? 'Online' : 'Offline'}
                      tick={{ fontSize: 10, fill: '#374151' }}
                      width={50}
                    />
                    <Tooltip 
                      labelFormatter={(t)=> new Date(t).toLocaleString()} 
                      formatter={(value, name) => {
                        if (name === 'online') return ['Online', 'Status'];
                        if (name === 'offline') return ['Offline', 'Status'];
                        return [value, name];
                      }}
                      contentStyle={{ fontSize: '12px', backgroundColor: '#fff', border: '1px solid #e5e7eb' }}
                      labelStyle={{ color: '#374151', fontWeight: 600 }}
                      itemStyle={{ color: '#374151' }}
                    />
                    <Line 
                      type="stepAfter" 
                      dataKey="online" 
                      stroke="#10b981" 
                      strokeWidth={2.5}
                      dot={false}
                      name="online"
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                    <Line 
                      type="stepAfter" 
                      dataKey="offline" 
                      stroke="transparent" 
                      strokeWidth={0}
                      dot={{ fill: '#ef4444', r: 3 }}
                      name="offline"
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Inspections Section */}
        <div className={`accordion-item ${expandedSection === 'inspections' ? 'expanded' : ''}`}>
          <div 
            className="accordion-header" 
            onClick={() => setExpandedSection(expandedSection === 'inspections' ? null : 'inspections')}
          >
            <span className="accordion-title">Inspections</span>
            <span className="accordion-icon">{expandedSection === 'inspections' ? '▼' : '▶'}</span>
          </div>
          {expandedSection === 'inspections' && (
            <div className="accordion-content">
              <button 
                className="btn btn-sm btn-primary" 
                style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '6px', marginBottom: '12px' }}
                onClick={handleLogInspection}
              >
                ✓ Log Inspection
              </button>
              <div className="inspections-list">
                {inspections.length === 0 ? (
                  <div className="inspections-empty">
                    No inspections logged yet
                  </div>
                ) : (
                  <>
                    {inspections.map((insp, idx) => (
                      <div key={insp.id} className={`inspection-item ${idx === 0 ? 'latest' : ''}`}>
                        <div className="inspection-header">
                          <span className="inspection-date">
                            {new Date(insp.inspected_at).toLocaleDateString()}
                          </span>
                          <span className="inspection-time">
                            {new Date(insp.inspected_at).toLocaleTimeString()}
                          </span>
                        </div>
                        {insp.inspected_by && (
                          <div className="inspection-by">
                            By: {insp.inspected_by}
                          </div>
                        )}
                        {insp.notes && (
                          <div className="inspection-notes">
                            {insp.notes}
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Latest Section */}
        <div className={`accordion-item ${expandedSection === 'latest' ? 'expanded' : ''}`}>
          <div 
            className="accordion-header" 
            onClick={() => setExpandedSection(expandedSection === 'latest' ? null : 'latest')}
          >
            <span className="accordion-title">Latest</span>
            <span className="accordion-icon">{expandedSection === 'latest' ? '▼' : '▶'}</span>
          </div>
          {expandedSection === 'latest' && (
            <div className="accordion-content">
              <div className="kv">
                <div><span>IMEI</span><strong>{router?.imei || latest?.imei || '—'}</strong></div>
                <div><span>MAC Address</span><strong>{router?.mac_address || '—'}</strong></div>
                <div><span>Operator</span><strong>{latest?.operator || '—'}</strong></div>
                <div><span>Network</span><strong>{latest?.network_type || '—'}</strong></div>
                <div><span>Firmware</span><strong>{latest?.firmware_version || router?.firmware_version || '—'}</strong></div>
                <div><span>WAN IP</span><strong>{latest?.wan_ip || '—'}</strong></div>
              </div>
            </div>
          )}
        </div>

        {/* WiFi Users Section */}
        <div className={`accordion-item ${expandedSection === 'wifi-users' ? 'expanded' : ''}`}>
          <div 
            className="accordion-header" 
            onClick={() => setExpandedSection(expandedSection === 'wifi-users' ? null : 'wifi-users')}
          >
            <span className="accordion-title">
              📶 WiFi Users {filteredGuests.length > 0 && <span className="badge">{filteredGuests.length}</span>}
            </span>
            <span className="accordion-icon">{expandedSection === 'wifi-users' ? '▼' : '▶'}</span>
          </div>
          {expandedSection === 'wifi-users' && (
            <div className="accordion-content">
              {filteredGuests.length === 0 ? (
                <div className="wifi-users-empty">
                  <p>No WiFi user logins recorded for this router in the selected time range.</p>
                  <p className="muted" style={{ fontSize: '12px', marginTop: '8px' }}>
                    WiFi guest data comes from the captive portal. Make sure the router MAC address is configured and matching.
                  </p>
                </div>
              ) : (
                <>
                  <div className="wifi-users-summary" style={{ marginBottom: '16px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div className="wifi-stat">
                      <span className="wifi-stat-value">{filteredGuests.length}</span>
                      <span className="wifi-stat-label">Total Logins</span>
                    </div>
                    <div className="wifi-stat">
                      <span className="wifi-stat-value">{[...new Set(filteredGuests.map(g => g.username || g.email))].length}</span>
                      <span className="wifi-stat-label">Unique Users</span>
                    </div>
                    <div className="wifi-stat">
                      <span className="wifi-stat-value">{formatBytes(filteredGuests.reduce((sum, g) => sum + (Number(g.bytes_total) || 0), 0))}</span>
                      <span className="wifi-stat-label">Total Data</span>
                    </div>
                  </div>
                  <div className="table-wrap" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    <table className="wifi-users-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Login Time</th>
                          <th>Duration</th>
                          <th>Data Used</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredGuests.map((guest, idx) => {
                          const userName = guest.username || guest.email || 'Unknown';
                          const userColor = userColors[userName];
                          const isActive = !guest.session_end;
                          const duration = guest.session_duration_seconds 
                            ? `${Math.floor(guest.session_duration_seconds / 60)}m`
                            : isActive ? 'Active' : '—';
                          return (
                            <tr 
                              key={guest.id || idx} 
                              className="wifi-user-row clickable"
                              onClick={() => navigate(`/wifi-guest/${guest.id}`)}
                              style={{ cursor: 'pointer' }}
                            >
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span 
                                    className="user-color-dot" 
                                    style={{ 
                                      width: '10px', 
                                      height: '10px', 
                                      borderRadius: '50%', 
                                      backgroundColor: userColor,
                                      flexShrink: 0
                                    }} 
                                  />
                                  <div>
                                    <div style={{ fontWeight: 500 }}>{userName}</div>
                                    {guest.guest_name && guest.guest_name !== userName && (
                                      <div className="muted" style={{ fontSize: '11px' }}>{guest.guest_name}</div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td>
                                <div>{new Date(guest.session_start || guest.creation_date || guest.auth_date).toLocaleDateString()}</div>
                                <div className="muted" style={{ fontSize: '11px' }}>
                                  {new Date(guest.session_start || guest.creation_date || guest.auth_date).toLocaleTimeString()}
                                </div>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                {duration}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {guest.bytes_total ? formatBytes(guest.bytes_total) : '—'}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span style={{ 
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  borderRadius: '12px',
                                  fontSize: '11px',
                                  fontWeight: 500,
                                  backgroundColor: isActive ? '#dcfce7' : '#f3f4f6',
                                  color: isActive ? '#166534' : '#6b7280'
                                }}>
                                  {isActive ? '● Active' : 'Ended'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

      </div>

      {/* TX/RX Chart - Full Width */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <span>TX/RX ({label})</span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {filteredGuests.length > 0 && (
              <button
                onClick={() => setShowUserLogins(!showUserLogins)}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: '500',
                  background: showUserLogins ? '#f59e0b' : '#6b7280',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                title={showUserLogins ? 'Hiding user login markers' : 'Showing user login markers on chart'}
              >
                {showUserLogins ? `👤 ${filteredGuests.length} Logins` : '👤 Show Logins'}
              </button>
            )}
            <button
              onClick={() => setShowRawData(!showRawData)}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: '500',
                background: showRawData ? '#3b82f6' : '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              title={showRawData ? 'Showing all data (including spikes)' : 'Outliers capped at 5x median for better visibility'}
            >
              {showRawData ? '📊 Raw Data' : '📉 Normalized'}
            </button>
            <button
              onClick={() => setUseRollingAverage(!useRollingAverage)}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: '500',
                background: useRollingAverage ? '#8b5cf6' : '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              title={useRollingAverage ? 'Showing rolling average (smoothed)' : 'Showing raw deltas (spiky)'}
            >
              {useRollingAverage ? '📈 Smoothed' : '⚡ Instant'}
            </button>
          </div>
        </div>
        
        {/* User login legend */}
        {showUserLogins && filteredGuests.length > 0 && (
          <div className="user-login-legend" style={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            gap: '12px', 
            marginBottom: '12px',
            padding: '8px 12px',
            backgroundColor: '#f9fafb',
            borderRadius: '6px',
            fontSize: '12px'
          }}>
            {Object.entries(userColors).slice(0, 10).map(([user, color]) => (
              <div key={user} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ 
                  width: '12px', 
                  height: '12px', 
                  backgroundColor: color, 
                  borderRadius: '2px',
                  flexShrink: 0
                }} />
                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user}
                </span>
              </div>
            ))}
            {Object.keys(userColors).length > 10 && (
              <span className="muted">+{Object.keys(userColors).length - 10} more</span>
            )}
          </div>
        )}
        
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series.txrx} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rdTx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.7}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.1}/>
                </linearGradient>
                <linearGradient id="rdRx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.7}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(t)=> new Date(t).toLocaleDateString()} 
                tick={{ fontSize: 11, fill: '#374151' }} 
              />
              <YAxis 
                scale="linear" 
                domain={[0, 'auto']} 
                tickFormatter={(v)=>formatBytes(v)} 
                tick={{ fontSize: 11, fill: '#374151' }} 
                allowDataOverflow={false} 
              />
              <Tooltip 
                formatter={(v, name) => {
                  if (name === 'TX' || name === 'RX') return formatBytes(v);
                  return v;
                }}
                labelFormatter={(t)=> new Date(t).toLocaleString()}
                contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151' }}
                labelStyle={{ color: '#f3f4f6' }}
                itemStyle={{ color: '#f3f4f6' }}
              />
              <Legend />
              
              {/* User login reference lines */}
              {showUserLogins && filteredGuests.map((guest, idx) => {
                const loginDate = new Date(guest.creation_date || guest.auth_date).toISOString();
                const userName = guest.username || guest.email || 'Unknown';
                const userColor = userColors[userName];
                return (
                  <ReferenceLine 
                    key={`login-${guest.id || idx}`}
                    x={loginDate}
                    stroke={userColor}
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    label={{
                      value: userName.split('@')[0].substring(0, 8),
                      position: 'top',
                      fill: userColor,
                      fontSize: 9,
                      fontWeight: 600
                    }}
                  />
                );
              })}
              
              <Area type="monotone" dataKey="tx_bytes" stroke="#6366f1" fill="url(#rdTx)" name="TX" />
              <Area type="monotone" dataKey="rx_bytes" stroke="#10b981" fill="url(#rdRx)" name="RX" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Recent Logs</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Status</th>
                <th>Operator</th>
                <th>WAN IP</th>
                <th>TX Δ</th>
                <th>RX Δ</th>
                {/* Signal columns removed */}
              </tr>
            </thead>
            <tbody>
              {series.txrx.slice(-50).reverse().map((d, i) => {
                const s = d.status;
                const isOnline = (s==='online'||s===1||s==='1'||s===true);
                return (
                  <tr key={i}>
                    <td>{new Date(d.date).toLocaleString()}</td>
                    <td>{isOnline? 'Online' : 'Offline'}</td>
                    <td>{d.operator || ''}</td>
                    <td>{d.wan_ip || ''}</td>
                    <td>{formatBytes(d.tx_bytes)}</td>
                    <td>{formatBytes(d.rx_bytes)}</td>
                    {/* Signal values removed */}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
