import React, { useState, useEffect } from 'react';
import { Routes, Route, useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import RMSAuthButton from './components/RMSAuthButton';
import ClickUpAuthButton from './components/ClickUpAuthButton';
import DashboardV3 from './components/DashboardV3';
import RouterDashboard from './components/RouterDashboard';
import HeaderRouterSelect from './components/HeaderRouterSelect';
import MobilePage from './pages/MobilePage';
import ReturnsPage from './components/ReturnsPage';
import DecommissionedPage from './components/DecommissionedPage';
import LoginPage from './components/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import UsersManagement from './components/UsersManagement';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastContainer, toast } from 'react-toastify';
import { getRouters } from './services/api';
import 'react-toastify/dist/ReactToastify.css';

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
  const { currentUser, logout, isAdmin } = useAuth();

  // Auto-redirect mobile users to /mobile (only on homepage)
  useEffect(() => {
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isHomePage = location.pathname === '/';
    
    if (isMobileDevice && isHomePage) {
      navigate('/mobile');
    }
  }, [location.pathname, navigate]);

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

  // Determine if we're on a router page, mobile page, or login page
  const isRouterPage = location.pathname.startsWith('/router/');
  const isMobilePage = location.pathname === '/mobile';
  const isLoginPage = location.pathname === '/login';
  
  // Navigation menu items
  const navItems = [
    { path: '/', label: 'Network Analytics', icon: '📊' },
    { path: '/assignments', label: 'Router Assignments', icon: '📍' },
    { path: '/stored', label: 'Stored Routers', icon: '📦' },
    { path: '/returns', label: 'Returns', icon: '🔄' },
    { path: '/decommissioned', label: 'Decommissioned', icon: '⚠️' },
    { path: '/status', label: 'System Status', icon: '⚙️' },
  ];

  // Admin-only navigation items
  const adminNavItems = [
    { path: '/users', label: 'User Management', icon: '👥' },
  ];

  // If mobile page or login page, render standalone without header/nav
  if (isMobilePage) {
    return (
      <ErrorBoundary>
        <MobilePage />
      </ErrorBoundary>
    );
  }

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
              <h1 className="app-title">VacatAd Routers Dashboard</h1>
              <p className="app-subtitle">Monitor router network and property assignments</p>
            </Link>
          </div>
          <div className="app-header-right">
            <HeaderRouterSelect onSelect={handleHeaderRouterSelect} />
            {currentUser && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px',
                color: '#e2e8f0',
                fontSize: '14px'
              }}>
                <span>
                  {currentUser.username} <span style={{ color: '#a0aec0' }}>({currentUser.role})</span>
                </span>
                <button
                  onClick={handleLogout}
                  style={{
                    padding: '8px 16px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.2)'}
                  onMouseOut={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.1)'}
                >
                  Logout
                </button>
              </div>
            )}
            <ClickUpAuthButton />
            <RMSAuthButton variant="header" />
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
                <DashboardV3 page="network" onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />
              </ProtectedRoute>
            } />
            <Route path="/assignments" element={
              <ProtectedRoute>
                <DashboardV3 page="assignments" onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />
              </ProtectedRoute>
            } />
            <Route path="/stored" element={
              <ProtectedRoute>
                <DashboardV3 page="stored" onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />
              </ProtectedRoute>
            } />
            <Route path="/status" element={
              <ProtectedRoute>
                <DashboardV3 page="status" onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />
              </ProtectedRoute>
            } />
            <Route path="/returns" element={
              <ProtectedRoute>
                <ReturnsPage />
              </ProtectedRoute>
            } />
            <Route path="/decommissioned" element={
              <ProtectedRoute>
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
