import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import './PropertySearchWidget.css';

const API_BASE = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';

export default function PropertySearchWidget({ router, onAssigned }) {
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [currentProperty, setCurrentProperty] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
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

  // Load current property assignment
  useEffect(() => {
    const loadCurrentProperty = async () => {
      if (!routerId) return;
      
      try {
        const res = await fetch(`${API_BASE}/api/router-properties/${routerId}/current`);
        const data = await res.json();
        
        if (data.assigned) {
          setCurrentProperty({
            id: data.property_clickup_task_id,
            name: data.property_name,
            installedAt: data.installed_at,
            installedBy: data.installed_by,
            daysSinceInstalled: data.daysSinceInstalled
          });
        } else {
          setCurrentProperty(null);
        }
      } catch (error) {
        console.error('Error loading current property:', error);
      }
    };

    loadCurrentProperty();
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

  const handleSelectProperty = (property) => {
    assignProperty(property.id, property.name);
  };

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
    <div className="property-search-widget">
      <div className="psw-header">
        <h4>📍 Property Assignment</h4>
        {spaceId ? (
          <span className="psw-status-badge success">Active Accounts</span>
        ) : (
          <span className="psw-status-badge">All Workspace</span>
        )}
      </div>

      {currentProperty ? (
        <div className="psw-current-property">
          <div className="psw-property-info">
            <div className="psw-property-name">
              <strong>{currentProperty.name}</strong>
              <a 
                href={`https://app.clickup.com/t/${currentProperty.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="psw-clickup-link"
              >
                View in ClickUp ↗
              </a>
            </div>
            <div className="psw-property-meta">
              <span>Installed {currentProperty.daysSinceInstalled} days ago</span>
              {currentProperty.installedBy && (
                <span>by {currentProperty.installedBy}</span>
              )}
            </div>
          </div>
          <button 
            onClick={removeProperty}
            disabled={loading}
            className="psw-remove-btn"
          >
            {loading ? 'Removing...' : 'Remove'}
          </button>
        </div>
      ) : (
        <div className="psw-search-container">
          <div className="psw-search-input-wrapper">
            <input
              type="text"
              placeholder={spaceId ? "Search properties (e.g., Cambridge, Colchester)..." : "Search property locations..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              className="psw-search-input"
              disabled={loading}
            />
            {searching && <span className="psw-spinner">⏳</span>}
          </div>

          {showDropdown && searchResults.length > 0 && (
            <div className="psw-dropdown">
              {searchResults.map(result => (
                <div
                  key={result.id}
                  className="psw-dropdown-item"
                  onClick={() => handleSelectProperty(result)}
                >
                  <div className="psw-result-name">{result.name}</div>
                  <div className="psw-result-meta">
                    {result.listName && <span className="psw-badge">{result.listName}</span>}
                    {result.list?.name && <span className="psw-badge">{result.list.name}</span>}
                    {result.status && <span className="psw-badge-status">{result.status}</span>}
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
              Type to search property locations (excludes router tasks)...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
