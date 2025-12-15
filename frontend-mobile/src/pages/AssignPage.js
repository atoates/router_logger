import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getRouters, getClickUpSpaces, getClickUpWorkspaceMembers, assignRouter } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import StatusBadge from '../components/StatusBadge';
import './AssignPage.css';

function AssignPage() {
  const [searchParams] = useSearchParams();
  const routerIdFromQuery = searchParams.get('routerId');
  const navigate = useNavigate();
  
  const [routers, setRouters] = useState([]);
  const [filteredRouters, setFilteredRouters] = useState([]);
  const [routerSearchQuery, setRouterSearchQuery] = useState('');
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [members, setMembers] = useState([]);
  const [filteredMembers, setFilteredMembers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [assigningToMe, setAssigningToMe] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    fetchRouters();
    initializeClickUp();
  }, []);

  useEffect(() => {
    filterRouters();
  }, [routerSearchQuery, routers]);

  useEffect(() => {
    if (routerIdFromQuery) {
      const router = routers.find(r => r.router_id === routerIdFromQuery);
      if (router) {
        setSelectedRouter(router);
      }
    }
  }, [routerIdFromQuery, routers]);

  useEffect(() => {
    if (workspace) {
      fetchMembers(workspace.id);
    }
  }, [workspace]);

  useEffect(() => {
    if (members.length > 0) {
      filterMembers();
    }
  }, [searchQuery, members]);

  const fetchRouters = async () => {
    try {
      setLoading(true);
      const response = await getRouters();
      const routerList = Array.isArray(response.data) ? response.data : [];
      // Filter out routers that are already linked to a location (installed routers)
      const uninstalledRouters = routerList.filter(router => !router.clickup_location_task_id);
      setRouters(uninstalledRouters);
      setFilteredRouters(uninstalledRouters);
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
    } catch (err) {
      setError('Failed to initialize ClickUp');
    } finally {
      setLoading(false);
    }
  };

  const fetchMembers = async (workspaceId) => {
    try {
      setLoading(true);
      const response = await getClickUpWorkspaceMembers(workspaceId);
      const membersList = Array.isArray(response.data.members) ? response.data.members : [];
      setMembers(membersList);
      setFilteredMembers(membersList);
    } catch (err) {
      setError('Failed to load workspace members');
    } finally {
      setLoading(false);
    }
  };

  const filterMembers = () => {
    if (!searchQuery) {
      setFilteredMembers(members);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = members.filter(member => {
      const username = member.user?.username?.toLowerCase() || '';
      const email = member.user?.email?.toLowerCase() || '';
      const name = member.user?.name?.toLowerCase() || '';
      return username.includes(query) || email.includes(query) || name.includes(query);
    });

    setFilteredMembers(filtered);
  };

  const handleAssignToMe = async () => {
    if (!selectedRouter) {
      setError('Please select a router first');
      return;
    }

    if (!user) {
      setError('You must be logged in to assign routers');
      return;
    }

    try {
      setAssigningToMe(true);
      setError(null);
      setSuccess(null);

      await assignRouter(selectedRouter.router_id, {
        assignee_user_ids: [user.clickup_user_id || user.id],
        assignee_usernames: [user.username || user.email || 'Me']
      });

      setSuccess(`Router #${selectedRouter.router_id} assigned to you!`);
      
      setTimeout(() => {
        navigate(`/router/${selectedRouter.router_id}?refresh=${Date.now()}`);
      }, 1000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to assign router');
    } finally {
      setAssigningToMe(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedRouter || !selectedMember) {
      setError('Please select both a router and a person');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      await assignRouter(selectedRouter.router_id, {
        assignee_user_ids: [selectedMember.user.id],
        assignee_usernames: [selectedMember.user.username || selectedMember.user.email || 'Unknown']
      });

      setSuccess(`Router #${selectedRouter.router_id} assigned to ${selectedMember.user.username || selectedMember.user.email || 'selected person'}`);
      
      // Force refresh routers cache and navigate back to router detail page
      // The router detail page will fetch fresh data
      setTimeout(() => {
        // Clear router cache to force fresh fetch
        navigate(`/router/${selectedRouter.router_id}?refresh=${Date.now()}`);
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to assign router');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !selectedRouter && !workspace) {
    return (
      <div className="page-container">
        <LoadingSpinner text="Loading..." />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Assign Router</h1>
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

      {/* Quick Action: Assign to Me */}
      {selectedRouter && user && (
        <div className="quick-action-section">
          <button
            onClick={handleAssignToMe}
            disabled={assigningToMe || loading}
            className="quick-assign-button"
          >
            {assigningToMe ? (
              <span>⏳ Assigning...</span>
            ) : (
              <>
                <span className="quick-assign-icon">👤</span>
                <span>Assign to Me</span>
              </>
            )}
          </button>
          <p className="quick-assign-hint">Quick assign Router #{selectedRouter.router_id} to yourself</p>
        </div>
      )}

      {/* Step 1: Select Router */}
      <div className="assign-section">
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
                <div className="router-select-info">
                  <span className="router-select-id">#{router.router_id}</span>
                  {router.name && <span className="router-select-name">{router.name}</span>}
                </div>
                <StatusBadge router={router} size="small" showLabel={false} />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Step 2: Select Person */}
      {workspace && (
        <div className="assign-section">
          <h2>2. Select Person</h2>
          <input
            type="text"
            placeholder="Search by name, username, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
            style={{ marginBottom: '12px' }}
          />
          <div className="member-selector">
            {filteredMembers.length === 0 ? (
              <p className="empty-hint" style={{ padding: '20px', textAlign: 'center' }}>
                {searchQuery ? 'No members found' : 'No members available'}
              </p>
            ) : (
              filteredMembers.map(member => (
                <button
                  key={member.user.id}
                  className={`member-select-button ${selectedMember?.user.id === member.user.id ? 'active' : ''}`}
                  onClick={() => setSelectedMember(member)}
                >
                  <div className="member-info">
                    <div className="member-name">
                      {member.user.username || member.user.name || member.user.email || 'Unknown'}
                    </div>
                    {member.user.email && member.user.email !== member.user.username && (
                      <div className="member-email">{member.user.email}</div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Assign Button */}
      {selectedRouter && selectedMember && (
        <div className="selected-info">
          <div className="selected-details">
            <div>Router: <strong>#{selectedRouter.router_id} {selectedRouter.name && `- ${selectedRouter.name}`}</strong></div>
            <div>Person: <strong>{selectedMember.user.username || selectedMember.user.email || 'Unknown'}</strong></div>
          </div>
          <button
            onClick={handleAssign}
            disabled={loading}
            className="assign-button"
          >
            {loading ? 'Assigning...' : 'Assign Router'}
          </button>
        </div>
      )}
    </div>
  );
}

export default AssignPage;

