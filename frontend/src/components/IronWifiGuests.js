import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './IronWifiGuests.css';

// Custom hook for debouncing
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

function IronWifiGuests() {
  const [guests, setGuests] = useState([]);
  const [guestsTotal, setGuestsTotal] = useState(0);
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);
  const [status, setStatus] = useState(null);
  const [webhookHistory, setWebhookHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [activeTab, setActiveTab] = useState('guests');
  const [displayLimit, setDisplayLimit] = useState(100);
  const searchInputRef = useRef(null);
  const { getAuthHeaders, API_URL } = useAuth();

  // Debounce search input - waits 300ms after user stops typing
  const debouncedSearch = useDebounce(searchInput, 300);

  // Fetch all data (status, guests, webhooks)
  const fetchData = useCallback(async (searchTerm = '') => {
    try {
      setLoading(true);
      setError(null);

      // Fetch in parallel
      const [statusRes, guestsRes, webhookRes, totalRes] = await Promise.all([
        fetch(`${API_URL}/api/ironwifi/status`, { headers: getAuthHeaders() }),
        fetch(`${API_URL}/api/ironwifi/guests?limit=${displayLimit}&search=${encodeURIComponent(searchTerm)}`, { headers: getAuthHeaders() }),
        fetch(`${API_URL}/api/ironwifi/webhook/history?limit=20`, { headers: getAuthHeaders() }),
        // Also fetch unfiltered count for comparison
        searchTerm ? fetch(`${API_URL}/api/ironwifi/guests?limit=1`, { headers: getAuthHeaders() }) : Promise.resolve(null)
      ]);

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setStatus(statusData);
      }

      if (guestsRes.ok) {
        const guestsData = await guestsRes.json();
        setGuests(guestsData.guests || []);
        setGuestsTotal(guestsData.total || guestsData.guests?.length || 0);
        
        // Set unfiltered total
        if (!searchTerm) {
          setUnfilteredTotal(guestsData.total || guestsData.guests?.length || 0);
        }
      }

      // Get unfiltered total if we have a search
      if (totalRes && totalRes.ok) {
        const totalData = await totalRes.json();
        setUnfilteredTotal(totalData.total || 0);
      }

      if (webhookRes.ok) {
        const webhookData = await webhookRes.json();
        setWebhookHistory(webhookData.webhooks || []);
      }
    } catch (err) {
      console.error('Error fetching IronWifi data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
      setSearching(false);
    }
  }, [API_URL, getAuthHeaders, displayLimit]);

  // Initial load
  useEffect(() => {
    fetchData('');
  }, []);

  // Trigger search when debounced value changes
  useEffect(() => {
    if (debouncedSearch !== undefined) {
      setSearching(true);
      fetchData(debouncedSearch);
    }
  }, [debouncedSearch, fetchData]);

  // Re-fetch when display limit changes
  useEffect(() => {
    fetchData(debouncedSearch);
  }, [displayLimit]);

  const handleSync = async () => {
    try {
      setSyncing(true);
      const response = await fetch(`${API_URL}/api/ironwifi/sync/guests`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pages: 10 })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Sync complete! Fetched ${result.fetched} guests, ${result.inserted} new, ${result.updated} updated`);
        fetchData();
      } else {
        const errorData = await response.json();
        alert(`Sync failed: ${errorData.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Sync error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('This will DELETE all cached guest data and re-sync fresh from IronWifi. Continue?')) {
      return;
    }
    
    try {
      setSyncing(true);
      const response = await fetch(`${API_URL}/api/ironwifi/reset-guests`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pages: 10, confirm: 'yes' })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Reset complete! Deleted ${result.deleted}, inserted ${result.inserted} fresh records`);
        fetchData();
      } else {
        const errorData = await response.json();
        alert(`Reset failed: ${errorData.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Reset error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatRelativeTime = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  // Highlight matching text in search results
  const highlightText = useCallback((text, highlight) => {
    if (!text || !highlight || highlight.length < 2) return text;
    
    const parts = text.toString().split(new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    
    return parts.map((part, i) => 
      part.toLowerCase() === highlight.toLowerCase() 
        ? <mark key={i} className="search-highlight">{part}</mark>
        : part
    );
  }, []);

  if (loading) {
    return (
      <div className="ironwifi-container">
        <div className="ironwifi-loading">Loading IronWifi data...</div>
      </div>
    );
  }

  return (
    <div className="ironwifi-container">
      {/* Header */}
      <div className="ironwifi-header">
        <div className="ironwifi-title">
          <h1>📶 WiFi Guest Logins</h1>
          <p>Guest authentication data from IronWifi captive portal</p>
        </div>
        <div className="ironwifi-actions">
          <button 
            className="ironwifi-sync-btn"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? '⏳ Syncing...' : '🔄 Sync Guests'}
          </button>
          <button 
            className="ironwifi-reset-btn"
            onClick={handleReset}
            disabled={syncing}
            title="Delete all and re-sync fresh"
          >
            🗑️ Reset & Re-sync
          </button>
          <button 
            className="ironwifi-refresh-btn"
            onClick={fetchData}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="ironwifi-status-cards">
        <div className="ironwifi-card">
          <div className="ironwifi-card-icon">👥</div>
          <div className="ironwifi-card-content">
            <div className="ironwifi-card-value">{guestsTotal.toLocaleString()}</div>
            <div className="ironwifi-card-label">Total Guests in DB</div>
          </div>
        </div>
        <div className="ironwifi-card">
          <div className="ironwifi-card-icon">{status?.apiConnected ? '✅' : '❌'}</div>
          <div className="ironwifi-card-content">
            <div className="ironwifi-card-value">{status?.apiConnected ? 'Connected' : 'Disconnected'}</div>
            <div className="ironwifi-card-label">API Status</div>
          </div>
        </div>
        <div className="ironwifi-card">
          <div className="ironwifi-card-icon">📨</div>
          <div className="ironwifi-card-content">
            <div className="ironwifi-card-value">{webhookHistory.length}</div>
            <div className="ironwifi-card-label">Recent Webhooks</div>
          </div>
        </div>
        <div className="ironwifi-card">
          <div className="ironwifi-card-icon">📊</div>
          <div className="ironwifi-card-content">
            <div className="ironwifi-card-value">
              {status?.apiUsage?.callsMade || 0}/{status?.apiUsage?.limit || 1000}
            </div>
            <div className="ironwifi-card-label">API Calls (hourly)</div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="ironwifi-error">
          ⚠️ {error}
        </div>
      )}

      {/* Tabs */}
      <div className="ironwifi-tabs">
        <button 
          className={`ironwifi-tab ${activeTab === 'guests' ? 'active' : ''}`}
          onClick={() => setActiveTab('guests')}
        >
          👥 Guests ({guests.length}{guestsTotal > guests.length ? ` of ${guestsTotal.toLocaleString()}` : ''})
        </button>
        <button 
          className={`ironwifi-tab ${activeTab === 'webhooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('webhooks')}
        >
          📨 Webhook Debug ({webhookHistory.length})
        </button>
      </div>

      {/* Guests Tab */}
      {activeTab === 'guests' && (
        <div className="ironwifi-panel">
          <div className="ironwifi-search-container">
            <div className={`ironwifi-search ${searchInput ? 'has-value' : ''} ${searching ? 'is-searching' : ''}`}>
              <span className="search-icon">🔍</span>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search by email, name, or phone..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchInput('');
                    searchInputRef.current?.blur();
                  }
                }}
              />
              {searching && <span className="search-spinner"></span>}
              {searchInput && !searching && (
                <button 
                  className="search-clear" 
                  onClick={() => setSearchInput('')}
                  title="Clear search (Esc)"
                >
                  ✕
                </button>
              )}
            </div>
            
            {/* Search Results Info */}
            {searchInput && (
              <div className="search-results-info">
                {searching ? (
                  <span className="searching-text">Searching...</span>
                ) : (
                  <span>
                    Found <strong>{guestsTotal.toLocaleString()}</strong> match{guestsTotal !== 1 ? 'es' : ''} 
                    {unfilteredTotal > 0 && ` of ${unfilteredTotal.toLocaleString()} total`}
                    {guestsTotal === 0 && <span className="no-match-hint"> — try a different search term</span>}
                  </span>
                )}
              </div>
            )}
          </div>

          {guests.length === 0 ? (
            <div className="ironwifi-empty">
              <p>No guests found. Click "Sync Guests" to fetch from IronWifi.</p>
            </div>
          ) : (
            <div className="ironwifi-table-container">
              <table className="ironwifi-table">
                <thead>
                  <tr>
                    <th>Email / Username</th>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Last Auth</th>
                    <th>First Seen</th>
                    <th>Auth Count</th>
                  </tr>
                </thead>
                <tbody>
                  {guests.map((guest) => (
                    <tr key={guest.id}>
                      <td>
                        <div className="ironwifi-email">
                          {highlightText(guest.username || guest.email, searchInput)}
                        </div>
                        {guest.email && guest.email !== guest.username && (
                          <div className="ironwifi-secondary">
                            {highlightText(guest.email, searchInput)}
                          </div>
                        )}
                      </td>
                      <td>{highlightText(guest.fullname, searchInput) || '-'}</td>
                      <td>{highlightText(guest.phone, searchInput) || '-'}</td>
                      <td>
                        <div className="ironwifi-time">{formatRelativeTime(guest.auth_date)}</div>
                        <div className="ironwifi-secondary">{formatDate(guest.auth_date)}</div>
                      </td>
                      <td>{formatDate(guest.first_seen_at)}</td>
                      <td>
                        <span className="ironwifi-badge">{guest.auth_count || 1}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {/* Load More */}
              {guestsTotal > guests.length && (
                <div className="ironwifi-load-more">
                  <button 
                    onClick={() => setDisplayLimit(prev => prev + 200)}
                    className="ironwifi-load-btn"
                  >
                    Load More ({guests.length} of {guestsTotal.toLocaleString()} shown)
                  </button>
                  <button 
                    onClick={() => setDisplayLimit(guestsTotal)}
                    className="ironwifi-load-all-btn"
                  >
                    Show All
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Webhooks Tab */}
      {activeTab === 'webhooks' && (
        <div className="ironwifi-panel">
          <div className="ironwifi-info">
            <strong>ℹ️ About Webhooks:</strong> IronWifi sends RADIUS accounting data via webhook. 
            This includes the <code>Called-Station-Id</code> (router MAC) which allows matching guests to specific routers.
            {webhookHistory.length === 0 && (
              <p style={{ marginTop: '10px', color: 'var(--warning-color)' }}>
                ⚠️ No webhooks received yet. Check IronWifi Console → Reports → Report Scheduler
              </p>
            )}
          </div>

          {webhookHistory.length === 0 ? (
            <div className="ironwifi-empty">
              <p>No webhook data received yet.</p>
              <p>Configure in IronWifi Console: Reports → Report Scheduler → Create Report</p>
              <ul style={{ textAlign: 'left', marginTop: '10px' }}>
                <li>Type: RADIUS Accounting</li>
                <li>Delivery: Webhook (JSON)</li>
                <li>URL: <code>{API_URL}/api/ironwifi/webhook</code></li>
                <li>Frequency: Hourly</li>
              </ul>
            </div>
          ) : (
            <div className="ironwifi-table-container">
              <table className="ironwifi-table">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Content Type</th>
                    <th>Records</th>
                    <th>Processed</th>
                    <th>Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {webhookHistory.map((wh) => (
                    <tr key={wh.id}>
                      <td>{formatDate(wh.received_at)}</td>
                      <td><code>{wh.content_type}</code></td>
                      <td>{wh.record_count}</td>
                      <td>{wh.processed ? '✅' : '⏳'}</td>
                      <td>
                        <details>
                          <summary>View</summary>
                          <pre className="ironwifi-json">{wh.sample_preview}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default IronWifiGuests;

