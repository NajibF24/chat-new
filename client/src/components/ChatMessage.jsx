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
// Parse citations from AI response content
// Extracts the JSON citations block we embed after the main text.
// Returns { mainContent: string, citations: Array<{url, title}> }
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
// Citations Panel Component
// ─────────────────────────────────────────────────────────────
function CitationsPanel({ citations }) {
  const [expanded, setExpanded] = useState(false);
  if (!citations || citations.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-primary-dark transition-colors group"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="group-hover:text-primary-dark">
          {citations.length} Sumber Referensi
        </span>
        <span className="text-gray-400 font-normal">
          {expanded ? '— klik untuk tutup' : '— klik untuk lihat'}
        </span>
      </button>

      {expanded && (
        <div className="mt-2.5 space-y-1.5">
          {citations.map((cite, idx) => (
            <a
              key={idx}
              href={cite.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2.5 p-2.5 rounded-xl border border-gray-100 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 transition-all group"
            >
              {/* Favicon */}
              <div className="flex-shrink-0 mt-0.5">
                <img
                  src={`https://www.google.com/s2/favicons?domain=${new URL(cite.url).hostname}&sz=16`}
                  alt=""
                  className="w-4 h-4 rounded"
                  onError={e => { e.target.style.display = 'none'; }}
                />
              </div>

              <div className="flex-1 min-w-0">
                {/* Citation number + title */}
                <div className="flex items-center gap-1.5">
                  <span className="flex-shrink-0 w-4 h-4 bg-primary/10 text-primary-dark rounded text-[9px] font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <p className="text-xs font-semibold text-gray-700 group-hover:text-primary-dark truncate transition-colors">
                    {cite.title || cite.url}
                  </p>
                </div>
                {/* URL display */}
                <p className="text-[10px] text-gray-400 truncate mt-0.5 pl-5.5">
                  {cite.url}
                </p>
              </div>

              {/* External link icon */}
              <svg
                className="flex-shrink-0 w-3 h-3 text-gray-400 group-hover:text-primary mt-1 transition-colors"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ))}
        </div>
      )}
    </div>
  );
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
              <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
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
// ChatMessage
// ─────────────────────────────────────────────────────────────
const ChatMessage = memo(({ message, bot, onOpenArtifact, isStreaming }) => {
  const isUser = message.role === 'user';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Parse citations out of the message content (assistant messages only)
  const { mainContent, citations } = isUser
    ? { mainContent: message.content || '', citations: [] }
    : parseCitations(message.content || '');

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
                a: ({ node, ...props }) => <a className={`underline font-medium hover:opacity-80 text-sm ${isUser ? 'text-white' : 'text-primary'}`} target="_blank" rel="noreferrer" {...props} />,
              }}
            >
              {mainContent}
            </ReactMarkdown>
          </div>

          {/* ── Citations panel (only for assistant messages with web search) ── */}
          {!isUser && citations.length > 0 && (
            <CitationsPanel citations={citations} />
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