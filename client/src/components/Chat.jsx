import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const Chat = ({ user, handleLogout }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]); // Riwayat Chat
  const [bots, setBots] = useState([]);       // Daftar Bot di Sidebar
  const [selectedBot, setSelectedBot] = useState(null); // Bot yang sedang aktif
  const [currentChatId, setCurrentChatId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // Toggle Sidebar di Mobile
  const messagesEndRef = useRef(null);

  // --- 1. INITIAL LOAD (Fetch Bots & History) ---
  useEffect(() => {
    fetchBots();
    fetchHistory();
  }, []);

  // Auto-scroll ke bawah saat ada pesan baru
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // --- API CALLS ---
  const fetchBots = async () => {
    try {
      // Kita panggil endpoint untuk list bot (pastikan user punya akses)
      // Jika endpoint khusus user belum ada, kita bisa pakai admin route atau buat baru
      // Disini saya asumsi user bisa baca list bot
      const res = await axios.get('/api/admin/bots'); 
      setBots(res.data);
      
      // Set default bot jika ada
      if (res.data.length > 0 && !selectedBot) {
        setSelectedBot(res.data[0]); 
      }
    } catch (error) {
      console.error("Error fetching bots:", error);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await axios.get('/api/chat/history');
      setHistory(res.data);
    } catch (error) {
      console.error("Error fetching history:", error);
    }
  };

  // --- ACTIONS ---

  // A. Ganti Bot dari Sidebar (Start New Chat dengan Bot tertentu)
  const handleBotSelect = (bot) => {
    setSelectedBot(bot);
    setMessages([]); // Kosongkan layar chat
    setCurrentChatId(null); // Reset ID chat karena ini sesi baru
    
    // Optional: Auto mobile sidebar close
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  // B. Buka Riwayat Chat (Load Old Chat)
  const loadChat = async (chatId) => {
    try {
      setLoading(true);
      const res = await axios.get(`/api/chat/${chatId}`);
      
      // Set messages
      setMessages(res.data.messages || []);
      setCurrentChatId(chatId);
      
      // Cari bot yang sesuai dengan history ini dan set sebagai aktif
      const historyBot = bots.find(b => b._id === res.data.botId);
      if (historyBot) setSelectedBot(historyBot);
      
      if (window.innerWidth < 1024) setIsSidebarOpen(false);
    } catch (error) {
      console.error("Error loading chat:", error);
    } finally {
      setLoading(false);
    }
  };

  // C. Kirim Pesan
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || !selectedBot) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // Kirim ke backend
      const res = await axios.post('/api/chat/message', {
        message: input,
        botId: selectedBot._id,
        chatId: currentChatId 
      });

      // Tambahkan balasan bot ke UI
      const botMessage = { role: 'assistant', content: res.data.reply };
      setMessages(prev => [...prev, botMessage]);

      // Jika ini chat baru, simpan ID nya agar chat selanjutnya nyambung
      if (res.data.chatId) {
        setCurrentChatId(res.data.chatId);
        // Refresh history agar chat baru muncul di sidebar list
        if (!currentChatId) fetchHistory(); 
      }

    } catch (error) {
      console.error("Error sending message:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: "Error: Failed to connect to Neural Core." }]);
    } finally {
      setLoading(false);
    }
  };

  // D. Reset / New Chat General
  const handleNewChat = () => {
    setMessages([]);
    setCurrentChatId(null);
    // Kita tetap pertahankan selectedBot terakhir
  };

  return (
    <div className="flex h-screen bg-[#0a0f1c] text-white font-sans overflow-hidden relative">
      
      {/* BACKGROUND ACCENTS */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[30%] h-[30%] rounded-full bg-gys-navy opacity-10 blur-[100px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] rounded-full bg-cyan-900 opacity-10 blur-[100px]"></div>
      </div>

      {/* --- SIDEBAR --- */}
      <aside 
        className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:relative z-30 w-72 h-full bg-[#0d1221] border-r border-white/5 flex flex-col transition-transform duration-300 backdrop-blur-xl shadow-2xl lg:shadow-none`}
      >
        {/* Sidebar Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <img src="/assets/favicon_gys.ico" alt="Logo" className="w-8 h-8 drop-shadow-[0_0_10px_rgba(6,182,212,0.5)]"/>
             <div>
               <h1 className="font-bold tracking-wider text-lg text-white">PORTAL AI</h1>
               <div className="flex items-center gap-1">
                 <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></div>
                 <span className="text-[10px] text-cyan-500 uppercase tracking-widest">Online</span>
               </div>
             </div>
          </div>
          {/* Close Sidebar Mobile */}
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-gray-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
          
          {/* Section 1: AGENTS (BOTS) */}
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 px-2">Select Agent</h3>
            <div className="space-y-1">
              {bots.map((bot) => (
                <button
                  key={bot._id}
                  onClick={() => handleBotSelect(bot)}
                  className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-all duration-200 group ${
                    selectedBot?._id === bot._id 
                      ? 'bg-cyan-900/20 border border-cyan-500/30 text-white shadow-[0_0_15px_rgba(6,182,212,0.1)]' 
                      : 'hover:bg-white/5 text-gray-400 hover:text-white border border-transparent'
                  }`}
                >
                  {/* Bot Icon Placeholder */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                     selectedBot?._id === bot._id ? 'bg-cyan-500 text-black' : 'bg-gray-800 text-gray-400 group-hover:bg-gray-700'
                  }`}>
                    {bot.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 truncate">
                    <div className="font-medium text-sm truncate">{bot.name}</div>
                    <div className="text-[10px] opacity-60 truncate">{bot.description || "AI Assistant"}</div>
                  </div>
                  {selectedBot?._id === bot._id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Section 2: HISTORY */}
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 px-2 mt-4">History</h3>
            <div className="space-y-1">
              <button 
                 onClick={handleNewChat}
                 className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 text-cyan-400 hover:bg-cyan-900/10 hover:text-cyan-300 transition-colors border border-dashed border-cyan-900/50 hover:border-cyan-500/50 mb-2"
              >
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                 <span className="text-sm font-medium">New Conversation</span>
              </button>

              {history.length === 0 && (
                <p className="text-xs text-gray-600 px-3 italic">No recent history.</p>
              )}

              {history.map((chat) => (
                <button
                  key={chat._id}
                  onClick={() => loadChat(chat._id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors flex items-center gap-2 ${
                    currentChatId === chat._id 
                    ? 'bg-white/10 text-white' 
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}
                >
                  <svg className="w-4 h-4 opacity-50 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                  <span className="truncate">{chat.title || "Untitled Chat"}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* User Footer */}
        <div className="p-4 border-t border-white/5 bg-[#0a0f1c]/50">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gys-red to-pink-600 flex items-center justify-center text-white font-bold text-xs shadow-lg">
                {user?.username?.substring(0,2).toUpperCase() || 'US'}
             </div>
             <div className="flex-1 overflow-hidden">
               <p className="text-sm font-medium text-white truncate">{user?.username}</p>
               <button onClick={handleLogout} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors">
                 <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                 Sign Out
               </button>
             </div>
          </div>
        </div>
      </aside>

      {/* --- MAIN CHAT AREA --- */}
      <main className="flex-1 flex flex-col relative z-10 h-full">
        
        {/* Mobile Header */}
        <div className="lg:hidden h-16 border-b border-white/5 flex items-center justify-between px-4 bg-[#0d1221]/80 backdrop-blur-md">
           <div className="flex items-center gap-2">
              <img src="/assets/favicon_gys.ico" alt="Logo" className="w-6 h-6"/>
              <span className="font-bold text-white">Portal AI</span>
           </div>
           <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-cyan-500 bg-cyan-900/20 rounded-lg">
             <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
           </button>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-10 space-y-6 custom-scrollbar scroll-smooth">
          {messages.length === 0 ? (
            // EMPTY STATE (Welcome Screen)
            <div className="h-full flex flex-col items-center justify-center text-center opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
              <div className="w-20 h-20 bg-gradient-to-br from-gray-800 to-black rounded-2xl flex items-center justify-center mb-6 shadow-2xl border border-white/10 relative group">
                 <div className="absolute inset-0 bg-cyan-500/20 blur-xl group-hover:bg-cyan-500/30 transition-all duration-500 rounded-2xl"></div>
                 <span className="text-3xl font-bold text-cyan-400">{selectedBot?.name?.substring(0,1) || "A"}</span>
              </div>
              <h2 className="text-3xl font-bold text-white mb-2">
                {selectedBot ? `Connected to ${selectedBot.name}` : "Select an Agent"}
              </h2>
              <p className="text-gray-400 max-w-md mx-auto mb-8">
                {selectedBot?.description || "Choose an AI agent from the sidebar to begin your session."}
              </p>
              
              {/* Quick Prompts (Contoh) */}
              {selectedBot && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
                   {["Analyze current data", "Draft a report", "Search knowledge base", "System status check"].map((txt, i) => (
                     <button 
                       key={i} 
                       onClick={() => setInput(txt)}
                       className="p-4 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-cyan-500/30 rounded-xl text-left text-sm text-gray-300 hover:text-cyan-400 transition-all duration-200"
                     >
                       {txt}
                     </button>
                   ))}
                </div>
              )}
            </div>
          ) : (
            // MESSAGE LIST
            messages.map((msg, index) => (
              <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] lg:max-w-[70%] rounded-2xl p-4 lg:p-6 shadow-lg relative overflow-hidden ${
                  msg.role === 'user' 
                    ? 'bg-gradient-to-r from-cyan-700 to-blue-700 text-white rounded-tr-sm' 
                    : 'bg-[#1a2035] border border-white/5 text-gray-200 rounded-tl-sm'
                }`}>
                  {/* Glowing line for AI messages */}
                  {msg.role === 'assistant' && (
                     <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500/50"></div>
                  )}
                  
                  {/* Markdown or Plain Text */}
                  <div className="prose prose-invert max-w-none text-sm lg:text-base leading-relaxed whitespace-pre-wrap font-light">
                    {msg.content}
                  </div>
                  
                  {/* Timestamp / Role Label */}
                  <div className={`text-[10px] mt-2 font-mono uppercase tracking-widest opacity-40 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                    {msg.role === 'user' ? 'You' : selectedBot?.name || 'System'}
                  </div>
                </div>
              </div>
            ))
          )}
          {loading && (
             <div className="flex justify-start">
               <div className="bg-[#1a2035] border border-white/5 rounded-2xl rounded-tl-sm p-4 flex items-center gap-2">
                 <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce"></div>
                 <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce delay-100"></div>
                 <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce delay-200"></div>
               </div>
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 lg:p-6 bg-[#0a0f1c]/80 backdrop-blur-lg border-t border-white/5 relative z-20">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl opacity-20 group-focus-within:opacity-100 transition duration-500 blur"></div>
            <div className="relative flex bg-[#0d1221] rounded-xl overflow-hidden shadow-2xl">
               <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={selectedBot ? `Ask ${selectedBot.name} anything...` : "Select a bot to start..."}
                disabled={!selectedBot || loading}
                className="flex-1 bg-transparent border-none text-white px-6 py-4 focus:ring-0 focus:outline-none placeholder-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={!input.trim() || !selectedBot || loading}
                className="px-6 text-cyan-500 hover:text-white hover:bg-cyan-600 transition-all duration-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-cyan-500"
              >
                <svg className="w-6 h-6 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            {!selectedBot && (
               <div className="absolute -top-10 left-0 text-red-400 text-xs animate-pulse">
                 * Please select an agent from the sidebar first
               </div>
            )}
          </form>
          <div className="text-center mt-3">
             <p className="text-[10px] text-gray-600 font-mono">
               AI System can make mistakes. Verify important information. Restricted Access GYS.
             </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Chat;