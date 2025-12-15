import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import { getTopRouters, getNetworkUsage, getRouters } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import './StatsPage.css';

const ITEMS_PER_PAGE = 15;

// Create marker icons for map
const createMapIcon = (isOnline) => {
  const color = isOnline ? '#4ade80' : '#6b7280';
  return L.divIcon({
    className: 'stats-map-marker',
    html: `<div class="map-marker-dot" style="background: ${color}; box-shadow: 0 0 8px ${color}"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
};

function StatsPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [routers, setRouters] = useState([]);
  const [allRouters, setAllRouters] = useState([]);
  const [displayedRouters, setDisplayedRouters] = useState([]);
  const [networkUsage, setNetworkUsage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const observerTarget = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAllData();
  }, []);

  useEffect(() => {
    setDisplayedRouters(routers.slice(0, ITEMS_PER_PAGE));
    setHasMore(routers.length > ITEMS_PER_PAGE);
  }, [routers]);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [topRoutersRes, networkRes, allRoutersRes] = await Promise.all([
        getTopRouters(1, 100),
        getNetworkUsage(7),
        getRouters(true)
      ]);
      
      setRouters(Array.isArray(topRoutersRes.data) ? topRoutersRes.data : []);
      setNetworkUsage(Array.isArray(networkRes.data) ? networkRes.data : []);
      setAllRouters(Array.isArray(allRoutersRes.data) ? allRoutersRes.data : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setTimeout(() => {
      const currentCount = displayedRouters.length;
      const nextRouters = routers.slice(0, currentCount + ITEMS_PER_PAGE);
      setDisplayedRouters(nextRouters);
      setHasMore(nextRouters.length < routers.length);
      setLoadingMore(false);
    }, 200);
  }, [loadingMore, hasMore, displayedRouters.length, routers]);

  useEffect(() => {
    if (activeTab !== 'routers') return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) observer.observe(currentTarget);
    return () => { if (currentTarget) observer.unobserve(currentTarget); };
  }, [activeTab, hasMore, loadingMore, loadMore]);

  // Helper functions
  const formatBytes = (bytes) => {
    // Handle null, undefined, NaN, or non-numeric values
    const numBytes = Number(bytes);
    if (!numBytes || isNaN(numBytes) || numBytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(numBytes) / Math.log(k));
    // Ensure i is within bounds
    const safeIndex = Math.min(i, sizes.length - 1);
    return `${(numBytes / Math.pow(k, safeIndex)).toFixed(1)} ${sizes[safeIndex]}`;
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
  };

  const handleRouterClick = (routerId) => {
    navigate(`/router/${routerId}`);
  };

  // Calculate summary stats - ensure values are converted to numbers (BigInt from PostgreSQL comes as strings)
  const totalData = routers.reduce((sum, r) => sum + (Number(r.total_bytes) || 0), 0);
  const totalSent = routers.reduce((sum, r) => sum + (Number(r.tx_bytes) || 0), 0);
  const totalReceived = routers.reduce((sum, r) => sum + (Number(r.rx_bytes) || 0), 0);
  const onlineCount = allRouters.filter(r => {
    const status = r.current_status || r.current_state;
    return status === 'online' || status === 'Online' || status === 1 || status === '1';
  }).length;
  const offlineCount = allRouters.length - onlineCount;
  
  // Get routers with location for map
  const routersWithLocation = allRouters.filter(r => r.latitude && r.longitude);
  const mapCenter = routersWithLocation.length > 0 
    ? [parseFloat(routersWithLocation[0].latitude), parseFloat(routersWithLocation[0].longitude)]
    : [51.5074, -0.1278];

  if (loading) {
    return (
      <div className="page-container">
        <LoadingSpinner text="Loading statistics..." />
      </div>
    );
  }

  return (
    <div className="page-container stats-page">
      {/* Header */}
      <div className="stats-header">
        <h1>📊 Statistics</h1>
        <p className="stats-subtitle">Last 24 hours</p>
      </div>

      {error && <ErrorMessage message={error} onRetry={fetchAllData} />}

      {/* Tab Navigation */}
      <div className="stats-tabs">
        <button 
          className={`stats-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button 
          className={`stats-tab ${activeTab === 'routers' ? 'active' : ''}`}
          onClick={() => setActiveTab('routers')}
        >
          Routers
        </button>
        <button 
          className={`stats-tab ${activeTab === 'map' ? 'active' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          Map
        </button>
        <button 
          className={`stats-tab ${activeTab === 'network' ? 'active' : ''}`}
          onClick={() => setActiveTab('network')}
        >
          Network
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="stats-content">
          {/* Quick Stats Cards */}
          <div className="stats-cards">
            <div className="stat-card stat-card-primary">
              <div className="stat-icon">📡</div>
              <div className="stat-info">
                <div className="stat-value">{allRouters.length}</div>
                <div className="stat-label">Total Routers</div>
              </div>
            </div>
            
            <div className="stat-card stat-card-success">
              <div className="stat-icon">✅</div>
              <div className="stat-info">
                <div className="stat-value">{onlineCount}</div>
                <div className="stat-label">Online</div>
              </div>
            </div>
            
            <div className="stat-card stat-card-muted">
              <div className="stat-icon">⭕</div>
              <div className="stat-info">
                <div className="stat-value">{offlineCount}</div>
                <div className="stat-label">Offline</div>
              </div>
            </div>
            
            <div className="stat-card stat-card-accent">
              <div className="stat-icon">📍</div>
              <div className="stat-info">
                <div className="stat-value">{routersWithLocation.length}</div>
                <div className="stat-label">With Location</div>
              </div>
            </div>
          </div>

          {/* Data Usage Summary */}
          <div className="stats-section">
            <h2>📈 Data Usage (24h)</h2>
            <div className="data-summary">
              <div className="data-total">
                <span className="data-value">{formatBytes(totalData)}</span>
                <span className="data-label">Total</span>
              </div>
              <div className="data-breakdown">
                <div className="data-item data-sent">
                  <span className="data-direction">↑</span>
                  <span className="data-amount">{formatBytes(totalSent)}</span>
                  <span className="data-type">Sent</span>
                </div>
                <div className="data-item data-received">
                  <span className="data-direction">↓</span>
                  <span className="data-amount">{formatBytes(totalReceived)}</span>
                  <span className="data-type">Received</span>
                </div>
              </div>
            </div>
          </div>

          {/* Top 5 Routers */}
          <div className="stats-section">
            <h2>🏆 Top Data Users</h2>
            <div className="top-routers-list">
              {routers.slice(0, 5).map((router, index) => (
                <div 
                  key={router.router_id} 
                  className="top-router-item"
                  onClick={() => handleRouterClick(router.router_id)}
                >
                  <span className="top-router-rank">#{index + 1}</span>
                  <div className="top-router-info">
                    <span className="top-router-name">{router.name || `Router #${router.router_id}`}</span>
                    {router.clickup_location_task_name && (
                      <span className="top-router-location">{router.clickup_location_task_name}</span>
                    )}
                  </div>
                  <span className="top-router-usage">{formatBytes(router.total_bytes || 0)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Routers Tab */}
      {activeTab === 'routers' && (
        <div className="stats-content">
          <div className="stats-router-list">
            {displayedRouters.map((router) => (
              <div
                key={router.router_id}
                className="stats-router-card"
                onClick={() => handleRouterClick(router.router_id)}
              >
                <div className="stats-router-header">
                  <div className="stats-router-name">
                    {router.name || `Router #${router.router_id}`}
                  </div>
                  <div className="stats-router-id">#{router.router_id}</div>
                </div>
                
                {router.clickup_location_task_name && (
                  <div className="stats-router-location">
                    📍 {router.clickup_location_task_name}
                  </div>
                )}
                
                <div className="stats-router-usage">
                  <div className="stats-usage-item">
                    <span className="stats-usage-label">Total:</span>
                    <span className="stats-usage-value">{formatBytes(router.total_bytes || 0)}</span>
                  </div>
                  <div className="stats-usage-breakdown">
                    <span className="stats-usage-sent">↑ {formatBytes(router.tx_bytes || 0)}</span>
                    <span className="stats-usage-received">↓ {formatBytes(router.rx_bytes || 0)}</span>
                  </div>
                </div>
              </div>
            ))}
            
            <div ref={observerTarget} className="infinite-scroll-trigger">
              {loadingMore && <LoadingSpinner text="Loading more..." />}
              {!hasMore && displayedRouters.length > 0 && (
                <div className="end-of-list">All {routers.length} routers loaded</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Map Tab */}
      {activeTab === 'map' && (
        <div className="stats-content stats-map-content">
          <div className="stats-map-header">
            <span className="map-router-count">{routersWithLocation.length} routers with location data</span>
          </div>
          
          {routersWithLocation.length === 0 ? (
            <div className="no-location-message">
              <div className="no-location-icon">🗺️</div>
              <p>No routers have location data yet</p>
              <p className="no-location-hint">Location is determined from cell tower data</p>
            </div>
          ) : (
            <div className="stats-map-container">
              <MapContainer
                center={mapCenter}
                zoom={6}
                className="stats-map"
                style={{ height: '100%', width: '100%' }}
                zoomControl={true}
              >
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />
                
                {routersWithLocation.map((router) => {
                  const isOnline = ['online', 'Online', 1, '1'].includes(
                    router.current_status || router.current_state
                  );
                  const lat = parseFloat(router.latitude);
                  const lng = parseFloat(router.longitude);
                  
                  return (
                    <CircleMarker
                      key={router.router_id}
                      center={[lat, lng]}
                      radius={8}
                      pathOptions={{
                        fillColor: isOnline ? '#4ade80' : '#6b7280',
                        fillOpacity: 0.8,
                        color: isOnline ? '#4ade80' : '#6b7280',
                        weight: 2,
                      }}
                      eventHandlers={{
                        click: () => handleRouterClick(router.router_id)
                      }}
                    >
                      <Popup className="stats-map-popup">
                        <div className="map-popup-content">
                          <div className="map-popup-name">{router.name || `Router #${router.router_id}`}</div>
                          <div className={`map-popup-status ${isOnline ? 'online' : 'offline'}`}>
                            {isOnline ? '● Online' : '○ Offline'}
                          </div>
                          {router.clickup_location_task_name && (
                            <div className="map-popup-location">{router.clickup_location_task_name}</div>
                          )}
                          {router.operator && (
                            <div className="map-popup-operator">📶 {router.operator}</div>
                          )}
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            </div>
          )}
          
          <div className="map-legend">
            <div className="legend-item">
              <span className="legend-dot online"></span>
              <span>Online ({onlineCount})</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot offline"></span>
              <span>Offline ({offlineCount})</span>
            </div>
          </div>
        </div>
      )}

      {/* Network Tab */}
      {activeTab === 'network' && (
        <div className="stats-content">
          <div className="stats-section">
            <h2>📊 7-Day Network Usage</h2>
            
            {networkUsage.length === 0 ? (
              <div className="no-data-message">No network data available</div>
            ) : (
              <div className="network-chart">
                {networkUsage.slice(-7).map((day, index) => {
                  const maxBytes = Math.max(...networkUsage.map(d => d.total_bytes || 0));
                  const height = maxBytes > 0 ? ((day.total_bytes || 0) / maxBytes) * 100 : 0;
                  
                  return (
                    <div key={day.date || index} className="chart-bar-container">
                      <div className="chart-bar-wrapper">
                        <div 
                          className="chart-bar" 
                          style={{ height: `${Math.max(height, 5)}%` }}
                        >
                          <span className="chart-bar-value">{formatBytes(day.total_bytes || 0)}</span>
                        </div>
                      </div>
                      <span className="chart-bar-label">{formatDate(day.date)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="stats-section">
            <h2>📡 Network Summary</h2>
            <div className="network-summary">
              <div className="network-stat">
                <span className="network-stat-label">7-Day Total</span>
                <span className="network-stat-value">
                  {formatBytes(networkUsage.reduce((sum, d) => sum + (d.total_bytes || 0), 0))}
                </span>
              </div>
              <div className="network-stat">
                <span className="network-stat-label">Daily Average</span>
                <span className="network-stat-value">
                  {formatBytes(networkUsage.reduce((sum, d) => sum + (d.total_bytes || 0), 0) / Math.max(networkUsage.length, 1))}
                </span>
              </div>
              <div className="network-stat">
                <span className="network-stat-label">Active Routers</span>
                <span className="network-stat-value">{routers.filter(r => r.total_bytes > 0).length}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StatsPage;
