import React, { useEffect, useMemo, useState } from 'react';
import { getRouters } from '../services/api';

export default function HeaderRouterSelect({ onSelect }) {
  const [routers, setRouters] = useState([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await getRouters();
        if (!mounted) return;
        setRouters(res.data || []);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('header select: failed to load routers', e);
      }
    };
    load();
    const id = setInterval(load, 300000); // 5 minutes
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const suggestions = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const arr = routers.filter(r => (r.name || '').toLowerCase().includes(s));
    return arr.slice(0, 8);
  }, [q, routers]);

  const choose = (r) => {
    onSelect && onSelect(r);
    setQ('');
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', minWidth: 240 }}>
      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center'
      }}>
        <svg style={{
          position: 'absolute',
          left: '12px',
          width: '16px',
          height: '16px',
          color: '#94a3b8',
          pointerEvents: 'none'
        }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" strokeWidth="2" />
          <path d="M21 21l-4.35-4.35" strokeWidth="2" />
        </svg>
        <input
          className="header-router-input"
          value={q}
          onChange={(e)=>{ setQ(e.target.value); setOpen(true); setHi(0); }}
          onFocus={()=>setOpen(true)}
          onBlur={()=> setTimeout(()=> setOpen(false), 120)}
          onKeyDown={(e)=>{
            if (e.key==='ArrowDown') { e.preventDefault(); setHi(i=> Math.min(i+1, Math.max(0, suggestions.length-1))); }
            if (e.key==='ArrowUp') { e.preventDefault(); setHi(i=> Math.max(i-1, 0)); }
            if (e.key==='Enter') { e.preventDefault(); choose(suggestions[hi] || suggestions[0]); }
            if (e.key==='Escape') { setOpen(false); setQ(''); }
          }}
          placeholder="Search routers…"
          style={{
            padding: '10px 12px 10px 36px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            width: '100%',
            fontSize: '13px',
            color: '#0f172a',
            backgroundColor: '#ffffff',
            outline: 'none',
            fontWeight: '500',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.borderColor = '#94a3b8'}
          onMouseOut={(e) => e.currentTarget.style.borderColor = '#cbd5e1'}
        />
        {q && (
          <button
            onClick={() => { setQ(''); setOpen(false); }}
            style={{
              position: 'absolute',
              right: '10px',
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '18px',
              padding: '0 4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && suggestions.length>0 && (
        <ul style={{
          position:'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          background: 'white',
          border: '1px solid #cbd5e1',
          borderRadius: '8px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
          listStyle: 'none',
          margin: 0,
          padding: '4px 0',
          maxHeight: 280,
          overflowY: 'auto',
          zIndex: 20
        }}>
          {suggestions.map((r, idx)=> (
            <li
              key={r.router_id}
              onMouseDown={()=> choose(r)}
              onMouseEnter={()=> setHi(idx)}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                background: idx===hi? '#f1f5f9': 'transparent',
                display: 'flex',
                justifyContent:'space-between',
                alignItems: 'center',
                gap: 12,
                fontSize: '13px',
                transition: 'background 0.15s'
              }}
            >
              <span style={{ color:'#0f172a', fontWeight: '500' }}>
                📱 {r.name || '(unnamed)'}
              </span>
              <span style={{ color:'#94a3b8', fontSize: '12px' }}>
                {r.log_count ?? 0} logs
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
