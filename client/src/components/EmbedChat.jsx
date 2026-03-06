// client/src/components/EmbedChat.jsx
// Standalone chat page designed to be embedded via iframe
// URL: /embed/:botId
// Supports query params: ?theme=dark|light, ?accent=hex, ?brand=true|false
// ✅ NEW: Includes inline login form — no redirect to main app needed

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import BotAvatar from './BotAvatar';

// ─── Axios config ───────────────────────────────────────────────
axios.defaults.withCredentials = true;

// ─── Utility: get file URL ──────────────────────────────────────
const getFileUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  if (path.startsWith('/')) return path;
  return `/api/files/${path}`;
};

// ─── Minimal Markdown renderer ──────────────────────────────────
function EmbedMessage({ content, isUser }) {
  return (
    <div className={`prose max-w-none text-sm leading-relaxed ${isUser ? 'prose-invert' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }) {
            const code = String(children).replace(/\n$/, '');
            if (inline) {
              return (
                <code className="px-1 py-0.5 rounded text-xs font-mono bg-black/10" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <div className="my-2 rounded-lg overflow-hidden border border-black/10">
                <pre className="p-3 text-xs bg-gray-900 text-gray-100 overflow-x-auto">
                  <code>{code}</code>
                </pre>
              </div>
            );
          },
          p: ({ node, children, ...props }) => <p className="mb-2 last:mb-0" {...props}>{children}</p>,
          ul: ({ node, ...props }) => <ul className="list-disc pl-4 mb-2 space-y-0.5" {...props} />,
          ol: ({ node, ...props }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5" {...props} />,
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-black/10">
              <table className="w-full text-xs" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => <th className="px-3 py-1.5 text-left bg-black/5 font-bold border-b border-black/10" {...props} />,
          td: ({ node, ...props }) => <td className="px-3 py-1.5 border-r last:border-r-0 border-black/5" {...props} />,
          a: ({ node, ...props }) => <a className="underline font-medium hover:opacity-70" target="_blank" rel="noreferrer" {...props} />,
        }}
      >
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}

// ─── Typing indicator ────────────────────────────────────────────
function TypingDots({ color }) {
  return (
    <div className="flex items-center gap-1 py-1 px-1">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ backgroundColor: color || '#007857', animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </div>
  );
}

// ─── Inline Login Form ───────────────────────────────────────────
function EmbedLoginForm({ onLoginSuccess, accentHex, isDark, surface, border, textPrimary, textSecondary, bg, showBrand }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [showPass, setShowPass]     = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!identifier.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/login', {
        username: identifier.trim().toLowerCase(),
        password,
      }, { withCredentials: true });
      onLoginSuccess(res.data.user);
    } catch (err) {
      const msg = err.response?.status === 401
        ? 'Username/email atau password salah.'
        : err.response?.data?.error || 'Gagal terhubung ke server.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex flex-col w-full overflow-hidden"
      style={{ height: '100%', minHeight: '100vh', background: bg, fontFamily: "'Segoe UI', system-ui, sans-serif" }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: surface, borderColor: border }}
      >
        {/* Logo placeholder */}
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ background: accentHex }}
        >
          AI
        </div>
        <div>
          <p className="font-bold text-sm" style={{ color: textPrimary }}>Portal AI</p>
          <p className="text-xs" style={{ color: textSecondary }}>PT Garuda Yamato Steel</p>
        </div>
      </div>

      {/* Login body */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-6">

        {/* Lock icon */}
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-sm"
          style={{ background: `${accentHex}18` }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={accentHex} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>

        <h2 className="text-base font-bold mb-1" style={{ color: textPrimary }}>Sign In to Continue</h2>
        <p className="text-xs text-center mb-5 max-w-xs leading-relaxed" style={{ color: textSecondary }}>
          Masuk dengan akun Active Directory atau akun lokal Anda
        </p>

        {/* Form */}
        <form onSubmit={handleLogin} className="w-full max-w-xs space-y-3">

          {/* Username / Email */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: textSecondary }}>
              Username atau Email
            </label>
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40"
                style={{ color: textPrimary }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <input
                type="text"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="user.name atau user@gyssteel.com"
                required
                autoComplete="username"
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border text-sm outline-none transition-all"
                style={{
                  background: isDark ? '#111827' : '#F9FAFB',
                  borderColor: border,
                  color: textPrimary,
                  '--tw-ring-color': accentHex,
                }}
                onFocus={e => { e.target.style.borderColor = accentHex; e.target.style.boxShadow = `0 0 0 2px ${accentHex}22`; }}
                onBlur={e => { e.target.style.borderColor = border; e.target.style.boxShadow = 'none'; }}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: textSecondary }}>
              Password
            </label>
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40"
                style={{ color: textPrimary }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="w-full pl-9 pr-10 py-2.5 rounded-xl border text-sm outline-none transition-all"
                style={{
                  background: isDark ? '#111827' : '#F9FAFB',
                  borderColor: border,
                  color: textPrimary,
                }}
                onFocus={e => { e.target.style.borderColor = accentHex; e.target.style.boxShadow = `0 0 0 2px ${accentHex}22`; }}
                onBlur={e => { e.target.style.borderColor = border; e.target.style.boxShadow = 'none'; }}
              />
              {/* Toggle password visibility */}
              <button
                type="button"
                onClick={() => setShowPass(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-70 transition-opacity"
                style={{ color: textPrimary }}
                tabIndex={-1}
              >
                {showPass ? (
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
              style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}
            >
              <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !identifier.trim() || !password}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all flex items-center justify-center gap-2 mt-1"
            style={{
              background: loading || !identifier.trim() || !password ? `${accentHex}88` : accentHex,
              cursor: loading || !identifier.trim() || !password ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? (
              <>
                <div
                  className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                />
                <span>Memverifikasi...</span>
              </>
            ) : (
              <>
                <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                <span>SIGN IN</span>
              </>
            )}
          </button>
        </form>

        {/* Help text */}
        <p className="text-xs text-center mt-4 leading-relaxed max-w-xs" style={{ color: textSecondary }}>
          Gunakan akun Active Directory (AD/LDAP) atau akun lokal yang diberikan admin.
        </p>
      </div>

      {/* Footer branding */}
      {showBrand && (
        <div
          className="flex-shrink-0 py-2.5 text-center border-t text-xs"
          style={{ borderColor: border, color: textSecondary, background: surface }}
        >
          Powered by <span className="font-bold">GYS Portal AI</span>
        </div>
      )}
    </div>
  );
}

// ─── MAIN EMBED COMPONENT ────────────────────────────────────────
export default function EmbedChat() {
  const { botId } = useParams();
  const [searchParams] = useSearchParams();

  const theme     = searchParams.get('theme') || 'light';
  const isDark    = theme === 'dark';
  const accentHex = searchParams.get('accent') || (isDark ? '#48AE92' : '#007857');
  const showBrand = searchParams.get('brand') !== 'false';

  const [bot,         setBot]         = useState(null);
  const [messages,    setMessages]    = useState([]);
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [threadId,    setThreadId]    = useState(null);
  const [user,        setUser]        = useState(null);      // ← logged-in user
  const [authLoading, setAuthLoading] = useState(true);

  const messagesEndRef = useRef(null);
  const textareaRef    = useRef(null);
  const inputRef       = useRef(null);

  // ── Theme tokens ─────────────────────────────────────────────
  const bg             = isDark ? '#111827' : '#F8F9FA';
  const surface        = isDark ? '#1F2937' : '#FFFFFF';
  const border         = isDark ? '#374151' : '#E5E7EB';
  const textPrimary    = isDark ? '#F9FAFB' : '#111827';
  const textSecondary  = isDark ? '#9CA3AF' : '#6B7280';
  const userBubbleBg   = accentHex;
  const botBubbleBg    = isDark ? '#374151' : '#F3F4F6';
  const botBubbleTxt   = isDark ? '#F9FAFB' : '#111827';

  // ── Check auth on mount ───────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get('/api/auth/me');
        setUser(res.data.user);
      } catch {
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  // ── Fetch bot after auth ──────────────────────────────────────
  useEffect(() => {
    if (!user || !botId) return;
    (async () => {
      try {
        const res = await axios.get('/api/embed/bot/' + botId);
        setBot(res.data);
      } catch {
        setError('Bot tidak ditemukan atau tidak tersedia.');
      }
    })();
  }, [user, botId]);

  // ── Auto-scroll ───────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── Handle login success ──────────────────────────────────────
  const handleLoginSuccess = (loggedInUser) => {
    setUser(loggedInUser);
  };

  // ── Send message ──────────────────────────────────────────────
  const handleSend = async () => {
    if (!input.trim() || loading || !bot) return;
    const text = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    setMessages(prev => [...prev, {
      role: 'user', content: text, _id: Date.now(), createdAt: new Date()
    }]);
    setLoading(true);

    try {
      const res = await axios.post('/api/chat/message', {
        message: text,
        botId:   bot._id,
        threadId,
        history: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
      });
      setMessages(prev => [...prev, {
        role: 'assistant', content: res.data.response, _id: Date.now() + 1, createdAt: new Date()
      }]);
      if (res.data.threadId) setThreadId(res.data.threadId);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Maaf, terjadi kesalahan. Silakan coba lagi.',
        _id: Date.now() + 1,
        createdAt: new Date()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleStarter = (q) => {
    setInput(q);
    setTimeout(() => { inputRef.current?.focus(); }, 50);
  };

  // ── Loading spinner (initial auth check) ─────────────────────
  if (authLoading) {
    return (
      <div style={{ background: bg, color: textPrimary }}
        className="w-full h-screen flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: accentHex, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  // ── NOT LOGGED IN → show inline login form ────────────────────
  if (!user) {
    return (
      <EmbedLoginForm
        onLoginSuccess={handleLoginSuccess}
        accentHex={accentHex}
        isDark={isDark}
        surface={surface}
        border={border}
        textPrimary={textPrimary}
        textSecondary={textSecondary}
        bg={bg}
        showBrand={showBrand}
      />
    );
  }

  // ── Bot error ─────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ background: bg, color: textPrimary }}
        className="w-full h-screen flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-4xl">🤖</div>
        <p className="font-semibold text-sm">{error}</p>
      </div>
    );
  }

  // ── Bot loading ───────────────────────────────────────────────
  if (!bot) {
    return (
      <div style={{ background: bg }} className="w-full h-screen flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: accentHex, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const hasMessages = messages.length > 0;

  // ── Main chat UI ──────────────────────────────────────────────
  return (
    <div
      className="flex flex-col w-full overflow-hidden"
      style={{ height: '100%', minHeight: '100vh', background: bg, fontFamily: "'Segoe UI', system-ui, sans-serif" }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: surface, borderColor: border }}
      >
        <BotAvatar bot={bot} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate" style={{ color: textPrimary }}>{bot.name}</p>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: accentHex }} />
            <span className="text-xs font-medium" style={{ color: textSecondary }}>Online</span>
          </div>
        </div>

        {/* User info + logout */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs hidden sm:block font-medium truncate max-w-[80px]" style={{ color: textSecondary }}>
            {user?.username}
          </span>
          <button
            onClick={async () => {
              try { await axios.post('/api/auth/logout'); } catch {}
              setUser(null);
              setMessages([]);
              setThreadId(null);
              setBot(null);
            }}
            title="Sign out"
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-60"
            style={{ color: textSecondary }}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
          <button
            onClick={() => { setMessages([]); setThreadId(null); }}
            title="Percakapan baru"
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-60"
            style={{ color: textSecondary }}
          >
            ↺
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ background: bg }}>
        {!hasMessages && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="mb-4"><BotAvatar bot={bot} size="lg" /></div>
            <p className="font-bold text-sm mb-1" style={{ color: textPrimary }}>{bot.name}</p>
            <p className="text-xs mb-6 max-w-xs leading-relaxed" style={{ color: textSecondary }}>
              {bot.description || 'Tanyakan apa saja!'}
            </p>
            {bot.starterQuestions?.length > 0 && (
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {bot.starterQuestions.slice(0, 4).map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleStarter(q)}
                    className="text-xs text-left px-3 py-2 rounded-xl border transition-all hover:opacity-80"
                    style={{ background: surface, borderColor: border, color: textPrimary }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map(msg => {
          const isUser = msg.role === 'user';
          return (
            <div key={msg._id} className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && <div className="flex-shrink-0 mb-0.5"><BotAvatar bot={bot} size="xs" /></div>}
              <div
                className="max-w-[78%] px-3 py-2.5 rounded-2xl text-sm shadow-sm"
                style={{
                  background:   isUser ? userBubbleBg : botBubbleBg,
                  color:        isUser ? '#ffffff' : botBubbleTxt,
                  borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                }}
              >
                <EmbedMessage content={msg.content} isUser={isUser} />
                <div className="text-right text-[9px] mt-1 opacity-50"
                  style={{ color: isUser ? '#fff' : textSecondary }}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex items-end gap-2 justify-start">
            <BotAvatar bot={bot} size="xs" />
            <div className="px-3 py-2.5 rounded-2xl shadow-sm"
              style={{ background: botBubbleBg, borderRadius: '16px 16px 16px 4px' }}>
              <TypingDots color={accentHex} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-3 py-3 border-t" style={{ background: surface, borderColor: border }}>
        <div
          className="flex items-end gap-2 rounded-xl border px-3 py-2 transition-all focus-within:ring-1"
          style={{ background: isDark ? '#111827' : '#F9FAFB', borderColor: border, '--tw-ring-color': accentHex }}
        >
          <textarea
            ref={el => { textareaRef.current = el; inputRef.current = el; }}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 100)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Pesan ke ${bot.name}...`}
            disabled={loading}
            rows={1}
            className="flex-1 bg-transparent resize-none text-sm outline-none placeholder-gray-400"
            style={{ color: textPrimary, maxHeight: '100px', lineHeight: '1.4' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-white transition-all hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
            style={{ background: accentHex }}
          >
            ➤
          </button>
        </div>

        {showBrand && (
          <p className="text-center text-[9px] mt-1.5" style={{ color: textSecondary }}>
            Powered by <span className="font-bold">GYS Portal AI</span>
          </p>
        )}
      </div>
    </div>
  );
}