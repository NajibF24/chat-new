// client/src/components/EmbedChat.jsx
// Standalone chat page designed to be embedded via iframe
// URL: /embed/:botId
// Supports query params: ?theme=dark|light, ?height=600, ?lang=en|id

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import BotAvatar from './BotAvatar';

// ─── Axios config (same as main app) ───────────────────────────
axios.defaults.withCredentials = true;

// ─── Utility: get file URL ──────────────────────────────────────
const getFileUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  if (path.startsWith('/')) return path;
  return `/api/files/${path}`;
};

// ─── Minimal Markdown renderer for embed ───────────────────────
function EmbedMessage({ content, isUser }) {
  return (
    <div
      className={`prose max-w-none text-sm leading-relaxed ${
        isUser ? 'prose-invert' : ''
      }`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }) {
            const code = String(children).replace(/\n$/, '');
            if (inline) {
              return (
                <code
                  className="px-1 py-0.5 rounded text-xs font-mono bg-black/10"
                  {...props}
                >
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
          p: ({ node, children, ...props }) => (
            <p className="mb-2 last:mb-0" {...props}>{children}</p>
          ),
          ul: ({ node, ...props }) => (
            <ul className="list-disc pl-4 mb-2 space-y-0.5" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="list-decimal pl-4 mb-2 space-y-0.5" {...props} />
          ),
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-black/10">
              <table className="w-full text-xs" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="px-3 py-1.5 text-left bg-black/5 font-bold border-b border-black/10" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="px-3 py-1.5 border-r last:border-r-0 border-black/5" {...props} />
          ),
          a: ({ node, ...props }) => (
            <a className="underline font-medium hover:opacity-70" target="_blank" rel="noreferrer" {...props} />
          ),
        }}
      >
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}

// ─── Typing indicator ───────────────────────────────────────────
function TypingDots({ color }) {
  return (
    <div className="flex items-center gap-1 py-1 px-1">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{
            backgroundColor: color || '#007857',
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── MAIN EMBED COMPONENT ───────────────────────────────────────
export default function EmbedChat() {
  const { botId } = useParams();
  const [searchParams] = useSearchParams();

  const theme     = searchParams.get('theme') || 'light';
  const isDark    = theme === 'dark';
  const accentHex = searchParams.get('accent') || (isDark ? '#48AE92' : '#007857');
  const showBrand = searchParams.get('brand') !== 'false';

  const [bot,      setBot]      = useState(null);
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [threadId, setThreadId] = useState(null);
  const [authed,   setAuthed]   = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  const messagesEndRef = useRef(null);
  const textareaRef    = useRef(null);
  const inputRef       = useRef(null);

  // ── Check auth / fetch bot on mount ───────────────────────────
  useEffect(() => {
    (async () => {
      try {
        await axios.get('/api/auth/me');
        setAuthed(true);
      } catch {
        setAuthed(false);
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!authed || !botId) return;
    (async () => {
      try {
        const res = await axios.get('/api/embed/bot/' + botId);
        setBot(res.data);
      } catch (e) {
        setError('Bot not found or unavailable.');
      }
    })();
  }, [authed, botId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── Send message ───────────────────────────────────────────────
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
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Sorry, something went wrong. Please try again.',
        _id: Date.now() + 1,
        createdAt: new Date()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Starter question click ─────────────────────────────────────
  const handleStarter = (q) => {
    setInput(q);
    setTimeout(() => {
      setInput(q);
      inputRef.current?.focus();
    }, 50);
  };

  // ── Theme tokens ───────────────────────────────────────────────
  const bg      = isDark ? '#111827' : '#F8F9FA';
  const surface = isDark ? '#1F2937' : '#FFFFFF';
  const border  = isDark ? '#374151' : '#E5E7EB';
  const textPrimary   = isDark ? '#F9FAFB' : '#111827';
  const textSecondary = isDark ? '#9CA3AF' : '#6B7280';
  const userBubbleBg  = accentHex;
  const userBubbleTxt = '#FFFFFF';
  const botBubbleBg   = isDark ? '#374151' : '#F3F4F6';
  const botBubbleTxt  = isDark ? '#F9FAFB' : '#111827';

  // ── Loading / error states ─────────────────────────────────────
  if (authLoading) {
    return (
      <div
        style={{ background: bg, color: textPrimary }}
        className="w-full h-screen flex items-center justify-center"
      >
        <div
          className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: accentHex, borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  if (!authed) {
    return (
      <div
        style={{ background: bg, color: textPrimary }}
        className="w-full h-screen flex flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <div className="text-4xl">🔒</div>
        <p className="font-semibold" style={{ color: textPrimary }}>
          Authentication Required
        </p>
        <p className="text-sm" style={{ color: textSecondary }}>
          Please log in to the portal to use this chat widget.
        </p>
        <a
          href="/login"
          target="_top"
          className="px-5 py-2 rounded-lg text-sm font-bold text-white"
          style={{ background: accentHex }}
        >
          Sign In
        </a>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{ background: bg, color: textPrimary }}
        className="w-full h-screen flex flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <div className="text-4xl">🤖</div>
        <p className="font-semibold">{error}</p>
      </div>
    );
  }

  if (!bot) {
    return (
      <div
        style={{ background: bg }}
        className="w-full h-screen flex items-center justify-center"
      >
        <div
          className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: accentHex, borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  const hasMessages = messages.length > 0;

  return (
    <div
      className="flex flex-col w-full overflow-hidden"
      style={{ height: '100%', minHeight: '100vh', background: bg, fontFamily: "'Segoe UI', system-ui, sans-serif" }}
    >
      {/* ── Header ── */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: surface, borderColor: border }}
      >
        <BotAvatar bot={bot} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate" style={{ color: textPrimary }}>
            {bot.name}
          </p>
          <div className="flex items-center gap-1.5">
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: accentHex }}
            />
            <span className="text-xs font-medium" style={{ color: textSecondary }}>
              Online
            </span>
          </div>
        </div>
        <button
          onClick={() => {
            setMessages([]);
            setThreadId(null);
          }}
          title="New conversation"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-opacity hover:opacity-60"
          style={{ color: textSecondary }}
        >
          ↺
        </button>
      </div>

      {/* ── Messages ── */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
        style={{ background: bg }}
      >
        {!hasMessages && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="mb-4">
              <BotAvatar bot={bot} size="lg" />
            </div>
            <p className="font-bold text-sm mb-1" style={{ color: textPrimary }}>
              {bot.name}
            </p>
            <p className="text-xs mb-6 max-w-xs leading-relaxed" style={{ color: textSecondary }}>
              {bot.description || 'Ask me anything!'}
            </p>
            {bot.starterQuestions?.length > 0 && (
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {bot.starterQuestions.slice(0, 4).map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleStarter(q)}
                    className="text-xs text-left px-3 py-2 rounded-xl border transition-all hover:opacity-80"
                    style={{
                      background: surface,
                      borderColor: border,
                      color: textPrimary,
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg._id}
              className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="flex-shrink-0 mb-0.5">
                  <BotAvatar bot={bot} size="xs" />
                </div>
              )}

              <div
                className="max-w-[78%] px-3 py-2.5 rounded-2xl text-sm shadow-sm"
                style={{
                  background:   isUser ? userBubbleBg : botBubbleBg,
                  color:        isUser ? userBubbleTxt : botBubbleTxt,
                  borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                }}
              >
                <EmbedMessage content={msg.content} isUser={isUser} />
                <div
                  className="text-right text-[9px] mt-1 opacity-50"
                  style={{ color: isUser ? '#fff' : textSecondary }}
                >
                  {new Date(msg.createdAt).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit'
                  })}
                </div>
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex items-end gap-2 justify-start">
            <BotAvatar bot={bot} size="xs" />
            <div
              className="px-3 py-2.5 rounded-2xl shadow-sm"
              style={{
                background:   botBubbleBg,
                borderRadius: '16px 16px 16px 4px',
              }}
            >
              <TypingDots color={accentHex} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div
        className="flex-shrink-0 px-3 py-3 border-t"
        style={{ background: surface, borderColor: border }}
      >
        <div
          className="flex items-end gap-2 rounded-xl border px-3 py-2 transition-all focus-within:ring-1"
          style={{
            background:  isDark ? '#111827' : '#F9FAFB',
            borderColor: border,
            '--tw-ring-color': accentHex,
          }}
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
            placeholder={`Message ${bot.name}...`}
            disabled={loading}
            rows={1}
            className="flex-1 bg-transparent resize-none text-sm outline-none placeholder-gray-400"
            style={{
              color: textPrimary,
              maxHeight: '100px',
              lineHeight: '1.4',
            }}
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
