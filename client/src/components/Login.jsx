import React, { useState } from 'react';
import axios from 'axios';

const Login = ({ setUser }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // STATE: Kontrol Avatar Widget
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
          errorMessage = 'Username atau password salah.';
        } else {
          errorMessage = err.response.data?.error || 'Terjadi kesalahan sistem.';
        }
      } else {
        errorMessage = 'Tidak dapat terhubung ke server.';
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-gys-bg font-sans overflow-hidden relative">

      {/* =========================================
          BAGIAN KIRI: FORMULIR LOGIN (LIGHT)
         ========================================= */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-8 sm:p-12 z-20 relative bg-white lg:bg-gys-bg shadow-xl lg:shadow-none">

        <div className="w-full max-w-md z-10">

          {/* Logo & Header */}
          <div className="text-center mb-10">
             <div className="flex flex-col items-center justify-center gap-3 mb-6">
                <div className="w-16 h-16 bg-gys-navy rounded-xl flex items-center justify-center shadow-lg transform rotate-3">
                    <span className="text-white text-3xl font-bold">G</span>
                </div>
                {/* Opsional: Jika ada file logo asli, gunakan img src seperti sebelumnya */}
             </div>
             <h1 className="text-2xl font-bold text-gys-navy tracking-tight mb-2">PT GARUDA YAMATO STEEL</h1>
             <p className="text-gys-subtext text-sm font-medium uppercase tracking-widest">Internal AI Portal</p>
          </div>

          {/* Login Card (Clean White) */}
          <div className="bg-white p-8 rounded-xl border border-gys-border shadow-sm relative">
            <div className="mb-6 border-b border-slate-100 pb-4">
              <h2 className="text-lg font-bold text-gys-text">Sign In</h2>
              <p className="text-slate-500 text-sm mt-1">Gunakan akun Active Directory Anda.</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              {/* Username Input */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gys-navy uppercase ml-1">Username</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-slate-400 group-focus-within:text-gys-navy transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-gys-text placeholder-slate-400 focus:outline-none focus:border-gys-navy focus:ring-1 focus:ring-gys-navy transition-all"
                    placeholder="Contoh: user.name"
                    required
                    autoFocus
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gys-navy uppercase ml-1">Password</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-slate-400 group-focus-within:text-gys-navy transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-gys-text placeholder-slate-400 focus:outline-none focus:border-gys-navy focus:ring-1 focus:ring-gys-navy transition-all"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm flex items-center">
                  <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gys-navy hover:bg-slate-800 text-white font-bold py-3 rounded-lg transition-all shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <span>LOGIN</span>
                )}
              </button>
            </form>
          </div>

          <div className="mt-8 text-center border-t border-slate-200 pt-4">
            <p className="text-slate-400 text-xs">
              &copy; 2026 PT Garuda Yamato Steel. All Rights Reserved.<br/>
              Authorized Personnel Only.
            </p>
          </div>
        </div>
      </div>

      {/* =========================================
          BAGIAN KANAN: GAMBAR GEDUNG (CLEAN)
         ========================================= */}
      <div className="hidden lg:block lg:w-1/2 relative h-screen bg-slate-200">
        <img
            src="/assets/login.jpeg"
            alt="Garuda Yamato Steel Factory"
            className="absolute inset-0 w-full h-full object-cover filter brightness-[0.85] contrast-[1.1]" // Sedikit darkened agar teks putih terbaca jika ada overlay
        />
        {/* Overlay Navy Gradient */}
        <div className="absolute top-0 left-0 w-full h-full bg-gys-navy/30 mix-blend-multiply z-10"></div>
        <div className="absolute top-0 left-0 w-32 h-full bg-gradient-to-r from-gys-bg to-transparent z-20"></div>
      </div>

      {/* =========================================
          FLOATING AVATAR WIDGET (LIGHT THEME)
         ========================================= */}

      {/* 1. Iframe Container (Popup) */}
      {isAvatarOpen && (
        <div className="fixed bottom-24 right-6 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <div className="bg-white border border-slate-200 p-1 rounded-2xl shadow-2xl w-[350px] sm:w-[400px] h-[500px] flex flex-col relative overflow-hidden">

             {/* Header Popup */}
             <div className="flex justify-between items-center px-4 py-3 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                   <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                   <span className="text-gys-navy text-xs font-bold tracking-widest uppercase">Digital Receptionist</span>
                </div>
                <button
                  onClick={() => setIsAvatarOpen(false)}
                  className="text-slate-400 hover:text-red-500 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
             </div>

             {/* The Iframe */}
             <iframe
                src="https://chat.unith.ai/none-1579/assistit-24328?api_key=abab404e3143433e923c0b016f302081"
                width="100%"
                height="100%"
                allow="microphone"
                title="Digital Receptionist"
                className="flex-1 border-none bg-slate-50"
             ></iframe>
          </div>
        </div>
      )}

      {/* 2. Floating Toggle Button (Navy Style) */}
      <button
        onClick={() => setIsAvatarOpen(!isAvatarOpen)}
        className={`fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full shadow-xl border-4 border-white flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 ${
            isAvatarOpen ? 'bg-red-600 hover:bg-red-700' : 'bg-gys-navy hover:bg-slate-800'
        }`}
      >
        {isAvatarOpen ? (
           // Icon X (Close)
           <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
           </svg>
        ) : (
           // Icon Chat/Avatar
           <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
           </svg>
        )}

        {/* Notification Dot */}
        {!isAvatarOpen && (
          <span className="absolute top-0 right-0 flex h-4 w-4 -mt-1 -mr-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500"></span>
          </span>
        )}
      </button>

    </div>
  );
};

export default Login;
