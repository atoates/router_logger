import React, { useEffect, useMemo, useState } from 'react';
import { getRouters, getNetworkUsageRolling, getNetworkUsage, getTopRoutersRolling, getTopRouters, getOperators, getStorageStats } from '../services/api';
import api from '../services/api';
import { AreaChart, Area, BarChart, Bar, CartesianGrid, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import '../DashboardV3.css';

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TB';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
  return n + ' B';
}

function fmtNum(n) { return new Intl.NumberFormat().format(n || 0); }

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f97316', '#06b6d4', '#8b5cf6', '#ef4444', '#22c55e'];

function TimeControls({ mode, value, onChange }) {
  return (
    <div className="v3-time-controls">
      <div className="seg">
        <button className={mode==='rolling'?'active':''} onClick={()=>onChange('rolling', value)}>Rolling</button>
        <button className={mode==='days'?'active':''} onClick={()=>onChange('days', 7)}>By Day</button>
      </div>
      {mode==='rolling' ? (
        <div className="seg">
          {[6,12,24,48,72,168].map(h => (
            <button key={h} className={value===h?'active':''} onClick={()=>onChange('rolling', h)}>{h}h</button>
          ))}
        </div>
      ) : (
        <div className="seg">
          {[7,30,90].map(d => (
            <button key={d} className={value===d?'active':''} onClick={()=>onChange('days', d)}>{d}d</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, color }) {
  return (
    <div className="v3-metric" style={{ borderLeftColor: color || '#6366f1' }}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Heatmap({ data, mode }) {
  // Build 7x24 matrix from rolling buckets if available; else build day buckets
  // data: [{date, tx_bytes, rx_bytes, total_bytes}] ascending by time
  const grid = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return { cells: [], max: 0 };
    if (mode !== 'rolling') {
      // Collapse to a simple bar heat strip by day
      const cells = data.map(d => ({ key: d.date, label: (d.date||'').slice(5,10), v: Number(d.total_bytes) || 0 }));
      const max = cells.reduce((m,c)=>Math.max(m,c.v),0);
      return { cells, max, days: true };
    }
    const cells = [];
    let max = 0;
    for (const d of data) {
      const ts = new Date(d.date);
      const dow = ts.getDay(); // 0-6
      const hour = ts.getHours();
      const v = Number(d.total_bytes) || 0;
      max = Math.max(max, v);
      cells.push({ dow, hour, v });
    }
    return { cells, max, days: false };
  }, [data, mode]);

  if (!grid || grid.cells.length === 0) return <div className="v3-card"><div className="empty">No data</div></div>;

  if (grid.days) {
    return (
      <div className="v3-card">
        <div className="v3-card-title">Usage Heatstrip (by Day)</div>
        <div className="heatstrip">
          {grid.cells.map((c,i)=>{
            const intensity = grid.max ? Math.sqrt(c.v/grid.max) : 0;
            return <div key={i} title={`${c.label}: ${formatBytes(c.v)}`} style={{ background:`rgba(99,102,241,${0.15+0.85*intensity})` }} />;
          })}
        </div>
      </div>
    );
  }

  // 7x24 grid
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const dows = [ 'Sun','Mon','Tue','Wed','Thu','Fri','Sat' ];
  // Aggregate by dow-hour (latest period may not have all buckets)
  const map = new Map();
  for (const c of grid.cells) {
    const k = `${c.dow}-${c.hour}`;
    map.set(k, (map.get(k)||0) + c.v);
  }
  return (
    <div className="v3-card">
      <div className="v3-card-title">Usage Heatmap (7×24)</div>
      <div className="heatmap">
        <div className="heatmap-header">
          <div />
          {hours.map(h=> <div key={h} className="hcol">{h}</div>)}
        </div>
        {dows.map((d,di)=>(
          <div key={d} className="heatmap-row">
            <div className="dlabel">{d}</div>
            {hours.map(h=>{
              const v = map.get(`${di}-${h}`) || 0;
              const intensity = grid.max ? Math.sqrt(v / grid.max) : 0;
              return <div key={h} className="cell" title={`${d} ${h}:00 — ${formatBytes(v)}`} style={{ background:`rgba(16,185,129,${0.1+0.9*intensity})` }} />
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function DeltaBadge({ current, previous }) {
  const c = Number(current)||0, p = Number(previous)||0;
  if (p===0 && c===0) return <span className="delta neutral">0%</span>;
  const change = p===0 ? 100 : ((c-p)/p)*100;
  const rounded = Math.round(change);
  const cls = change>0 ? 'up' : change<0 ? 'down' : 'neutral';
  const sym = change>0 ? '▲' : change<0 ? '▼' : '■';
  return <span className={`delta ${cls}`}>{sym} {Math.abs(rounded)}%</span>;
}

export default function DashboardV3() {
  const [mode, setMode] = useState('rolling');
  const [value, setValue] = useState(24);
  const [dark, setDark] = useState(false);
  const [routers, setRouters] = useState([]);
  const [usage, setUsage] = useState([]);
  const [usagePrev, setUsagePrev] = useState([]);
  const [top, setTop] = useState([]);
  const [operators, setOperators] = useState([]);
  const [storage, setStorage] = useState(null);
  const [dbSize, setDbSize] = useState(null);
  const [, setLoading] = useState(true);

  const updateTime = (m, v) => { setMode(m); setValue(v); };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const hrs = mode==='rolling' ? value : null;
        const days = mode==='days' ? value : null;
        const effectiveDaysForOps = mode==='rolling' ? Math.max(1, Math.ceil((value||24)/24)) : value;

        const promises = [
          getRouters(),
          getStorageStats({ sample_size: 800 }),
          mode==='rolling' ? getNetworkUsageRolling({ hours: hrs, bucket: 'hour' }) : getNetworkUsage({ days }),
          mode==='rolling' ? getTopRoutersRolling({ hours: hrs, limit: 5 }) : getTopRouters({ days, limit: 5 }),
          getOperators({ days: effectiveDaysForOps })
        ];
        // Also fetch DB size (non-blocking for critical metrics)
        const dbSizePromise = api.get('/stats/db-size').catch(()=>({ data: null }));
        const [rRes, sRes, uRes, tRes, oRes] = await Promise.all(promises);
        const dbRes = await dbSizePromise;
        setRouters(rRes.data || []);
        setStorage(sRes.data || null);
        setUsage(uRes.data || []);
        setTop((tRes.data || []).map(r=>({ name: r.name || r.router_id, tx_bytes: Number(r.tx_bytes)||0, rx_bytes: Number(r.rx_bytes)||0, total_bytes: Number(r.total_bytes)||0 })));
        setOperators((oRes.data || []).map((x,i)=>({ name: x.operator || 'Unknown', value: Number(x.total_bytes)||0, fill: COLORS[i%COLORS.length] })));
  setDbSize(dbRes?.data || null);

        // Previous period for network-level delta
        if (mode==='rolling') {
          const prevRes = await getNetworkUsageRolling({ hours: (hrs||24)*2, bucket: 'hour' });
          const arr = prevRes.data || [];
          // split into previous H and current H
          const tail = arr.slice(-hrs);
          const head = arr.slice(-2*hrs, -hrs);
          setUsagePrev(head);
          setUsage(tail);
        } else {
          const prevRes = await getNetworkUsage({ days: (days||7)*2 });
          // last D are current; previous D before that
          const arr = prevRes.data || [];
          const tail = arr.slice(-days);
          const head = arr.slice(-2*days, -days);
          setUsagePrev(head);
          setUsage(tail);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load V3', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [mode, value]);

  const online = routers.filter(r => r.current_status === 'online' || r.current_status === 1 || r.current_status === '1').length;
  const total = routers.length;

  const sumBytes = (arr) => arr.reduce((s,d)=> s + (Number(d.total_bytes)||0), 0);
  const totalNow = sumBytes(usage);
  const totalPrev = sumBytes(usagePrev);
  const latestTs = usage.length ? usage[usage.length-1].date : null;
  const yMax = useMemo(() => {
    if (!usage || usage.length === 0) return 1;
    let m = 1;
    for (const d of usage) {
      const tx = Number(d.tx_bytes) || 0;
      const rx = Number(d.rx_bytes) || 0;
      if (tx > m) m = tx;
      if (rx > m) m = rx;
    }
    return m;
  }, [usage]);

  const className = `dashboard-v3${dark ? ' dark' : ''}`;

  return (
    <div className={className}>
      <div className="v3-header">
        <div>
          <h1>🚀 Dashboard V3</h1>
          <p>Analytical, blazing-fast, and dark-mode ready</p>
        </div>
        <div className="v3-controls">
          <TimeControls mode={mode} value={value} onChange={updateTime} />
          <div className="toggle" onClick={()=>setDark(!dark)} title="Toggle dark mode">{dark ? '🌙' : '🌞'}</div>
        </div>
      </div>

      {/* Metrics */}
      <div className="v3-metrics">
        <Metric label="Network Health" value={`${total ? Math.round(online/total*100) : 0}%`} sub={`${online}/${total} online`} color="#10b981" />
        <Metric label={`${mode==='rolling'?value+'h':'Last '+value+'d'} Data`} value={formatBytes(totalNow)} sub={<DeltaBadge current={totalNow} previous={totalPrev} />} color="#6366f1" />
        <Metric label="Storage (est.)" value={storage ? formatBytes(storage.estimatedCurrentJsonBytes) : '—'} sub={storage ? `${fmtNum(storage.totalLogs)} records` : ''} color="#8b5cf6" />
        <Metric label="Top Router Share" value={`${top.length? Math.round((top[0].total_bytes||0)/Math.max(totalNow,1)*100):0}%`} sub={top.length? top[0].name: ''} color="#f59e0b" />
      </div>

      <div className="v3-grid">
        <div className="col">
          <div className="v3-card">
            <div className="v3-card-title">Network Usage ({mode==='rolling'? value+'h' : 'Last '+value+'d'})</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={usage} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gTx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.7}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.1}/>
                    </linearGradient>
                    <linearGradient id="gRx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.7}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={dark?'#334155':'#e5e7eb'} />
                  <XAxis dataKey="date" tickFormatter={(t)=>{ const d=new Date(t); return mode==='rolling'? d.getHours()+':00' : (t||'').slice(5,10); }} tick={{ fontSize: 11, fill: dark?'#cbd5e1':'#475569' }} />
                  <YAxis domain={[0, Math.ceil(yMax * 1.1)]} tickFormatter={(v)=> formatBytes(v)} tick={{ fontSize: 11, fill: dark?'#cbd5e1':'#475569' }} />
                  <Tooltip formatter={(v)=>formatBytes(v)} labelFormatter={(t)=> new Date(t).toLocaleString()} />
                  <Legend />
                  <Area type="monotone" dataKey="tx_bytes" stroke="#6366f1" fill="url(#gTx)" name="TX" />
                  <Area type="monotone" dataKey="rx_bytes" stroke="#10b981" fill="url(#gRx)" name="RX" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="v3-delta" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>Period change: <DeltaBadge current={totalNow} previous={totalPrev} /></span>
              {latestTs && (<span className="v3-ts" style={{ color: '#64748b' }}>Data through {new Date(latestTs).toLocaleString()}</span>)}
            </div>
          </div>

          <Heatmap data={usagePrev.concat(usage)} mode={mode} />
        </div>

        <div className="col">
          {/* Storage Card */}
          <div className="v3-card">
            <div className="v3-card-title">Storage</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span>Total DB</span>
                <strong>{dbSize ? formatBytes(dbSize.db_bytes) : '—'}</strong>
              </div>
              {dbSize && dbSize.tables && dbSize.tables.map(t => (
                <div key={t.name} style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                    <span style={{ fontWeight:600 }}>{t.name}</span>
                    <span style={{ color:'#64748b', fontSize:12 }}>{t.row_count?.toLocaleString()} rows</span>
                  </div>
                  {/* simple stacked bar: table/index/toast */}
                  {(() => {
                    const total = (t.total_bytes||1);
                    const tb = (t.table_bytes||0)/total*100;
                    const ib = (t.index_bytes||0)/total*100;
                    const ob = (t.toast_bytes||0)/total*100;
                    return (
                      <div style={{ height:10, width:'100%', background:'#e5e7eb', borderRadius:6, overflow:'hidden' }}>
                        <div style={{ width:`${tb}%`, height:'100%', background:'#6366f1' }} title={`Table: ${formatBytes(t.table_bytes)}`} />
                        <div style={{ width:`${ib}%`, height:'100%', background:'#10b981' }} title={`Indexes: ${formatBytes(t.index_bytes)}`} />
                        <div style={{ width:`${ob}%`, height:'100%', background:'#f59e0b' }} title={`TOAST: ${formatBytes(t.toast_bytes)}`} />
                      </div>
                    );
                  })()}
                  <div style={{ display:'flex', justifyContent:'space-between', color:'#64748b', fontSize:12 }}>
                    <span>Total</span>
                    <span>{formatBytes(t.total_bytes)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="v3-card">
            <div className="v3-card-title">Top 5 Routers</div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={dark?'#334155':'#e5e7eb'} />
                  <XAxis type="number" tickFormatter={(v)=>formatBytes(v).split(' ')[0]} tick={{ fontSize: 11, fill: dark?'#cbd5e1':'#475569' }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12, fill: dark?'#cbd5e1':'#475569' }} />
                  <Tooltip formatter={(v)=>formatBytes(v)} />
                  <Legend />
                  <Bar dataKey="tx_bytes" stackId="a" fill="#6366f1" name="TX" />
                  <Bar dataKey="rx_bytes" stackId="a" fill="#10b981" name="RX" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {operators.length>0 && (
            <div className="v3-card">
              <div className="v3-card-title">Operator Share</div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={operators} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                      {operators.map((o,i)=>(<Cell key={i} fill={o.fill} />))}
                    </Pie>
                    <Tooltip formatter={(v)=>formatBytes(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="v3-footer-note">Auto-refreshes when you change time range. Dark mode is local to V3.</div>
    </div>
  );
}
