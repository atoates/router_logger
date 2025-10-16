import React, { useEffect, useState } from 'react';
import { getNetworkUsage, getOperators } from '../services/api';
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

export default function NetworkOverview({ days = 7 }) {
  const [usage, setUsage] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [u, o] = await Promise.all([
          getNetworkUsage({ days }),
          getOperators({ days })
        ]);
        const udata = (u.data || []).map(d => ({
          date: d.date?.slice(0,10),
          tx_mb: (Number(d.tx_bytes) || 0) / 1_000_000,
          rx_mb: (Number(d.rx_bytes) || 0) / 1_000_000,
          total_mb: (Number(d.total_bytes) || 0) / 1_000_000
        }));
        const odata = (o.data || []).map((r, i) => ({
          operator: r.operator || 'Unknown',
          value: Number(r.total_bytes) || 0,
          router_count: Number(r.router_count) || 0,
          fill: COLORS[i % COLORS.length]
        }));
        setUsage(udata);
        setOperators(odata);
      } catch (e) {
        console.error('Failed to load network overview', e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [days]);

  return (
    <div className="card">
      <h3>Network Overview (Last {days} days)</h3>
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
            <div className="chart-container" style={{ height: 260, marginTop: 16 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={operators} dataKey="value" nameKey="operator" label={(e)=>`${e.operator}`}> 
                    {operators.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v)=>formatBytes(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
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
