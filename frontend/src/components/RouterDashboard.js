import React, { useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { AreaChart, Area, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { getLogs, getUsageStats, getUptimeData, logInspection, getInspectionHistory } from '../services/api';
import { exportUptimeReportToPDF } from '../utils/exportUtils';
import { toast } from 'react-toastify';
import ClickUpTaskWidget from './ClickUpTaskWidget';
import PropertySearchWidget from './PropertySearchWidget';
import './RouterDashboard.css';

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TB';
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
  const [range, setRange] = useState({ type: 'hours', value: 24 }); // hours|days|custom
  const [customStart, setCustomStart] = useState(null);
  const [customEnd, setCustomEnd] = useState(null);
  const [, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [uptime, setUptime] = useState([]);
  const [inspections, setInspections] = useState([]);
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
        const [logsRes, statsRes, upRes, inspRes] = await Promise.all([
          getLogs({ router_id: routerId, start_date: start, end_date: end, limit: 5000 }),
          getUsageStats({ router_id: routerId, start_date: start, end_date: end }),
          getUptimeData({ router_id: routerId, start_date: start, end_date: end }),
          getInspectionHistory(routerId)
        ]);
        // Ignore if a newer load started or component unmounted
        if (!mounted || seq !== loadSeqRef.current) return;
        setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
        setStats(statsRes.data || null);
        setUptime(Array.isArray(upRes.data) ? upRes.data : []);
        setInspections(Array.isArray(inspRes.data) ? inspRes.data : []);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load router dashboard', e);
        if (!mounted || seq !== loadSeqRef.current) return;
        setLogs([]);
        setStats(null);
        setUptime([]);
        setInspections([]);
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
    const latest = asc[asc.length-1];
    return { txrx, latest };
  }, [logs]);

  const totalBytes = useMemo(() => (series.txrx || []).reduce((s,d)=> s + (Number(d.total_bytes)||0), 0), [series]);
  const onlinePct = useMemo(() => {
    if (!uptime || uptime.length === 0) {
      console.log('RouterDashboard - No uptime data available');
      return null;
    }
    const on = uptime.filter(u => (u.status === 'online' || u.status === 1 || u.status === '1' || u.status === true)).length;
    const pct = Math.round(on / uptime.length * 100);
    console.log('RouterDashboard - Uptime calculation:', { 
      total: uptime.length, 
      online: on, 
      percentage: pct,
      sampleStatuses: uptime.slice(0, 5).map(u => u.status)
    });
    return pct;
  }, [uptime]);

  const yMax = useMemo(() => {
    let m = 1; for (const d of series.txrx||[]) { if (d.tx_bytes>m) m=d.tx_bytes; if (d.rx_bytes>m) m=d.rx_bytes; } return Math.ceil(m*1.1);
  }, [series]);

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
      console.log('RouterDashboard - No inspection date for router:', router?.router_id, 'Router object:', router);
      return null;
    }
    const createdDate = new Date(inspectionDate);
    const inspectionDue = new Date(createdDate);
    inspectionDue.setFullYear(inspectionDue.getFullYear() + 1); // 365 days from inspection date
    const now = new Date();
    const msRemaining = inspectionDue - now;
    const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
    const overdue = daysRemaining < 0;
    console.log('RouterDashboard - Inspection calc for', router.router_id, {
      hasInspections: inspections?.length > 0,
      lastInspection: inspections?.[0]?.inspected_at,
      rms_created_at: router.rms_created_at,
      created_at: router.created_at,
      inspectionDate: inspectionDate,
      createdDate: createdDate.toISOString(),
      inspectionDue: inspectionDue.toISOString(),
      daysRemaining,
      overdue
    });
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
    await exportUptimeReportToPDF(uptime || [], routerId, start, end, { logoDataUrl });
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
            {latest?.timestamp && <span className="muted">Last seen {new Date(latest.timestamp).toLocaleString()}</span>}
            {latest?.wan_ip && <span className="muted">WAN {latest.wan_ip}</span>}
          </div>
        </div>
        <div className="rd-range">
          <div className="seg">
            <button className={range.type==='hours'&&range.value===6?'active':''} onClick={()=>setRange({type:'hours', value:6})}>6h</button>
            <button className={range.type==='hours'&&range.value===24?'active':''} onClick={()=>setRange({type:'hours', value:24})}>24h</button>
            <button className={range.type==='days'&&range.value===7?'active':''} onClick={()=>setRange({type:'days', value:7})}>7d</button>
            <button className={range.type==='days'&&range.value===30?'active':''} onClick={()=>setRange({type:'days', value:30})}>30d</button>
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
              onClick={()=> setRange({ type:'custom' })}
              disabled={!(customStart && customEnd) || (customStart && customEnd && (new Date(customEnd) <= new Date(customStart)))}
            >Apply</button>
          </div>
        </div>
      )}

      <div className="rd-grid">
        <div className="col">
          <div className="card">
            <div className="card-title latest-title">Latest</div>
            <div className="kv">
              <div><span>IMEI</span><strong>{router?.imei || latest?.imei || '—'}</strong></div>
              <div><span>Operator</span><strong>{latest?.operator || '—'}</strong></div>
              <div><span>Network</span><strong>{latest?.network_type || '—'}</strong></div>
              <div><span>Firmware</span><strong>{latest?.firmware_version || router?.firmware_version || '—'}</strong></div>
              <div><span>WAN IP</span><strong>{latest?.wan_ip || '—'}</strong></div>
            </div>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-title uptime-title">Uptime samples</div>
            <div style={{ height: 140 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(uptime||[]).slice(-120)} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(t)=> { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); }}
                    tick={{ fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={12}
                  />
                  <YAxis domain={[0,1]} hide />
                  <Tooltip 
                    labelFormatter={(t)=> new Date(t).toLocaleString()} 
                    formatter={(_, __, p)=> {
                      const s = p?.payload?.status; 
                      const on = (s==='online'||s===1||s==='1'||s===true);
                      return on ? ['online','Status'] : ['offline','Status'];
                    }} 
                  />
                  <Bar dataKey={() => 1} name="Status">
                    {(uptime||[]).slice(-120).map((d, i) => {
                      const s = d?.status; const on = (s==='online'||s===1||s==='1'||s===true);
                      return <Cell key={`cell-${i}`} fill={on ? '#10b981' : '#ef4444'} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Inspections</span>
              <button 
                className="btn btn-sm btn-primary" 
                style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '6px' }}
                onClick={handleLogInspection}
              >
                ✓ Log Inspection
              </button>
            </div>
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
        </div>
      </div>

      {/* TX/RX Chart - Full Width */}
      <div className="card">
        <div className="card-title">TX/RX ({label})</div>
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
              <XAxis dataKey="date" tickFormatter={(t)=> new Date(t).toLocaleDateString()} tick={{ fontSize: 11 }} />
              <YAxis domain={[0, yMax]} tickFormatter={(v)=>formatBytes(v)} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v)=>formatBytes(v)} labelFormatter={(t)=> new Date(t).toLocaleString()} />
              <Legend />
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
