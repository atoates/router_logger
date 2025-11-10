import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * ProtectedRoute - Wrapper component for routes requiring authentication
 * 
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components to render if authorized
 * @param {boolean} props.requireAdmin - If true, requires admin role
 * 
 * Features:
 * - Redirects to /login if not authenticated
 * - Redirects to / if requireAdmin=true but user is not admin
 * - Shows loading state while checking authentication
 * - Preserves intended destination for post-login redirect
 */
function ProtectedRoute({ children, requireAdmin = false }) {
  const { currentUser, loading } = useAuth();
  const location = useLocation();

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontSize: '18px',
        color: '#667eea'
      }}>
        <div>Loading...</div>
      </div>
    );
  }

  // Not logged in - redirect to login page
  // Preserve current location so we can redirect back after login
  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Logged in but not admin when admin is required
  if (requireAdmin && currentUser.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  // Authorized - render children
  return children;
}

export default ProtectedRoute;
