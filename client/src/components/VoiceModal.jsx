// client/src/components/VoiceModal.jsx
// Full-screen conversational voice overlay — like Gemini / ChatGPT voice mode.
// Shows animated audio-wave when speaking, pulsing ring when listening,
// and a spinning indicator when AI is thinking.

import React, { useEffect, useRef } from 'react';

// ─── Animated audio-wave bars ─────────────────────────────────────────────
function AudioWave({ active }) {
  const bars = [0.4, 0.7, 1, 0.6, 0.9, 0.5, 0.8, 0.4, 0.7, 0.6, 1, 0.5];
  return (
    <div className="flex items-center gap-[3px] h-12" aria-hidden>
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-white transition-all"
          style={{
            height: active ? `${h * 100}%` : '15%',
            animation: active ? `waveBar 0.8s ease-in-out ${i * 0.07}s infinite alternate` : 'none',
            opacity: active ? 0.85 : 0.3,
          }}
        />
      ))}
    </div>
  );
}

// ─── Central animated orb ─────────────────────────────────────────────────
function VoiceOrb({ voiceState }) {
  const isListening = voiceState === 'listening';
  const isSpeaking  = voiceState === 'speaking';
  const isThinking  = voiceState === 'thinking';

  return (
    <div className="relative flex items-center justify-center w-32 h-32">
      {/* Outer pulse rings */}
      {(isListening || isSpeaking) && (
        <>
          <div className="absolute inset-0 rounded-full border-2 border-white/20 animate-ping" style={{ animationDuration: '1.5s' }} />
          <div className="absolute inset-[-8px] rounded-full border-2 border-white/10 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.3s' }} />
        </>
      )}

      {/* Core orb */}
      <div
        className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500
          ${isListening ? 'bg-white/25 shadow-lg shadow-white/20' : ''}
          ${isSpeaking  ? 'bg-white/30 shadow-xl shadow-white/30' : ''}
          ${isThinking  ? 'bg-white/15' : ''}
          ${voiceState === 'idle' ? 'bg-white/10' : ''}
        `}
        style={{ backdropFilter: 'blur(10px)' }}
      >
        {/* Icon per state */}
        {isListening && (
          <svg className="w-10 h-10 text-white animate-pulse" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.39-.9.89 0 2.76-2.24 5-5.01 5s-5.01-2.24-5.01-5c0-.5-.41-.89-.9-.89s-.9.39-.9.89c0 3.42 2.72 6.23 6.06 6.72V21h1.5v-2.39c3.34-.49 6.06-3.3 6.06-6.72 0-.5-.41-.89-.9-.89z" />
          </svg>
        )}

        {isSpeaking && (
          <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        )}

        {isThinking && (
          <svg className="w-10 h-10 text-white/80 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}

        {voiceState === 'idle' && (
          <svg className="w-10 h-10 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        )}
      </div>
    </div>
  );
}

// ─── Main Modal ────────────────────────────────────────────────────────────
export default function VoiceModal({ voiceState, isSpeaking, isListening, botName, onClose }) {
  const stateLabel = {
    idle:      'Tap the mic to speak',
    listening: 'Listening…',
    thinking:  'Thinking…',
    speaking:  `${botName || 'AI'} is speaking`,
  }[voiceState] || '';

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
      style={{ background: 'linear-gradient(160deg, #004E36 0%, #007857 50%, #003828 100%)' }}
    >
      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i}
            className="absolute rounded-full bg-white/5"
            style={{
              width: `${8 + Math.random() * 16}px`,
              height: `${8 + Math.random() * 16}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animation: `floatUp ${10 + Math.random() * 10}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 8}s`,
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-8 text-center">

        {/* Bot label */}
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/20">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-white/80 text-sm font-medium">{botName || 'Voice Mode'}</span>
        </div>

        {/* Orb */}
        <VoiceOrb voiceState={voiceState} />

        {/* Audio wave (shown when speaking) */}
        <div className="h-12 flex items-center">
          {isSpeaking ? (
            <AudioWave active />
          ) : (
            <p className="text-white/70 text-sm font-medium tracking-wide">{stateLabel}</p>
          )}
        </div>

        {/* Language notice */}
        <p className="text-white/40 text-xs">
          Auto-detects Indonesian &amp; English · Tap close to exit
        </p>
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute bottom-10 w-14 h-14 rounded-full bg-white/15 border border-white/25 flex items-center justify-center
          hover:bg-white/25 active:scale-95 transition-all"
      >
        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Keyframes */}
      <style>{`
        @keyframes waveBar {
          0%   { transform: scaleY(0.4); }
          100% { transform: scaleY(1); }
        }
        @keyframes floatUp {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.3; }
          50%       { transform: translateY(-30px) scale(1.1); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
