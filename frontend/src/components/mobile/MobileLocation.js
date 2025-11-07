import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const MobileLocation = ({ selectedRouter, onRouterUpdate }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (searchTerm.length >= 2) {
      searchProperties();
    } else {
      setSearchResults([]);
    }
  }, [searchTerm]);

  const searchProperties = async () => {
    try {
      setSearching(true);
      const response = await api.get('/clickup/properties/search', {
        params: { query: searchTerm }
      });
      setSearchResults(response.data.results || []);
    } catch (error) {
      console.error('Failed to search properties:', error);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleLinkLocation = async (property) => {
    if (!selectedRouter) {
      alert('No router selected');
      return;
    }

    if (!window.confirm(`Link router to:\n${property.name}?`)) {
      return;
    }

    try {
      setLinking(true);
      const response = await api.post('/clickup/link-location', {
        routerId: selectedRouter.router_id,
        locationTaskId: property.id,
        locationTaskName: property.name
      });

      if (response.data.success) {
        alert('Router linked to location successfully!');
        onRouterUpdate();
        setSearchTerm('');
        setSearchResults([]);
      }
    } catch (error) {
      console.error('Failed to link location:', error);
      alert('Failed to link location: ' + (error.response?.data?.error || error.message));
    } finally {
      setLinking(false);
    }
  };

  const handleUnlinkLocation = async () => {
    if (!selectedRouter) {
      return;
    }

    if (!window.confirm(`Unlink router from:\n${selectedRouter.clickup_location_task_name}?`)) {
      return;
    }

    try {
      setLinking(true);
      const response = await api.post('/clickup/unlink-location', {
        routerId: selectedRouter.router_id
      });

      if (response.data.success) {
        alert('Router unlinked from location!');
        onRouterUpdate();
      }
    } catch (error) {
      console.error('Failed to unlink location:', error);
      alert('Failed to unlink location: ' + (error.response?.data?.error || error.message));
    } finally {
      setLinking(false);
    }
  };

  if (!selectedRouter) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📍</div>
        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>No Router Selected</div>
        <div style={{ fontSize: '14px' }}>Go to Search tab to select a router</div>
      </div>
    );
  }

  return (
    <div>
      {selectedRouter.clickup_location_task_name ? (
        <div className="mobile-card">
          <div className="mobile-card-title">Current Location</div>
          <div style={{ padding: '16px', background: '#eff6ff', borderRadius: '8px', borderLeft: '3px solid #3b82f6', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: '#1e40af', marginBottom: '4px' }}>Installed At</div>
            <div style={{ fontWeight: 600, color: '#1e40af', fontSize: '16px' }}>
              📍 {selectedRouter.clickup_location_task_name}
            </div>
            {selectedRouter.location_linked_at && (
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '8px' }}>
                Linked: {new Date(selectedRouter.location_linked_at).toLocaleString()}
              </div>
            )}
          </div>

          <button
            className="mobile-button mobile-button-danger"
            onClick={handleUnlinkLocation}
            disabled={linking}
          >
            {linking ? '⏳ Unlinking...' : '🔗 Unlink Location'}
          </button>
        </div>
      ) : (
        <>
          <div className="mobile-card">
            <div className="mobile-card-title">Link to Location</div>
            <label className="mobile-label">Search for Property</label>
            <input
              type="text"
              className="mobile-input"
              placeholder="Enter property name or address..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searching && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                🔍 Searching...
              </div>
            )}
          </div>

          {searchResults.length > 0 && (
            <div className="mobile-card">
              <div className="mobile-card-title">
                {searchResults.length} propert{searchResults.length !== 1 ? 'ies' : 'y'} found
              </div>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {searchResults.map(property => (
                  <div
                    key={property.id}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      marginBottom: '8px',
                      border: '2px solid #e2e8f0'
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '15px' }}>
                      {property.name}
                    </div>
                    {property.address && (
                      <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '8px' }}>
                        📍 {property.address}
                      </div>
                    )}
                    <button
                      className="mobile-button mobile-button-primary"
                      onClick={() => handleLinkLocation(property)}
                      disabled={linking}
                      style={{ marginTop: '8px' }}
                    >
                      {linking ? '⏳ Linking...' : '🔗 Link to this Location'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {searchTerm.length >= 2 && searchResults.length === 0 && !searching && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
              <div style={{ fontSize: '14px' }}>No properties found</div>
            </div>
          )}

          {searchTerm.length < 2 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📍</div>
              <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Search for Property</div>
              <div style={{ fontSize: '14px' }}>Enter at least 2 characters to search</div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MobileLocation;
