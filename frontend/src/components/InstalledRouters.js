import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './InstalledRouters.css';

const API_BASE = process.env.REACT_APP_API_URL || 'https://routerlogger-production.up.railway.app';

const InstalledRouters = () => {
  const [installedRouters, setInstalledRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchInstalledRouters();
  }, []);

  const fetchInstalledRouters = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/router-properties/installed-routers`);
      if (!response.ok) throw new Error('Failed to fetch installed routers');
      const data = await response.json();
      setInstalledRouters(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching installed routers:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'short', 
      year: 'numeric' 
    });
  };

  const getDaysInstalled = (installedDate) => {
    if (!installedDate) return null;
    const date = new Date(installedDate);
    const now = new Date();
    const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    return days;
  };

  const getReviewDate = (installedDate) => {
    if (!installedDate) return null;
    const date = new Date(installedDate);
    date.setDate(date.getDate() + 92);
    return date;
  };

  const handleRouterClick = (routerId) => {
    navigate(`/router/${routerId}`);
  };

  if (loading) {
    return (
      <div className="installed-routers-card">
        <h3 className="installed-routers-title">Installed Routers</h3>
        <div className="installed-routers-loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="installed-routers-card">
        <h3 className="installed-routers-title">Installed Routers</h3>
        <div className="installed-routers-error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="installed-routers-card">
      <h3 className="installed-routers-title">
        Installed Routers
        <span className="installed-routers-count">{installedRouters.length}</span>
      </h3>
      
      {installedRouters.length === 0 ? (
        <div className="installed-routers-empty">
          No routers currently installed
        </div>
      ) : (
        <div className="installed-routers-table-wrap">
          <table className="installed-routers-table">
            <thead>
              <tr>
                <th>Router</th>
                <th>Property</th>
                <th>Installed</th>
                <th>Days</th>
                <th>92-Day Review</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {installedRouters.map((router) => {
                const daysInstalled = getDaysInstalled(router.installedAt);
                const reviewDate = getReviewDate(router.installedAt);
                const daysUntilReview = reviewDate ? Math.floor((reviewDate - new Date()) / (1000 * 60 * 60 * 24)) : null;
                
                return (
                  <tr key={router.routerId}>
                    <td>
                      <div className="ir-router-info">
                        <div className="ir-router-id">#{router.routerId}</div>
                        {router.routerName && (
                          <div className="ir-router-name">{router.routerName}</div>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="ir-property-name">{router.propertyName || 'Unknown'}</div>
                    </td>
                    <td>{formatDate(router.installedAt)}</td>
                    <td>
                      {daysInstalled !== null && (
                        <span className={`ir-days-badge ${daysInstalled > 92 ? 'ir-days-warning' : ''}`}>
                          {daysInstalled}d
                        </span>
                      )}
                    </td>
                    <td>
                      {reviewDate && (
                        <div className="ir-review-info">
                          <div>{formatDate(reviewDate)}</div>
                          {daysUntilReview !== null && (
                            <div className={`ir-review-countdown ${daysUntilReview < 0 ? 'overdue' : daysUntilReview <= 7 ? 'soon' : ''}`}>
                              {daysUntilReview < 0 
                                ? `${Math.abs(daysUntilReview)}d overdue` 
                                : daysUntilReview === 0 
                                ? 'Today!' 
                                : `in ${daysUntilReview}d`}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <button
                        className="ir-view-btn"
                        onClick={() => handleRouterClick(router.routerId)}
                        title="View router details"
                      >
                        View Router
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default InstalledRouters;
