import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, ArcElement, Filler
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import BotAvatar from './BotAvatar';
import AvatarPicker from './AvatarPicker';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement, Filler);

// ── AI Provider catalog ───────────────────────────────────────
const AI_PROVIDERS = {
  openai: {
    label: 'OpenAI', icon: '🟢',
    models: [
      { id: 'gpt-5',        label: 'GPT-5',              tier: 'flagship'  },
      { id: 'gpt-4.1',      label: 'GPT-4.1',            tier: 'flagship'  },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini',       tier: 'efficient' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano',       tier: 'efficient' },
      { id: 'o3',           label: 'o3 (Deep Reasoning)', tier: 'reasoning' },
      { id: 'o4-mini',      label: 'o4-mini (Reasoning)', tier: 'reasoning' },
      { id: 'o3-mini',      label: 'o3-mini (Reasoning)', tier: 'reasoning' },
      { id: 'gpt-4o',       label: 'GPT-4o',              tier: 'stable'    },
      { id: 'gpt-4o-mini',  label: 'GPT-4o Mini',         tier: 'stable'    },
      { id: 'gpt-4-turbo',  label: 'GPT-4 Turbo',         tier: 'legacy'    },
      { id: 'gpt-3.5-turbo',label: 'GPT-3.5 Turbo',       tier: 'legacy'    },
    ],
    capabilities: ['webSearch', 'codeInterpreter', 'imageGeneration', 'canvas', 'fileSearch'],
  },
  anthropic: {
    label: 'Anthropic (Claude)', icon: '🟠',
    models: [
      { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6',  tier: 'flagship'  },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',tier: 'flagship'  },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', tier: 'efficient' },
    ],
    capabilities: ['fileSearch'],
  },
  google: {
    label: 'Google Gemini', icon: '🔵',
    models: [
      { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   tier: 'flagship'  },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'efficient' },
      { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro',   tier: 'stable'    },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', tier: 'stable'    },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tier: 'stable'    },
    ],
    capabilities: [],
  },
  custom: { label: 'Custom / OpenAI-Compatible', icon: '⚙️', models: [], capabilities: [] },
};

const TIER_STYLE = {
  flagship:  'bg-amber-50 text-amber-700 border border-amber-200',
  efficient: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  reasoning: 'bg-violet-50 text-violet-700 border border-violet-200',
  stable:    'bg-blue-50 text-blue-700 border border-blue-200',
  legacy:    'bg-gray-100 text-gray-500 border border-gray-200',
};

const ALL_CAPABILITIES = [
  { id: 'webSearch',       icon: '🌐', label: 'Web Search',       desc: 'Bot dapat menelusuri internet untuk info terkini', providers: ['openai'] },
  { id: 'codeInterpreter', icon: '💻', label: 'Code Interpreter',  desc: 'Bot dapat menulis & menjalankan kode Python', providers: ['openai'] },
  { id: 'imageGeneration', icon: '🎨', label: 'Image Generation',  desc: 'Bot dapat membuat gambar dengan DALL-E', providers: ['openai'] },
  { id: 'canvas',          icon: '📝', label: 'Canvas Mode',       desc: 'Mode editing dokumen & canvas interaktif', providers: ['openai'] },
  { id: 'fileSearch',      icon: '📂', label: 'File Search (RAG)', desc: 'Pencarian semantik di seluruh knowledge base', providers: ['openai', 'anthropic'] },
];

const KNOWLEDGE_MODES = [
  { id: 'relevant', label: '🎯 Relevan Saja',  desc: 'Sisipkan knowledge hanya jika relevan' },
  { id: 'always',   label: '📚 Selalu',          desc: 'Selalu sisipkan semua knowledge' },
  { id: 'disabled', label: '🚫 Nonaktif',         desc: 'Jangan gunakan knowledge base' },
];

const TONE_OPTIONS = [
  { id: 'professional', label: '👔 Professional' },
  { id: 'friendly',     label: '😊 Friendly' },
  { id: 'formal',       label: '🎩 Formal' },
  { id: 'concise',      label: '⚡ Concise' },
  { id: 'detailed',     label: '📖 Detailed' },
  { id: 'custom',       label: '✏️ Custom' },
];

const SUPPORTED_FILE_TYPES = '.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.csv,.md';

const FILE_TYPE_ICON = { pdf: '📕', docx: '📘', doc: '📘', xlsx: '📗', xls: '📗', pptx: '📙', ppt: '📙', txt: '📄', csv: '📊', md: '📝' };
const getFileIcon = (name = '') => FILE_TYPE_ICON[name.split('.').pop()?.toLowerCase()] || '📄';
const fmtSize = (b) => !b ? '0 B' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;

const initialBotState = {
  name: '', description: '', persona: '', tone: 'professional',
  systemPrompt: 'Anda adalah asisten AI profesional.',
  prompt: '',
  starterQuestions: [],
  knowledgeMode: 'relevant',
  aiProvider: { provider: 'openai', model: 'gpt-4.1', apiKey: '', endpoint: '', temperature: 0.1, maxTokens: 2000 },
  capabilities: { webSearch: false, codeInterpreter: false, imageGeneration: false, canvas: false, fileSearch: false },
  smartsheetConfig:  { enabled: false, apiKey: '', sheetId: '' },
  kouventaConfig:    { enabled: false, apiKey: '', endpoint: '' },
  onedriveConfig:    { enabled: false, folderUrl: '', tenantId: '', clientId: '', clientSecret: '' },
  avatar: { type: 'emoji', emoji: '🤖', bgColor: '#6366f1', textColor: '#ffffff' },
};

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
function AdminDashboard({ user, handleLogout }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab]   = useState('dashboard');
  const [stats, setStats]           = useState(null);
  const [users, setUsers]           = useState([]);
  const [bots,  setBots]            = useState([]);
  const [chatLogs, setChatLogs]     = useState([]);
  const [logPage, setLogPage]       = useState(1);
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [loading, setLoading]       = useState(false);
  const [exportFilter, setExportFilter] = useState('');

  const [showBotModal, setShowBotModal] = useState(false);
  const [editingBot,   setEditingBot]   = useState(null);
  const [botForm,      setBotForm]      = useState(initialBotState);
  const [botModalTab,  setBotModalTab]  = useState('basic');
  const [testAIState,  setTestAIState]  = useState(null);
  const [knowledgeUploading, setKnowledgeUploading] = useState(false);
  const [knowledgeFiles,     setKnowledgeFiles]     = useState([]);
  const knowledgeInputRef = useRef(null);

  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser,   setEditingUser]   = useState(null);
  const [userForm,      setUserForm]      = useState({ username: '', password: '', isAdmin: false, assignedBots: [] });

  const [avatarPickerBot, setAvatarPickerBot] = useState(null);
  const [botSearch, setBotSearch] = useState('');

  useEffect(() => { fetchStats(); fetchUsers(); fetchBots(); }, []);
  useEffect(() => { if (activeTab === 'chats') fetchChatLogs(); }, [activeTab, logPage]);

  const fetchStats  = async () => { try { const r = await axios.get('/api/admin/stats'); setStats(r.data); } catch {} };
  const fetchUsers  = async () => { try { const r = await axios.get('/api/admin/users'); setUsers(r.data.users || []); } catch {} };
  const fetchBots   = async () => {
    try { const r = await axios.get('/api/admin/bots'); setBots(Array.isArray(r.data) ? r.data : r.data.bots || []); } catch {}
  };
  const fetchChatLogs = async () => {
    setLoading(true);
    try { const r = await axios.get(`/api/admin/chat-logs?page=${logPage}&limit=20`); setChatLogs(r.data.chats || []); setLogTotalPages(r.data.totalPages || 1); }
    finally { setLoading(false); }
  };

  // ── Bot CRUD ────────────────────────────────────────────────
  const handleCreateBot = () => {
    setEditingBot(null); setBotForm(initialBotState); setKnowledgeFiles([]);
    setBotModalTab('basic'); setTestAIState(null); setShowBotModal(true);
  };

  const handleEditBot = (bot) => {
    setEditingBot(bot);
    setBotForm({
      name: bot.name, description: bot.description || '',
      persona: bot.persona || '', tone: bot.tone || 'professional',
      systemPrompt: bot.systemPrompt || '',
      prompt: bot.prompt || '',
      starterQuestions: bot.starterQuestions || [],
      knowledgeMode: bot.knowledgeMode || 'relevant',
      aiProvider: {
        provider:    bot.aiProvider?.provider    || 'openai',
        model:       bot.aiProvider?.model       || 'gpt-4.1',
        apiKey:      bot.aiProvider?.apiKey      || '',
        endpoint:    bot.aiProvider?.endpoint    || '',
        temperature: bot.aiProvider?.temperature ?? 0.1,
        maxTokens:   bot.aiProvider?.maxTokens   ?? 2000,
      },
      capabilities: {
        webSearch:       bot.capabilities?.webSearch       || false,
        codeInterpreter: bot.capabilities?.codeInterpreter || false,
        imageGeneration: bot.capabilities?.imageGeneration || false,
        canvas:          bot.capabilities?.canvas          || false,
        fileSearch:      bot.capabilities?.fileSearch      || false,
      },
      smartsheetConfig:  { enabled: false, apiKey: '', sheetId: '', ...bot.smartsheetConfig },
      kouventaConfig:    { enabled: false, apiKey: '', endpoint: '', ...bot.kouventaConfig },
      onedriveConfig:    { enabled: false, folderUrl: '', tenantId: '', clientId: '', clientSecret: '', ...bot.onedriveConfig },
      avatar: bot.avatar || { type: 'emoji', emoji: '🤖', bgColor: '#6366f1' },
    });
    setKnowledgeFiles(bot.knowledgeFiles || []);
    setBotModalTab('basic'); setTestAIState(null); setShowBotModal(true);
  };

  const handleSaveBot = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...botForm, starterQuestions: botForm.starterQuestions.filter(q => q.trim()) };
      if (editingBot) await axios.put(`/api/admin/bots/${editingBot._id}`, payload);
      else            await axios.post('/api/admin/bots', payload);
      setShowBotModal(false); fetchBots(); fetchStats();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const handleDeleteBot = async (id) => {
    if (!window.confirm('Hapus bot ini?')) return;
    try { await axios.delete(`/api/admin/bots/${id}`); fetchBots(); fetchStats(); } catch (e) { alert(e.message); }
  };

  const handleTestAI = async () => {
    setTestAIState('testing');
    try {
      let res;
      if (editingBot) { await axios.put(`/api/admin/bots/${editingBot._id}`, { ...botForm }); res = await axios.post(`/api/admin/bots/${editingBot._id}/test-ai`); }
      else            { res = await axios.post('/api/admin/test-ai-config', botForm.aiProvider); }
      setTestAIState(res.data);
    } catch (err) { setTestAIState({ ok: false, message: err.response?.data?.message || err.message }); }
  };

  // ── Knowledge ───────────────────────────────────────────────
  const handleKnowledgeUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!editingBot) { alert('Simpan bot terlebih dahulu sebelum upload knowledge files.'); return; }
    setKnowledgeUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      const res = await axios.post(`/api/admin/bots/${editingBot._id}/knowledge`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      alert(res.data.message);
      const updated = await axios.get('/api/admin/bots');
      const fresh   = (Array.isArray(updated.data) ? updated.data : updated.data.bots || []).find(b => b._id === editingBot._id);
      setKnowledgeFiles(fresh?.knowledgeFiles || []);
      setBots(Array.isArray(updated.data) ? updated.data : updated.data.bots || []);
    } catch (err) { alert('Upload gagal: ' + (err.response?.data?.error || err.message)); }
    finally { setKnowledgeUploading(false); if (knowledgeInputRef.current) knowledgeInputRef.current.value = ''; }
  };

  const handleDeleteKnowledge = async (fileId, fileName) => {
    if (!window.confirm(`Hapus file "${fileName}"?`)) return;
    try { await axios.delete(`/api/admin/bots/${editingBot._id}/knowledge/${fileId}`); setKnowledgeFiles(prev => prev.filter(f => f._id !== fileId)); }
    catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const handleAvatarSaved = (updatedBot) => {
    setBots(prev => prev.map(b => b._id === updatedBot._id ? updatedBot : b));
    if (editingBot?._id === updatedBot._id) { setEditingBot(updatedBot); setBotForm(p => ({ ...p, avatar: updatedBot.avatar })); }
  };

  const addQuestion    = ()     => setBotForm({ ...botForm, starterQuestions: [...botForm.starterQuestions, ''] });
  const updateQuestion = (i, v) => { const n = [...botForm.starterQuestions]; n[i] = v; setBotForm({ ...botForm, starterQuestions: n }); };
  const removeQuestion = (i)    => setBotForm({ ...botForm, starterQuestions: botForm.starterQuestions.filter((_, idx) => idx !== i) });

  // ── User CRUD ────────────────────────────────────────────────
  const handleEditUser = (u) => {
    setEditingUser(u);
    setUserForm({ username: u.username, password: '', isAdmin: u.isAdmin, assignedBots: u.assignedBots?.map(b => b._id) || [] });
    setShowUserModal(true);
  };
  const handleSaveUser = async (e) => {
    e.preventDefault();
    try {
      if (editingUser) await axios.put(`/api/admin/users/${editingUser._id}`, userForm);
      else             await axios.post('/api/admin/users', userForm);
      setShowUserModal(false); fetchUsers(); fetchStats();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };
  const toggleBotAssignment = (id) => setUserForm(p => ({
    ...p, assignedBots: p.assignedBots.includes(id) ? p.assignedBots.filter(x => x !== id) : [...p.assignedBots, id]
  }));

  const handleExport = async () => {
    try {
      let url = '/api/admin/export-chats';
      if (exportFilter) { const [y, m] = exportFilter.split('-'); url += `?year=${y}&month=${m}`; }
      const response = await axios.get(url, { responseType: 'blob' });
      const a = document.createElement('a'); a.href = window.URL.createObjectURL(new Blob([response.data]));
      a.setAttribute('download', exportFilter ? `chat-logs-${exportFilter}.csv` : `chat-logs-all.csv`);
      document.body.appendChild(a); a.click(); a.remove();
    } catch { alert('Export failed'); }
  };

  // ── Chart data ───────────────────────────────────────────────
  const lineChartData = {
    labels: stats?.activityTrend?.map(d => d._id) || [],
    datasets: [{ label: 'Messages', data: stats?.activityTrend?.map(d => d.count) || [], borderColor: '#007857', backgroundColor: 'rgba(0,120,87,0.12)', tension: 0.4, fill: true, pointBackgroundColor: '#004E36', pointRadius: 4, pointHoverRadius: 6 }]
  };
  const pieColors = ['#004E36','#007857','#48AE92','#6E6F72','#A5A7AA'];
  const pieChartData = {
    labels: stats?.botPopularity?.map(b => b.name) || [],
    datasets: [{ data: stats?.botPopularity?.map(b => b.count) || [], backgroundColor: pieColors, borderWidth: 3, borderColor: '#ffffff' }]
  };

  const currentProvider = botForm.aiProvider?.provider || 'openai';
  const availableModels = AI_PROVIDERS[currentProvider]?.models || [];
  const providerCaps    = AI_PROVIDERS[currentProvider]?.capabilities || [];
  const filteredBots    = bots.filter(b => b.name.toLowerCase().includes(botSearch.toLowerCase()));

  const activeCapCount  = Object.values(botForm.capabilities || {}).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-steel-lightest/40 text-gray-800 font-sans">

      {/* ── NAV ──────────────────────────────────────────────── */}
      <nav className="bg-white border-b border-steel-light/30 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src="/assets/gys-logo.webp" alt="GYS" className="h-9 w-auto" onError={e => e.target.style.display='none'} />
            <div>
              <h1 className="text-lg font-bold text-primary-dark leading-tight">GYS Admin Portal</h1>
              <p className="text-[10px] text-steel font-medium uppercase tracking-wider">AI Management Console</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
              System Online
            </div>
            <span className="text-xs text-steel hidden md:block px-2">Hi, {user.username}</span>
            <button onClick={() => navigate('/')} className="px-3 py-1.5 text-xs bg-steel-lightest hover:bg-steel-light/30 text-primary-dark rounded-lg border border-steel-light/50 font-bold transition-colors">← Chat</button>
            <button onClick={handleLogout} className="px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg border border-red-200 font-bold transition-colors">Logout</button>
          </div>
        </div>
        {/* Sub-nav tabs */}
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1">
            {[
              { id: 'dashboard', icon: '📊', label: 'Dashboard' },
              { id: 'bots',      icon: '🤖', label: 'Bots' },
              { id: 'users',     icon: '👥', label: 'Users' },
              { id: 'chats',     icon: '💬', label: 'Chat Logs' },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                  activeTab === t.id
                    ? 'border-primary-dark text-primary-dark'
                    : 'border-transparent text-steel hover:text-gray-700 hover:border-steel-light'
                }`}>
                <span>{t.icon}</span> {t.label}
                {t.id === 'bots' && bots.length > 0 && (
                  <span className="ml-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px] font-black">{bots.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* ── DASHBOARD ───────────────────────────────────────── */}
        {activeTab === 'dashboard' && stats && (
          <div className="space-y-6">
            {/* Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { title: 'Total Users',   value: stats.totalUsers,   icon: '👥', color: 'text-primary-dark',  bg: 'bg-primary-dark/5',  accent: 'border-l-primary-dark' },
                { title: 'Active Bots',   value: stats.totalBots,    icon: '🤖', color: 'text-primary',       bg: 'bg-primary/5',        accent: 'border-l-primary' },
                { title: 'Total Chats',   value: stats.totalChats,   icon: '💬', color: 'text-primary-light', bg: 'bg-primary-light/10', accent: 'border-l-primary-light' },
                { title: 'Threads',       value: stats.totalThreads, icon: '📂', color: 'text-steel',         bg: 'bg-steel-lightest',   accent: 'border-l-steel' },
              ].map(s => (
                <div key={s.title} className={`bg-white p-5 rounded-xl border border-steel-light/30 shadow-sm flex items-center justify-between border-l-4 ${s.accent} hover:shadow-md transition-all`}>
                  <div>
                    <p className="text-[10px] text-steel uppercase tracking-wider font-bold mb-1">{s.title}</p>
                    <h2 className={`text-2xl font-black ${s.color}`}>{(s.value || 0).toLocaleString()}</h2>
                  </div>
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl ${s.bg}`}>{s.icon}</div>
                </div>
              ))}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-steel-light/30 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-primary-dark">📈 Weekly Activity</h3>
                  <span className="text-xs text-steel bg-steel-lightest px-2 py-1 rounded-full">Last 7 days</span>
                </div>
                <div className="h-56">
                  <Line data={lineChartData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { grid: { color: '#F0F1F1' }, ticks: { color: '#6E6F72', font: { size: 10 } } }, x: { grid: { display: false }, ticks: { color: '#6E6F72', font: { size: 10 } } } }, plugins: { legend: { display: false } } }} />
                </div>
              </div>
              <div className="bg-white p-6 rounded-xl border border-steel-light/30 shadow-sm">
                <h3 className="font-bold text-primary-dark mb-4">🤖 Bot Usage</h3>
                <div className="h-44">
                  <Doughnut data={pieChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#6E6F72', boxWidth: 10, padding: 10, font: { size: 10 } } } }, cutout: '68%' }} />
                </div>
              </div>
            </div>

            {/* Top Users */}
            <div className="bg-white rounded-xl shadow-sm border border-steel-light/30 overflow-hidden">
              <div className="px-6 py-4 border-b border-steel-light/30 flex items-center justify-between">
                <h3 className="font-bold text-primary-dark">🏆 Top Contributors</h3>
                <span className="text-xs text-steel">This week</span>
              </div>
              <div className="divide-y divide-steel-light/20">
                {stats.topUsers?.map((u, i) => (
                  <div key={i} className="px-6 py-3 flex items-center justify-between hover:bg-steel-lightest/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-steel-lightest text-steel' : 'bg-steel-lightest text-steel'}`}>{i+1}</span>
                      <span className="font-semibold text-sm">{u.username}</span>
                    </div>
                    <span className="font-black text-primary text-sm">{u.count} msgs</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── BOTS ─────────────────────────────────────────────── */}
        {activeTab === 'bots' && (
          <div>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-primary-dark">AI Bots</h2>
                <p className="text-sm text-steel">{bots.length} bot aktif</p>
              </div>
              <div className="flex gap-3">
                <input value={botSearch} onChange={e => setBotSearch(e.target.value)} placeholder="Cari bot..."
  autoComplete="off" readOnly onFocus={e => e.target.removeAttribute('readOnly')}
  className="px-3 py-2 bg-white border border-steel-light/50 rounded-lg text-sm outline-none focus:border-primary w-44" />
                <button onClick={handleCreateBot} className="px-4 py-2 bg-primary-dark text-white text-sm font-bold rounded-lg hover:bg-primary transition-colors flex items-center gap-2">
                  <span className="text-lg leading-none">+</span> Create Bot
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* Create new card */}
              <div onClick={handleCreateBot} className="bg-white rounded-xl border-2 border-dashed border-steel-light/40 p-6 flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-all min-h-[200px] group">
                <div className="w-14 h-14 rounded-xl border-2 border-dashed border-steel-light/50 flex items-center justify-center mb-3 text-3xl font-thin text-steel group-hover:border-primary group-hover:text-primary transition-all">+</div>
                <span className="font-bold text-steel group-hover:text-primary-dark text-sm transition-colors">Create New Bot</span>
                <p className="text-xs text-steel-light mt-1 text-center">Configure AI model, knowledge & capabilities</p>
              </div>

              {filteredBots.map(bot => {
                const capCount = Object.values(bot.capabilities || {}).filter(Boolean).length;
                return (
                  <div key={bot._id} className="bg-white rounded-xl shadow-sm border border-steel-light/30 p-5 hover:shadow-md transition-all flex flex-col">
                    {/* Bot header */}
                    <div className="flex items-start gap-3 mb-4">
                      <div className="relative cursor-pointer group/av flex-shrink-0" onClick={() => setAvatarPickerBot(bot)}>
                        <BotAvatar bot={bot} size="md" />
                        <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover/av:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-white text-[8px] font-bold">EDIT</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-primary-dark truncate">{bot.name}</h3>
                        <p className="text-xs text-steel truncate">{bot.description || 'No description'}</p>
                      </div>
                      <button onClick={() => handleEditBot(bot)} className="flex-shrink-0 text-xs font-bold text-steel hover:text-primary-dark bg-steel-lightest hover:bg-steel-light/30 px-2.5 py-1 rounded-lg border border-steel-light/30 transition-colors">
                        CONFIG
                      </button>
                    </div>

                    {/* Provider / model badge */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {(() => {
                        const p = bot.aiProvider?.provider || 'openai';
                        const m = bot.aiProvider?.model || 'gpt-4o';
                        const provData = AI_PROVIDERS[p];
                        const modelData = provData?.models.find(x => x.id === m);
                        return (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${TIER_STYLE[modelData?.tier || 'stable']}`}>
                            {provData?.icon} {m}
                          </span>
                        );
                      })()}
                      {bot.knowledgeFiles?.length > 0 && (
                        <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-bold">
                          📚 {bot.knowledgeFiles.length} docs
                        </span>
                      )}
                      {capCount > 0 && (
                        <span className="bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded text-[10px] font-bold">
                          ⚡ {capCount} cap{capCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {/* Capability icons row */}
                    {capCount > 0 && (
                      <div className="flex gap-1 mb-3">
                        {ALL_CAPABILITIES.filter(c => bot.capabilities?.[c.id]).map(c => (
                          <span key={c.id} title={c.label} className="w-6 h-6 bg-steel-lightest rounded text-xs flex items-center justify-center">{c.icon}</span>
                        ))}
                      </div>
                    )}

                    {/* Integration badges */}
                    <div className="flex flex-wrap gap-1 mt-auto pt-3 border-t border-steel-light/20">
                      {bot.smartsheetConfig?.enabled && <span className="text-[9px] px-1.5 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded font-bold">Smartsheet</span>}
                      {bot.kouventaConfig?.enabled   && <span className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded font-bold">Kouventa</span>}
                      {bot.onedriveConfig?.enabled   && <span className="text-[9px] px-1.5 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded font-bold">OneDrive</span>}
                      {!bot.smartsheetConfig?.enabled && !bot.kouventaConfig?.enabled && !bot.onedriveConfig?.enabled && (
                        <span className="text-[9px] text-steel">No integrations</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── USERS ────────────────────────────────────────────── */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-xl shadow-sm border border-steel-light/30 overflow-hidden">
            <div className="px-6 py-4 border-b border-steel-light/30 flex justify-between items-center">
              <div>
                <h2 className="font-bold text-primary-dark">User Management</h2>
                <p className="text-xs text-steel">{users.length} registered users</p>
              </div>
              <button onClick={() => { setEditingUser(null); setUserForm({username:'',password:'',isAdmin:false,assignedBots:[]}); setShowUserModal(true); }}
                className="px-4 py-2 bg-primary-dark text-white text-sm font-bold rounded-lg hover:bg-primary transition-colors">
                + Add User
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-steel-lightest text-steel uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="px-6 py-3 text-left">User</th>
                    <th className="px-6 py-3 text-left">Role</th>
                    <th className="px-6 py-3 text-left">Auth</th>
                    <th className="px-6 py-3 text-left">Bots</th>
                    <th className="px-6 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-steel-light/20">
                  {users.map(u => (
                    <tr key={u._id} className="hover:bg-steel-lightest/50 transition-colors">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary-dark/10 flex items-center justify-center text-xs font-bold text-primary-dark">
                            {u.username.substring(0,2).toUpperCase()}
                          </div>
                          <span className="font-medium">{u.username}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        {u.isAdmin
                          ? <span className="bg-primary-dark text-white px-2 py-0.5 rounded text-[10px] font-black">ADMIN</span>
                          : <span className="text-steel text-xs">User</span>}
                      </td>
                      <td className="px-6 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${u.authMethod === 'ldap' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {u.authMethod === 'ldap' ? 'LDAP/AD' : 'Local'}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-steel text-xs">{u.assignedBots?.length || 0} bot(s)</td>
                      <td className="px-6 py-3 text-right">
                        <button onClick={() => handleEditUser(u)} className="text-primary hover:text-primary-dark font-bold text-xs">Edit →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── CHAT LOGS ────────────────────────────────────────── */}
        {activeTab === 'chats' && (
          <div className="bg-white rounded-xl shadow-sm border border-steel-light/30 overflow-hidden flex flex-col h-[700px]">
            <div className="px-6 py-4 border-b border-steel-light/30 flex justify-between items-center">
              <div>
                <h2 className="font-bold text-primary-dark">Chat Logs</h2>
                <p className="text-xs text-steel">Monitor all conversations</p>
              </div>
              <div className="flex items-center gap-2">
                <input type="month" value={exportFilter} onChange={e => setExportFilter(e.target.value)} className="bg-white border border-steel-light/50 rounded-lg text-xs px-3 py-1.5 outline-none focus:border-primary" />
                <button onClick={handleExport} className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary-dark transition-colors">⬇ Export CSV</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-steel-lightest text-steel uppercase text-[10px] tracking-wider sticky top-0">
                  <tr>
                    <th className="px-5 py-3 text-left">Time</th>
                    <th className="px-5 py-3 text-left">User</th>
                    <th className="px-5 py-3 text-left">Bot</th>
                    <th className="px-5 py-3 text-left">Role</th>
                    <th className="px-5 py-3 text-left">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-steel-light/20">
                  {chatLogs.map(log => (
                    <tr key={log._id} className="hover:bg-steel-lightest/50 transition-colors">
                      <td className="px-5 py-2.5 text-steel whitespace-nowrap">{new Date(log.createdAt).toLocaleString('id-ID')}</td>
                      <td className="px-5 py-2.5 font-medium">{log.userId?.username || '—'}</td>
                      <td className="px-5 py-2.5 text-primary font-bold">{log.botId?.name || 'System'}</td>
                      <td className="px-5 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${log.role === 'user' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>{log.role}</span>
                      </td>
                      <td className="px-5 py-2.5 truncate max-w-xs text-steel">{log.content || (log.attachedFiles?.length ? '📎 File' : '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-steel-light/30 flex justify-between items-center text-xs text-steel">
              <span>Page {logPage} of {logTotalPages}</span>
              <div className="flex gap-2">
                <button disabled={logPage===1} onClick={()=>setLogPage(p=>p-1)} className="px-3 py-1 bg-white border border-steel-light/50 rounded-lg hover:bg-steel-lightest disabled:opacity-40 font-bold">Prev</button>
                <button disabled={logPage===logTotalPages} onClick={()=>setLogPage(p=>p+1)} className="px-3 py-1 bg-white border border-steel-light/50 rounded-lg hover:bg-steel-lightest disabled:opacity-40 font-bold">Next</button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ══════════════════════════════════════════════════════════
          BOT MODAL
      ══════════════════════════════════════════════════════════ */}
      {showBotModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col border border-steel-light/30 overflow-hidden">

            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-steel-light/30 flex justify-between items-center bg-gradient-to-r from-steel-lightest/80 to-white">
              <div className="flex items-center gap-3">
                <BotAvatar bot={editingBot || { avatar: botForm.avatar }} size="sm" />
                <div>
                  <h3 className="font-bold text-primary-dark text-sm">{editingBot ? `Edit — ${editingBot.name}` : 'Create New Bot'}</h3>
                  <p className="text-[10px] text-steel">{editingBot ? 'Konfigurasi bot yang sudah ada' : 'Buat bot AI baru dengan kemampuan lengkap'}</p>
                </div>
              </div>
              <button onClick={() => setShowBotModal(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-steel hover:bg-steel-lightest hover:text-gray-700 transition-colors">✕</button>
            </div>

            {/* Modal Sub-tabs */}
            <div className="flex border-b border-steel-light/30 bg-white px-4 overflow-x-auto">
              {[
                { id: 'basic',        label: 'Basic',        icon: '📝' },
                { id: 'ai',           label: 'AI & Model',   icon: '🤖' },
                { id: 'capabilities', label: `Capabilities${activeCapCount > 0 ? ` (${activeCapCount})` : ''}`, icon: '⚡' },
                { id: 'knowledge',    label: `Knowledge${knowledgeFiles.length > 0 ? ` (${knowledgeFiles.length})` : ''}`, icon: '📚' },
                { id: 'integrations', label: 'Integrations', icon: '🔌' },
              ].map(t => (
                <button key={t.id} onClick={() => setBotModalTab(t.id)}
                  className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${
                    botModalTab === t.id ? 'border-primary-dark text-primary-dark' : 'border-transparent text-steel hover:text-gray-700'
                  }`}>
                  <span>{t.icon}</span> {t.label}
                </button>
              ))}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">

              {/* ── BASIC ──────────────────────────────────────── */}
              {botModalTab === 'basic' && (
                <div className="space-y-5">
                  {/* Avatar row */}
                  <div className="flex items-center gap-4 p-4 bg-steel-lightest/50 rounded-xl border border-steel-light/30">
                    <div className="relative cursor-pointer group/av" onClick={() => editingBot && setAvatarPickerBot(editingBot)}>
                      <BotAvatar bot={editingBot || { avatar: botForm.avatar }} size="lg" />
                      {editingBot && <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover/av:opacity-100 transition-opacity flex items-center justify-center"><span className="text-white text-[8px] font-bold">EDIT</span></div>}
                    </div>
                    <div>
                      <p className="font-semibold text-sm">Bot Avatar</p>
                      <p className="text-xs text-steel mt-0.5">Upload gambar, pilih emoji, atau icon</p>
                      {editingBot
                        ? <button type="button" onClick={() => setAvatarPickerBot(editingBot)} className="mt-2 px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-bold">🎨 Edit Avatar</button>
                        : <p className="text-xs text-steel mt-1.5 italic">💡 Simpan bot dulu untuk edit avatar</p>}
                    </div>
                  </div>

                  {/* Name + description */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-1.5">Nama Bot *</label>
                      <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded-lg p-2.5 text-sm focus:border-primary-dark focus:ring-1 focus:ring-primary-dark/20 outline-none transition-all" placeholder="e.g. HR Assistant" value={botForm.name} onChange={e => setBotForm({...botForm, name: e.target.value})} />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-1.5">Deskripsi</label>
                      <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded-lg p-2.5 text-sm focus:border-primary-dark outline-none transition-all" placeholder="Singkat, untuk sidebar" value={botForm.description} onChange={e => setBotForm({...botForm, description: e.target.value})} />
                    </div>
                  </div>

                  {/* Persona + Tone */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-1.5">Persona (opsional)</label>
                      <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded-lg p-2.5 text-sm focus:border-primary-dark outline-none transition-all" placeholder="e.g. Expert HR Consultant" value={botForm.persona} onChange={e => setBotForm({...botForm, persona: e.target.value})} />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-1.5">Tone / Gaya Bahasa</label>
                      <select className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded-lg p-2.5 text-sm focus:border-primary-dark outline-none" value={botForm.tone} onChange={e => setBotForm({...botForm, tone: e.target.value})}>
                        {TONE_OPTIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* System Prompt */}
                  <div>
                    <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-1.5">System Prompt / Instruksi Bot</label>
                    <textarea className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded-lg p-3 text-sm h-36 font-mono focus:border-primary-dark outline-none resize-none transition-all"
                      placeholder="Contoh: Anda adalah asisten HR yang membantu karyawan menjawab pertanyaan seputar cuti, absensi, dan kebijakan perusahaan."
                      value={botForm.prompt} onChange={e => setBotForm({...botForm, prompt: e.target.value})} />
                    <p className="text-[10px] text-steel mt-1">💡 Prompt ini mendefinisikan kepribadian, tugas, dan batasan bot</p>
                  </div>

                  {/* Starter Questions */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-steel uppercase tracking-wide">Starter Questions</label>
                      <button onClick={addQuestion} className="text-xs font-bold text-primary hover:text-primary-dark">+ Tambah</button>
                    </div>
                    <div className="space-y-2">
                      {botForm.starterQuestions.map((q, i) => (
                        <div key={i} className="flex gap-2">
                          <input className="flex-1 bg-steel-lightest/50 border border-steel-light/50 rounded-lg p-2.5 text-sm focus:border-primary outline-none transition-all" value={q} onChange={e => updateQuestion(i, e.target.value)} placeholder={`Pertanyaan ${i+1}...`} />
                          <button onClick={() => removeQuestion(i)} className="text-red-400 hover:text-red-600 font-black px-2">✕</button>
                        </div>
                      ))}
                      {botForm.starterQuestions.length === 0 && <p className="text-xs text-steel italic">Belum ada starter questions. Klik "+ Tambah" untuk menambah.</p>}
                    </div>
                  </div>
                </div>
              )}

              {/* ── AI & MODEL ──────────────────────────────────── */}
              {botModalTab === 'ai' && (
                <div className="space-y-5">
                  <div className="text-xs text-steel bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                    💡 Pilih AI provider dan model. API Key bisa di-set per-bot atau kosongkan untuk pakai key dari server <code className="bg-blue-100 px-1 rounded">.env</code>.
                  </div>

                  {/* Provider selector */}
                  <div>
                    <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-2">AI Provider</label>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(AI_PROVIDERS).map(([key, prov]) => (
                        <button key={key} type="button"
                          onClick={() => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, provider: key, model: prov.models[0]?.id || '' } }))}
                          className={`p-3.5 rounded-xl border-2 text-left transition-all ${currentProvider === key ? 'border-primary-dark bg-primary-dark/5 shadow-sm' : 'border-steel-light/40 hover:border-steel-light'}`}>
                          <div className="text-xl mb-1">{prov.icon}</div>
                          <div className="text-xs font-bold text-gray-800">{prov.label}</div>
                          <div className="text-[10px] text-steel mt-0.5">{prov.models.length > 0 ? `${prov.models.length} models` : 'Custom endpoint'}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Model selector with tier badges */}
                  {availableModels.length > 0 && (
                    <div>
                      <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-2">Model</label>
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {availableModels.map(m => (
                          <button key={m.id} type="button"
                            onClick={() => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, model: m.id } }))}
                            className={`w-full p-3 rounded-xl border-2 text-left flex items-center justify-between transition-all ${botForm.aiProvider?.model === m.id ? 'border-primary-dark bg-primary-dark/5' : 'border-steel-light/30 hover:border-steel-light'}`}>
                            <div>
                              <span className="text-sm font-bold text-gray-800">{m.label}</span>
                              <div className="text-[10px] text-steel font-mono">{m.id}</div>
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${TIER_STYLE[m.tier || 'stable']}`}>{m.tier || 'stable'}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Custom model input for custom provider */}
                  {currentProvider === 'custom' && (
                    <div>
                      <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-1.5">Model ID</label>
                      <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded-lg p-2.5 text-sm focus:border-primary-dark outline-none"
                        placeholder="e.g. llama3:8b, mistral, etc."
                        value={botForm.aiProvider?.model || ''}
                        onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, model: e.target.value } }))} />
                    </div>
                  )}

                  {/* API Key */}
                  <div>
                    <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-1.5">API Key (override .env — opsional)</label>
                    <input type="password" className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded-lg p-2.5 text-sm focus:border-primary-dark outline-none"
                      placeholder="Kosongkan untuk pakai key dari .env server"
                      autoComplete="new-password"
                      value={botForm.aiProvider?.apiKey || ''}
                      onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, apiKey: e.target.value } }))} />
                  </div>

                  {/* Custom endpoint */}
                  {(currentProvider === 'custom' || currentProvider === 'openai') && (
                    <div>
                      <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-1.5">
                        {currentProvider === 'custom' ? 'Endpoint URL *' : 'Custom Base URL (Azure / proxy — opsional)'}
                      </label>
                      <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded-lg p-2.5 text-sm focus:border-primary-dark outline-none"
                        placeholder={currentProvider === 'custom' ? 'https://api.example.com/v1' : 'https://your-azure-endpoint.openai.azure.com/...'}
                        value={botForm.aiProvider?.endpoint || ''}
                        onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, endpoint: e.target.value } }))} />
                    </div>
                  )}

                  {/* Temperature + Max Tokens */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-steel-lightest/50 border border-steel-light/30 rounded-xl p-3">
                      <label className="text-xs font-bold text-steel block mb-2">Temperature: <span className="text-primary-dark font-black">{botForm.aiProvider?.temperature ?? 0.1}</span></label>
                      <input type="range" min="0" max="1" step="0.05"
                        value={botForm.aiProvider?.temperature ?? 0.1}
                        onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, temperature: parseFloat(e.target.value) } }))}
                        className="w-full accent-primary-dark" />
                      <div className="flex justify-between text-[9px] text-steel mt-1"><span>Presisi (0)</span><span>Kreatif (1)</span></div>
                    </div>
                    <div className="bg-steel-lightest/50 border border-steel-light/30 rounded-xl p-3">
                      <label className="text-xs font-bold text-steel block mb-2">Max Tokens</label>
                      <input type="number" min="256" max="8000" step="256"
                        className="w-full bg-white border border-steel-light/50 rounded-lg p-2 text-sm focus:border-primary-dark outline-none"
                        value={botForm.aiProvider?.maxTokens ?? 2000}
                        onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, maxTokens: parseInt(e.target.value) } }))} />
                    </div>
                  </div>

                  {/* Test connection */}
                  <div className="pt-3 border-t border-steel-light/30">
                    <button type="button" onClick={handleTestAI} disabled={testAIState === 'testing'}
                      className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-60 transition-colors">
                      {testAIState === 'testing' ? '⏳ Testing...' : '🔌 Test Koneksi'}
                    </button>
                    {testAIState && testAIState !== 'testing' && (
                      <div className={`mt-3 p-3 rounded-xl text-xs font-medium ${testAIState.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                        {testAIState.ok ? '✅' : '❌'} {testAIState.message}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── CAPABILITIES ─────────────────────────────────── */}
              {botModalTab === 'capabilities' && (
                <div className="space-y-4">
                  <div className="text-xs text-steel bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
                    ⚡ Aktifkan kemampuan tambahan seperti di ChatGPT. Availability tergantung pada provider & model yang dipilih.
                  </div>

                  {/* Capability toggles */}
                  <div className="space-y-3">
                    {ALL_CAPABILITIES.map(cap => {
                      const isSupported = cap.providers.includes(currentProvider);
                      const isOn = botForm.capabilities?.[cap.id] || false;
                      return (
                        <div key={cap.id} className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${!isSupported ? 'opacity-50 border-steel-light/30 bg-steel-lightest/30' : isOn ? 'border-primary bg-primary/5' : 'border-steel-light/30 bg-white hover:border-steel-light'}`}>
                          <div className="flex items-start gap-3">
                            <span className="text-xl">{cap.icon}</span>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-sm text-gray-800">{cap.label}</p>
                                {!isSupported && <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold">Not supported for {currentProvider}</span>}
                              </div>
                              <p className="text-xs text-steel mt-0.5">{cap.desc}</p>
                              <div className="flex gap-1 mt-1">
                                {cap.providers.map(p => (
                                  <span key={p} className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-bold">{AI_PROVIDERS[p]?.icon} {p}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                          <button type="button"
                            disabled={!isSupported}
                            onClick={() => setBotForm(f => ({ ...f, capabilities: { ...f.capabilities, [cap.id]: !isOn } }))}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${isOn && isSupported ? 'bg-primary-dark' : 'bg-gray-200'} ${!isSupported ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isOn && isSupported ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {activeCapCount > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
                      ⚠️ <strong>{activeCapCount} capability aktif.</strong> Capabilities seperti Web Search & Code Interpreter mungkin memerlukan tier API berbayar. Pastikan API Key Anda mendukung fitur ini.
                    </div>
                  )}
                </div>
              )}

              {/* ── KNOWLEDGE BASE ───────────────────────────────── */}
              {botModalTab === 'knowledge' && (
                <div className="space-y-5">
                  <div className="text-xs text-steel bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    📚 Upload dokumen sebagai sumber pengetahuan bot. Mendukung <strong>PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), TXT, CSV, MD</strong>.
                    {!editingBot && <span className="block mt-1 font-bold text-amber-700">⚠️ Simpan bot dulu sebelum upload file.</span>}
                  </div>

                  {/* Knowledge Mode */}
                  <div>
                    <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-2">Mode Knowledge Base</label>
                    <div className="space-y-2">
                      {KNOWLEDGE_MODES.map(m => (
                        <label key={m.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${botForm.knowledgeMode === m.id ? 'border-primary-dark bg-primary-dark/5' : 'border-steel-light/30 hover:border-steel-light'}`}>
                          <input type="radio" name="knowledgeMode" value={m.id} checked={botForm.knowledgeMode === m.id} onChange={() => setBotForm({ ...botForm, knowledgeMode: m.id })} className="accent-primary-dark" />
                          <div>
                            <div className="text-sm font-bold">{m.label}</div>
                            <div className="text-xs text-steel">{m.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Upload zone */}
                  {editingBot && (
                    <div>
                      <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-2">Upload File</label>
                      <div onClick={() => knowledgeInputRef.current?.click()}
                        className="border-2 border-dashed border-steel-light/50 rounded-xl p-8 text-center cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-all">
                        {knowledgeUploading ? (
                          <div className="flex flex-col items-center gap-2 text-amber-600">
                            <div className="w-8 h-8 border-3 border-amber-300 border-t-amber-600 rounded-full animate-spin"></div>
                            <p className="font-bold text-sm">Memproses file...</p>
                          </div>
                        ) : (
                          <>
                            <div className="text-4xl mb-2">📁</div>
                            <p className="text-sm font-bold text-gray-700">Klik atau drag & drop</p>
                            <p className="text-xs text-steel mt-1">PDF • Word • Excel • <strong>PowerPoint</strong> • TXT • CSV • MD</p>
                            <p className="text-xs text-steel">Maks 20MB per file · Beberapa file sekaligus</p>
                          </>
                        )}
                      </div>
                      <input ref={knowledgeInputRef} type="file" multiple accept={SUPPORTED_FILE_TYPES} className="hidden" onChange={handleKnowledgeUpload} />
                    </div>
                  )}

                  {/* File list */}
                  {knowledgeFiles.length > 0 && (
                    <div>
                      <label className="text-xs font-bold text-steel uppercase tracking-wide block mb-2">Dokumen ({knowledgeFiles.length})</label>
                      <div className="space-y-2">
                        {knowledgeFiles.map(f => (
                          <div key={f._id} className="flex items-start gap-3 p-3 bg-steel-lightest/60 rounded-xl border border-steel-light/30 hover:border-steel-light transition-colors">
                            <span className="text-2xl flex-shrink-0">{getFileIcon(f.originalName)}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold truncate">{f.originalName}</p>
                              <p className="text-[10px] text-steel">{fmtSize(f.size)} · {new Date(f.uploadedAt).toLocaleDateString('id-ID')}</p>
                              {f.summary && <p className="text-[10px] text-steel-light mt-1 line-clamp-2">{f.summary}</p>}
                            </div>
                            {editingBot && (
                              <button onClick={() => handleDeleteKnowledge(f._id, f.originalName)} className="text-red-400 hover:text-red-600 text-xs font-bold flex-shrink-0">🗑</button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {editingBot && knowledgeFiles.length === 0 && !knowledgeUploading && (
                    <p className="text-center text-steel text-sm py-4">Belum ada dokumen. Upload file di atas.</p>
                  )}
                </div>
              )}

              {/* ── INTEGRATIONS ─────────────────────────────────── */}
              {botModalTab === 'integrations' && (
                <div className="space-y-4">
                  {[
                    {
                      key: 'smartsheet', label: 'Smartsheet Integration', icon: '📊',
                      fields: [
                        { key: 'sheetId', label: 'Sheet ID', type: 'text' },
                        { key: 'apiKey', label: 'API Key (override .env)', type: 'password' },
                      ]
                    },
                    {
                      key: 'onedrive', label: 'OneDrive Integration', icon: '☁️',
                      fields: [
                        { key: 'folderUrl', label: 'Folder URL', type: 'text' },
                        { key: 'tenantId', label: 'Tenant ID', type: 'text' },
                        { key: 'clientId', label: 'Client ID', type: 'text' },
                        { key: 'clientSecret', label: 'Client Secret', type: 'password' },
                      ]
                    },
                    {
                      key: 'kouventa', label: 'Kouventa AI Engine', icon: '🔗',
                      fields: [
                        { key: 'endpoint', label: 'Endpoint URL', type: 'text' },
                        { key: 'apiKey', label: 'API Key', type: 'password' },
                      ]
                    },
                  ].map(intg => {
                    const configKey = `${intg.key}Config`;
                    const config = botForm[configKey] || {};
                    return (
                      <div key={intg.key} className={`border-2 rounded-xl p-4 transition-all ${config.enabled ? 'border-primary/30 bg-primary/5' : 'border-steel-light/30 bg-white'}`}>
                        <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{intg.icon}</span>
                            <span className="font-bold text-sm">{intg.label}</span>
                          </div>
                          <button type="button"
                            onClick={() => setBotForm(f => ({ ...f, [configKey]: { ...f[configKey], enabled: !config.enabled } }))}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.enabled ? 'bg-primary-dark' : 'bg-gray-200'}`}>
                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${config.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                        {config.enabled && (
                          <div className={`space-y-2 ${intg.fields.length > 2 ? 'grid grid-cols-2 gap-2 space-y-0' : ''}`}>
                            {intg.fields.map(field => (
                              <input key={field.key} type={field.type} placeholder={field.label} autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                                className="w-full bg-white border border-steel-light/50 rounded-lg p-2 text-xs outline-none focus:border-primary transition-all"
                                value={config[field.key] || ''}
                                onChange={e => setBotForm(f => ({ ...f, [configKey]: { ...f[configKey], [field.key]: e.target.value } }))} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-steel-light/30 flex justify-between items-center bg-steel-lightest/30">
              <div>
                {editingBot && (
                  <button onClick={() => handleDeleteBot(editingBot._id)} className="px-4 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 font-bold text-sm rounded-lg transition-colors">
                    🗑 Hapus Bot
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowBotModal(false)} className="px-4 py-2 text-steel hover:text-gray-800 font-bold text-sm transition-colors">Batal</button>
                <button onClick={handleSaveBot} className="px-6 py-2 bg-primary-dark text-white rounded-xl font-bold hover:bg-primary text-sm transition-all shadow-sm hover:shadow">
                  {editingBot ? '✓ Simpan Perubahan' : '+ Buat Bot'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── USER MODAL ──────────────────────────────────────────── */}
      {showUserModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-steel-light/30">
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-bold text-primary-dark text-lg">{editingUser ? 'Edit User' : 'Add User'}</h3>
              <button onClick={() => setShowUserModal(false)} className="text-steel hover:text-gray-700 w-8 h-8 rounded-full hover:bg-steel-lightest flex items-center justify-center">✕</button>
            </div>
            <div className="space-y-3">
              <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded-xl p-3 text-sm focus:border-primary-dark outline-none" placeholder="Username" value={userForm.username} onChange={e => setUserForm({...userForm, username: e.target.value})} />
              <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded-xl p-3 text-sm focus:border-primary-dark outline-none" type="password" placeholder="Password (kosong = tidak berubah)" autoComplete="new-password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} />
              <label className="flex items-center gap-2 text-sm font-bold cursor-pointer">
                <input type="checkbox" checked={userForm.isAdmin} onChange={e => setUserForm({...userForm, isAdmin: e.target.checked})} className="accent-primary-dark" />
                <span>Administrator</span>
              </label>
              <div className="border border-steel-light/50 p-3 rounded-xl max-h-36 overflow-y-auto bg-steel-lightest/40">
                <p className="text-[10px] font-bold text-steel mb-2 uppercase tracking-wide">Bot Access</p>
                {bots.map(b => (
                  <label key={b._id} className="flex items-center gap-2 mb-1.5 text-sm cursor-pointer hover:bg-white rounded-lg px-1 py-0.5 transition-colors">
                    <input type="checkbox" checked={userForm.assignedBots.includes(b._id)} onChange={() => toggleBotAssignment(b._id)} className="accent-primary-dark" />
                    <BotAvatar bot={b} size="xs" />
                    <span className="truncate font-medium">{b.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowUserModal(false)} className="px-4 py-2 text-steel font-bold text-sm hover:text-gray-700 transition-colors">Batal</button>
              <button onClick={handleSaveUser} className="px-5 py-2 bg-primary-dark text-white rounded-xl font-bold text-sm hover:bg-primary transition-colors">Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AVATAR PICKER ─────────────────────────────────────── */}
      {avatarPickerBot && <AvatarPicker bot={avatarPickerBot} onSave={handleAvatarSaved} onClose={() => setAvatarPickerBot(null)} />}
    </div>
  );
}

export default AdminDashboard;
