import React from 'react';
import { useNavigate } from 'react-router-dom';
import './RouterCard.css';

function RouterCard({ router }) {
  const navigate = useNavigate();
  
  const isOnline = router.current_state === 'online' || 
                   router.current_state === 1 || 
                   router.current_state === '1' || 
                   router.current_state === true;

  const handleClick = () => {
    // For now, just show router info
    alert(`Router #${router.router_id}\nName: ${router.name || 'N/A'}\nStatus: ${isOnline ? 'Online' : 'Offline'}`);
  };

  return (
    <div className={`router-card ${isOnline ? 'router-card-online' : 'router-card-offline'}`}>
      <div className="router-card-header">
        <div className="router-card-id">#{router.router_id}</div>
        <div className={`router-card-status ${isOnline ? 'status-online' : 'status-offline'}`}>
          {isOnline ? '● Online' : '○ Offline'}
        </div>
      </div>
      
      {router.name && (
        <div className="router-card-name">{router.name}</div>
      )}
      
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

