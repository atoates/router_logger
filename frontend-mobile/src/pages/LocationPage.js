import React, { useState, useEffect } from 'react';
import { getRouters, getClickUpSpaces, getClickUpSpacesForWorkspace, getClickUpSpaceLists, getClickUpTasks, linkRouterToLocation } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import './LocationPage.css';

function LocationPage() {
  const [routers, setRouters] = useState([]);
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [lists, setLists] = useState([]);
  const [selectedList, setSelectedList] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    fetchRouters();
    fetchWorkspaces();
  }, []);

  useEffect(() => {
    if (selectedWorkspace) {
      fetchSpaces(selectedWorkspace);
    }
  }, [selectedWorkspace]);

  useEffect(() => {
    if (selectedSpace) {
      fetchLists(selectedSpace);
    }
  }, [selectedSpace]);

  useEffect(() => {
    if (selectedList) {
      fetchTasks(selectedList);
    }
  }, [selectedList, searchQuery]);

  const fetchRouters = async () => {
    try {
      setLoading(true);
      const response = await getRouters();
      setRouters(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setError('Failed to load routers');
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkspaces = async () => {
    try {
      const response = await getClickUpSpaces();
      setWorkspaces(response.data.workspaces || []);
    } catch (err) {
      setError('Failed to load ClickUp workspaces');
    }
  };

  const fetchSpaces = async (workspaceId) => {
    try {
      setLoading(true);
      const response = await getClickUpSpacesForWorkspace(workspaceId);
      setSpaces(response.data.spaces || []);
      // Auto-select "Active Accounts" space if it exists
      const activeAccounts = response.data.spaces?.find(s => s.name === 'Active Accounts');
      if (activeAccounts) {
        setSelectedSpace(activeAccounts.id);
      }
    } catch (err) {
      setError('Failed to load spaces');
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
      let allLists = [];
      if (data.folderless && data.folderless.length > 0) {
        allLists = allLists.concat(data.folderless.map(list => ({
          ...list,
          folderName: null
        })));
      }
      if (data.folders && data.folders.length > 0) {
        data.folders.forEach(folder => {
          if (folder.lists && folder.lists.length > 0) {
            allLists = allLists.concat(folder.lists.map(list => ({
              ...list,
              folderName: folder.folder?.name
            })));
          }
        });
      }
      
      setLists(allLists);
    } catch (err) {
      setError('Failed to load lists');
    } finally {
      setLoading(false);
    }
  };

  const fetchTasks = async (listId) => {
    try {
      setLoading(true);
      const response = await getClickUpTasks(listId, searchQuery);
      setTasks(response.data.tasks || []);
    } catch (err) {
      setError('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleLinkRouter = async (taskId) => {
    if (!selectedRouter) {
      setError('Please select a router first');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await linkRouterToLocation(selectedRouter.router_id, {
        taskId,
        listId: selectedList
      });
      setSuccess(`Router #${selectedRouter.router_id} linked to location successfully!`);
      setSelectedRouter(null);
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
        <div className="router-selector">
          {routers.map(router => (
            <button
              key={router.router_id}
              className={`router-select-button ${selectedRouter?.router_id === router.router_id ? 'active' : ''}`}
              onClick={() => setSelectedRouter(router)}
            >
              #{router.router_id} {router.name && `- ${router.name}`}
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: Select Workspace */}
      <div className="location-section">
        <h2>2. Select ClickUp Workspace</h2>
        <select
          value={selectedWorkspace || ''}
          onChange={(e) => {
            setSelectedWorkspace(e.target.value);
            setSelectedSpace(null);
            setSelectedList(null);
            setTasks([]);
            setSpaces([]);
          }}
          className="location-select"
        >
          <option value="">Choose a workspace...</option>
          {workspaces.map(workspace => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </div>

      {/* Step 3: Select Space (e.g., "Active Accounts") */}
      {selectedWorkspace && (
        <div className="location-section">
          <h2>3. Select Space</h2>
          {loading ? (
            <LoadingSpinner size="small" />
          ) : (
            <select
              value={selectedSpace || ''}
              onChange={(e) => {
                setSelectedSpace(e.target.value);
                setSelectedList(null);
                setTasks([]);
              }}
              className="location-select"
            >
              <option value="">Choose a space...</option>
              {spaces.map(space => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Step 4: Select List */}
      {selectedSpace && (
        <div className="location-section">
          <h2>4. Select List</h2>
          {loading ? (
            <LoadingSpinner size="small" />
          ) : (
            <select
              value={selectedList || ''}
              onChange={(e) => {
                setSelectedList(e.target.value);
                setTasks([]);
              }}
              className="location-select"
            >
              <option value="">Choose a list...</option>
              {lists.map(list => (
                <option key={list.id} value={list.id}>
                  {list.folderName ? `${list.folderName} / ${list.name}` : list.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Step 5: Search and Select Task */}
      {selectedList && (
        <div className="location-section">
          <h2>5. Search and Select Location</h2>
          <input
            type="text"
            placeholder="Search locations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          
          {loading ? (
            <LoadingSpinner size="small" text="Loading tasks..." />
          ) : (
            <div className="tasks-list">
              {tasks.length === 0 ? (
                <p className="empty-hint">No locations found. Try a different search.</p>
              ) : (
                tasks.map(task => (
                  <div key={task.id} className="task-item">
                    <div className="task-info">
                      <div className="task-name">{task.name}</div>
                      {task.status && (
                        <div className="task-status">{task.status.status}</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleLinkRouter(task.id)}
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

