import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// --- KONFIGURASI API URL ---
// Ganti 'http://localhost:5000' jika port backend Anda berbeda.
const API_BASE_URL = 'http://localhost:5000'; 

// Helper untuk memperbaiki URL Gambar/File agar mengarah ke Backend
const getFileUrl = (path) => {
  if (!path) return '';
  // Jika path sudah ada http/https (misal link luar), biarkan
  if (path.startsWith('http')) return path;
  // Jika path relatif dimulai dengan /, tambahkan API_BASE_URL
  if (path.startsWith('/')) return `${API_BASE_URL}${path}`;
  return path;
};

// Membungkus dengan memo agar tidak re-render saat user mengetik di input chat
const ChatMessage = memo(({ message }) => {
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

          {/* 1. RENDER CONTENT (Markdown + Full Logic) */}
          <div className={`prose prose-sm max-w-none leading-relaxed ${isUser ? 'prose-invert text-white' : 'text-gray-800'}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // --- CUSTOM: VIDEO PLAYER ---
                p: ({node, children, ...props}) => {
                  const content = children[0];
                  if (typeof content === 'string' && content.startsWith('[[VIDEO:')) {
                    // FIX: Gunakan getFileUrl
                    const videoUrl = getFileUrl(content.replace('[[VIDEO:', '').replace(']]', ''));
                    return (
                      <div className={`my-4 rounded-xl overflow-hidden border shadow-lg bg-black aspect-video flex items-center justify-center ${isUser ? 'border-white/20' : 'border-steel-light/30'}`}>
                        <video controls className="w-full h-full" preload="metadata">
                          <source src={videoUrl} type="video/mp4" />
                          Browser tidak mendukung video.
                        </video>
                      </div>
                    );
                  }
                  return <p className="mb-2 last:mb-0" {...props}>{children}</p>;
                },

                // --- LISTS & HEADINGS ---
                ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3 space-y-1" {...props} />,
                ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...props} />,
                h1: ({node, ...props}) => <h1 className={`text-lg font-bold mt-4 mb-2 border-b pb-1 ${isUser ? 'border-white/20' : 'border-steel-light/30'}`} {...props} />,
                h2: ({node, ...props}) => <h2 className="text-md font-bold mt-3 mb-2" {...props} />,

                // --- BOLD & CODE ---
                strong: ({node, ...props}) => <strong className="font-bold" {...props} />,
                code: ({node, inline, ...props}) =>
                  inline
                    ? <code className={`${isUser ? 'bg-white/20 text-white' : 'bg-steel-lightest text-primary-dark'} px-1 py-0.5 rounded text-xs font-mono`} {...props} />
                    : <div className={`${isUser ? 'bg-black/30' : 'bg-steel-lightest border border-steel-light/30'} p-3 rounded-lg overflow-x-auto my-2 text-xs font-mono`}><code {...props} /></div>,

                // --- TABLE (Style Industrial GYS) ---
                table: ({node, ...props}) => (
                  <div className={`overflow-x-auto my-4 rounded-lg border shadow-sm ${isUser ? 'border-white/20' : 'border-steel-light/30'}`}>
                    <table className={`min-w-full divide-y text-xs ${isUser ? 'divide-white/20' : 'divide-steel-light/30'}`} {...props} />
                  </div>
                ),
                thead: ({node, ...props}) => <thead className={`${isUser ? 'bg-white/10' : 'bg-steel-lightest'} font-bold`} {...props} />,
                th: ({node, ...props}) => <th className="px-3 py-2 text-left uppercase tracking-wider border-b" {...props} />,
                tr: ({node, ...props}) => <tr className="hover:bg-black/5" {...props} />,
                td: ({node, ...props}) => <td className="px-3 py-2 border-r last:border-r-0" {...props} />,

                // --- IMAGES (Fix Glitch & Reload & URL) ---
                img: ({node, ...props}) => (
                  <div className="relative my-3 bg-gray-100/50 rounded-xl overflow-hidden" style={{ minHeight: '150px' }}>
                    <img
                      {...props}
                      src={getFileUrl(props.src)} // ✅ FIX: Gunakan helper URL
                      className="max-w-full h-auto max-h-[400px] rounded-lg shadow-sm border border-steel-light/30 bg-white p-1 cursor-pointer transition-opacity duration-300 hover:opacity-90"
                      loading="lazy"
                      onClick={(e) => window.open(e.target.src, '_blank')}
                      onError={(e) => { 
                          // Fallback jika gambar error
                          e.target.style.display = 'none'; 
                          e.target.parentNode.innerHTML = `<span style="font-size:10px; color:red;">Gagal memuat gambar</span>`; 
                      }}
                    />
                  </div>
                ),

                // --- LINKS ---
                a: ({node, ...props}) => <a className="underline font-bold hover:opacity-80" target="_blank" rel="noreferrer" {...props} />,
              }}
            >
              {message.content || ''}
            </ReactMarkdown>
          </div>

          {/* 2. RENDER ATTACHMENTS (FIXED URL) */}
          {message.attachedFiles && message.attachedFiles.length > 0 && (
            <div className={`mt-4 pt-3 border-t ${isUser ? 'border-white/20' : 'border-steel-light/30'}`}>
              <div className="grid grid-cols-1 gap-3">
                {message.attachedFiles.map((file, idx) => {
                  const fileName = file.name?.toLowerCase() || '';
                  const isImage = file.type === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
                  const isPDF = file.type === 'pdf' || fileName.endsWith('.pdf');
                  const fullPath = getFileUrl(file.path); // ✅ FIX: Gunakan helper URL

                  return (
                    <div key={idx} className={`rounded-lg border overflow-hidden shadow-sm ${isUser ? 'bg-white/10 border-white/20' : 'bg-steel-lightest border-steel-light/30'}`}>
                      {isImage ? (
                        <div className="cursor-pointer group" onClick={() => window.open(fullPath, '_blank')}>
                          <div style={{ minHeight: '150px' }} className="bg-black/5 flex items-center justify-center">
                            <img 
                              src={fullPath} // ✅ FIX URL
                              alt={file.name} 
                              className="w-full h-auto max-h-[350px] object-contain transition-transform group-hover:scale-[1.01]" 
                              onError={(e) => { e.target.src = 'https://placehold.co/400x300?text=File+Not+Found'; }}
                            />
                          </div>
                          <div className="p-2 flex justify-between items-center text-[10px] bg-white/5">
                            <span className="truncate font-medium">{file.name}</span>
                            <span className="opacity-60">Open ↗</span>
                          </div>
                        </div>
                      ) : (
                        <a href={fullPath} target="_blank" rel="noreferrer" className="flex items-center p-3 hover:bg-black/5 transition-colors">
                          <div className="mr-3 text-2xl">{isPDF ? '📕' : '📄'}</div>
                          <div className="flex-1 overflow-hidden">
                            <div className="font-bold text-xs truncate">{file.name}</div>
                            <div className="text-[10px] opacity-60">{isPDF ? 'PDF Document' : 'File'}</div>
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
          <div className={`text-[9px] mt-2 text-right font-medium tracking-tight ${isUser ? 'text-white/60' : 'text-steel-light'}`}>
            {new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ChatMessage;