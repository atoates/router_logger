import React, { useState } from 'react';
import { clearRouterCache, getDeduplicationReport, forceRefreshRouters, forceClickUpSync, getClickUpSyncStats } from '../services/api';
import './AdminDebugTools.css';

function AdminDebugTools() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [report, setReport] = useState(null);
  const [clickupSyncing, setClickupSyncing] = useState(false);
  const [clickupMessage, setClickupMessage] = useState('');
  const [syncStats, setSyncStats] = useState(null);

  const handleClearCache = async () => {
    if (!window.confirm('Clear all router caches? This will force a fresh data load.')) {
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const response = await clearRouterCache();
      setMessage(`✅ ${response.data.message || 'Cache cleared successfully'}`);
      
      // Force reload the page after 2 seconds to refresh all components
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      setMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleForceRefresh = async () => {
    setLoading(true);
    setMessage('');
    try {
      await forceRefreshRouters();
      setMessage('✅ Routers refreshed from database');
      
      // Reload page to show fresh data
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      setMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeduplicationReport = async () => {
    setLoading(true);
    setMessage('');
    setReport(null);
    try {
      const response = await getDeduplicationReport();
      setReport(response.data);
      
      if (response.data.duplicate_groups === 0) {
        setMessage('✅ No duplicate router names found');
      } else {
        setMessage(`⚠️ Found ${response.data.duplicate_groups} router names with duplicates`);
      }
    } catch (error) {
      setMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleForceClickUpSync = async () => {
    if (!window.confirm('Force sync all routers to ClickUp? This will update all custom fields (firmware, status, last seen, etc.).')) {
      return;
    }

    setClickupSyncing(true);
    setClickupMessage('⏳ Starting ClickUp sync...');
    setSyncStats(null);
    
    try {
      const response = await forceClickUpSync();
      
      // Handle background sync (new behavior)
      if (response.data.status === 'running') {
        setClickupMessage('⏳ Sync started in background. Waiting for completion...');
        
        // Poll for status
        const pollInterval = setInterval(async () => {
          try {
            const statsResponse = await getClickUpSyncStats();
            const stats = statsResponse.data;
            
            if (!stats.isSyncing) {
              clearInterval(pollInterval);
              setSyncStats(stats);
              
              const { lastSyncUpdated, lastSyncSkipped, lastSyncErrors } = stats;
              
              if (lastSyncErrors > 0) {
                setClickupMessage(`⚠️ Sync completed with errors: ${lastSyncUpdated} updated, ${lastSyncSkipped || 0} skipped, ${lastSyncErrors} errors`);
              } else {
                setClickupMessage(`✅ Sync completed successfully: ${lastSyncUpdated} updated, ${lastSyncSkipped || 0} skipped`);
              }
              setClickupSyncing(false);
            } else {
               setClickupMessage('⏳ Syncing in progress...');
            }
          } catch (err) {
            console.error('Error polling sync stats:', err);
          }
        }, 2000);
        
        // Stop polling after 5 minutes (safety)
        setTimeout(() => {
          clearInterval(pollInterval);
          // Only update state if still syncing (might have finished)
          setClickupSyncing(prev => {
            if (prev) {
              setClickupMessage('⚠️ Sync timed out or is taking longer than expected. Check stats later.');
              return false;
            }
            return prev;
          });
        }, 5 * 60 * 1000);
        
        return;
      }

      // Handle synchronous response (old behavior)
      const { updated, skipped, errors, total } = response.data;
      
      setSyncStats(response.data);
      
      if (errors > 0) {
        setClickupMessage(`⚠️ Sync completed with errors: ${updated} updated, ${skipped || 0} skipped, ${errors} errors out of ${total} routers`);
      } else if (skipped > 0) {
        setClickupMessage(`✅ Sync completed: ${updated} updated, ${skipped} unchanged (smart sync), ${total} routers processed`);
      } else {
        setClickupMessage(`✅ All routers synced successfully: ${updated}/${total} updated`);
      }
      setClickupSyncing(false);
    } catch (error) {
      console.error('ClickUp sync error:', error);
      let errorMsg = '❌ Sync failed: ';
      
      if (error.response) {
        // Server responded with error
        errorMsg += error.response.data?.error || error.response.data?.message || `HTTP ${error.response.status}`;
      } else if (error.request) {
        // Request made but no response
        errorMsg += 'No response from server. Check if backend is running and you are logged in as admin.';
      } else {
        // Error setting up request
        errorMsg += error.message;
      }
      
      setClickupMessage(errorMsg);
      setClickupSyncing(false);
    }
  };

  const handleGetSyncStats = async () => {
    setClickupSyncing(true);
    setClickupMessage('');
    
    try {
      const response = await getClickUpSyncStats();
      setSyncStats(response.data);
      
      const { lastSyncTime, lastSyncUpdated, lastSyncErrors, isRunning } = response.data;
      
      if (!lastSyncTime) {
        setClickupMessage('ℹ️ No sync has run yet');
      } else {
        const timeAgo = new Date(lastSyncTime).toLocaleString();
        setClickupMessage(`📊 Last sync: ${timeAgo} (${lastSyncUpdated} updated, ${lastSyncErrors} errors)${isRunning ? ' - Scheduler is running' : ' - Scheduler is stopped'}`);
      }
    } catch (error) {
      console.error('Sync stats error:', error);
      let errorMsg = '❌ Error: ';
      
      if (error.response) {
        errorMsg += error.response.data?.error || error.response.data?.message || `HTTP ${error.response.status}`;
      } else if (error.request) {
        errorMsg += 'No response from server. Check if backend is running and you are logged in as admin.';
      } else {
        errorMsg += error.message;
      }
      
      setClickupMessage(errorMsg);
    } finally {
      setClickupSyncing(false);
    }
  };

  return (
    <div className="admin-debug-tools">
      <h2>🔧 Admin Debug Tools</h2>
      
      <div className="debug-section">
        <h3>Cache Management</h3>
        <p className="debug-description">
          If routers aren't showing after updates, clear the cache to force a fresh load.
        </p>
        
        <div className="debug-buttons">
          <button 
            onClick={handleForceRefresh}
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? '⏳ Refreshing...' : '🔄 Force Refresh Routers'}
          </button>
          
          <button 
            onClick={handleClearCache}
            disabled={loading}
            className="btn btn-warning"
          >
            {loading ? '⏳ Clearing...' : '🗑️ Clear All Caches'}
          </button>
        </div>
      </div>

      <div className="debug-section">
        <h3>Deduplication Report</h3>
        <p className="debug-description">
          See which routers are being hidden due to duplicate names. The system keeps the router with the most logs or most recent activity.
        </p>
        
        <button 
          onClick={handleDeduplicationReport}
          disabled={loading}
          className="btn btn-secondary"
        >
          {loading ? '⏳ Generating...' : '📊 Show Deduplication Report'}
        </button>
      </div>

      <div className="debug-section">
        <h3>ClickUp Sync</h3>
        <p className="debug-description">
          Force sync all router data to ClickUp (firmware, status, last seen, IMEI, MAC address, etc.). 
          Also pulls latest assignees from ClickUp to local database.
          This will update all custom fields in ClickUp tasks. Smart sync will skip routers that haven't changed.
        </p>
        
        <div className="debug-buttons">
          <button 
            onClick={handleForceClickUpSync}
            disabled={clickupSyncing}
            className="btn btn-primary"
          >
            {clickupSyncing ? '⏳ Syncing...' : '🔄 Force ClickUp Sync'}
          </button>
          
          <button 
            onClick={handleGetSyncStats}
            disabled={clickupSyncing}
            className="btn btn-secondary"
          >
            {clickupSyncing ? '⏳ Loading...' : '📊 View Sync Stats'}
          </button>
        </div>

        {clickupMessage && (
          <div className={`debug-message ${clickupMessage.startsWith('❌') ? 'error' : clickupMessage.startsWith('⚠️') ? 'warning' : 'success'}`}>
            {clickupMessage}
          </div>
        )}

        {syncStats && (
          <div className="sync-stats">
            <h4>Sync Statistics</h4>
            <div className="stats-grid">
              {syncStats.lastSyncTime && (
                <>
                  <div className="stat-item">
                    <span className="stat-label">Last Sync:</span>
                    <span className="stat-value">{new Date(syncStats.lastSyncTime).toLocaleString()}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Duration:</span>
                    <span className="stat-value">{(syncStats.lastSyncDuration / 1000).toFixed(2)}s</span>
                  </div>
                </>
              )}
              {syncStats.updated !== undefined && (
                <>
                  <div className="stat-item">
                    <span className="stat-label">Updated:</span>
                    <span className="stat-value">{syncStats.updated}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Skipped:</span>
                    <span className="stat-value">{syncStats.skipped || 0}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Errors:</span>
                    <span className="stat-value">{syncStats.errors || 0}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Total:</span>
                    <span className="stat-value">{syncStats.total}</span>
                  </div>
                </>
              )}
              {syncStats.totalSyncs !== undefined && (
                <div className="stat-item">
                  <span className="stat-label">Total Syncs:</span>
                  <span className="stat-value">{syncStats.totalSyncs}</span>
                </div>
              )}
              {syncStats.isRunning !== undefined && (
                <div className="stat-item">
                  <span className="stat-label">Scheduler:</span>
                  <span className="stat-value">{syncStats.isRunning ? '✅ Running' : '❌ Stopped'}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {message && (
        <div className={`debug-message ${message.startsWith('❌') ? 'error' : message.startsWith('⚠️') ? 'warning' : 'success'}`}>
          {message}
        </div>
      )}

      {report && report.duplicates && report.duplicates.length > 0 && (
        <div className="debug-report">
          <h3>Deduplication Details</h3>
          <div className="report-summary">
            <div className="stat">
              <span className="label">Total Routers in Database:</span>
              <span className="value">{report.total_routers}</span>
            </div>
            <div className="stat">
              <span className="label">After Deduplication:</span>
              <span className="value">{report.after_deduplication}</span>
            </div>
            <div className="stat">
              <span className="label">Hidden Routers:</span>
              <span className="value">{report.total_routers - report.after_deduplication}</span>
            </div>
          </div>

          <div className="duplicates-list">
            {report.duplicates.map((dup, idx) => (
              <div key={idx} className="duplicate-group">
                <h4>📛 Name: "{dup.name}" ({dup.count} routers)</h4>
                
                <div className="kept-router">
                  <strong>✅ SHOWN:</strong>
                  <div className="router-details">
                    <span>ID: {dup.kept.router_id}</span>
                    <span>Logs: {dup.kept.log_count || 0}</span>
                    <span>Last Seen: {dup.kept.last_seen ? new Date(dup.kept.last_seen).toLocaleString() : 'Never'}</span>
                    {dup.kept.is_serial && <span className="badge">Serial ID</span>}
                  </div>
                </div>

                <div className="hidden-routers">
                  <strong>❌ HIDDEN ({dup.hidden.length}):</strong>
                  {dup.hidden.map((hidden, hidx) => (
                    <div key={hidx} className="router-details hidden">
                      <span>ID: {hidden.router_id}</span>
                      <span>Logs: {hidden.log_count || 0}</span>
                      <span>Last Seen: {hidden.last_seen ? new Date(hidden.last_seen).toLocaleString() : 'Never'}</span>
                      {hidden.is_serial && <span className="badge">Serial ID</span>}
                    </div>
                  ))}
                </div>

                <div className="duplicate-explanation">
                  💡 <strong>Why is this hidden?</strong> The router shown has more telemetry data or is more recent. 
                  To show a hidden router, either give it a unique name or ensure it has the most logs.
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report && report.duplicates && report.duplicates.length === 0 && (
        <div className="debug-report">
          <p className="no-duplicates">✅ All routers have unique names. No deduplication is occurring.</p>
        </div>
      )}
    </div>
  );
}

export default AdminDebugTools;

