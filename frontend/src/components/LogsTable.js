import React, { useState, useEffect } from 'react';
import { getLogs } from '../services/api';
import { format } from 'date-fns';
import { exportLogsToCSV, formatBytes } from '../utils/exportUtils';

function LogsTable({ routerId, startDate, endDate }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (routerId) {
      fetchLogs();
    }
  }, [routerId, startDate, endDate]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = {
        router_id: routerId,
        start_date: startDate,
        end_date: endDate,
        limit: 100
      };
      const response = await getLogs(params);
      setLogs(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching logs:', error);
      setLoading(false);
    }
  };

  const handleExport = () => {
    exportLogsToCSV(logs, `router-logs-${routerId}-${format(new Date(), 'yyyyMMdd')}.csv`);
  };

  if (loading) {
    return <div className="loading">Loading logs...</div>;
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h2>📋 Recent Logs ({logs.length})</h2>
        {logs.length > 0 && (
          <button className="btn btn-success" onClick={handleExport}>
            Export to CSV
          </button>
        )}
      </div>
      
      {logs.length === 0 ? (
        <p>No logs found for the selected period.</p>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Operator</th>
                <th>Network</th>
                <th>RSRP</th>
                <th>RSSI</th>
                <th>Data TX</th>
                <th>Data RX</th>
                <th>WiFi Clients</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const ts = new Date(log.timestamp);
                const tsStr = isNaN(ts.getTime()) ? '-' : format(ts, 'MMM dd, HH:mm:ss');
                const rsrp = log.rsrp != null && log.rsrp !== '' ? Number(log.rsrp) : null;
                const rssi = log.rssi != null && log.rssi !== '' ? Number(log.rssi) : null;
                return (
                <tr key={log.id}>
                  <td>{tsStr}</td>
                  <td>{log.operator || '-'}</td>
                  <td>{log.network_type || '-'}</td>
                  <td>{rsrp != null ? `${Math.round(rsrp)} dBm` : '-'}</td>
                  <td>{rssi != null ? `${Math.round(rssi)} dBm` : '-'}</td>
                  <td>{formatBytes(Number(log.total_tx_bytes) || 0)}</td>
                  <td>{formatBytes(Number(log.total_rx_bytes) || 0)}</td>
                  <td>{log.wifi_client_count || 0}</td>
                  <td>
                    {(() => { const s = log.status; const isOn = (s === 'online' || s === 1 || s === '1' || s === true); return (
                      <span className={`status ${isOn ? 'status-online' : 'status-offline'}`}>
                        {isOn ? 'online' : 'offline'}
                      </span>
                    ); })()}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default LogsTable;
