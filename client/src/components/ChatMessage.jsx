import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function ChatMessage({ message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[95%] md:max-w-[85%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>

        {/* Avatar Area */}
        <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center shadow-md font-bold text-xs ${
          isUser ? 'bg-gys-navy text-white ml-3' : 'bg-white border border-gys-border text-gys-navy mr-3'
        }`}>
          {isUser ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          ) : (
            <span className="tracking-tighter">GYS</span>
          )}
        </div>

        {/* Message Bubble */}
        <div className={`px-5 py-4 shadow-sm relative overflow-hidden transition-all ${
          isUser
            ? 'bg-gys-navy text-white rounded-2xl rounded-tr-sm'
            : 'bg-white text-gys-text border border-gys-border rounded-2xl rounded-tl-sm'
        }`}>

          {/* 1. RENDER CONTENT (Markdown + Video Detection) */}
          <div className={`prose prose-sm max-w-none leading-relaxed ${isUser ? 'prose-invert text-white' : 'text-gys-text'}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // --- CUSTOM: VIDEO PLAYER (SORA SUPPORT) ---
                p: ({node, children, ...props}) => {
                  const content = children[0];
                  if (typeof content === 'string' && content.startsWith('[[VIDEO:')) {
                    const videoUrl = content.replace('[[VIDEO:', '').replace(']]', '');
                    return (
                      <div className="my-4 rounded-xl overflow-hidden border border-gys-border shadow-lg bg-black aspect-video flex items-center justify-center">
                        <video controls className="w-full h-full" preload="metadata">
                          <source src={videoUrl} type="video/mp4" />
                          Browser tidak mendukung pemutar video.
                        </video>
                      </div>
                    );
                  }
                  return <p className="mb-2 last:mb-0" {...props}>{children}</p>;
                },

                // --- LISTS ---
                ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3 space-y-1" {...props} />,
                ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...props} />,

                // --- HEADINGS ---
                h1: ({node, ...props}) => <h1 className="text-lg font-bold mt-4 mb-2 border-b border-gys-border pb-1" {...props} />,
                h2: ({node, ...props}) => <h2 className="text-md font-bold mt-3 mb-2" {...props} />,

                // --- BOLD & CODE ---
                strong: ({node, ...props}) => <strong className={`font-bold ${isUser ? 'text-white' : 'text-gys-navy'}`} {...props} />,
                code: ({node, inline, ...props}) =>
                  inline
                    ? <code className={`${isUser ? 'bg-white/20' : 'bg-slate-100 text-red-600'} px-1 py-0.5 rounded text-xs font-mono`} {...props} />
                    : <div className="bg-slate-800 text-slate-200 p-3 rounded-lg overflow-x-auto my-2 text-xs font-mono shadow-inner"><code {...props} /></div>,

                // --- TABLE (INDUSTRIAL STYLE) ---
                table: ({node, ...props}) => (
                  <div className="overflow-x-auto my-4 rounded-lg border border-gys-border shadow-sm">
                    <table className="min-w-full divide-y divide-gys-border text-xs" {...props} />
                  </div>
                ),
                thead: ({node, ...props}) => <thead className="bg-slate-50 text-gys-navy font-bold" {...props} />,
                th: ({node, ...props}) => <th className="px-3 py-2 text-left uppercase tracking-wider border-b border-gys-border" {...props} />,
                tr: ({node, ...props}) => <tr className={`${isUser ? 'hover:bg-white/5' : 'hover:bg-slate-50'} transition-colors`} {...props} />,
                td: ({node, ...props}) => <td className="px-3 py-2 whitespace-pre-wrap border-r border-slate-100 last:border-r-0" {...props} />,

                // --- IMAGES ---
                img: ({node, ...props}) => (
                  <img
                    {...props}
                    className="max-w-full h-auto rounded-lg shadow-md border border-gys-border my-3 cursor-zoom-in hover:scale-[1.01] transition-transform bg-white p-1"
                    loading="lazy"
                    onClick={(e) => window.open(e.target.src, '_blank')}
                  />
                ),

                // --- LINKS ---
                a: ({node, ...props}) => <a className={`${isUser ? 'text-sky-300' : 'text-gys-blue'} underline font-bold hover:opacity-80`} target="_blank" rel="noreferrer" {...props} />,
              }}
            >
              {message.content || ''}
            </ReactMarkdown>
          </div>

          {/* 2. RENDER ATTACHMENTS (FORMAL STYLE) */}
          {message.attachedFiles && message.attachedFiles.length > 0 && (
            <div className={`mt-4 pt-3 border-t ${isUser ? 'border-white/10' : 'border-gys-border'}`}>
              <p className={`text-[10px] font-bold mb-2 uppercase tracking-tighter ${isUser ? 'text-slate-300' : 'text-gys-subtext'}`}>
                Attachments ({message.attachedFiles.length})
              </p>

              <div className="grid grid-cols-1 gap-2">
                {message.attachedFiles.map((file, idx) => (
                  <div key={idx} className={`rounded-lg border overflow-hidden ${isUser ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-gys-border'}`}>

                    {file.type === 'image' ? (
                      <div className="relative group/img cursor-pointer" onClick={() => window.open(file.path, '_blank')}>
                        <img
                          src={file.path}
                          alt={file.name}
                          className="w-full h-auto object-contain max-h-[200px] bg-black/5"
                        />
                        <div className="p-2 flex justify-between items-center text-[10px]">
                           <span className={`truncate max-w-[80%] font-medium ${isUser ? 'text-white' : 'text-gys-text'}`}>{file.name}</span>
                           <span className="opacity-60">View ↗</span>
                        </div>
                      </div>
                    ) : (
                      <a href={file.path} target="_blank" rel="noreferrer" className="flex items-center p-3 hover:bg-black/5 transition-colors">
                        <div className={`mr-3 w-8 h-8 rounded flex items-center justify-center text-lg ${isUser ? 'bg-white/10' : 'bg-white shadow-sm'}`}>
                          {file.name?.toLowerCase().endsWith('.pdf') ? '📕' : '📄'}
                        </div>
                        <div className="flex-1 overflow-hidden">
                           <div className={`font-bold text-xs truncate ${isUser ? 'text-white' : 'text-gys-navy'}`}>{file.name}</div>
                           <div className={`text-[9px] opacity-60 ${isUser ? 'text-slate-300' : 'text-gys-subtext'}`}>{file.size ? `${file.size} KB` : 'Document'}</div>
                        </div>
                        <div className="ml-2 text-xs opacity-40">⬇</div>
                      </a>
                    )}

                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timestamp */}
          <div className={`text-[9px] mt-2 text-right font-medium tracking-tight ${isUser ? 'text-slate-300' : 'text-slate-400'}`}>
            {new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>

        </div>
      </div>
    </div>
  );
}

export default ChatMessage;
