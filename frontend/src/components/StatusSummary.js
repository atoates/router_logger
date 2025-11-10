import React, { useEffect, useState } from 'react';
import { getRouters } from '../services/api';

function StatusSummary({ onRoutersLoaded }) {
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(0);
  const [offline, setOffline] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await getRouters();
  const routers = res.data || [];
  const isOnline = (s) => (s === 'online' || s === 1 || s === '1' || s === true);
  const on = routers.filter(r => isOnline(r.current_status)).length;
  const off = routers.length - on;
        if (!mounted) return;
        setOnline(on);
        setOffline(off);
        setLoading(false);
        onRoutersLoaded && onRoutersLoaded(routers);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load routers for summary', e);
        if (!mounted) return;
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30000); // refresh every 30 seconds (was 5 minutes)
    return () => { mounted = false; clearInterval(interval); };
  }, [onRoutersLoaded]);

  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <h3>Network Status</h3>
      {loading ? (
        <div className="loading">Loading status...</div>
      ) : (
        <div style={{ display: 'flex', gap: '16px' }}>
          <div className="stat-card" style={{ minWidth: 160 }}>
            <div className="stat-label">Online Routers</div>
            <div className="stat-value" style={{ color: '#16a34a' }}>{online}</div>
          </div>
          <div className="stat-card" style={{ minWidth: 160 }}>
            <div className="stat-label">Offline Routers</div>
            <div className="stat-value" style={{ color: '#dc2626' }}>{offline}</div>
          </div>
          <div className="stat-card" style={{ minWidth: 160 }}>
            <div className="stat-label">Total</div>
            <div className="stat-value">{online + offline}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StatusSummary;
