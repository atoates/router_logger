import React, { useState, useEffect } from 'react';
import { getLogs, getUsageStats } from '../../services/api';
import { generateInstallationReport } from '../../utils/installationReport';

const MobileStats = ({ selectedRouter }) => {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (selectedRouter) {
      loadStats();
    }
  }, [selectedRouter]);

  const loadStats = async () => {
    if (!selectedRouter) return;

    try {
      setLoading(true);
      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [statsRes, logsRes] = await Promise.all([
        getUsageStats({ 
          router_id: selectedRouter.router_id,
          start_date: startDate,
          end_date: endDate
        }),
        getLogs({
          router_id: selectedRouter.router_id,
          start_date: startDate,
          end_date: endDate,
          limit: 100
        })
      ]);

      setStats(statsRes.data);
      setLogs(logsRes.data || []);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!selectedRouter) return;

    try {
      setGenerating(true);

      // Request location permission
      const position = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation not supported'));
          return;
        }
        
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      });

      const gpsLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: new Date(position.timestamp).toISOString()
      };

      // Generate the report
      await generateInstallationReport({
        router: selectedRouter,
        stats: stats,
        logs: logs,
        gpsLocation: gpsLocation,
        technician: {
          timestamp: new Date().toISOString()
        }
      });

      alert('Installation report generated successfully!');
    } catch (error) {
      console.error('Failed to generate report:', error);
      
      if (error.code === 1) {
        alert('Location permission denied. Please enable location access to generate the report.');
      } else if (error.code === 2) {
        alert('Location unavailable. Please check your device settings.');
      } else if (error.code === 3) {
        alert('Location request timeout. Please try again.');
      } else {
        alert('Failed to generate report: ' + error.message);
      }
    } finally {
      setGenerating(false);
    }
  };

  const formatBytes = (bytes) => {
    const n = Number(bytes) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
    return n + ' B';
  };

  const getUptimePercentage = () => {
    if (!logs || logs.length === 0) return 0;
    const onlineLogs = logs.filter(log => 
      log.status === 'online' || log.status === 1 || log.status === '1'
    );
    return ((onlineLogs.length / logs.length) * 100).toFixed(1);
  };

  const getLatestLog = () => {
    return logs.length > 0 ? logs[0] : null;
  };

  const latestLog = getLatestLog();
  const isOnline = selectedRouter && (
    selectedRouter.current_status === 'online' || 
    selectedRouter.current_status === 1 || 
    selectedRouter.current_status === '1'
  );

  if (!selectedRouter) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>No Router Selected</div>
        <div style={{ fontSize: '14px' }}>Go to Search tab to select a router</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
        <div style={{ fontSize: '16px', fontWeight: 600 }}>Loading stats...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Current Status */}
      <div className="mobile-card">
        <div className="mobile-card-title">Current Status</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <span className={`mobile-status-badge mobile-status-${isOnline ? 'online' : 'offline'}`}>
            {isOnline ? '● Online' : '○ Offline'}
          </span>
        </div>
        {selectedRouter.last_seen && (
          <div style={{ fontSize: '13px', color: '#64748b' }}>
            Last seen: {new Date(selectedRouter.last_seen).toLocaleString()}
          </div>
        )}
      </div>

      {/* Uptime (Last 24h) */}
      <div className="mobile-card">
        <div className="mobile-card-title">Uptime (Last 24h)</div>
        <div style={{ fontSize: '32px', fontWeight: 700, color: '#7c3aed', marginBottom: '8px' }}>
          {getUptimePercentage()}%
        </div>
        <div style={{ fontSize: '13px', color: '#64748b' }}>
          {logs.length} data points collected
        </div>
      </div>

      {/* Data Usage (Last 24h) */}
      {stats && (
        <div className="mobile-card">
          <div className="mobile-card-title">Data Usage (Last 24h)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
                Upload
              </div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#3b82f6' }}>
                {formatBytes(stats.total_tx_bytes || 0)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
                Download
              </div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#10b981' }}>
                {formatBytes(stats.total_rx_bytes || 0)}
              </div>
            </div>
          </div>
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
              Total
            </div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: '#7c3aed' }}>
              {formatBytes((stats.total_tx_bytes || 0) + (stats.total_rx_bytes || 0))}
            </div>
          </div>
        </div>
      )}

      {/* Signal Strength */}
      {latestLog && (latestLog.rsrp || latestLog.rssi) && (
        <div className="mobile-card">
          <div className="mobile-card-title">Signal Strength</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {latestLog.rsrp && (
              <div>
                <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
                  RSRP
                </div>
                <div style={{ fontSize: '18px', fontWeight: 600 }}>
                  {latestLog.rsrp} dBm
                </div>
              </div>
            )}
            {latestLog.rssi && (
              <div>
                <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
                  RSSI
                </div>
                <div style={{ fontSize: '18px', fontWeight: 600 }}>
                  {latestLog.rssi} dBm
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Network Info */}
      {latestLog && (
        <div className="mobile-card">
          <div className="mobile-card-title">Network Info</div>
          {latestLog.operator && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
                Operator
              </div>
              <div style={{ fontWeight: 600 }}>
                {latestLog.operator}
              </div>
            </div>
          )}
          {latestLog.network_type && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
                Network Type
              </div>
              <div style={{ fontWeight: 600 }}>
                {latestLog.network_type}
              </div>
            </div>
          )}
          {latestLog.wan_ip && (
            <div>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
                WAN IP
              </div>
              <div style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '14px' }}>
                {latestLog.wan_ip}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Generate Installation Report */}
      <div className="mobile-card">
        <div className="mobile-card-title">Installation Report</div>
        <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '16px' }}>
          Generate a detailed installation report with GPS location and current stats.
        </div>
        <button
          className="mobile-button mobile-button-primary"
          onClick={handleGenerateReport}
          disabled={generating || !isOnline}
        >
          {generating ? '⏳ Generating Report...' : '📄 Generate Installation Report'}
        </button>
        {!isOnline && (
          <div style={{ marginTop: '12px', padding: '12px', background: '#fef2f2', borderRadius: '8px', fontSize: '13px', color: '#991b1b' }}>
            ⚠️ Router must be online to generate installation report
          </div>
        )}
      </div>
    </div>
  );
};

export default MobileStats;
