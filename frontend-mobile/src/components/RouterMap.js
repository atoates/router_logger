import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './RouterMap.css';

// Fix for default marker icons in React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom router marker icon
const createRouterIcon = (isOnline) => {
  const color = isOnline ? '#4ade80' : '#f87171';
  const pulseColor = isOnline ? 'rgba(74, 222, 128, 0.4)' : 'rgba(248, 113, 113, 0.4)';
  
  return L.divIcon({
    className: 'custom-router-marker',
    html: `
      <div class="router-marker-container">
        <div class="router-marker-pulse" style="background: ${pulseColor}"></div>
        <div class="router-marker-core" style="background: ${color}; border-color: ${color}">
          <svg viewBox="0 0 24 24" fill="white" width="16" height="16">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 1.74.5 3.37 1.41 4.84.95 1.54 2.2 2.86 3.16 4.4.47.75.81 1.45 1.17 2.26.26.6.47 1.19.67 1.79.11.33.37.71.59.71s.48-.38.59-.71c.2-.6.41-1.19.67-1.79.36-.81.7-1.51 1.17-2.26.96-1.54 2.21-2.86 3.16-4.4C18.5 12.37 19 10.74 19 9c0-3.87-3.13-7-7-7zm0 9.75c-1.52 0-2.75-1.23-2.75-2.75S10.48 6.25 12 6.25s2.75 1.23 2.75 2.75-1.23 2.75-2.75 2.75z"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40],
  });
};

// History marker (smaller, for trail)
const createHistoryIcon = (index, total) => {
  const opacity = 0.3 + (0.7 * (index / total));
  return L.divIcon({
    className: 'history-marker',
    html: `<div class="history-dot" style="opacity: ${opacity}"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
};

// Component to handle map view updates
function MapController({ center, zoom }) {
  const map = useMap();
  
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.flyTo(center, zoom, { duration: 1 });
    }
  }, [map, center, zoom]);
  
  return null;
}

function RouterMap({ 
  router, 
  locationHistory = [], 
  isOnline = false,
  showHistory = true,
  height = '250px',
  onExpand 
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Get current location from router data
  const currentLat = router?.latitude ? parseFloat(router.latitude) : null;
  const currentLng = router?.longitude ? parseFloat(router.longitude) : null;
  const hasLocation = currentLat && currentLng && !isNaN(currentLat) && !isNaN(currentLng);
  
  // Default to London if no location
  const center = hasLocation ? [currentLat, currentLng] : [51.5074, -0.1278];
  const zoom = hasLocation ? 15 : 10;
  
  // Format location accuracy
  const accuracy = router?.location_accuracy || 'Cell Tower';
  
  // Format last update time
  const formatTime = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const handleExpand = () => {
    setIsExpanded(!isExpanded);
    if (onExpand) onExpand(!isExpanded);
  };

  if (!hasLocation) {
    return (
      <div className="router-map-container router-map-no-location">
        <div className="no-location-content">
          <div className="no-location-icon">📍</div>
          <p className="no-location-text">No location data available</p>
          <p className="no-location-hint">Location is determined from cell tower data when the router connects</p>
        </div>
      </div>
    );
  }

  // Prepare history trail
  const historyPoints = locationHistory
    .filter(loc => loc.latitude && loc.longitude)
    .map(loc => [parseFloat(loc.latitude), parseFloat(loc.longitude)]);

  return (
    <div className={`router-map-container ${isExpanded ? 'expanded' : ''}`} style={{ height: isExpanded ? '400px' : height }}>
      <MapContainer
        center={center}
        zoom={zoom}
        className="router-map"
        zoomControl={false}
        attributionControl={false}
      >
        {/* Dark theme map tiles */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        
        <MapController center={center} zoom={zoom} />
        
        {/* Accuracy circle */}
        <Circle
          center={center}
          radius={500}
          pathOptions={{
            color: isOnline ? '#4ade80' : '#f87171',
            fillColor: isOnline ? '#4ade80' : '#f87171',
            fillOpacity: 0.1,
            weight: 1,
            dashArray: '5, 5',
          }}
        />
        
        {/* History trail */}
        {showHistory && historyPoints.length > 1 && (
          <>
            <Polyline
              positions={historyPoints}
              pathOptions={{
                color: '#6366f1',
                weight: 2,
                opacity: 0.5,
                dashArray: '10, 10',
              }}
            />
            {historyPoints.slice(0, -1).map((point, index) => (
              <Marker
                key={index}
                position={point}
                icon={createHistoryIcon(index, historyPoints.length)}
              />
            ))}
          </>
        )}
        
        {/* Current location marker */}
        <Marker position={center} icon={createRouterIcon(isOnline)}>
          <Popup className="router-popup">
            <div className="popup-content">
              <div className="popup-header">
                <span className={`popup-status ${isOnline ? 'online' : 'offline'}`}>
                  {isOnline ? '● Online' : '○ Offline'}
                </span>
              </div>
              <div className="popup-name">{router?.name || `Router #${router?.router_id}`}</div>
              <div className="popup-coords">
                {currentLat.toFixed(6)}, {currentLng.toFixed(6)}
              </div>
              <div className="popup-meta">
                <span>📡 {accuracy}</span>
                <span>🕐 {formatTime(router?.last_seen)}</span>
              </div>
              {router?.operator && (
                <div className="popup-operator">📶 {router.operator}</div>
              )}
            </div>
          </Popup>
        </Marker>
      </MapContainer>
      
      {/* Map overlay controls */}
      <div className="map-overlay">
        <div className="map-status-pill">
          <span className={`status-dot ${isOnline ? 'online' : 'offline'}`}></span>
          <span>{accuracy}</span>
        </div>
        <button className="map-expand-btn" onClick={handleExpand}>
          {isExpanded ? '↙' : '↗'}
        </button>
      </div>
      
      {/* Location info bar */}
      <div className="map-info-bar">
        <div className="info-coords">
          <span className="coord-icon">📍</span>
          <span>{currentLat.toFixed(4)}, {currentLng.toFixed(4)}</span>
        </div>
        <div className="info-time">
          {formatTime(router?.last_seen)}
        </div>
      </div>
    </div>
  );
}

export default RouterMap;

