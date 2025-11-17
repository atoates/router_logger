import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import './MobileLayout.css';

function MobileLayout({ children }) {
  const location = useLocation();

  const tabs = [
    { path: '/', label: 'Search', icon: '🔍' },
    { path: '/location', label: 'Location', icon: '📍' },
    { path: '/stats', label: 'Stats', icon: '📊' },
    { path: '/settings', label: 'Settings', icon: '⚙️' }
  ];

  return (
    <div className="mobile-layout">
      <main className="mobile-content">
        {children}
      </main>
      
      <nav className="mobile-nav">
        {tabs.map(tab => {
          const isActive = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`nav-tab ${isActive ? 'nav-tab-active' : ''}`}
            >
              <span className="nav-icon">{tab.icon}</span>
              <span className="nav-label">{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export default MobileLayout;




