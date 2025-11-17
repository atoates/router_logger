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
      
      {router.clickup_assignees && router.clickup_assignees.length > 0 && (
        <div className="router-card-assignees">
          Assigned to: {router.clickup_assignees.join(', ')}
        </div>
      )}
      
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

