import React from 'react';
import './StatusBadge.css';

/**
 * Unified status badge component for consistent router status display
 * 
 * @param {Object} router - Router object with status fields
 * @param {string} size - 'small' | 'medium' | 'large'
 * @param {boolean} showLabel - Whether to show text label
 */
function StatusBadge({ router, size = 'medium', showLabel = true }) {
  const status = getRouterStatus(router);
  
  return (
    <span className={`status-badge status-${status.key} status-size-${size}`}>
      <span className="status-indicator">{status.icon}</span>
      {showLabel && <span className="status-label">{status.label}</span>}
    </span>
  );
}

/**
 * Get comprehensive router status
 */
export function getRouterStatus(router) {
  if (!router) {
    return { key: 'unknown', label: 'Unknown', icon: '❓', color: '#666' };
  }

  // Check online/offline
  const state = router.current_status || router.current_state;
  const isOnline = state === 'online' || 
                   state === 'Online' ||
                   state === 1 || 
                   state === '1' || 
                   state === true ||
                   (typeof state === 'string' && state.toLowerCase() === 'online');

  // Check location status
  const hasLocation = !!router.clickup_location_task_id;
  
  // Check task status
  const taskStatus = router.clickup_task_status?.toLowerCase() || '';
  const isBeingReturned = taskStatus === 'being returned';
  const isDecommissioned = taskStatus === 'decommissioned';
  
  // Check assignees
  let hasAssignees = false;
  try {
    let assignees = router.clickup_assignees;
    if (typeof assignees === 'string') {
      assignees = JSON.parse(assignees);
    }
    hasAssignees = Array.isArray(assignees) && assignees.length > 0;
  } catch {
    hasAssignees = false;
  }

  // Determine status based on combinations
  if (isDecommissioned) {
    return { 
      key: 'decommissioned', 
      label: 'Decommissioned', 
      icon: '🚫',
      color: '#6b7280',
      priority: 1
    };
  }

  if (isBeingReturned) {
    return { 
      key: 'returning', 
      label: 'Being Returned', 
      icon: '📦',
      color: '#f59e0b',
      priority: 2
    };
  }

  if (hasLocation) {
    if (isOnline) {
      return { 
        key: 'working', 
        label: 'Working', 
        icon: '🟢',
        color: '#22c55e',
        priority: 3
      };
    } else {
      return { 
        key: 'attention', 
        label: 'Needs Attention', 
        icon: '🔴',
        color: '#ef4444',
        priority: 4
      };
    }
  }

  if (hasAssignees) {
    if (isOnline) {
      return { 
        key: 'ready', 
        label: 'Ready to Install', 
        icon: '🟡',
        color: '#eab308',
        priority: 5
      };
    } else {
      return { 
        key: 'assigned', 
        label: 'Assigned', 
        icon: '👤',
        color: '#8b5cf6',
        priority: 6
      };
    }
  }

  // No location, no assignees
  if (isOnline) {
    return { 
      key: 'available', 
      label: 'Available', 
      icon: '⚪',
      color: '#06b6d4',
      priority: 7
    };
  }

  return { 
    key: 'stock', 
    label: 'In Stock', 
    icon: '📦',
    color: '#6b7280',
    priority: 8
  };
}

/**
 * Online/Offline indicator only
 */
export function OnlineIndicator({ router, size = 'small' }) {
  const state = router?.current_status || router?.current_state;
  const isOnline = state === 'online' || 
                   state === 'Online' ||
                   state === 1 || 
                   state === '1' || 
                   state === true ||
                   (typeof state === 'string' && state.toLowerCase() === 'online');

  return (
    <span className={`online-indicator online-${isOnline ? 'yes' : 'no'} online-size-${size}`}>
      {isOnline ? '●' : '○'}
    </span>
  );
}

export default StatusBadge;

