import React, { useState, useEffect } from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import RMSAuthButton from './components/RMSAuthButton';
import TopRouters from './components/TopRouters';
import NetworkOverview from './components/NetworkOverview';
import DashboardV3 from './components/DashboardV3';
import RouterDashboard from './components/RouterDashboard';
import HeaderRouterSelect from './components/HeaderRouterSelect';
import { ToastContainer, toast } from 'react-toastify';
import { getRouters } from './services/api';
import 'react-toastify/dist/ReactToastify.css';
// import { subDays, startOfDay, endOfDay } from 'date-fns';

function AppContent() {
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [activeTab, setActiveTab] = useState('network'); // 'network' | 'router'
  const [timePreset] = useState({ type: 'rolling', value: 24 }); // rolling hours or calendar days
  const [dashboardVersion, setDashboardVersion] = useState('v3'); // 'v1' | 'v3'
  const [darkMode] = useState(true); // Dark mode enabled by default
  const navigate = useNavigate();
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
            setActiveTab('router');
            setDashboardVersion('v1');
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
  
  // Deprecated V1 date range state (no longer used)
  // const [dateRange, setDateRange] = useState({
  //   startDate: startOfDay(subDays(new Date(), 7)).toISOString(),
  //   endDate: endOfDay(new Date()).toISOString()
  // });

  // Removed quick-select handler per request

  // const handleFilterChange = (newRange) => {
  //   setDateRange(newRange);
  //   toast.info('Date range updated');
  // };

  // Header router selector should always open the Router details in V1
  const handleHeaderRouterSelect = (router) => {
    setSelectedRouter(router);
    setActiveTab('router');
    if (dashboardVersion !== 'v1') setDashboardVersion('v1');
    navigate(`/router/${router.router_id}`);
    const label = router.name ? `${router.name} (ID ${router.router_id})` : `ID ${router.router_id}`;
    toast.success(`Opening ${label}`);
  };

  // V3 Dashboard - if selected, render just the V3 component
  if (dashboardVersion === 'v3') {
    return (
      <div className={`app ${darkMode ? 'dark-mode' : ''}`}>
        <div className="container">
          <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems:'center', gap:16 }}>
            <div>
              <h1>🌐 RUT200 Router Logger Dashboard</h1>
              <p>Monitor and analyze your RUT200 router network in real-time</p>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <img src={process.env.PUBLIC_URL + '/Logo.png'} alt="Logo" style={{ height: 28, width: 'auto', borderRadius: 6, boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }} />
              <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.2)', padding: 4, borderRadius: 8 }}>
                <button 
                  className={`btn ${dashboardVersion === 'v1' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setDashboardVersion('v1')}
                  style={{ fontSize: 12 }}
                >
                  Router Log
                </button>
                <button 
                  className={`btn ${dashboardVersion === 'v3' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => {
                    setDashboardVersion('v3');
                    navigate('/');
                  }}
                  style={{ fontSize: 12 }}
                >
                  Dashboard
                </button>
              </div>
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
        <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems:'center', gap:16 }}>
          <div>
            <h1>🌐 RUT200 Router Logger Dashboard</h1>
            <p>Monitor and analyze your RUT200 router network in real-time</p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <img src={process.env.PUBLIC_URL + '/Logo.png'} alt="Logo" style={{ height: 28, width: 'auto', borderRadius: 6, boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }} />
            <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.2)', padding: 4, borderRadius: 8 }}>
              <button 
                className={`btn ${dashboardVersion === 'v1' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDashboardVersion('v1')}
                style={{ fontSize: 12 }}
              >
                Router Log
              </button>
              <button 
                className={`btn ${dashboardVersion === 'v3' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setDashboardVersion('v3');
                  navigate('/');
                }}
                style={{ fontSize: 12 }}
              >
                Dashboard
              </button>
            </div>
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
  return (
    <Routes>
      <Route path="/" element={<AppContent />} />
      <Route path="/router/:routerId" element={<AppContent />} />
    </Routes>
  );
}

export default App;
