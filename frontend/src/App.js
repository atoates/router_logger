import React, { useState, useEffect } from 'react';
import { Routes, Route, useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import RMSAuthButton from './components/RMSAuthButton';
import ClickUpAuthButton from './components/ClickUpAuthButton';
import DashboardV3 from './components/DashboardV3';
import RouterDashboard from './components/RouterDashboard';
import HeaderRouterSelect from './components/HeaderRouterSelect';
import { ToastContainer, toast } from 'react-toastify';
import { getRouters } from './services/api';
import 'react-toastify/dist/ReactToastify.css';

function AppContent() {
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [darkMode] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  
  // Load router from URL if present
  useEffect(() => {
    const loadRouterFromUrl = async () => {
      if (params.routerId) {
        try {
          const response = await getRouters();
          const routers = response.data || [];
          const router = routers.find(r => r.router_id === params.routerId);
          
          if (router) {
            setSelectedRouter(router);
            const label = router.name ? `${router.name} (ID ${router.router_id})` : `ID ${router.router_id}`;
            toast.success(`Opening ${label}`);
          } else {
            toast.error(`Router ${params.routerId} not found`);
            navigate('/');
          }
        } catch (error) {
          console.error('Error loading router:', error);
          toast.error('Failed to load router');
          navigate('/');
        }
      }
    };
    
    loadRouterFromUrl();
  }, [params.routerId, navigate]);

  // Header router selector opens the Router details page
  const handleHeaderRouterSelect = (router) => {
    setSelectedRouter(router);
    navigate(`/router/${router.router_id}`);
    const label = router.name ? `${router.name} (ID ${router.router_id})` : `ID ${router.router_id}`;
    toast.success(`Opening ${label}`);
  };

  // Determine if we're on a router page
  const isRouterPage = location.pathname.startsWith('/router/');
  
  // Navigation menu items
  const navItems = [
    { path: '/', label: '📊 Network Analytics', icon: '📊' },
    { path: '/assignments', label: '📍 Router Assignments', icon: '📍' },
    { path: '/stored', label: '📦 Stored Routers', icon: '📦' },
    { path: '/status', label: '⚙️ System Status', icon: '⚙️' },
  ];

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
          </nav>
        )}

        {/* Main Content */}
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<DashboardV3 page="network" onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />} />
            <Route path="/assignments" element={<DashboardV3 page="assignments" onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />} />
            <Route path="/stored" element={<DashboardV3 page="stored" onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />} />
            <Route path="/status" element={<DashboardV3 page="status" onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />} />
            <Route path="/router/:routerId" element={<RouterDashboard router={selectedRouter} />} />
          </Routes>
        </ErrorBoundary>
      </div>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );

  // V3 Dashboard - if selected, render just the V3 component
  if (dashboardVersion === 'v3') {
    return (
      <div className={`app ${darkMode ? 'dark-mode' : ''}`}>
        <div className="container">
          <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems:'center', gap:16, padding: '16px 0' }}>
            <img 
              src="/Logo.png" 
              alt="RouterLogger" 
              style={{ height: '60px', cursor: 'pointer', padding: '8px' }}
              onClick={handleLogoClick}
              title="Back to Dashboard"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <HeaderRouterSelect onSelect={handleHeaderRouterSelect} />
              <RMSAuthButton variant="header" />
            </div>
          </div>
          <ErrorBoundary>
            <DashboardV3 onOpenRouter={handleHeaderRouterSelect} defaultDarkMode={true} />
          </ErrorBoundary>
        </div>
        <ToastContainer position="bottom-right" autoClose={3000} />
      </div>
    );
  }

  // V1 Dashboard - original layout
  return (
    <div className={`app ${darkMode ? 'dark-mode' : ''}`}>
      <div className="container">
        <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems:'center', gap:16, padding: '16px 0' }}>
          <img 
            src="/Logo.png" 
            alt="RouterLogger" 
            style={{ height: '60px', cursor: 'pointer', padding: '8px' }}
            onClick={handleLogoClick}
            title="Back to Dashboard"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <HeaderRouterSelect onSelect={handleHeaderRouterSelect} />
            <RMSAuthButton variant="header" />
          </div>
        </div>

        {/* Top-level network status removed as requested */}

        {/* RMS OAuth status moved to header; panel removed */}

        {/* Removed: Quick select and tabs/time controls per request */}

        {activeTab==='router' && selectedRouter && (
          <ErrorBoundary>
            <RouterDashboard router={selectedRouter} />
          </ErrorBoundary>
        )}

        {activeTab==='network' && (
          <>
            <div className="card">
              <h2>👆 Get Started</h2>
              <p>Use the router selector in the header to open a router’s details. Network overview below defaults to the last 24 hours.</p>
            </div>
            <ErrorBoundary>
              {timePreset.type==='rolling' ? (
                <NetworkOverview days={null} hours={timePreset.value} mode="rolling" />
              ) : (
                <NetworkOverview days={timePreset.value} mode="calendar" />
              )}
            </ErrorBoundary>
            <ErrorBoundary>
              {timePreset.type==='rolling' ? (
                <TopRouters hours={timePreset.value} rolling limit={5} />
              ) : (
                <TopRouters days={timePreset.value} limit={5} />
              )}
            </ErrorBoundary>
          </>
        )}
      </div>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
}

function App() {
  return <AppContent />;
}

export default App;
