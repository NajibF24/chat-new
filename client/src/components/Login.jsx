import React, { useState } from 'react';
import axios from 'axios';

function Login({ setUser }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    console.log('🔐 Login attempt:', username);
    console.log('   Current origin:', window.location.origin);

    try {
      // ✅ FIX: Tambahkan { withCredentials: true } agar cookie session disimpan browser
      const response = await axios.post('/api/auth/login', 
        { username, password },
        { withCredentials: true } 
      );
      
      console.log('✅ Login successful');
      console.log('   User:', response.data.user);
      
      setUser(response.data.user);
    } catch (err) {
      console.error('❌ Login failed');
      console.error('   Error:', err.response?.data || err.message);
      
      let errorMessage = 'Login failed';
      
      if (err.response) {
        if (err.response.status === 401) {
          errorMessage = 'Invalid username or password';
        } else if (err.response.status === 500) {
          errorMessage = err.response.data?.error || 'Server error - please try again';
        } else if (err.response.status === 502) {
          errorMessage = 'Backend server is not responding - please contact IT';
        } else {
          errorMessage = err.response.data?.error || 'An error occurred';
        }
      } else if (err.request) {
        console.error('   No response from server');
        errorMessage = 'Cannot connect to server - please check your connection';
      } else {
        console.error('   Request setup error:', err.message);
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-steel-100">
      <div className="w-full max-w-md">
        {/* Logo/Company Name */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary-600 mb-4 shadow-lg">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-steel-800">Garuda Yamato Steel</h1>
          <p className="text-steel-600 mt-2">AI Assistant Portal</p>
          <p className="text-xs text-steel-500 mt-1">Powered by Active Directory</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-steel-200">
          <h2 className="text-2xl font-bold text-steel-800 mb-6 text-center">Welcome Back</h2>
          
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-steel-700 mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 border-2 border-steel-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 outline-none"
                placeholder="Enter your AD username"
                required
                autoComplete="username"
                autoFocus
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-steel-700 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border-2 border-steel-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 outline-none"
                placeholder="Enter your AD password"
                required
                autoComplete="current-password"
              />
            </div>
            
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                <div className="flex items-start space-x-2">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <div className="font-semibold">{error}</div>
                    {error.includes('502') && (
                      <div className="text-xs mt-1">
                        The backend server is not responding. Please contact IT support.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            <button
              type="submit"
              className="w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  <span>Sign In</span>
                </>
              )}
            </button>
          </form>
          
          <div className="mt-6 pt-6 border-t border-steel-200">
            <div className="text-center text-xs text-steel-500">
              <p>Use your Active Directory credentials</p>
              <p className="mt-1">Having trouble? Contact IT Support</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
