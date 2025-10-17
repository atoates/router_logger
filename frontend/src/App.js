import React, { useState } from 'react';
import './App.css';
import RouterQuickSelect from './components/RouterQuickSelect';
import StatusSummary from './components/StatusSummary';
import ErrorBoundary from './components/ErrorBoundary';
import DateRangeFilter from './components/DateRangeFilter';
import UsageStats from './components/UsageStats';
import DataCharts from './components/DataCharts';
import LogsTable from './components/LogsTable';
import DeviceInfo from './components/DeviceInfo';
import RMSAuthButton from './components/RMSAuthButton';
import TopRouters from './components/TopRouters';
import NetworkOverview from './components/NetworkOverview';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { subDays, startOfDay, endOfDay } from 'date-fns';

function App() {
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [activeTab, setActiveTab] = useState('network'); // 'network' | 'router'
  const [timePreset, setTimePreset] = useState({ type: 'rolling', value: 24 }); // rolling hours or calendar days
  const [dateRange, setDateRange] = useState({
    startDate: startOfDay(subDays(new Date(), 7)).toISOString(),
    endDate: endOfDay(new Date()).toISOString()
  });

  const handleRouterSelect = (router) => {
    setSelectedRouter(router);
    const label = router.name ? `${router.name} (ID ${router.router_id})` : `ID ${router.router_id}`;
    toast.success(`Selected router: ${label}`);
  };

  const handleFilterChange = (newRange) => {
    setDateRange(newRange);
    toast.info('Date range updated');
  };

  return (
    <div className="app">
      <div className="container">
        <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems:'center', gap:16 }}>
          <div>
            <h1>🌐 RUT200 Router Logger Dashboard</h1>
            <p>Monitor and analyze your RUT200 router network in real-time</p>
          </div>
          <div>
            <RMSAuthButton variant="header" />
          </div>
        </div>

        {/* Top-level network status */}
        <ErrorBoundary>
          <StatusSummary />
        </ErrorBoundary>

        {/* RMS OAuth status moved to header; panel removed */}

        {/* Quick select by Name */}
        <ErrorBoundary>
          <RouterQuickSelect 
            onSelectRouter={handleRouterSelect}
            onClear={() => setSelectedRouter(null)}
          />
        </ErrorBoundary>

        {/* Tabs and time selectors */}
        <div className="card" style={{ display:'flex', alignItems:'center', gap:16, justifyContent:'space-between' }}>
          <div className="tabs">
            <button className={`btn ${activeTab==='network'?'btn-primary':'btn-secondary'}`} onClick={()=>setActiveTab('network')}>Network</button>
            <button className={`btn ${activeTab==='router'?'btn-primary':'btn-secondary'}`} onClick={()=>setActiveTab('router')} disabled={!selectedRouter}>Router</button>
          </div>
          <div className="time-selectors" style={{ display:'flex', gap:8 }}>
            <button className={`btn ${timePreset.type==='rolling'&&timePreset.value===24?'btn-primary':'btn-secondary'}`} onClick={()=>setTimePreset({type:'rolling', value:24})}>Last 24h</button>
            <button className={`btn ${timePreset.type==='days'&&timePreset.value===7?'btn-primary':'btn-secondary'}`} onClick={()=>setTimePreset({type:'days', value:7})}>7d</button>
            <button className={`btn ${timePreset.type==='days'&&timePreset.value===30?'btn-primary':'btn-secondary'}`} onClick={()=>setTimePreset({type:'days', value:30})}>30d</button>
            <button className={`btn ${timePreset.type==='days'&&timePreset.value===90?'btn-primary':'btn-secondary'}`} onClick={()=>setTimePreset({type:'days', value:90})}>90d</button>
          </div>
        </div>

        {activeTab==='router' && selectedRouter && (
          <>
            <ErrorBoundary>
              <DateRangeFilter onFilterChange={handleFilterChange} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DeviceInfo routerId={selectedRouter.router_id} />
            </ErrorBoundary>
            <ErrorBoundary>
              <UsageStats 
                routerId={selectedRouter.router_id}
                startDate={dateRange.startDate}
                endDate={dateRange.endDate}
              />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataCharts 
                routerId={selectedRouter.router_id}
                startDate={dateRange.startDate}
                endDate={dateRange.endDate}
              />
            </ErrorBoundary>
            <ErrorBoundary>
              <LogsTable 
                routerId={selectedRouter.router_id}
                startDate={dateRange.startDate}
                endDate={dateRange.endDate}
              />
            </ErrorBoundary>
          </>
  )}

        {activeTab==='network' && (
          <>
            <div className="card">
              <h2>👆 Get Started</h2>
              <p>Start typing a router name above to view its details, statistics, and logs.</p>
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

export default App;
