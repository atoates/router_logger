import React, { useEffect, useMemo, useState } from 'react';
import { getRouters } from '../services/api';

function RouterQuickSelect({ onSelectRouter, onClear }) {
  const [routers, setRouters] = useState([]);
  const [input, setInput] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

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

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    const withName = routers.filter(r => (r.name || '').toLowerCase().includes(q));

    // Sort: startsWith > log_count desc > last_seen desc
    const sorted = [...withName].sort((a, b) => {
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      const aStarts = an.startsWith(q) ? 1 : 0;
      const bStarts = bn.startsWith(q) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      const aLogs = Number(a.log_count || 0);
      const bLogs = Number(b.log_count || 0);
      if (aLogs !== bLogs) return bLogs - aLogs;
      const aSeen = a.last_seen ? new Date(a.last_seen).getTime() : 0;
      const bSeen = b.last_seen ? new Date(b.last_seen).getTime() : 0;
      return bSeen - aSeen;
    });

    // Deduplicate by name (keep best entry per name) with stronger preference for serial ID
    const bestByName = new Map();
    for (const r of sorted) {
      const key = (r.name || '').toLowerCase();
      const cur = bestByName.get(key);
      if (!cur) {
        bestByName.set(key, r);
        continue;
      }
      const curLogs = Number(cur.log_count || 0);
      const newLogs = Number(r.log_count || 0);
      if (newLogs !== curLogs) {
        if (newLogs > curLogs) bestByName.set(key, r);
        continue;
      }
  const isSerialLike = (id) => /^(\d){9,}$/.test(String(id || ''));
  const curIsSerial = isSerialLike(cur.router_id);
  const newIsSerial = isSerialLike(r.router_id);
      if (newIsSerial !== curIsSerial) {
        if (newIsSerial) bestByName.set(key, r);
        continue;
      }
      const curSeen = cur.last_seen ? new Date(cur.last_seen).getTime() : 0;
      const newSeen = r.last_seen ? new Date(r.last_seen).getTime() : 0;
      if (newSeen > curSeen) bestByName.set(key, r);
    }
    return Array.from(bestByName.values()).slice(0, 8);
  }, [input, routers]);

  const exactMatch = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return null;
    return routers.find(r => (r.name || '').toLowerCase() === q) || null;
  }, [input, routers]);

  const handleSelect = () => {
    const chosen = exactMatch || suggestions[highlightIndex] || suggestions[0] || null;
    if (chosen) {
      onSelectRouter(chosen);
      setError('');
      // Close dropdown and clear input so suggestions disappear
      setInput('');
      setOpen(false);
    } else {
      setError('Router name not found');
    }
  };

  return (
    <div className="card">
      <h3>🔎 Select Router by Name</h3>
      <div className="filter-bar">
        <div className="form-group" style={{ minWidth: 260 }}>
          <label>Router Name</label>
          <input
            type="text"
            value={input}
            onChange={e => { setInput(e.target.value); setError(''); setHighlightIndex(0); setOpen(true); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIndex(i => Math.min(i + 1, Math.max(suggestions.length - 1, 0)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIndex(i => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                handleSelect();
              } else if (e.key === 'Escape') {
                setInput(''); setOpen(false);
              }
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 100)}
            placeholder="Start typing a router name"
          />
          {open && suggestions.length > 0 && (
            <div style={{ position: 'relative' }}>
              <ul style={{
                position: 'absolute',
                zIndex: 10,
                listStyle: 'none',
                margin: 0,
                padding: 0,
                width: '100%',
                maxHeight: 200,
                overflowY: 'auto',
                border: '1px solid #e2e8f0',
                borderTop: 'none',
                background: 'white',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
              }}>
                {suggestions.map((r, idx) => (
                  <li
                    key={r.router_id}
                    onMouseDown={() => { onSelectRouter(r); setError(''); setInput(''); setOpen(false); }}
                    onMouseEnter={() => setHighlightIndex(idx)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      background: idx === highlightIndex ? '#f1f5f9' : 'white',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <span>{r.name || '(unnamed)'}</span>
                    <span style={{ color: '#64748b', fontSize: 12 }}>ID: {r.router_id} · logs: {r.log_count ?? 0}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="form-group">
          <label>&nbsp;</label>
          <button className="btn btn-primary" onClick={handleSelect} disabled={loading}>
            {loading ? 'Loading…' : 'Load Router'}
          </button>
          <button
            className="btn btn-secondary"
            style={{ marginLeft: 8 }}
            onClick={() => { setInput(''); setHighlightIndex(0); setError(''); if (onClear) onClear(); }}
          >
            Clear
          </button>
        </div>
      </div>
      {error && <div style={{ color: '#dc2626', marginTop: '8px' }}>{error}</div>}
      {exactMatch && (
        <div style={{ marginTop: '8px', color: '#64748b' }}>
          Found: <strong>{exactMatch.name || exactMatch.router_id}</strong> ({exactMatch.current_status || 'unknown'})
        </div>
      )}
    </div>
  );
}

export default RouterQuickSelect;
