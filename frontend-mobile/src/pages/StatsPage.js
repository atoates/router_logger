import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTopRouters, getRouters } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import './StatsPage.css';

const ITEMS_PER_PAGE = 10;

function StatsPage() {
  const [routers, setRouters] = useState([]);
  const [displayedRouters, setDisplayedRouters] = useState([]);
  const [routersWithAssignees, setRoutersWithAssignees] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const observerTarget = useRef(null);
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  useEffect(() => {
    fetchRouters();
    fetchRoutersWithAssignees();
  }, []);

  useEffect(() => {
    // Display first 10 routers
    setDisplayedRouters(routers.slice(0, ITEMS_PER_PAGE));
    setHasMore(routers.length > ITEMS_PER_PAGE);
  }, [routers]);

  const fetchRouters = async () => {
    try {
      setLoading(true);
      setError(null);
      // Fetch top routers for last 24 hours (days=1), limit 100
      const response = await getTopRouters(1, 100);
      const routersData = Array.isArray(response.data) ? response.data : [];
      // Already sorted by total_bytes DESC from API
      setRouters(routersData);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load routers');
    } finally {
      setLoading(false);
    }
  };

  const fetchRoutersWithAssignees = async () => {
    try {
      // Fetch full router data to get assignee information
      const response = await getRouters();
      const routersData = Array.isArray(response.data) ? response.data : [];
      
      // Create a map of router_id -> assignees
      const assigneesMap = {};
      routersData.forEach(router => {
        let assignees = router.clickup_assignees;
        if (assignees) {
          if (typeof assignees === 'string') {
            try {
              assignees = JSON.parse(assignees);
            } catch {
              assignees = assignees;
            }
          }
          if (Array.isArray(assignees) && assignees.length > 0) {
            assigneesMap[router.router_id] = assignees;
          }
        }
      });
      
      setRoutersWithAssignees(assigneesMap);
    } catch (err) {
      console.error('Error fetching router assignees:', err);
      // Don't fail the whole page if this fails
    }
  };

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    // Simulate slight delay for better UX
    setTimeout(() => {
      const currentCount = displayedRouters.length;
      const nextRouters = routers.slice(0, currentCount + ITEMS_PER_PAGE);
      setDisplayedRouters(nextRouters);
      setHasMore(nextRouters.length < routers.length);
      setLoadingMore(false);
    }, 300);
  }, [loadingMore, hasMore, displayedRouters.length, routers]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, loadingMore, loadMore]);

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const handleRouterClick = (routerId, e) => {
    // Don't navigate if clicking the assign button
    if (e?.target?.closest('.assign-button')) {
      return;
    }
    navigate(`/router/${routerId}`);
  };

  const handleAssignClick = (e, routerId) => {
    e.stopPropagation();
    navigate(`/router/${routerId}`);
  };

  const isRouterUnassigned = (routerId) => {
    const assignees = routersWithAssignees[routerId];
    return !assignees || (Array.isArray(assignees) && assignees.length === 0);
  };

  if (loading && routers.length === 0) {
    return (
      <div className="page-container">
        <LoadingSpinner text="Loading routers..." />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>24h Statistics</h1>
        <p className="page-subtitle">Routers sorted by data usage</p>
      </div>

      {error && (
        <ErrorMessage 
          message={error} 
          onRetry={fetchRouters}
        />
      )}

      {routers.length === 0 && !loading && (
        <div className="empty-state">
          <p>No routers found</p>
        </div>
      )}

      {displayedRouters.length > 0 && (
        <div className="stats-router-list">
          {displayedRouters.map((router) => {
            const isUnassigned = isRouterUnassigned(router.router_id);
            return (
              <div
                key={router.router_id}
                className="stats-router-card"
                onClick={(e) => handleRouterClick(router.router_id, e)}
              >
                <div className="stats-router-header">
                  <div className="stats-router-id">#{router.router_id}</div>
                  {router.name && (
                    <div className="stats-router-name">{router.name}</div>
                  )}
                </div>
                
                <div className="stats-router-usage">
                  <div className="stats-usage-item">
                    <span className="stats-usage-label">Total Usage:</span>
                    <span className="stats-usage-value">
                      {formatBytes(router.total_bytes || 0)}
                    </span>
                  </div>
                  <div className="stats-usage-breakdown">
                    <span className="stats-usage-sent">
                      ↑ {formatBytes(router.tx_bytes || 0)}
                    </span>
                    <span className="stats-usage-received">
                      ↓ {formatBytes(router.rx_bytes || 0)}
                    </span>
                  </div>
                </div>

                {isAdmin && isUnassigned && (
                  <button
                    className="assign-button"
                    onClick={(e) => handleAssignClick(e, router.router_id)}
                  >
                    Assign Router
                  </button>
                )}
              </div>
            );
          })}
          
          {/* Infinite scroll trigger */}
          <div ref={observerTarget} className="infinite-scroll-trigger">
            {loadingMore && (
              <LoadingSpinner text="Loading more..." />
            )}
            {!hasMore && displayedRouters.length > 0 && (
              <div className="end-of-list">
                <p>All routers loaded</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default StatsPage;




