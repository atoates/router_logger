import React, { useState, useEffect } from 'react';
import { getUsageStats } from '../services/api';
import { exportUsageStatsToPDF, formatBytes } from '../utils/exportUtils';

function UsageStats({ routerId, startDate, endDate }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (routerId && startDate && endDate) {
      fetchStats();
    }
  }, [routerId, startDate, endDate]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const params = {
        router_id: routerId,
        start_date: startDate,
        end_date: endDate
      };
      const response = await getUsageStats(params);
      const d = response.data || {};
      // Coerce numeric strings to numbers and provide safe defaults
      const normalized = {
        ...d,
        total_logs: Number(d.total_logs) || 0,
        period_tx_bytes: Number(d.period_tx_bytes) || 0,
        period_rx_bytes: Number(d.period_rx_bytes) || 0,
        total_data_usage: Number(d.total_data_usage) || 0,
        avg_uptime: Number(d.avg_uptime) || 0,
        avg_clients: Number(d.avg_clients) || 0
      };
      setStats(normalized);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching stats:', error);
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (stats) {
      exportUsageStatsToPDF(stats, routerId, startDate, endDate);
    }
  };

  if (loading) {
    return <div className="loading">Loading statistics...</div>;
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h2>📊 Usage Statistics</h2>
        <button className="btn btn-success" onClick={handleExport}>
          Export Report (PDF)
        </button>
      </div>
      
      <div className="grid">
        <div className="stat-card">
          <div className="stat-label">Total Data Sent</div>
          <div className="stat-value">{formatBytes(stats.period_tx_bytes || 0)}</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-label">Total Data Received</div>
          <div className="stat-value">{formatBytes(stats.period_rx_bytes || 0)}</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-label">Total Usage</div>
          <div className="stat-value">{formatBytes(stats.total_data_usage || 0)}</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-label">Total Logs</div>
          <div className="stat-value">{stats.total_logs || 0}</div>
        </div>
        
        {/* Signal summary cards removed per request */}
        
        <div className="stat-card">
          <div className="stat-label">Avg Uptime</div>
          <div className="stat-value">
            {stats.avg_uptime ? `${(stats.avg_uptime / 3600).toFixed(1)} hrs` : 'N/A'}
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-label">Avg WiFi Clients</div>
          <div className="stat-value">
            {stats.avg_clients ? stats.avg_clients.toFixed(1) : '0'}
          </div>
        </div>
      </div>
    </div>
  );
}

export default UsageStats;
