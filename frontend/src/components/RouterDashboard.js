import React, { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { getLogs, getUsageStats, getUptimeData } from '../services/api';
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
  const [range, setRange] = useState({ type: 'hours', value: 24 }); // hours|days
  const [, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [uptime, setUptime] = useState([]);

  const routerId = router?.router_id;

  const { start, end, label } = useMemo(() => {
    const end = new Date().toISOString();
    if (range.type === 'hours') {
      const start = isoMinus({ hours: range.value || 24 });
      return { start, end, label: `Last ${range.value}h` };
    }
    const start = isoMinus({ days: range.value || 7 });
    return { start, end, label: `Last ${range.value}d` };
  }, [range]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!routerId) return;
      setLoading(true);
      try {
        const [logsRes, statsRes, upRes] = await Promise.all([
          getLogs({ router_id: routerId, start_date: start, end_date: end, limit: 5000 }),
          getUsageStats({ router_id: routerId, start_date: start, end_date: end }),
          getUptimeData({ router_id: routerId, start_date: start, end_date: end })
        ]);
        if (!mounted) return;
        setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
        setStats(statsRes.data || null);
        setUptime(Array.isArray(upRes.data) ? upRes.data : []);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load router dashboard', e);
        if (!mounted) return;
        setLogs([]);
        setStats(null);
        setUptime([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
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
    if (!uptime || uptime.length === 0) return null;
    const on = uptime.filter(u => (u.status === 'online' || u.status === 1 || u.status === '1' || u.status === true)).length;
    return Math.round(on / uptime.length * 100);
  }, [uptime]);

  const yMax = useMemo(() => {
    let m = 1; for (const d of series.txrx||[]) { if (d.tx_bytes>m) m=d.tx_bytes; if (d.rx_bytes>m) m=d.rx_bytes; } return Math.ceil(m*1.1);
  }, [series]);

  const latest = series.latest;

  return (
    <div className="router-dash">
      <div className="rd-header">
        <div>
          <h2>{router?.name || routerId}</h2>
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
          </div>
          <span className="muted">{label}</span>
        </div>
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
      </div>

      <div className="rd-grid">
        <div className="col">
          <div className="card">
            <div className="card-title">TX/RX ({label})</div>
            <div style={{ height: 220 }}>
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
                  <XAxis dataKey="date" tickFormatter={(t)=> new Date(t).toLocaleTimeString()} tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, yMax]} tickFormatter={(v)=>formatBytes(v)} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v)=>formatBytes(v)} labelFormatter={(t)=> new Date(t).toLocaleString()} />
                  <Legend />
                  <Area type="monotone" dataKey="tx_bytes" stroke="#6366f1" fill="url(#rdTx)" name="TX" />
                  <Area type="monotone" dataKey="rx_bytes" stroke="#10b981" fill="url(#rdRx)" name="RX" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Signal chart removed per request */}
        </div>

        <div className="col">
          <div className="card">
            <div className="card-title">Latest</div>
            <div className="kv">
              <div><span>Operator</span><strong>{latest?.operator || '—'}</strong></div>
              <div><span>Network</span><strong>{latest?.network_type || '—'}</strong></div>
              <div><span>Firmware</span><strong>{latest?.firmware_version || router?.firmware_version || '—'}</strong></div>
              <div><span>Cell</span><strong>{latest?.cell_id || '—'}</strong></div>
              <div><span>Location</span><strong>{router?.location || '—'}</strong></div>
              <div><span>WAN IP</span><strong>{latest?.wan_ip || '—'}</strong></div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Uptime samples</div>
            <div style={{ height: 120 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(uptime||[]).slice(-120)} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(t)=> { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }}
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
