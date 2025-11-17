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
              href={`https://app.clickup.com/t/${router.clickup_location_task_id}`}
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
          if (typeof assignees === 'string') {
            assignees = JSON.parse(assignees);
          }
          if (Array.isArray(assignees) && assignees.length > 0) {
            const assigneeNames = assignees.map(a => a.username || a.name || a.email || 'Unknown').join(', ');
            return (
              <div className="router-card-assignees">
                Assigned to: {assigneeNames}
              </div>
            );
          }
          return null;
        } catch {
          return null;
        }
      })()}

      {router.last_seen && (
        <div className="router-card-last-seen">
          Last seen: {new Date(router.last_seen).toLocaleDateString()}
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

