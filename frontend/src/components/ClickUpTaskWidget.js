import React, { useState, useEffect } from 'react';
import {
  getClickUpAuthStatus,
  getRouterTask,
  getClickUpWorkspaces,
  getClickUpRoutersList,
  getClickUpTasks,
  createClickUpTask,
  linkRouterToTask,
  unlinkRouterFromTask,
  updateRouterStatus
} from '../services/api';
import { toast } from 'react-toastify';
import './ClickUpTaskWidget.css';

const ClickUpTaskWidget = ({ router, onStoredWith }) => {
  const [authorized, setAuthorized] = useState(false);
  const [linkedTask, setLinkedTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('link'); // 'link' or 'create'
  const [tasks, setTasks] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [workspace, setWorkspace] = useState(null);
  const [routersList, setRoutersList] = useState(null);

  useEffect(() => {
    checkAuthAndLoadTask();
  }, [router.router_id]);

  const checkAuthAndLoadTask = async () => {
    try {
      // Check if ClickUp is authorized
      const authStatus = await getClickUpAuthStatus();
      setAuthorized(authStatus.data.authorized);

      if (!authStatus.data.authorized) {
        setLoading(false);
        return;
      }

      // Load linked task if exists
      const taskResponse = await getRouterTask(router.router_id);
      if (taskResponse.data.linked) {
        setLinkedTask(taskResponse.data.task);
      }
    } catch (error) {
      console.error('Error loading ClickUp data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTasksForLinking = async () => {
    try {
      setLoading(true);
      
      // Get workspace
      const workspacesResponse = await getClickUpWorkspaces();
      const ws = workspacesResponse.data.workspaces?.[0];
      setWorkspace(ws);

      if (!ws) {
        throw new Error('No workspace found');
      }

      // Get "Routers" list
      const listResponse = await getClickUpRoutersList(ws.id);
      setRoutersList(listResponse.data.list);

      // Get tasks from "Routers" list
      const tasksResponse = await getClickUpTasks(listResponse.data.list.id);
      setTasks(tasksResponse.data.tasks);
    } catch (error) {
      console.error('Error loading tasks:', error);
      alert('Failed to load tasks from ClickUp');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenLinkModal = async () => {
    setModalMode('link');
    setShowModal(true);
    await loadTasksForLinking();
  };

  const handleOpenCreateModal = async () => {
    setModalMode('create');
    setShowModal(true);
    setNewTaskName(`${router.name || `Router #${router.router_id}`} - Maintenance`);
    
    // Still need to load workspace and list
    try {
      const workspacesResponse = await getClickUpWorkspaces();
      const ws = workspacesResponse.data.workspaces?.[0];
      setWorkspace(ws);

      if (ws) {
        const listResponse = await getClickUpRoutersList(ws.id);
        setRoutersList(listResponse.data.list);
      }
    } catch (error) {
      console.error('Error loading workspace:', error);
    }
  };

  const handleLinkTask = async (task) => {
    try {
      setLoading(true);
      await linkRouterToTask(router.router_id, task.id, routersList.id);
      setLinkedTask({
        id: task.id,
        name: task.name,
        status: task.status?.status,
        url: task.url
      });
      setShowModal(false);
      alert('Router linked to task successfully!');
    } catch (error) {
      console.error('Error linking task:', error);
      alert('Failed to link task');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAndLink = async () => {
    if (!newTaskName.trim()) {
      alert('Please enter a task name');
      return;
    }

    try {
      setCreating(true);
      const taskData = {
        name: newTaskName,
        description: `Router maintenance task for ${router.name || router.router_id}`,
        routerId: router.router_id,
        routerName: router.name
      };

      const createResponse = await createClickUpTask(routersList.id, taskData);
      const createdTask = createResponse.data.task;

      // Link the newly created task
      await linkRouterToTask(router.router_id, createdTask.id, routersList.id);
      
      setLinkedTask({
        id: createdTask.id,
        name: createdTask.name,
        status: createdTask.status?.status,
        url: createdTask.url
      });
      
      setShowModal(false);
      setNewTaskName('');
      alert('Task created and linked successfully!');
    } catch (error) {
      console.error('Error creating task:', error);
      alert('Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  const handleUnlink = async () => {
    if (!window.confirm('Unlink this router from its ClickUp task?')) {
      return;
    }

    try {
      setLoading(true);
      await unlinkRouterFromTask(router.router_id);
      setLinkedTask(null);
      alert('Router unlinked successfully');
    } catch (error) {
      console.error('Error unlinking:', error);
      alert('Failed to unlink router');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAssignment = async () => {
    if (!window.confirm('Remove all assignees from this router?')) {
      return;
    }

    try {
      setLoading(true);
      const API_BASE = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';
      const response = await fetch(`${API_BASE}/api/routers/${router.router_id}/remove-assignees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (response.ok) {
        // Reload the task to update the UI
        const taskResponse = await getRouterTask(router.router_id);
        if (taskResponse.data.linked) {
          setLinkedTask(taskResponse.data.task);
        }
        alert('Assignees removed successfully');
      } else {
        throw new Error(data.error || 'Failed to remove assignees');
      }
    } catch (error) {
      console.error('Error removing assignees:', error);
      alert(error.message || 'Failed to remove assignees');
    } finally {
      setLoading(false);
    }
  };

  const [showBeingReturnedModal, setShowBeingReturnedModal] = useState(false);
  const [beingReturnedNotes, setBeingReturnedNotes] = useState('');

  const handleDecommission = async () => {
    if (!window.confirm('⚠️ WARNING: Are you sure you want to decommission this router?\n\nThis will:\n- Mark the router as permanently retired\n- Remove all assignees\n- Unlink from any property\n- Hide it from most views\n\nThis action can be reversed by manually updating the status.')) {
      return;
    }

    try {
      setLoading(true);
      await updateRouterStatus(router.router_id, 'decommissioned');
      
      // Reload the task to update the UI
      const taskResponse = await getRouterTask(router.router_id);
      if (taskResponse.data.linked) {
        setLinkedTask(taskResponse.data.task);
      }
      
      toast.success('Router decommissioned - unassigned and unlinked');
      
      // Optionally redirect or refresh the page
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error('Error decommissioning router:', error);
      toast.error(error.response?.data?.error || 'Failed to decommission router');
    } finally {
      setLoading(false);
    }
  };

  const handleBeingReturned = () => {
    setShowBeingReturnedModal(true);
  };

  const handleBeingReturnedSubmit = async () => {
    try {
      setLoading(true);
      await updateRouterStatus(router.router_id, 'being returned', beingReturnedNotes);
      
      // Reload the task to update the UI
      const taskResponse = await getRouterTask(router.router_id);
      if (taskResponse.data.linked) {
        setLinkedTask(taskResponse.data.task);
      }
      
      toast.success('Router marked as being returned');
      setShowBeingReturnedModal(false);
      setBeingReturnedNotes('');
    } catch (error) {
      console.error('Error updating router status:', error);
      toast.error(error.response?.data?.error || 'Failed to update router status');
    } finally {
      setLoading(false);
    }
  };

  if (!authorized) {
    return null; // Don't show widget if not authorized
  }

  if (loading && !linkedTask) {
    return (
      <div className="clickup-task-widget">
        <div className="loading-spinner">Loading ClickUp task...</div>
      </div>
    );
  }

  const filteredTasks = tasks.filter(task =>
    task.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      <div className="clickup-task-widget">
        {linkedTask ? (
          <div className="task-linked">
            {/* Show assignee prominently if router is assigned to someone */}
            {linkedTask.assignees && linkedTask.assignees.length > 0 && (
              <div className="task-assigned-to">
                <div className="assigned-icon">👤</div>
                <div className="assigned-info">
                  <div className="assigned-label">Assigned To</div>
                  <div className="assigned-name">{linkedTask.assignees[0].username}</div>
                </div>
              </div>
            )}
            
            <div className="task-info">
              <div className="task-name">{linkedTask.name}</div>
              <div className="task-meta">
                {linkedTask.status && (
                  <span className={`task-status ${linkedTask.status.toLowerCase().replace(/\s+/g, '-')}`}>
                    {linkedTask.status}
                  </span>
                )}
                {linkedTask.due_date && (
                  <span className="task-due">
                    📅 {new Date(parseInt(linkedTask.due_date)).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <div className="task-actions">
              <a 
                href={linkedTask.url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="task-btn task-btn-primary"
              >
                View in ClickUp
              </a>
              {onStoredWith && (
                <button 
                  onClick={linkedTask.assignees && linkedTask.assignees.length > 0 ? handleRemoveAssignment : onStoredWith}
                  className="task-btn task-btn-secondary"
                >
                  {linkedTask.assignees && linkedTask.assignees.length > 0 
                    ? 'Remove Assignment' 
                    : 'Assign Router'}
                </button>
              )}
            </div>
            
            {/* Status Change Actions */}
            <div className="task-actions" style={{ marginTop: '12px', borderTop: '1px solid #e5e7eb', paddingTop: '12px' }}>
              <button 
                onClick={handleBeingReturned}
                className="task-btn task-btn-warning"
                title="Mark this router as being returned"
              >
                📦 Being Returned
              </button>
              <button 
                onClick={handleDecommission}
                className="task-btn task-btn-danger"
                title="Permanently decommission this router"
              >
                ⚠️ Decommission
              </button>
            </div>
          </div>
        ) : (
          <div className="task-not-linked">
            <p>No ClickUp task linked to this router</p>
            <div className="task-actions">
              <button className="task-btn task-btn-primary" onClick={handleOpenCreateModal}>
                Create New Task
              </button>
              <button className="task-btn task-btn-secondary" onClick={handleOpenLinkModal}>
                Link Existing Task
              </button>
            </div>
            
            {/* Status Change Actions (available even without ClickUp task) */}
            <div className="task-actions" style={{ marginTop: '12px', borderTop: '1px solid #e5e7eb', paddingTop: '12px' }}>
              <button 
                onClick={handleBeingReturned}
                className="task-btn task-btn-warning"
                title="Mark this router as being returned"
              >
                📦 Being Returned
              </button>
              <button 
                onClick={handleDecommission}
                className="task-btn task-btn-danger"
                title="Permanently decommission this router"
              >
                ⚠️ Decommission
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Task Selection/Creation Modal */}
      {showModal && (
        <div className="task-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="task-modal" onClick={(e) => e.stopPropagation()}>
            <div className="task-modal-header">
              <h3>{modalMode === 'link' ? 'Link to Existing Task' : 'Create New Task'}</h3>
            </div>

            <div className="task-modal-body">
              {modalMode === 'link' ? (
                <>
                  <input
                    type="text"
                    className="task-search"
                    placeholder="Search tasks..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  
                  {loading ? (
                    <div className="loading-spinner">Loading tasks...</div>
                  ) : filteredTasks.length > 0 ? (
                    <div className="task-list">
                      {filteredTasks.map(task => (
                        <div 
                          key={task.id} 
                          className="task-item"
                          onClick={() => handleLinkTask(task)}
                        >
                          <div className="task-item-name">{task.name}</div>
                          <div className="task-item-status">
                            {task.status?.status || 'No status'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ textAlign: 'center', color: '#64748b' }}>
                      No tasks found
                    </p>
                  )}
                </>
              ) : (
                <>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
                    Task Name
                  </label>
                  <input
                    type="text"
                    className="task-search"
                    placeholder="Enter task name..."
                    value={newTaskName}
                    onChange={(e) => setNewTaskName(e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                  <p style={{ fontSize: '13px', color: '#64748b', marginTop: '8px' }}>
                    Task will be created in the "Routers" list with router details.
                  </p>
                </>
              )}
            </div>

            <div className="task-modal-footer">
              <button className="task-btn task-btn-secondary" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              {modalMode === 'create' && (
                <button 
                  className="task-btn task-btn-primary" 
                  onClick={handleCreateAndLink}
                  disabled={creating}
                >
                  {creating ? 'Creating...' : 'Create & Link'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Being Returned Modal */}
      {showBeingReturnedModal && (
        <div className="task-modal-overlay" onClick={() => setShowBeingReturnedModal(false)}>
          <div className="task-modal return-modal" onClick={(e) => e.stopPropagation()}>
            <div className="task-modal-header">
              <div className="modal-header-content">
                <div className="modal-icon">📦</div>
                <div>
                  <h3>Mark Router as Being Returned</h3>
                  <p className="modal-subtitle">Router #{router?.router_id}</p>
                </div>
              </div>
              <button className="task-modal-close" onClick={() => {
                setShowBeingReturnedModal(false);
                setBeingReturnedNotes('');
              }}>
                ×
              </button>
            </div>

            <div className="task-modal-body">
              <div className="return-notice">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM11 15H9V13H11V15ZM11 11H9V5H11V11Z" fill="#3b82f6"/>
                </svg>
                <p>This will mark the router as being returned. You can optionally add notes about the reason.</p>
              </div>

              <div className="form-group">
                <label htmlFor="return-notes">Return Notes (Optional)</label>
                <textarea
                  id="return-notes"
                  className="return-notes-input"
                  placeholder="e.g., With Leyton office cap ind, Property closed, Router malfunction, Upgrade needed..."
                  value={beingReturnedNotes}
                  onChange={(e) => setBeingReturnedNotes(e.target.value)}
                  rows={4}
                  maxLength={500}
                />
                <div className="character-count">
                  {beingReturnedNotes.length}/500 characters
                </div>
              </div>
            </div>

            <div className="task-modal-footer">
              <button 
                className="task-btn task-btn-secondary" 
                onClick={() => {
                  setShowBeingReturnedModal(false);
                  setBeingReturnedNotes('');
                }}
              >
                Cancel
              </button>
              <button 
                className="task-btn task-btn-return" 
                onClick={handleBeingReturnedSubmit}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="btn-spinner"></span>
                    Updating...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 8L7 2L1 8M7 3V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Mark as Being Returned
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ClickUpTaskWidget;
