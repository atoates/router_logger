import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import InstalledRouters from './InstalledRouters';
import StoredWithRouters from './OutOfServiceRouters';
import ReturnsPage from './ReturnsPage';
import DecommissionedPage from './DecommissionedPage';
import './FleetPage.css';

const TABS = [
  { id: 'installed', label: 'Installed', icon: '📍', description: 'Routers deployed at properties' },
  { id: 'stored', label: 'Stored', icon: '📦', description: 'Routers held by team members' },
  { id: 'returns', label: 'Returns', icon: '🔄', description: 'Routers being returned' },
  { id: 'decommissioned', label: 'Decommissioned', icon: '⚠️', description: 'Retired routers' },
];

export default function FleetPage({ onOpenRouter }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'installed';

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId });
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'installed':
        return <InstalledRouters onOpenRouter={onOpenRouter} />;
      case 'stored':
        return <StoredWithRouters onOpenRouter={onOpenRouter} />;
      case 'returns':
        return <ReturnsPage />;
      case 'decommissioned':
        return <DecommissionedPage />;
      default:
        return <InstalledRouters onOpenRouter={onOpenRouter} />;
    }
  };

  const currentTab = TABS.find(t => t.id === activeTab) || TABS[0];

  return (
    <div className="fleet-page">
      <div className="fleet-header">
        <div className="fleet-header-content">
          <h1 className="fleet-title">📡 Router Fleet</h1>
          <p className="fleet-subtitle">Manage router lifecycle and assignments</p>
        </div>
      </div>

      <div className="fleet-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`fleet-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => handleTabChange(tab.id)}
          >
            <span className="fleet-tab-icon">{tab.icon}</span>
            <span className="fleet-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="fleet-tab-description">
        {currentTab.icon} {currentTab.description}
      </div>

      <div className="fleet-content">
        {renderContent()}
      </div>
    </div>
  );
}
