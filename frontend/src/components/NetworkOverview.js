import React, { useEffect, useState } from 'react';
import { getNetworkUsage, getOperators, getNetworkUsageRolling } from '../services/api';
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TB';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
  return n + ' B';
}

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7f50', '#a4de6c', '#d0ed57'];

export default function NetworkOverview({ days = 7, hours = null, mode = 'calendar' }) {
  const [usage, setUsage] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(false);
  // Separate time controls for operator pie
  const [opMode, setOpMode] = useState('calendar'); // 'calendar' | 'rolling'
  const [opDays, setOpDays] = useState(7);
  const [opHours, setOpHours] = useState(24);
  const [opLoading, setOpLoading] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const usageReq = mode==='rolling'
          ? getNetworkUsageRolling({ hours: hours || 24, bucket: 'hour' })
          : getNetworkUsage({ days });
        const [u] = await Promise.all([ usageReq ]);
        const udata = (u.data || []).map(d => ({
          date: mode==='rolling' ? d.date : d.date?.slice(0,10),
          tx_mb: (Number(d.tx_bytes) || 0) / 1_000_000,
          rx_mb: (Number(d.rx_bytes) || 0) / 1_000_000,
          total_mb: (Number(d.total_bytes) || 0) / 1_000_000
        }));
        setUsage(udata);
      } catch (e) {
        console.error('Failed to load network overview', e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [days, hours, mode]);

  // Fetch operator distribution separately with its own time range
  useEffect(() => {
    const loadOperators = async () => {
      try {
        setOpLoading(true);
        // Backend supports only day granularity. Map rolling 24h -> last 1 day.
        const effectiveDays = opMode === 'rolling' ? Math.max(1, Math.ceil((opHours || 24) / 24)) : opDays;
        const o = await getOperators({ days: effectiveDays });
        const raw = (o.data || []).map((r) => ({
          operator: r.operator || 'Unknown',
          value: Number(r.total_bytes) || 0,
          router_count: Number(r.router_count) || 0,
        }));
        // Sort by value desc, then assign colors to keep largest slices first
        const sorted = raw.sort((a, b) => (b.value || 0) - (a.value || 0));
        const odata = sorted.map((r, i) => ({
          ...r,
          fill: COLORS[i % COLORS.length]
        }));
        setOperators(odata);
      } catch (e) {
        console.error('Failed to load operator distribution', e);
      } finally {
        setOpLoading(false);
      }
    };
    loadOperators();
  }, [opMode, opDays, opHours]);

  return (
    <div className="card">
  <h3>Network Overview ({mode==='rolling' ? `Last ${hours || 24}h` : `Last ${days} days`})</h3>
      {loading && <div className="loading">Loading…</div>}
      {!loading && (
        <>
          {usage.length > 0 && (
            <div className="chart-container" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={usage}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis tickFormatter={(v)=>`${v.toFixed(0)} MB`} />
                  <Tooltip formatter={(v)=>`${formatBytes((v||0)*1_000_000)}`} />
                  <Legend />
                  <Area type="monotone" dataKey="tx_mb" stackId="1" stroke="#8884d8" fill="#8884d8" name="TX (MB)" />
                  <Area type="monotone" dataKey="rx_mb" stackId="1" stroke="#82ca9d" fill="#82ca9d" name="RX (MB)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {operators.length > 0 && (
            <div className="chart-container" style={{ height: 'auto', marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>Operator Distribution ({opMode==='rolling' ? `Last ${opHours}h` : `Last ${opDays}d`})</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={`btn ${opMode==='rolling'&&opHours===24?'btn-primary':'btn-secondary'}`} onClick={()=>{setOpMode('rolling'); setOpHours(24);}}>24h</button>
                  <button className={`btn ${opMode==='calendar'&&opDays===7?'btn-primary':'btn-secondary'}`} onClick={()=>{setOpMode('calendar'); setOpDays(7);}}>7d</button>
                  <button className={`btn ${opMode==='calendar'&&opDays===30?'btn-primary':'btn-secondary'}`} onClick={()=>{setOpMode('calendar'); setOpDays(30);}}>30d</button>
                  <button className={`btn ${opMode==='calendar'&&opDays===90?'btn-primary':'btn-secondary'}`} onClick={()=>{setOpMode('calendar'); setOpDays(90);}}>90d</button>
                </div>
              </div>
              {opLoading ? (
                <div className="loading">Loading…</div>
              ) : (
                <div style={{ width: '100%', height: 230 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 0, right: 40, bottom: 0, left: 40 }}>
                      <Pie
                        data={operators}
                        dataKey="value"
                        nameKey="operator"
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={1}
                        label={false}
                        labelLine={false}
                      >
                        {operators.map((entry, index) => (
                          <Cell key={index} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v)=>formatBytes(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              {/* Ensure all operators are visible even if a slice label is too small */}
              <div style={{ marginTop: 12, marginBottom: 4, maxWidth: 640, padding: '0 8px', marginLeft: 'auto', marginRight: 'auto' }}>
                {(() => {
                  const total = operators.reduce((sum, o) => sum + (o.value || 0), 0) || 0;
                  return operators.map((op, idx) => {
                    const pct = total > 0 ? ((op.value / total) * 100).toFixed(1) + '%' : '-';
                    return (
                      <div key={idx} style={{ display: 'flex', justifyContent:'space-between', color:'#475569', alignItems: 'center', minWidth: 0, padding: '6px 0', borderBottom: '1px dashed #e5e7eb' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ display:'inline-block', width:10, height:10, background: op.fill, marginRight:6, borderRadius:2 }} />
                          {op.operator}
                        </span>
                        <span style={{ display:'flex', gap: 8, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
                          <span style={{ color: '#111827', fontWeight: 600 }}>{formatBytes(op.value)}</span>
                          <span style={{ color: '#64748b', fontSize: 12 }}>{pct}</span>
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}
          {usage.length === 0 && operators.length === 0 && (
            <p>No network-level stats available yet.</p>
          )}
        </>
      )}
    </div>
  );
}
