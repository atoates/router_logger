import React, { useState, useEffect } from 'react';
import { getRouters, assignRouter, removeRouterAssignees } from '../../services/api';

const MobileSearch = ({ onSelectRouter, selectedRouter }) => {
  const [routers, setRouters] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRouters();
  }, []);

  const loadRouters = async () => {
    try {
      setLoading(true);
      const response = await getRouters();
      setRouters(response.data || []);
    } catch (error) {
      console.error('Failed to load routers:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredRouters = routers.filter(router => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      router.name?.toLowerCase().includes(search) ||
      router.router_id?.toString().includes(search) ||
      router.imei?.toLowerCase().includes(search)
    );
  });

  const handleAssignToMe = async (router) => {
    try {
      const userResponse = await fetch('/api/clickup/current-user', {
        credentials: 'include'
      });
      if (!userResponse.ok) {
        alert('Please connect to ClickUp first');
        return;
      }
      const userData = await userResponse.json();
      await assignRouter(router.router_id, userData.id);
      alert('Router assigned to you!');
      loadRouters();
    } catch (error) {
      console.error('Failed to assign router:', error);
      alert('Failed to assign router');
    }
  };

  const handleRemoveAssignment = async (router) => {
    try {
      await removeRouterAssignees(router.router_id);
      alert('Assignment removed!');
      loadRouters();
    } catch (error) {
      console.error('Failed to remove assignment:', error);
      alert('Failed to remove assignment');
    }
  };

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Loading routers...</div>;
  }

  return (
    <div style={{ padding: '16px' }}>
      <input
        type="text"
        placeholder="Search router name, ID, or IMEI..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        style={{
          width: '100%',
          padding: '14px 16px',
          fontSize: '16px',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          marginBottom: '16px',
          boxSizing: 'border-box'
        }}
      />

      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
        {filteredRouters.length} router{filteredRouters.length !== 1 ? 's' : ''} found
      </div>

      {filteredRouters.map(router => {
        const isOnline = router.current_status === 'online';
        const isSelected = selectedRouter?.router_id === router.router_id;
        
        return (
          <div
            key={router.router_id}
            onClick={() => onSelectRouter(router)}
            style={{
              background: isSelected ? '#eff6ff' : '#fff',
              border: `2px solid ${isSelected ? '#2563eb' : '#e5e7eb'}`,
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '12px',
              cursor: 'pointer'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <div style={{ fontSize: '17px', fontWeight: '600', color: '#111827' }}>
                {router.name || `Router #${router.router_id}`}
              </div>
              <div style={{
                padding: '4px 10px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: '600',
                background: isOnline ? '#dcfce7' : '#fee2e2',
                color: isOnline ? '#166534' : '#991b1b'
              }}>
                {isOnline ? 'Online' : 'Offline'}
              </div>
            </div>

            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
              ID: {router.router_id} • IMEI: {router.imei || 'N/A'}
            </div>

            {router.clickup_assignees && JSON.parse(router.clickup_assignees).length > 0 && (
              <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
                👤 Assigned
              </div>
            )}

            {router.clickup_location_task_name && (
              <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
                📍 {router.clickup_location_task_name}
              </div>
            )}

            <div style={{ fontSize: '12px', color: '#9ca3af' }}>
              Last seen: {router.last_seen ? new Date(router.last_seen).toLocaleString() : 'Never'}
            </div>

            {isSelected && (
              <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(!router.clickup_assignees || JSON.parse(router.clickup_assignees).length === 0) ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAssignToMe(router);
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: '#2563eb',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Assign to Me
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveAssignment(router);
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: '#dc2626',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Remove Assignment
                  </button>
                )}
                
                {router.clickup_task_url && (
                  <a
                    href={router.clickup_task_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: '#f3f4f6',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      textAlign: 'center',
                      textDecoration: 'none'
                    }}
                  >
                    View in ClickUp
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}

      {filteredRouters.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#6b7280' }}>
          No routers found
        </div>
      )}
    </div>
  );
};

export default MobileSearch;
