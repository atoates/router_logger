import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { clickUpAuthCallback } from '../services/api';

const ClickUpCallback = () => {
  const [status, setStatus] = useState('processing');
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      const state = params.get('state');
      const storedState = sessionStorage.getItem('clickup_oauth_state');

      if (!code) {
        throw new Error('No authorization code received');
      }

      if (state !== storedState) {
        throw new Error('Invalid state parameter - possible CSRF attack');
      }

      // Exchange code for token
      const response = await clickUpAuthCallback(code, state);
      
      if (response.data.success) {
        setStatus('success');
        sessionStorage.removeItem('clickup_oauth_state');
        
        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
          navigate('/');
        }, 2000);
      } else {
        throw new Error('Authorization failed');
      }
    } catch (err) {
      console.error('OAuth callback error:', err);
      setError(err.message || 'Authorization failed');
      setStatus('error');
      
      // Redirect to dashboard after 3 seconds
      setTimeout(() => {
        navigate('/');
      }, 3000);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: '#fff'
    }}>
      <div style={{
        background: 'rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(10px)',
        padding: '40px',
        borderRadius: '16px',
        textAlign: 'center',
        maxWidth: '400px'
      }}>
        {status === 'processing' && (
          <>
            <div style={{
              width: '60px',
              height: '60px',
              border: '4px solid rgba(255, 255, 255, 0.3)',
              borderTop: '4px solid #fff',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 20px'
            }}></div>
            <h2>Connecting to ClickUp...</h2>
            <p style={{ opacity: 0.8 }}>Please wait while we complete the authorization</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{
              width: '60px',
              height: '60px',
              background: '#22c55e',
              borderRadius: '50%',
              margin: '0 auto 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px'
            }}>✓</div>
            <h2>Successfully Connected!</h2>
            <p style={{ opacity: 0.8 }}>Redirecting to dashboard...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{
              width: '60px',
              height: '60px',
              background: '#ef4444',
              borderRadius: '50%',
              margin: '0 auto 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px'
            }}>✕</div>
            <h2>Connection Failed</h2>
            <p style={{ opacity: 0.8 }}>{error}</p>
            <p style={{ opacity: 0.6, fontSize: '14px', marginTop: '10px' }}>
              Redirecting to dashboard...
            </p>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default ClickUpCallback;
