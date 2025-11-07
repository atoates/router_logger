import React, { useState } from 'react';
import api from '../../services/api';

const MobileSearch = ({ routers, selectedRouter, onRouterSelect, onRouterUpdate }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [assigning, setAssigning] = useState(false);

  const filteredRouters = routers.filter(router => {
    const search = searchTerm.toLowerCase();
    return (
      router.router_id?.toLowerCase().includes(search) ||
      router.name?.toLowerCase().includes(search) ||
      router.imei?.toLowerCase().includes(search)
    );
  });

  const handleAssignToMe = async () => {
    if (!selectedRouter?.clickup_task_id) {
      alert('Router not linked to ClickUp');
      return;
    }

    // Get current user from ClickUp auth
    try {
      setAssigning(true);
      
      const authResponse = await api.get('/clickup/auth/status');
      if (!authResponse.data.authorized || !authResponse.data.user) {
        alert('Please connect to ClickUp first');
        return;
      }

      const userId = authResponse.data.user.id;
      const username = authResponse.data.user.username;

      // Assign the router
      const response = await api.post(`/routers/${selectedRouter.router_id}/assign`, {
        userId: userId
      });

      if (response.data.success) {
        alert(`Router assigned to ${username}!`);
        onRouterUpdate();
      }
    } catch (error) {
      console.error('Failed to assign router:', error);
      alert('Failed to assign router: ' + (error.response?.data?.error || error.message));
    } finally {
      setAssigning(false);
    }
  };

  const handleRemoveAssignment = async () => {
    if (!selectedRouter?.clickup_task_id) {
      alert('Router not linked to ClickUp');
      return;
    }

    if (!window.confirm('Remove assignment from this router?')) {
      return;
    }

    try {
      setAssigning(true);
      const response = await api.post(`/routers/${selectedRouter.router_id}/remove-assignees`);
      
      if (response.data.success) {
        alert('Assignment removed!');
        onRouterUpdate();
      }
    } catch (error) {
      console.error('Failed to remove assignment:', error);
      alert('Failed to remove assignment: ' + (error.response?.data?.error || error.message));
    } finally {
      setAssigning(false);
    }
  };

  const getRouterStatus = (router) => {
    const isOnline = router.current_status === 'online' || router.current_status === 1 || router.current_status === '1';
    return isOnline ? 'online' : 'offline';
  };

  const getAssigneeName = (router) => {
    try {
      if (router.clickup_assignees) {
        const assignees = JSON.parse(router.clickup_assignees);
        if (assignees && assignees.length > 0) {
          return assignees[0].username || assignees[0].email || 'Unknown';
        }
      }
    } catch (e) {
      console.error('Failed to parse assignees:', e);
    }
    return null;
  };

  return (
    <div>
      <div className="mobile-card">
        <input
          type="text"
          className="mobile-input"
          placeholder="Search by name, ID, or IMEI..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          autoFocus
        />
      </div>

      {searchTerm && (
        <div className="mobile-card">
          <div className="mobile-card-title">
            {filteredRouters.length} router{filteredRouters.length !== 1 ? 's' : ''} found
          </div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {filteredRouters.map(router => (
              <div
                key={router.router_id}
                onClick={() => onRouterSelect(router)}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  background: selectedRouter?.router_id === router.router_id ? '#f5f3ff' : '#f8fafc',
                  marginBottom: '8px',
                  cursor: 'pointer',
                  border: selectedRouter?.router_id === router.router_id ? '2px solid #7c3aed' : '2px solid transparent'
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  {router.name || `Router #${router.router_id}`}
                </div>
                <div style={{ fontSize: '13px', color: '#64748b' }}>
                  ID: {router.router_id}
                </div>
                <div style={{ marginTop: '6px' }}>
                  <span className={`mobile-status-badge mobile-status-${getRouterStatus(router)}`}>
                    {getRouterStatus(router) === 'online' ? '● Online' : '○ Offline'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedRouter && (
        <div className="mobile-card">
          <div className="mobile-card-title">Router Details</div>
          
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>Router ID</div>
            <div style={{ fontWeight: 600 }}>{selectedRouter.router_id}</div>
          </div>

          {selectedRouter.imei && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>IMEI</div>
              <div style={{ fontWeight: 600 }}>{selectedRouter.imei}</div>
            </div>
          )}

          {selectedRouter.last_seen && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>Last Seen</div>
              <div style={{ fontWeight: 600 }}>{new Date(selectedRouter.last_seen).toLocaleString()}</div>
            </div>
          )}

          {getAssigneeName(selectedRouter) && (
            <div style={{ marginBottom: '16px', padding: '12px', background: '#f0fdf4', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
              <div style={{ fontSize: '13px', color: '#065f46', marginBottom: '4px' }}>Assigned To</div>
              <div style={{ fontWeight: 600, color: '#065f46' }}>👤 {getAssigneeName(selectedRouter)}</div>
            </div>
          )}

          {selectedRouter.clickup_location_task_name && (
            <div style={{ marginBottom: '16px', padding: '12px', background: '#eff6ff', borderRadius: '8px', borderLeft: '3px solid #3b82f6' }}>
              <div style={{ fontSize: '13px', color: '#1e40af', marginBottom: '4px' }}>Installed At</div>
              <div style={{ fontWeight: 600, color: '#1e40af' }}>📍 {selectedRouter.clickup_location_task_name}</div>
            </div>
          )}
        </div>
      )}

      {selectedRouter && selectedRouter.clickup_task_id && (
        <div className="mobile-card">
          <div className="mobile-card-title">Quick Actions</div>
          
          {getAssigneeName(selectedRouter) ? (
            <button
              className="mobile-button mobile-button-secondary"
              onClick={handleRemoveAssignment}
              disabled={assigning}
              style={{ marginBottom: '12px' }}
            >
              {assigning ? '⏳ Removing...' : '🗑️ Remove Assignment'}
            </button>
          ) : (
            <button
              className="mobile-button mobile-button-primary"
              onClick={handleAssignToMe}
              disabled={assigning}
              style={{ marginBottom: '12px' }}
            >
              {assigning ? '⏳ Assigning...' : '👤 Assign to Me'}
            </button>
          )}

          <a
            href={selectedRouter.clickup_task_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mobile-button mobile-button-secondary"
            style={{ textDecoration: 'none', display: 'flex' }}
          >
            🔗 View in ClickUp
          </a>
        </div>
      )}

      {!selectedRouter && !searchTerm && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Search for a Router</div>
          <div style={{ fontSize: '14px' }}>Enter router name, ID, or IMEI above</div>
        </div>
      )}
    </div>
  );
};

export default MobileSearch;
