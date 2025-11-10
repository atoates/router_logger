import React, { useState, useEffect } from 'react';
import { getRouters, assignRouter, removeRouterAssignees } from '../../services/api';
import { mobileFetch, API_BASE } from '../../utils/mobileApi';

const MobileSearch = ({ onSelectRouter, selectedRouter }) => {
  const [routers, setRouters] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    loadRouters();
    
    // Auto-refresh every 30 seconds for installers to see new routers quickly
    const interval = setInterval(() => {
      loadRouters();
    }, 30000); // 30 seconds
    
    return () => clearInterval(interval);
  }, []);

  const loadRouters = async () => {
    try {
      setLoading(true);
      const response = await getRouters();
      setRouters(response.data || []);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to load routers:', error);
    } finally {
      setLoading(false);
    }
  };

  const [expandedStatus, setExpandedStatus] = useState(null);

  const filteredRouters = routers.filter(router => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      router.name?.toLowerCase().includes(search) ||
      router.router_id?.toString().includes(search) ||
      router.imei?.toLowerCase().includes(search)
    );
  });

  // Group routers by status
  const groupedRouters = filteredRouters.reduce((acc, router) => {
    const status = router.clickup_task_status || 'unknown';
    if (!acc[status]) {
      acc[status] = [];
    }
    acc[status].push(router);
    return acc;
  }, {});

  const getStatusColor = (status) => {
    const statusLower = status?.toLowerCase() || '';
    if (statusLower === 'installed' || statusLower === 'ready') return { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' };
    if (statusLower === 'needs attention') return { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' };
    if (statusLower === 'being returned') return { bg: '#ffedd5', border: '#f97316', text: '#9a3412' };
    if (statusLower === 'decommissioned') return { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' };
    return { bg: '#f3f4f6', border: '#9ca3af', text: '#4b5563' };
  };

  const hasAssignees = (router) => {
    try {
      if (!router.clickup_assignees) return false;
      const assignees = JSON.parse(router.clickup_assignees);
      return Array.isArray(assignees) && assignees.length > 0;
    } catch (e) {
      console.error('Failed to parse assignees for router', router.router_id, e);
      return false;
    }
  };

  const handleAssignToMe = async (router) => {
    try {
      const userResponse = await mobileFetch(`/api/clickup/current-user`);
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

  const handleUninstall = async (router) => {
    // eslint-disable-next-line no-restricted-globals
    if (!confirm(`Uninstall router from ${router.clickup_location_task_name}?`)) return;
    
    try {
      const response = await mobileFetch(`/api/routers/${router.router_id}/unlink-location`, {
        method: 'POST'
      });
      
      if (!response.ok) throw new Error('Failed to uninstall');
      
      alert('Router uninstalled successfully!');
      loadRouters();
    } catch (error) {
      console.error('Failed to uninstall:', error);
      alert('Failed to uninstall router');
    }
  };

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Loading routers...</div>;
  }

  return (
    <div style={{ padding: '16px' }}>
      {/* Last Updated Indicator */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        background: '#f0f9ff',
        border: '1px solid #bae6fd',
        borderRadius: '8px',
        marginBottom: '12px',
        fontSize: '12px',
        color: '#0c4a6e'
      }}>
        <span>🔄 Auto-refreshing every 30s</span>
        <span>Updated {Math.round((new Date() - lastUpdated) / 1000)}s ago</span>
      </div>
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

      {Object.entries(groupedRouters).map(([status, statusRouters]) => {
        const statusColors = getStatusColor(status);
        const isExpanded = expandedStatus === status;
        
        return (
          <div key={status} style={{ marginBottom: '12px' }}>
            {/* Status Header - Clickable Dropdown */}
            <div
              onClick={() => setExpandedStatus(isExpanded ? null : status)}
              style={{
                background: statusColors.bg,
                border: `2px solid ${statusColors.border}`,
                borderRadius: '12px',
                padding: '14px 16px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: isExpanded ? '8px' : '0'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px', fontWeight: '700', color: statusColors.text }}>
                  {status}
                </span>
                <span style={{ 
                  padding: '2px 8px', 
                  borderRadius: '10px', 
                  fontSize: '12px', 
                  fontWeight: '600',
                  background: 'rgba(255,255,255,0.6)',
                  color: statusColors.text
                }}>
                  {statusRouters.length}
                </span>
              </div>
              <span style={{ fontSize: '14px', color: statusColors.text }}>
                {isExpanded ? '▼' : '▶'}
              </span>
            </div>

            {/* Router Cards - Only show when expanded */}
            {isExpanded && statusRouters.map(router => {
              const isOnline = router.current_status === 'online';
              const isSelected = selectedRouter?.router_id === router.router_id;
              
              return (
                <div
                  key={router.router_id}
                  onClick={() => onSelectRouter(router)}
                  style={{
                    background: isSelected ? '#eff6ff' : '#fff',
                    border: `2px solid ${isSelected ? '#2563eb' : '#e5e7eb'}`,
                    borderLeft: `4px solid ${statusColors.border}`,
                    borderRadius: '12px',
                    padding: '16px',
                    marginBottom: '8px',
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

                  {hasAssignees(router) && (
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
                      {/* Assignment buttons */}
                      {!hasAssignees(router) ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAssignToMe(router);
                          }}
                          style={{
                            flex: '1 1 45%',
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
                            flex: '1 1 45%',
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
                      
                      {/* Install/Uninstall button */}
                      {router.clickup_location_task_name ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUninstall(router);
                          }}
                          style={{
                            flex: '1 1 45%',
                            padding: '10px 16px',
                            background: '#f59e0b',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer'
                          }}
                        >
                          📍 Uninstall
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            alert('Go to Location tab to install this router');
                          }}
                          style={{
                            flex: '1 1 45%',
                            padding: '10px 16px',
                            background: '#10b981',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer'
                          }}
                        >
                          📍 Install
                        </button>
                      )}
                      
                      {router.clickup_task_url && (
                        <a
                          href={router.clickup_task_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            flex: '1 1 100%',
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
                          <img 
                            src="https://clickup.com/images/for-se-page/clickup.png" 
                            alt="ClickUp" 
                            style={{ width: '18px', height: '18px' }}
                          />
                          View in ClickUp
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
