import React, { useState, useEffect } from 'react';
import {
  getClickUpAuthStatus,
  getRouterTask,
  getClickUpWorkspaces,
  getClickUpRoutersList,
  getClickUpTasks,
  createClickUpTask,
  linkRouterToTask,
  unlinkRouterFromTask
} from '../services/api';
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
            <div className="task-info">
              <div className="task-name">{linkedTask.name}</div>
              <div className="task-meta">
                {linkedTask.status && (
                  <span className={`task-status ${linkedTask.status.toLowerCase().replace(/\s+/g, '-')}`}>
                    {linkedTask.status}
                  </span>
                )}
                {linkedTask.assignees && linkedTask.assignees.length > 0 && (
                  <span className="task-assignees">
                    👤 {linkedTask.assignees.map(a => a.username).join(', ')}
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
                  onClick={onStoredWith}
                  className="task-btn task-btn-secondary"
                >
                  Stored with
                </button>
              )}
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
    </>
  );
};

export default ClickUpTaskWidget;
