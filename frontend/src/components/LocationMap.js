import React, { useEffect, useState, useCallback } from 'react';
import { getRouterLocationHistory } from '../services/api';

/**
 * LocationMap Component
 * Shows an interactive map with the router's location history based on cell tower data.
 * Uses OpenStreetMap tiles via Leaflet (loaded dynamically).
 * Displays distinct locations with start/end times and duration.
 */
export default function LocationMap({ routerId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [locationData, setLocationData] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);

  // Load location data
  const loadLocations = useCallback(async () => {
    if (!routerId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const res = await getRouterLocationHistory(routerId, { limit: 50 });
      setLocationData(res.data);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load location history:', err);
      setError('Failed to load location data');
      setLoading(false);
    }
  }, [routerId]);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  // Dynamically load Leaflet CSS and JS
  useEffect(() => {
    if (window.L) {
      setMapLoaded(true);
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    link.crossOrigin = '';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = '';
    script.onload = () => setMapLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapLoaded || !locationData?.locations?.length || loading) return;

    const L = window.L;
    const mapContainer = document.getElementById('router-location-map');
    if (!mapContainer) return;

    mapContainer.innerHTML = '';

    const currentLoc = locationData.current || locationData.locations[0];
    const { latitude, longitude, accuracy } = currentLoc;
    
    const map = L.map('router-location-map').setView([latitude, longitude], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(map);

    const getLocationColor = (index, total, isCurrent) => {
      if (isCurrent) return '#22c55e';
      const ratio = index / Math.max(total - 1, 1);
      const r = Math.round(59 + ratio * 100);
      const g = Math.round(130 + ratio * 60);
      const b = Math.round(246 - ratio * 100);
      return `rgb(${r}, ${g}, ${b})`;
    };

    const markers = [];
    locationData.locations.forEach((loc, idx) => {
      if (!loc.latitude || !loc.longitude) return;
      
      const color = getLocationColor(idx, locationData.locations.length, loc.is_current);
      const radius = loc.is_current ? 10 : 7;
      
      const marker = L.circleMarker([loc.latitude, loc.longitude], {
        color, fillColor: color,
        fillOpacity: loc.is_current ? 0.8 : 0.5,
        radius, weight: loc.is_current ? 3 : 2
      }).addTo(map);
      
      const startDate = (() => {
        const d = new Date(loc.started_at);
        return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString('en-GB');
      })();
      const endDate = loc.ended_at ? (() => {
        const d = new Date(loc.ended_at);
        return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString('en-GB');
      })() : 'Present';
      
      marker.bindPopup(`
        <div style="min-width: 180px;">
          <strong style="color: ${color};">${loc.is_current ? '📍 Current Location' : `Location #${locationData.locations.length - idx}`}</strong><br/>
          <hr style="margin: 4px 0; border-color: #e5e7eb;"/>
          <strong>From:</strong> ${startDate}<br/>
          <strong>To:</strong> ${endDate}<br/>
          <strong>Duration:</strong> ${loc.duration_readable}<br/>
          <hr style="margin: 4px 0; border-color: #e5e7eb;"/>
          <strong>Operator:</strong> ${loc.operator || 'Unknown'}<br/>
          <strong>Network:</strong> ${loc.network_type || 'Unknown'}<br/>
          ${loc.accuracy ? `<strong>Accuracy:</strong> ~${loc.accuracy}m<br/>` : ''}
          <small style="color: #9ca3af;">${loc.sample_count} sample${loc.sample_count !== 1 ? 's' : ''}</small>
        </div>
      `);
      
      marker.on('click', () => setSelectedLocation(loc));
      markers.push({ marker, loc });

      if (loc.is_current && accuracy && !isNaN(accuracy)) {
        L.circle([latitude, longitude], {
          color: '#22c55e', fillColor: '#22c55e',
          fillOpacity: 0.1, radius: parseInt(accuracy, 10)
        }).addTo(map);
      }
    });

    if (locationData.locations.length > 1) {
      const sortedLocs = [...locationData.locations].reverse();
      const pathPoints = sortedLocs.filter(loc => loc.latitude && loc.longitude).map(loc => [loc.latitude, loc.longitude]);
      
      if (pathPoints.length > 1) {
        L.polyline(pathPoints, { color: '#6366f1', weight: 2, opacity: 0.5, dashArray: '8, 8' }).addTo(map);
      }
    }

    if (markers.length > 1) {
      const bounds = L.latLngBounds(markers.map(m => [m.loc.latitude, m.loc.longitude]));
      map.fitBounds(bounds, { padding: [30, 30] });
    }

    if (markers.length > 0 && markers[0].loc.is_current) {
      markers[0].marker.openPopup();
      setSelectedLocation(markers[0].loc);
    }

    return () => map.remove();
  }, [mapLoaded, locationData, loading]);

  if (loading) {
    return (
      <div className="location-map-container" style={{ padding: '20px', textAlign: 'center' }}>
        <div className="loading-spinner" style={{ margin: '0 auto' }}></div>
        <p style={{ marginTop: '10px', color: '#6b7280' }}>Loading location history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="location-map-container" style={{ padding: '20px', textAlign: 'center' }}>
        <p style={{ color: '#ef4444' }}>⚠️ {error}</p>
      </div>
    );
  }

  if (!locationData?.locations?.length) {
    return (
      <div className="location-map-container" style={{ padding: '20px', textAlign: 'center' }}>
        <p style={{ color: '#6b7280' }}>📍 No location data available yet</p>
        <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '8px' }}>
          Location is determined from cell tower data and updates when the router moves.
        </p>
      </div>
    );
  }

  return (
    <div className="location-map-container">
      <div id="router-location-map" style={{ height: '400px', width: '100%', borderRadius: '8px', overflow: 'hidden' }} />
      
      <div style={{ marginTop: '12px', padding: '12px', background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '13px' }}>
        {selectedLocation ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div><span style={{ color: '#94a3b8' }}>Started:</span><br/><strong style={{ color: '#f1f5f9' }}>{(() => {
              const d = new Date(selectedLocation.started_at);
              return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString('en-GB');
            })()}</strong></div>
            <div><span style={{ color: '#94a3b8' }}>Ended:</span><br/><strong style={{ color: '#f1f5f9' }}>{selectedLocation.ended_at ? (() => {
              const d = new Date(selectedLocation.ended_at);
              return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString('en-GB');
            })() : '—'}</strong></div>
            <div><span style={{ color: '#94a3b8' }}>Duration:</span><br/><strong style={{ color: '#f1f5f9' }}>{selectedLocation.duration_readable}</strong></div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#94a3b8' }}>Click a location marker to see details</div>
        )}
      </div>

      {locationData.locations.length > 1 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#f1f5f9', marginBottom: '8px' }}>
            📍 Location History ({locationData.count} locations)
          </div>
          <div style={{ maxHeight: '150px', overflowY: 'auto', fontSize: '12px', border: '1px solid #334155', borderRadius: '8px', background: '#1e293b' }}>
            {locationData.locations.map((loc, idx) => (
              <div 
                key={loc.id}
                onClick={() => setSelectedLocation(loc)}
                style={{ 
                  padding: '8px 12px',
                  borderBottom: idx < locationData.locations.length - 1 ? '1px solid #334155' : 'none',
                  cursor: 'pointer',
                  background: selectedLocation?.id === loc.id ? '#1e3a5f' : 'transparent',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  color: '#f1f5f9'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: loc.is_current ? '#22c55e' : '#6366f1', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: loc.is_current ? '600' : '400' }}>{loc.is_current ? 'Current' : (() => {
                      const d = new Date(loc.started_at);
                      return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleDateString('en-GB');
                    })()}</div>
                    <div style={{ color: '#94a3b8', fontSize: '11px' }}>{loc.operator || 'Unknown'} • {loc.duration_readable}</div>
                  </div>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>{loc.sample_count} sample{loc.sample_count !== 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
