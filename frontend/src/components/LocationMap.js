import React, { useEffect, useState } from 'react';
import { getRouterGeoLocation } from '../services/api';

/**
 * LocationMap Component
 * Shows an interactive map with the router's approximate location based on cell tower data.
 * Uses OpenStreetMap tiles via Leaflet (loaded dynamically).
 */
export default function LocationMap({ routerId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [locationData, setLocationData] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Load location data
  useEffect(() => {
    if (!routerId) return;
    
    setLoading(true);
    setError(null);
    
    getRouterGeoLocation(routerId, 30)
      .then(res => {
        setLocationData(res.data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load geo location:', err);
        setError('Failed to load location data');
        setLoading(false);
      });
  }, [routerId]);

  // Dynamically load Leaflet CSS and JS
  useEffect(() => {
    // Check if already loaded
    if (window.L) {
      setMapLoaded(true);
      return;
    }

    // Load Leaflet CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    link.crossOrigin = '';
    document.head.appendChild(link);

    // Load Leaflet JS
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = '';
    script.onload = () => setMapLoaded(true);
    document.head.appendChild(script);

    return () => {
      // Cleanup not strictly necessary for CDN resources
    };
  }, []);

  // Initialize map when both data and Leaflet are ready
  useEffect(() => {
    if (!mapLoaded || !locationData?.current || loading) return;

    const L = window.L;
    const mapContainer = document.getElementById('router-location-map');
    
    if (!mapContainer) return;

    // Clear any existing map
    mapContainer.innerHTML = '';

    const { latitude, longitude, accuracy } = locationData.current;
    
    // Initialize map
    const map = L.map('router-location-map').setView([latitude, longitude], 14);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);

    // Add marker for current location
    const marker = L.marker([latitude, longitude]).addTo(map);
    marker.bindPopup(`
      <strong>Approximate Location</strong><br/>
      <small>Based on cell tower data</small><br/>
      Accuracy: ~${accuracy}m<br/>
      Operator: ${locationData.current.operator || 'Unknown'}<br/>
      Network: ${locationData.current.network_type || 'Unknown'}
    `).openPopup();

    // Add accuracy circle
    if (accuracy && !isNaN(accuracy)) {
      L.circle([latitude, longitude], {
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.15,
        radius: parseInt(accuracy, 10)
      }).addTo(map);
    }

    // Add markers for location history (if available)
    if (locationData.history && locationData.history.length > 1) {
      // Create path from history
      const historyPoints = locationData.history
        .filter(h => h.latitude && h.longitude)
        .map(h => [h.latitude, h.longitude]);
      
      if (historyPoints.length > 1) {
        L.polyline(historyPoints, {
          color: '#6366f1',
          weight: 2,
          opacity: 0.6,
          dashArray: '5, 10'
        }).addTo(map);
      }

      // Add small circles for history points
      locationData.history.slice(1).forEach((loc, idx) => {
        if (!loc.latitude || !loc.longitude) return;
        L.circleMarker([loc.latitude, loc.longitude], {
          color: '#6366f1',
          fillColor: '#6366f1',
          fillOpacity: 0.4,
          radius: 4
        }).addTo(map).bindPopup(`
          <small>${new Date(loc.timestamp).toLocaleString()}</small><br/>
          ${loc.operator || 'Unknown'} (${loc.network_type || '?'})
        `);
      });
    }

    // Cleanup on unmount
    return () => {
      map.remove();
    };
  }, [mapLoaded, locationData, loading]);

  if (loading) {
    return (
      <div className="location-map-container" style={{ padding: '20px', textAlign: 'center' }}>
        <div className="loading-spinner" style={{ margin: '0 auto' }}></div>
        <p style={{ marginTop: '10px', color: '#6b7280' }}>Loading location data...</p>
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

  if (!locationData?.current) {
    return (
      <div className="location-map-container" style={{ padding: '20px', textAlign: 'center' }}>
        <p style={{ color: '#6b7280' }}>📍 No location data available yet</p>
        <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '8px' }}>
          Location is determined from cell tower data and updates every 24 hours.
        </p>
      </div>
    );
  }

  return (
    <div className="location-map-container">
      <div 
        id="router-location-map" 
        style={{ 
          height: '400px', 
          width: '100%', 
          borderRadius: '8px',
          overflow: 'hidden'
        }}
      />
      <div style={{ 
        marginTop: '12px', 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '12px',
        color: '#6b7280'
      }}>
        <div>
          <strong>Last Updated:</strong> {new Date(locationData.current.timestamp).toLocaleString()}
        </div>
        <div>
          <strong>Accuracy:</strong> ~{locationData.current.accuracy || '?'}m
        </div>
        <div>
          <strong>Signal:</strong> {locationData.current.rsrp || locationData.current.rssi || '?'} dBm
        </div>
      </div>
      {locationData.count > 1 && (
        <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '8px', textAlign: 'center' }}>
          Showing {locationData.count} location samples. Dashed line shows movement history.
        </p>
      )}
    </div>
  );
}
