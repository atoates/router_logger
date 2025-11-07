import React, { useState, useEffect } from 'react';
import MobileLogin from './MobileLogin';
import MobilePage from './MobilePage';

const API_BASE = process.env.REACT_APP_API_URL || '';

const MobileAuthWrapper = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    checkAuthentication();
  }, []);

  const checkAuthentication = async () => {
    const sessionToken = localStorage.getItem('sessionToken');
    
    if (!sessionToken) {
      setIsAuthenticated(false);
      setIsChecking(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/session/verify`, {
        headers: {
          'Authorization': `Bearer ${sessionToken}`
        }
      });

      if (response.ok) {
        setIsAuthenticated(true);
      } else {
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('sessionExpiry');
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setIsAuthenticated(false);
    } finally {
      setIsChecking(false);
    }
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('sessionExpiry');
    setIsAuthenticated(false);
  };

  if (isChecking) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f3f4f6'
      }}>
        <div style={{ fontSize: '18px', color: '#6b7280' }}>Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <MobileLogin onLoginSuccess={handleLoginSuccess} />;
  }

  return <MobilePage onLogout={handleLogout} />;
};

export default MobileAuthWrapper;
