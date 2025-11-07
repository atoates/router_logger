import React, { useState, useEffect } from 'react';
import { getRouters } from '../services/api';
import MobileSearch from '../components/mobile/MobileSearch';
import MobileLocation from '../components/mobile/MobileLocation';
import MobileStats from '../components/mobile/MobileStats';
import './MobilePage.css';

const MobilePage = () => {
  const [activeTab, setActiveTab] = useState('search');
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [routers, setRouters] = useState([]);

  useEffect(() => {
    loadRouters();
  }, []);

  const loadRouters = async () => {
    try {
      const response = await getRouters();
      setRouters(response.data || []);
    } catch (error) {
      console.error('Failed to load routers:', error);
    }
  };

  const handleRouterSelect = (router) => {
    setSelectedRouter(router);
  };

  const handleRouterUpdate = () => {
    // Reload routers after updates
    loadRouters();
    if (selectedRouter) {
      // Refresh the selected router data
      const updated = routers.find(r => r.router_id === selectedRouter.router_id);
      if (updated) {
        setSelectedRouter(updated);
      }
    }
  };

  return (
    <div className="mobile-page">
      <div className="mobile-header">
        <h1>📱 VacatAd Mobile</h1>
        {selectedRouter && (
          <div className="mobile-router-badge">
            {selectedRouter.name || `Router #${selectedRouter.router_id}`}
          </div>
        )}
      </div>

      <div className="mobile-content">
        {activeTab === 'search' && (
          <MobileSearch 
            routers={routers}
            selectedRouter={selectedRouter}
            onRouterSelect={handleRouterSelect}
            onRouterUpdate={handleRouterUpdate}
          />
        )}
        
        {activeTab === 'location' && (
          <MobileLocation 
            selectedRouter={selectedRouter}
            onRouterUpdate={handleRouterUpdate}
          />
        )}
        
        {activeTab === 'stats' && (
          <MobileStats 
            selectedRouter={selectedRouter}
          />
        )}
      </div>

      <div className="mobile-nav">
        <button 
          className={`mobile-nav-btn ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          <span className="nav-icon">🔍</span>
          <span className="nav-label">Search</span>
        </button>
        
        <button 
          className={`mobile-nav-btn ${activeTab === 'location' ? 'active' : ''}`}
          onClick={() => setActiveTab('location')}
          disabled={!selectedRouter}
        >
          <span className="nav-icon">📍</span>
          <span className="nav-label">Location</span>
        </button>
        
        <button 
          className={`mobile-nav-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
          disabled={!selectedRouter}
        >
          <span className="nav-icon">📊</span>
          <span className="nav-label">Stats</span>
        </button>
      </div>
    </div>
  );
};

export default MobilePage;
