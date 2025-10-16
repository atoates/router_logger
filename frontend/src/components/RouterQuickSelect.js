import React, { useEffect, useMemo, useState } from 'react';
import { getRouters } from '../services/api';

function RouterQuickSelect({ onSelectRouter }) {
  const [routers, setRouters] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await getRouters();
        if (!mounted) return;
        setRouters(res.data || []);
        setLoading(false);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load routers', e);
        if (!mounted) return;
        setError('Failed to load routers');
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const matched = useMemo(() => {
    const id = input.trim();
    if (!id) return null;
    return routers.find(r => String(r.router_id) === id) || null;
  }, [input, routers]);

  const handleSelect = () => {
    if (matched) {
      onSelectRouter(matched);
      setError('');
    } else {
      setError('Router ID not found');
    }
  };

  return (
    <div className="card">
      <h3>🔎 Select Router by ID</h3>
      <div className="filter-bar">
        <div className="form-group" style={{ minWidth: 260 }}>
          <label>Router ID</label>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Enter router ID (numbers only)"
          />
        </div>
        <div className="form-group">
          <label>&nbsp;</label>
          <button className="btn btn-primary" onClick={handleSelect} disabled={loading}>
            {loading ? 'Loading…' : 'Load Router'}
          </button>
        </div>
      </div>
      {error && <div style={{ color: '#dc2626', marginTop: '8px' }}>{error}</div>}
      {matched && (
        <div style={{ marginTop: '8px', color: '#64748b' }}>
          Found: <strong>{matched.name || matched.router_id}</strong> ({matched.current_status || 'unknown'})
        </div>
      )}
    </div>
  );
}

export default RouterQuickSelect;
