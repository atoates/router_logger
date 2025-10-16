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
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { subDays, startOfDay, endOfDay } from 'date-fns';

function App() {
  const [selectedRouter, setSelectedRouter] = useState(null);
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
        <div className="header">
          <h1>🌐 RUT200 Router Logger Dashboard</h1>
          <p>Monitor and analyze your RUT200 router network in real-time</p>
        </div>

        {/* Top-level network status */}
        <ErrorBoundary>
          <StatusSummary />
        </ErrorBoundary>

        {/* RMS OAuth Authentication */}
        <ErrorBoundary>
          <RMSAuthButton />
        </ErrorBoundary>

        {/* Quick select by Name */}
        <ErrorBoundary>
          <RouterQuickSelect 
            onSelectRouter={handleRouterSelect}
            onClear={() => setSelectedRouter(null)}
          />
        </ErrorBoundary>

        {selectedRouter && (
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

        {!selectedRouter && (
          <div className="card">
            <h2>👆 Get Started</h2>
            <p>Start typing a router name above to view its details, statistics, and logs.</p>
          </div>
        )}
      </div>

      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
}

export default App;
