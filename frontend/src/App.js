import React, { useState } from 'react';
import './App.css';
import RouterList from './components/RouterList';
import DateRangeFilter from './components/DateRangeFilter';
import UsageStats from './components/UsageStats';
import DataCharts from './components/DataCharts';
import LogsTable from './components/LogsTable';
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
    toast.success(`Selected router: ${router.router_id}`);
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

        <RouterList onSelectRouter={handleRouterSelect} />

        {selectedRouter && (
          <>
            <DateRangeFilter onFilterChange={handleFilterChange} />
            
            <UsageStats 
              routerId={selectedRouter.router_id}
              startDate={dateRange.startDate}
              endDate={dateRange.endDate}
            />

            <DataCharts 
              routerId={selectedRouter.router_id}
              startDate={dateRange.startDate}
              endDate={dateRange.endDate}
            />

            <LogsTable 
              routerId={selectedRouter.router_id}
              startDate={dateRange.startDate}
              endDate={dateRange.endDate}
            />
          </>
        )}

        {!selectedRouter && (
          <div className="card">
            <h2>👆 Get Started</h2>
            <p>Select a router from the list above to view its details, statistics, and logs.</p>
          </div>
        )}
      </div>

      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
}

export default App;
