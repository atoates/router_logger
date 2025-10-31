import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { toast } from 'react-toastify';
import './PropertySearchWidget.css';

const API_BASE = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';

const PropertySearchWidget = forwardRef(({ router, onAssigned }, ref) => {
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [currentProperty, setCurrentProperty] = useState(null);
  const [currentStorage, setCurrentStorage] = useState(null);
  const [propertyHistory, setPropertyHistory] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showStoredWithModal, setShowStoredWithModal] = useState(false);
  const [selectedAssignees, setSelectedAssignees] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [spaceId, setSpaceId] = useState(null);

  const routerId = router?.router_id;

  // Get workspace and Active Accounts space on mount
  useEffect(() => {
    const getWorkspaceInfo = async () => {
      try {
        const authRes = await fetch(`${API_BASE}/api/clickup/auth/status`);
        const authData = await authRes.json();
        
        if (authData.authorized && authData.workspace) {
          setWorkspaceId(authData.workspace.workspace_id);
          
          // Get spaces to find Active Accounts
          const spacesRes = await fetch(`${API_BASE}/api/clickup/spaces/${authData.workspace.workspace_id}`);
          const spacesData = await spacesRes.json();
          
          const activeAccounts = spacesData.spaces?.find(s => s.name === 'Active Accounts');
          if (activeAccounts) {
            setSpaceId(activeAccounts.id);
          }
        }
      } catch (error) {
        console.error('Error getting workspace info:', error);
      }
    };

    getWorkspaceInfo();
  }, []);

  // Load current property assignment and history
  useEffect(() => {
    const loadPropertyData = async () => {
      if (!routerId) return;
      
      try {
        // Load current property
        const currentRes = await fetch(`${API_BASE}/api/router-properties/${routerId}/current`);
        const currentData = await currentRes.json();
        
        if (currentData.assigned) {
          setCurrentProperty({
            id: currentData.property_clickup_task_id,
            name: currentData.property_name,
            installedAt: currentData.installed_at,
            installedBy: currentData.installed_by,
            daysSinceInstalled: currentData.daysSinceInstalled
          });
        } else {
          setCurrentProperty(null);
        }

        // Load current storage
        const storageRes = await fetch(`${API_BASE}/api/router-properties/${routerId}/current-storage`);
        const storageData = await storageRes.json();
        
        if (storageData.stored) {
          setCurrentStorage({
            storedWithUserId: storageData.stored_with_user_id,
            storedWithUsername: storageData.stored_with_username,
            storedAt: storageData.installed_at,
            daysSinceStored: storageData.daysSinceStored
          });
        } else {
          setCurrentStorage(null);
        }

        // Load property history
        const historyRes = await fetch(`${API_BASE}/api/router-properties/${routerId}/history`);
        const historyData = await historyRes.json();
        setPropertyHistory(Array.isArray(historyData.history) ? historyData.history : []);
      } catch (error) {
        console.error('Error loading property data:', error);
      }
    };

    loadPropertyData();
  }, [routerId]);

  // Search with debounce
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      if (!workspaceId) return;
      
      setSearching(true);
      try {
        // Try space search first (Active Accounts), fall back to workspace search
        const searchUrl = spaceId 
          ? `${API_BASE}/api/router-properties/search-properties/${spaceId}?search=${encodeURIComponent(searchQuery)}`
          : `${API_BASE}/api/router-properties/search-all/${workspaceId}?search=${encodeURIComponent(searchQuery)}`;
        
        const res = await fetch(searchUrl);
        const data = await res.json();
        
        const results = data.properties || data.tasks || [];
        setSearchResults(results);
        setShowDropdown(true);
      } catch (error) {
        console.error('Error searching properties:', error);
        toast.error('Failed to search properties');
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchQuery, workspaceId, spaceId]);

  const moveToNewProperty = useCallback(async (propertyId, propertyName) => {
    if (!routerId) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/router-properties/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routerId,
          newPropertyTaskId: propertyId,
          newPropertyName: propertyName,
          movedBy: 'Dashboard User',
          notes: 'Moved via dashboard'
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setCurrentProperty({
          id: data.assignment.property_clickup_task_id,
          name: data.assignment.property_name,
          installedAt: data.assignment.installed_at,
          installedBy: data.assignment.installed_by,
          daysSinceInstalled: 0
        });
        
        // Reload history to show the old property
        const historyRes = await fetch(`${API_BASE}/api/router-properties/${routerId}/history`);
        const historyData = await historyRes.json();
        setPropertyHistory(Array.isArray(historyData.history) ? historyData.history : []);
        
        setSearchQuery('');
        setShowDropdown(false);
        toast.success(`Router moved to ${data.assignment.property_name}`);
        
        if (onAssigned) onAssigned(data.assignment);
      } else {
        toast.error(data.error || 'Failed to move property');
      }
    } catch (error) {
      console.error('Error moving property:', error);
      toast.error('Failed to move property');
    } finally {
      setLoading(false);
    }
  }, [routerId, onAssigned]);

  const assignProperty = useCallback(async (propertyId, propertyName) => {
    if (!routerId) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/router-properties/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routerId,
          propertyTaskId: propertyId,
          propertyName,
          installedBy: 'Dashboard User',
          notes: 'Assigned via dashboard'
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setCurrentProperty({
          id: data.assignment.property_clickup_task_id,
          name: data.assignment.property_name,
          installedAt: data.assignment.installed_at,
          installedBy: data.assignment.installed_by,
          daysSinceInstalled: 0
        });
        
        // Reload history in case there was previous history
        const historyRes = await fetch(`${API_BASE}/api/router-properties/${routerId}/history`);
        const historyData = await historyRes.json();
        setPropertyHistory(Array.isArray(historyData.history) ? historyData.history : []);
        
        setSearchQuery('');
        setShowDropdown(false);
        toast.success(`Router assigned to ${data.assignment.property_name}`);
        
        if (onAssigned) onAssigned(data.assignment);
      } else {
        toast.error(data.error || 'Failed to assign property');
      }
    } catch (error) {
      console.error('Error assigning property:', error);
      toast.error('Failed to assign property');
    } finally {
      setLoading(false);
    }
  }, [routerId, onAssigned]);

  const removeProperty = useCallback(async () => {
    if (!routerId || !currentProperty) return;

    if (!window.confirm(`Remove router from ${currentProperty.name}?`)) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/router-properties/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routerId,
          removedBy: 'Dashboard User',
          notes: 'Removed via dashboard'
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setCurrentProperty(null);
        
        // Reload history to show the removed property
        const historyRes = await fetch(`${API_BASE}/api/router-properties/${routerId}/history`);
        const historyData = await historyRes.json();
        setPropertyHistory(Array.isArray(historyData.history) ? historyData.history : []);
        
        toast.success('Router removed from property');
      } else {
        toast.error(data.error || 'Failed to remove property');
      }
    } catch (error) {
      console.error('Error removing property:', error);
      toast.error('Failed to remove property');
    } finally {
      setLoading(false);
    }
  }, [routerId, currentProperty]);

  const deleteHistoryItem = useCallback(async (assignmentId) => {
    if (!window.confirm('Delete this property history entry? This cannot be undone.')) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/router-properties/assignment/${assignmentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // Reload history
        const historyRes = await fetch(`${API_BASE}/api/router-properties/${routerId}/history`);
        const historyData = await historyRes.json();
        setPropertyHistory(Array.isArray(historyData.history) ? historyData.history : []);
        
        toast.success('History entry deleted');
      } else {
        toast.error(data.error || 'Failed to delete history entry');
      }
    } catch (error) {
      console.error('Error deleting history entry:', error);
      toast.error('Failed to delete history entry');
    } finally {
      setLoading(false);
    }
  }, [routerId]);

  const handleSelectProperty = (property) => {
    // If there's a current property, move to new one. Otherwise, assign.
    if (currentProperty) {
      moveToNewProperty(property.id, property.name);
    } else {
      assignProperty(property.id, property.name);
    }
    setShowSearchModal(false);
  };

  const handleOpenSearchModal = () => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchModal(true);
  };

  const handleUpdateStoredWith = async () => {
    if (!router?.clickup_task_id) {
      toast.error('Router has no linked ClickUp task');
      return;
    }

    if (selectedAssignees.length === 0) {
      toast.error('Please select at least one user');
      return;
    }

    setLoading(true);
    try {
      console.log('Storing router with user');
      console.log('Selected assignees:', selectedAssignees);
      
      // Get the selected user details
      const selectedUser = availableUsers.find(u => {
        const userId = u?.user?.id || u?.id;
        return String(userId) === String(selectedAssignees[0]);
      });

      if (!selectedUser) {
        toast.error('Selected user not found');
        return;
      }

      const userId = selectedUser?.user?.id || selectedUser?.id;
      const username = selectedUser?.user?.username || selectedUser?.username || 
                       selectedUser?.user?.email || selectedUser?.email || 'Unknown';

      console.log('Storing with user:', { userId, username });

      // Call backend to create storage record and update ClickUp assignees
      const res = await fetch(`${API_BASE}/api/routers/${routerId}/out-of-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stored_with_user_id: String(userId),
          stored_with_username: username,
          notes: null
        })
      });

      const data = await res.json();
      console.log('Storage response:', data);

      if (res.ok) {
        // Also update ClickUp task assignees
        try {
          const clickupRes = await fetch(`${API_BASE}/api/clickup/task/${router.clickup_task_id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              assignees: {
                add: [parseInt(userId)],
                rem: []
              }
            })
          });

          if (!clickupRes.ok) {
            console.warn('ClickUp assignee update failed, but storage record created');
          }
        } catch (clickupError) {
          console.warn('ClickUp assignee update error:', clickupError);
        }

        toast.success(`Router stored with ${username}`);
        setShowStoredWithModal(false);
        setSelectedAssignees([]);
        
        // Reload property history to show the storage event
        const historyRes = await fetch(`${API_BASE}/api/router-properties/${routerId}/history`);
        const historyData = await historyRes.json();
        setPropertyHistory(Array.isArray(historyData.history) ? historyData.history : []);
        
        // Reload current storage
        const storageRes = await fetch(`${API_BASE}/api/router-properties/${routerId}/current-storage`);
        const storageData = await storageRes.json();
        if (storageData.stored) {
          setCurrentStorage({
            storedWithUserId: storageData.stored_with_user_id,
            storedWithUsername: storageData.stored_with_username,
            storedAt: storageData.installed_at,
            daysSinceStored: storageData.daysSinceStored
          });
        }
        
        // Clear current property since router is now stored
        setCurrentProperty(null);
      } else {
        console.error('Storage failed:', data);
        toast.error(data.error || 'Failed to store router');
      }
    } catch (error) {
      console.error('Error storing router:', error);
      toast.error('Failed to store router: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReturnToService = async () => {
    if (!routerId) return;

    if (!window.confirm('Return this router to service?')) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/routers/${routerId}/return-to-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();

      if (res.ok && data.success) {
        toast.success('Router returned to service');
        
        // Reload property history to show the cleared storage event
        const historyRes = await fetch(`${API_BASE}/api/router-properties/${routerId}/history`);
        const historyData = await historyRes.json();
        setPropertyHistory(Array.isArray(historyData.history) ? historyData.history : []);
        
        // Clear current storage
        setCurrentStorage(null);
        
        // Optionally reload router data
        if (onAssigned) onAssigned(data.cleared);
      } else {
        toast.error(data.error || 'Failed to return router to service');
      }
    } catch (error) {
      console.error('Error returning router to service:', error);
      toast.error('Failed to update service status');
    } finally {
      setLoading(false);
    }
  };

    // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    openMovePropertyModal: () => {
      setShowSearchModal(true);
    },
    openStoredWithModal: async () => {
      // Load workspace members when opening modal
      if (workspaceId) {
        try {
          const res = await fetch(`${API_BASE}/api/clickup/workspaces/${workspaceId}/members`);
          const data = await res.json();
          console.log('Workspace members response:', data);
          if (data.members) {
            console.log('Setting available users:', data.members);
            setAvailableUsers(data.members);
          } else {
            console.warn('No members in response:', data);
            toast.error('No workspace members found');
          }
        } catch (error) {
          console.error('Error loading workspace members:', error);
          toast.error('Failed to load workspace members');
        }
      } else {
        toast.error('Workspace not connected');
      }
      setShowStoredWithModal(true);
    }
  }));

  if (!workspaceId) {
    return (
      <div className="property-search-widget">
        <div className="psw-header">
          <h4>📍 Property Assignment</h4>
          <span className="psw-status-badge warning">ClickUp Not Connected</span>
        </div>
        <p className="psw-hint">Connect ClickUp to assign routers to properties</p>
      </div>
    );
  }

  return (
    <>
      {/* Current Property Card (Middle Column) */}
      <div className="property-search-widget psw-current-card">
        <div className="psw-section-label">Property Assignment</div>
        
        {currentStorage ? (
          <div className="psw-current-content" style={{ borderLeft: '4px solid #f59e0b' }}>
            <div className="psw-property-name">🔧 Stored with {currentStorage.storedWithUsername}</div>
            <div className="psw-property-meta">
              Stored {new Date(currentStorage.storedAt).toLocaleDateString()}
              {currentStorage.daysSinceStored !== undefined && ` • ${currentStorage.daysSinceStored}d ago`}
            </div>
            <div className="psw-button-group">
              <button 
                onClick={handleReturnToService}
                disabled={loading}
                className="psw-btn primary"
              >
                Return to Service
              </button>
            </div>
          </div>
        ) : currentProperty ? (
          <div className="psw-current-content">
            <div className="psw-property-name">{currentProperty.name}</div>
            <div className="psw-property-meta">
              Installed {new Date(currentProperty.installedAt).toLocaleDateString()}
              {currentProperty.daysSinceInstalled !== undefined && ` • ${currentProperty.daysSinceInstalled}d ago`}
            </div>
            <a 
              href={`https://app.clickup.com/${workspaceId}/v/li/${currentProperty.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="psw-clickup-link"
            >
              View in ClickUp ↗
            </a>
            <div className="psw-button-group">
              <button 
                onClick={removeProperty}
                disabled={loading}
                className="psw-btn danger"
              >
                Remove from Property
              </button>
            </div>
          </div>
        ) : (
          <div className="psw-empty-state">
            <div className="psw-empty-text">No property assigned</div>
            <div className="psw-button-group">
              <button 
                onClick={handleOpenSearchModal}
                className="psw-btn primary"
                disabled={loading || !workspaceId}
              >
                Assign Property
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Property History Card (Right Column) */}
      <div className="property-search-widget psw-history-card">
        <div className="psw-section-label">
          Property History
          <span className="psw-history-count">{propertyHistory.length}</span>
        </div>
        
        {propertyHistory.length > 0 ? (
          <div className="psw-history-list-scroll">
            {propertyHistory.map((item) => (
              <div key={item.id} className="psw-history-item">
                {item.assignmentType === 'storage' ? (
                  // Storage event display
                  <>
                    <div className="psw-history-property">
                      <strong>🔧 Stored with {item.storedWithUsername || 'Unknown'}</strong>
                      {item.current ? (
                        <span className="psw-history-status current">CURRENT</span>
                      ) : (
                        <span className="psw-history-status removed">
                          {item.durationDays}d
                        </span>
                      )}
                      <button 
                        onClick={() => deleteHistoryItem(item.id)}
                        className="psw-history-delete"
                        title="Delete history entry"
                        disabled={loading}
                      >
                        ×
                      </button>
                    </div>
                    <div className="psw-history-dates">
                      {item.installedAt && (
                        <span>🔧 {new Date(item.installedAt).toLocaleDateString()}</span>
                      )}
                      {item.removedAt && (
                        <span>✅ {new Date(item.removedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                    {(item.installedBy || item.removedBy) && (
                      <div className="psw-history-users">
                        {item.installedBy && <span>Stored by {item.installedBy}</span>}
                        {item.removedBy && <span>Cleared by {item.removedBy}</span>}
                      </div>
                    )}
                    {item.notes && (
                      <div className="psw-history-notes">{item.notes}</div>
                    )}
                  </>
                ) : (
                  // Property assignment display
                  <>
                    <div className="psw-history-property">
                      {workspaceId && item.propertyTaskId ? (
                        <a 
                          href={`https://app.clickup.com/${workspaceId}/v/li/${item.propertyTaskId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="psw-history-link"
                        >
                          <strong>{item.propertyName || 'Unknown Property'}</strong>
                        </a>
                      ) : (
                        <strong>{item.propertyName || 'Unknown Property'}</strong>
                      )}
                      {item.current ? (
                        <span className="psw-history-status current">CURRENT</span>
                      ) : (
                        <span className="psw-history-status removed">
                          {item.durationDays}d
                        </span>
                      )}
                      <button 
                        onClick={() => deleteHistoryItem(item.id)}
                        className="psw-history-delete"
                        title="Delete history entry"
                        disabled={loading}
                      >
                        ×
                      </button>
                    </div>
                    <div className="psw-history-dates">
                      {item.installedAt && (
                        <span>📥 {new Date(item.installedAt).toLocaleDateString()}</span>
                      )}
                      {item.removedAt && (
                        <span>📤 {new Date(item.removedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                    {(item.installedBy || item.removedBy) && (
                      <div className="psw-history-users">
                        {item.installedBy && <span>Assigned via {item.installedBy}</span>}
                        {item.removedBy && <span>Removed via {item.removedBy}</span>}
                      </div>
                    )}
                    {item.notes && (
                      <div className="psw-history-notes">{item.notes}</div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="psw-empty-history">
            No property history
          </div>
        )}
      </div>

      {/* Search Modal */}
      {showSearchModal && (
        <div className="psw-modal-overlay" onClick={() => setShowSearchModal(false)}>
          <div className="psw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="psw-modal-header">
              <h3>{currentProperty ? 'Move to New Property' : 'Assign to Property'}</h3>
              <button className="psw-modal-close" onClick={() => setShowSearchModal(false)}>×</button>
            </div>
            
            <div className="psw-modal-body">
              <div className="psw-search-input-wrapper">
                <input
                  type="text"
                  placeholder="Search properties (e.g., Cambridge, Colchester)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                  className="psw-search-input"
                  disabled={loading}
                  autoFocus
                />
                {searching && <span className="psw-spinner">⏳</span>}
              </div>

              {showDropdown && searchResults.length > 0 && (
                <div className="psw-modal-results">
                  {searchResults.map(result => (
                    <div
                      key={result.id}
                      className="psw-result-item"
                      onClick={() => handleSelectProperty(result)}
                    >
                      <div className="psw-result-name">{result.name}</div>
                      <div className="psw-result-meta">
                        {result.folder_name && <span className="psw-badge">{result.folder_name}</span>}
                        {result.task_count !== undefined && <span className="psw-badge-count">{result.task_count} tasks</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                <div className="psw-no-results">
                  No properties found for "{searchQuery}"
                </div>
              )}

              {searchQuery.length < 2 && (
                <div className="psw-hint">
                  Type at least 2 characters to search property locations...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stored With Modal */}
      {showStoredWithModal && (
        <div className="psw-modal-overlay" onClick={() => setShowStoredWithModal(false)}>
          <div className="psw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="psw-modal-header">
              <h3>Update Router Storage</h3>
              <button className="psw-modal-close" onClick={() => setShowStoredWithModal(false)}>×</button>
            </div>
            
            <div className="psw-modal-body">
              <div className="psw-form-group">
                <label>Assign to ClickUp Users (Stored With)</label>
                <div className="psw-user-list">
                  {availableUsers.length > 0 ? (
                    availableUsers.map(user => {
                      const userId = user?.user?.id || user?.id;
                      const userName = user?.user?.username || user?.username || user?.user?.email || user?.email || 'Unknown';
                      
                      if (!userId) return null;
                      
                      return (
                        <label key={userId} className="psw-user-checkbox">
                          <input
                            type="checkbox"
                            value={userId}
                            checked={selectedAssignees.includes(userId.toString())}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedAssignees([...selectedAssignees, userId.toString()]);
                              } else {
                                setSelectedAssignees(selectedAssignees.filter(id => id !== userId.toString()));
                              }
                            }}
                          />
                          <span className="psw-user-name">
                            {userName}
                          </span>
                        </label>
                      );
                    })
                  ) : (
                    <p className="psw-hint">Loading users...</p>
                  )}
                </div>
              </div>

              <div className="psw-modal-actions">
                <button 
                  onClick={() => setShowStoredWithModal(false)}
                  className="psw-modal-btn secondary"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button 
                  onClick={handleUpdateStoredWith}
                  className="psw-modal-btn primary"
                  disabled={loading || selectedAssignees.length === 0}
                >
                  {loading ? 'Updating...' : 'Update Assignees'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

PropertySearchWidget.displayName = 'PropertySearchWidget';

export default PropertySearchWidget;
