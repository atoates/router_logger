import React, { useState, useEffect } from 'react';
import { getClickUpSpaces, getClickUpWorkspaceMembers, assignRouter } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import './AssignmentModal.css';

/**
 * Modal shown after uninstalling a router
 * Prompts user to assign the router to themselves or someone else
 */
function AssignmentModal({ router, onClose, onAssigned }) {
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState(null);
  const [showMemberList, setShowMemberList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    // Pre-fetch members in case user wants to assign to someone else
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const workspacesResponse = await getClickUpSpaces();
      const workspaces = workspacesResponse.data.workspaces || [];
      const vacatAd = workspaces.find(w => w.name === 'VacatAd');
      
      if (vacatAd) {
        const response = await getClickUpWorkspaceMembers(vacatAd.id);
        const membersList = Array.isArray(response.data.members) ? response.data.members : [];
        setMembers(membersList);
      }
    } catch (err) {
      console.error('Failed to load members:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignToMe = async () => {
    if (!user) {
      setError('You must be logged in to assign routers');
      return;
    }

    try {
      setAssigning(true);
      setError(null);

      await assignRouter(router.router_id, {
        assignee_user_ids: [user.clickup_user_id || user.id],
        assignee_usernames: [user.username || user.email || 'Me']
      });

      onAssigned && onAssigned({
        type: 'self',
        username: user.username || user.email
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to assign router');
      setAssigning(false);
    }
  };

  const handleAssignToMember = async (member) => {
    try {
      setAssigning(true);
      setError(null);

      await assignRouter(router.router_id, {
        assignee_user_ids: [member.user.id],
        assignee_usernames: [member.user.username || member.user.email || 'Unknown']
      });

      onAssigned && onAssigned({
        type: 'other',
        username: member.user.username || member.user.email
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to assign router');
      setAssigning(false);
    }
  };

  const handleSkip = () => {
    onClose && onClose();
  };

  const filteredMembers = members.filter(member => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const username = member.user?.username?.toLowerCase() || '';
    const email = member.user?.email?.toLowerCase() || '';
    const name = member.user?.name?.toLowerCase() || '';
    return username.includes(query) || email.includes(query) || name.includes(query);
  });

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          <div className="modal-icon">✅</div>
          <h2>Router Uninstalled</h2>
          <p className="modal-subtitle">
            Router #{router.router_id} has been unlinked from its location
          </p>
        </div>

        {error && (
          <div className="modal-error">
            {error}
          </div>
        )}

        {!showMemberList ? (
          <>
            <div className="modal-question">
              <p>Who is taking this router?</p>
            </div>

            <div className="modal-actions">
              <button
                onClick={handleAssignToMe}
                disabled={assigning}
                className="modal-button modal-button-primary modal-button-large"
              >
                {assigning ? (
                  <span className="button-loading">Assigning...</span>
                ) : (
                  <>
                    <span className="button-icon">👤</span>
                    <span>Assign to Me</span>
                  </>
                )}
              </button>

              <div className="modal-actions-row">
                <button
                  onClick={() => setShowMemberList(true)}
                  disabled={assigning || loading}
                  className="modal-button modal-button-secondary"
                >
                  <span className="button-icon">👥</span>
                  <span>Someone Else</span>
                </button>

                <button
                  onClick={handleSkip}
                  disabled={assigning}
                  className="modal-button modal-button-ghost"
                >
                  Skip
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="modal-search">
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="modal-search-input"
                autoFocus
              />
            </div>

            <div className="modal-member-list">
              {loading ? (
                <div className="modal-loading">Loading team members...</div>
              ) : filteredMembers.length === 0 ? (
                <div className="modal-empty">No members found</div>
              ) : (
                filteredMembers.slice(0, 10).map(member => (
                  <button
                    key={member.user.id}
                    onClick={() => handleAssignToMember(member)}
                    disabled={assigning}
                    className="modal-member-button"
                  >
                    <div className="member-avatar">
                      {(member.user.username || member.user.email || '?')[0].toUpperCase()}
                    </div>
                    <div className="member-details">
                      <div className="member-name">
                        {member.user.username || member.user.name || member.user.email}
                      </div>
                      {member.user.email && member.user.email !== member.user.username && (
                        <div className="member-email">{member.user.email}</div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <button
              onClick={() => setShowMemberList(false)}
              className="modal-button modal-button-ghost modal-back-button"
            >
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default AssignmentModal;

