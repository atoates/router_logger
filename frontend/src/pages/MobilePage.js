import React, { useState } from 'react';
import MobileSearch from '../components/mobile/MobileSearch';
import MobileLocation from '../components/mobile/MobileLocation';
import MobileStats from '../components/mobile/MobileStats';
import './MobilePage.css';

const MobilePage = () => {
  const [activeTab, setActiveTab] = useState('search');
  const [selectedRouter, setSelectedRouter] = useState(null);

  const handleSelectRouter = (router) => {
    setSelectedRouter(router);
  };

  return (
    <div className="mobile-page">
      <div className="mobile-content">
        {activeTab === 'search' && (
          <MobileSearch 
            onSelectRouter={handleSelectRouter}
            selectedRouter={selectedRouter}
          />
        )}
        
        {activeTab === 'location' && selectedRouter && (
          <MobileLocation router={selectedRouter} />
        )}
        
        {activeTab === 'stats' && selectedRouter && (
          <MobileStats router={selectedRouter} />
        )}
      </div>

      <nav className="mobile-nav">
        <button 
          className={activeTab === 'search' ? 'active' : ''}
          onClick={() => setActiveTab('search')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          Search
        </button>
        
        <button 
          className={activeTab === 'location' ? 'active' : ''}
          onClick={() => selectedRouter && setActiveTab('location')}
          disabled={!selectedRouter}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          Location
        </button>
        
        <button 
          className={activeTab === 'stats' ? 'active' : ''}
          onClick={() => selectedRouter && setActiveTab('stats')}
          disabled={!selectedRouter}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="20" x2="12" y2="10"/>
            <line x1="18" y1="20" x2="18" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="16"/>
          </svg>
          Stats
        </button>
      </nav>
    </div>
  );
};

export default MobilePage;
