import React, { useState, useEffect } from 'react';
import { getLogs } from '../services/api';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

function DataCharts({ routerId, startDate, endDate }) {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (routerId && startDate && endDate) {
      fetchChartData();
    }
  }, [routerId, startDate, endDate]);

  const fetchChartData = async () => {
    setLoading(true);
    try {
      const params = {
        router_id: routerId,
        start_date: startDate,
        end_date: endDate,
        limit: 500
      };
      const response = await getLogs(params);

      // Process data for charts; coerce numeric strings to numbers
      const processed = (response.data || [])
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map((log, index, array) => {
          const prev = index > 0 ? array[index - 1] : null;
          const tx = Number(log.total_tx_bytes) || 0;
          const rx = Number(log.total_rx_bytes) || 0;
          const prevTx = prev ? (Number(prev.total_tx_bytes) || 0) : 0;
          const prevRx = prev ? (Number(prev.total_rx_bytes) || 0) : 0;
          const txDelta = prev ? Math.max(0, (tx - prevTx) / 1024 / 1024) : 0;
          const rxDelta = prev ? Math.max(0, (rx - prevRx) / 1024 / 1024) : 0;
          
          return {
            timestamp: format(new Date(log.timestamp), 'MMM dd HH:mm'),
            tx_mb: txDelta,
            rx_mb: rxDelta,
            total_mb: txDelta + rxDelta,
            rsrp: log.rsrp != null ? Number(log.rsrp) : null,
            rsrq: log.rsrq != null ? Number(log.rsrq) : null,
            rssi: log.rssi != null ? Number(log.rssi) : null,
            wifi_clients: log.wifi_client_count || 0,
            uptime_hours: ((Number(log.uptime_seconds) || 0) / 3600)
          };
        });
      
      setChartData(processed);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching chart data:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading charts...</div>;
  }

  if (chartData.length === 0) {
    return (
      <div className="card">
        <h2>📈 Data Visualization</h2>
        <p>No data available for the selected period.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Data Usage Chart */}
      <div className="card">
        <h3>Data Usage Over Time</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="timestamp" 
                angle={-45} 
                textAnchor="end" 
                height={80}
                interval="preserveStartEnd"
              />
              <YAxis label={{ value: 'MB', angle: -90, position: 'insideLeft' }} />
              <Tooltip />
              <Legend />
              <Area 
                type="monotone" 
                dataKey="tx_mb" 
                stackId="1"
                stroke="#8884d8" 
                fill="#8884d8" 
                name="TX (MB)" 
              />
              <Area 
                type="monotone" 
                dataKey="rx_mb" 
                stackId="1"
                stroke="#82ca9d" 
                fill="#82ca9d" 
                name="RX (MB)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Signal Quality Chart */}
      <div className="card">
        <h3>Signal Quality (RSRP, RSSI)</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="timestamp" 
                angle={-45} 
                textAnchor="end" 
                height={80}
                interval="preserveStartEnd"
              />
              <YAxis label={{ value: 'dBm', angle: -90, position: 'insideLeft' }} />
              <Tooltip />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="rsrp" 
                stroke="#ff7300" 
                name="RSRP (dBm)"
                connectNulls
              />
              <Line 
                type="monotone" 
                dataKey="rssi" 
                stroke="#387908" 
                name="RSSI (dBm)"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* WiFi Clients Chart */}
      <div className="card">
        <h3>WiFi Connected Clients</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="timestamp" 
                angle={-45} 
                textAnchor="end" 
                height={80}
                interval="preserveStartEnd"
              />
              <YAxis label={{ value: 'Clients', angle: -90, position: 'insideLeft' }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="wifi_clients" fill="#667eea" name="WiFi Clients" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Uptime Chart */}
      <div className="card">
        <h3>Device Uptime</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="timestamp" 
                angle={-45} 
                textAnchor="end" 
                height={80}
                interval="preserveStartEnd"
              />
              <YAxis label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} />
              <Tooltip />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="uptime_hours" 
                stroke="#8b5cf6" 
                name="Uptime (hours)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default DataCharts;
