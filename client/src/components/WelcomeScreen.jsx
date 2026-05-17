// client/src/components/WelcomeScreen.jsx
// Welcome / What's New screen shown ONLY after a fresh login (not on refresh).
// Visibility controlled by React state (justLoggedIn) in App.jsx — no sessionStorage.

import React, { useState, useEffect, useCallback } from 'react';

// ─── Feature announcements (update these whenever there's a new release) ───
const FEATURES = [
  {
    icon: '⚡',
    badge: 'NEW',
    badgeColor: 'bg-emerald-500',
    title: 'Streaming AI Responses',
    description: 'AI responses are now streamed in real-time token-by-token (just like ChatGPT), significantly reducing perceived wait times for long answers.',
  },
  {
    icon: '✨',
    badge: 'NEW',
    badgeColor: 'bg-emerald-500',
    title: 'Message Actions (Copy, Edit, Regenerate)',
    description: 'You can now easily Copy AI responses, Edit & Resend your own messages, or Regenerate an AI response with a single click.',
  },
  {
    icon: '🎙️',
    badge: 'IMPROVED',
    badgeColor: 'bg-blue-500',
    title: 'Voice Mode & Auto-Read',
    description: 'Speak directly to AI and it replies with voice! Auto-detects Indonesian & English. Enable Auto-Read to have AI replies spoken aloud automatically.',
  },
  {
    icon: '📊',
    badge: 'IMPROVED',
    badgeColor: 'bg-blue-500',
    title: 'PPT with GYS Template',
    description: 'Presentations now automatically use the official GYS template — logo , colors, fonts, and layouts follow the Brand Guidelines.',
  },
  {
    icon: '📎',
    badge: 'IMPROVED',
    badgeColor: 'bg-blue-500',
    title: 'Drag & Drop + Ctrl+V Upload',
    description: 'Drag files directly onto the chat or press Ctrl+V to paste from clipboard. Supports images, PDF, DOCX, XLSX, PPTX (max 20MB).',
  },
];


// ─── Decorative floating particles ─────────────────────────────────────
function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-primary/10 dark:bg-primary-light/10"
          style={{
            width: `${6 + Math.random() * 12}px`,
            height: `${6 + Math.random() * 12}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animation: `floatUp ${8 + Math.random() * 12}s ease-in-out infinite`,
            animationDelay: `${Math.random() * 6}s`,
            opacity: 0.3 + Math.random() * 0.4,
          }}
        />
      ))}
    </div>
  );
}

// ─── COMPONENT ─────────────────────────────────────────────────────────────
export default function WelcomeScreen({ user, onContinue }) {
  const [visible, setVisible] = useState(false);   // animate in
  const [exiting, setExiting] = useState(false);    // animate out

  // Mount animation
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  // Handle continue
  const handleContinue = useCallback(() => {
    setExiting(true);
    setTimeout(() => onContinue(), 500);
  }, [onContinue]);

  // Enter / Space to continue
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleContinue();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleContinue]);


  const firstName = user?.username?.split?.('.')?.[0] || user?.username || 'User';
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-all duration-500
        ${visible && !exiting ? 'opacity-100' : 'opacity-0'}
        ${exiting ? 'scale-105' : visible ? 'scale-100' : 'scale-95'}
      `}
      style={{ background: 'linear-gradient(145deg, #004E36 0%, #007857 40%, #48AE92 100%)' }}
    >
      <FloatingParticles />

      {/* Glassmorphism card */}
      <div
        className={`relative z-10 w-full max-w-lg mx-4 rounded-3xl shadow-2xl overflow-hidden
          transition-all duration-700 ease-out
          ${visible && !exiting ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}
        `}
        style={{
          background: 'rgba(255,255,255,0.12)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.18)',
        }}
      >
        {/* Header section */}
        <div className="px-8 pt-8 pb-5 text-center">
          {/* Logo */}
          <div className="flex justify-center mb-5">
            <div className="relative">
              <img
                src="/assets/gys-logo.webp"
                alt="GYS Logo"
                className="h-14 w-auto object-contain drop-shadow-lg"
                onError={e => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <div className="hidden w-14 h-14 rounded-2xl bg-white/20 items-center justify-center text-white font-bold text-xl shadow-lg">
                AI
              </div>
              {/* Glow ring */}
              <div className="absolute -inset-3 rounded-full bg-white/10 animate-ping" style={{ animationDuration: '3s' }} />
            </div>
          </div>

          {/* Greeting */}
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1.5 tracking-tight">
            {greeting}, {displayName}! 👋
          </h1>
          <p className="text-white/70 text-sm font-medium">
            Welcome back to <span className="text-white font-bold">GYS AI Portal</span>
          </p>

          {/* Version badge */}
          <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-white/15 border border-white/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] text-white/80 font-semibold tracking-wide">What's New</span>
          </div>
        </div>

        {/* Feature cards */}
        <div className="px-6 pb-4 space-y-2.5 max-h-[40vh] overflow-y-auto scrollbar-thin scrollbar-thumb-white/20">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 p-3.5 rounded-2xl transition-all duration-500
                ${visible && !exiting ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'}
              `}
              style={{
                transitionDelay: `${300 + i * 100}ms`,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-xl">
                {f.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-bold text-sm text-white">{f.title}</span>
                  <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full ${f.badgeColor}`}>
                    {f.badge}
                  </span>
                </div>
                <p className="text-xs text-white/65 leading-relaxed">{f.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Continue button */}
        <div className="px-6 pb-6 pt-3">
          <button
            onClick={handleContinue}
            className="w-full py-3.5 rounded-2xl bg-white text-primary-dark font-bold text-sm
              shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]
              transition-all duration-200 flex items-center justify-center gap-2
              group"
          >
            <span>Continue to Chat</span>
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
          <p className="text-center text-[11px] text-white/40 mt-3 select-none">
            Press <kbd className="px-1.5 py-0.5 rounded bg-white/15 text-white/60 font-mono text-[10px] border border-white/20">Enter</kbd> to continue
          </p>
        </div>
      </div>

      {/* Bottom branding */}
      <div className="absolute bottom-4 text-center w-full">
        <p className="text-[10px] text-white/30 font-medium">
          PT Garuda Yamato Steel — Digital Transformation
        </p>
      </div>

      {/* Keyframe for floating particles */}
      <style>{`
        @keyframes floatUp {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(180deg); }
        }
      `}</style>
    </div>
  );
}
