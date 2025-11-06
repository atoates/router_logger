import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { toast } from 'react-toastify';
import './PropertySearchWidget.css';

const API_BASE = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';

const PropertySearchWidget = forwardRef(({ router, onAssigned }, ref) => {
  const [loading, setLoading] = useState(false);
  const [showStoredWithModal, setShowStoredWithModal] = useState(false);
  const [selectedAssignees, setSelectedAssignees] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [workspaceId, setWorkspaceId] = useState(null);

  const routerId = router?.router_id;

  // Get workspace on mount
  useEffect(() => {
    const getWorkspaceInfo = async () => {
      try {
        const authRes = await fetch(`${API_BASE}/api/clickup/auth/status`);
        const authData = await authRes.json();
        
        if (authData.authorized && authData.workspace) {
          setWorkspaceId(authData.workspace.workspace_id);
        }
      } catch (error) {
        console.error('Error getting workspace info:', error);
      }
    };

    getWorkspaceInfo();
  }, []);

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
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
      const res = await fetch(`${API_BASE}/api/routers/${routerId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignee_user_ids: selectedAssignees.map(String),
          assignee_usernames: usernames
        })
      });

      const data = await res.json();
      console.log('Assignment response:', data);

      if (res.ok) {
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
    return null; // Don't show anything if not connected
  }

  return (
    <>
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
