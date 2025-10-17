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
      <input
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
        placeholder="Type router name…"
        style={{
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid #e2e8f0',
          width: 240,
          fontSize: 13
        }}
      />
      {open && suggestions.length>0 && (
        <ul style={{
          position:'absolute',
          top: 36,
          left: 0,
          right: 0,
          background: 'white',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
          listStyle: 'none',
          margin: 0,
          padding: 0,
          maxHeight: 220,
          overflowY: 'auto',
          zIndex: 20
        }}>
          {suggestions.map((r, idx)=> (
            <li
              key={r.router_id}
              onMouseDown={()=> choose(r)}
              onMouseEnter={()=> setHi(idx)}
              style={{
                padding: '8px 10px',
                cursor: 'pointer',
                background: idx===hi? '#f1f5f9': 'white',
                display: 'flex',
                justifyContent:'space-between',
                gap: 8,
                fontSize: 13
              }}
            >
              <span>{r.name || '(unnamed)'}</span>
              <span style={{ color:'#94a3b8' }}>logs {r.log_count ?? 0}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
