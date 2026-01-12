import React, { useState, useEffect } from 'react';
import { Routes, Route, useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import ClickUpAuthButton from './components/ClickUpAuthButton';
import DashboardV3 from './components/DashboardV3';
import RouterDashboard from './components/RouterDashboard';
import HeaderRouterSelect from './components/HeaderRouterSelect';
import ReturnsPage from './components/ReturnsPage';
import DecommissionedPage from './components/DecommissionedPage';
import LoginPage from './components/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import UsersManagement from './components/UsersManagement';
import AdminDebugTools from './components/AdminDebugTools';
import GuestDashboard from './components/GuestDashboard';
import GuestWifi from './components/GuestWifi';
import Users from './components/Users';
import AnalyticsBeta from './components/AnalyticsBeta';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastContainer, toast } from 'react-toastify';
import { getRouters } from './services/api';
import 'react-toastify/dist/ReactToastify.css';

// Note: RMS sync happens automatically on backend - no frontend button needed

// Wrapper component for router detail page that loads router data from URL
function RouterDetailPage() {
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [loading, setLoading] = useState(true);
  const params = useParams();
  const navigate = useNavigate();
  
  useEffect(() => {
    const loadRouter = async () => {
      if (params.routerId) {
        try {
          setLoading(true);
          const response = await getRouters();
          const routers = response.data || [];
          const router = routers.find(r => r.router_id === params.routerId);
          
          if (router) {
            setSelectedRouter(router);
          } else {
            toast.error(`Router ${params.routerId} not found`);
            navigate('/');
          }
        } catch (error) {
          console.error('Error loading router:', error);
          toast.error('Failed to load router');
          navigate('/');
        } finally {
          setLoading(false);
        }
      }
    };
    
    loadRouter();
  }, [params.routerId, navigate]);

  if (loading) {
    return (
      <div className="card">
        <p>Loading router details...</p>
      </div>
    );
  }

  return <RouterDashboard router={selectedRouter} />;
}

function AppContent() {
  const [darkMode] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, logout, isAdmin, isGuest } = useAuth();


  // Header router selector opens the Router details page
  const handleHeaderRouterSelect = (router) => {
    navigate(`/router/${router.router_id}`);
    const label = router.name ? `${router.name} (ID ${router.router_id})` : `ID ${router.router_id}`;
    toast.success(`Opening ${label}`);
  };

  // Handle logout
  const handleLogout = async () => {
    await logout();
    toast.info('Logged out successfully');
    navigate('/login');
  };

  // Determine if we're on a router page or login page
  const isRouterPage = location.pathname.startsWith('/router/');
  const isLoginPage = location.pathname === '/login';
  
  // Navigation menu items - guests only see "My Routers"
  const navItems = isGuest ? [
    { path: '/', label: 'My Routers', icon: '📱', title: 'My Routers' },
  ] : [
    { path: '/', label: 'Dashboard', icon: '📊', title: 'Dashboard' },
    { path: '/users-activity', label: 'Users', icon: '👤', title: 'User Activity' },
    { path: '/assignments', label: 'Assign', icon: '📍', title: 'Router Assignments' },
    { path: '/stored', label: 'Stored', icon: '📦', title: 'Stored Routers' },
    { path: '/returns', label: 'Returns', icon: '🔄', title: 'Returns' },
    { path: '/decommissioned', label: 'Decom', icon: '⚠️', title: 'Decommissioned' },
    { path: '/status', label: 'Status', icon: '⚙️', title: 'System Status' },
  ];

  // Admin-only navigation items
  const adminNavItems = [
    { path: '/users', label: 'Users', icon: '👥', title: 'User Management' },
    { path: '/admin/debug', label: 'Debug', icon: '🔧', title: 'Admin Debug Tools' },
  ];

  // If login page, render standalone without header/nav
  if (isLoginPage) {
    return <LoginPage />;
  }

  return (
    <div className={`app ${darkMode ? 'dark-mode' : ''}`}>
      <div className="container">
        {/* Header */}
        <div className="app-header">
          <div className="app-header-left">
            <Link to="/" className="app-logo-link">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img src="/Logo.png" alt="Router Logger" style={{ width: '40px', height: 'auto' }} />
                <div>
                  <h1 className="app-title">Router Logger</h1>
                  <p className="app-subtitle">Monitor router network and property assignments</p>
                </div>
              </div>
            </Link>
          </div>
          <div className="app-header-right">
            {!isGuest && <HeaderRouterSelect onSelect={handleHeaderRouterSelect} />}
            {currentUser && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px',
                color: 'var(--text-primary)',
                fontSize: '14px'
              }}>
                <span>
                  {currentUser.username} <span style={{ color: 'var(--text-muted)' }}>({currentUser.role})</span>
                </span>
                <button
                  onClick={handleLogout}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => e.target.style.background = 'var(--accent-primary)'}
                  onMouseOut={(e) => e.target.style.background = 'var(--bg-secondary)'}
                >
                  Logout
                </button>
              </div>
            )}
            <ClickUpAuthButton />
          </div>
        </div>

        {/* Navigation Menu - Only show on main pages, not on router detail page */}
        {!isRouterPage && (
          <nav className="app-nav">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`app-nav-link ${location.pathname === item.path ? 'active' : ''}`}
                title={item.title || item.label}
              >
                <span className="app-nav-icon">{item.icon}</span>
                <span className="app-nav-label">{item.label}</span>
              </Link>
            ))}
            {isAdmin && adminNavItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`app-nav-link ${location.pathname === item.path ? 'active' : ''}`}
                title={item.title || item.label}
              >
                <span className="app-nav-icon">{item.icon}</span>
                <span className="app-nav-label">{item.label}</span>
              </Link>
            ))}
          </nav>
        )}

        {/* Main Content */}
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={
              <ProtectedRoute>
                {isGuest ? (
                  <GuestDashboard />
                ) : (
                  <AnalyticsBeta onOpenRouter={handleHeaderRouterSelect} />
                )}
              </ProtectedRoute>
            } />
            <Route path="/users-activity" element={
              <ProtectedRoute requireAdmin>
                <Users />
              </ProtectedRoute>
            } />
            <Route path="/assignments" element={
              <ProtectedRoute requireAdmin>
                <DashboardV3 page="assignments" onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />
              </ProtectedRoute>
            } />
            <Route path="/stored" element={
              <ProtectedRoute requireAdmin>
                <DashboardV3 page="stored" onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />
              </ProtectedRoute>
            } />
            <Route path="/status" element={
              <ProtectedRoute requireAdmin>
                <DashboardV3 page="status" onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />
              </ProtectedRoute>
            } />
            <Route path="/returns" element={
              <ProtectedRoute requireAdmin>
                <ReturnsPage />
              </ProtectedRoute>
            } />
            <Route path="/decommissioned" element={
              <ProtectedRoute requireAdmin>
                <DecommissionedPage />
              </ProtectedRoute>
            } />
            <Route path="/router/:routerId" element={
              <ProtectedRoute>
                <RouterDetailPage />
              </ProtectedRoute>
            } />
            <Route path="/users" element={
              <ProtectedRoute requireAdmin>
                <UsersManagement />
              </ProtectedRoute>
            } />
            <Route path="/admin/debug" element={
              <ProtectedRoute requireAdmin>
                <AdminDebugTools />
              </ProtectedRoute>
            } />
          </Routes>
        </ErrorBoundary>
      </div>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
