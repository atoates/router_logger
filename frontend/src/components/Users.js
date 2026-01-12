import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getGuestWifiStats, getGuestWifiRecent, getGuestsByRouter, deleteGuestSession } from '../services/api';
import './Users.css';

// Generate a consistent color from a string (for avatars)
const stringToColor = (str) => {
  if (!str) return '#6366f1';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
    '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
  ];
  return colors[Math.abs(hash) % colors.length];
};

// Get initials from email or name
const getInitials = (email, name) => {
  if (name && name !== 'Anonymous') {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  }
  if (email) {
    return email.substring(0, 2).toUpperCase();
  }
  return '??';
};

// Format relative time
const formatRelativeTime = (dateStr) => {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const Users = () => {
  const [stats, setStats] = useState(null);
  const [recentGuests, setRecentGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(7);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedDevices, setExpandedDevices] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' or 'table'
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [routerGuests, setRouterGuests] = useState([]);

  const timeRanges = [
    { label: '24H', value: 1 },
    { label: '7D', value: 7 },
    { label: '30D', value: 30 },
    { label: '90D', value: 90 }
  ];

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, recentRes] = await Promise.all([
        getGuestWifiStats(days),
        getGuestWifiRecent(100)
      ]);
      setStats(statsRes.data);
      setRecentGuests(recentRes.data.guests || []);
    } catch (err) {
      console.error('Error fetching guest data:', err);
      setError('Failed to load user data');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRouterClick = async (routerId) => {
    if (selectedRouter === routerId) {
      setSelectedRouter(null);
      setRouterGuests([]);
      return;
    }
    setSelectedRouter(routerId);
    try {
      const res = await getGuestsByRouter(routerId, 50, days);
      setRouterGuests(res.data.guests || []);
    } catch (err) {
      console.error('Error fetching router guests:', err);
    }
  };

  const handleDeleteClick = (guest) => {
    setDeleteConfirm(guest);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await deleteGuestSession(deleteConfirm.id);
      setRecentGuests(prev => prev.filter(g => g.id !== deleteConfirm.id));
      setRouterGuests(prev => prev.filter(g => g.id !== deleteConfirm.id));
      setDeleteConfirm(null);
      fetchData();
    } catch (err) {
      console.error('Error deleting session:', err);
      alert('Failed to delete session: ' + (err.response?.data?.error || err.message));
    } finally {
      setDeleting(false);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0m';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    if (hours < 24) return `${hours}h ${remainingMins}m`;
    const d = Math.floor(hours / 24);
    return `${d}d ${hours % 24}h`;
  };

  const formatDataUsage = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const n = Number(bytes) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + ' KB';
    return n + ' B';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Group sessions by device (MAC address)
  const groupedDevices = useMemo(() => {
    const deviceMap = new Map();
    
    recentGuests.forEach(session => {
      const mac = session.user_mac || 'unknown';
      if (!deviceMap.has(mac)) {
        deviceMap.set(mac, {
          mac,
          sessions: [],
          totalSessions: 0,
          activeSessions: 0,
          totalData: 0,
          totalDuration: 0,
          lastConnected: session.session_start,
          firstSeen: session.session_start,
          mostRecentEmail: session.email,
          mostRecentName: session.guest_name || session.username,
          routers: new Set()
        });
      }
      
      const device = deviceMap.get(mac);
      device.sessions.push(session);
      device.totalSessions++;
      if (!session.session_end) device.activeSessions++;
      device.totalData += Number(session.bytes_total) || 0;
      device.totalDuration += Number(session.session_duration_seconds) || 0;
      device.routers.add(session.router_name || session.router_id);
      
      if (new Date(session.session_start) > new Date(device.lastConnected)) {
        device.lastConnected = session.session_start;
        device.mostRecentEmail = session.email;
        device.mostRecentName = session.guest_name || session.username;
      }
      if (new Date(session.session_start) < new Date(device.firstSeen)) {
        device.firstSeen = session.session_start;
      }
    });
    
    return Array.from(deviceMap.values())
      .map(d => ({ ...d, routers: Array.from(d.routers) }))
      .sort((a, b) => new Date(b.lastConnected) - new Date(a.lastConnected));
  }, [recentGuests]);

  // Filter devices by search
  const filteredDevices = useMemo(() => {
    if (!searchQuery.trim()) return groupedDevices;
    const q = searchQuery.toLowerCase();
    return groupedDevices.filter(device => 
      device.mac.toLowerCase().includes(q) ||
      (device.mostRecentEmail && device.mostRecentEmail.toLowerCase().includes(q)) ||
      (device.mostRecentName && device.mostRecentName.toLowerCase().includes(q)) ||
      device.routers.some(r => r && r.toLowerCase().includes(q))
    );
  }, [groupedDevices, searchQuery]);

  const toggleDevice = (mac) => {
    const newExpanded = new Set(expandedDevices);
    if (newExpanded.has(mac)) {
      newExpanded.delete(mac);
    } else {
      newExpanded.add(mac);
    }
    setExpandedDevices(newExpanded);
  };

  // Live session timer component
  const LiveTimer = ({ startTime }) => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
      if (!startTime) return;
      const updateElapsed = () => {
        const start = new Date(startTime);
        const now = new Date();
        setElapsed(Math.floor((now - start) / 1000));
      };
      updateElapsed();
      const interval = setInterval(updateElapsed, 1000);
      return () => clearInterval(interval);
    }, [startTime]);

    return <span className="live-timer-value">{formatDuration(elapsed)}</span>;
  };

  // Activity spark visualization (mini bar chart of sessions)
  const ActivitySpark = ({ sessions }) => {
    const hourBuckets = useMemo(() => {
      const buckets = new Array(24).fill(0);
      sessions.forEach(s => {
        const hour = new Date(s.session_start).getHours();
        buckets[hour]++;
      });
      const max = Math.max(...buckets, 1);
      return buckets.map(b => b / max);
    }, [sessions]);

    return (
      <div className="activity-spark">
        {hourBuckets.map((height, i) => (
          <div
            key={i}
            className="spark-bar"
            style={{ height: `${Math.max(height * 100, 4)}%` }}
            title={`${i}:00 - ${i + 1}:00`}
          />
        ))}
      </div>
    );
  };

  // Data usage bar
  const DataBar = ({ used, max }) => {
    const percent = max > 0 ? Math.min((used / max) * 100, 100) : 0;
    return (
      <div className="data-bar">
        <div className="data-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    );
  };

  if (loading) {
    return (
      <div className="users-container">
        <div className="users-loading">
          <div className="loading-pulse" />
          <p>Loading user data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="users-container">
        <div className="users-error">
          <div className="error-icon">⚠️</div>
          <p>{error}</p>
          <button onClick={fetchData} className="retry-btn">Retry</button>
        </div>
      </div>
    );
  }

  const maxDeviceData = Math.max(...groupedDevices.map(d => d.totalData), 1);
  const activeNow = stats?.summary?.active_sessions || 0;
  const totalSessions = stats?.summary?.total_sessions || 0;
  const uniqueGuests = stats?.summary?.unique_guests || 0;
  const avgDuration = stats?.summary?.avg_session_duration || 0;

  return (
    <div className="users-container">
      {/* Header */}
      <div className="users-header">
        <div className="users-title-section">
          <h1>Users</h1>
          <p className="users-subtitle">WiFi guest sessions and device activity</p>
        </div>
        
        <div className="users-controls">
          <div className="users-time-selector">
            {timeRanges.map(range => (
              <button
                key={range.value}
                className={`time-btn ${days === range.value ? 'active' : ''}`}
                onClick={() => setDays(range.value)}
              >
                {range.label}
              </button>
            ))}
          </div>
          
          <button className="refresh-btn" onClick={fetchData} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="users-stats-grid">
        <div className="users-stat-card highlight">
          <div className="stat-icon live">
            <div className="pulse-ring" />
            <span>👤</span>
          </div>
          <div className="stat-content">
            <div className="stat-value">{activeNow}</div>
            <div className="stat-label">Active Now</div>
          </div>
        </div>
        
        <div className="users-stat-card">
          <div className="stat-icon sessions">
            <span>📊</span>
          </div>
          <div className="stat-content">
            <div className="stat-value">{parseInt(totalSessions).toLocaleString()}</div>
            <div className="stat-label">Total Sessions</div>
          </div>
        </div>
        
        <div className="users-stat-card">
          <div className="stat-icon devices">
            <span>📱</span>
          </div>
          <div className="stat-content">
            <div className="stat-value">{parseInt(uniqueGuests).toLocaleString()}</div>
            <div className="stat-label">Unique Devices</div>
          </div>
        </div>
        
        <div className="users-stat-card">
          <div className="stat-icon duration">
            <span>⏱️</span>
          </div>
          <div className="stat-content">
            <div className="stat-value">{formatDuration(avgDuration)}</div>
            <div className="stat-label">Avg Session</div>
          </div>
        </div>
      </div>

      {/* Router Quick Stats */}
      {stats?.byRouter && stats.byRouter.length > 0 && (
        <div className="router-pills-section">
          <h3>Sessions by Router</h3>
          <div className="router-pills">
            {stats.byRouter.slice(0, 10).map(router => (
              <button
                key={router.router_id}
                className={`router-pill ${selectedRouter === router.router_id ? 'active' : ''}`}
                onClick={() => handleRouterClick(router.router_id)}
              >
                <span className="router-pill-name">{router.router_name || `Router ${router.router_id}`}</span>
                <span className="router-pill-count">{router.unique_guests}</span>
              </button>
            ))}
          </div>
          
          {selectedRouter && routerGuests.length > 0 && (
            <div className="router-detail-panel">
              <div className="router-detail-header">
                <h4>{stats.byRouter.find(r => r.router_id === selectedRouter)?.router_name}</h4>
                <button className="close-btn" onClick={() => setSelectedRouter(null)}>×</button>
              </div>
              <div className="router-sessions-list">
                {routerGuests.slice(0, 8).map((guest, idx) => (
                  <div key={guest.session_id || idx} className="router-session-item">
                    <div 
                      className="mini-avatar"
                      style={{ background: stringToColor(guest.email || guest.user_mac) }}
                    >
                      {getInitials(guest.email, guest.guest_name)}
                    </div>
                    <div className="session-info">
                      <span className="session-name">{guest.guest_name || 'Anonymous'}</span>
                      <span className="session-time">{formatRelativeTime(guest.session_start)}</span>
                    </div>
                    {!guest.session_end && <span className="live-dot" />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search and View Controls */}
      <div className="users-toolbar">
        <div className="search-box">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by email, name, MAC, or router..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
        
        <div className="view-toggle">
          <button 
            className={viewMode === 'cards' ? 'active' : ''} 
            onClick={() => setViewMode('cards')}
            title="Card view"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button 
            className={viewMode === 'table' ? 'active' : ''} 
            onClick={() => setViewMode('table')}
            title="Table view"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="4" width="18" height="3" rx="1" />
              <rect x="3" y="10.5" width="18" height="3" rx="1" />
              <rect x="3" y="17" width="18" height="3" rx="1" />
            </svg>
          </button>
        </div>

        <div className="results-count">
          {filteredDevices.length} device{filteredDevices.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Devices Section */}
      <div className="users-content">
        {filteredDevices.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📱</div>
            <h3>No devices found</h3>
            <p>
              {searchQuery 
                ? 'Try adjusting your search criteria' 
                : 'Guest sessions will appear here when users connect via the captive portal'}
            </p>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="devices-grid">
            {filteredDevices.map(device => {
              const isExpanded = expandedDevices.has(device.mac);
              const isActive = device.activeSessions > 0;
              
              return (
                <div 
                  key={device.mac} 
                  className={`device-card ${isExpanded ? 'expanded' : ''} ${isActive ? 'has-active' : ''}`}
                >
                  <div className="device-card-header" onClick={() => toggleDevice(device.mac)}>
                    <div 
                      className="device-avatar"
                      style={{ background: stringToColor(device.mostRecentEmail || device.mac) }}
                    >
                      {getInitials(device.mostRecentEmail, device.mostRecentName)}
                      {isActive && <span className="active-indicator" />}
                    </div>
                    
                    <div className="device-main-info">
                      <div className="device-name">
                        {device.mostRecentName || device.mostRecentEmail?.split('@')[0] || 'Unknown Device'}
                      </div>
                      <div className="device-email">{device.mostRecentEmail || device.mac}</div>
                    </div>
                    
                    <div className="device-quick-stats">
                      {isActive && (
                        <span className="live-badge">
                          <span className="live-dot-animated" />
                          Live
                        </span>
                      )}
                      <span className="session-count">{device.totalSessions} session{device.totalSessions !== 1 ? 's' : ''}</span>
                    </div>
                    
                    <div className={`expand-arrow ${isExpanded ? 'expanded' : ''}`}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </div>
                  </div>
                  
                  <div className="device-card-body">
                    <div className="device-metrics">
                      <div className="metric">
                        <span className="metric-label">Data Used</span>
                        <span className="metric-value">{formatDataUsage(device.totalData)}</span>
                        <DataBar used={device.totalData} max={maxDeviceData} />
                      </div>
                      <div className="metric">
                        <span className="metric-label">Total Time</span>
                        <span className="metric-value">{formatDuration(device.totalDuration)}</span>
                      </div>
                      <div className="metric">
                        <span className="metric-label">Last Seen</span>
                        <span className="metric-value">{formatRelativeTime(device.lastConnected)}</span>
                      </div>
                    </div>
                    
                    <div className="device-activity">
                      <span className="activity-label">Activity by Hour</span>
                      <ActivitySpark sessions={device.sessions} />
                    </div>
                    
                    <div className="device-routers">
                      {device.routers.slice(0, 3).map(router => (
                        <span key={router} className="router-tag">{router}</span>
                      ))}
                      {device.routers.length > 3 && (
                        <span className="router-tag more">+{device.routers.length - 3}</span>
                      )}
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <div className="device-sessions-panel">
                      <div className="sessions-header">
                        <h4>Session History</h4>
                      </div>
                      <div className="sessions-list">
                        {device.sessions.map((session, idx) => {
                          const sessionActive = !session.session_end;
                          return (
                            <div key={session.session_id || idx} className={`session-row ${sessionActive ? 'active' : ''}`}>
                              <div className="session-status">
                                {sessionActive ? (
                                  <span className="status-live">
                                    <span className="live-dot-small" />
                                    <LiveTimer startTime={session.session_start} />
                                  </span>
                                ) : (
                                  <span className="status-ended">{formatDuration(session.session_duration_seconds)}</span>
                                )}
                              </div>
                              <div className="session-details">
                                <span className="session-date">{formatDate(session.session_start)}</span>
                                <span className="session-router">{session.router_name || 'Unknown Router'}</span>
                              </div>
                              <div className="session-data">{formatDataUsage(session.bytes_total)}</div>
                              <button 
                                className="session-delete"
                                onClick={(e) => { e.stopPropagation(); handleDeleteClick(session); }}
                                title="Delete session"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                </svg>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="devices-table-container">
            <table className="devices-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Email</th>
                  <th>Sessions</th>
                  <th>Data Used</th>
                  <th>Total Time</th>
                  <th>Last Seen</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredDevices.map(device => {
                  const isActive = device.activeSessions > 0;
                  return (
                    <tr 
                      key={device.mac} 
                      className={isActive ? 'active-row' : ''}
                      onClick={() => toggleDevice(device.mac)}
                    >
                      <td>
                        <div className="table-device">
                          <div 
                            className="mini-avatar"
                            style={{ background: stringToColor(device.mostRecentEmail || device.mac) }}
                          >
                            {getInitials(device.mostRecentEmail, device.mostRecentName)}
                          </div>
                          <span>{device.mostRecentName || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="email-cell">{device.mostRecentEmail || device.mac}</td>
                      <td>{device.totalSessions}</td>
                      <td>{formatDataUsage(device.totalData)}</td>
                      <td>{formatDuration(device.totalDuration)}</td>
                      <td>{formatRelativeTime(device.lastConnected)}</td>
                      <td>
                        {isActive ? (
                          <span className="table-live-badge">
                            <span className="live-dot-animated" />
                            {device.activeSessions} active
                          </span>
                        ) : (
                          <span className="table-offline-badge">Offline</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Daily Activity Timeline */}
      {stats?.timeline && stats.timeline.length > 0 && (
        <div className="activity-timeline-section">
          <h3>Daily Activity</h3>
          <div className="timeline-chart">
            {stats.timeline.slice(0, 14).reverse().map((day, idx) => {
              const maxSessions = Math.max(...stats.timeline.map(d => d.sessions), 1);
              const height = (day.sessions / maxSessions) * 100;
              return (
                <div key={day.date} className="timeline-bar-wrapper">
                  <div className="timeline-bar-container">
                    <div 
                      className="timeline-bar"
                      style={{ height: `${Math.max(height, 4)}%` }}
                    >
                      <span className="bar-tooltip">{day.sessions} sessions</span>
                    </div>
                  </div>
                  <span className="bar-label">
                    {new Date(day.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteConfirm(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Session</h3>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)} disabled={deleting}>×</button>
            </div>
            <p>Are you sure you want to delete this session?</p>
            <div className="modal-guest-info">
              <div 
                className="modal-avatar"
                style={{ background: stringToColor(deleteConfirm.email || deleteConfirm.user_mac) }}
              >
                {getInitials(deleteConfirm.email, deleteConfirm.guest_name)}
              </div>
              <div>
                <strong>{deleteConfirm.guest_name || deleteConfirm.username || 'Anonymous'}</strong>
                {deleteConfirm.email && <span>{deleteConfirm.email}</span>}
              </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setDeleteConfirm(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="modal-btn delete" onClick={handleDeleteConfirm} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;
