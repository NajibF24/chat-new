import React, { useState } from 'react';
import axios from 'axios';

const Login = ({ setUser }) => {
  const [identifier, setIdentifier] = useState(''); // username ATAU email
  const [password, setPassword]     = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);

  // STATE: Kontrol Avatar Widget (Digital Assistant)
  const [isAvatarOpen, setIsAvatarOpen] = useState(false);

  // Deteksi apakah input terlihat seperti email
  const looksLikeEmail = (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Kirim sebagai field 'username' — backend akan cek apakah itu email atau username
      const response = await axios.post(
        '/api/auth/login',
        { username: identifier.trim(), password },
        { withCredentials: true }
      );

      console.log('✅ Login successful');
      setUser(response.data.user);

    } catch (err) {
      console.error('❌ Login failed', err);
      let errorMessage = 'Login gagal';
      if (err.response) {
        if (err.response.status === 401) {
          errorMessage = 'Username/email atau password tidak valid.';
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
          <p className="text-steel text-sm mt-1 text-center">Gunakan akun Active Directory Anda</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">

          {/* ── Username atau Email ─────────────────────────── */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-steel uppercase">Username atau Email</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                {/* Icon berubah: person kalau username, envelope kalau email */}
                {looksLikeEmail(identifier) ? (
                  <svg className="h-5 w-5 text-steel-light group-focus-within:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5 text-steel-light group-focus-within:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )}
              </div>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-steel-lightest/50 border border-steel-light/50 rounded-lg text-gray-800 placeholder-steel-light focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                placeholder="user.name atau user@gyssteel.com"
                required
                autoFocus
                autoComplete="username"
              />
            </div>
            <p className="text-[10px] text-steel-light pl-0.5">
              Bisa menggunakan username (contoh: <span className="font-mono font-medium">john.doe</span>) atau email perusahaan
            </p>
          </div>

          {/* ── Password ────────────────────────────────────── */}
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
                autoComplete="current-password"
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
                <span>Memverifikasi...</span>
              </>
            ) : (
              <span>MASUK</span>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6">
          <p className="text-steel-light text-xs text-center leading-relaxed">
            &copy; 2026 PT Garuda Yamato Steel.<br/>
            Khusus Pengguna yang Berwenang.
          </p>
        </div>
      </div>

      {/* =========================================
          FLOATING AVATAR WIDGET (NONAKTIF/DIKOMENTARI)
          ========================================= */}
      {/* {isAvatarOpen && (
        <div className="fixed bottom-24 right-6 z-50 animate-in slide-in-from-bottom-5 duration-300">
          ...
        </div>
      )} */}

    </div>
  );
};

export default Login;