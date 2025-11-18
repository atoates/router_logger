import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import './SettingsPage.css';

function SettingsPage() {
  const { currentUser, logout } = useAuth();
  const { isDarkMode, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {/* User Info */}
      <div className="settings-section">
        <h2>User Information</h2>
        <div className="user-info">
          <div className="info-row">
            <span className="info-label">Username:</span>
            <span className="info-value">{currentUser?.username || 'N/A'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Role:</span>
            <span className="info-value">{currentUser?.role || 'N/A'}</span>
          </div>
          {currentUser?.email && (
            <div className="info-row">
              <span className="info-label">Email:</span>
              <span className="info-value">{currentUser.email}</span>
            </div>
          )}
          {currentUser?.fullName && (
            <div className="info-row">
              <span className="info-label">Full Name:</span>
              <span className="info-value">{currentUser.fullName}</span>
            </div>
          )}
        </div>
      </div>

      {/* App Info */}
      <div className="settings-section">
        <h2>App Information</h2>
        <div className="app-info">
          <div className="info-row">
            <span className="info-label">Version:</span>
            <span className="info-value">1.0.0</span>
          </div>
          <div className="info-row">
            <span className="info-label">Environment:</span>
            <span className="info-value">
              {process.env.NODE_ENV === 'production' ? 'Production' : 'Development'}
            </span>
          </div>
        </div>
      </div>

      {/* Appearance */}
      <div className="settings-section">
        <h2>Appearance</h2>
        <div className="info-row">
          <span className="info-label">Dark Mode:</span>
          <label className="theme-toggle">
            <input
              type="checkbox"
              checked={isDarkMode}
              onChange={toggleTheme}
              className="theme-toggle-input"
            />
            <span className="theme-toggle-slider"></span>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="settings-section">
        <h2>Actions</h2>
        <button
          onClick={handleLogout}
          className="logout-button"
        >
          Logout
        </button>
      </div>

      {/* About */}
      <div className="settings-section">
        <div className="about-text">
          <p>Router Logger Mobile</p>
          <p className="about-subtitle">Field Installer Application</p>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;




