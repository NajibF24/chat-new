import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import Login from './components/Login';
import Chat from './components/Chat';
import AdminDashboard from './components/AdminDashboard';
import EmbedChat from './components/EmbedChat';

// ✅ Capacitor platform detection (untuk APK mobile)
let isNativePlatform = false;
try {
  const { Capacitor } = require('@capacitor/core');
  isNativePlatform = Capacitor.isNativePlatform();
} catch (e) {
  // @capacitor/core tidak tersedia (web build) — tidak masalah
}

// ✅ CRITICAL: Configure axios for HTTPS with credentials
axios.defaults.withCredentials = true; // ✅ MUST for cookies/session
// Di mobile (Capacitor APK), arahkan ke server production.
// Di web, tetap pakai relative URL (nginx proxies to backend).
axios.defaults.baseURL = isNativePlatform
  ? 'https://chat.gyssteel.com'
  : ''; // ✅ Empty = relative URLs (nginx proxies to backend)

// ✅ Set default headers
axios.defaults.headers.common['Accept'] = 'application/json';
axios.defaults.headers.common['Content-Type'] = 'application/json';

// Add request interceptor for debugging
axios.interceptors.request.use(
  config => {
    console.log('🌐 Axios Request:', config.method.toUpperCase(), config.url);
    console.log('   With credentials:', config.withCredentials);
    console.log('   Headers:', config.headers);
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
    // Log cookies if present
    const cookies = document.cookie;
    if (cookies) {
      console.log('🍪 Cookies present:', cookies.split(';').length, 'cookie(s)');
    } else {
      console.log('⚠️  No cookies present');
    }
    return response;
  },
  error => {
    console.error('❌ Axios Response Error:', error.response?.status, error.config?.url);

    // Detailed error logging
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
      console.error('   Headers:', error.response.headers);
    } else if (error.request) {
      console.error('   No response received');
      console.error('   Request:', error.request);
    } else {
      console.error('   Error:', error.message);
    }

    // Check cookies on error
    const cookies = document.cookie;
    if (!cookies) {
      console.error('⚠️  No cookies found - session might not be working');
      console.error('   Check:');
      console.error('   1. Server session config (secure, sameSite)');
      console.error('   2. CORS credentials: true');
      console.error('   3. Browser DevTools > Application > Cookies');
    }

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
      console.log('   Current cookies:', document.cookie || 'none');

      const response = await axios.get('/api/auth/me');
      console.log('✅ Auth check successful:', response.data);
      setUser(response.data.user);
    } catch (error) {
      console.log('ℹ️  Not authenticated:', error.message);

      // Check if it's a CORS or network error
      if (!error.response) {
        console.error('⚠️  Network error - backend might be down or CORS issue');
        console.error('   Error:', error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
      setUser(null);

      // Clear all client-side storage (includes welcome screen flags)
      localStorage.clear();
      sessionStorage.clear();

      console.log('✅ Logged out successfully');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-steel-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-xl text-steel-600 dark:text-gray-300">Loading...</div>
          <div className="text-sm text-steel-500 dark:text-gray-500 mt-2">GYS Portal AI</div>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* ✅ Embed route — SELALU accessible, handle auth sendiri */}
        <Route path="/embed/:botId" element={<EmbedChat />} />
        {/* Auth-gated routes */}
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
            {(user.isAdmin || user.isBotCreator) && (
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
