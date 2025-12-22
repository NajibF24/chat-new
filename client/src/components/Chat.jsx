import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ChatMessage from './ChatMessage';

function Chat({ user, handleLogout }) {
  const navigate = useNavigate();
  
  // --- STATE DATA ---
  const [bots, setBots] = useState([]);
  const [threads, setThreads] = useState([]); // Untuk Sidebar History
  
  // --- STATE SELECTION ---
  const [selectedBot, setSelectedBot] = useState(null);
  const [activeThreadId, setActiveThreadId] = useState(null);
  
  // --- STATE UI ---
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // --- STATE FILE ---
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null); // Ref untuk auto-resize textarea

  // --- INITIAL LOAD ---
  useEffect(() => { 
      fetchBots(); 
      fetchThreads(); 
  }, []);

  // --- EFFECT: LOAD MESSAGES SAAT PILIH THREAD ---
  useEffect(() => {
      if (activeThreadId) {
          fetchThreadMessages(activeThreadId);
      } else {
          // New Chat Mode
          setMessages([]);
          // Default pilih bot pertama jika belum ada yang dipilih
          if (!selectedBot && bots.length > 0) setSelectedBot(bots[0]);
      }
  }, [activeThreadId]);

  // --- EFFECT: AUTO SCROLL ---
  useEffect(() => { 
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [messages]);

  // ================= API CALLS =================

  const fetchBots = async () => {
    try {
      const res = await axios.get('/api/chat/bots');
      const list = Array.isArray(res.data) ? res.data : (res.data.bots || []);
      setBots(list);
      if (list.length > 0 && !selectedBot) setSelectedBot(list[0]);
    } catch (error) { console.error('Error fetching bots:', error); }
  };

  const fetchThreads = async () => {
      try {
          const res = await axios.get('/api/chat/threads');
          setThreads(res.data);
      } catch (error) { console.error('Error fetching threads:', error); }
  };

  const fetchThreadMessages = async (threadId) => {
      try {
          const res = await axios.get(`/api/chat/thread/${threadId}`);
          setMessages(res.data);
          
          // Sinkronisasi Bot: Saat buka history, pastikan Bot yang aktif sesuai dengan history tersebut
          const currentThread = threads.find(t => t._id === threadId);
          if (currentThread && currentThread.botId) {
              const botId = typeof currentThread.botId === 'object' ? currentThread.botId._id : currentThread.botId;
              const savedBot = bots.find(b => b._id === botId);
              if (savedBot) setSelectedBot(savedBot);
          }
      } catch (error) { console.error('Error messages:', error); }
  };

  // ================= ACTIONS =================

  const handleNewChat = () => {
      setActiveThreadId(null);
      setMessages([]);
      setSelectedFile(null);
      // Reset ke bot default atau tetap di bot terakhir
      if (bots.length > 0) setSelectedBot(bots[0]);
  };

  const deleteThread = async (e, threadId) => {
      e.stopPropagation();
      if(!window.confirm("Hapus percakapan ini?")) return;
      try {
          await axios.delete(`/api/chat/thread/${threadId}`);
          fetchThreads();
          if (activeThreadId === threadId) handleNewChat();
      } catch (e) { console.error(e); }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
        if(file.size > 20 * 1024 * 1024) return alert("File max 20MB");
        setSelectedFile(file);
    }
  };

  const handleSendMessage = async (e, msgOverride = null) => {
    if (e) e.preventDefault();
    
    const txt = msgOverride || inputMessage.trim();
    if ((!txt && !selectedFile) || !selectedBot || loading) return;

    setInputMessage('');
    setSelectedFile(null);
    setLoading(true);
    if(textareaRef.current) textareaRef.current.style.height = 'auto'; // Reset height

    try {
        let fileData = null;
        if (selectedFile) {
            const fd = new FormData();
            fd.append('file', selectedFile);
            const upRes = await axios.post('/api/chat/upload', fd, { headers: {'Content-Type': 'multipart/form-data'} });
            fileData = upRes.data;
        }

        // Optimistic UI
        const newMsg = {
            role: 'user', content: txt, createdAt: new Date(),
            attachedFiles: fileData ? [{ name: fileData.originalname, path: fileData.url, type: 'file', size: (fileData.size/1024).toFixed(1) }] : []
        };
        setMessages(prev => [...prev, newMsg]);

        // API Call
        const payload = {
            botId: selectedBot._id,
            message: txt,
            attachedFile: fileData,
            threadId: activeThreadId,
            history: messages.map(m => ({ role: m.role, content: m.content }))
        };

        const res = await axios.post('/api/chat/message', payload);

        // Handle Response
        if (!activeThreadId && res.data.threadId) {
            setActiveThreadId(res.data.threadId);
            fetchThreads(); // Refresh sidebar agar thread baru muncul
        } else {
            fetchThreads(); // Update timestamp
        }

        setMessages(prev => [...prev, {
            role: 'assistant',
            content: res.data.response,
            createdAt: new Date(),
            attachedFiles: res.data.attachedFiles || []
        }]);

    } catch (error) {
        console.error(error);
        alert("Gagal mengirim pesan: " + error.message);
    } finally {
        setLoading(false);
        if(fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      
      {/* ================= SIDEBAR HISTORY (RESTORED) ================= */}
      <div className={`${sidebarOpen ? 'w-80' : 'w-0'} bg-gray-900 flex flex-col transition-all duration-300 shadow-xl overflow-hidden border-r border-gray-800`}>
        
        {/* Header User */}
        <div className="p-4 bg-gray-900 border-b border-gray-800 flex items-center space-x-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-green-400 to-blue-500 flex items-center justify-center text-white font-bold text-sm">
                {user.username.charAt(0).toUpperCase()}
            </div>
            <div className="text-white overflow-hidden">
                <div className="font-semibold text-sm truncate">{user.username}</div>
                <div className="text-xs text-gray-400">GYS Portal AI</div>
            </div>
        </div>

        {/* New Chat Button */}
        <div className="p-3">
            <button onClick={handleNewChat} className="w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-500 text-white rounded-lg flex items-center justify-center space-x-2 transition-all shadow-lg border border-primary-500/30">
                <span className="text-xl font-light">+</span>
                <span className="text-sm font-medium">New Chat</span>
            </button>
        </div>

        {/* List Threads */}
        <div className="flex-1 overflow-y-auto px-2 space-y-1 scrollbar-thin scrollbar-thumb-gray-700">
            <div className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Recent History</div>
            
            {threads.length === 0 && <div className="text-gray-600 text-xs text-center py-4">Belum ada riwayat chat.</div>}

            {threads.map(t => (
                <div key={t._id} onClick={() => setActiveThreadId(t._id)} 
                    className={`group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all ${activeThreadId === t._id ? 'bg-gray-800 text-white border border-gray-700' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}>
                    <div className="flex flex-col overflow-hidden w-full">
                        <span className="truncate text-sm">{t.title || 'New Conversation'}</span>
                        <div className="flex justify-between items-center mt-1">
                            <span className="text-[10px] bg-gray-700 px-1.5 rounded text-gray-300 truncate max-w-[80px]">{t.botId?.name || 'Bot'}</span>
                            <span className="text-[9px] opacity-50">{new Date(t.lastMessageAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                    <button onClick={(e) => deleteThread(e, t._id)} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 p-1">✕</button>
                </div>
            ))}
        </div>

        {/* Footer */}
        <div className="p-3 bg-gray-900 border-t border-gray-800 space-y-1">
            {user.isAdmin && <button onClick={() => navigate('/admin')} className="w-full py-2 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded text-left px-3">⚙️ Admin Dashboard</button>}
            <button onClick={handleLogout} className="w-full py-2 text-xs text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded text-left px-3">🚪 Sign Out</button>
        </div>
      </div>

      {/* ================= MAIN AREA ================= */}
      <div className="flex-1 flex flex-col h-full bg-white relative">
        
        {/* Top Bar (Bot Selector) */}
        <div className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white/90 backdrop-blur sticky top-0 z-20">
            <div className="flex items-center space-x-4">
                <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-500 hover:text-gray-800"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg></button>
                
                {/* Logic Judul: Kalau New Chat -> Dropdown, Kalau History -> Teks Statis */}
                {!activeThreadId ? (
                    <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-500">Assistant:</span>
                        <select 
                            value={selectedBot?._id || ''} 
                            onChange={e => setSelectedBot(bots.find(b => b._id === e.target.value))}
                            className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block p-2 font-bold cursor-pointer min-w-[200px]"
                        >
                            {bots.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                        </select>
                    </div>
                ) : (
                    <div className="flex flex-col">
                        <h2 className="font-bold text-gray-800">{selectedBot?.name}</h2>
                        <span className="text-[10px] text-gray-500 bg-gray-100 px-2 rounded-full w-fit">History Mode</span>
                    </div>
                )}
            </div>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            {messages.length === 0 ? (
                // ✅ TAMPILAN NEW CHAT (STARTER QUESTIONS)
                <div className="h-full flex flex-col items-center justify-center text-center pb-20">
                    <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4 text-4xl">🤖</div>
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">Hello, {user.displayName || user.username}</h2>
                    <p className="text-gray-500 max-w-md mb-8">Saya {selectedBot?.name}. Ada yang bisa saya bantu?</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
                        {(selectedBot?.starterQuestions?.length > 0 ? selectedBot.starterQuestions : ["Apa yang bisa kamu lakukan?", "Buatkan ringkasan"]).map((q, i) => (
                            <button key={i} onClick={(e) => handleSendMessage(e, q)} className="p-4 bg-white border border-gray-200 rounded-xl hover:border-primary-500 hover:shadow-md transition-all text-sm text-gray-600 hover:text-primary-700 text-left">
                                "{q}"
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                // ✅ TAMPILAN CHAT AKTIF
                <div className="max-w-4xl mx-auto pb-4">
                    {messages.map((msg, i) => <ChatMessage key={i} message={msg} />)}
                    {loading && <div className="text-xs text-gray-400 animate-pulse ml-14">Thinking...</div>}
                    <div ref={messagesEndRef} />
                </div>
            )}
        </div>

        {/* Input Area (Textarea + Shift Enter) */}
        <div className="p-4 bg-white border-t border-gray-200">
            {selectedFile && (
                <div className="max-w-4xl mx-auto mb-2 flex items-center space-x-2 bg-primary-50 text-primary-700 px-3 py-1 rounded text-xs w-fit">
                    <span>📎 {selectedFile.name}</span>
                    <button onClick={() => setSelectedFile(null)} className="text-red-500 font-bold ml-2">✕</button>
                </div>
            )}
            
            <form className="max-w-4xl mx-auto flex items-end space-x-2">
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 text-gray-400 hover:text-primary-600 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors border border-gray-200">📎</button>
                
                <textarea 
                    ref={textareaRef}
                    value={inputMessage}
                    onChange={e => { setInputMessage(e.target.value); e.target.style.height='auto'; e.target.style.height=`${e.target.scrollHeight}px`; }}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message ${selectedBot?.name || 'Assistant'}...`}
                    rows={1}
                    className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-xl focus:ring-primary-500 focus:border-primary-500 block p-3 resize-none max-h-32 scrollbar-thin"
                    disabled={loading || !selectedBot}
                />
                
                <button 
                    onClick={handleSendMessage} 
                    disabled={loading || (!inputMessage.trim() && !selectedFile)}
                    className="p-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl shadow-md disabled:opacity-50 disabled:shadow-none transition-all"
                >
                    {loading ? '...' : '➤'}
                </button>
            </form>
            <div className="text-center mt-2">
                <span className="text-[10px] text-gray-400">Press <strong>Shift + Enter</strong> for new line. <strong>Enter</strong> to send.</span>
            </div>
        </div>

      </div>
    </div>
  );
}

export default Chat;
