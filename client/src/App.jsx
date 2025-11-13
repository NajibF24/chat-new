import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import Login from './components/Login';
import Chat from './components/Chat';
import AdminDashboard from './components/AdminDashboard';

// ✅ CRITICAL FIX: Configure axios to use relative URLs (nginx will proxy)
axios.defaults.withCredentials = true;
axios.defaults.baseURL = ''; // Empty = relative URLs, nginx handles proxy

// Add request interceptor for debugging
axios.interceptors.request.use(
  config => {
    console.log('🌐 Axios Request:', config.method.toUpperCase(), config.url);
    return config;
  },
  error => {
    console.error('❌ Axios Request Error:', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for debugging
axios.interceptors.response.use(
  response => {
    console.log('✅ Axios Response:', response.status, response.config.url);
    return response;
  },
  error => {
    console.error('❌ Axios Response Error:', error.response?.status, error.config?.url);
    return Promise.reject(error);
  }
);

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      console.log('🔐 Checking authentication...');
      const response = await axios.get('/api/auth/me');
      console.log('✅ Auth check successful:', response.data);
      setUser(response.data.user);
    } catch (error) {
      console.log('ℹ️ Not authenticated:', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-steel-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-xl text-steel-600">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {!user ? (
          <>
            <Route path="/login" element={<Login setUser={setUser} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        ) : (
          <>
            <Route 
              path="/" 
              element={<Chat user={user} handleLogout={handleLogout} />} 
            />
            {user.isAdmin && (
              <Route 
                path="/admin" 
                element={<AdminDashboard user={user} handleLogout={handleLogout} />} 
              />
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
