import React, { useState, useEffect } from 'react';
import { getRouters, getClickUpSpaces, getClickUpSpacesForWorkspace, getClickUpSpaceLists, getClickUpListTasks, linkRouterToLocation } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import './LocationPage.css';

function LocationPage() {
  const [routers, setRouters] = useState([]);
  const [filteredRouters, setFilteredRouters] = useState([]);
  const [routerSearchQuery, setRouterSearchQuery] = useState('');
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [space, setSpace] = useState(null);
  const [allLists, setAllLists] = useState([]);
  const [filteredLists, setFilteredLists] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Two-step selection state
  const [selectionStep, setSelectionStep] = useState(1); // 1 = select location, 2 = select property
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [propertyTasks, setPropertyTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  useEffect(() => {
    fetchRouters();
    initializeClickUp();
  }, []);

  useEffect(() => {
    filterRouters();
  }, [routerSearchQuery, routers]);

  useEffect(() => {
    if (space) {
      fetchLists(space.id);
    }
  }, [space]);

  useEffect(() => {
    if (space && allLists.length > 0) {
      filterLists();
    }
  }, [searchQuery, allLists, space]);

  const fetchRouters = async () => {
    try {
      setLoading(true);
      const response = await getRouters();
      const routerList = Array.isArray(response.data) ? response.data : [];
      // Filter out routers that are already linked to a location
      const unlinkedRouters = routerList.filter(router => !router.clickup_location_task_id);
      setRouters(unlinkedRouters);
      setFilteredRouters(unlinkedRouters);
    } catch (err) {
      setError('Failed to load routers');
    } finally {
      setLoading(false);
    }
  };

  const filterRouters = () => {
    if (!routerSearchQuery) {
      setFilteredRouters(routers);
      return;
    }

    const query = routerSearchQuery.toLowerCase();
    const filtered = routers.filter(router => {
      const id = router.router_id?.toString().toLowerCase() || '';
      const name = router.name?.toLowerCase() || '';
      return id.includes(query) || name.includes(query);
    });

    setFilteredRouters(filtered);
  };

  const initializeClickUp = async () => {
    try {
      setLoading(true);
      // Get workspaces and auto-select "VacatAd"
      const workspacesResponse = await getClickUpSpaces();
      const workspaces = workspacesResponse.data.workspaces || [];
      const vacatAd = workspaces.find(w => w.name === 'VacatAd');
      
      if (!vacatAd) {
        setError('VacatAd workspace not found');
        return;
      }
      
      setWorkspace(vacatAd);
      
      // Get spaces and auto-select "Active Accounts"
      const spacesResponse = await getClickUpSpacesForWorkspace(vacatAd.id);
      const spaces = spacesResponse.data.spaces || [];
      const activeAccounts = spaces.find(s => s.name === 'Active Accounts');
      
      if (!activeAccounts) {
        setError('Active Accounts space not found');
        return;
      }
      
      setSpace(activeAccounts);
    } catch (err) {
      setError('Failed to initialize ClickUp: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const fetchLists = async (spaceId) => {
    try {
      setLoading(true);
      const response = await getClickUpSpaceLists(spaceId);
      const data = response.data;
      
      // Extract all lists from folderless and folders
      let lists = [];
      const folderlessLists = data.folderless || data.folderlessLists || [];
      if (folderlessLists.length > 0) {
        lists = lists.concat(folderlessLists.map(list => ({
          ...list,
          folderName: null
        })));
      }
      if (data.folders && data.folders.length > 0) {
        data.folders.forEach(folder => {
          if (folder.lists && folder.lists.length > 0) {
            lists = lists.concat(folder.lists.map(list => ({
              ...list,
              folderName: folder.folder?.name
            })));
          }
        });
      }
      
      setAllLists(lists);
      setFilteredLists(lists); // Initially show all lists
    } catch (err) {
      setError('Failed to load lists');
    } finally {
      setLoading(false);
    }
  };

  const filterLists = () => {
    if (!searchQuery || searchQuery.length < 2) {
      setFilteredLists(allLists);
      return;
    }

    // If query is only digits, prepend '#' for property number search (like desktop)
    const searchTerm = /^\d+$/.test(searchQuery) ? `#${searchQuery}` : searchQuery;
    const filtered = allLists.filter(list => 
      list.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    setFilteredLists(filtered);
  };

  // Step 1: Select a location (list) - then load its property tasks
  const handleSelectLocation = async (list) => {
    try {
      setLoadingTasks(true);
      setError(null);
      setSelectedLocation(list);
      
      // Fetch tasks (properties) from this location
      const response = await getClickUpListTasks(list.id);
      const tasks = response.data.tasks || [];
      setPropertyTasks(tasks);
      setSelectionStep(2);
    } catch (err) {
      setError('Failed to load properties for this location: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoadingTasks(false);
    }
  };

  // Step 2: Select a property task and link the router
  const handleSelectProperty = async (task) => {
    if (!selectedRouter) {
      setError('Please select a router first');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      // Link to the task (property) - this is the new approach
      await linkRouterToLocation(selectedRouter.router_id, {
        location_task_id: task.id,
        location_task_name: task.name
      });
      setSuccess(`Router #${selectedRouter.router_id} linked to ${task.name} (${selectedLocation.name}) successfully!`);
      setSelectedRouter(null);
      setSearchQuery('');
      setFilteredLists([]);
      setSelectionStep(1);
      setSelectedLocation(null);
      setPropertyTasks([]);
      fetchRouters(); // Refresh router list
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to link router to property');
    } finally {
      setLoading(false);
    }
  };

  // Go back to step 1 (location selection)
  const handleBackToLocations = () => {
    setSelectionStep(1);
    setSelectedLocation(null);
    setPropertyTasks([]);
  };

  // Legacy function for locations with no tasks (link directly to location)
  const handleLinkRouter = async (list) => {
    if (!selectedRouter) {
      setError('Please select a router first');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      // Link to the list (not a task) - the list name is the location
      await linkRouterToLocation(selectedRouter.router_id, {
        location_task_id: list.id,
        location_task_name: list.name
      });
      setSuccess(`Router #${selectedRouter.router_id} linked to ${list.name} successfully!`);
      setSelectedRouter(null);
      setSearchQuery('');
      setFilteredLists([]);
      fetchRouters(); // Refresh router list
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to link router to location');
    } finally {
      setLoading(false);
    }
  };

  if (loading && routers.length === 0) {
    return (
      <div className="page-container">
        <LoadingSpinner text="Loading..." />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Link Location</h1>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          {success}
        </div>
      )}

      {/* Step 1: Select Router */}
      <div className="location-section">
        <h2>1. Select Router</h2>
        <input
          type="text"
          placeholder="Search by router ID or name..."
          value={routerSearchQuery}
          onChange={(e) => setRouterSearchQuery(e.target.value)}
          className="search-input"
          style={{ marginBottom: '12px' }}
        />
        <div className="router-selector">
          {filteredRouters.length === 0 ? (
            <p className="empty-hint" style={{ padding: '20px', textAlign: 'center' }}>
              {routerSearchQuery ? 'No routers found' : 'No routers available'}
            </p>
          ) : (
            filteredRouters.map(router => (
              <button
                key={router.router_id}
                className={`router-select-button ${selectedRouter?.router_id === router.router_id ? 'active' : ''}`}
                onClick={() => setSelectedRouter(router)}
              >
                #{router.router_id} {router.name && `- ${router.name}`}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Breadcrumbs */}
      {workspace && space && (
        <div className="location-breadcrumbs">
          <span className="breadcrumb-item">{workspace.name}</span>
          <span className="breadcrumb-separator">›</span>
          <span className="breadcrumb-item">{space.name}</span>
          {selectedLocation && (
            <>
              <span className="breadcrumb-separator">›</span>
              <span className="breadcrumb-item">{selectedLocation.name}</span>
            </>
          )}
        </div>
      )}

      {/* Step 2: Search and Select Location (List) - then Property (Task) */}
      {space && selectionStep === 1 && (
        <div className="location-section">
          <h2>2. Search and Select Location</h2>
          <input
            type="text"
            placeholder="Search by property number (e.g. 69) or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          
          {(loading && allLists.length === 0) || loadingTasks ? (
            <LoadingSpinner size="small" text={loadingTasks ? "Loading properties..." : "Loading locations..."} />
          ) : (
            <div className="tasks-list">
              {filteredLists.length === 0 ? (
                <p className="empty-hint">
                  {searchQuery.length < 2 
                    ? 'Enter at least 2 characters to search' 
                    : 'No locations found. Try a different search.'}
                </p>
              ) : (
                filteredLists.map(list => (
                  <div key={list.id} className="task-item">
                    <div className="task-info">
                      <div className="task-name">{list.name}</div>
                      <div className="task-meta">
                        {list.folderName && (
                          <span className="task-folder">📁 {list.folderName}</span>
                        )}
                        {list.task_count !== undefined && (
                          <span className="task-count-badge">
                            {list.task_count} {list.task_count === 1 ? 'property' : 'properties'}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => list.task_count > 0 ? handleSelectLocation(list) : handleLinkRouter(list)}
                      className="link-button"
                      disabled={!selectedRouter || loading || loadingTasks}
                    >
                      {list.task_count > 0 ? 'Select' : 'Link'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Select Property (Task) from the Location */}
      {space && selectionStep === 2 && selectedLocation && (
        <div className="location-section">
          <div className="step-header">
            <button 
              className="back-button"
              onClick={handleBackToLocations}
            >
              ← Back
            </button>
            <h2>3. Select Property</h2>
          </div>
          <div className="selected-location-banner">
            📍 {selectedLocation.name}
          </div>
          
          {loadingTasks ? (
            <LoadingSpinner size="small" text="Loading properties..." />
          ) : (
            <div className="tasks-list">
              {propertyTasks.length === 0 ? (
                <p className="empty-hint">
                  No properties found in this location.
                </p>
              ) : (
                propertyTasks.map(task => (
                  <div key={task.id} className="task-item property-task-item">
                    <div className="task-info">
                      <div className="task-name">{task.name}</div>
                      <div className="task-meta">
                        {task.status?.status && (
                          <span 
                            className="status-badge"
                            style={{ 
                              backgroundColor: task.status.color || 'var(--text-secondary)',
                              color: '#fff'
                            }}
                          >
                            {task.status.status}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleSelectProperty(task)}
                      className="link-button"
                      disabled={!selectedRouter || loading}
                    >
                      Link
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {selectedRouter && (
        <div className="selected-router-info">
          Selected: Router #{selectedRouter.router_id}
        </div>
      )}
    </div>
  );
}

export default LocationPage;

