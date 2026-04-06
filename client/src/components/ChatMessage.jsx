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
// Parse citations
// ─────────────────────────────────────────────────────────────
function parseCitations(content = '') {
  const startTag = '<!--CITATIONS_START-->';
  const endTag   = '<!--CITATIONS_END-->';
  const startIdx = content.indexOf(startTag);
  const endIdx   = content.indexOf(endTag);

  if (startIdx === -1 || endIdx === -1) {
    return { mainContent: content, citations: [] };
  }

  const mainContent   = content.substring(0, startIdx).trim();
  const citationsJson = content.substring(startIdx + startTag.length, endIdx).trim();

  let citations = [];
  try {
    const parsed = JSON.parse(citationsJson);
    if (Array.isArray(parsed)) citations = parsed;
  } catch {
    citations = [];
  }

  return { mainContent, citations };
}

// ─────────────────────────────────────────────────────────────
// Citations Panel
// ─────────────────────────────────────────────────────────────
function CitationsPanel({ citations }) {
  const [expanded, setExpanded] = useState(false);
  if (!citations || citations.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors group"
      >
        <svg
          className={`w-3 h-3 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
        </svg>
        <span>{citations.length} web source{citations.length !== 1 ? 's' : ''}</span>
        <span className="text-gray-300 text-[10px]">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {citations.map((cite, idx) => {
            let hostname = '';
            try { hostname = new URL(cite.url).hostname; } catch {}
            return (
              <a
                key={idx}
                href={cite.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-all group"
              >
                <img
                  src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=16`}
                  alt=""
                  className="w-4 h-4 rounded flex-shrink-0"
                  onError={e => { e.target.style.display = 'none'; }}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-semibold text-gray-400 mr-1.5">[{idx + 1}]</span>
                  <span className="text-xs text-gray-600 group-hover:text-gray-900 transition-colors truncate">{cite.title || hostname}</span>
                  <span className="text-[10px] text-gray-300 ml-1.5 truncate">{hostname}</span>
                </div>
                <svg className="w-3 h-3 text-gray-300 group-hover:text-gray-500 flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Syntax highlighting token colors — Claude dark theme
// ─────────────────────────────────────────────────────────────
const TOKEN_COLORS = {
  keyword:  '#c084fc',   // purple
  string:   '#86efac',   // green
  number:   '#fb923c',   // orange
  comment:  '#6b7280',   // gray
  function: '#60a5fa',   // blue
  class:    '#f9a8d4',   // pink
  operator: '#94a3b8',   // slate
  type:     '#67e8f9',   // cyan
  tag:      '#f87171',   // red
  attr:     '#fbbf24',   // amber
  constant: '#e879f9',   // fuchsia
};

const LANG_META = {
  js:         { label: 'JavaScript', color: '#f7df1e', bg: '#1c1917' },
  javascript: { label: 'JavaScript', color: '#f7df1e', bg: '#1c1917' },
  ts:         { label: 'TypeScript', color: '#3178c6', bg: '#0f172a' },
  typescript: { label: 'TypeScript', color: '#3178c6', bg: '#0f172a' },
  jsx:        { label: 'JSX',        color: '#61dafb', bg: '#0c1821' },
  tsx:        { label: 'TSX',        color: '#61dafb', bg: '#0c1821' },
  py:         { label: 'Python',     color: '#4dabf7', bg: '#111827' },
  python:     { label: 'Python',     color: '#4dabf7', bg: '#111827' },
  html:       { label: 'HTML',       color: '#ff6b35', bg: '#1a0f0a' },
  css:        { label: 'CSS',        color: '#38bdf8', bg: '#0a1628' },
  sql:        { label: 'SQL',        color: '#a78bfa', bg: '#110d1f' },
  bash:       { label: 'Bash',       color: '#4ade80', bg: '#071a0f' },
  sh:         { label: 'Shell',      color: '#4ade80', bg: '#071a0f' },
  json:       { label: 'JSON',       color: '#fbbf24', bg: '#1a1400' },
  yaml:       { label: 'YAML',       color: '#fb923c', bg: '#1a0d00' },
  yml:        { label: 'YAML',       color: '#fb923c', bg: '#1a0d00' },
  md:         { label: 'Markdown',   color: '#94a3b8', bg: '#111827' },
  go:         { label: 'Go',         color: '#00add8', bg: '#001219' },
  rust:       { label: 'Rust',       color: '#f46624', bg: '#1a0800' },
  java:       { label: 'Java',       color: '#f89820', bg: '#1a0e00' },
  php:        { label: 'PHP',        color: '#8892be', bg: '#0d0f1a' },
  ruby:       { label: 'Ruby',       color: '#cc342d', bg: '#1a0505' },
  swift:      { label: 'Swift',      color: '#ff6938', bg: '#1a0900' },
  kotlin:     { label: 'Kotlin',     color: '#7f52ff', bg: '#0f0a1a' },
  cpp:        { label: 'C++',        color: '#00599c', bg: '#000a14' },
  c:          { label: 'C',          color: '#555555', bg: '#0d0d0d' },
  cs:         { label: 'C#',         color: '#68217a', bg: '#120918' },
  docker:     { label: 'Dockerfile', color: '#2496ed', bg: '#00111f' },
};

function tokenize(code, lang) {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const l = (lang || '').toLowerCase();

  // Comments
  let result = escaped
    .replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, `<span style="color:${TOKEN_COLORS.comment};font-style:italic">$1</span>`)
    .replace(/(#[^\n]*)/g, (m, p1) => {
      // Avoid coloring CSS hex colors
      if (/^#[0-9a-fA-F]{3,6}$/.test(p1)) return m;
      return `<span style="color:${TOKEN_COLORS.comment};font-style:italic">${p1}</span>`;
    });

  // Strings
  result = result.replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g,
    `<span style="color:${TOKEN_COLORS.string}">$1$2$1</span>`);

  // Numbers
  result = result.replace(/\b(\d+\.?\d*)\b/g,
    `<span style="color:${TOKEN_COLORS.number}">$1</span>`);

  // Keywords per language
  const kwMap = {
    js:         ['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','class','extends','import','export','default','from','async','await','try','catch','finally','new','this','typeof','instanceof','null','undefined','true','false','void','delete','in','of','throw','yield','static','get','set','super'],
    ts:         ['const','let','var','function','return','if','else','for','while','class','extends','import','export','default','from','async','await','try','catch','new','this','typeof','null','undefined','true','false','interface','type','enum','namespace','declare','abstract','implements','readonly','public','private','protected','as','is','keyof','infer'],
    python:     ['def','return','if','elif','else','for','while','class','import','from','as','try','except','finally','with','pass','break','continue','raise','yield','lambda','None','True','False','and','or','not','in','is','global','nonlocal','del','async','await'],
    html:       ['DOCTYPE','html','head','body','div','span','p','a','img','ul','ol','li','table','tr','td','th','form','input','button','script','style','link','meta','title','h1','h2','h3','h4','h5','h6','header','footer','main','nav','section','article','aside'],
    sql:        ['SELECT','FROM','WHERE','INSERT','INTO','UPDATE','DELETE','CREATE','TABLE','DROP','ALTER','INDEX','JOIN','LEFT','RIGHT','INNER','OUTER','ON','AND','OR','NOT','IN','LIKE','ORDER','BY','GROUP','HAVING','LIMIT','OFFSET','AS','DISTINCT','UNION','ALL','COUNT','SUM','AVG','MAX','MIN','NULL','IS','BETWEEN'],
    bash:       ['if','then','else','elif','fi','for','while','do','done','case','esac','function','return','exit','echo','export','source','cd','ls','mkdir','rm','cp','mv','grep','awk','sed','chmod','sudo'],
  };

  const langKws = kwMap[l] || kwMap['js'];
  if (langKws) {
    langKws.forEach(kw => {
      result = result.replace(
        new RegExp(`\\b(${kw})\\b`, 'g'),
        `<span style="color:${TOKEN_COLORS.keyword};font-weight:500">$1</span>`
      );
    });
  }

  // Function calls
  result = result.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g,
    `<span style="color:${TOKEN_COLORS.function}">$1</span>`);

  return result;
}

// ─────────────────────────────────────────────────────────────
// Code Block — Claude.ai style
// ─────────────────────────────────────────────────────────────
const ARTIFACT_LANGS = ['html', 'htm', 'react', 'jsx', 'tsx', 'svg', 'python', 'py', 'javascript', 'js', 'ts', 'typescript', 'css', 'sql'];
const MIN_LINES_ARTIFACT = 5;

function CodeBlock({ lang, code, isUser, onOpenArtifact }) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const lines     = code.split('\n').length;
  const langKey   = (lang || '').toLowerCase();
  const meta      = LANG_META[langKey] || { label: lang || 'text', color: '#94a3b8', bg: '#111827' };
  const isArtifactable = ARTIFACT_LANGS.includes(langKey) && lines >= MIN_LINES_ARTIFACT;
  const isLong    = lines > 20;
  const COLLAPSE_THRESHOLD = 20;

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const displayCode = isLong && !isExpanded
    ? code.split('\n').slice(0, COLLAPSE_THRESHOLD).join('\n') + '\n...'
    : code;

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-gray-800/60 shadow-lg" style={{ background: meta.bg }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2.5">
          {/* Traffic lights */}
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
          </div>
          {/* Lang badge */}
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded-md"
            style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}30` }}
          >
            {meta.label}
          </span>
          <span className="text-gray-600 text-[10px] tabular-nums">{lines} lines</span>
        </div>

        <div className="flex items-center gap-1.5">
          {isArtifactable && onOpenArtifact && (
            <button
              onClick={() => onOpenArtifact(langKey, code)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
              style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)' }}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              Preview
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
            style={{
              background: copied ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.07)',
              color: copied ? '#4ade80' : '#9ca3af',
              border: copied ? '1px solid rgba(74,222,128,0.25)' : '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {copied ? (
              <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Copied</>
            ) : (
              <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
            )}
          </button>
        </div>
      </div>

      {/* Code */}
      <div className="overflow-auto" style={{ maxHeight: isLong && !isExpanded ? '340px' : '520px' }}>
        <pre
          className="px-5 py-4 text-sm leading-relaxed"
          style={{ fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace', color: '#e2e8f0', margin: 0 }}
          dangerouslySetInnerHTML={{ __html: tokenize(displayCode, langKey) }}
        />
      </div>

      {/* Expand/Collapse if long */}
      {isLong && (
        <button
          onClick={() => setIsExpanded(e => !e)}
          className="w-full py-2 text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5"
          style={{
            background: 'rgba(255,255,255,0.04)',
            color: '#6b7280',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {isExpanded ? (
            <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>Collapse</>
          ) : (
            <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>Show {lines - COLLAPSE_THRESHOLD} more lines</>
          )}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ChatMessage
// ─────────────────────────────────────────────────────────────
const ChatMessage = memo(({ message, bot, onOpenArtifact, isStreaming }) => {
  const isUser = message.role === 'user';
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  const { mainContent, citations } = isUser
    ? { mainContent: message.content || '', citations: [] }
    : parseCitations(message.content || '');

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(mainContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // ── USER MESSAGE ─────────────────────────────────────────
  if (isUser) {
    return (
      <div
        className={`flex w-full justify-end mb-4 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
      >
        <div className="flex items-end gap-2.5 max-w-[75%]">
          <div
            className="px-4 py-3 text-sm leading-relaxed shadow-sm"
            style={{
              background: 'linear-gradient(135deg, #004E36 0%, #007857 100%)',
              color: '#fff',
              borderRadius: '18px 18px 4px 18px',
            }}
          >
            {/* Attached files */}
            {message.attachedFiles && message.attachedFiles.length > 0 && (
              <div className="mb-2 space-y-1.5">
                {message.attachedFiles.map((file, idx) => {
                  const isImage = file.type === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name || '');
                  if (isImage) {
                    return (
                      <img
                        key={idx}
                        src={getFileUrl(file.path)}
                        alt={file.name}
                        className="max-w-[260px] rounded-xl"
                        style={{ border: '1px solid rgba(255,255,255,0.15)' }}
                        onClick={e => window.open(e.target.src, '_blank')}
                      />
                    );
                  }
                  return (
                    <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.12)' }}>
                      <span className="text-base">📄</span>
                      <span className="text-xs font-medium text-white/90 truncate">{file.name}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.95)' }}>{message.content}</p>
            <div className="text-right mt-1.5" style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px' }}>
              {new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>

          {/* User avatar */}
          <div
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-sm mb-0.5"
            style={{ background: 'linear-gradient(135deg, #004E36, #007857)' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
        </div>
      </div>
    );
  }

  // ── ASSISTANT MESSAGE ─────────────────────────────────────
  return (
    <div
      className={`flex w-full justify-start mb-6 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
    >
      <div className="flex items-start gap-3 w-full max-w-[88%]">

        {/* Bot avatar */}
        <div className="flex-shrink-0 mt-0.5">
          <BotAvatar bot={bot} size="sm" />
        </div>

        {/* Bubble */}
        <div className="flex-1 min-w-0 group">
          <div
            className="px-5 py-4 rounded-2xl rounded-tl-sm shadow-sm"
            style={{
              background: '#fff',
              border: '1px solid #f0f0f0',
            }}
          >
            {/* Markdown content */}
            <div className="prose prose-sm max-w-none" style={{ color: '#1a1a1a' }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // ── Code blocks ──
                  code({ node, inline, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const lang  = match ? match[1] : '';
                    const code  = String(children).replace(/\n$/, '');

                    if (!inline) {
                      return (
                        <CodeBlock
                          lang={lang}
                          code={code}
                          isUser={false}
                          onOpenArtifact={onOpenArtifact}
                        />
                      );
                    }
                    return (
                      <code
                        className="px-1.5 py-0.5 rounded-md text-[13px] font-mono"
                        style={{
                          background: '#f1f5f9',
                          color: '#c026d3',
                          border: '1px solid #e2e8f0',
                        }}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },

                  // ── Paragraphs ──
                  p({ node, children, ...props }) {
                    const content = children?.[0];
                    if (typeof content === 'string' && content.startsWith('[[VIDEO:')) {
                      const videoUrl = getFileUrl(content.replace('[[VIDEO:', '').replace(']]', ''));
                      return (
                        <div className="my-4 rounded-xl overflow-hidden border border-gray-200 aspect-video bg-black">
                          <video controls className="w-full h-full" preload="metadata">
                            <source src={videoUrl} type="video/mp4" />
                          </video>
                        </div>
                      );
                    }
                    return (
                      <p
                        className="mb-3 last:mb-0"
                        style={{ lineHeight: '1.7', color: '#374151', fontSize: '14px' }}
                        {...props}
                      >
                        {children}
                      </p>
                    );
                  },

                  // ── Headings ──
                  h1({ node, children, ...props }) {
                    return (
                      <h1
                        className="text-xl font-bold mt-5 mb-3 pb-2"
                        style={{ color: '#111827', borderBottom: '2px solid #f3f4f6' }}
                        {...props}
                      >
                        {children}
                      </h1>
                    );
                  },
                  h2({ node, children, ...props }) {
                    return (
                      <h2
                        className="text-base font-bold mt-4 mb-2"
                        style={{ color: '#1f2937' }}
                        {...props}
                      >
                        {children}
                      </h2>
                    );
                  },
                  h3({ node, children, ...props }) {
                    return (
                      <h3
                        className="text-sm font-semibold mt-3 mb-1.5"
                        style={{ color: '#374151' }}
                        {...props}
                      >
                        {children}
                      </h3>
                    );
                  },

                  // ── Lists ──
                  ul({ node, children, ...props }) {
                    return (
                      <ul
                        className="mb-3 space-y-1.5"
                        style={{ paddingLeft: '1.25rem', listStyleType: 'disc', color: '#374151' }}
                        {...props}
                      />
                    );
                  },
                  ol({ node, children, ...props }) {
                    return (
                      <ol
                        className="mb-3 space-y-1.5"
                        style={{ paddingLeft: '1.25rem', listStyleType: 'decimal', color: '#374151' }}
                        {...props}
                      />
                    );
                  },
                  li({ node, children, ...props }) {
                    return (
                      <li style={{ fontSize: '14px', lineHeight: '1.6', color: '#374151' }} {...props}>
                        {children}
                      </li>
                    );
                  },

                  // ── Strong / Em ──
                  strong({ node, children, ...props }) {
                    return <strong style={{ fontWeight: '600', color: '#111827' }} {...props}>{children}</strong>;
                  },
                  em({ node, children, ...props }) {
                    return <em style={{ fontStyle: 'italic', color: '#4b5563' }} {...props}>{children}</em>;
                  },

                  // ── Blockquote ──
                  blockquote({ node, children, ...props }) {
                    return (
                      <blockquote
                        className="my-3 pl-4 py-1"
                        style={{
                          borderLeft: '3px solid #007857',
                          background: '#f0fdf4',
                          borderRadius: '0 8px 8px 0',
                          color: '#374151',
                          fontStyle: 'italic',
                        }}
                        {...props}
                      >
                        {children}
                      </blockquote>
                    );
                  },

                  // ── HR ──
                  hr({ node, ...props }) {
                    return <hr style={{ border: 'none', borderTop: '1px solid #f3f4f6', margin: '16px 0' }} {...props} />;
                  },

                  // ── Images ──
                  img({ node, ...props }) {
                    return (
                      <div className="my-4">
                        <img
                          {...props}
                          src={getFileUrl(props.src)}
                          alt={props.alt || 'Image'}
                          className="max-w-full h-auto rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                          style={{ border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                          loading="lazy"
                          onClick={e => window.open(e.target.src, '_blank')}
                          onError={e => {
                            e.target.style.display = 'none';
                            e.target.parentNode.innerHTML = '<div style="padding:12px;color:#ef4444;font-size:11px;text-align:center;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;">⚠️ Failed to load image</div>';
                          }}
                        />
                      </div>
                    );
                  },

                  // ── Tables ──
                  table({ node, children, ...props }) {
                    return (
                      <div className="overflow-x-auto my-4 rounded-xl" style={{ border: '1px solid #e5e7eb' }}>
                        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }} {...props}>
                          {children}
                        </table>
                      </div>
                    );
                  },
                  thead({ node, children, ...props }) {
                    return (
                      <thead style={{ background: '#f9fafb' }} {...props}>
                        {children}
                      </thead>
                    );
                  },
                  th({ node, children, ...props }) {
                    return (
                      <th
                        className="text-left text-xs font-semibold uppercase tracking-wider"
                        style={{ padding: '10px 14px', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}
                        {...props}
                      >
                        {children}
                      </th>
                    );
                  },
                  tr({ node, children, ...props }) {
                    return (
                      <tr
                        style={{ borderBottom: '1px solid #f3f4f6' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#f9fafb'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                        {...props}
                      >
                        {children}
                      </tr>
                    );
                  },
                  td({ node, children, ...props }) {
                    return (
                      <td
                        style={{ padding: '10px 14px', color: '#374151', fontSize: '13px', verticalAlign: 'top' }}
                        {...props}
                      >
                        {children}
                      </td>
                    );
                  },

                  // ── Links ──
                  a({ node, children, ...props }) {
                    return (
                      <a
                        className="underline decoration-dotted underline-offset-2 hover:decoration-solid transition-all"
                        style={{ color: '#007857' }}
                        target="_blank"
                        rel="noreferrer"
                        {...props}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {mainContent}
              </ReactMarkdown>
            </div>

            {/* Attachments */}
            {message.attachedFiles && message.attachedFiles.length > 0 && (
              <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid #f3f4f6' }}>
                {message.attachedFiles.map((file, idx) => {
                  const fileName = file.name?.toLowerCase() || '';
                  const isImage  = file.type === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
                  const fullPath = getFileUrl(file.path);
                  return (
                    <div key={idx} className="rounded-xl overflow-hidden" style={{ border: '1px solid #f0f0f0' }}>
                      {isImage ? (
                        <div className="cursor-pointer group" onClick={() => window.open(fullPath, '_blank')}>
                          <img
                            src={fullPath}
                            alt={file.name}
                            className="w-full h-auto max-h-80 object-contain group-hover:opacity-95 transition-opacity"
                            onError={e => { e.target.src = 'https://placehold.co/400x300?text=Not+Found'; }}
                          />
                          <div className="px-3 py-2 flex justify-between items-center text-xs" style={{ background: '#f9fafb', color: '#6b7280' }}>
                            <span className="truncate font-medium">{file.name}</span>
                            <span className="flex items-center gap-1 flex-shrink-0">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              Open
                            </span>
                          </div>
                        </div>
                      ) : (
                        <a
                          href={fullPath}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0" style={{ background: '#f0fdf4' }}>
                            {/\.pdf$/i.test(fileName) ? '📕' : /\.docx?$/i.test(fileName) ? '📘' : /\.xlsx?$/i.test(fileName) ? '📗' : /\.pptx?$/i.test(fileName) ? '📙' : '📄'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold truncate" style={{ color: '#111827' }}>{file.name}</div>
                            <div className="text-[10px] mt-0.5" style={{ color: '#9ca3af' }}>Click to download</div>
                          </div>
                          <svg className="w-4 h-4 flex-shrink-0" style={{ color: '#d1d5db' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Citations */}
            {citations.length > 0 && <CitationsPanel citations={citations} />}
          </div>

          {/* Actions row */}
          <div className="flex items-center gap-1 mt-1.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <span className="text-[10px] tabular-nums mr-1" style={{ color: '#c4c4c4' }}>
              {new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <button
              onClick={handleCopyMessage}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all hover:bg-gray-100"
              style={{ color: copied ? '#007857' : '#9ca3af' }}
              title="Copy response"
            >
              {copied ? (
                <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Copied</>
              ) : (
                <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default ChatMessage;