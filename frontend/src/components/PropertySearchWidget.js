import React, { useState, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { toast } from 'react-toastify';
import api from '../services/api';
import './PropertySearchWidget.css';

const API_BASE = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';

const PropertySearchWidget = forwardRef(({ router, onAssigned }, ref) => {
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
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
        const authRes = await api.get('/clickup/auth/status');
        const authData = authRes.data;
        
        if (authData.authorized && authData.workspace) {
          setWorkspaceId(authData.workspace.workspace_id);
          
          // Get spaces to find Active Accounts
          const spacesRes = await api.get(`/clickup/spaces/${authData.workspace.workspace_id}`);
          const spacesData = spacesRes.data;
          
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

  // Load current location assignment
  useEffect(() => {
    const loadCurrentLocation = async () => {
      if (!routerId) return;
      
      try {
        const res = await api.get(`/routers/${routerId}/current-location`);
        const data = res.data;
        
        if (data.location) {
          setCurrentLocation({
            id: data.location.location_task_id,
            name: data.location.location_task_name,
            linkedAt: data.location.linked_at,
            dateInstalled: data.location.date_installed
          });
        } else {
          setCurrentLocation(null);
        }
      } catch (error) {
        console.error('Error loading current location:', error);
      }
    };

    loadCurrentLocation();
  }, [routerId]);

  // Debounced search for properties
  useEffect(() => {
    if (!spaceId || searchQuery.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        // Get the space's folder structure with all lists
        const res = await api.get(`/clickup/debug/space-lists/${spaceId}`);
        const data = res.data;
        
        // Extract all lists from all folders
        let allLists = [];
        if (data.folderless && data.folderless.length > 0) {
          allLists = allLists.concat(data.folderless);
        }
        if (data.folders && data.folders.length > 0) {
          data.folders.forEach(folder => {
            if (folder.lists && folder.lists.length > 0) {
              allLists = allLists.concat(folder.lists.map(list => ({
                ...list,
                folderName: folder.folder.name
              })));
            }
          });
        }
        
        // Filter lists by search query (case insensitive)
        // If query is only digits, prepend '#' for property number search
        const searchTerm = /^\d+$/.test(searchQuery) ? `#${searchQuery}` : searchQuery;
        const filtered = allLists.filter(list => 
          list.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
        
        // Format for the dropdown
        const formattedResults = filtered.map(list => ({
          id: list.id,
          name: list.name,
          folderName: list.folderName
        }));
        
        setSearchResults(formattedResults);
        setShowDropdown(true);
      } catch (error) {
        console.error('Error searching properties:', error);
        toast.error('Failed to search properties');
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, spaceId]);

  const assignLocation = useCallback(async (locationId, locationName) => {
    if (!routerId) return;

    setLoading(true);
    try {
      const res = await api.post(`/routers/${routerId}/link-location`, {
        location_task_id: locationId,
        location_task_name: locationName,
        notes: 'Assigned via dashboard'
      });

      const data = res.data;

      if (data.success) {
        setCurrentLocation({
          id: locationId,
          name: locationName,
          linkedAt: new Date().toISOString()
        });
        
        setSearchQuery('');
        setShowDropdown(false);
        toast.success(`Router linked to ${locationName}`);
        
        if (onAssigned) onAssigned(data.router);
      } else {
        toast.error(data.error || 'Failed to link location');
      }
    } catch (error) {
      console.error('Error linking location:', error);
      toast.error('Failed to link location');
    } finally {
      setLoading(false);
    }
  }, [routerId, onAssigned]);

  const removeLocation = useCallback(async () => {
    if (!routerId || !currentLocation) return;

    if (!window.confirm(`Unlink router from ${currentLocation.name}?`)) return;

    setLoading(true);
    try {
      const res = await api.post(`/routers/${routerId}/unlink-location`, {
        notes: 'Unlinked via dashboard'
      });

      const data = res.data;

      if (data.success) {
        setCurrentLocation(null);
        toast.success('Router unlinked from location');
      } else {
        toast.error(data.error || 'Failed to unlink location');
      }
    } catch (error) {
      console.error('Error unlinking location:', error);
      toast.error('Failed to unlink location');
    } finally {
      setLoading(false);
    }
  }, [routerId, currentLocation]);

  const handleSelectProperty = (property) => {
    assignLocation(property.id, property.name);
    setShowSearchModal(false);
  };

  const handleOpenSearchModal = () => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchModal(true);
  };

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    openStoredWithModal: async () => {
      // Load workspace members when opening modal
      if (workspaceId) {
        try {
          const res = await api.get(`/clickup/workspaces/${workspaceId}/members`);
          const data = res.data;
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

  // Handle router assignment to ClickUp users
  const handleAssignRouter = async () => {
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
      console.log('Assigning router to users');
      console.log('Selected assignees:', selectedAssignees);
      
      // Get usernames for the selected user IDs
      const usernames = selectedAssignees.map(assigneeId => {
        const user = availableUsers.find(u => {
          const userId = u?.user?.id || u?.id;
          return String(userId) === String(assigneeId);
        });
        return user?.user?.username || user?.username || 
               user?.user?.email || user?.email || 'Unknown';
      });

      console.log('Assigning to:', { userIds: selectedAssignees, usernames });

      // Call backend to update ClickUp assignees
      const res = await api.post(`/routers/${routerId}/assign`, {
        assignee_user_ids: selectedAssignees.map(String),
        assignee_usernames: usernames
      });

      const data = res.data;
      console.log('Assignment response:', data);

      if (data) {
        toast.success(`Router assigned to ${usernames.join(', ')}`);
        setShowStoredWithModal(false);
        setSelectedAssignees([]);
        
        // Optionally notify parent component
        if (onAssigned) {
          onAssigned(data);
        }
      } else {
        console.error('Assignment failed:', data);
        toast.error(data.error || 'Failed to assign router');
      }
    } catch (error) {
      console.error('Error assigning router:', error);
      toast.error('Failed to assign router: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!workspaceId) {
    return (
      <div className="property-search-widget">
        <div className="psw-header">
          <h4>📍 Location Assignment</h4>
          <span className="psw-status-badge warning">ClickUp Not Connected</span>
        </div>
        <p className="psw-hint">Connect ClickUp to link routers to locations</p>
      </div>
    );
  }

  return (
    <>
      {/* Current Location Card */}
      <div className="property-search-widget psw-current-card">
        <div className="psw-section-label">Location Assignment</div>
        
        {currentLocation ? (
          <div className="psw-current-content">
            <div className="psw-property-name">{currentLocation.name}</div>
            <div className="psw-property-meta">
              Linked {new Date(currentLocation.linkedAt).toLocaleDateString('en-GB')}
            </div>
            <a 
              href={`https://app.clickup.com/${workspaceId}/v/li/${currentLocation.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="psw-clickup-link"
            >
              View in ClickUp ↗
            </a>
            <div className="psw-button-group">
              {/* Date Pills */}
              {currentLocation.dateInstalled ? (
                <div className="psw-date-pills">
                  <span className="psw-date-pill">
                    📅 Install: {new Date(Number(currentLocation.dateInstalled)).toLocaleDateString('en-GB')}
                  </span>
                  <span className={`psw-date-pill ${
                    Number(currentLocation.dateInstalled) + (92 * 24 * 60 * 60 * 1000) < Date.now()
                      ? 'overdue'
                      : ''
                  }`}>
                    🔔 Uninstall: {new Date(Number(currentLocation.dateInstalled) + (92 * 24 * 60 * 60 * 1000)).toLocaleDateString('en-GB')}
                  </span>
                </div>
              ) : (
                <div className="psw-date-pills">
                  <span className="psw-date-pill text-muted">
                    📅 Install date not set
                  </span>
                </div>
              )}
              <button 
                onClick={removeLocation}
                disabled={loading}
                className="psw-btn danger"
              >
                Unlink Location
              </button>
            </div>
          </div>
        ) : (
          <div className="psw-empty-state">
            <div className="psw-empty-text">No location assigned</div>
            <div className="psw-button-group">
              <button 
                onClick={handleOpenSearchModal}
                className="psw-btn primary"
                disabled={loading || !workspaceId}
              >
                Assign Location
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search Modal */}
      {showSearchModal && (
        <div className="psw-modal-overlay" onClick={() => setShowSearchModal(false)}>
          <div className="psw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="psw-modal-header">
              <h3>Assign to Location</h3>
              <button className="psw-modal-close" onClick={() => setShowSearchModal(false)}>×</button>
            </div>
            
            <div className="psw-modal-body">
              <div className="psw-search-input-wrapper">
                <input
                  type="text"
                  placeholder="Search locations (e.g., 123 or Cambridge)..."
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
                  No locations found for "{searchQuery}"
                </div>
              )}

              {searchQuery.length < 2 && (
                <div className="psw-hint">
                  Type at least 2 characters to search locations...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stored With / Assign Router Modal */}
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
                  onClick={handleAssignRouter}
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
