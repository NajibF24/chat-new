import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function ChatMessage({ message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[95%] md:max-w-[85%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        
        {/* Avatar */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${
          isUser ? 'bg-primary-600 ml-3' : 'bg-white border border-steel-200 mr-3'
        }`}>
          {isUser ? (
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          ) : (
            <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          )}
        </div>

        {/* Message Bubble */}
        <div className={`px-5 py-4 shadow-sm relative group overflow-hidden ${
          isUser 
            ? 'bg-primary-600 text-white rounded-2xl rounded-tr-sm' 
            : 'bg-white text-gray-800 border border-gray-200 rounded-2xl rounded-tl-sm'
        }`}>
          
          {/* 1. RENDER TEKS MARKDOWN (STYLED) */}
          <div className={`prose text-sm max-w-none leading-relaxed ${isUser ? 'prose-invert text-white' : 'text-gray-800'}`}>
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]} 
              components={{
                // --- 1. LIST STYLING (Agar nomor & bullet rapi) ---
                ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3 space-y-1" {...props} />,
                ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...props} />,
                li: ({node, ...props}) => <li className="pl-1 marker:text-gray-400" {...props} />,

                // --- 2. HEADING STYLING (Agar judul jelas) ---
                h1: ({node, ...props}) => <h1 className="text-xl font-bold mt-4 mb-2" {...props} />,
                h2: ({node, ...props}) => <h2 className="text-lg font-bold mt-3 mb-2" {...props} />,
                h3: ({node, ...props}) => <h3 className="text-md font-semibold mt-3 mb-1" {...props} />,

                // --- 3. BOLD & CODE ---
                strong: ({node, ...props}) => <strong className={`font-bold ${isUser ? 'text-white' : 'text-gray-900'}`} {...props} />,
                code: ({node, inline, ...props}) => 
                  inline 
                    ? <code className="bg-gray-100 text-red-500 px-1 py-0.5 rounded text-xs font-mono" {...props} />
                    : <div className="bg-gray-800 text-gray-200 p-3 rounded-lg overflow-x-auto my-2 text-xs font-mono"><code {...props} /></div>,

                // --- 4. TABLE STYLING ---
                table: ({node, ...props}) => (
                  <div className="overflow-x-auto my-4 rounded-lg border border-gray-300 shadow-sm">
                    <table className="min-w-full divide-y divide-gray-300 text-sm" {...props} />
                  </div>
                ),
                thead: ({node, ...props}) => <thead className="bg-gray-100 text-gray-700" {...props} />,
                th: ({node, ...props}) => <th className="px-3 py-3 text-left font-bold uppercase tracking-wider border-b border-gray-300 bg-gray-50 text-xs" {...props} />,
                tbody: ({node, ...props}) => <tbody className="bg-white divide-y divide-gray-200" {...props} />,
                tr: ({node, ...props}) => <tr className="even:bg-gray-50 hover:bg-blue-50 transition-colors" {...props} />,
                td: ({node, ...props}) => <td className="px-3 py-2 whitespace-pre-wrap border-r border-gray-100 last:border-r-0 align-top" {...props} />,
                
                // --- 5. PARAGRAPH & LINKS ---
                p: ({node, ...props}) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
                a: ({node, ...props}) => <a className="text-blue-500 underline hover:text-blue-700 font-medium" target="_blank" rel="noreferrer" {...props} />,
                blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-500 my-2" {...props} />
              }}
            >
              {message.content || ''}
            </ReactMarkdown>
          </div>

          {/* 2. RENDER ATTACHMENT */}
          {message.attachedFiles && message.attachedFiles.length > 0 && (
            <div className={`mt-4 pt-3 border-t ${isUser ? 'border-primary-500/30' : 'border-gray-100'}`}>
              <p className={`text-[10px] font-bold mb-2 uppercase ${isUser ? 'text-primary-100' : 'text-gray-400'}`}>
                Lampiran ({message.attachedFiles.length}):
              </p>
              
              <div className="grid grid-cols-1 gap-2">
                {message.attachedFiles.map((file, idx) => (
                  <div key={idx} className={`rounded-lg border overflow-hidden ${isUser ? 'bg-primary-700/50 border-primary-500/30' : 'bg-gray-50 border-gray-200'}`}>
                    
                    {file.type === 'image' ? (
                      <div className="relative group/img">
                        <img 
                          src={file.path} 
                          alt={file.name}
                          className="w-full h-auto object-contain max-h-[250px] bg-black/5"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <div className="p-2 flex justify-between items-center text-xs">
                           <span className={`truncate max-w-[70%] font-medium ${isUser ? 'text-white' : 'text-gray-700'}`}>{file.name}</span>
                           <a href={file.path} target="_blank" rel="noreferrer" className="underline opacity-80 hover:opacity-100">Open</a>
                        </div>
                      </div>
                    ) : (
                      <a href={file.path} target="_blank" rel="noreferrer" className="flex items-center p-3 hover:opacity-80 transition-opacity">
                        <div className="mr-3 p-2 bg-white/20 rounded text-xl">📄</div>
                        <div className="flex-1 overflow-hidden">
                           <div className={`font-medium text-sm truncate ${isUser ? 'text-white' : 'text-blue-700'}`}>{file.name}</div>
                           <div className={`text-[10px] ${isUser ? 'text-primary-200' : 'text-gray-500'}`}>{file.size} KB</div>
                        </div>
                        <div className="opacity-50">⬇️</div>
                      </a>
                    )}
                    
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timestamp */}
          <div className={`text-[10px] mt-2 text-right ${isUser ? 'text-primary-200' : 'text-gray-400'}`}>
            {new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>

        </div>
      </div>
    </div>
  );
}

export default ChatMessage;
