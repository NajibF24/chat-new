import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ChatMessage from './ChatMessage'; // 1. Pastikan import ini ada

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

  useEffect(() => {
    fetchBots();
    fetchThreads();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        attachedFiles: msg.attachedFiles || [],
        createdAt: msg.createdAt
      }));
      setMessages(formattedMessages);
      const threadInfo = threads.find(t => t._id === threadId);
      if (threadInfo && threadInfo.botId) {
          const threadBotId = typeof threadInfo.botId === 'object' ? threadInfo.botId._id : threadInfo.botId;
          const foundBot = bots.find(b => b._id === threadBotId);
          if (foundBot) setSelectedBot(foundBot);
      }
      if (window.innerWidth < 1024) setIsSidebarOpen(false);
    } catch (error) { console.error("Error loading thread:", error); } finally { setLoading(false); }
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
            const upRes = await axios.post('/api/chat/upload', fd, { headers: {'Content-Type': 'multipart/form-data'} });
            uploadedFileData = upRes.data;
        } catch (err) {
            console.error("Upload failed:", err);
            setMessages(prev => [...prev, { role: 'assistant', content: "Gagal mengupload file: " + err.message }]);
            setLoading(false);
            return;
        }
    }

    // 2. Tambahkan User Message ke state (dengan path agar gambar langsung muncul)
    const userMessage = {
        role: 'user',
        content: currentInput,
        attachedFiles: uploadedFileData ? [{ 
            name: uploadedFileData.originalname,
            path: uploadedFileData.url, 
            type: uploadedFileData.mimetype?.includes('image') ? 'image' : (uploadedFileData.mimetype?.includes('pdf') ? 'pdf' : 'file'),
            size: (uploadedFileData.size / 1024).toFixed(1)
        }] : []
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
      
      // 3. Tambahkan Bot Message (pastikan attachedFiles dari server ikut masuk)
      const botMessage = { 
          role: 'assistant', 
          content: res.data.response,
          attachedFiles: res.data.attachedFiles || [] 
      };
      setMessages(prev => [...prev, botMessage]);

      if (res.data.threadId) {
        setCurrentThreadId(res.data.threadId);
        fetchThreads();
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Maaf, terjadi kesalahan." }]);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex h-screen bg-steel-lightest text-gray-800 font-sans overflow-hidden">
      {/* SIDEBAR (Kode tetap sama) */}
      <aside className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:relative z-30 w-72 h-full bg-white border-r border-steel-light/30 flex flex-col transition-transform duration-300 shadow-xl`}>
        <div className="p-5 border-b border-steel-light/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <img src="/assets/gys-logo.webp" alt="GYS Logo" className="h-8 w-auto" />
             <h1 className="font-bold text-lg text-primary-dark">PORTAL AI</h1>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* List Bots & History */}
          <div>
            <h3 className="text-xs font-bold text-steel uppercase mb-3 px-2">Assistant</h3>
            {bots.map(bot => (
              <button key={bot._id} onClick={() => handleBotSelect(bot)} className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 mb-1 ${selectedBot?._id === bot._id ? 'bg-primary-dark text-white' : 'hover:bg-steel-lightest'}`}>
                <div className="w-8 h-8 rounded-full bg-steel-lightest flex items-center justify-center text-xs font-bold text-primary-dark">AI</div>
                <span className="text-sm font-semibold">{bot.name}</span>
              </button>
            ))}
          </div>
          <div>
            <h3 className="text-xs font-bold text-steel uppercase mb-3 px-2">History</h3>
            <button onClick={handleNewChat} className="w-full text-left px-3 py-2 border border-dashed border-primary rounded-lg text-primary text-sm font-medium mb-3">+ New Chat</button>
            {threads.map(t => (
              <button key={t._id} onClick={() => loadThread(t._id)} className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate ${currentThreadId === t._id ? 'bg-steel-lightest text-primary-dark font-bold border-l-4 border-primary' : 'text-steel hover:bg-steel-lightest'}`}>
                {t.title || "Untitled Chat"}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 border-t bg-white">
          <div className="flex items-center gap-3">
             <div className="w-9 h-9 rounded-full bg-primary-dark text-white flex items-center justify-center font-bold">U</div>
             <div className="flex-1 truncate text-sm font-bold">{user?.username}</div>
             <button onClick={handleLogout} className="text-red-500 text-xs font-bold">Logout</button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full bg-steel-lightest/50">
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <h2 className="text-2xl font-bold">Hello, I'm {selectedBot?.name}</h2>
              <p className="text-steel">Bagaimana saya bisa membantu Anda hari ini?</p>
            </div>
          ) : (
            messages.map((msg, index) => (
              // 4. MENGGUNAKAN COMPONENT ChatMessage
              <ChatMessage 
                  key={msg._id || `${msg.role}-${msg.createdAt}-${index}`} // Gunakan ID unik jika ada
                  message={msg} 
                />
            ))
          )}
          {loading && <div className="text-xs text-steel animate-pulse">AI is thinking...</div>}
          <div ref={messagesEndRef} />
        </div>

        {/* INPUT AREA (Tetap sama) */}
        <div className="p-4 bg-white border-t border-steel-light/30">
          {selectedFile && <div className="text-xs mb-2">📎 {selectedFile.name} <button onClick={()=>setSelectedFile(null)}>✕</button></div>}
          <div className="max-w-4xl mx-auto flex items-end gap-2">
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="p-3 bg-steel-lightest rounded-xl">📎</button>
            <textarea ref={textareaRef} value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={handleKeyDown} className="flex-1 bg-steel-lightest p-3 rounded-xl outline-none resize-none" placeholder="Type a message..." rows={1} />
            <button onClick={handleSubmit} className="p-3 bg-primary text-white rounded-xl">➤</button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Chat;
