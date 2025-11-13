import React, { useState, useEffect } from 'react';
import { getUsageStats, getLogs } from '../../services/api';
import { generateInstallationReport } from '../../utils/installationReport';
import { mobileFetch } from '../../utils/mobileApi';

const MobileStats = ({ router }) => {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    if (router) {
      loadStats();
      
      // Auto-refresh every 30 seconds for installers to see status changes quickly
      const interval = setInterval(() => {
        loadStats();
      }, 30000); // 30 seconds
      
      return () => clearInterval(interval);
    }
  }, [router]);

  const loadStats = async () => {
    try {
      setLoading(true);
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

      const [statsResponse, logsResponse] = await Promise.all([
        getUsageStats({
          router_id: router.router_id,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString()
        }),
        getLogs({
          router_id: router.router_id,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString()
        })
      ]);

      console.log('Stats response:', statsResponse);
      console.log('Logs response:', logsResponse);

      // Handle nested data structure: statsResponse.data.data[0]
      const statsData = statsResponse.data?.data?.[0] || statsResponse.data?.[0] || {};
      console.log('Stats data:', statsData);
      console.log('TX bytes:', statsData.period_tx_bytes, 'RX bytes:', statsData.period_rx_bytes);
      console.log('Total data usage:', statsData.total_data_usage);
      console.log('Total logs:', statsData.total_logs);
      console.log('Averages:', {
        rsrp: statsData.avg_rsrp,
        rssi: statsData.avg_rssi,
        rsrq: statsData.avg_rsrq,
        sinr: statsData.avg_sinr
      });
      
      setStats(statsData);
      setLogs(logsResponse.data || []);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshFromRMS = async () => {
    try {
      setRefreshing(true);
      const response = await mobileFetch(`/api/rms/refresh/${router.router_id}`, {
        method: 'POST'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.message || 'Failed to refresh');
      }

      const result = await response.json();
      alert('Router data refreshed from RMS!');
      
      // Reload stats to show updated data
      await loadStats();
      
      // Notify parent to refresh router list (optional)
      window.dispatchEvent(new Event('router-updated'));
    } catch (error) {
      console.error('Failed to refresh from RMS:', error);
      alert(`Failed to refresh: ${error.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const calculateUptime = () => {
    if (!logs.length) return 0;
    const onlineLogs = logs.filter(log => log.status === 'online');
    return Math.round((onlineLogs.length / logs.length) * 100);
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const handleGenerateReport = async () => {
    if (!navigator.geolocation) {
      alert('GPS not available on this device');
      return;
    }

    setGenerating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const gpsData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp ? new Date(position.timestamp).toISOString() : new Date().toISOString()
          };

          await generateInstallationReport({
            router: router,
            stats: stats,
            logs: logs,
            gpsLocation: gpsData
          });
          alert('Report generated successfully!');
        } catch (error) {
          console.error('Failed to generate report:', error);
          alert(`Failed to generate report: ${error.message || error}`);
        } finally {
          setGenerating(false);
        }
      },
      (error) => {
        console.error('GPS error:', error);
        alert('Failed to get GPS location. Please enable location services.');
        setGenerating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  if (!router) {
    return <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>Select a router first</div>;
  }

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Loading stats...</div>;
  }

  const isOnline = router.current_status === 'online';
  const uptime = calculateUptime();

  return (
    <div style={{ padding: '16px' }}>
      {/* Auto-refresh Indicator */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        background: '#f0f9ff',
        border: '1px solid #bae6fd',
        borderRadius: '8px',
        marginBottom: '12px',
        fontSize: '12px',
        color: '#0c4a6e'
      }}>
        <span>🔄 Auto-refreshing every 30s</span>
        <span>Updated {Math.round((new Date() - lastUpdated) / 1000)}s ago</span>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600' }}>
          {router.name || `Router #${router.router_id}`}
        </h2>
        <button
          onClick={handleRefreshFromRMS}
          disabled={refreshing}
          style={{
            padding: '8px 16px',
            background: refreshing ? '#94a3b8' : '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: '500',
            cursor: refreshing ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>{refreshing ? '🔄' : '↻'}</span>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Status */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          background: isOnline ? '#dcfce7' : '#fee2e2',
          border: `1px solid ${isOnline ? '#86efac' : '#fca5a5'}`,
          borderRadius: '12px',
          padding: '16px',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '24px',
            fontWeight: '700',
            color: isOnline ? '#166534' : '#991b1b'
          }}>
            {isOnline ? '● Online' : '○ Offline'}
          </div>
          <div style={{ fontSize: '13px', color: isOnline ? '#166534' : '#991b1b', marginTop: '4px' }}>
            Last seen: {router.last_seen ? new Date(router.last_seen).toLocaleString() : 'Never'}
          </div>
        </div>
      </div>

      {/* 24h Stats */}
      {/* NOTE: Do not add "Avg Uptime" (hours) or "Avg WiFi Clients" cards - these have been removed per request */}
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: '600', color: '#374151' }}>
          24-Hour Performance
        </h3>
        
        <div style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '16px'
        }}>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Uptime</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827' }}>{uptime}%</div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Data Usage (24h)</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827', marginBottom: '4px' }}>
              {formatBytes(stats?.total_data_usage || 0)}
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>
              ↑ {formatBytes(stats?.period_tx_bytes || 0)} • ↓ {formatBytes(stats?.period_rx_bytes || 0)}
            </div>
          </div>

          {(stats?.avg_rsrp || stats?.avg_rssi) && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Signal Strength (Avg)</div>
              <div style={{ fontSize: '14px', color: '#374151' }}>
                {stats.avg_rsrp && `RSRP: ${Math.round(stats.avg_rsrp)} dBm`}<br/>
                {stats.avg_rssi && `RSSI: ${Math.round(stats.avg_rssi)} dBm`}<br/>
                {stats.avg_rsrq && `RSRQ: ${Math.round(stats.avg_rsrq)} dB`}<br/>
                {stats.avg_sinr && `SINR: ${Math.round(stats.avg_sinr)} dB`}
              </div>
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Network</div>
            <div style={{ fontSize: '14px', color: '#374151' }}>
              {logs.length > 0 && logs[logs.length - 1]?.operator 
                ? `${logs[logs.length - 1].operator}${logs[logs.length - 1].network_type ? ' • ' + logs[logs.length - 1].network_type : ''}`
                : 'Unknown'}<br/>
              {logs.length > 0 && logs[logs.length - 1]?.wan_ip && `IP: ${logs[logs.length - 1].wan_ip}`}
            </div>
          </div>

          {/* Logging Status Badge */}
          <div>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Status</div>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              background: '#d1fae5',
              border: '1px solid #6ee7b7',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: '600',
              color: '#065f46'
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
              Logging Enabled
            </div>
          </div>
        </div>
      </div>

      {/* Generate Report Button */}
      <button
        onClick={handleGenerateReport}
        disabled={!isOnline || generating}
        style={{
          width: '100%',
          padding: '16px',
          background: (!isOnline || generating) ? '#e5e7eb' : '#2563eb',
          color: (!isOnline || generating) ? '#9ca3af' : '#fff',
          border: 'none',
          borderRadius: '12px',
          fontSize: '16px',
          fontWeight: '600',
          cursor: (!isOnline || generating) ? 'not-allowed' : 'pointer',
          marginBottom: '16px'
        }}
      >
        {generating ? 'Generating Report...' : '📄 Generate Installation Report'}
      </button>

      {!isOnline && (
        <div style={{
          background: '#fef3c7',
          border: '1px solid #fcd34d',
          borderRadius: '12px',
          padding: '12px',
          fontSize: '13px',
          color: '#92400e',
          textAlign: 'center'
        }}>
          Router must be online to generate installation report
        </div>
      )}
    </div>
  );
};

export default MobileStats;
