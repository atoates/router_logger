import React, { useState } from 'react';
import { clearRouterCache, getDeduplicationReport, forceRefreshRouters } from '../services/api';
import './AdminDebugTools.css';

function AdminDebugTools() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [report, setReport] = useState(null);

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

