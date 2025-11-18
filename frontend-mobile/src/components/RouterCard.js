import React from 'react';
import { useNavigate } from 'react-router-dom';
import './RouterCard.css';

function RouterCard({ router }) {
  const navigate = useNavigate();
  
  // Handle both current_status and current_state (for compatibility)
  // Handle various formats: 'online', 'offline', 1, 0, '1', '0', true, false, 'Online'
  const state = router.current_status || router.current_state;
  const isOnline = state === 'online' || 
                   state === 'Online' ||
                   state === 1 || 
                   state === '1' || 
                   state === true ||
                   (typeof state === 'string' && state.toLowerCase() === 'online');

  const handleClick = () => {
    navigate(`/router/${router.router_id}`);
  };

  return (
    <div className={`router-card ${isOnline ? 'router-card-online' : 'router-card-offline'}`}>
      <div className="router-card-header">
        <div className="router-card-name">
          {router.name || `Router #${router.router_id}`}
        </div>
        <div className={`router-card-status ${isOnline ? 'status-online' : 'status-offline'}`}>
          {isOnline ? '● Online' : '○ Offline'}
        </div>
      </div>
      
      <div className="router-card-id">#{router.router_id}</div>
      
      {router.clickup_location_task_name && (
        <div className="router-card-location">
          {router.clickup_location_task_id ? (
            <a
              href={`https://app.clickup.com/list/${router.clickup_location_task_id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="router-card-location-link"
            >
              📍 {router.clickup_location_task_name}
            </a>
          ) : (
            <span>📍 {router.clickup_location_task_name}</span>
          )}
        </div>
      )}
      
      {(() => {
        try {
          let assignees = router.clickup_assignees;
          if (!assignees) {
            return null;
          }
          if (typeof assignees === 'string') {
            // Check if it's a string like "Not assigned" or empty
            if (!assignees.trim() || assignees.toLowerCase().includes('not assigned') || assignees.toLowerCase() === 'none') {
              return null;
            }
            assignees = JSON.parse(assignees);
          }
          // Handle array case
          if (Array.isArray(assignees)) {
            // Filter out any invalid entries and check if we have valid assignees
            const validAssignees = assignees.filter(a => {
              if (!a) return false;
              // Check if it's an object with at least one identifier
              if (typeof a === 'object') {
                return !!(a.username || a.name || a.email || a.id);
              }
              // Check if it's a string that's not "not assigned" or "none"
              if (typeof a === 'string') {
                const lower = a.toLowerCase();
                return !lower.includes('not assigned') && lower !== 'none' && a.trim().length > 0;
              }
              return true;
            });
            
            if (validAssignees.length > 0) {
              const assigneeNames = validAssignees.map(a => {
                if (typeof a === 'object') {
                  return a.username || a.name || a.email || 'Unknown';
                }
                return a;
              }).join(', ');
              
              return (
                <div className="router-card-assignees">
                  Assigned to: {assigneeNames}
                </div>
              );
            }
          }
          return null;
        } catch {
          return null;
        }
      })()}

      {router.last_seen && (
        <div className="router-card-last-seen">
          Last seen: {(() => {
            try {
              // Parse the date - handle both string and Date objects
              let date;
              if (router.last_seen instanceof Date) {
                date = router.last_seen;
              } else if (typeof router.last_seen === 'string') {
                // PostgreSQL TIMESTAMP strings are in ISO format, parse directly
                date = new Date(router.last_seen);
              } else if (typeof router.last_seen === 'number') {
                // Handle Unix timestamp (seconds or milliseconds)
                date = new Date(router.last_seen > 1000000000000 ? router.last_seen : router.last_seen * 1000);
              } else {
                return 'Unknown';
              }
              
              // Validate the date
              if (isNaN(date.getTime())) {
                console.warn('Invalid last_seen date:', router.last_seen, 'for router:', router.router_id);
                return 'Invalid date';
              }
              
              const now = new Date();
              const diffMs = now.getTime() - date.getTime();
              
              // Handle negative differences (future dates) or very large differences
              if (diffMs < 0) {
                // Future date - log for debugging
                console.warn('Future date detected for router:', router.router_id, 'date:', date, 'now:', now);
                return 'Just now'; // Future date, treat as just now
              }
              
              const diffMins = Math.floor(diffMs / 60000);
              const diffHours = Math.floor(diffMs / 3600000);
              const diffDays = Math.floor(diffMs / 86400000);
              
              // Debug: Log if all routers show same time (first router only to avoid spam)
              if (router.router_id && router.router_id.toString().endsWith('1')) {
                console.debug('Last seen calculation:', {
                  router_id: router.router_id,
                  last_seen_raw: router.last_seen,
                  last_seen_parsed: date.toISOString(),
                  now: now.toISOString(),
                  diffMs,
                  diffMins
                });
              }
              
              // Show relative time if recent
              if (diffMins < 1) return 'Just now';
              if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
              if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
              if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
              
              // Otherwise show formatted date
              return date.toLocaleDateString('en-GB', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
            } catch (error) {
              console.error('Error formatting last_seen:', error, router.last_seen, 'for router:', router.router_id);
              return 'Unknown';
            }
          })()}
        </div>
      )}
      
      <button 
        onClick={handleClick}
        className="router-card-button"
      >
        View Details
      </button>
    </div>
  );
}

export default RouterCard;

