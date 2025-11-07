import React, { useState, useEffect, useMemo } from 'react';
import { getLogs } from '../services/api';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

function DataCharts({ routerId, startDate, endDate }) {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showRawData, setShowRawData] = useState(false); // Toggle for chart scale (false = normalized)
  const [useRollingAverage, setUseRollingAverage] = useState(true); // Toggle for rolling average (true = smoothed by default)

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

  // Process chart data with optional rolling average and normalization
  const processedChartData = useMemo(() => {
    if (chartData.length === 0) return [];

    let processed = [...chartData];

    // Apply rolling average if enabled
    if (useRollingAverage && processed.length > 3) {
      const windowSize = Math.max(3, Math.floor(processed.length / 20));
      const halfWindow = Math.floor(windowSize / 2);

      processed = processed.map((point, i) => {
        const start = Math.max(0, i - halfWindow);
        const end = Math.min(processed.length, i + halfWindow + 1);
        const window = chartData.slice(start, end);

        const avgTx = window.reduce((sum, p) => sum + p.tx_mb, 0) / window.length;
        const avgRx = window.reduce((sum, p) => sum + p.rx_mb, 0) / window.length;

        return {
          ...point,
          tx_mb: avgTx,
          rx_mb: avgRx,
          total_mb: avgTx + avgRx
        };
      });
    }

    // Apply normalization (outlier capping) if not showing raw data
    if (!showRawData && processed.length > 0) {
      const txValues = processed.map(p => p.tx_mb).sort((a, b) => a - b);
      const rxValues = processed.map(p => p.rx_mb).sort((a, b) => a - b);
      
      const p95Index = Math.floor(txValues.length * 0.95);
      const txCap = txValues[p95Index] * 1.5;
      const rxCap = rxValues[p95Index] * 1.5;

      processed = processed.map(point => ({
        ...point,
        tx_mb: Math.min(point.tx_mb, txCap),
        rx_mb: Math.min(point.rx_mb, rxCap),
        total_mb: Math.min(point.tx_mb, txCap) + Math.min(point.rx_mb, rxCap)
      }));
    }

    return processed;
  }, [chartData, showRawData, useRollingAverage]);

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0 }}>Data Usage Over Time</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowRawData(!showRawData)}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: '500',
                background: showRawData ? '#6b7280' : '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              title={showRawData ? 'Showing all spikes' : 'Capping outliers at 95th percentile'}
            >
              {showRawData ? '📊 Raw Data' : '📉 Normalized'}
            </button>
            <button
              onClick={() => setUseRollingAverage(!useRollingAverage)}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: '500',
                background: useRollingAverage ? '#8b5cf6' : '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              title={useRollingAverage ? 'Showing rolling average (smoothed)' : 'Showing raw deltas (spiky)'}
            >
              {useRollingAverage ? '📈 Smoothed' : '⚡ Instant'}
            </button>
          </div>
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={processedChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="timestamp" 
                angle={-45} 
                textAnchor="end" 
                height={80}
                interval="preserveStartEnd"
                tick={{ fontSize: 11, fill: '#374151' }}
              />
              <YAxis 
                label={{ value: 'MB', angle: -90, position: 'insideLeft' }} 
                tick={{ fill: '#374151' }}
                width={70}
                tickFormatter={(value) => value.toFixed(1)}
              />
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

      {/* We detected signal/wifi fields are often missing; hide these charts to keep dashboard useful */}

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
                tick={{ fontSize: 11, fill: '#374151' }}
              />
              <YAxis 
                label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} 
                tick={{ fill: '#374151' }}
                width={70}
                tickFormatter={(value) => value.toFixed(1)}
              />
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
