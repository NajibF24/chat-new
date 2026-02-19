import React, { useState } from 'react';
import axios from 'axios';

const Login = ({ setUser }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // STATE: Kontrol Avatar Widget (Digital Assistant)
  const [isAvatarOpen, setIsAvatarOpen] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await axios.post('/api/auth/login',
        { username, password },
        { withCredentials: true }
      );

      console.log('✅ Login successful');
      setUser(response.data.user);

    } catch (err) {
      console.error('❌ Login failed', err);
      let errorMessage = 'Login failed';
      if (err.response) {
        if (err.response.status === 401) {
          errorMessage = 'Invalid username or password.';
        } else {
          errorMessage = err.response.data?.error || 'A system error occurred.';
        }
      } else {
        errorMessage = 'Failed to connect to the server.';
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-steel-lightest font-sans p-4 relative overflow-hidden">

      {/* =========================================
          KOTAK LOGIN UTAMA (CENTERED CARD)
          ========================================= */}
      <div className="w-full max-w-md bg-white p-8 sm:p-10 rounded-2xl shadow-lg border border-steel-light/20 z-20">

        {/* Header & Logo Section */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="mb-4 flex justify-center items-center min-h-[64px]">
            <img
              src="/assets/gys-logo.webp" 
              alt="Garuda Yamato Steel Logo"
              className="h-16 w-auto object-contain"
              onError={(e) => {
                e.target.style.display = 'none';
                document.getElementById('logo-fallback').style.display = 'block';
              }}
            />
            <h1 id="logo-fallback" className="hidden text-5xl font-black text-primary tracking-tighter">GYS</h1>
          </div>

          <h2 className="text-xl font-bold text-gray-800">PT Garuda Yamato Steel</h2>
          <p className="text-steel text-xs font-bold uppercase tracking-[0.2em] mt-1.5">
            Internal AI Portal
          </p>
        </div>

        <div className="mb-6 border-b border-steel-lightest pb-4">
          <h3 className="text-lg font-bold text-gray-800 text-center">Sign In</h3>
          <p className="text-steel text-sm mt-1 text-center">Use your Active Directory account</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-steel uppercase">Username</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-steel-light group-focus-within:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                </svg>
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-steel-lightest/50 border border-steel-light/50 rounded-lg text-gray-800 placeholder-steel-light focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                placeholder="Contoh: user.name"
                required
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-steel uppercase">Password</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-steel-light group-focus-within:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-steel-lightest/50 border border-steel-light/50 rounded-lg text-gray-800 placeholder-steel-light focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm flex items-center">
              <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 bg-primary hover:bg-primary-dark text-white font-bold py-3 rounded-lg transition-all shadow hover:shadow-md disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Checking credentials...</span>
              </>
            ) : (
              <span>LOGIN</span>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6">
          <p className="text-steel-light text-xs text-center leading-relaxed">
            &copy; 2026 PT Garuda Yamato Steel.<br/>
            Authorized Personnel Only.
          </p>
        </div>
      </div>

      {/* =========================================
          FLOATING AVATAR WIDGET (NONAKTIF/DIKOMENTARI)
          ========================================= */}
      {/* {isAvatarOpen && (
        <div className="fixed bottom-24 right-6 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <div className="bg-white border border-steel-lightest p-1 rounded-2xl shadow-2xl w-[350px] sm:w-[400px] h-[500px] flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 border-b border-steel-lightest bg-white">
               <div className="flex items-center gap-2">
                 <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                 <span className="text-primary text-xs font-bold tracking-widest uppercase">Digital Assistant</span>
               </div>
               <button onClick={() => setIsAvatarOpen(false)} className="text-steel-light hover:text-steel transition-colors">
                 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                 </svg>
               </button>
            </div>
            <iframe
              src="https://chat.unith.ai/none-1579/assistit-24328?api_key=abab404e3143433e923c0b016f302081"
              width="100%"
              height="100%"
              allow="microphone"
              title="Digital Receptionist"
              className="flex-1 border-none bg-steel-lightest"
            ></iframe>
          </div>
        </div>
      )}

      <button
        onClick={() => setIsAvatarOpen(!isAvatarOpen)}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg border-2 border-white flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 ${
            isAvatarOpen ? 'bg-steel hover:bg-gray-600' : 'bg-primary hover:bg-primary-dark'
        }`}
      >
        {isAvatarOpen ? (
           <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
           </svg>
        ) : (
           <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
           </svg>
        )}
        {!isAvatarOpen && (
          <span className="absolute top-0 right-0 flex h-3.5 w-3.5 -mt-0.5 -mr-0.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500 border-2 border-white"></span>
          </span>
        )}
      </button>
      */}

    </div>
  );
};

export default Login;
