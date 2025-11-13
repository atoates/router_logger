import React, { useState, useEffect } from 'react';
import { getRouters, getUsageStats, getUptimeData } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import './StatsPage.css';

function StatsPage() {
  const [routers, setRouters] = useState([]);
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [stats, setStats] = useState(null);
  const [uptime, setUptime] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchRouters();
  }, []);

  useEffect(() => {
    if (selectedRouter) {
      fetchStats();
    }
  }, [selectedRouter]);

  const fetchRouters = async () => {
    try {
      setLoading(true);
      const response = await getRouters();
      setRouters(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setError('Failed to load routers');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    if (!selectedRouter) return;

    try {
      setLoading(true);
      setError(null);
      
      // Get last 24 hours
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
      
      const [statsRes, uptimeRes] = await Promise.all([
        getUsageStats({
          router_id: selectedRouter.router_id,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString()
        }),
        getUptimeData({
          router_id: selectedRouter.router_id,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString()
        })
      ]);

      // Handle nested data structure
      const extractedStats = statsRes.data?.data?.[0] || statsRes.data?.[0] || statsRes.data || null;
      setStats(extractedStats);
      setUptime(Array.isArray(uptimeRes.data) ? uptimeRes.data : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const calculateUptimePercent = () => {
    if (!uptime || uptime.length === 0) return 0;
    const online = uptime.filter(u => u.status === 'online' || u.status === 1).length;
    return ((online / uptime.length) * 100).toFixed(1);
  };

  if (loading && routers.length === 0) {
    return (
      <div className="page-container">
        <LoadingSpinner text="Loading..." />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>24h Statistics</h1>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {/* Router Selector */}
      <div className="stats-section">
        <h2>Select Router</h2>
        <select
          value={selectedRouter?.router_id || ''}
          onChange={(e) => {
            const router = routers.find(r => r.router_id.toString() === e.target.value);
            setSelectedRouter(router);
            setStats(null);
            setUptime(null);
          }}
          className="router-select"
        >
          <option value="">Choose a router...</option>
          {routers.map(router => (
            <option key={router.router_id} value={router.router_id}>
              #{router.router_id} {router.name && `- ${router.name}`}
            </option>
          ))}
        </select>
      </div>

      {/* Stats Display */}
      {selectedRouter && (
        <>
          {loading ? (
            <LoadingSpinner text="Loading statistics..." />
          ) : stats ? (
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Total Data Sent</div>
                <div className="stat-value">
                  {formatBytes(stats.period_tx_bytes || 0)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Total Data Received</div>
                <div className="stat-value">
                  {formatBytes(stats.period_rx_bytes || 0)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Total Usage</div>
                <div className="stat-value">
                  {formatBytes(stats.total_data_usage || 0)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Total Logs</div>
                <div className="stat-value">
                  {stats.total_logs || 0}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Avg Uptime</div>
                <div className="stat-value">
                  {stats.avg_uptime ? `${(stats.avg_uptime / 3600).toFixed(1)} hrs` : 'N/A'}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Uptime %</div>
                <div className="stat-value">
                  {calculateUptimePercent()}%
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Avg WiFi Clients</div>
                <div className="stat-value">
                  {stats.avg_clients ? Number(stats.avg_clients).toFixed(1) : '0'}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>No statistics available for this router</p>
            </div>
          )}
        </>
      )}

      {!selectedRouter && (
        <div className="empty-state">
          <p>Select a router to view statistics</p>
        </div>
      )}
    </div>
  );
}

export default StatsPage;

