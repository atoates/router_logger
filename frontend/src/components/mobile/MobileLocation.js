import React, { useState } from 'react';
import { mobileFetch, API_BASE } from '../../utils/mobileApi';

const MobileLocation = ({ router }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [properties, setProperties] = useState([]);
  const [searching, setSearching] = useState(false);

  const searchProperties = async () => {
    if (searchTerm.length < 2) {
      alert('Please enter at least 2 characters');
      return;
    }

    try {
      setSearching(true);
      const response = await mobileFetch(`/api/clickup/properties/search?query=${encodeURIComponent(searchTerm)}`);
      
      console.log('Search response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Search error response:', errorText);
        throw new Error('Search failed');
      }
      
      const data = await response.json();
      console.log('Search results:', data);
      setProperties(data.properties || []);
    } catch (error) {
      console.error('Failed to search properties:', error);
      alert('Failed to search properties. Make sure you are connected to ClickUp.');
    } finally {
      setSearching(false);
    }
  };

  const handleLinkLocation = async (property) => {
    try {
      const response = await mobileFetch(`/api/routers/${router.router_id}/link-location`, {
        method: 'POST',
        body: JSON.stringify({
          locationTaskId: property.id,
          locationTaskName: property.name
        })
      });
      
      if (!response.ok) throw new Error('Failed to link location');
      
      alert('Location linked successfully!');
      window.location.reload();
    } catch (error) {
      console.error('Failed to link location:', error);
      alert('Failed to link location');
    }
  };

  const handleUnlinkLocation = async () => {
    try {
      const response = await mobileFetch(`/api/routers/${router.router_id}/unlink-location`, {
        method: 'POST'
      });
      
      if (!response.ok) throw new Error('Failed to unlink location');
      
      alert('Location unlinked successfully!');
      window.location.reload();
    } catch (error) {
      console.error('Failed to unlink location:', error);
      alert('Failed to unlink location');
    }
  };

  if (!router) {
    return <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>Select a router first</div>;
  }

  return (
    <div style={{ padding: '16px' }}>
      <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: '600' }}>
        {router.name || `Router #${router.router_id}`}
      </h2>
      
      {router.clickup_location_task_name && (
        <div style={{
          background: '#dcfce7',
          border: '1px solid #86efac',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '20px'
        }}>
          <div style={{ fontSize: '13px', color: '#166534', fontWeight: '600', marginBottom: '4px' }}>
            Current Location
          </div>
          <div style={{ fontSize: '16px', color: '#166534', fontWeight: '500', marginBottom: '12px' }}>
            📍 {router.clickup_location_task_name}
          </div>
          <button
            onClick={handleUnlinkLocation}
            style={{
              width: '100%',
              padding: '12px',
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Unlink Location
          </button>
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search for property..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && searchProperties()}
          style={{
            width: '100%',
            padding: '14px 16px',
            fontSize: '16px',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            marginBottom: '12px',
            boxSizing: 'border-box'
          }}
        />
        <button
          onClick={searchProperties}
          disabled={searching || searchTerm.length < 2}
          style={{
            width: '100%',
            padding: '14px',
            background: searchTerm.length < 2 ? '#e5e7eb' : '#2563eb',
            color: searchTerm.length < 2 ? '#9ca3af' : '#fff',
            border: 'none',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: searchTerm.length < 2 ? 'not-allowed' : 'pointer'
          }}
        >
          {searching ? 'Searching...' : 'Search Properties'}
        </button>
      </div>

      {properties.length > 0 && (
        <div>
          <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
            {properties.length} propert{properties.length !== 1 ? 'ies' : 'y'} found
          </div>
          {properties.map(property => (
            <div
              key={property.id}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '12px'
              }}
            >
              <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px' }}>
                {property.name}
              </div>
              {property.custom_fields?.Address && (
                <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
                  {property.custom_fields.Address}
                </div>
              )}
              <button
                onClick={() => handleLinkLocation(property)}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#10b981',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '15px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Link to This Location
              </button>
            </div>
          ))}
        </div>
      )}

      {searchTerm && properties.length === 0 && !searching && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#6b7280' }}>
          No properties found. Try a different search term.
        </div>
      )}
    </div>
  );
};

export default MobileLocation;
