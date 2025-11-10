import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';
import './UsersManagement.css';

/**
 * UsersManagement - Admin interface for managing users
 * 
 * Features:
 * - List all users with search/filter
 * - Create new users (admin or guest)
 * - Edit user details (email, full name)
 * - Change passwords
 * - Activate/deactivate users
 * - Manage router assignments for guests
 * - View login history
 */
function UsersManagement() {
  const { getAuthHeaders } = useAuth();
  const [users, setUsers] = useState([]);
  const [routers, setRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterStatus, setFilterStatus] = useState('active');
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showRoutersModal, setShowRoutersModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  
  // Form states
  const [selectedUser, setSelectedUser] = useState(null);
  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    role: 'guest',
    email: '',
    fullName: ''
  });
  const [editForm, setEditForm] = useState({
    email: '',
    fullName: '',
    isActive: true
  });
  const [passwordForm, setPasswordForm] = useState({
    newPassword: '',
    confirmPassword: ''
  });
  const [routerAssignments, setRouterAssignments] = useState([]);
  const [loginHistory, setLoginHistory] = useState([]);

  const API_URL = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';

  // Load users and routers on mount
  useEffect(() => {
    loadUsers();
    loadRouters();
  }, [filterStatus]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const includeInactive = filterStatus === 'all' || filterStatus === 'inactive';
      const response = await fetch(
        `${API_URL}/api/users?include_inactive=${includeInactive}`,
        { headers: getAuthHeaders() }
      );
      
      if (!response.ok) throw new Error('Failed to load users');
      
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadRouters = async () => {
    try {
      const response = await fetch(`${API_URL}/api/routers`);
      if (!response.ok) throw new Error('Failed to load routers');
      
      const data = await response.json();
      setRouters(data.data || []);
    } catch (error) {
      console.error('Error loading routers:', error);
    }
  };

  // Create user
  const handleCreateUser = async (e) => {
    e.preventDefault();
    
    if (createForm.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          username: createForm.username,
          password: createForm.password,
          role: createForm.role,
          email: createForm.email || undefined,
          fullName: createForm.fullName || undefined
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create user');
      }

      toast.success('User created successfully');
      setShowCreateModal(false);
      setCreateForm({ username: '', password: '', role: 'guest', email: '', fullName: '' });
      loadUsers();
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error(error.message);
    }
  };

  // Edit user
  const handleEditUser = async (e) => {
    e.preventDefault();

    try {
      const response = await fetch(`${API_URL}/api/users/${selectedUser.user_id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          email: editForm.email || undefined,
          fullName: editForm.fullName || undefined,
          isActive: editForm.isActive
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update user');
      }

      toast.success('User updated successfully');
      setShowEditModal(false);
      loadUsers();
    } catch (error) {
      console.error('Error updating user:', error);
      toast.error(error.message);
    }
  };

  // Change password
  const handleChangePassword = async (e) => {
    e.preventDefault();

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/users/${selectedUser.user_id}/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ newPassword: passwordForm.newPassword })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to change password');
      }

      toast.success('Password changed successfully');
      setShowPasswordModal(false);
      setPasswordForm({ newPassword: '', confirmPassword: '' });
    } catch (error) {
      console.error('Error changing password:', error);
      toast.error(error.message);
    }
  };

  // Deactivate/Reactivate user
  const handleToggleUserStatus = async (user) => {
    const action = user.is_active ? 'deactivate' : 'reactivate';
    const endpoint = user.is_active 
      ? `${API_URL}/api/users/${user.user_id}`
      : `${API_URL}/api/users/${user.user_id}/reactivate`;

    try {
      const response = await fetch(endpoint, {
        method: user.is_active ? 'DELETE' : 'POST',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to ${action} user`);
      }

      toast.success(`User ${action}d successfully`);
      loadUsers();
    } catch (error) {
      console.error(`Error ${action} user:`, error);
      toast.error(error.message);
    }
  };

  // Load router assignments
  const handleOpenRoutersModal = async (user) => {
    setSelectedUser(user);
    setShowRoutersModal(true);

    try {
      const response = await fetch(
        `${API_URL}/api/users/${user.user_id}/routers`,
        { headers: getAuthHeaders() }
      );

      if (!response.ok) throw new Error('Failed to load router assignments');

      const data = await response.json();
      setRouterAssignments(data.routers || []);
    } catch (error) {
      console.error('Error loading router assignments:', error);
      toast.error('Failed to load router assignments');
    }
  };

  // Assign router
  const handleAssignRouter = async (routerId) => {
    try {
      const response = await fetch(
        `${API_URL}/api/users/${selectedUser.user_id}/routers/${routerId}`,
        {
          method: 'POST',
          headers: getAuthHeaders()
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to assign router');
      }

      toast.success('Router assigned successfully');
      handleOpenRoutersModal(selectedUser); // Reload assignments
    } catch (error) {
      console.error('Error assigning router:', error);
      toast.error(error.message);
    }
  };

  // Unassign router
  const handleUnassignRouter = async (routerId) => {
    try {
      const response = await fetch(
        `${API_URL}/api/users/${selectedUser.user_id}/routers/${routerId}`,
        {
          method: 'DELETE',
          headers: getAuthHeaders()
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to unassign router');
      }

      toast.success('Router unassigned successfully');
      handleOpenRoutersModal(selectedUser); // Reload assignments
    } catch (error) {
      console.error('Error unassigning router:', error);
      toast.error(error.message);
    }
  };

  // Load login history
  const handleOpenHistoryModal = async (user) => {
    setSelectedUser(user);
    setShowHistoryModal(true);

    try {
      const response = await fetch(
        `${API_URL}/api/users/${user.user_id}/login-history?limit=20`,
        { headers: getAuthHeaders() }
      );

      if (!response.ok) throw new Error('Failed to load login history');

      const data = await response.json();
      setLoginHistory(data.history || []);
    } catch (error) {
      console.error('Error loading login history:', error);
      toast.error('Failed to load login history');
    }
  };

  // Filter users
  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (user.email && user.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (user.full_name && user.full_name.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesRole = filterRole === 'all' || user.role === filterRole;
    const matchesStatus = 
      filterStatus === 'all' ||
      (filterStatus === 'active' && user.is_active) ||
      (filterStatus === 'inactive' && !user.is_active);

    return matchesSearch && matchesRole && matchesStatus;
  });

  if (loading) {
    return <div className="users-loading">Loading users...</div>;
  }

  return (
    <div className="users-management">
      <div className="users-header">
        <h2>User Management</h2>
        <button className="btn-create" onClick={() => setShowCreateModal(true)}>
          ➕ Create User
        </button>
      </div>

      {/* Filters */}
      <div className="users-filters">
        <input
          type="text"
          placeholder="Search users..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="filter-select">
          <option value="all">All Roles</option>
          <option value="admin">Admin</option>
          <option value="guest">Guest</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="filter-select">
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
          <option value="all">All Status</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="users-table-container">
        <table className="users-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Email</th>
              <th>Full Name</th>
              <th>Last Login</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => (
              <tr key={user.user_id} className={!user.is_active ? 'inactive-row' : ''}>
                <td className="username-cell">{user.username}</td>
                <td>
                  <span className={`role-badge ${user.role}`}>
                    {user.role}
                  </span>
                </td>
                <td>{user.email || '-'}</td>
                <td>{user.full_name || '-'}</td>
                <td>
                  {user.last_login 
                    ? new Date(user.last_login).toLocaleString()
                    : 'Never'}
                </td>
                <td>
                  <span className={`status-badge ${user.is_active ? 'active' : 'inactive'}`}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="btn-action btn-edit"
                      onClick={() => {
                        setSelectedUser(user);
                        setEditForm({
                          email: user.email || '',
                          fullName: user.full_name || '',
                          isActive: user.is_active
                        });
                        setShowEditModal(true);
                      }}
                      title="Edit user"
                    >
                      ✏️
                    </button>
                    <button
                      className="btn-action btn-password"
                      onClick={() => {
                        setSelectedUser(user);
                        setPasswordForm({ newPassword: '', confirmPassword: '' });
                        setShowPasswordModal(true);
                      }}
                      title="Change password"
                    >
                      🔑
                    </button>
                    {user.role === 'guest' && (
                      <button
                        className="btn-action btn-routers"
                        onClick={() => handleOpenRoutersModal(user)}
                        title="Manage router assignments"
                      >
                        📍
                      </button>
                    )}
                    <button
                      className="btn-action btn-history"
                      onClick={() => handleOpenHistoryModal(user)}
                      title="View login history"
                    >
                      📊
                    </button>
                    <button
                      className={`btn-action ${user.is_active ? 'btn-deactivate' : 'btn-activate'}`}
                      onClick={() => handleToggleUserStatus(user)}
                      title={user.is_active ? 'Deactivate user' : 'Reactivate user'}
                    >
                      {user.is_active ? '🚫' : '✅'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredUsers.length === 0 && (
          <div className="no-users">No users found matching the filters.</div>
        )}
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Create New User</h3>
            <form onSubmit={handleCreateUser}>
              <div className="form-group">
                <label>Username *</label>
                <input
                  type="text"
                  value={createForm.username}
                  onChange={(e) => setCreateForm({...createForm, username: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>Password * (min 8 characters)</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({...createForm, password: e.target.value})}
                  required
                  minLength={8}
                />
              </div>
              <div className="form-group">
                <label>Role *</label>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm({...createForm, role: e.target.value})}
                  required
                >
                  <option value="guest">Guest</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({...createForm, email: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  value={createForm.fullName}
                  onChange={(e) => setCreateForm({...createForm, fullName: e.target.value})}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit">
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Edit User: {selectedUser.username}</h3>
            <form onSubmit={handleEditUser}>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  value={editForm.fullName}
                  onChange={(e) => setEditForm({...editForm, fullName: e.target.value})}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showPasswordModal && selectedUser && (
        <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Change Password: {selectedUser.username}</h3>
            <form onSubmit={handleChangePassword}>
              <div className="form-group">
                <label>New Password * (min 8 characters)</label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                  required
                  minLength={8}
                />
              </div>
              <div className="form-group">
                <label>Confirm Password *</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                  required
                  minLength={8}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowPasswordModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit">
                  Change Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Router Assignments Modal */}
      {showRoutersModal && selectedUser && (
        <div className="modal-overlay" onClick={() => setShowRoutersModal(false)}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Router Assignments: {selectedUser.username}</h3>
            
            <div className="routers-section">
              <h4>Assigned Routers ({routerAssignments.length})</h4>
              {routerAssignments.length > 0 ? (
                <div className="assigned-routers">
                  {routerAssignments.map(router => (
                    <div key={router.router_id} className="router-card">
                      <div className="router-info">
                        <strong>{router.router_id}</strong>
                        {router.name && <span> - {router.name}</span>}
                      </div>
                      <button
                        className="btn-unassign"
                        onClick={() => handleUnassignRouter(router.router_id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-data">No routers assigned</p>
              )}
            </div>

            <div className="routers-section">
              <h4>Available Routers</h4>
              <div className="available-routers">
                {routers
                  .filter(r => !routerAssignments.some(ar => ar.router_id === r.router_id))
                  .map(router => (
                    <div key={router.router_id} className="router-card">
                      <div className="router-info">
                        <strong>{router.router_id}</strong>
                        {router.name && <span> - {router.name}</span>}
                      </div>
                      <button
                        className="btn-assign"
                        onClick={() => handleAssignRouter(router.router_id)}
                      >
                        Assign
                      </button>
                    </div>
                  ))}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowRoutersModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Login History Modal */}
      {showHistoryModal && selectedUser && (
        <div className="modal-overlay" onClick={() => setShowHistoryModal(false)}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Login History: {selectedUser.username}</h3>
            
            {loginHistory.length > 0 ? (
              <div className="history-table-container">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Date/Time</th>
                      <th>IP Address</th>
                      <th>User Agent</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loginHistory.map((entry, index) => (
                      <tr key={index}>
                        <td>{new Date(entry.login_timestamp).toLocaleString()}</td>
                        <td>{entry.ip_address || '-'}</td>
                        <td className="user-agent-cell">{entry.user_agent || '-'}</td>
                        <td>
                          <span className={`status-badge ${entry.success ? 'success' : 'failed'}`}>
                            {entry.success ? 'Success' : 'Failed'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="no-data">No login history available</p>
            )}

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowHistoryModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default UsersManagement;
