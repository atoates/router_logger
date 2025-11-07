import React, { useState, useEffect } from 'react';
import { getUsageStats, getLogs } from '../../services/api';
import { generateInstallationReport } from '../../utils/installationReport';

const MobileStats = ({ router }) => {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (router) {
      loadStats();
    }
  }, [router]);

  const loadStats = async () => {
    try {
      setLoading(true);
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

      const [statsResponse, logsResponse] = await Promise.all([
        getUsageStats(router.router_id, startDate.toISOString(), endDate.toISOString()),
        getLogs(router.router_id, startDate.toISOString(), endDate.toISOString())
      ]);

      setStats(statsResponse.data[0] || {});
      setLogs(logsResponse.data || []);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
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
            timestamp: new Date(position.timestamp).toISOString()
          };

          await generateInstallationReport(router, stats, logs, gpsData);
        } catch (error) {
          console.error('Failed to generate report:', error);
          alert('Failed to generate report');
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
      <h2 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600' }}>
        {router.name || `Router #${router.router_id}`}
      </h2>

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
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Data Usage</div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827' }}>
              ↑ {formatBytes(stats?.tx_bytes)} • ↓ {formatBytes(stats?.rx_bytes)}
            </div>
          </div>

          {stats?.rsrp && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Signal Strength</div>
              <div style={{ fontSize: '14px', color: '#374151' }}>
                RSRP: {stats.rsrp} dBm<br/>
                RSSI: {stats.rssi} dBm<br/>
                RSRQ: {stats.rsrq} dB<br/>
                SINR: {stats.sinr} dB
              </div>
            </div>
          )}

          <div>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Network</div>
            <div style={{ fontSize: '14px', color: '#374151' }}>
              {stats?.operator || 'Unknown'} • {stats?.network_type || 'Unknown'}<br/>
              {stats?.wan_ip && `IP: ${stats.wan_ip}`}
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
