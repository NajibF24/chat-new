import React, { memo, useState } from 'react';
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
// CodeBlock
// ─────────────────────────────────────────────────────────────
const ARTIFACT_LANGS = ['html', 'htm', 'react', 'jsx', 'tsx', 'svg', 'python', 'py', 'javascript', 'js', 'ts', 'typescript', 'css', 'sql'];
const MIN_LINES_ARTIFACT = 5;

const LANG_BADGE_COLOR = {
  html: 'bg-orange-600', htm: 'bg-orange-600',
  react: 'bg-blue-600', jsx: 'bg-blue-600', tsx: 'bg-blue-600',
  svg: 'bg-pink-600',
  python: 'bg-yellow-600', py: 'bg-yellow-600',
  javascript: 'bg-yellow-500', js: 'bg-yellow-500',
  typescript: 'bg-blue-500', ts: 'bg-blue-500',
  css: 'bg-purple-600',
  sql: 'bg-sky-600',
};

function CodeBlock({ lang, code, isUser, onOpenArtifact }) {
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n').length;
  const langKey = (lang || '').toLowerCase();
  const isArtifactable = ARTIFACT_LANGS.includes(langKey) && lines >= MIN_LINES_ARTIFACT;
  const badgeColor = LANG_BADGE_COLOR[langKey] || 'bg-gray-600';

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  return (
    <div className="my-3 xl:my-4 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 xl:px-4 py-1.5 xl:py-2 bg-gray-800">
        <div className="flex items-center gap-2">
          {lang && (
            <span className={`${badgeColor} text-white text-[10px] xl:text-xs font-bold px-2 py-0.5 rounded`}>
              {lang}
            </span>
          )}
          <span className="text-gray-400 text-[10px] xl:text-xs">{lines} lines</span>
        </div>
        <div className="flex items-center gap-1.5 xl:gap-2">
          {isArtifactable && onOpenArtifact && (
            <button
              onClick={() => onOpenArtifact(langKey, code)}
              className="flex items-center gap-1 xl:gap-1.5 px-2 xl:px-3 py-0.5 xl:py-1 bg-primary-dark hover:bg-primary text-white text-[10px] xl:text-xs font-bold rounded-lg transition-colors"
            >
              <span>⊞</span><span>Open</span>
            </button>
          )}
          <button
            onClick={handleCopy}
            className={`px-2 xl:px-3 py-0.5 xl:py-1 text-[10px] xl:text-xs font-bold rounded-lg transition-colors ${
              copied ? 'bg-green-600/30 text-green-400' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
          >
            {copied ? '✓ Copied' : '⎘ Copy'}
          </button>
        </div>
      </div>
      {/* Code body */}
      <div className="overflow-auto max-h-[380px] xl:max-h-[480px] bg-gray-900">
        <pre className="p-3 xl:p-4 text-xs xl:text-sm text-gray-100 font-mono leading-relaxed whitespace-pre">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ChatMessage
// ─────────────────────────────────────────────────────────────
const ChatMessage = memo(({ message, bot, onOpenArtifact }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full mb-4 xl:mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[92%] md:max-w-[80%] xl:max-w-[75%] 2xl:max-w-[70%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>

        {/* Avatar */}
        {isUser ? (
          <div className="flex-shrink-0 w-6 h-8 xl:w-8 xl:h-10 rounded-lg flex items-center justify-center shadow-md font-bold text-xs bg-primary-dark text-white ml-2 xl:ml-3 mt-0.5">
            <svg className="w-4 h-4 xl:w-5 xl:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
        ) : (
          <div className="flex-shrink-0 mr-2 xl:mr-3 mt-0.5">
            <BotAvatar bot={bot} size="sm" />
          </div>
        )}

        {/* Bubble */}
        <div className={`px-4 xl:px-5 py-2 xl:py-3 shadow-sm relative overflow-hidden transition-all ${
          isUser
            ? 'bg-primary-dark text-white rounded-2xl rounded-tr-sm'
            : 'bg-white text-gray-800 border border-steel-light/30 rounded-2xl rounded-tl-sm'
        }`}>

          <div className={`prose max-w-none leading-relaxed text-xs xl:text-sm ${isUser ? 'prose-invert text-white' : 'text-gray-800'}`}
            style={{ '--tw-prose-body': isUser ? '#fff' : '#1e293b' }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Code block
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
                      className={`${isUser ? 'bg-white/20 text-white' : 'bg-steel-lightest text-primary-dark'} px-1 xl:px-1.5 py-0.5 rounded text-[11px] xl:text-xs font-mono`}
                      {...props}>
                      {children}
                    </code>
                  );
                },

                // Paragraph (with video support)
                p({ node, children, ...props }) {
                  const content = children[0];
                  if (typeof content === 'string' && content.startsWith('[[VIDEO:')) {
                    const videoUrl = getFileUrl(content.replace('[[VIDEO:', '').replace(']]', ''));
                    return (
                      <div className={`my-3 xl:my-4 rounded-xl overflow-hidden border shadow-lg bg-black aspect-video flex items-center justify-center ${isUser ? 'border-white/20' : 'border-steel-light/30'}`}>
                        <video controls className="w-full h-full" preload="metadata">
                          <source src={videoUrl} type="video/mp4" />
                          Browser tidak mendukung video.
                        </video>
                      </div>
                    );
                  }
                  return <p className="mb-2 last:mb-0 text-xs xl:text-sm leading-relaxed" {...props}>{children}</p>;
                },

                // Images
                img({ node, ...props }) {
                  return (
                    <div className="relative my-3 xl:my-4 bg-gray-100/50 rounded-xl overflow-hidden" style={{ minHeight: '120px' }}>
                      <img
                        {...props}
                        src={getFileUrl(props.src)}
                        alt={props.alt || 'Attachment'}
                        className="max-w-full h-auto max-h-[350px] xl:max-h-[450px] rounded-lg shadow-sm border border-steel-light/30 bg-white p-1 cursor-pointer transition-opacity duration-300 hover:opacity-90"
                        loading="lazy"
                        onClick={e => window.open(e.target.src, '_blank')}
                        onError={e => {
                          e.target.style.display = 'none';
                          e.target.parentNode.innerHTML = `<div style="padding:10px;color:#ef4444;font-size:11px;text-align:center;">⚠️ Gagal memuat gambar</div>`;
                        }}
                      />
                    </div>
                  );
                },

                ul: ({ node, ...props }) => <ul className="list-disc pl-4 xl:pl-5 mb-2 xl:mb-3 space-y-1 text-xs xl:text-sm" {...props} />,
                ol: ({ node, ...props }) => <ol className="list-decimal pl-4 xl:pl-5 mb-2 xl:mb-3 space-y-1 text-xs xl:text-sm" {...props} />,
                li: ({ node, ...props }) => <li className="text-xs xl:text-sm" {...props} />,
                h1: ({ node, ...props }) => <h1 className={`text-base xl:text-lg font-bold mt-3 xl:mt-4 mb-2 border-b pb-1 ${isUser ? 'border-white/20' : 'border-steel-light/30'}`} {...props} />,
                h2: ({ node, ...props }) => <h2 className="text-xs xl:text-sm font-bold mt-2.5 xl:mt-3 mb-1.5" {...props} />,
                h3: ({ node, ...props }) => <h3 className="text-xs xl:text-sm font-bold mt-2 mb-1" {...props} />,
                strong: ({ node, ...props }) => <strong className="font-bold" {...props} />,
                blockquote: ({ node, ...props }) => (
                  <blockquote className={`border-l-4 pl-3 xl:pl-4 my-2 xl:my-3 italic text-xs xl:text-sm ${isUser ? 'border-white/40 text-white/80' : 'border-primary/40 text-steel'}`} {...props} />
                ),

                table: ({ node, ...props }) => (
                  <div className={`overflow-x-auto my-3 xl:my-4 rounded-lg border shadow-sm ${isUser ? 'border-white/20' : 'border-steel-light/30'}`}>
                    <table className={`min-w-full divide-y text-xs xl:text-sm ${isUser ? 'divide-white/20' : 'divide-steel-light/30'}`} {...props} />
                  </div>
                ),
                thead: ({ node, ...props }) => <thead className={`${isUser ? 'bg-white/10' : 'bg-steel-lightest'} font-bold`} {...props} />,
                th: ({ node, ...props }) => <th className="px-3 xl:px-4 py-1.5 xl:py-2 text-left text-xs xl:text-xs uppercase tracking-wider border-b" {...props} />,
                tr: ({ node, ...props }) => <tr className="hover:bg-black/5" {...props} />,
                td: ({ node, ...props }) => <td className="px-3 xl:px-4 py-1.5 xl:py-2 border-r last:border-r-0 text-xs xl:text-sm" {...props} />,
                a: ({ node, ...props }) => <a className="underline font-semibold hover:opacity-80 text-xs xl:text-sm" target="_blank" rel="noreferrer" {...props} />,
              }}
            >
              {message.content || ''}
            </ReactMarkdown>
          </div>

          {/* Attachments */}
          {message.attachedFiles && message.attachedFiles.length > 0 && (
            <div className={`mt-3 xl:mt-4 pt-3 border-t ${isUser ? 'border-white/20' : 'border-steel-light/30'}`}>
              <div className="grid grid-cols-1 gap-2 xl:gap-3">
                {message.attachedFiles.map((file, idx) => {
                  const fileName = file.name?.toLowerCase() || '';
                  const isImage  = file.type === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
                  const fullPath = getFileUrl(file.path);
                  return (
                    <div key={idx} className={`rounded-lg border overflow-hidden shadow-sm ${isUser ? 'bg-white/10 border-white/20' : 'bg-steel-lightest border-steel-light/30'}`}>
                      {isImage ? (
                        <div className="cursor-pointer group" onClick={() => window.open(fullPath, '_blank')}>
                          <div style={{ minHeight: '120px' }} className="bg-black/5 flex items-center justify-center">
                            <img src={fullPath} alt={file.name}
                              className="w-full h-auto max-h-[300px] xl:max-h-[400px] object-contain transition-transform group-hover:scale-[1.01]"
                              onError={e => { e.target.src = 'https://placehold.co/400x300?text=File+Not+Found'; }}
                            />
                          </div>
                          <div className="p-2 flex justify-between items-center text-[10px] xl:text-xs bg-white/5">
                            <span className="truncate font-medium">{file.name}</span>
                            <span className="opacity-60">Open ↗</span>
                          </div>
                        </div>
                      ) : (
                        <a href={fullPath} target="_blank" rel="noreferrer"
                          className="flex items-center p-2.5 xl:p-3 hover:bg-black/5 transition-colors">
                          <div className="mr-2.5 text-xl xl:text-2xl">📄</div>
                          <div className="flex-1 overflow-hidden">
                            <div className="font-bold text-xs xl:text-sm truncate">{file.name}</div>
                            <div className="text-[10px] xl:text-xs opacity-60">Document</div>
                          </div>
                          <div className="ml-2 text-xs opacity-40">⬇</div>
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timestamp */}
          <div className={`text-[9px] xl:text-[10px] mt-1.5 xl:mt-2 text-right font-medium tracking-tight ${isUser ? 'text-white/50' : 'text-steel-light'}`}>
            {new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ChatMessage;
