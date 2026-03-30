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

  const [deletingThreadId, setDeletingThreadId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showAllThreads, setShowAllThreads] = useState(false);

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

  const handleDeleteThread = async (threadId, e) => {
    e.stopPropagation();
    if (confirmDeleteId === threadId) {
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
      if (file.size > 20 * 1024 * 1024) return alert('Maximum file size is 20MB');
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
        setMessages(prev => [...prev, { role: 'assistant', content: 'Failed to upload file: ' + err.message }]);
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
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, an error occurred on the AI server.' }]);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const visibleThreads = showAllThreads ? threads : threads.slice(0, MAX_THREADS_SHOWN);

  return (
    <div className="flex h-screen bg-[#F7F8FA] text-gray-800 font-sans overflow-hidden">

      {/* ════════════════ SIDEBAR ════════════════ */}
      <aside className={`
        ${isSidebarOpen ? 'translate-x-0 w-72 xl:w-80' : '-translate-x-full w-0'}
        fixed lg:relative z-30 h-full
        bg-white border-r border-gray-100
        flex flex-col flex-shrink-0
        transition-all duration-300 ease-in-out
        shadow-2xl lg:shadow-none
        overflow-hidden
      `}>
        {/* Header */}
        <div className="px-4 xl:px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <img src="/assets/gys-logo.webp" alt="GYS Logo"
              className="h-8 w-auto object-contain"
              onError={e => { e.target.style.display = 'none'; }} />
            <div>
              <h1 className="font-bold text-sm text-primary-dark tracking-wide">PORTAL AI</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
                <span className="text-[10px] text-emerald-600 font-semibold">Online</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title="Collapse sidebar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5 scrollbar-thin scrollbar-thumb-gray-200">
          {/* Assistants */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">Assistants</p>
            <div className="space-y-0.5">
              {bots.map(bot => (
                <button key={bot._id} onClick={() => handleBotSelect(bot)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-2.5 transition-all duration-150 ${
                    selectedBot?._id === bot._id
                      ? 'bg-primary-dark text-white shadow-sm'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}>
                  <BotAvatar bot={bot} size="sm" />
                  <div className="flex-1 truncate min-w-0">
                    <div className="font-semibold text-xs truncate">{bot.name}</div>
                    <div className={`text-[10px] truncate ${selectedBot?._id === bot._id ? 'text-white/60' : 'text-gray-400'}`}>
                      {bot.description || 'AI Assistant'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Conversations */}
          <div>
            <div className="flex items-center justify-between px-1 mb-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">History</p>
              <span className="text-[10px] text-gray-400 tabular-nums">
                {threads.length > MAX_THREADS_SHOWN ? `${MAX_THREADS_SHOWN}/${threads.length}` : threads.length}
              </span>
            </div>

            <button onClick={handleNewChat}
              className="w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-2 text-primary-dark hover:bg-primary/5 transition-colors border border-dashed border-primary/25 mb-2 group">
              <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm group-hover:bg-primary group-hover:text-white transition-colors flex-shrink-0">+</span>
              <span className="text-xs font-semibold">New Conversation</span>
            </button>

            <div className="space-y-0.5">
              {visibleThreads.length === 0 && (
                <div className="text-center py-5">
                  <div className="text-2xl mb-1.5">💬</div>
                  <p className="text-xs text-gray-400 font-medium">No conversations yet</p>
                  <p className="text-[10px] text-gray-300 mt-0.5">Start chatting to see history</p>
                </div>
              )}
              {visibleThreads.map(t => (
                <div key={t._id}
                  className={`group flex items-center rounded-xl transition-all cursor-pointer ${
                    currentThreadId === t._id ? 'bg-primary/8 border border-primary/15' : 'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <button onClick={() => loadThread(t._id)} className="flex-1 min-w-0 text-left px-3 py-2">
                    <span className={`block text-xs truncate font-medium ${currentThreadId === t._id ? 'text-primary-dark' : 'text-gray-600'}`}>
                      {t.title || 'Untitled Chat'}
                    </span>
                    <span className="text-[9px] text-gray-400 block mt-0.5 tabular-nums">
                      {new Date(t.lastMessageAt).toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}
                    </span>
                  </button>
                  <button
                    onClick={(e) => handleDeleteThread(t._id, e)}
                    disabled={deletingThreadId === t._id}
                    title={confirmDeleteId === t._id ? 'Click again to confirm' : 'Delete conversation'}
                    className={`
                      flex-shrink-0 mr-1.5 w-6 h-6 rounded-lg flex items-center justify-center
                      transition-all duration-150 opacity-0 group-hover:opacity-100
                      ${confirmDeleteId === t._id ? 'bg-red-500 text-white opacity-100' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}
                      ${deletingThreadId === t._id ? 'opacity-40 cursor-not-allowed' : ''}
                    `}
                  >
                    {deletingThreadId === t._id
                      ? <span className="text-[8px] animate-spin">⟳</span>
                      : confirmDeleteId === t._id
                      ? <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                      : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    }
                  </button>
                </div>
              ))}
              {threads.length > MAX_THREADS_SHOWN && (
                <button onClick={() => setShowAllThreads(!showAllThreads)}
                  className="w-full text-center py-2 mt-1 text-[11px] font-semibold text-primary hover:bg-primary/5 rounded-xl transition-colors">
                  {showAllThreads ? '↑ Show Less' : `View all ${threads.length} conversations`}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-gray-100 space-y-2 flex-shrink-0">
          {(user?.isAdmin || user?.isBotCreator) && (
            <button onClick={() => navigate('/admin')}
              className="w-full flex items-center justify-center gap-2 py-2 bg-gray-50 hover:bg-primary-dark hover:text-white text-gray-600 text-xs font-bold rounded-xl border border-gray-200 transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Admin Dashboard
            </button>
          )}
          <div className="flex items-center gap-2.5 px-1">
            <div className="w-8 h-8 rounded-xl bg-primary-dark flex items-center justify-center text-white font-bold text-xs shadow-sm flex-shrink-0">
              {user?.username?.substring(0, 2).toUpperCase() || 'US'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-gray-800 truncate">{user?.username || 'User'}</p>
              <button onClick={handleLogout}
                className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-1 mt-0.5 font-medium transition-colors">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Sidebar re-open tab */}
      {!isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="hidden lg:flex fixed left-0 top-1/2 -translate-y-1/2 z-40 w-5 h-14 bg-white border-r-0 border border-gray-200 rounded-r-xl items-center justify-center text-gray-400 hover:text-primary-dark hover:bg-primary/5 transition-all shadow-md"
          title="Open sidebar"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* ════════════════ MAIN AREA ════════════════ */}
      <div className="flex-1 flex min-w-0 overflow-hidden">
        <main className="flex-1 flex flex-col h-full min-w-0 bg-[#F7F8FA]">

          {/* Top bar */}
          <div className="h-14 border-b border-gray-100 bg-white/90 backdrop-blur-sm flex items-center justify-between px-4 lg:px-6 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 transition-colors flex-shrink-0"
              >
                <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              {selectedBot ? (
                <div className="flex items-center gap-2.5 min-w-0">
                  <BotAvatar bot={selectedBot} size="sm" />
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-gray-800 truncate leading-tight">{selectedBot.name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{selectedBot.description || 'AI Assistant'}</p>
                  </div>
                </div>
              ) : (
                <span className="font-bold text-sm text-gray-500">Portal AI</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {artifact && (
                <button onClick={closeArtifact}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold rounded-xl hover:bg-blue-100 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  <span className="hidden sm:inline">Close Panel</span>
                </button>
              )}
              <button onClick={handleNewChat}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold rounded-xl transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                <span className="hidden sm:inline">New Chat</span>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className={`flex-1 overflow-y-auto py-6 scrollbar-thin scrollbar-thumb-gray-200 transition-all duration-300
            ${isSidebarOpen
              ? 'px-4 lg:px-8 xl:px-20'
              : 'px-6 lg:px-16 xl:px-32 2xl:px-48'
            }`}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center pb-16">
                <div className="mb-6">
                  <BotAvatar bot={selectedBot} size="xl" />
                </div>
                <h2 className="text-2xl xl:text-3xl font-bold text-gray-800 mb-2">
                  {selectedBot ? `Hello, I'm ${selectedBot.name}` : 'Select an Assistant'}
                </h2>
                <p className="text-sm text-gray-500 max-w-md mx-auto mb-8 leading-relaxed">
                  {selectedBot?.description || 'Ready to assist you with operations, data, and analysis.'}
                </p>
                {selectedBot && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 w-full max-w-lg">
                    {(selectedBot.starterQuestions?.length > 0 ? selectedBot.starterQuestions : ['What is the project status?', 'Search data', 'Generate a report']).map((txt, i) => (
                      <button key={i}
                        onClick={() => { setInput(txt); setTimeout(() => handleSubmit({ preventDefault: () => {} }), 0); }}
                        className="p-3.5 bg-white hover:bg-gray-50 border border-gray-200 hover:border-primary/30 rounded-xl text-sm text-gray-700 hover:text-primary-dark transition-all shadow-sm text-left font-medium hover:shadow-md group">
                        <span className="flex items-start gap-2">
                          <span className="text-primary/40 text-base leading-none group-hover:text-primary transition-colors flex-shrink-0">›</span>
                          <span>{txt}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1 max-w-4xl mx-auto">
                {messages.map((msg, index) => (
                  <ChatMessage
                    key={msg._id || index}
                    message={msg}
                    bot={selectedBot}
                    onOpenArtifact={openArtifact}
                  />
                ))}
              </div>
            )}

            {/* Thinking indicator */}
            {loading && (
              <div className="flex justify-start py-3 max-w-4xl mx-auto">
                <div className="flex items-end gap-2.5">
                  <BotAvatar bot={selectedBot} size="sm" />
                  <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      {[0, 200, 400].map((delay) => (
                        <span
                          key={delay}
                          className="w-2 h-2 bg-primary/50 rounded-full animate-bounce"
                          style={{ animationDuration: '1.2s', animationDelay: `${delay}ms` }}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-gray-400 font-medium animate-pulse select-none">Thinking…</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className={`py-3 bg-white border-t border-gray-100 flex-shrink-0 transition-all duration-300
            ${isSidebarOpen
              ? 'px-4 lg:px-8 xl:px-20'
              : 'px-6 lg:px-16 xl:px-32 2xl:px-48'
            }`}>
            <div className={`mx-auto transition-all duration-300 ${isSidebarOpen ? 'max-w-4xl' : 'max-w-5xl'}`}>
              {selectedFile && (
                <div className="flex items-center gap-2 mb-2 bg-primary/5 border border-primary/20 rounded-xl px-3 py-2 w-fit text-xs text-primary-dark font-medium">
                  <svg className="w-3.5 h-3.5 flex-shrink-0 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                  <span className="truncate max-w-[200px]">{selectedFile.name}</span>
                  <button onClick={() => setSelectedFile(null)} className="ml-0.5 text-gray-400 hover:text-red-500 transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2 bg-white border border-gray-200 rounded-2xl shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 focus-within:shadow-md transition-all px-3 py-2.5">
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach file"
                  className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-primary-dark hover:bg-gray-100 transition-colors mb-0.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                </button>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={selectedBot ? `Message ${selectedBot.name}…` : 'Select an assistant first…'}
                  disabled={!selectedBot || loading}
                  rows={1}
                  className="flex-1 bg-transparent text-gray-800 text-sm py-1 resize-none overflow-hidden focus:outline-none placeholder-gray-400"
                />
                <button onClick={handleSubmit}
                  disabled={(!input.trim() && !selectedFile) || !selectedBot || loading}
                  className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-primary-dark hover:bg-primary text-white rounded-xl shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95 mb-0.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              <p className="text-center text-[10px] text-gray-400 mt-2 select-none">
                AI responses may contain inaccuracies. Verify important information before using it for business decisions.
              </p>
            </div>
          </div>
        </main>

        {/* Artifact Panel */}
        {artifact && (
          <>
            <div onMouseDown={startDrag} onTouchStart={startDrag}
              className="w-1 flex-shrink-0 bg-gray-200 hover:bg-primary/50 cursor-col-resize transition-colors" />
            <div style={{ width: panelWidth, minWidth: PANEL_MIN_WIDTH }} className="flex-shrink-0 overflow-hidden">
              <ArtifactPanel artifact={artifact} onClose={closeArtifact} />
            </div>
          </>
        )}
      </div>

      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-20" onClick={() => setIsSidebarOpen(false)} />
      )}
    </div>
  );
};

export default Chat;
