import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown'; // ✅ Wajib import ini
import remarkGfm from 'remark-gfm';         // ✅ Wajib untuk tabel

const Chat = ({ user, handleLogout }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  
  // State Data
  const [bots, setBots] = useState([]);       
  const [threads, setThreads] = useState([]); 
  
  // State Selection
  const [selectedBot, setSelectedBot] = useState(null); 
  const [currentThreadId, setCurrentThreadId] = useState(null); 
  
  // State UI
  const [loading, setLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); 
  
  // State File Upload
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null); 

  // --- 1. INITIAL LOAD ---
  useEffect(() => {
    fetchBots();
    fetchThreads();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // --- API CALLS ---
  const fetchBots = async () => {
    try {
      const res = await axios.get('/api/chat/bots'); 
      const botList = Array.isArray(res.data) ? res.data : (res.data.bots || []);
      setBots(botList);
      if (botList.length > 0 && !selectedBot) setSelectedBot(botList[0]); 
    } catch (error) { console.error("Error fetching bots:", error); }
  };

  const fetchThreads = async () => {
    try {
      const res = await axios.get('/api/chat/threads');
      setThreads(res.data);
    } catch (error) { console.error("Error fetching threads:", error); }
  };

  // --- ACTIONS ---
  const handleBotSelect = (bot) => {
    setSelectedBot(bot);
    setMessages([]); 
    setCurrentThreadId(null); 
    setSelectedFile(null); 
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const loadThread = async (threadId) => {
    try {
      setLoading(true);
      setCurrentThreadId(threadId);
      setSelectedFile(null);

      const res = await axios.get(`/api/chat/thread/${threadId}`);
      const formattedMessages = res.data.map(msg => ({
        role: msg.role,
        content: msg.content,
        attachedFiles: msg.attachedFiles || []
      }));
      setMessages(formattedMessages);
      
      const threadInfo = threads.find(t => t._id === threadId);
      if (threadInfo && threadInfo.botId) {
          const threadBotId = typeof threadInfo.botId === 'object' ? threadInfo.botId._id : threadInfo.botId;
          const foundBot = bots.find(b => b._id === threadBotId);
          if (foundBot) setSelectedBot(foundBot);
      }
      if (window.innerWidth < 1024) setIsSidebarOpen(false);
    } catch (error) {
      console.error("Error loading thread:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setCurrentThreadId(null);
    setSelectedFile(null);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if(file.size > 20 * 1024 * 1024) return alert("Maksimal ukuran file 20MB");
      setSelectedFile(file);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if ((!input.trim() && !selectedFile) || !selectedBot || loading) return;

    setLoading(true);
    const currentInput = input;
    const currentFile = selectedFile;
    
    setInput('');
    setSelectedFile(null); 
    if(textareaRef.current) textareaRef.current.style.height = 'auto';

    let uploadedFileData = null;
    if (currentFile) {
        try {
            const fd = new FormData();
            fd.append('file', currentFile);
            const upRes = await axios.post('/api/chat/upload', fd, { 
                headers: {'Content-Type': 'multipart/form-data'} 
            });
            uploadedFileData = upRes.data; 
        } catch (err) {
            console.error("Upload failed:", err);
            setMessages(prev => [...prev, { role: 'assistant', content: "Gagal mengupload file: " + err.message }]);
            setLoading(false);
            return;
        }
    }

    const userMessage = { 
        role: 'user', 
        content: currentInput,
        attachedFiles: uploadedFileData ? [{ name: uploadedFileData.originalname }] : [] 
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const payload = {
        message: currentInput,
        botId: selectedBot._id,
        threadId: currentThreadId,
        attachedFile: uploadedFileData, 
        history: messages.map(m => ({ role: m.role, content: m.content })) 
      };

      const res = await axios.post('/api/chat/message', payload);
      const replyText = res.data.response; 

      if (!replyText) throw new Error("Server response empty");

      const botMessage = { role: 'assistant', content: replyText };
      setMessages(prev => [...prev, botMessage]);

      if (res.data.threadId) {
        setCurrentThreadId(res.data.threadId);
        fetchThreads(); 
      } else {
        fetchThreads(); 
      }

    } catch (error) {
      console.error("Error sending message:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: "Maaf, terjadi kesalahan pada server AI." }]);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex h-screen bg-slate-900 text-white font-sans overflow-hidden">
      
      {/* --- SIDEBAR --- */}
      <aside 
        className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:relative z-30 w-72 h-full bg-slate-800 border-r border-slate-700 flex flex-col transition-transform duration-300 shadow-xl`}
      >
        <div className="p-5 border-b border-slate-700 flex items-center justify-between bg-slate-800">
          <div className="flex items-center gap-3">
             <img src="/assets/favicon_gys.ico" alt="Logo" className="w-8 h-8"/>
             <div>
               <h1 className="font-bold text-lg text-white tracking-wide">PORTAL AI</h1>
               <div className="flex items-center gap-1.5">
                 <div className="w-2 h-2 rounded-full bg-green-500"></div>
                 <span className="text-[11px] text-green-400 font-medium">System Online</span>
               </div>
             </div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-slate-600">
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 px-2">Assistant</h3>
            <div className="space-y-1">
              {bots.map((bot) => (
                <button
                  key={bot._id}
                  onClick={() => handleBotSelect(bot)}
                  className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-all duration-200 ${
                    selectedBot?._id === bot._id 
                      ? 'bg-blue-600 text-white shadow-lg' 
                      : 'hover:bg-slate-700 text-slate-300 hover:text-white'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${
                     selectedBot?._id === bot._id ? 'bg-white text-blue-700' : 'bg-slate-700 text-slate-300'
                  }`}>
                    {bot.name ? bot.name.substring(0, 2).toUpperCase() : 'AI'}
                  </div>
                  <div className="flex-1 truncate">
                    <div className="font-semibold text-sm truncate">{bot.name}</div>
                    <div className="text-[11px] opacity-70 truncate">{bot.description || "AI Assistant"}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 px-2 mt-4">History</h3>
            <button 
                 onClick={handleNewChat}
                 className="w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300 transition-colors border border-dashed border-blue-500/30 mb-3"
              >
                 <span className="text-xl font-light leading-none">+</span>
                 <span className="text-sm font-medium">New Conversation</span>
            </button>
            <div className="space-y-1">
              {threads.length === 0 && <p className="text-xs text-slate-500 px-3 italic">No history found.</p>}
              {threads.map((t) => (
                <button
                  key={t._id}
                  onClick={() => loadThread(t._id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors flex items-center gap-2 ${
                    currentThreadId === t._id 
                    ? 'bg-slate-700 text-white font-medium border-l-2 border-blue-500' 
                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                  }`}
                >
                  <span className="truncate flex-1">{t.title || "Untitled Chat"}</span>
                  <span className="text-[10px] opacity-40">{new Date(t.lastMessageAt).getDate()}/{new Date(t.lastMessageAt).getMonth()+1}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-700 bg-slate-800">
           <div className="flex items-center gap-3">
             <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                {user?.username?.substring(0,2).toUpperCase() || 'US'}
             </div>
             <div className="flex-1 overflow-hidden">
               <p className="text-sm font-semibold text-white truncate">{user?.username || 'User'}</p>
               <button onClick={handleLogout} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 mt-0.5">
                 Sign Out
               </button>
             </div>
           </div>
        </div>
      </aside>

      {/* --- MAIN CHAT AREA --- */}
      <main className="flex-1 flex flex-col h-full relative bg-slate-900">
        
        <div className="lg:hidden h-14 border-b border-slate-700 flex items-center justify-between px-4 bg-slate-800">
           <span className="font-bold text-white">Portal AI</span>
           <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-blue-400">☰</button>
        </div>

        {/* MESSAGE LIST */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 scrollbar-thin scrollbar-thumb-slate-700">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-90 pb-20">
              <div className="w-20 h-20 bg-slate-800 rounded-2xl flex items-center justify-center mb-6 shadow-xl border border-slate-700">
                 <span className="text-4xl font-bold text-blue-500">{selectedBot?.name?.substring(0,1) || "A"}</span>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">
                {selectedBot ? `Hello, I'm ${selectedBot.name}` : "Select an Agent"}
              </h2>
              <p className="text-slate-400 max-w-md mx-auto mb-8">
                {selectedBot?.description || "Ready to assist you with operations, data, and analysis."}
              </p>
              {selectedBot && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-lg">
                   {(selectedBot.starterQuestions?.length > 0 ? selectedBot.starterQuestions : ["Apa status project?", "Cari data", "Buat laporan"]).map((txt, i) => (
                     <button key={i} onClick={() => { setInput(txt); handleSubmit({ preventDefault: ()=>{} }); }} className="p-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 hover:text-blue-400 transition-colors text-left">
                       {txt}
                     </button>
                   ))}
                </div>
              )}
            </div>
          ) : (
            messages.map((msg, index) => (
              <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                
                {msg.role !== 'user' && (
                  <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex-shrink-0 flex items-center justify-center mr-3 mt-1 shadow-sm">
                    <span className="text-xs font-bold text-blue-400">{selectedBot?.name?.substring(0,1) || "A"}</span>
                  </div>
                )}

                <div className={`max-w-[85%] lg:max-w-[75%] rounded-2xl p-4 shadow-md ${
                  msg.role === 'user' 
                    ? 'bg-blue-600 text-white rounded-tr-sm' 
                    : 'bg-slate-700 text-slate-100 rounded-tl-sm border border-slate-600'
                }`}>
                  
                  {msg.attachedFiles && msg.attachedFiles.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-2">
                          {msg.attachedFiles.map((f, idx) => (
                              <div key={idx} className="flex items-center gap-2 bg-black/20 p-2 rounded-lg text-xs">
                                  <span>📎</span><span className="truncate max-w-[150px]">{f.name}</span>
                              </div>
                          ))}
                      </div>
                  )}

                  {/* ✅ FIX TABEL: Menggunakan ReactMarkdown agar tabel ter-render rapi */}
                  <div className="text-sm leading-relaxed overflow-x-auto">
                    <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                            // Styling Tabel Dark Mode
                            table: ({node, ...props}) => <table className="w-full text-sm text-left text-slate-300 border-collapse border border-slate-600 my-4" {...props} />,
                            thead: ({node, ...props}) => <thead className="text-xs text-slate-200 uppercase bg-slate-800/50" {...props} />,
                            tbody: ({node, ...props}) => <tbody {...props} />,
                            tr: ({node, ...props}) => <tr className="bg-transparent border-b border-slate-600 hover:bg-slate-600/20" {...props} />,
                            th: ({node, ...props}) => <th className="px-4 py-3 border-r border-slate-600 font-bold" {...props} />,
                            td: ({node, ...props}) => <td className="px-4 py-3 border-r border-slate-600" {...props} />,
                            // Styling Text Lainnya
                            p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                            ul: ({node, ...props}) => <ul className="list-disc ml-5 mb-2" {...props} />,
                            ol: ({node, ...props}) => <ol className="list-decimal ml-5 mb-2" {...props} />,
                            a: ({node, ...props}) => <a className="text-blue-400 underline" target="_blank" {...props} />,
                            code: ({node, inline, ...props}) => inline 
                                ? <code className="bg-slate-800 px-1 py-0.5 rounded text-xs font-mono text-pink-400" {...props} />
                                : <pre className="bg-slate-900 p-3 rounded-lg overflow-x-auto my-2 text-xs font-mono border border-slate-600"><code {...props} /></pre>
                        }}
                    >
                        {msg.content}
                    </ReactMarkdown>
                  </div>

                </div>
              </div>
            ))
          )}
          
          {loading && (
             <div className="flex justify-start ml-11">
               <div className="bg-slate-700 rounded-xl px-4 py-3 flex items-center gap-2 border border-slate-600">
                 <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                 <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-100"></div>
                 <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-200"></div>
               </div>
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* INPUT AREA */}
        <div className="p-4 bg-slate-800 border-t border-slate-700 z-20">
          {selectedFile && (
            <div className="max-w-4xl mx-auto mb-2 flex items-center gap-2 bg-blue-500/20 border border-blue-500/30 text-blue-300 px-3 py-1.5 rounded-lg text-xs w-fit">
              <span>📎 {selectedFile.name}</span>
              <button onClick={() => setSelectedFile(null)} className="hover:text-white ml-2">✕</button>
            </div>
          )}

          <div className="max-w-4xl mx-auto relative flex items-end gap-2">
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3.5 text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors border border-slate-600" title="Upload File">📎</button>
            <div className="flex-1 relative">
               <textarea ref={textareaRef} value={input} onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; }} onKeyDown={handleKeyDown} placeholder={selectedBot ? `Message ${selectedBot.name}...` : "Select a bot first..."} disabled={!selectedBot || loading} rows={1} className="w-full bg-slate-900 border border-slate-600 text-white px-4 py-3.5 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-slate-500 shadow-inner transition-all resize-none overflow-hidden" />
            </div>
            <button onClick={handleSubmit} disabled={(!input.trim() && !selectedFile) || !selectedBot || loading} className="p-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 flex-shrink-0">➤</button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Chat;