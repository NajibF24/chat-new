// client/src/hooks/useVoice.js
// Centralized voice logic: STT + TTS with language detection, best-voice selection,
// and conversational loop support (like Gemini / ChatGPT voice mode).

import { useState, useRef, useEffect, useCallback } from 'react';

// ─── Language Detection ────────────────────────────────────────────────────
// Simple word-frequency approach — no external library needed.
const ID_WORDS = new Set([
  'dan', 'yang', 'di', 'ke', 'dari', 'ini', 'itu', 'adalah', 'dengan', 'untuk',
  'tidak', 'juga', 'akan', 'pada', 'saya', 'kami', 'kita', 'mereka', 'bisa',
  'sudah', 'belum', 'kalau', 'karena', 'atau', 'tetapi', 'tapi', 'jika', 'agar',
  'lebih', 'sangat', 'semua', 'setelah', 'sebelum', 'namun', 'bahwa', 'serta',
  'sebuah', 'beberapa', 'yaitu', 'antara', 'tanpa', 'dalam', 'dapat', 'harus',
]);

export function detectLang(text = '') {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  const idCount = words.filter(w => ID_WORDS.has(w)).length;
  // If ≥2 Indonesian indicator words are found → Indonesian
  return idCount >= 2 ? 'id-ID' : 'en-US';
}

// ─── Best Voice Picker ─────────────────────────────────────────────────────
// Prefers Google/Microsoft voices (higher quality), then any matching lang.
function getBestVoice(synth, lang) {
  const voices = synth.getVoices();
  const [primary, secondary] = lang.split('-'); // e.g. 'id', 'ID'

  const candidates = voices.filter(v =>
    v.lang === lang || v.lang.startsWith(primary + '-')
  );

  const priority = (v) => {
    if (v.name.toLowerCase().includes('google')) return 3;
    if (v.name.toLowerCase().includes('microsoft')) return 2;
    if (!v.localService) return 1; // cloud-based
    return 0;
  };

  candidates.sort((a, b) => priority(b) - priority(a));
  return candidates[0] || null;
}

// ─── Clean text for TTS ────────────────────────────────────────────────────
export function cleanForSpeech(text = '') {
  return text
    .replace(/```[\s\S]*?```/g, ', code snippet,') // code blocks
    .replace(/`[^`]+`/g, '')                        // inline code
    .replace(/#{1,6}\s/g, '')                       // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')               // bold
    .replace(/\*(.+?)\*/g, '$1')                    // italic
    .replace(/~~(.+?)~~/g, '$1')                    // strikethrough
    .replace(/\[(.+?)\]\(https?:\/\/[^\)]+\)/g, '$1') // links → just text
    .replace(/https?:\/\/\S+/g, ', link,')          // bare URLs
    .replace(/[_~\[\]]/g, '')                       // remaining symbols
    .replace(/\n{2,}/g, '. ')                       // paragraph breaks
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Main Hook ─────────────────────────────────────────────────────────────
export default function useVoice({ onTranscript, onSendMessage }) {
  const [voiceMode, setVoiceMode] = useState(false);   // conversational mode on/off
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceState, setVoiceState] = useState('idle'); // idle | listening | thinking | speaking
  const [isSupported, setIsSupported] = useState(false);

  const recognitionRef = useRef(null);
  const synthRef       = useRef(null);
  const voiceModeRef   = useRef(false); // stable ref to avoid stale closures

  // ── Initialise ────────────────────────────────────────────────────────────
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const hasSynth = 'speechSynthesis' in window;

    if (SpeechRecognition && hasSynth) {
      setIsSupported(true);
      synthRef.current = window.speechSynthesis;

      const recognition = new SpeechRecognition();
      recognition.continuous    = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript.trim();
        if (!transcript) return;

        if (onTranscript) onTranscript(transcript);

        // In conversational mode → auto-send
        if (voiceModeRef.current && onSendMessage) {
          setVoiceState('thinking');
          onSendMessage(transcript);
        }
      };

      recognition.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[Voice] STT error:', e.error);
        }
        setIsListening(false);
        if (voiceModeRef.current) setVoiceState('idle');
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    return () => {
      synthRef.current?.cancel();
      try { recognitionRef.current?.abort(); } catch {}
    };
  }, []); // eslint-disable-line

  // ── Sync ref with state ──────────────────────────────────────────────────
  useEffect(() => {
    voiceModeRef.current = voiceMode;
    if (!voiceMode) {
      stopListening();
      stopSpeaking();
      setVoiceState('idle');
    }
  }, [voiceMode]); // eslint-disable-line

  // ── STT Controls ──────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListening) return;
    // Reload voices each time in case they weren't ready yet
    try {
      // Language will be detected per-utterance, but STT
      // can be set to broad or specific. We default to id-ID for STT
      // (browsers handle bilingual reasonably well with id-ID).
      recognitionRef.current.lang = 'id-ID';
      recognitionRef.current.start();
      setIsListening(true);
      setVoiceState('listening');
    } catch (e) {
      console.warn('[Voice] Could not start recognition:', e.message);
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  // ── TTS Controls ──────────────────────────────────────────────────────────
  const speak = useCallback((text, { onEnd } = {}) => {
    if (!synthRef.current || !text) return;

    synthRef.current.cancel(); // cancel any ongoing speech

    const cleaned = cleanForSpeech(text);
    const lang    = detectLang(cleaned);
    const voice   = getBestVoice(synthRef.current, lang);

    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang  = lang;
    utterance.rate  = 1.0;  // natural speed
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    if (voice) utterance.voice = voice;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setVoiceState('speaking');
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      if (onEnd) onEnd();

      // Conversational loop: after AI finishes speaking → listen again
      if (voiceModeRef.current) {
        setVoiceState('listening');
        setTimeout(() => {
          if (voiceModeRef.current) startListening();
        }, 600);
      } else {
        setVoiceState('idle');
      }
    };

    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') console.warn('[Voice] TTS error:', e.error);
      setIsSpeaking(false);
      setVoiceState('idle');
    };

    // Chrome bug workaround: voices may not be loaded yet
    if (synthRef.current.getVoices().length === 0) {
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        const v = getBestVoice(synthRef.current, lang);
        if (v) utterance.voice = v;
        synthRef.current.speak(utterance);
      }, { once: true });
    } else {
      synthRef.current.speak(utterance);
    }
  }, [startListening]);

  const stopSpeaking = useCallback(() => {
    synthRef.current?.cancel();
    setIsSpeaking(false);
  }, []);

  // ── Voice Mode Toggle ──────────────────────────────────────────────────────
  const toggleVoiceMode = useCallback(() => {
    setVoiceMode(prev => !prev);
    if (!voiceMode) {
      // Starting voice mode → begin listening immediately
      setTimeout(startListening, 100);
    }
  }, [voiceMode, startListening]);

  return {
    isSupported,
    voiceMode,
    setVoiceMode,
    toggleVoiceMode,
    isListening,
    isSpeaking,
    voiceState,   // 'idle' | 'listening' | 'thinking' | 'speaking'
    startListening,
    stopListening,
    toggleListening,
    speak,
    stopSpeaking,
    detectLang,
  };
}
