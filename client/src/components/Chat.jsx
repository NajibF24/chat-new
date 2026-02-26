import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ChatMessage from './ChatMessage';
import BotAvatar from './BotAvatar';

const Chat = ({ user, handleLogout }) => {
  const navigate = useNavigate();

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [bots, setBots] = useState([]);
  const [threads, setThreads] = useState([]);
  const [selectedBot, setSelectedBot] = useState(null);
  const [currentThreadId, setCurrentThreadId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);

  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => { fetchBots(); fetchThreads(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const fetchBots = async () => {
    try {
      const res = await axios.get('/api/chat/bots');
      const botList = Array.isArray(res.data) ? res.data : (res.data.bots || []);
      setBots(botList);
      if (botList.length > 0 && !selectedBot) setSelectedBot(botList[0]);
    } catch (error) { console.error("Error fetching bots:", error); }
  };

  const fetchThreads = async () => {
    try { const res = await axios.get('/api/chat/threads'); setThreads(res.data); }
    catch (error) { console.error("Error fetching threads:", error); }
  };

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
      setMessages(res.data.map(msg => ({
        _id: msg._id, role: msg.role, content: msg.content,
        attachedFiles: msg.attachedFiles || [], createdAt: msg.createdAt
      })));
      const threadInfo = threads.find(t => t._id === threadId);
      if (threadInfo?.botId) {
        const threadBotId = typeof threadInfo.botId === 'object' ? threadInfo.botId._id : threadInfo.botId;
        const foundBot = bots.find(b => b._id === threadBotId);
        if (foundBot) setSelectedBot(foundBot);
      }
      if (window.innerWidth < 1024) setIsSidebarOpen(false);
    } catch (error) { console.error("Error loading thread:", error); }
    finally { setLoading(false); }
  };

  const handleNewChat = () => { setMessages([]); setCurrentThreadId(null); setSelectedFile(null); };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) return alert("Maksimal ukuran file 20MB");
      setSelectedFile(file);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if ((!input.trim() && !selectedFile) || !selectedBot || loading) return;

    setLoading(true);
    const currentInput = input;
    const currentFile = selectedFile;
    setInput('');
    setSelectedFile(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    let uploadedFileData = null;
    if (currentFile) {
      try {
        const fd = new FormData();
        fd.append('file', currentFile);
        const upRes = await axios.post('/api/chat/upload', fd, { headers: {'Content-Type': 'multipart/form-data'} });
        uploadedFileData = upRes.data;
      } catch (err) {
        setMessages(prev => [...prev, { role: 'assistant', content: "Gagal mengupload file: " + err.message }]);
        setLoading(false); return;
      }
    }

    const userMessage = {
      role: 'user', content: currentInput,
      attachedFiles: uploadedFileData ? [{
        name: uploadedFileData.originalname, path: uploadedFileData.url,
        type: uploadedFileData.mimetype?.includes('image') ? 'image' : (uploadedFileData.mimetype?.includes('pdf') ? 'pdf' : 'file'),
        size: (uploadedFileData.size / 1024).toFixed(1)
      }] : [],
      createdAt: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const payload = { message: currentInput, botId: selectedBot._id, threadId: currentThreadId, attachedFile: uploadedFileData, history: messages.map(m => ({ role: m.role, content: m.content })) };
      const res = await axios.post('/api/chat/message', payload);
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.response, attachedFiles: res.data.attachedFiles || [], createdAt: new Date().toISOString() }]);
      if (res.data.threadId) { setCurrentThreadId(res.data.threadId); fetchThreads(); } else fetchThreads();
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Maaf, terjadi kesalahan pada server AI." }]);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex h-screen bg-steel-lightest text-gray-800 font-sans overflow-hidden">

      {/* SIDEBAR */}
      <aside className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:relative z-30 w-72 h-full bg-white border-r border-steel-light/30 flex flex-col transition-transform duration-300 shadow-xl`}>
        <div className="p-5 border-b border-steel-light/30 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <img src="/assets/gys-logo.webp" alt="GYS Logo" className="h-8 w-auto object-contain" onError={(e) => { e.target.style.display = 'none'; document.getElementById('sidebar-logo-fallback').style.display = 'flex'; }} />
            <div id="sidebar-logo-fallback" className="hidden w-8 h-8 bg-primary rounded items-center justify-center font-bold text-white text-lg shadow-sm">G</div>
            <div>
              <h1 className="font-bold text-lg text-primary-dark tracking-wide">PORTAL AI</h1>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-primary-light"></div>
                <span className="text-[11px] text-primary-light font-bold">System Online</span>
              </div>
            </div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-steel-light hover:text-primary-dark">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-steel-light">
          <div>
            <h3 className="text-xs font-bold text-steel uppercase tracking-widest mb-3 px-2">Assistant</h3>
            <div className="space-y-1">
              {bots.map((bot) => (
                <button
                  key={bot._id}
                  onClick={() => handleBotSelect(bot)}
                  className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-all duration-200 border ${
                    selectedBot?._id === bot._id
                      ? 'bg-primary-dark text-white border-primary-dark shadow-md'
                      : 'bg-white border-transparent hover:bg-steel-lightest text-gray-800'
                  }`}
                >
                  {/* ✅ Ganti avatar inisial lama dengan BotAvatar */}
                  <BotAvatar
                    bot={bot}
                    size="sm"
                    className={selectedBot?._id === bot._id ? 'ring-2 ring-white ring-offset-1 ring-offset-primary-dark' : ''}
                  />
                  <div className="flex-1 truncate">
                    <div className="font-semibold text-sm truncate">{bot.name}</div>
                    <div className={`text-[11px] truncate ${selectedBot?._id === bot._id ? 'text-steel-lightest' : 'text-steel-light'}`}>{bot.description || "AI Assistant"}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold text-steel uppercase tracking-widest mb-3 px-2 mt-4">History</h3>
            <button onClick={handleNewChat} className="w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 text-primary hover:bg-primary/5 transition-colors border border-dashed border-primary mb-3 font-medium bg-white">
              <span className="text-xl font-light leading-none">+</span>
              <span className="text-sm">New Conversation</span>
            </button>
            <div className="space-y-1">
              {threads.length === 0 && <p className="text-xs text-steel-light px-3 italic">No history found.</p>}
              {threads.map((t) => (
                <button key={t._id} onClick={() => loadThread(t._id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors flex items-center gap-2 ${
                    currentThreadId === t._id
                      ? 'bg-steel-lightest text-primary-dark font-bold border-l-4 border-primary'
                      : 'text-steel hover:bg-steel-lightest hover:text-gray-800'
                  }`}
                >
                  <span className="truncate flex-1">{t.title || "Untitled Chat"}</span>
                  <span className="text-[10px] opacity-60">{new Date(t.lastMessageAt).getDate()}/{new Date(t.lastMessageAt).getMonth()+1}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-steel-light/30 bg-white space-y-3">
          {user?.isAdmin && (
            <button onClick={() => navigate('/admin')} className="w-full flex items-center justify-center gap-2 py-2.5 bg-white hover:bg-primary-dark hover:text-white text-primary-dark text-xs font-bold rounded-lg border border-steel-light/50 transition-all shadow-sm mb-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Admin Dashboard
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary-dark flex items-center justify-center text-white font-bold text-sm shadow-sm border border-steel-light/30">
              {user?.username?.substring(0,2).toUpperCase() || 'US'}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-bold text-gray-800 truncate">{user?.username || 'User'}</p>
              <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 mt-0.5 font-medium transition-colors">Sign Out</button>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CHAT */}
      <main className="flex-1 flex flex-col h-full relative bg-steel-lightest/50">
        <div className="lg:hidden h-14 border-b border-steel-light/30 flex items-center justify-between px-4 bg-white shadow-sm">
          <span className="font-bold text-primary-dark">Portal AI</span>
          <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-primary">☰</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 scrollbar-thin scrollbar-thumb-steel-light">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center pb-20">
              {/* ✅ Avatar besar di welcome screen */}
              <div className="mb-6">
                <BotAvatar bot={selectedBot} size="xl" />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">
                {selectedBot ? `Hello, I'm ${selectedBot.name}` : "Select an Agent"}
              </h2>
              <p className="text-steel max-w-md mx-auto mb-8">
                {selectedBot?.description || "Ready to assist you with operations, data, and analysis."}
              </p>
              {selectedBot && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-lg">
                  {(selectedBot.starterQuestions?.length > 0 ? selectedBot.starterQuestions : ["Apa status project?", "Cari data", "Buat laporan"]).map((txt, i) => (
                    <button key={i} onClick={() => { setInput(txt); handleSubmit({ preventDefault: ()=>{} }); }} className="p-3 bg-white hover:bg-steel-lightest border border-steel-light/30 rounded-lg text-sm text-gray-700 hover:text-primary-dark transition-all shadow-sm text-left font-medium">
                      {txt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            messages.map((msg, index) => (
              <ChatMessage key={msg._id || index} message={msg} bot={selectedBot} />
            ))
          )}

          {loading && (
            <div className="flex justify-start ml-11">
              <div className="bg-white rounded-xl px-4 py-3 flex items-center gap-2 border border-steel-light/30 shadow-sm">
                <div className="w-2 h-2 bg-steel-light rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-steel-light rounded-full animate-bounce delay-100"></div>
                <div className="w-2 h-2 bg-steel-light rounded-full animate-bounce delay-200"></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t border-steel-light/30 z-20">
          {selectedFile && (
            <div className="max-w-4xl mx-auto mb-2 flex items-center gap-2 bg-steel-lightest border border-steel-light text-primary-dark px-3 py-1.5 rounded-lg text-xs w-fit shadow-sm">
              <span>📎 {selectedFile.name}</span>
              <button onClick={() => setSelectedFile(null)} className="hover:text-red-500 ml-2 font-bold transition-colors">✕</button>
            </div>
          )}
          <div className="max-w-4xl mx-auto relative flex items-end gap-2">
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3.5 text-steel hover:text-primary-dark bg-steel-lightest hover:bg-steel-light/20 rounded-xl transition-colors border border-steel-light/30 shadow-sm" title="Upload File">📎</button>
            <div className="flex-1 relative">
              <textarea ref={textareaRef} value={input} onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; }} onKeyDown={handleKeyDown} placeholder={selectedBot ? `Message ${selectedBot.name}...` : "Select a bot first..."} disabled={!selectedBot || loading} rows={1} className="w-full bg-steel-lightest/50 border border-steel-light/30 text-gray-800 px-4 py-3.5 rounded-xl focus:ring-1 focus:ring-primary focus:border-primary placeholder-steel shadow-inner transition-all resize-none overflow-hidden focus:bg-white focus:outline-none" />
            </div>
            <button onClick={handleSubmit} disabled={(!input.trim() && !selectedFile) || !selectedBot || loading} className="p-3.5 bg-primary hover:bg-primary-dark text-white rounded-xl shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 flex-shrink-0 border border-transparent">➤</button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Chat;