import React, { useEffect, useState } from 'react';
import { getTopRouters, getTopRoutersRolling } from '../services/api';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TB';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
  return n + ' B';
}

export default function TopRouters({ days = 7, hours = null, rolling = false, limit = 5 }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchTop = async () => {
      setLoading(true);
      try {
        const res = rolling
          ? await getTopRoutersRolling({ hours: hours || 24, limit })
          : await getTopRouters({ days, limit });
        const rows = (res.data || []).map(r => ({
          name: r.name || r.router_id,
          total_bytes: Number(r.total_bytes) || 0,
          tx_bytes: Number(r.tx_bytes) || 0,
          rx_bytes: Number(r.rx_bytes) || 0
        }));
        setData(rows);
      } catch (e) {
        console.error('Failed to fetch top routers', e);
      } finally {
        setLoading(false);
      }
    };
    fetchTop();
  }, [days, hours, rolling, limit]);

  return (
    <div className="card">
  <h3>Top {limit} Routers by Data ({rolling ? `Last ${hours || 24}h` : `Last ${days} days`})</h3>
      {loading && <div className="loading">Loading…</div>}
      {!loading && data.length === 0 && <p>No data.</p>}
      {!loading && data.length > 0 && (
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={formatBytes} />
              <YAxis type="category" dataKey="name" width={160} />
              <Tooltip formatter={(v) => formatBytes(v)} />
              <Legend />
              <Bar dataKey="tx_bytes" stackId="a" fill="#8884d8" name="TX" />
              <Bar dataKey="rx_bytes" stackId="a" fill="#82ca9d" name="RX" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
