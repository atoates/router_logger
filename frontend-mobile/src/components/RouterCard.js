import React from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBadge, { getRouterStatus } from './StatusBadge';
import './RouterCard.css';

// Helper to generate ClickUp URL - list IDs are numeric, task IDs are alphanumeric
const getClickUpUrl = (id) => {
  if (!id) return null;
  const isTaskId = /[a-zA-Z]/.test(id);
  return isTaskId 
    ? `https://app.clickup.com/t/${id}`
    : `https://app.clickup.com/list/${id}`;
};

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

  const routerStatus = getRouterStatus(router);

  const handleClick = () => {
    navigate(`/router/${router.router_id}`);
  };

  return (
    <div className={`router-card router-card-${routerStatus.key}`}>
      <div className="router-card-header">
        <div className="router-card-name">
          {router.name || `Router #${router.router_id}`}
        </div>
        <StatusBadge router={router} size="small" />
      </div>
      
      <div className="router-card-id">#{router.router_id}</div>
      
      {router.clickup_location_task_name && (
        <div className="router-card-location">
          {router.clickup_location_task_id ? (
            <a
              href={getClickUpUrl(router.clickup_location_task_id)}
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
              const rawValue = router.last_seen;
              
              if (rawValue instanceof Date) {
                date = rawValue;
              } else if (typeof rawValue === 'string') {
                // PostgreSQL TIMESTAMP strings - handle various formats
                // Try parsing as-is first
                date = new Date(rawValue);
                
                // If that fails or gives invalid date, try other formats
                if (isNaN(date.getTime())) {
                  // Try removing timezone info and parsing as UTC
                  const cleaned = rawValue.replace(/[+-]\d{2}:\d{2}$/, '').replace('Z', '');
                  date = new Date(cleaned + 'Z'); // Add Z to force UTC
                }
              } else if (typeof rawValue === 'number') {
                // Handle Unix timestamp (seconds or milliseconds)
                date = new Date(rawValue > 1000000000000 ? rawValue : rawValue * 1000);
              } else {
                console.warn('Unexpected last_seen type:', typeof rawValue, rawValue, 'for router:', router.router_id);
                return 'Unknown';
              }
              
              // Validate the date
              if (isNaN(date.getTime())) {
                console.error('Invalid last_seen date after parsing:', {
                  router_id: router.router_id,
                  raw: rawValue,
                  type: typeof rawValue,
                  parsed: date
                });
                return 'Invalid date';
              }
              
              const now = new Date();
              const diffMs = now.getTime() - date.getTime();
              
              // Handle negative differences (future dates) or very large differences
              if (diffMs < 0) {
                // Future date - log for debugging
                console.warn('Future date detected:', {
                  router_id: router.router_id,
                  date: date.toISOString(),
                  now: now.toISOString(),
                  diffMs
                });
                return 'Just now'; // Future date, treat as just now
              }
              
              const diffMins = Math.floor(diffMs / 60000);
              const diffHours = Math.floor(diffMs / 3600000);
              const diffDays = Math.floor(diffMs / 86400000);
              
              // Debug: Log for first few routers to diagnose
              if (router.router_id && (router.router_id.toString().endsWith('1') || router.router_id.toString().endsWith('2') || router.router_id.toString().endsWith('3'))) {
                console.log(`[RouterCard] Router ${router.router_id}:`, {
                  last_seen_raw: rawValue,
                  last_seen_type: typeof rawValue,
                  last_seen_parsed: date.toISOString(),
                  last_seen_local: date.toLocaleString(),
                  now: now.toISOString(),
                  now_local: now.toLocaleString(),
                  diffMs,
                  diffMins,
                  diffHours,
                  diffDays
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
              console.error('Error formatting last_seen:', {
                error: error.message,
                router_id: router.router_id,
                last_seen: router.last_seen,
                type: typeof router.last_seen
              });
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

