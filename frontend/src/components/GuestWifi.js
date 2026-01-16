import React, { useState, useEffect } from 'react';
import { getGuestWifiStats, getGuestWifiRecent, getGuestsByRouter, deleteGuestSession } from '../services/api';
import './GuestWifi.css';

const GuestWifi = () => {
  const [stats, setStats] = useState(null);
  const [recentGuests, setRecentGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [routerGuests, setRouterGuests] = useState([]);
  const [days, setDays] = useState(7);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedDevices, setExpandedDevices] = useState(new Set());
  const [groupByDevice, setGroupByDevice] = useState(true);

  useEffect(() => {
    fetchData();
  }, [days]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, recentRes] = await Promise.all([
        getGuestWifiStats(days),
        getGuestWifiRecent(20)
      ]);
      setStats(statsRes.data);
      setRecentGuests(recentRes.data.guests || []);
    } catch (err) {
      console.error('Error fetching guest data:', err);
      setError('Failed to load guest WiFi data');
    } finally {
      setLoading(false);
    }
  };

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
      // Remove from local state
      setRecentGuests(prev => prev.filter(g => g.id !== deleteConfirm.id));
      setRouterGuests(prev => prev.filter(g => g.id !== deleteConfirm.id));
      setDeleteConfirm(null);
      // Refresh stats
      fetchData();
    } catch (err) {
      console.error('Error deleting session:', err);
      alert('Failed to delete session: ' + (err.response?.data?.error || err.message));
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-GB');
  };

  const formatDuration = (seconds) => {
    if (!seconds) return 'N/A';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  };

  const formatDataUsage = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const n = Number(bytes) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
    return n + ' B';
  };

  // Group sessions by device (MAC address)
  const groupSessionsByDevice = (sessions) => {
    const deviceMap = new Map();
    
    sessions.forEach(session => {
      const mac = session.user_mac || 'unknown';
      if (!deviceMap.has(mac)) {
        deviceMap.set(mac, {
          mac,
          sessions: [],
          totalSessions: 0,
          activeSessions: 0,
          totalData: 0,
          lastConnected: session.session_start,
          mostRecentEmail: session.email
        });
      }
      
      const device = deviceMap.get(mac);
      device.sessions.push(session);
      device.totalSessions++;
      if (!session.session_end) device.activeSessions++;
      device.totalData += Number(session.bytes_total) || 0;
      
      // Keep the most recent connection time
      if (new Date(session.session_start) > new Date(device.lastConnected)) {
        device.lastConnected = session.session_start;
        device.mostRecentEmail = session.email;
      }
    });
    
    return Array.from(deviceMap.values()).sort((a, b) => 
      new Date(b.lastConnected) - new Date(a.lastConnected)
    );
  };

  const toggleDevice = (mac) => {
    const newExpanded = new Set(expandedDevices);
    if (newExpanded.has(mac)) {
      newExpanded.delete(mac);
    } else {
      newExpanded.add(mac);
    }
    setExpandedDevices(newExpanded);
  };

  // Component for live session timer
  const SessionTimer = ({ startTime, isActive }) => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
      if (!isActive || !startTime) return;

      const updateElapsed = () => {
        const start = new Date(startTime);
        const now = new Date();
        const seconds = Math.floor((now - start) / 1000);
        setElapsed(seconds);
      };

      updateElapsed();
      const interval = setInterval(updateElapsed, 1000);

      return () => clearInterval(interval);
    }, [startTime, isActive]);

    if (!isActive) return null;

    return <span className="live-timer">{formatDuration(elapsed)}</span>;
  };

  if (loading) {
    return (
      <div className="guest-wifi-container">
        <div className="loading-spinner">Loading guest WiFi data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="guest-wifi-container">
        <div className="error-message">{error}</div>
        <button onClick={fetchData} className="retry-button">Retry</button>
      </div>
    );
  }

  return (
    <div className="guest-wifi-container">
      <div className="guest-wifi-header">
        <h1>📶 Guest WiFi Sessions</h1>
        <p className="subtitle">Data from self-hosted captive portal</p>
        
        <div className="time-filter">
          <label>Time Period:</label>
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}>
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button onClick={fetchData} className="refresh-btn">↻ Refresh</button>
        </div>
      </div>

      {/* Summary Stats */}
      {stats?.summary && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{parseInt(stats.summary.total_sessions || 0).toLocaleString()}</div>
            <div className="stat-label">Total Sessions</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{parseInt(stats.summary.unique_guests || 0).toLocaleString()}</div>
            <div className="stat-label">Unique Guests</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{parseInt(stats.summary.routers_used || 0).toLocaleString()}</div>
            <div className="stat-label">Routers Used</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{parseInt(stats.summary.active_sessions || 0).toLocaleString()}</div>
            <div className="stat-label">Active Now</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{formatDuration(stats.summary.avg_session_duration)}</div>
            <div className="stat-label">Avg Session</div>
          </div>
        </div>
      )}

      {/* Sessions by Router */}
      {stats?.byRouter && stats.byRouter.length > 0 && (
        <div className="section">
          <h2>Sessions by Router</h2>
          <div className="router-list">
            {stats.byRouter.map((router) => (
              <div 
                key={router.router_id || 'unknown'} 
                className={`router-card ${selectedRouter === router.router_id ? 'selected' : ''}`}
                onClick={() => handleRouterClick(router.router_id)}
              >
                <div className="router-name">{router.router_name || `Router ${router.router_id}`}</div>
                <div className="router-stats">
                  <span>{formatDataUsage(router.total_bytes || 0)}</span>
                  <span>{router.unique_guests} guests</span>
                </div>
              </div>
            ))}
          </div>
          
          {/* Router Guest Details */}
          {selectedRouter && routerGuests.length > 0 && (
            <div className="router-guests">
              <h3>Guests on {stats.byRouter.find(r => r.router_id === selectedRouter)?.router_name || selectedRouter}</h3>
              <table className="guests-table">
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>Email</th>
                    <th>Connected</th>
                    <th>Duration</th>
                    <th>Data Used</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {routerGuests.map((guest, idx) => (
                    <tr key={guest.session_id || idx}>
                      <td>{guest.guest_name || guest.username || 'Anonymous'}</td>
                      <td>{guest.email || '-'}</td>
                      <td>{formatDate(guest.session_start)}</td>
                      <td>{formatDuration(guest.session_duration_seconds)}</td>
                      <td>{formatDataUsage(guest.bytes_total)}</td>
                      <td>
                        <span className={`status-badge ${guest.session_end ? 'ended' : 'active'}`}>
                          {guest.session_end ? 'Ended' : 'Active'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="delete-btn"
                          onClick={() => handleDeleteClick(guest)}
                          title="Delete session"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Recent Sessions */}
      <div className="section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0 }}>Recent Sessions</h2>
          <label className="group-toggle">
            <input
              type="checkbox"
              checked={groupByDevice}
              onChange={(e) => setGroupByDevice(e.target.checked)}
            />
            <span>Group by device</span>
          </label>
        </div>
        
        {recentGuests.length > 0 ? (
          groupByDevice ? (
            // Grouped view by device
            <div className="device-groups">
              {groupSessionsByDevice(recentGuests).map((device) => (
                <div key={device.mac} className="device-group">
                  <div 
                    className="device-header"
                    onClick={() => toggleDevice(device.mac)}
                  >
                    <div className="device-expand">
                      <span className={`expand-icon ${expandedDevices.has(device.mac) ? 'expanded' : ''}`}>
                        ▶
                      </span>
                    </div>
                    <div className="device-info">
                      <div className="device-mac">{device.mac}</div>
                      <div className="device-email">{device.mostRecentEmail || 'No email'}</div>
                    </div>
                    <div className="device-stats">
                      <span className="device-stat">{device.totalSessions} session{device.totalSessions !== 1 ? 's' : ''}</span>
                      <span className="device-stat">{formatDataUsage(device.totalData)}</span>
                      {device.activeSessions > 0 && (
                        <span className="status-badge active">
                          {device.activeSessions} active
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {expandedDevices.has(device.mac) && (
                    <div className="device-sessions">
                      <table className="guests-table compact">
                        <thead>
                          <tr>
                            <th>Guest</th>
                            <th>Connected</th>
                            <th>Data Used</th>
                            <th>Status</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {device.sessions.map((guest, idx) => {
                            const isActive = !guest.session_end;
                            return (
                              <tr key={guest.session_id || idx}>
                                <td>{guest.guest_name || guest.username || 'Anonymous'}</td>
                                <td>{formatDate(guest.session_start)}</td>
                                <td>{formatDataUsage(guest.bytes_total)}</td>
                                <td>
                                  <span className={`status-badge ${isActive ? 'active' : 'ended'}`}>
                                    {isActive ? (
                                      <>
                                        Active <SessionTimer startTime={guest.session_start} isActive={true} />
                                      </>
                                    ) : 'Ended'}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    className="delete-btn"
                                    onClick={() => handleDeleteClick(guest)}
                                    title="Delete session"
                                  >
                                    Delete
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
              ))}
            </div>
          ) : (
            // Flat table view
            <table className="guests-table">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Email</th>
                  <th>Router</th>
                  <th>Connected</th>
                  <th>Data Used</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recentGuests.map((guest, idx) => {
                  const isActive = !guest.session_end;
                  return (
                    <tr key={guest.session_id || idx}>
                      <td>{guest.guest_name || guest.username || 'Anonymous'}</td>
                      <td>{guest.email || '-'}</td>
                      <td>{guest.router_name || guest.router_id || 'Unknown'}</td>
                      <td>{formatDate(guest.session_start)}</td>
                      <td>{formatDataUsage(guest.bytes_total)}</td>
                      <td>
                        <span className={`status-badge ${isActive ? 'active' : 'ended'}`}>
                          {isActive ? (
                            <>
                              Active <SessionTimer startTime={guest.session_start} isActive={true} />
                            </>
                          ) : 'Ended'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="delete-btn"
                          onClick={() => handleDeleteClick(guest)}
                          title="Delete session"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : (
          <div className="empty-state">
            <p>No guest sessions recorded yet.</p>
            <p className="hint">Guest sessions will appear here when users connect via the captive portal.</p>
          </div>
        )}
      </div>

      {/* Timeline */}
      {stats?.timeline && stats.timeline.length > 0 && (
        <div className="section">
          <h2>Daily Activity</h2>
          <div className="timeline-chart">
            {stats.timeline.slice(0, 14).reverse().map((day) => (
              <div key={day.date} className="timeline-bar">
                <div
                  className="bar"
                  style={{ height: `${Math.min(100, (day.sessions / Math.max(...stats.timeline.map(d => d.sessions))) * 100)}%` }}
                  title={`${day.sessions} sessions, ${day.unique_guests} guests`}
                />
                <div className="bar-label">{(() => {
                  const d = new Date(day.date);
                  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                })()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteConfirm(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Delete Session</h3>
            <p>Are you sure you want to delete this session?</p>
            <div className="modal-guest-info">
              <strong>{deleteConfirm.guest_name || deleteConfirm.username || 'Anonymous'}</strong>
              {deleteConfirm.email && <span>{deleteConfirm.email}</span>}
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="modal-btn delete"
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GuestWifi;

