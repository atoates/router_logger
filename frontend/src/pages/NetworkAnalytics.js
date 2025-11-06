import React from 'react';

export default function NetworkAnalyticsPage({ 
  mode, 
  value, 
  routers, 
  usage, 
  usagePrev, 
  top, 
  operators, 
  rmsUsage,
  formatBytes,
  fmtNum,
  COLORS,
  Metric,
  DeltaBadge,
  Heatmap
}) {
  const online = routers.filter(r => r.current_status === 'online' || r.current_status === 1 || r.current_status === '1').length;
  const total = routers.length;
  const totalNow = usage.reduce((s, x) => s + (Number(x.total_bytes) || 0), 0);
  const totalPrev = usagePrev.reduce((s, x) => s + (Number(x.total_bytes) || 0), 0);
  const avgPerRouter = total > 0 ? totalNow / total : 0;

  return (
    <>
      {/* Metrics */}
      <div className="v3-metrics">
        <Metric label="Network Health" value={`${total ? Math.round(online/total*100) : 0}%`} sub={`${online}/${total} online`} color="#10b981" />
        <Metric label={`${mode==='rolling'?value+'h':'Last '+value+'d'} Data`} value={formatBytes(totalNow)} sub={<DeltaBadge current={totalNow} previous={totalPrev} />} color="#6366f1" />
        <Metric label="Avg per Router" value={formatBytes(avgPerRouter)} sub={`${fmtNum(total)} routers`} color="#f59e0b" />
        {rmsUsage && (
          <Metric 
            label="RMS API Usage" 
            value={`${rmsUsage.daily_usage || 0}/${rmsUsage.daily_limit || 5000}`}
            sub={`${Math.round((rmsUsage.daily_usage || 0) / (rmsUsage.daily_limit || 5000) * 100)}% used today`}
            color={rmsUsage.daily_usage > rmsUsage.daily_limit * 0.8 ? '#ef4444' : '#10b981'}
          />
        )}
      </div>

      {/* Charts Grid */}
      <div className="v3-grid">
        <Heatmap data={usage} mode={mode} />
        
        {/* Top Routers */}
        {top && top.length > 0 && (
          <div className="v3-card">
            <div className="v3-card-title">Top Routers by Usage</div>
            <div className="v3-list">
              {top.map((r, i) => (
                <div key={r.router_id} className="v3-list-item">
                  <div className="rank" style={{ background: COLORS[i % COLORS.length] }}>{i + 1}</div>
                  <div className="info">
                    <div className="name">{r.name}</div>
                    <div className="sub">ID {r.router_id}</div>
                  </div>
                  <div className="val">{formatBytes(r.total_bytes)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Operators Pie */}
        {operators && operators.length > 0 && (
          <div className="v3-card">
            <div className="v3-card-title">Usage by Operator</div>
            <div className="v3-pie">
              {/* Pie chart placeholder - implement with Recharts if needed */}
              <div className="v3-list">
                {operators.map((op, i) => (
                  <div key={i} className="v3-list-item">
                    <div className="rank" style={{ background: op.fill }}>{i + 1}</div>
                    <div className="info">
                      <div className="name">{op.name}</div>
                    </div>
                    <div className="val">{formatBytes(op.value)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
