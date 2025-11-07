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

  // Header router selector opens the Router details page
  const handleHeaderRouterSelect = (router) => {
    navigate(`/router/${router.router_id}`);
    const label = router.name ? `${router.name} (ID ${router.router_id})` : `ID ${router.router_id}`;
    toast.success(`Opening ${label}`);
  };

  // Determine if we're on a router page
  const isRouterPage = location.pathname.startsWith('/router/');
  
  // Navigation menu items
  const navItems = [
    { path: '/', label: 'Network Analytics', icon: '📊' },
    { path: '/assignments', label: 'Router Assignments', icon: '📍' },
    { path: '/stored', label: 'Stored Routers', icon: '📦' },
    { path: '/status', label: 'System Status', icon: '⚙️' },
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
            <Route path="/mobile" element={<MobilePage />} />
            <Route path="/router/:routerId" element={<RouterDetailPage />} />
          </Routes>
        </ErrorBoundary>
      </div>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
}

function App() {
  return <AppContent />;
}

export default App;
