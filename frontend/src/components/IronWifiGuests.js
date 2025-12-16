import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { uploadIronwifiCSV, getIronwifiUploadStats } from '../services/api';
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
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [activeTab, setActiveTab] = useState('guests');
  const [displayLimit, setDisplayLimit] = useState(100);
  const searchInputRef = useRef(null);
  const { getAuthHeaders, API_URL } = useAuth();
  
  // Upload state
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadStats, setUploadStats] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

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

  // Fetch upload stats when upload tab is selected
  useEffect(() => {
    if (activeTab === 'upload') {
      fetchUploadStats();
    }
  }, [activeTab]);

  const fetchUploadStats = async () => {
    try {
      const response = await getIronwifiUploadStats();
      setUploadStats(response.data);
    } catch (err) {
      console.error('Error fetching upload stats:', err);
    }
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndSetFile(file);
    }
  };

  const validateAndSetFile = (file) => {
    if (!file.name.endsWith('.csv')) {
      setUploadResult({ success: false, error: 'Please select a CSV file' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      setUploadResult({ success: false, error: 'File too large. Maximum 10MB.' });
      return;
    }
    setUploadFile(file);
    setUploadResult(null);
  };

  // Handle drag and drop
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      validateAndSetFile(file);
    }
  };

  // Upload the file
  const handleUpload = async () => {
    if (!uploadFile) return;

    setUploading(true);
    setUploadResult(null);

    try {
      // Read file content
      const text = await uploadFile.text();
      
      // Send to backend
      const response = await uploadIronwifiCSV(text);
      
      setUploadResult({
        success: true,
        ...response.data
      });
      
      // Refresh stats and guest list
      fetchUploadStats();
      fetchData(debouncedSearch);
      
      // Clear file
      setUploadFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
    } catch (err) {
      setUploadResult({
        success: false,
        error: err.response?.data?.error || err.message || 'Upload failed'
      });
    } finally {
      setUploading(false);
    }
  };

  const clearUpload = () => {
    setUploadFile(null);
    setUploadResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

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
            className="ironwifi-refresh-btn"
            onClick={() => fetchData(debouncedSearch)}
            disabled={loading}
          >
            {loading ? '⏳ Loading...' : '↻ Refresh'}
          </button>
          <span className="ironwifi-sync-info" title="Data syncs automatically every hour from IronWifi API">
            ⏱️ Auto-sync hourly
          </span>
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
        <button 
          className={`ironwifi-tab ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          📤 Upload CSV
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
              <p>No guests found. Data syncs automatically every hour from IronWifi.</p>
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

      {/* Upload Tab */}
      {activeTab === 'upload' && (
        <div className="ironwifi-panel">
          <div className="ironwifi-info">
            <strong>📤 Upload IronWifi Export</strong>
            <p style={{ marginTop: '8px' }}>
              Upload a CSV export from IronWifi Console to import guest registration data.
              Go to <strong>IronWifi Console → Reports → Export</strong> and download the Guest Registrations report.
            </p>
          </div>

          {/* Upload Zone */}
          <div 
            className={`upload-zone ${dragActive ? 'drag-active' : ''} ${uploadFile ? 'has-file' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => !uploadFile && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            
            {uploadFile ? (
              <div className="upload-file-info">
                <div className="upload-file-icon">📄</div>
                <div className="upload-file-details">
                  <div className="upload-file-name">{uploadFile.name}</div>
                  <div className="upload-file-size">
                    {(uploadFile.size / 1024).toFixed(1)} KB
                  </div>
                </div>
                <button 
                  className="upload-clear-btn"
                  onClick={(e) => { e.stopPropagation(); clearUpload(); }}
                  title="Remove file"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="upload-placeholder">
                <div className="upload-icon">📁</div>
                <div className="upload-text">
                  <strong>Drop CSV file here</strong>
                  <span>or click to browse</span>
                </div>
              </div>
            )}
          </div>

          {/* Upload Button */}
          {uploadFile && (
            <div className="upload-actions">
              <button 
                className="upload-btn"
                onClick={handleUpload}
                disabled={uploading}
              >
                {uploading ? '⏳ Uploading...' : '📤 Upload & Process'}
              </button>
            </div>
          )}

          {/* Upload Result */}
          {uploadResult && (
            <div className={`upload-result ${uploadResult.success ? 'success' : 'error'}`}>
              {uploadResult.success ? (
                <>
                  <div className="upload-result-header">
                    ✅ Upload Successful
                  </div>
                  <div className="upload-result-stats">
                    <div className="upload-stat">
                      <span className="upload-stat-value">{uploadResult.results?.total || 0}</span>
                      <span className="upload-stat-label">Total Records</span>
                    </div>
                    <div className="upload-stat">
                      <span className="upload-stat-value">{uploadResult.results?.inserted || 0}</span>
                      <span className="upload-stat-label">New Guests</span>
                    </div>
                    <div className="upload-stat">
                      <span className="upload-stat-value">{uploadResult.results?.updated || 0}</span>
                      <span className="upload-stat-label">Updated</span>
                    </div>
                    <div className="upload-stat">
                      <span className="upload-stat-value">{uploadResult.results?.linkedToRouters || 0}</span>
                      <span className="upload-stat-label">Linked to Routers</span>
                    </div>
                  </div>
                  {uploadResult.columnsFound && (
                    <div className="upload-result-columns">
                      <strong>Columns processed:</strong> {uploadResult.columnsFound.join(', ')}
                    </div>
                  )}
                  {uploadResult.results?.errors?.length > 0 && (
                    <div className="upload-result-errors">
                      <strong>⚠️ {uploadResult.results.errors.length} errors:</strong>
                      <ul>
                        {uploadResult.results.errors.slice(0, 5).map((err, i) => (
                          <li key={i}>Row {err.row}: {err.error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="upload-result-header">
                    ❌ Upload Failed
                  </div>
                  <div className="upload-result-error">
                    {uploadResult.error}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Upload Stats */}
          {uploadStats && (
            <div className="upload-stats-section">
              <h3>📊 Database Statistics</h3>
              <div className="upload-stats-grid">
                <div className="upload-stats-card">
                  <div className="upload-stats-value">{uploadStats.stats?.total_guests?.toLocaleString() || 0}</div>
                  <div className="upload-stats-label">Total Guests</div>
                </div>
                <div className="upload-stats-card">
                  <div className="upload-stats-value">{uploadStats.stats?.unique_devices?.toLocaleString() || 0}</div>
                  <div className="upload-stats-label">Unique Devices</div>
                </div>
                <div className="upload-stats-card">
                  <div className="upload-stats-value">{uploadStats.stats?.unique_aps?.toLocaleString() || 0}</div>
                  <div className="upload-stats-label">Unique APs</div>
                </div>
                <div className="upload-stats-card">
                  <div className="upload-stats-value">{uploadStats.stats?.linked_to_routers?.toLocaleString() || 0}</div>
                  <div className="upload-stats-label">Linked to Routers</div>
                </div>
              </div>
              
              {uploadStats.topAccessPoints?.length > 0 && (
                <div className="upload-top-aps">
                  <h4>Top Access Points</h4>
                  <table className="ironwifi-table">
                    <thead>
                      <tr>
                        <th>AP MAC</th>
                        <th>Router</th>
                        <th>Guests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadStats.topAccessPoints.slice(0, 5).map((ap, i) => (
                        <tr key={i}>
                          <td><code>{ap.ap_mac}</code></td>
                          <td>{ap.router_name || <span style={{ color: 'var(--warning-color)' }}>Not linked</span>}</td>
                          <td>{ap.guest_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Expected Format Info */}
          <div className="upload-format-info">
            <details>
              <summary>📋 Expected CSV Format</summary>
              <div className="upload-format-content">
                <p>The CSV should contain these columns from IronWifi Guest Registrations export:</p>
                <ul>
                  <li><code>username</code> - Guest email/username</li>
                  <li><code>firstname</code>, <code>lastname</code> - Guest name</li>
                  <li><code>phone</code> / <code>mobilephone</code> - Phone number</li>
                  <li><code>email</code> - Email address</li>
                  <li><code>client_mac</code> - User's device MAC address</li>
                  <li><code>ap_mac</code> - Router/AP MAC address (for linking)</li>
                  <li><code>creationdate</code> - Registration date</li>
                  <li><code>captive_portal_name</code> - Portal name</li>
                  <li><code>venue_id</code> - Venue identifier</li>
                  <li><code>public_ip</code> - Public IP address</li>
                </ul>
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}

export default IronWifiGuests;

