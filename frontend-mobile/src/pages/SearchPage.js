import React, { useState, useEffect } from 'react';
import { getRouters } from '../services/api';
import RouterCard from '../components/RouterCard';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { getRouterStatus } from '../components/StatusBadge';
import './SearchPage.css';

function SearchPage() {
  const [routers, setRouters] = useState([]);
  const [filteredRouters, setFilteredRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, online, offline, alerts, assigned, unassigned
  const [statusCounts, setStatusCounts] = useState({});

  useEffect(() => {
    fetchRouters();
  }, []);

  // Calculate status counts when routers change
  useEffect(() => {
    const counts = {
      all: routers.length,
      online: 0,
      offline: 0,
      alerts: 0,
      working: 0,
      assigned: 0,
      unassigned: 0
    };

    routers.forEach(router => {
      const status = getRouterStatus(router);
      const state = router.current_status || router.current_state;
      const isOnline = state === 'online' || 
                      state === 'Online' ||
                      state === 1 || 
                      state === '1' || 
                      state === true ||
                      (typeof state === 'string' && state.toLowerCase() === 'online');

      if (isOnline) counts.online++;
      else counts.offline++;

      if (status.key === 'attention') counts.alerts++;
      if (status.key === 'working') counts.working++;
      if (status.key === 'assigned' || status.key === 'ready') counts.assigned++;
      if (status.key === 'stock' || status.key === 'available') counts.unassigned++;
    });

    setStatusCounts(counts);
  }, [routers]);

  useEffect(() => {
    filterRouters();
  }, [routers, searchQuery, statusFilter]);

  const fetchRouters = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const response = await getRouters(forceRefresh);
      const routerList = Array.isArray(response.data) ? response.data : [];
      setRouters(routerList);
    } catch (err) {
      console.error('Error fetching routers:', err);
      setError(err.response?.data?.error || err.message || 'Failed to load routers');
    } finally {
      setLoading(false);
    }
  };

  const filterRouters = () => {
    let filtered = [...routers];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(router => {
        const id = router.router_id?.toString().toLowerCase() || '';
        const name = router.name?.toLowerCase() || '';
        return id.includes(query) || name.includes(query);
      });
    }

    // Status filter
    if (statusFilter === 'alerts') {
      // Show only offline routers that have a location linked (should be online)
      filtered = filtered.filter(router => {
        // Must have a location linked
        if (!router.clickup_location_task_id) {
          return false;
        }
        // Must be offline
        const state = router.current_status || router.current_state;
        const isOnline = state === 'online' || 
                        state === 'Online' ||
                        state === 1 || 
                        state === '1' || 
                        state === true ||
                        (typeof state === 'string' && state.toLowerCase() === 'online');
        return !isOnline;
      });
    } else if (statusFilter !== 'all') {
      filtered = filtered.filter(router => {
        // Handle both current_status and current_state (for compatibility)
        const state = router.current_status || router.current_state;
        // Handle various formats: 'online', 'offline', 1, 0, '1', '0', true, false, 'Online'
        const isOnline = state === 'online' || 
                        state === 'Online' ||
                        state === 1 || 
                        state === '1' || 
                        state === true ||
                        (typeof state === 'string' && state.toLowerCase() === 'online');
        return statusFilter === 'online' ? isOnline : !isOnline;
      });
    }

    setFilteredRouters(filtered);
  };

  if (loading) {
    return (
      <div className="page-container">
        <LoadingSpinner text="Loading routers..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <ErrorMessage message={error} onRetry={fetchRouters} />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Router Search</h1>
        <button 
          onClick={() => fetchRouters(true)}
          className="refresh-button"
          aria-label="Refresh"
          disabled={loading}
        >
          🔄
        </button>
      </div>

      <div className="search-filters">
        <input
          type="text"
          placeholder="Search by ID or name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
        
        <div className="status-filters">
          <button
            className={`filter-button ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All <span className="filter-count">{statusCounts.all || 0}</span>
          </button>
          <button
            className={`filter-button filter-button-online ${statusFilter === 'online' ? 'active' : ''}`}
            onClick={() => setStatusFilter('online')}
          >
            🟢 <span className="filter-count">{statusCounts.online || 0}</span>
          </button>
          <button
            className={`filter-button filter-button-offline ${statusFilter === 'offline' ? 'active' : ''}`}
            onClick={() => setStatusFilter('offline')}
          >
            ⚪ <span className="filter-count">{statusCounts.offline || 0}</span>
          </button>
          <button
            className={`filter-button filter-button-alert ${statusFilter === 'alerts' ? 'active' : ''}`}
            onClick={() => setStatusFilter('alerts')}
            title="Offline routers with linked locations (need attention)"
          >
            🔴 <span className="filter-count">{statusCounts.alerts || 0}</span>
          </button>
        </div>
      </div>

      <div className="routers-list">
        {filteredRouters.length === 0 ? (
          <div className="empty-state">
            <p>
              {statusFilter === 'alerts' 
                ? 'No offline routers with linked locations' 
                : 'No routers found'}
            </p>
            {searchQuery && statusFilter !== 'alerts' && (
              <p className="empty-hint">Try adjusting your search</p>
            )}
            {statusFilter === 'alerts' && (
              <p className="empty-hint">All installed routers are online</p>
            )}
          </div>
        ) : (
          filteredRouters.map(router => (
            <RouterCard 
              key={router.router_id} 
              router={router}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default SearchPage;

