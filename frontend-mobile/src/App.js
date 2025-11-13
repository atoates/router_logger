import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import MobileLayout from './components/MobileLayout';
import LoginPage from './pages/LoginPage';
import SearchPage from './pages/SearchPage';
import LocationPage from './pages/LocationPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <MobileLayout>
                  <SearchPage />
                </MobileLayout>
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/location"
            element={
              <ProtectedRoute>
                <MobileLayout>
                  <LocationPage />
                </MobileLayout>
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/stats"
            element={
              <ProtectedRoute>
                <MobileLayout>
                  <StatsPage />
                </MobileLayout>
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <MobileLayout>
                  <SettingsPage />
                </MobileLayout>
              </ProtectedRoute>
            }
          />
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
