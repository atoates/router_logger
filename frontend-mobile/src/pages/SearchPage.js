import React, { useState, useEffect } from 'react';
import { getRouters } from '../services/api';
import RouterCard from '../components/RouterCard';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import './SearchPage.css';

function SearchPage() {
  const [routers, setRouters] = useState([]);
  const [filteredRouters, setFilteredRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, online, offline

  useEffect(() => {
    fetchRouters();
  }, []);

  useEffect(() => {
    filterRouters();
  }, [routers, searchQuery, statusFilter]);

  const fetchRouters = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getRouters();
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
    if (statusFilter !== 'all') {
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
          onClick={fetchRouters}
          className="refresh-button"
          aria-label="Refresh"
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
            All
          </button>
          <button
            className={`filter-button ${statusFilter === 'online' ? 'active' : ''}`}
            onClick={() => setStatusFilter('online')}
          >
            Online
          </button>
          <button
            className={`filter-button ${statusFilter === 'offline' ? 'active' : ''}`}
            onClick={() => setStatusFilter('offline')}
          >
            Offline
          </button>
        </div>
      </div>

      <div className="routers-list">
        {filteredRouters.length === 0 ? (
          <div className="empty-state">
            <p>No routers found</p>
            {searchQuery && <p className="empty-hint">Try adjusting your search</p>}
          </div>
        ) : (
          filteredRouters.map(router => (
            <RouterCard 
              key={router.router_id} 
              router={router}
              onUpdate={fetchRouters}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default SearchPage;

