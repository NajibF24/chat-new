import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ChatMessage from './ChatMessage';
import ArtifactPanel from './ArtifactPanel';
import BotAvatar from './BotAvatar';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const ARTIFACT_LANGS = ['html', 'htm', 'react', 'jsx', 'tsx', 'svg', 'python', 'py', 'javascript', 'js', 'ts', 'typescript', 'css'];
const ARTIFACT_MIN_LINES = 5;
const PANEL_MIN_WIDTH = 400;
const PANEL_MAX_WIDTH = 900;
const PANEL_DEFAULT = 540;
const MAX_THREADS_SHOWN = 15;

function extractCodeBlocks(markdown = '') {
  const blocks = [];
  const regex = /```([^\n]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = regex.exec(markdown)) !== null) {
    const lang = m[1].trim().toLowerCase();
    const code = m[2].trimEnd();
    if (code.split('\n').length >= ARTIFACT_MIN_LINES) blocks.push({ lang, code });
  }
  return blocks;
}

function detectArtifactType(lang, code) {
  if (['html', 'htm'].includes(lang)) return 'html';
  if (['react', 'jsx', 'tsx'].includes(lang)) return 'react';
  if (['svg'].includes(lang)) return 'svg';
  if (['python', 'py'].includes(lang)) return 'python';
  if (['js', 'javascript', 'ts', 'typescript'].includes(lang)) return 'javascript';
  if (['css'].includes(lang)) return 'css';
  if (['sql'].includes(lang)) return 'sql';
  if (!lang && (code.includes('<!DOCTYPE') || code.includes('<html'))) return 'html';
  if (!lang && (code.includes('import React') || code.includes('export default'))) return 'react';
  return 'code';
}

function pickBestArtifact(blocks) {
  if (!blocks.length) return null;
  const priority = ARTIFACT_LANGS;
  const scored = blocks.map(b => ({ ...b, score: priority.indexOf(b.lang) === -1 ? 99 : priority.indexOf(b.lang) }));
  return scored.sort((a, b) => a.score - b.score)[0];
}

function generateTitle(lang, code) {
  const type = detectArtifactType(lang, code);
  const nameMatch = code.match(/(?:function|class|const)\s+([A-Z][a-zA-Z0-9]+)/);
  if (nameMatch) return nameMatch[1];
  const htmlTitle = code.match(/<title>([^<]+)<\/title>/i);
  if (htmlTitle) return htmlTitle[1];
  const map = { html: 'HTML App', react: 'React Component', svg: 'SVG Graphic', python: 'Python Script', javascript: 'JavaScript', css: 'CSS Styles', sql: 'SQL Query' };
  return map[type] || 'Code Artifact';
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
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
  
  // Delete state
  const [deletingThreadId, setDeletingThreadId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showAllThreads, setShowAllThreads] = useState(false);
  // Artifact panel
  const [artifact, setArtifact] = useState(null);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  const fileInputRef   = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef    = useRef(null);

  useEffect(() => { fetchBots(); fetchThreads(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Drag resize
  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      const delta = dragStartX.current - x;
      setPanelWidth(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, dragStartW.current + delta)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  const startDrag = (e) => {
    isDragging.current = true;
    dragStartX.current = e.clientX ?? e.touches?.[0].clientX;
    dragStartW.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const openArtifact = useCallback((lang, code, title) => {
    setArtifact({ lang, code, title: title || generateTitle(lang, code) });
  }, []);
  const closeArtifact = useCallback(() => setArtifact(null), []);
  const parseAndOpenArtifact = useCallback((content = '') => {
    const blocks = extractCodeBlocks(content);
    const best = pickBestArtifact(blocks);
    if (best) openArtifact(best.lang, best.code);
  }, [openArtifact]);

  // ── API ──────────────────────────────────────────────────────
  const fetchBots = async () => {
    try {
      const res = await axios.get('/api/chat/bots');
      const botList = Array.isArray(res.data) ? res.data : (res.data.bots || []);
      setBots(botList);
      if (botList.length > 0 && !selectedBot) setSelectedBot(botList[0]);
    } catch (error) { console.error('Error fetching bots:', error); }
  };

  const fetchThreads = async () => {
    try { const res = await axios.get('/api/chat/threads'); setThreads(res.data); }
    catch (error) { console.error('Error fetching threads:', error); }
  };

  const handleBotSelect = (bot) => {
    setSelectedBot(bot);
    setMessages([]);
    setCurrentThreadId(null);
    setSelectedFile(null);
    closeArtifact();
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const loadThread = async (threadId) => {
    try {
      setLoading(true);
      setCurrentThreadId(threadId);
      setSelectedFile(null);
      closeArtifact();
      const res = await axios.get(`/api/chat/thread/${threadId}`);
      const msgs = res.data.map(msg => ({
        _id: msg._id, role: msg.role, content: msg.content,
        attachedFiles: msg.attachedFiles || [], createdAt: msg.createdAt
      }));
      setMessages(msgs);
      const lastAI = [...msgs].reverse().find(m => m.role === 'assistant');
      if (lastAI) parseAndOpenArtifact(lastAI.content);
      const threadInfo = threads.find(t => t._id === threadId);
      if (threadInfo?.botId) {
        const threadBotId = typeof threadInfo.botId === 'object' ? threadInfo.botId._id : threadInfo.botId;
        const foundBot = bots.find(b => b._id === threadBotId);
        if (foundBot) setSelectedBot(foundBot);
      }
      if (window.innerWidth < 1024) setIsSidebarOpen(false);
    } catch (error) { console.error('Error loading thread:', error); }
    finally { setLoading(false); }
  };

  const handleNewChat = () => {
    setMessages([]);
    setCurrentThreadId(null);
    setSelectedFile(null);
    closeArtifact();
  };

  // ── Delete Thread ─────────────────────────────────────────────
  // NOTE: This ONLY deletes the Thread document and Chat messages from the user's view.
  // The Chat messages are already logged and remain accessible via Admin Dashboard chat logs.
  // Admin sees all messages via /api/admin/chat-logs which queries Chat collection directly.
  const handleDeleteThread = async (threadId, e) => {
    e.stopPropagation();
    if (confirmDeleteId === threadId) {
      // Second click = confirmed
      setDeletingThreadId(threadId);
      try {
        await axios.delete(`/api/chat/thread/${threadId}`);
        setThreads(prev => prev.filter(t => t._id !== threadId));
        if (currentThreadId === threadId) {
          setMessages([]);
          setCurrentThreadId(null);
          closeArtifact();
        }
      } catch (err) {
        console.error('Delete thread error:', err);
      } finally {
        setDeletingThreadId(null);
        setConfirmDeleteId(null);
      }
    } else {
      setConfirmDeleteId(threadId);
      setTimeout(() => setConfirmDeleteId(c => c === threadId ? null : c), 3000);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) return alert('Maksimal ukuran file 20MB');
      setSelectedFile(file);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
    if (e.key === 'Escape') setConfirmDeleteId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if ((!input.trim() && !selectedFile) || !selectedBot || loading) return;

    setLoading(true);
    const currentInput = input;
    const currentFile  = selectedFile;
    setInput('');
    setSelectedFile(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    let uploadedFileData = null;
    if (currentFile) {
      try {
        const fd = new FormData();
        fd.append('file', currentFile);
        const upRes = await axios.post('/api/chat/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        uploadedFileData = upRes.data;
      } catch (err) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Gagal mengupload file: ' + err.message }]);
        setLoading(false);
        return;
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
      const payload = {
        message: currentInput, botId: selectedBot._id, threadId: currentThreadId,
        attachedFile: uploadedFileData,
        history: messages.map(m => ({ role: m.role, content: m.content }))
      };
      const res = await axios.post('/api/chat/message', payload);
      const aiContent = res.data.response;
      setMessages(prev => [...prev, {
        role: 'assistant', content: aiContent,
        attachedFiles: res.data.attachedFiles || [],
        createdAt: new Date().toISOString()
      }]);
      parseAndOpenArtifact(aiContent);
      if (res.data.threadId) { setCurrentThreadId(res.data.threadId); fetchThreads(); }
      else fetchThreads();
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Maaf, terjadi kesalahan pada server AI.' }]);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const visibleThreads = showAllThreads ? threads : threads.slice(0, MAX_THREADS_SHOWN);

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-steel-lightest text-gray-800 font-sans overflow-hidden">

      {/* ════════════════════════════
          SIDEBAR
      ════════════════════════════ */}
      <aside className={`
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 fixed lg:relative z-30
        w-72 xl:w-80 2xl:w-88 h-full
        bg-white border-r border-steel-light/30
        flex flex-col transition-transform duration-300 shadow-xl lg:shadow-none
      `}>
        {/* Header */}
        <div className="px-4 xl:px-5 py-3 xl:py-4 border-b border-steel-light/30 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2.5 xl:gap-3">
            <img src="/assets/gys-logo.webp" alt="GYS Logo"
              className="h-7 xl:h-9 w-auto object-contain"
              onError={e => { e.target.style.display = 'none'; document.getElementById('sidebar-logo-fallback').style.display = 'flex'; }} />
            <div id="sidebar-logo-fallback"
              className="hidden w-8 h-8 bg-primary rounded items-center justify-center font-bold text-white text-base shadow-sm">G</div>
            <div>
              <h1 className="font-bold text-sm xl:text-base 2xl:text-lg text-primary-dark tracking-wide leading-tight">PORTAL AI</h1>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary-light animate-pulse"></div>
                <span className="text-[10px] xl:text-[11px] text-primary-light font-bold">System Online</span>
              </div>
            </div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden text-steel-light hover:text-primary-dark p-1 rounded">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 xl:px-4 py-3 xl:py-4 space-y-4 xl:space-y-5 scrollbar-thin scrollbar-thumb-steel-light">
          {/* Bots section */}
          <div>
            <h3 className="text-[10px] xl:text-xs font-bold text-steel uppercase tracking-widest mb-2 xl:mb-3 px-1">
              Assistant
            </h3>
            <div className="space-y-1">
              {bots.map(bot => (
                <button key={bot._id} onClick={() => handleBotSelect(bot)}
                  className={`w-full text-left px-2.5 xl:px-3 py-2 xl:py-2.5 rounded-lg flex items-center gap-2.5 xl:gap-3 transition-all duration-200 border ${
                    selectedBot?._id === bot._id
                      ? 'bg-primary-dark text-white border-primary-dark shadow-md'
                      : 'bg-white border-transparent hover:bg-steel-lightest text-gray-800'
                  }`}>
                  <BotAvatar bot={bot} size="sm"
                    className={selectedBot?._id === bot._id ? 'ring-2 ring-white ring-offset-1 ring-offset-primary-dark' : ''} />
                  <div className="flex-1 truncate">
                    <div className="font-semibold text-xs xl:text-sm truncate">{bot.name}</div>
                    <div className={`text-[10px] xl:text-[11px] truncate ${selectedBot?._id === bot._id ? 'text-white/70' : 'text-steel-light'}`}>
                      {bot.description || 'AI Assistant'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* History section */}
          <div>
            <div className="flex items-center justify-between px-1 mb-2 xl:mb-3">
              <h3 className="text-[10px] xl:text-xs font-bold text-steel uppercase tracking-widest">
                History
              </h3>
              <span className="text-[10px] xl:text-xs text-steel-light">
                {threads.length > MAX_THREADS_SHOWN
                  ? `${MAX_THREADS_SHOWN}/${threads.length}`
                  : `${threads.length}`}
              </span>
            </div>

            {/* New chat button */}
            <button onClick={handleNewChat}
              className="w-full text-left px-2.5 xl:px-3 py-2 xl:py-2.5 rounded-lg flex items-center gap-2 xl:gap-3 text-primary hover:bg-primary/5 transition-colors border border-dashed border-primary/40 mb-2 font-medium bg-white">
              <span className="text-lg font-light leading-none">+</span>
              <span className="text-xs xl:text-sm">New Conversation</span>
            </button>

            {/* Thread list */}
            <div className="space-y-0.5">
              {visibleThreads.length === 0 && (
                <p className="text-xs text-steel-light px-2 italic py-2">No history found.</p>
              )}
              {visibleThreads.map(t => (
                <div key={t._id}
                  className={`group relative flex items-center rounded-lg transition-colors cursor-pointer ${
                    currentThreadId === t._id
                      ? 'bg-steel-lightest border-l-4 border-primary'
                      : 'hover:bg-steel-lightest/70'
                  }`}
                >
                  {/* Thread title */}
                  <button
                    onClick={() => loadThread(t._id)}
                    className="flex-1 min-w-0 text-left px-2.5 xl:px-3 py-1.5 xl:py-2"
                  >
                    <span className={`block text-xs xl:text-sm truncate font-medium ${currentThreadId === t._id ? 'text-primary-dark' : 'text-steel'} group-hover:text-gray-800`}>
                      {t.title || 'Untitled Chat'}
                    </span>
                    <span className="text-[9px] xl:text-[10px] text-steel-light/70 mt-0.5 block">
                      {new Date(t.lastMessageAt).toLocaleDateString('id-ID', { day:'2-digit', month:'short' })}
                    </span>
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDeleteThread(t._id, e)}
                    disabled={deletingThreadId === t._id}
                    title={confirmDeleteId === t._id ? 'Klik lagi untuk konfirmasi' : 'Hapus percakapan ini'}
                    className={`
                      flex-shrink-0 mr-1.5 w-6 h-6 xl:w-7 xl:h-7 rounded-md flex items-center justify-center text-xs
                      transition-all duration-150 select-none
                      opacity-0 group-hover:opacity-100
                      ${confirmDeleteId === t._id
                        ? 'bg-red-500 text-white opacity-100 scale-110 shadow-sm'
                        : 'text-steel-light hover:text-red-500 hover:bg-red-50'
                      }
                      ${deletingThreadId === t._id ? 'opacity-40 cursor-not-allowed' : ''}
                    `}
                  >
                    {deletingThreadId === t._id
                      ? <span className="text-[8px] animate-spin">⟳</span>
                      : confirmDeleteId === t._id
                      ? <span className="text-[9px] font-black">✓</span>
                      : <span className="text-[11px]">🗑</span>
                    }
                  </button>
                </div>
              ))}

              {threads.length > MAX_THREADS_SHOWN && (
                <button 
                  onClick={() => setShowAllThreads(!showAllThreads)}
                  className="w-full text-center px-3 py-2.5 mt-2 rounded-lg text-xs font-semibold text-primary hover:bg-primary/10 transition-colors border border-dashed border-transparent hover:border-primary/30"
                >
                  {showAllThreads 
                    ? 'Tampilkan Lebih Sedikit' 
                    : `Lihat Semua Percakapan (${threads.length})`}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar footer */}
        <div className="px-3 xl:px-4 py-3 xl:py-4 border-t border-steel-light/30 bg-white space-y-2 xl:space-y-3">
          {user?.isAdmin && (
            <button onClick={() => navigate('/admin')}
              className="w-full flex items-center justify-center gap-2 py-2 xl:py-2.5 bg-white hover:bg-primary-dark hover:text-white text-primary-dark text-xs xl:text-sm font-bold rounded-lg border border-steel-light/50 transition-all shadow-sm">
              <svg className="w-3.5 h-3.5 xl:w-4 xl:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Admin Dashboard
            </button>
          )}
          <div className="flex items-center gap-2.5 xl:gap-3">
            <div className="w-8 h-8 xl:w-9 xl:h-9 rounded-full bg-primary-dark flex items-center justify-center text-white font-bold text-xs xl:text-sm shadow-sm border border-steel-light/30">
              {user?.username?.substring(0, 2).toUpperCase() || 'US'}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-xs xl:text-sm font-bold text-gray-800 truncate">{user?.username || 'User'}</p>
              <button onClick={handleLogout}
                className="text-[10px] xl:text-xs text-red-500 hover:text-red-700 flex items-center gap-1 mt-0.5 font-medium transition-colors">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ════════════════════════════
          MAIN CHAT + ARTIFACT
      ════════════════════════════ */}
      <div className="flex-1 flex min-w-0 overflow-hidden">

        {/* Chat column */}
        <main className="flex-1 flex flex-col h-full relative bg-steel-lightest/40 min-w-0">

          {/* Mobile topbar */}
          <div className="lg:hidden h-12 border-b border-steel-light/30 flex items-center justify-between px-4 bg-white shadow-sm flex-shrink-0">
            <span className="font-bold text-sm text-primary-dark">Portal AI</span>
            <div className="flex items-center gap-2">
              {artifact && (
                <button onClick={closeArtifact}
                  className="flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold rounded-lg">
                  ⊞ Panel
                </button>
              )}
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-primary text-lg">☰</button>
            </div>
          </div>

          {/* Desktop: artifact toggle */}
          {artifact && (
            <div className="hidden lg:flex items-center justify-end px-4 xl:px-6 py-2 bg-white border-b border-steel-light/20 flex-shrink-0">
              <button onClick={closeArtifact}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-600 text-xs xl:text-sm font-bold rounded-xl hover:bg-blue-100 transition-colors">
                <span>⊞</span> Close Panel
              </button>
            </div>
          )}

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-8 lg:py-6 xl:px-12 xl:py-8 space-y-4 xl:space-y-6 scrollbar-thin scrollbar-thumb-steel-light">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center pb-16 xl:pb-24">
                <div className="mb-5 xl:mb-7">
                  <BotAvatar bot={selectedBot} size="xl" />
                </div>
                <h2 className="text-xl xl:text-3xl 2xl:text-4xl font-bold text-gray-800 mb-2 xl:mb-3">
                  {selectedBot ? `Hello, I'm ${selectedBot.name}` : 'Select an Agent'}
                </h2>
                <p className="text-sm xl:text-base 2xl:text-lg text-steel max-w-md xl:max-w-lg mx-auto mb-6 xl:mb-10 leading-relaxed">
                  {selectedBot?.description || 'Ready to assist you with operations, data, and analysis.'}
                </p>
                {selectedBot && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 xl:gap-3 w-full max-w-lg xl:max-w-2xl">
                    {(selectedBot.starterQuestions?.length > 0 ? selectedBot.starterQuestions : ['Apa status project?', 'Cari data', 'Buat laporan']).map((txt, i) => (
                      <button key={i}
                        onClick={() => { setInput(txt); setTimeout(() => handleSubmit({ preventDefault: () => {} }), 0); }}
                        className="p-3 xl:p-4 bg-white hover:bg-steel-lightest border border-steel-light/30 rounded-xl text-sm xl:text-base text-gray-700 hover:text-primary-dark transition-all shadow-sm text-left font-medium hover:border-primary/30 hover:shadow-md">
                        <span className="block">{txt}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              messages.map((msg, index) => (
                <ChatMessage
                  key={msg._id || index}
                  message={msg}
                  bot={selectedBot}
                  onOpenArtifact={openArtifact}
                />
              ))
            )}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-3 ml-2">
                  <BotAvatar bot={selectedBot} size="sm" />
                  <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 border border-steel-light/30 shadow-sm">
                    <div className="w-2 h-2 bg-steel-light rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-steel-light rounded-full animate-bounce" style={{animationDelay:'0.1s'}}></div>
                    <div className="w-2 h-2 bg-steel-light rounded-full animate-bounce" style={{animationDelay:'0.2s'}}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 xl:px-6 xl:py-4 bg-white border-t border-steel-light/30 z-20 flex-shrink-0">
            {selectedFile && (
              <div className="max-w-4xl xl:max-w-5xl 2xl:max-w-6xl mx-auto mb-2 flex items-center gap-2 bg-steel-lightest border border-steel-light text-primary-dark px-3 py-1.5 rounded-lg text-xs w-fit">
                <span>📎 {selectedFile.name}</span>
                <button onClick={() => setSelectedFile(null)} className="hover:text-red-500 ml-1 font-bold">✕</button>
              </div>
            )}
            <div className="max-w-4xl xl:max-w-5xl 2xl:max-w-6xl mx-auto flex items-end gap-2 xl:gap-3">
              <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="p-3 xl:p-3.5 text-steel hover:text-primary-dark bg-steel-lightest hover:bg-steel-light/20 rounded-xl transition-colors border border-steel-light/30 shadow-sm text-sm xl:text-base flex-shrink-0"
                title="Upload File">📎</button>
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`; }}
                  onKeyDown={handleKeyDown}
                  placeholder={selectedBot ? `Message ${selectedBot.name}...` : 'Select a bot first...'}
                  disabled={!selectedBot || loading}
                  rows={1}
                  className="w-full bg-steel-lightest/50 border border-steel-light/30 text-gray-800 text-sm xl:text-base px-4 xl:px-5 py-3 xl:py-3.5 rounded-xl focus:ring-1 focus:ring-primary focus:border-primary placeholder-steel shadow-inner transition-all resize-none overflow-hidden focus:bg-white focus:outline-none"
                />
              </div>
              <button onClick={handleSubmit}
                disabled={(!input.trim() && !selectedFile) || !selectedBot || loading}
                className="p-3 xl:p-3.5 bg-primary hover:bg-primary-dark text-white rounded-xl shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 flex-shrink-0 text-sm xl:text-base">
                ➤
              </button>
            </div>
          </div>
        </main>

        {/* Artifact Panel */}
        {artifact && (
          <>
            <div
              onMouseDown={startDrag}
              onTouchStart={startDrag}
              className="w-1 flex-shrink-0 bg-gray-200 hover:bg-primary/40 cursor-col-resize transition-colors"
            />
            <div style={{ width: panelWidth, minWidth: PANEL_MIN_WIDTH }} className="flex-shrink-0 overflow-hidden">
              <ArtifactPanel artifact={artifact} onClose={closeArtifact} />
            </div>
          </>
        )}
      </div>

      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/30 z-20" onClick={() => setIsSidebarOpen(false)} />
      )}
    </div>
  );
};

export default Chat;
