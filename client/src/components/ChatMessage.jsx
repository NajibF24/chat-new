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
          isUser ? 'bg-primary-dark text-white ml-3' : 'bg-white border border-steel-light/30 text-primary-dark mr-3'
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
            ? 'bg-primary-dark text-white rounded-2xl rounded-tr-sm'
            : 'bg-white text-gray-800 border border-steel-light/30 rounded-2xl rounded-tl-sm'
        }`}>

          {/* 1. RENDER CONTENT (Markdown + Video Detection) */}
          <div className={`prose prose-sm max-w-none leading-relaxed ${isUser ? 'prose-invert text-white' : 'text-gray-800'}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // --- CUSTOM: VIDEO PLAYER (SORA SUPPORT) ---
                p: ({node, children, ...props}) => {
                  const content = children[0];
                  if (typeof content === 'string' && content.startsWith('[[VIDEO:')) {
                    const videoUrl = content.replace('[[VIDEO:', '').replace(']]', '');
                    return (
                      <div className={`my-4 rounded-xl overflow-hidden border shadow-lg bg-black aspect-video flex items-center justify-center ${isUser ? 'border-white/20' : 'border-steel-light/30'}`}>
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
                h1: ({node, ...props}) => <h1 className={`text-lg font-bold mt-4 mb-2 border-b pb-1 ${isUser ? 'border-white/20' : 'border-steel-light/30'}`} {...props} />,
                h2: ({node, ...props}) => <h2 className="text-md font-bold mt-3 mb-2" {...props} />,

                // --- BOLD & CODE ---
                strong: ({node, ...props}) => <strong className={`font-bold ${isUser ? 'text-white' : 'text-primary-dark'}`} {...props} />,
                code: ({node, inline, ...props}) =>
                  inline
                    ? <code className={`${isUser ? 'bg-white/20 text-white' : 'bg-steel-lightest text-primary-dark'} px-1 py-0.5 rounded text-xs font-mono`} {...props} />
                    : <div className={`${isUser ? 'bg-black/30' : 'bg-steel-lightest border border-steel-light/30'} p-3 rounded-lg overflow-x-auto my-2 text-xs font-mono shadow-inner`}><code className={isUser ? 'text-white' : 'text-gray-700'} {...props} /></div>,

                // --- TABLE (INDUSTRIAL STYLE) ---
                table: ({node, ...props}) => (
                  <div className={`overflow-x-auto my-4 rounded-lg border shadow-sm ${isUser ? 'border-white/20' : 'border-steel-light/30'}`}>
                    <table className={`min-w-full divide-y text-xs ${isUser ? 'divide-white/20' : 'divide-steel-light/30'}`} {...props} />
                  </div>
                ),
                thead: ({node, ...props}) => <thead className={`${isUser ? 'bg-white/10 text-white' : 'bg-steel-lightest text-primary-dark'} font-bold`} {...props} />,
                th: ({node, ...props}) => <th className={`px-3 py-2 text-left uppercase tracking-wider border-b ${isUser ? 'border-white/20' : 'border-steel-light/30'}`} {...props} />,
                tr: ({node, ...props}) => <tr className={`${isUser ? 'hover:bg-white/5' : 'hover:bg-steel-lightest'} transition-colors`} {...props} />,
                td: ({node, ...props}) => <td className={`px-3 py-2 whitespace-pre-wrap border-r last:border-r-0 ${isUser ? 'border-white/10' : 'border-steel-light/30'}`} {...props} />,

                // --- IMAGES ---
                img: ({node, ...props}) => (
                  <img
                    {...props}
                    className={`max-w-full h-auto rounded-lg shadow-sm border my-3 cursor-zoom-in hover:scale-[1.01] transition-transform bg-white p-1 ${isUser ? 'border-white/20' : 'border-steel-light/30'}`}
                    loading="lazy"
                    onClick={(e) => window.open(e.target.src, '_blank')}
                  />
                ),

                // --- LINKS ---
                a: ({node, ...props}) => <a className={`${isUser ? 'text-white underline decoration-white/50' : 'text-primary-light'} underline font-bold hover:opacity-80`} target="_blank" rel="noreferrer" {...props} />,
              }}
            >
              {message.content || ''}
            </ReactMarkdown>
          </div>

          {/* 2. RENDER ATTACHMENTS (FORMAL STYLE) */}
          {message.attachedFiles && message.attachedFiles.length > 0 && (
            <div className={`mt-4 pt-3 border-t ${isUser ? 'border-white/20' : 'border-steel-light/30'}`}>
              <p className={`text-[10px] font-bold mb-2 uppercase tracking-tighter ${isUser ? 'text-white/70' : 'text-steel'}`}>
                Attachments ({message.attachedFiles.length})
              </p>

              <div className="grid grid-cols-1 gap-2">
                {message.attachedFiles.map((file, idx) => {
                  // Penambahan Logika Deteksi Tipe File yang lebih kuat
                  const fileName = file.name?.toLowerCase() || '';
                  const isImage = file.type?.includes('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
                  const isPDF = file.type?.includes('pdf') || fileName.endsWith('.pdf');

                  return (
                    <div key={idx} className={`rounded-lg border overflow-hidden ${isUser ? 'bg-white/10 border-white/20' : 'bg-steel-lightest border-steel-light/30'}`}>

                      {isImage ? (
                        <div className="relative group/img cursor-pointer" onClick={() => window.open(file.path, '_blank')}>
                          <img
                            src={file.path}
                            alt={file.name}
                            className="w-full h-auto object-contain max-h-[300px] bg-black/5"
                            onError={(e) => {
                                e.target.onerror = null; 
                                e.target.src = 'https://placehold.co/400x300?text=Image+Not+Found';
                            }}
                          />
                          <div className={`p-2 flex justify-between items-center text-[10px] border-t ${isUser ? 'border-white/10' : 'border-steel-light/30'}`}>
                             <span className={`truncate max-w-[80%] font-medium ${isUser ? 'text-white' : 'text-gray-800'}`}>{file.name}</span>
                             <span className={`opacity-60 ${isUser ? 'text-white' : 'text-steel'}`}>View ↗</span>
                          </div>
                        </div>
                      ) : (
                        <a href={file.path} target="_blank" rel="noreferrer" className="flex items-center p-3 hover:bg-black/5 transition-colors">
                          <div className={`mr-3 w-10 h-10 rounded flex items-center justify-center text-2xl ${isUser ? 'bg-white/20' : 'bg-white shadow-sm border border-steel-light/30'}`}>
                            {isPDF ? '📕' : '📄'}
                          </div>
                          <div className="flex-1 overflow-hidden">
                             <div className={`font-bold text-xs truncate ${isUser ? 'text-white' : 'text-primary-dark'}`}>{file.name}</div>
                             <div className={`text-[9px] opacity-80 ${isUser ? 'text-white/70' : 'text-steel'}`}>
                                {isPDF ? 'PDF Document' : (file.size ? `${file.size} KB` : 'File')}
                             </div>
                          </div>
                          <div className={`ml-2 text-xs opacity-60 ${isUser ? 'text-white' : 'text-steel'}`}>↗</div>
                        </a>
                      )}

                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timestamp */}
          <div className={`text-[9px] mt-2 text-right font-medium tracking-tight ${isUser ? 'text-white/60' : 'text-steel-light'}`}>
            {new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>

        </div>
      </div>
    </div>
  );
}

export default ChatMessage;
