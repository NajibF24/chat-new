// client/src/components/ChatMessage.jsx
import React, { memo, useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import BotAvatar from './BotAvatar';

const getFileUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('https')) return path;
  if (path.startsWith('/api')) return path;
  if (path.startsWith('/')) return path;
  return `/api/files/${path}`;
};

// ─────────────────────────────────────────────────────────────
// CITATION PARSER
// Parses the verified "📚 Sumber:" / "📚 Sources:" block
// injected by ai-core.service.js
// ─────────────────────────────────────────────────────────────

function parseCitations(content = '') {
  // v4 regex: tolerates \n\n--- or \n--- before the header line
  // Avoids emoji character class (broken in JS regex) — uses loose .{0,5} instead
  const blockRegex = /---\s*\n.{0,10}(?:Sumber|Sources).{0,10}\n([\s\S]*)$/im;
  const match = blockRegex.exec(content);
  if (!match) return null;

  const block = match[1].trim();
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  const citations = [];

  for (const line of lines) {
    if (!line.startsWith('-')) continue;

    // ── With URL: - ICON [Title](URL) — snippet ──────────────
    // Use .{1,3} for emoji (multi-byte, avoids character class issues)
    const linkMatch = /^-\s*.{1,3}\s*\[([^\]]+)\]\(([^)]+)\)(?:\s*[—–-]\s*(.+))?$/.exec(line);
    if (linkMatch) {
      const rawIcon = line.match(/^-\s*(.{1,3})\s*\[/)?.[1]?.trim() || '🌐';
      const url     = linkMatch[2].trim();
      citations.push({
        icon:        rawIcon,
        title:       linkMatch[1].trim(),
        url,
        snippet:     linkMatch[3]?.trim() || '',
        type:        detectTypeFromIcon(rawIcon, url),
        isClickable: true,
      });
      continue;
    }

    // ── Without URL: - ICON **Label:** text — snippet ─────────
    const internalMatch = /^-\s*(.{1,3})\s*(?:\*\*[^*]+\*\*:?\s*)?(.+?)(?:\s*[—–-]\s*(.+))?$/.exec(line);
    if (internalMatch) {
      const rawIcon = internalMatch[1].trim();
      citations.push({
        icon:        rawIcon,
        title:       internalMatch[2].trim(),
        url:         null,
        snippet:     internalMatch[3]?.trim() || '',
        type:        detectTypeFromIcon(rawIcon, ''),
        isClickable: false,
      });
    }
  }

  return citations.length > 0 ? citations : null;
}

function detectTypeFromIcon(icon, url = '') {
  const u = url.toLowerCase();
  if (icon === '📂') return 'internal';
  if (icon === '📊') return 'smartsheet';
  if (icon === '🔍') return 'azure';
  if (icon === '📖') return 'wikipedia';
  if (icon === '💻') return 'github';
  if (icon === '🏛️') return 'government';
  if (icon === '📰') return 'news';
  if (icon === '🎓') return 'academic';
  if (icon === '⚠️') return 'warning';
  if (u.includes('wikipedia')) return 'wikipedia';
  if (u.includes('github'))    return 'github';
  if (u.includes('.go.id') || u.includes('.gov')) return 'government';
  return 'web';
}

function stripCitationBlock(content = '') {
  return content
    .replace(/\n+---\s*\n.{0,10}(?:Sumber|Sources).{0,10}\n[\s\S]*$/im, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────
// SOURCE TYPE CONFIG
// ─────────────────────────────────────────────────────────────
const SOURCE_CONFIG = {
  web: {
    gradient:  'from-blue-500 to-blue-600',
    bg:        'bg-blue-50/80',
    border:    'border-blue-100',
    text:      'text-blue-800',
    subtext:   'text-blue-500',
    badge:     'bg-blue-100 text-blue-700',
    ring:      'ring-blue-200',
    label_id:  'Web',
    label_en:  'Web',
  },
  wikipedia: {
    gradient:  'from-gray-500 to-gray-600',
    bg:        'bg-gray-50/80',
    border:    'border-gray-200',
    text:      'text-gray-800',
    subtext:   'text-gray-400',
    badge:     'bg-gray-100 text-gray-600',
    ring:      'ring-gray-200',
    label_id:  'Wikipedia',
    label_en:  'Wikipedia',
  },
  github: {
    gradient:  'from-slate-700 to-slate-800',
    bg:        'bg-slate-50/80',
    border:    'border-slate-200',
    text:      'text-slate-800',
    subtext:   'text-slate-400',
    badge:     'bg-slate-100 text-slate-600',
    ring:      'ring-slate-200',
    label_id:  'GitHub',
    label_en:  'GitHub',
  },
  internal: {
    gradient:  'from-amber-400 to-orange-500',
    bg:        'bg-amber-50/80',
    border:    'border-amber-200',
    text:      'text-amber-900',
    subtext:   'text-amber-500',
    badge:     'bg-amber-100 text-amber-700',
    ring:      'ring-amber-200',
    label_id:  'Dok. Internal',
    label_en:  'Internal Doc',
  },
  smartsheet: {
    gradient:  'from-green-500 to-emerald-600',
    bg:        'bg-green-50/80',
    border:    'border-green-200',
    text:      'text-green-900',
    subtext:   'text-green-500',
    badge:     'bg-green-100 text-green-700',
    ring:      'ring-green-200',
    label_id:  'Smartsheet',
    label_en:  'Smartsheet',
  },
  azure: {
    gradient:  'from-sky-400 to-blue-500',
    bg:        'bg-sky-50/80',
    border:    'border-sky-200',
    text:      'text-sky-900',
    subtext:   'text-sky-400',
    badge:     'bg-sky-100 text-sky-700',
    ring:      'ring-sky-200',
    label_id:  'Azure Search',
    label_en:  'Azure Search',
  },
  government: {
    gradient:  'from-red-500 to-rose-600',
    bg:        'bg-red-50/80',
    border:    'border-red-200',
    text:      'text-red-900',
    subtext:   'text-red-400',
    badge:     'bg-red-100 text-red-700',
    ring:      'ring-red-200',
    label_id:  'Pemerintah',
    label_en:  'Government',
  },
  news: {
    gradient:  'from-violet-500 to-purple-600',
    bg:        'bg-violet-50/80',
    border:    'border-violet-200',
    text:      'text-violet-900',
    subtext:   'text-violet-400',
    badge:     'bg-violet-100 text-violet-700',
    ring:      'ring-violet-200',
    label_id:  'Berita',
    label_en:  'News',
  },
  academic: {
    gradient:  'from-indigo-500 to-indigo-700',
    bg:        'bg-indigo-50/80',
    border:    'border-indigo-200',
    text:      'text-indigo-900',
    subtext:   'text-indigo-400',
    badge:     'bg-indigo-100 text-indigo-700',
    ring:      'ring-indigo-200',
    label_id:  'Akademik',
    label_en:  'Academic',
  },
  warning: {
    gradient:  'from-orange-400 to-amber-500',
    bg:        'bg-orange-50/80',
    border:    'border-orange-200',
    text:      'text-orange-900',
    subtext:   'text-orange-400',
    badge:     'bg-orange-100 text-orange-700',
    ring:      'ring-orange-200',
    label_id:  'AI Generated',
    label_en:  'AI Generated',
  },
};

// ─────────────────────────────────────────────────────────────
// FAVICON COMPONENT — loads website favicon
// ─────────────────────────────────────────────────────────────
function SiteFavicon({ url, fallback }) {
  const [loaded, setLoaded] = useState(false);
  const [error,  setError]  = useState(false);

  if (!url || error) {
    return (
      <span className="text-sm leading-none select-none">{fallback}</span>
    );
  }

  let faviconUrl = '';
  try {
    const parsed = new URL(url);
    faviconUrl = `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
  } catch {
    return <span className="text-sm leading-none select-none">{fallback}</span>;
  }

  return (
    <div className="relative w-5 h-5 flex-shrink-0">
      {!loaded && (
        <span className="absolute inset-0 flex items-center justify-center text-xs">{fallback}</span>
      )}
      <img
        src={faviconUrl}
        alt=""
        width={20}
        height={20}
        className={`w-5 h-5 rounded-sm object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SINGLE CITATION CARD
// ─────────────────────────────────────────────────────────────
function CitationCard({ citation, index, language }) {
  const [hovered,  setHovered]  = useState(false);
  const [copied,   setCopied]   = useState(false);
  const [expanded, setExpanded] = useState(false);

  const cfg   = SOURCE_CONFIG[citation.type] || SOURCE_CONFIG.web;
  const label = language === 'en' ? cfg.label_en : cfg.label_id;

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!citation.url) return;
    navigator.clipboard.writeText(citation.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleOpen = (e) => {
    e.stopPropagation();
    if (citation.url) window.open(citation.url, '_blank', 'noopener,noreferrer');
  };

  const handleCardClick = () => {
    if (citation.isClickable && citation.url) {
      window.open(citation.url, '_blank', 'noopener,noreferrer');
    }
  };

  // Hostname for display
  let hostname = '';
  try { hostname = new URL(citation.url).hostname.replace('www.', ''); } catch {}

  return (
    <div
      className={`
        group relative rounded-2xl border overflow-hidden
        transition-all duration-300 ease-out
        ${cfg.bg} ${cfg.border}
        ${citation.isClickable ? 'cursor-pointer' : ''}
        ${hovered ? `shadow-lg scale-[1.01] ring-2 ${cfg.ring}` : 'shadow-sm'}
      `}
      style={{
        animationDelay: `${index * 60}ms`,
        animation: 'citationSlideIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleCardClick}
    >
      {/* Top accent bar */}
      <div className={`h-0.5 w-full bg-gradient-to-r ${cfg.gradient} transition-all duration-300 ${hovered ? 'opacity-100' : 'opacity-40'}`} />

      <div className="p-3">
        <div className="flex items-start gap-2.5">
          {/* Icon / Favicon */}
          <div className={`
            flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center
            bg-gradient-to-br ${cfg.gradient} shadow-sm
            transition-transform duration-300
            ${hovered ? 'scale-110 rotate-3' : ''}
          `}>
            {citation.isClickable && citation.url
              ? <SiteFavicon url={citation.url} fallback={citation.icon} />
              : <span className="text-sm leading-none">{citation.icon}</span>
            }
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              {/* Type badge */}
              <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
                {label}
              </span>
              {/* Verified checkmark */}
              {!citation.type.includes('warning') && (
                <span className="text-[9px] text-emerald-500 font-bold flex items-center gap-0.5">
                  <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                  </svg>
                  {language === 'en' ? 'Verified' : 'Terverifikasi'}
                </span>
              )}
            </div>

            {/* Title */}
            <p className={`text-[12px] font-semibold leading-snug ${cfg.text} ${citation.isClickable ? 'group-hover:underline underline-offset-2' : ''} line-clamp-2`}>
              {citation.title}
            </p>

            {/* Hostname */}
            {hostname && (
              <p className={`text-[10px] font-mono mt-0.5 truncate ${cfg.subtext}`}>
                {hostname}
              </p>
            )}

            {/* Snippet / Excerpt — expandable */}
            {citation.snippet && (
              <div className="mt-1.5">
                <p className={`text-[11px] leading-relaxed ${cfg.text} opacity-70 ${expanded ? '' : 'line-clamp-2'}`}>
                  "{citation.snippet}"
                </p>
                {citation.snippet.length > 100 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                    className={`text-[9px] font-bold mt-0.5 ${cfg.subtext} hover:opacity-100 opacity-60 transition-opacity`}
                  >
                    {expanded
                      ? (language === 'en' ? '↑ Less' : '↑ Lebih sedikit')
                      : (language === 'en' ? '↓ More' : '↓ Selengkapnya')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          {citation.isClickable && citation.url && (
            <div className={`
              flex-shrink-0 flex flex-col gap-1
              transition-all duration-200
              ${hovered ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'}
            `}>
              {/* Copy */}
              <button
                onClick={handleCopy}
                title={language === 'en' ? 'Copy URL' : 'Salin URL'}
                className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all
                  ${copied ? 'bg-emerald-100 text-emerald-600' : 'bg-white/70 text-gray-500 hover:bg-white hover:text-gray-700'}
                `}
              >
                {copied
                  ? <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                  : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                }
              </button>
              {/* Open */}
              <button
                onClick={handleOpen}
                title={language === 'en' ? 'Open in new tab' : 'Buka di tab baru'}
                className="w-6 h-6 rounded-lg bg-white/70 text-gray-500 hover:bg-white hover:text-gray-700 flex items-center justify-center transition-all"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CITATION PANEL — container for all citation cards
// ─────────────────────────────────────────────────────────────
function CitationPanel({ citations, language = 'id' }) {
  const [showAll, setShowAll] = useState(false);

  if (!citations || citations.length === 0) return null;

  const INITIAL_SHOW   = 3;
  const visibleCitations = showAll ? citations : citations.slice(0, INITIAL_SHOW);
  const hiddenCount    = citations.length - INITIAL_SHOW;

  const headerLabel = language === 'en'
    ? `Sources (${citations.length})`
    : `Sumber (${citations.length})`;

  const showMoreLabel = language === 'en'
    ? `+${hiddenCount} more sources`
    : `+${hiddenCount} sumber lainnya`;

  const showLessLabel = language === 'en' ? '↑ Show less' : '↑ Sembunyikan';

  return (
    <div
      className="mt-4 pt-3 border-t border-gray-100"
      style={{ animation: 'fadeIn 0.4s ease both' }}
    >
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          {/* Animated icon */}
          <div className="relative">
            <span className="text-sm">📚</span>
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          </div>
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
            {headerLabel}
          </span>
          {/* Verified pill */}
          <span className="flex items-center gap-0.5 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">
            <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
            </svg>
            {language === 'en' ? 'Real sources' : 'Sumber nyata'}
          </span>
        </div>
      </div>

      {/* ── Cards grid ─────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-2">
        {visibleCitations.map((citation, idx) => (
          <CitationCard
            key={idx}
            citation={citation}
            index={idx}
            language={language}
          />
        ))}
      </div>

      {/* ── Show more / less toggle ─────────────────────── */}
      {citations.length > INITIAL_SHOW && (
        <button
          onClick={() => setShowAll(!showAll)}
          className={`
            mt-2 w-full py-1.5 rounded-xl text-[10px] font-bold
            border transition-all duration-200
            ${showAll
              ? 'border-gray-200 text-gray-400 hover:bg-gray-50'
              : 'border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:bg-gray-50'
            }
          `}
        >
          {showAll ? showLessLabel : showMoreLabel}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DETECT LANGUAGE FROM CONTENT
// ─────────────────────────────────────────────────────────────
function detectContentLanguage(content = '') {
  const indoWords = /\b(apa|adalah|untuk|dari|dengan|dalam|pada|yang|ini|itu|juga|saya|kamu|bisa|akan|sudah|belum|bagaimana|mengapa|berapa|siapa|kapan|dimana|tolong|mohon|karena|kalau|tapi|tetapi|namun|dan|atau|tidak|ya|iya)\b/i;
  return indoWords.test(content) ? 'id' : 'en';
}

// ─────────────────────────────────────────────────────────────
// CodeBlock
// ─────────────────────────────────────────────────────────────
const ARTIFACT_LANGS = ['html', 'htm', 'react', 'jsx', 'tsx', 'svg', 'python', 'py', 'javascript', 'js', 'ts', 'typescript', 'css', 'sql'];
const MIN_LINES_ARTIFACT = 5;

const LANG_BADGE_COLOR = {
  html: 'bg-orange-500', htm: 'bg-orange-500',
  react: 'bg-blue-500', jsx: 'bg-blue-500', tsx: 'bg-blue-500',
  svg: 'bg-pink-500',
  python: 'bg-yellow-500', py: 'bg-yellow-500',
  javascript: 'bg-yellow-400', js: 'bg-yellow-400',
  typescript: 'bg-blue-400', ts: 'bg-blue-400',
  css: 'bg-purple-500',
  sql: 'bg-sky-500',
};

function CodeBlock({ lang, code, isUser, onOpenArtifact }) {
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n').length;
  const langKey = (lang || '').toLowerCase();
  const isArtifactable = ARTIFACT_LANGS.includes(langKey) && lines >= MIN_LINES_ARTIFACT;
  const badgeColor = LANG_BADGE_COLOR[langKey] || 'bg-gray-500';

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-gray-700/50 shadow-lg">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/70" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
            <div className="w-3 h-3 rounded-full bg-green-500/70" />
          </div>
          {lang && (
            <span className={`${badgeColor} text-white text-[10px] font-bold px-2 py-0.5 rounded-md`}>
              {lang}
            </span>
          )}
          <span className="text-gray-500 text-[10px] tabular-nums">{lines} lines</span>
        </div>
        <div className="flex items-center gap-1.5">
          {isArtifactable && onOpenArtifact && (
            <button
              onClick={() => onOpenArtifact(langKey, code)}
              className="flex items-center gap-1.5 px-3 py-1 bg-primary/80 hover:bg-primary text-white text-[10px] font-bold rounded-lg transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Preview
            </button>
          )}
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1 px-3 py-1 text-[10px] font-bold rounded-lg transition-colors ${
              copied ? 'bg-green-600/30 text-green-400' : 'bg-gray-700 hover:bg-gray-600 text-gray-400'
            }`}
          >
            {copied ? (
              <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Copied</>
            ) : (
              <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
            )}
          </button>
        </div>
      </div>
      <div className="overflow-auto max-h-[480px] bg-[#1a1b26]">
        <pre className="p-4 text-xs text-gray-100 font-mono leading-relaxed whitespace-pre">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ANIMATION STYLES — injected once
// ─────────────────────────────────────────────────────────────
const CITATION_STYLES = `
@keyframes citationSlideIn {
  from { opacity: 0; transform: translateY(8px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)   scale(1);    }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = CITATION_STYLES;
  document.head.appendChild(style);
  stylesInjected = true;
}

// ─────────────────────────────────────────────────────────────
// ChatMessage
// ─────────────────────────────────────────────────────────────
const ChatMessage = memo(({ message, bot, onOpenArtifact, isStreaming }) => {
  const isUser = message.role === 'user';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    injectStyles();
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Parse citations only for assistant messages
  const citations   = !isUser ? parseCitations(message.content || '') : null;
  const cleanContent = citations ? stripCitationBlock(message.content || '') : (message.content || '');

  // Detect language from the clean content
  const language = detectContentLanguage(cleanContent);

  return (
    <div
      className={`flex w-full mb-1 transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      } ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`flex max-w-[88%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>

        {/* Avatar */}
        {isUser ? (
          <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs bg-primary-dark text-white ml-2.5 mt-1 shadow-sm">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
        ) : (
          <div className="flex-shrink-0 mr-2.5 mt-1">
            <BotAvatar bot={bot} size="sm" />
          </div>
        )}

        {/* Bubble */}
        <div className={`px-4 py-3 shadow-sm transition-all ${
          isUser
            ? 'bg-primary-dark text-white rounded-2xl rounded-tr-sm max-w-[85%]'
            : 'bg-white text-gray-800 border border-gray-100 rounded-2xl rounded-tl-sm w-full min-w-0 shadow-sm'
        }`}>

          <div className={`prose max-w-none leading-relaxed text-sm ${isUser ? 'prose-invert text-white' : 'text-gray-800'}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const lang  = match ? match[1] : '';
                  const code  = String(children).replace(/\n$/, '');
                  if (!inline) {
                    return (
                      <CodeBlock lang={lang} code={code} isUser={isUser}
                        onOpenArtifact={!isUser ? onOpenArtifact : null} />
                    );
                  }
                  return (
                    <code
                      className={`${isUser ? 'bg-white/20 text-white' : 'bg-gray-100 text-primary-dark'} px-1.5 py-0.5 rounded text-xs font-mono`}
                      {...props}>
                      {children}
                    </code>
                  );
                },

                a({ node, children, href, ...props }) {
                  const isExternal = href && (href.startsWith('http://') || href.startsWith('https://'));
                  return (
                    <a
                      href={href}
                      target={isExternal ? '_blank' : undefined}
                      rel={isExternal ? 'noopener noreferrer' : undefined}
                      className={`underline font-medium hover:opacity-80 text-sm ${isUser ? 'text-white' : 'text-primary'}`}
                      {...props}
                    >
                      {children}
                      {isExternal && (
                        <svg className="inline w-3 h-3 ml-0.5 mb-0.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      )}
                    </a>
                  );
                },

                p({ node, children, ...props }) {
                  const content = children[0];
                  if (typeof content === 'string' && content.startsWith('[[VIDEO:')) {
                    const videoUrl = getFileUrl(content.replace('[[VIDEO:', '').replace(']]', ''));
                    return (
                      <div className={`my-4 rounded-xl overflow-hidden border shadow-lg bg-black aspect-video ${isUser ? 'border-white/20' : 'border-gray-200'}`}>
                        <video controls className="w-full h-full" preload="metadata">
                          <source src={videoUrl} type="video/mp4" />
                        </video>
                      </div>
                    );
                  }
                  return <p className="mb-2 last:mb-0 text-sm leading-relaxed" {...props}>{children}</p>;
                },

                img({ node, ...props }) {
                  return (
                    <div className="relative my-4 rounded-xl overflow-hidden bg-gray-50">
                      <img
                        {...props}
                        src={getFileUrl(props.src)}
                        alt={props.alt || 'Attachment'}
                        className="max-w-full h-auto max-h-[450px] rounded-xl shadow-sm border border-gray-100 cursor-pointer hover:opacity-90 transition-opacity"
                        loading="lazy"
                        onClick={e => window.open(e.target.src, '_blank')}
                        onError={e => {
                          e.target.style.display = 'none';
                          e.target.parentNode.innerHTML = `<div style="padding:12px;color:#ef4444;font-size:11px;text-align:center;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;">⚠️ Failed to load image</div>`;
                        }}
                      />
                    </div>
                  );
                },

                ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-3 space-y-1 text-sm" {...props} />,
                ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-3 space-y-1 text-sm" {...props} />,
                li: ({ node, ...props }) => <li className="text-sm leading-relaxed" {...props} />,
                h1: ({ node, ...props }) => <h1 className={`text-lg font-bold mt-4 mb-2 pb-1 border-b ${isUser ? 'border-white/20' : 'border-gray-100'}`} {...props} />,
                h2: ({ node, ...props }) => <h2 className="text-base font-bold mt-3 mb-1.5" {...props} />,
                h3: ({ node, ...props }) => <h3 className="text-sm font-bold mt-2 mb-1" {...props} />,
                strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
                blockquote: ({ node, ...props }) => (
                  <blockquote className={`border-l-4 pl-4 my-3 italic text-sm ${isUser ? 'border-white/40 text-white/80' : 'border-primary/30 text-gray-500'}`} {...props} />
                ),

                table: ({ node, ...props }) => (
                  <div className={`overflow-x-auto my-4 rounded-xl border shadow-sm w-full ${isUser ? 'border-white/20' : 'border-gray-100'}`}>
                    <table className={`w-full divide-y text-sm ${isUser ? 'divide-white/20' : 'divide-gray-100'}`} {...props} />
                  </div>
                ),
                thead: ({ node, ...props }) => <thead className={`${isUser ? 'bg-white/10' : 'bg-gray-50'} font-semibold`} {...props} />,
                th: ({ node, ...props }) => <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider whitespace-nowrap" {...props} />,
                tr: ({ node, ...props }) => <tr className={`transition-colors ${isUser ? 'hover:bg-white/5' : 'hover:bg-gray-50/80'}`} {...props} />,
                td: ({ node, ...props }) => <td className="px-4 py-2.5 border-r last:border-r-0 text-sm" {...props} />,
              }}
            >
              {cleanContent}
            </ReactMarkdown>
          </div>

          {/* ── Citation Panel ── */}
          {!isUser && citations && citations.length > 0 && (
            <CitationPanel citations={citations} language={language} />
          )}

          {/* Attachments */}
          {message.attachedFiles && message.attachedFiles.length > 0 && (
            <div className={`mt-3 pt-3 border-t ${isUser ? 'border-white/20' : 'border-gray-100'}`}>
              <div className="grid grid-cols-1 gap-2.5">
                {message.attachedFiles.map((file, idx) => {
                  const fileName = file.name?.toLowerCase() || '';
                  const isImage  = file.type === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
                  const fullPath = getFileUrl(file.path);
                  return (
                    <div key={idx} className={`rounded-xl border overflow-hidden ${isUser ? 'bg-white/10 border-white/20' : 'bg-gray-50 border-gray-100'}`}>
                      {isImage ? (
                        <div className="cursor-pointer group" onClick={() => window.open(fullPath, '_blank')}>
                          <div style={{ minHeight: '120px' }} className="flex items-center justify-center overflow-hidden">
                            <img src={fullPath} alt={file.name}
                              className="w-full h-auto max-h-[400px] object-contain transition-transform group-hover:scale-[1.01]"
                              onError={e => { e.target.src = 'https://placehold.co/400x300?text=File+Not+Found'; }}
                            />
                          </div>
                          <div className="p-2 flex justify-between items-center text-xs">
                            <span className="truncate font-medium">{file.name}</span>
                            <span className="opacity-50 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              Open
                            </span>
                          </div>
                        </div>
                      ) : (
                        <a href={fullPath} target="_blank" rel="noreferrer"
                          className="flex items-center p-3 hover:bg-black/5 transition-colors">
                          <div className="mr-2.5 text-xl opacity-70">📄</div>
                          <div className="flex-1 overflow-hidden">
                            <div className="font-semibold text-xs truncate">{file.name}</div>
                            <div className="text-[10px] opacity-50 mt-0.5">Document</div>
                          </div>
                          <svg className="w-3.5 h-3.5 opacity-40 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timestamp */}
          <div className={`text-[10px] mt-2 text-right tabular-nums ${isUser ? 'text-white/40' : 'text-gray-400'}`}>
            {new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ChatMessage;
