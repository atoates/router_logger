import React from 'react';

export default function SystemStatusPage({ 
  routers, 
  storage, 
  dbSize, 
  inspections,
  formatBytes,
  fmtNum,
  Metric
}) {
  const online = routers.filter(r => r.current_status === 'online' || r.current_status === 1 || r.current_status === '1').length;
  const offline = routers.length - online;
  
  return (
    <>
      {/* System Metrics */}
      <div className="v3-metrics">
        <Metric label="Total Routers" value={fmtNum(routers.length)} sub={`${online} online, ${offline} offline`} color="#6366f1" />
        {storage && <Metric label="Log Volume" value={fmtNum(storage.total_logs || 0)} sub={`${formatBytes(storage.total_size || 0)}`} color="#10b981" />}
        {dbSize && (
          <Metric 
            label="Database Size" 
            value={formatBytes(dbSize.size_bytes || 0)}
            sub={`${fmtNum(dbSize.table_count || 0)} tables`}
            color="#f59e0b"
          />
        )}
      </div>

      {/* Inspection Status */}
      {inspections && inspections.length > 0 && (
        <div className="v3-card">
          <div className="v3-card-title">Database Health Checks</div>
          <div className="v3-list">
            {inspections.map((ins, i) => (
              <div key={i} className="v3-list-item">
                <div className="info">
                  <div className="name">{ins.check_name}</div>
                  <div className="sub">{ins.description}</div>
                </div>
                <div className="val" style={{ color: ins.status === 'healthy' ? '#10b981' : '#ef4444' }}>
                  {ins.status === 'healthy' ? '✓' : '⚠️'} {ins.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Storage Breakdown */}
      {storage && storage.by_router && storage.by_router.length > 0 && (
        <div className="v3-card">
          <div className="v3-card-title">Storage by Router (Top 10)</div>
          <div className="v3-list">
            {storage.by_router.slice(0, 10).map((r, i) => (
              <div key={r.router_id} className="v3-list-item">
                <div className="rank">{i + 1}</div>
                <div className="info">
                  <div className="name">{r.name || `Router ${r.router_id}`}</div>
                  <div className="sub">{fmtNum(r.log_count || 0)} logs</div>
                </div>
                <div className="val">{formatBytes(r.total_size || 0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
