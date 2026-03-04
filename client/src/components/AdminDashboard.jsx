import React, { useState, useEffect, useRef, useCallback } from 'react';
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

// ── AI Provider catalog (matches server) ──────────────────────
const AI_PROVIDERS = {
  openai: {
    label: 'OpenAI', icon: '🟢',
    models: [
      { id: 'gpt-4o',        label: 'GPT-4o (Recommended)' },
      { id: 'gpt-4o-mini',   label: 'GPT-4o Mini (Fast)'   },
      { id: 'gpt-4-turbo',   label: 'GPT-4 Turbo'          },
      { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Cheap)'},
    ],
  },
  anthropic: {
    label: 'Anthropic (Claude)', icon: '🟠',
    models: [
      { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6 (Powerful)' },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 (Balanced)'},
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fast)'    },
    ],
  },
  google: {
    label: 'Google Gemini', icon: '🔵',
    models: [
      { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro (Best)'  },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Fast)'},
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash'       },
    ],
  },
  custom: {
    label: 'Custom / OpenAI-Compatible', icon: '⚙️',
    models: [],
  },
};

const KNOWLEDGE_MODES = [
  { id: 'relevant', label: '🎯 Relevan saja', desc: 'Sisipkan knowledge hanya jika relevan dengan pertanyaan' },
  { id: 'always',   label: '📚 Selalu',       desc: 'Selalu sisipkan semua knowledge ke setiap percakapan'  },
  { id: 'disabled', label: '🚫 Nonaktif',     desc: 'Jangan gunakan knowledge base'                         },
];

const SUPPORTED_FILE_TYPES = '.pdf,.docx,.doc,.xlsx,.xls,.txt,.csv,.md';

const initialBotState = {
  name: '', description: '',
  systemPrompt: 'Anda adalah asisten AI profesional.',
  prompt: '',
  starterQuestions: [],
  knowledgeMode: 'relevant',
  aiProvider: { provider: 'openai', model: 'gpt-4o', apiKey: '', endpoint: '', temperature: 0.1, maxTokens: 2000 },
  smartsheetConfig:  { enabled: false, apiKey: '', sheetId: '' },
  kouventaConfig:    { enabled: false, apiKey: '', endpoint: '' },
  onedriveConfig:    { enabled: false, folderUrl: '', tenantId: '', clientId: '', clientSecret: '' },
  avatar: { type: 'emoji', emoji: '🤖', bgColor: '#6366f1', textColor: '#ffffff' },
};

// ── File size formatter ───────────────────────────────────────
const fmtSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// ── Main Component ────────────────────────────────────────────
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

  // Bot modal state
  const [showBotModal, setShowBotModal] = useState(false);
  const [editingBot,   setEditingBot]   = useState(null);
  const [botForm,      setBotForm]      = useState(initialBotState);
  const [botModalTab,  setBotModalTab]  = useState('basic'); // basic | ai | knowledge | integrations
  const [testAIState,  setTestAIState]  = useState(null);   // null | 'testing' | {ok, message}
  const [knowledgeUploading, setKnowledgeUploading] = useState(false);
  const [knowledgeFiles,     setKnowledgeFiles]     = useState([]); // local bot's files
  const knowledgeInputRef = useRef(null);

  // User modal state
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser,   setEditingUser]   = useState(null);
  const [userForm,      setUserForm]      = useState({ username: '', password: '', isAdmin: false, assignedBots: [] });

  // Avatar picker
  const [avatarPickerBot, setAvatarPickerBot] = useState(null);

  useEffect(() => { fetchStats(); fetchUsers(); fetchBots(); }, []);
  useEffect(() => { if (activeTab === 'chats') fetchChatLogs(); }, [activeTab, logPage]);

  const fetchStats  = async () => { try { const r = await axios.get('/api/admin/stats'); setStats(r.data); } catch {} };
  const fetchUsers  = async () => { try { const r = await axios.get('/api/admin/users'); setUsers(r.data.users || []); } catch {} };
  const fetchBots   = async () => {
    try { const r = await axios.get('/api/admin/bots'); setBots(Array.isArray(r.data) ? r.data : r.data.bots || []); }
    catch {}
  };
  const fetchChatLogs = async () => {
    setLoading(true);
    try { const r = await axios.get(`/api/admin/chat-logs?page=${logPage}&limit=20`); setChatLogs(r.data.chats || []); setLogTotalPages(r.data.totalPages || 1); }
    finally { setLoading(false); }
  };

  // ── Bot CRUD ────────────────────────────────────────────────
  const handleCreateBot = () => {
    setEditingBot(null);
    setBotForm(initialBotState);
    setKnowledgeFiles([]);
    setBotModalTab('basic');
    setTestAIState(null);
    setShowBotModal(true);
  };

  const handleEditBot = (bot) => {
    setEditingBot(bot);
    setBotForm({
      name: bot.name, description: bot.description || '',
      systemPrompt: bot.systemPrompt || '',
      prompt: bot.prompt || '',
      starterQuestions: bot.starterQuestions || [],
      knowledgeMode: bot.knowledgeMode || 'relevant',
      aiProvider: {
        provider:    bot.aiProvider?.provider    || 'openai',
        model:       bot.aiProvider?.model       || 'gpt-4o',
        apiKey:      bot.aiProvider?.apiKey      || '',
        endpoint:    bot.aiProvider?.endpoint    || '',
        temperature: bot.aiProvider?.temperature ?? 0.1,
        maxTokens:   bot.aiProvider?.maxTokens   ?? 2000,
      },
      smartsheetConfig:  { enabled: false, apiKey: '', sheetId: '', ...bot.smartsheetConfig },
      kouventaConfig:    { enabled: false, apiKey: '', endpoint: '', ...bot.kouventaConfig },
      onedriveConfig:    { enabled: false, folderUrl: '', tenantId: '', clientId: '', clientSecret: '', ...bot.onedriveConfig },
      avatar: bot.avatar || { type: 'emoji', emoji: '🤖', bgColor: '#6366f1' },
    });
    setKnowledgeFiles(bot.knowledgeFiles || []);
    setBotModalTab('basic');
    setTestAIState(null);
    setShowBotModal(true);
  };

  const handleSaveBot = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...botForm, starterQuestions: botForm.starterQuestions.filter(q => q.trim()) };
      if (editingBot) await axios.put(`/api/admin/bots/${editingBot._id}`, payload);
      else            await axios.post('/api/admin/bots', payload);
      setShowBotModal(false);
      fetchBots(); fetchStats();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const handleDeleteBot = async (id) => {
    if (!window.confirm('Hapus bot ini?')) return;
    try { await axios.delete(`/api/admin/bots/${id}`); fetchBots(); fetchStats(); }
    catch (e) { alert(e.message); }
  };

  // ── AI Provider test ────────────────────────────────────────
  const handleTestAI = async () => {
    setTestAIState('testing');
    try {
      let res;
      if (editingBot) {
        // First save current AI config, then test
        await axios.put(`/api/admin/bots/${editingBot._id}`, { ...botForm });
        res = await axios.post(`/api/admin/bots/${editingBot._id}/test-ai`);
      } else {
        res = await axios.post('/api/admin/test-ai-config', botForm.aiProvider);
      }
      setTestAIState(res.data);
    } catch (err) {
      setTestAIState({ ok: false, message: err.response?.data?.message || err.message });
    }
  };

  // ── Knowledge files ─────────────────────────────────────────
  const handleKnowledgeUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!editingBot) { alert('Simpan bot terlebih dahulu sebelum upload knowledge files.'); return; }

    setKnowledgeUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      const res = await axios.post(`/api/admin/bots/${editingBot._id}/knowledge`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      alert(res.data.message);
      // Refresh bot to get updated knowledge files
      const updated = await axios.get('/api/admin/bots');
      const fresh   = (Array.isArray(updated.data) ? updated.data : updated.data.bots || []).find(b => b._id === editingBot._id);
      setKnowledgeFiles(fresh?.knowledgeFiles || []);
      setBots(Array.isArray(updated.data) ? updated.data : updated.data.bots || []);
    } catch (err) {
      alert('Upload gagal: ' + (err.response?.data?.error || err.message));
    } finally {
      setKnowledgeUploading(false);
      if (knowledgeInputRef.current) knowledgeInputRef.current.value = '';
    }
  };

  const handleDeleteKnowledge = async (fileId, fileName) => {
    if (!window.confirm(`Hapus file "${fileName}"?`)) return;
    try {
      await axios.delete(`/api/admin/bots/${editingBot._id}/knowledge/${fileId}`);
      setKnowledgeFiles(prev => prev.filter(f => f._id !== fileId));
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  // ── Avatar ───────────────────────────────────────────────────
  const handleAvatarSaved = (updatedBot) => {
    setBots(prev => prev.map(b => b._id === updatedBot._id ? updatedBot : b));
    if (editingBot?._id === updatedBot._id) { setEditingBot(updatedBot); setBotForm(p => ({ ...p, avatar: updatedBot.avatar })); }
  };

  // ── Starter questions ────────────────────────────────────────
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
    datasets: [{ label: 'Daily Messages', data: stats?.activityTrend?.map(d => d.count) || [], borderColor: '#007857', backgroundColor: 'rgba(0, 120, 87, 0.15)', tension: 0.3, fill: true, pointBackgroundColor: '#004E36' }]
  };
  const pieColors = ['#004E36','#007857','#48AE92','#6E6F72','#A5A7AA','#F0F1F1'];
  const pieChartData = {
    labels: stats?.botPopularity?.map(b => b.name) || [],
    datasets: [{ data: stats?.botPopularity?.map(b => b.count) || [], backgroundColor: pieColors, borderWidth: 2, borderColor: '#ffffff' }]
  };

  const currentProvider  = botForm.aiProvider?.provider || 'openai';
  const availableModels  = AI_PROVIDERS[currentProvider]?.models || [];

  return (
    <div className="min-h-screen bg-steel-lightest/50 text-gray-800 font-sans">

      {/* NAV */}
      <nav className="bg-white border-b border-steel-light/30 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src="/assets/gys-logo.webp" alt="GYS" className="h-9 w-auto" onError={e => { e.target.style.display = 'none'; document.getElementById('al-fallback')?.style.removeProperty('display'); }} />
            <div id="al-fallback" style={{display:'none'}} className="w-9 h-9 bg-primary-dark rounded flex items-center justify-center font-bold text-white">G</div>
            <h1 className="text-xl font-bold text-primary-dark">GYS Admin Portal</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-steel">Welcome, {user.username}</span>
            <button onClick={() => navigate('/')} className="px-3 py-1.5 text-xs bg-steel-lightest hover:bg-steel-light/30 text-primary-dark rounded border border-steel-light/50 font-bold">Back to Chat</button>
            <button onClick={handleLogout}       className="px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded border border-red-200 font-bold">Logout</button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex space-x-1">
            {[{id:'dashboard',label:'📊 Dashboard'},{id:'users',label:'👥 Users'},{id:'chats',label:'👁️ Logs'},{id:'bots',label:'🤖 Bots'}].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === tab.id ? 'border-primary-dark text-primary-dark' : 'border-transparent text-steel hover:text-gray-800'}`}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* ── DASHBOARD ────────────────────────────────────── */}
        {activeTab === 'dashboard' && stats && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard title="Total Users"   value={stats.totalUsers}   icon="👥" color="text-primary-dark"  border="border-l-4 border-l-primary-dark" />
              <StatCard title="Active Bots"   value={stats.totalBots}    icon="🤖" color="text-primary"       border="border-l-4 border-l-primary" />
              <StatCard title="Total Chats"   value={stats.totalChats}   icon="💬" color="text-primary-light" border="border-l-4 border-l-primary-light" />
              <StatCard title="Total Threads" value={stats.totalThreads} icon="📂" color="text-steel"         border="border-l-4 border-l-steel" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white p-6 rounded-lg border border-steel-light/30 shadow-sm">
                <h3 className="font-bold text-primary-dark mb-4">Weekly Activity</h3>
                <div className="h-64"><Line data={lineChartData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { grid: { color: '#F0F1F1' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }} /></div>
              </div>
              <div className="bg-white p-6 rounded-lg border border-steel-light/30 shadow-sm flex flex-col items-center">
                <h3 className="font-bold text-primary-dark mb-4">Bot Popularity</h3>
                <div className="h-48 w-full flex justify-center"><Doughnut data={pieChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#6E6F72', boxWidth: 12, padding: 15 } } }, cutout: '65%' }} /></div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-steel-light/30 overflow-hidden">
              <div className="px-6 py-4 border-b border-steel-light/30 bg-steel-lightest/50"><h3 className="font-bold text-primary-dark">🏆 Top Contributors</h3></div>
              <table className="w-full text-sm"><thead className="bg-steel-lightest text-steel uppercase text-xs"><tr><th className="px-6 py-3 text-left">Rank</th><th className="px-6 py-3 text-left">Username</th><th className="px-6 py-3 text-right">Messages</th></tr></thead>
                <tbody className="divide-y divide-steel-light/30">
                  {stats.topUsers?.map((u, i) => <tr key={i} className="hover:bg-steel-lightest/50"><td className="px-6 py-3 font-bold text-steel">#{i+1}</td><td className="px-6 py-3 font-semibold">{u.username}</td><td className="px-6 py-3 text-right font-mono text-primary font-bold">{u.count}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── USERS ────────────────────────────────────────── */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-lg shadow-sm border border-steel-light/30 overflow-hidden">
            <div className="px-6 py-4 border-b border-steel-light/30 flex justify-between items-center bg-steel-lightest/50">
              <h2 className="font-bold text-primary-dark">User Management</h2>
              <button onClick={() => { setEditingUser(null); setUserForm({username:'',password:'',isAdmin:false,assignedBots:[]}); setShowUserModal(true); }} className="px-4 py-2 bg-primary-dark text-white text-sm font-bold rounded hover:bg-primary">+ Add User</button>
            </div>
            <table className="w-full text-sm"><thead className="bg-steel-lightest text-steel uppercase text-xs"><tr><th className="px-6 py-3 text-left">User</th><th className="px-6 py-3 text-left">Role</th><th className="px-6 py-3 text-left">Bots</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-steel-light/30">
                {users.map(u => <tr key={u._id} className="hover:bg-steel-lightest/50"><td className="px-6 py-3 font-medium">{u.username}</td><td className="px-6 py-3">{u.isAdmin ? <span className="bg-primary-dark text-white px-2 py-0.5 rounded text-xs font-bold">ADMIN</span> : 'User'}</td><td className="px-6 py-3">{u.assignedBots?.length || 0} bots</td><td className="px-6 py-3 text-right"><button onClick={() => handleEditUser(u)} className="text-primary hover:text-primary-dark font-bold">Edit</button></td></tr>)}
              </tbody>
            </table>
          </div>
        )}

        {/* ── CHAT LOGS ─────────────────────────────────────── */}
        {activeTab === 'chats' && (
          <div className="bg-white rounded-lg shadow-sm border border-steel-light/30 overflow-hidden flex flex-col h-[700px]">
            <div className="px-6 py-4 border-b border-steel-light/30 flex justify-between items-center bg-steel-lightest/50">
              <h2 className="font-bold text-primary-dark">Chat Logs</h2>
              <div className="flex items-center gap-2">
                <input type="month" value={exportFilter} onChange={e => setExportFilter(e.target.value)} className="bg-white border border-steel-light/50 rounded text-sm px-3 py-1.5 outline-none" />
                <button onClick={handleExport} className="px-4 py-2 bg-primary text-white text-sm font-bold rounded hover:bg-primary-dark">⬇ Export CSV</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm"><thead className="bg-steel-lightest text-steel uppercase text-xs sticky top-0"><tr><th className="px-6 py-3 text-left">Time</th><th className="px-6 py-3 text-left">User</th><th className="px-6 py-3 text-left">Bot</th><th className="px-6 py-3 text-left">Message</th></tr></thead>
                <tbody className="divide-y divide-steel-light/30">
                  {chatLogs.map(log => <tr key={log._id} className="hover:bg-steel-lightest/50"><td className="px-6 py-3 text-xs text-steel whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td><td className="px-6 py-3 font-medium">{log.userId?.username||'Unknown'}</td><td className="px-6 py-3 text-primary font-bold">{log.botId?.name||'System'}</td><td className="px-6 py-3 truncate max-w-xs text-steel">{log.content||(log.attachedFiles?.length?'📎 Attachment':'-')}</td></tr>)}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-steel-light/30 bg-steel-lightest/50 flex justify-between items-center text-xs text-steel">
              <span>Page {logPage} of {logTotalPages}</span>
              <div className="space-x-2">
                <button disabled={logPage===1} onClick={()=>setLogPage(p=>p-1)} className="px-3 py-1 bg-white border border-steel-light/50 rounded hover:bg-steel-lightest disabled:opacity-50 font-bold">Prev</button>
                <button disabled={logPage===logTotalPages} onClick={()=>setLogPage(p=>p+1)} className="px-3 py-1 bg-white border border-steel-light/50 rounded hover:bg-steel-lightest disabled:opacity-50 font-bold">Next</button>
              </div>
            </div>
          </div>
        )}

        {/* ── BOTS ─────────────────────────────────────────── */}
        {activeTab === 'bots' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div onClick={handleCreateBot} className="bg-steel-lightest/30 rounded-lg border-2 border-dashed border-steel-light/50 p-6 flex flex-col items-center justify-center cursor-pointer hover:border-primary-dark hover:bg-white transition-all min-h-[200px] group">
              <div className="w-12 h-12 bg-steel-lightest text-steel rounded-full flex items-center justify-center mb-3 text-2xl font-bold group-hover:bg-primary-dark group-hover:text-white transition-colors border border-steel-light/30">+</div>
              <span className="font-semibold text-steel group-hover:text-primary-dark">Create New Bot</span>
            </div>
            {bots.map(bot => (
              <div key={bot._id} className="bg-white rounded-lg shadow-sm border border-steel-light/30 p-6 hover:shadow-md transition-all">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="relative group/av cursor-pointer" onClick={() => setAvatarPickerBot(bot)}>
                      <BotAvatar bot={bot} size="md" />
                      <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover/av:opacity-100 transition-opacity flex items-center justify-center"><span className="text-white text-[9px] font-bold">EDIT</span></div>
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-primary-dark">{bot.name}</h3>
                      <p className="text-xs text-steel-light">{bot.description?.substring(0, 40) || 'No description'}</p>
                    </div>
                  </div>
                  <button onClick={() => handleEditBot(bot)} className="text-steel hover:text-primary-dark bg-steel-lightest hover:bg-steel-light/30 px-3 py-1 rounded text-xs font-bold">CONFIG</button>
                </div>

                {/* Provider badge */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                    {AI_PROVIDERS[bot.aiProvider?.provider || 'openai']?.icon} {bot.aiProvider?.model || 'gpt-4o'}
                  </span>
                  {bot.knowledgeFiles?.length > 0 && <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase">📚 {bot.knowledgeFiles.length} docs</span>}
                  {bot.smartsheetConfig?.enabled && <span className="bg-steel-lightest text-steel px-2 py-0.5 rounded border border-steel-light/50 text-[10px] font-bold uppercase">Smartsheet</span>}
                  {bot.kouventaConfig?.enabled   && <span className="bg-primary-light/10 text-primary-dark px-2 py-0.5 rounded border border-primary-light/30 text-[10px] font-bold uppercase">Kouventa</span>}
                </div>

                <button onClick={() => setAvatarPickerBot(bot)} className="mt-4 w-full py-1.5 text-[11px] font-bold text-steel hover:text-indigo-600 hover:bg-indigo-50 rounded-lg border border-steel-light/30 hover:border-indigo-200 transition-all">🎨 Ganti Avatar</button>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ══════════════════════════════════════════════
          BOT MODAL
      ══════════════════════════════════════════════ */}
      {showBotModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col border border-steel-light/30">

            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-steel-light/30 flex justify-between items-center bg-steel-lightest/50 rounded-t-xl">
              <div className="flex items-center gap-3">
                <BotAvatar bot={editingBot || { avatar: botForm.avatar }} size="sm" />
                <div>
                  <h3 className="font-bold text-primary-dark">{editingBot ? `Edit — ${editingBot.name}` : 'Create New Bot'}</h3>
                  <p className="text-xs text-steel-light">{editingBot ? 'Konfigurasi bot yang sudah ada' : 'Buat bot AI baru'}</p>
                </div>
              </div>
              <button onClick={() => setShowBotModal(false)} className="text-steel hover:text-gray-800">✕</button>
            </div>

            {/* Modal Sub-tabs */}
            <div className="flex border-b border-steel-light/30 bg-white px-4">
              {[
                { id: 'basic',        label: '📝 Basic' },
                { id: 'ai',           label: '🤖 AI Provider' },
                { id: 'knowledge',    label: `📚 Knowledge ${knowledgeFiles.length ? `(${knowledgeFiles.length})` : ''}` },
                { id: 'integrations', label: '🔌 Integrations' },
              ].map(t => (
                <button key={t.id} onClick={() => setBotModalTab(t.id)}
                  className={`px-4 py-3 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${botModalTab === t.id ? 'border-primary-dark text-primary-dark' : 'border-transparent text-steel hover:text-gray-800'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">

              {/* ── Tab: BASIC ────────────────────────────── */}
              {botModalTab === 'basic' && (
                <div className="space-y-5">
                  {/* Avatar */}
                  <div className="flex items-center gap-4 p-4 bg-steel-lightest/50 rounded-xl border border-steel-light/30">
                    <div className="relative group/av cursor-pointer" onClick={() => editingBot && setAvatarPickerBot(editingBot)}>
                      <BotAvatar bot={editingBot || { avatar: botForm.avatar }} size="lg" />
                      {editingBot && <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover/av:opacity-100 transition-opacity flex items-center justify-center"><span className="text-white text-[9px] font-bold">EDIT</span></div>}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-700 text-sm">Avatar Bot</p>
                      <p className="text-xs text-steel-light mt-0.5">Upload gambar, emoji, atau icon</p>
                      {editingBot
                        ? <button type="button" onClick={() => setAvatarPickerBot(editingBot)} className="mt-2 px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-bold">🎨 Ganti Avatar</button>
                        : <p className="text-xs text-steel mt-2 italic">Simpan bot dulu, lalu ganti avatar.</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-steel block mb-1">Nama Bot *</label>
                      <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-sm focus:border-primary-dark outline-none" placeholder="Contoh: HR Assistant" value={botForm.name} onChange={e => setBotForm({...botForm, name: e.target.value})} />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-steel block mb-1">Deskripsi</label>
                      <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-sm focus:border-primary-dark outline-none" placeholder="Singkat, untuk tampilan sidebar" value={botForm.description} onChange={e => setBotForm({...botForm, description: e.target.value})} />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-steel block mb-1">System Prompt / Instruksi Utama</label>
                    <textarea className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-3 text-sm h-40 font-mono focus:border-primary-dark outline-none resize-none"
                      placeholder="Contoh: Anda adalah asisten HR yang membantu karyawan menjawab pertanyaan seputar cuti, absensi, dan kebijakan perusahaan. Selalu jawab dengan ramah dan profesional."
                      value={botForm.prompt} onChange={e => setBotForm({...botForm, prompt: e.target.value})} />
                    <p className="text-[10px] text-steel mt-1">Prompt ini mendefinisikan karakter, tugas, dan batasan bot.</p>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-steel block mb-2">Starter Questions</label>
                    <div className="space-y-2">
                      {botForm.starterQuestions.map((q, i) => (
                        <div key={i} className="flex gap-2">
                          <input className="flex-1 bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-sm focus:border-primary outline-none" value={q} onChange={e => updateQuestion(i, e.target.value)} placeholder={`Pertanyaan ${i+1}...`} />
                          <button onClick={() => removeQuestion(i)} className="text-red-400 hover:text-red-600 font-bold px-2">✕</button>
                        </div>
                      ))}
                      <button onClick={addQuestion} className="text-primary text-xs font-bold hover:underline">+ Tambah Pertanyaan</button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Tab: AI PROVIDER ──────────────────────── */}
              {botModalTab === 'ai' && (
                <div className="space-y-5">
                  <p className="text-xs text-steel bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                    Pilih AI provider dan model yang akan digunakan oleh bot ini. API Key bisa diset per-bot (override) atau biarkan kosong untuk menggunakan key dari server <code>.env</code>.
                  </p>

                  {/* Provider */}
                  <div>
                    <label className="text-xs font-bold text-steel block mb-2">AI Provider</label>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(AI_PROVIDERS).map(([key, prov]) => (
                        <button key={key} type="button"
                          onClick={() => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, provider: key, model: prov.models[0]?.id || '' } }))}
                          className={`p-3 rounded-lg border-2 text-left transition-all ${currentProvider === key ? 'border-primary-dark bg-primary-dark/5' : 'border-steel-light/50 hover:border-steel-light'}`}>
                          <div className="text-lg mb-1">{prov.icon}</div>
                          <div className="text-xs font-bold text-gray-800">{prov.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Model */}
                  <div>
                    <label className="text-xs font-bold text-steel block mb-1">Model</label>
                    {availableModels.length > 0 ? (
                      <select className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-sm focus:border-primary-dark outline-none"
                        value={botForm.aiProvider?.model || ''}
                        onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, model: e.target.value } }))}>
                        {availableModels.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    ) : (
                      <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-sm focus:border-primary-dark outline-none"
                        placeholder="Model ID, e.g. gpt-4o atau llama3:8b"
                        value={botForm.aiProvider?.model || ''}
                        onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, model: e.target.value } }))} />
                    )}
                  </div>

                  {/* API Key */}
                  <div>
                    <label className="text-xs font-bold text-steel block mb-1">API Key (opsional — override .env)</label>
                    <input type="password" className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-sm focus:border-primary-dark outline-none"
                      placeholder="Kosongkan untuk pakai key dari .env server"
                      value={botForm.aiProvider?.apiKey || ''}
                      onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, apiKey: e.target.value } }))} />
                  </div>

                  {/* Custom endpoint */}
                  {(currentProvider === 'custom' || currentProvider === 'openai') && (
                    <div>
                      <label className="text-xs font-bold text-steel block mb-1">
                        {currentProvider === 'custom' ? 'Endpoint URL *' : 'Custom Base URL (opsional — Azure / proxy)'}
                      </label>
                      <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-sm focus:border-primary-dark outline-none"
                        placeholder={currentProvider === 'custom' ? 'https://your-api.example.com/v1' : 'https://your-azure-endpoint.openai.azure.com/openai/deployments/...'}
                        value={botForm.aiProvider?.endpoint || ''}
                        onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, endpoint: e.target.value } }))} />
                    </div>
                  )}

                  {/* Params */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-steel block mb-1">Temperature ({botForm.aiProvider?.temperature ?? 0.1})</label>
                      <input type="range" min="0" max="1" step="0.1"
                        value={botForm.aiProvider?.temperature ?? 0.1}
                        onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, temperature: parseFloat(e.target.value) } }))}
                        className="w-full accent-primary-dark" />
                      <div className="flex justify-between text-[10px] text-steel mt-0.5"><span>Presisi</span><span>Kreatif</span></div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-steel block mb-1">Max Tokens</label>
                      <input type="number" min="256" max="8000" step="256"
                        className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-sm focus:border-primary-dark outline-none"
                        value={botForm.aiProvider?.maxTokens ?? 2000}
                        onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, maxTokens: parseInt(e.target.value) } }))} />
                    </div>
                  </div>

                  {/* Test Connection */}
                  <div className="pt-2 border-t border-steel-light/30">
                    <button type="button" onClick={handleTestAI} disabled={testAIState === 'testing'}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded hover:bg-indigo-700 disabled:opacity-60 transition-colors">
                      {testAIState === 'testing' ? '⏳ Testing...' : '🔌 Test Koneksi'}
                    </button>
                    {testAIState && testAIState !== 'testing' && (
                      <div className={`mt-3 p-3 rounded-lg text-xs ${testAIState.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                        {testAIState.ok ? '✅' : '❌'} {testAIState.message}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Tab: KNOWLEDGE BASE ───────────────────── */}
              {botModalTab === 'knowledge' && (
                <div className="space-y-5">
                  <p className="text-xs text-steel bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                    Upload file dokumen (PDF, Word, Excel, TXT, CSV) sebagai sumber pengetahuan bot. Bot akan menggunakan isi file ini saat menjawab pertanyaan.
                    {!editingBot && <span className="block mt-1 font-bold text-amber-700">⚠️ Simpan bot terlebih dahulu sebelum upload file.</span>}
                  </p>

                  {/* Knowledge Mode */}
                  <div>
                    <label className="text-xs font-bold text-steel block mb-2">Mode Knowledge Base</label>
                    <div className="space-y-2">
                      {KNOWLEDGE_MODES.map(m => (
                        <label key={m.id} className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${botForm.knowledgeMode === m.id ? 'border-primary-dark bg-primary-dark/5' : 'border-steel-light/30 hover:border-steel-light'}`}>
                          <input type="radio" name="knowledgeMode" value={m.id} checked={botForm.knowledgeMode === m.id} onChange={() => setBotForm({ ...botForm, knowledgeMode: m.id })} className="mt-0.5 accent-primary-dark" />
                          <div>
                            <div className="text-sm font-bold text-gray-800">{m.label}</div>
                            <div className="text-xs text-steel mt-0.5">{m.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Upload area */}
                  {editingBot && (
                    <div>
                      <label className="text-xs font-bold text-steel block mb-2">Upload File</label>
                      <div
                        onClick={() => knowledgeInputRef.current?.click()}
                        className="border-2 border-dashed border-steel-light/50 rounded-xl p-8 text-center cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-all">
                        {knowledgeUploading ? (
                          <div className="text-amber-600 font-bold">⏳ Memproses file...</div>
                        ) : (
                          <>
                            <div className="text-3xl mb-2">📁</div>
                            <p className="text-sm font-bold text-gray-700">Klik untuk upload dokumen</p>
                            <p className="text-xs text-steel mt-1">PDF, Word (.docx), Excel (.xlsx), TXT, CSV — Maks 20 MB per file</p>
                            <p className="text-xs text-steel">Bisa upload beberapa file sekaligus</p>
                          </>
                        )}
                      </div>
                      <input ref={knowledgeInputRef} type="file" multiple accept={SUPPORTED_FILE_TYPES} className="hidden" onChange={handleKnowledgeUpload} />
                    </div>
                  )}

                  {/* File list */}
                  {knowledgeFiles.length > 0 && (
                    <div>
                      <label className="text-xs font-bold text-steel block mb-2">Dokumen Tersimpan ({knowledgeFiles.length})</label>
                      <div className="space-y-2">
                        {knowledgeFiles.map(f => {
                          const ext = f.originalName?.split('.').pop()?.toLowerCase() || '';
                          const icon = ext === 'pdf' ? '📕' : ext === 'docx' || ext === 'doc' ? '📘' : ext === 'xlsx' || ext === 'xls' ? '📗' : '📄';
                          return (
                            <div key={f._id} className="flex items-start gap-3 p-3 bg-steel-lightest/50 rounded-lg border border-steel-light/30">
                              <span className="text-xl flex-shrink-0">{icon}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-gray-800 truncate">{f.originalName}</p>
                                <p className="text-[10px] text-steel mt-0.5">{fmtSize(f.size)} · {new Date(f.uploadedAt).toLocaleDateString('id-ID')}</p>
                                {f.summary && <p className="text-[10px] text-steel-light mt-1 line-clamp-2">{f.summary}</p>}
                              </div>
                              {editingBot && (
                                <button onClick={() => handleDeleteKnowledge(f._id, f.originalName)} className="text-red-400 hover:text-red-600 text-xs font-bold flex-shrink-0 px-2">🗑</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {editingBot && knowledgeFiles.length === 0 && !knowledgeUploading && (
                    <p className="text-center text-steel text-sm py-4">Belum ada dokumen. Upload file di atas.</p>
                  )}
                </div>
              )}

              {/* ── Tab: INTEGRATIONS ─────────────────────── */}
              {botModalTab === 'integrations' && (
                <div className="space-y-4">
                  {/* Smartsheet */}
                  <div className="border border-steel-light/30 rounded-lg p-4 bg-steel-lightest/50">
                    <div className="flex justify-between items-center mb-3">
                      <span className="font-bold text-gray-800 text-sm">Smartsheet Integration</span>
                      <input type="checkbox" checked={botForm.smartsheetConfig.enabled} onChange={e => setBotForm({...botForm, smartsheetConfig: {...botForm.smartsheetConfig, enabled: e.target.checked}})} className="w-4 h-4 accent-primary-dark" />
                    </div>
                    {botForm.smartsheetConfig.enabled && (
                      <div className="space-y-2">
                        <input placeholder="Sheet ID" className="w-full bg-white border border-steel-light/50 rounded p-2 text-xs outline-none focus:border-primary" value={botForm.smartsheetConfig.sheetId} onChange={e => setBotForm({...botForm, smartsheetConfig: {...botForm.smartsheetConfig, sheetId: e.target.value}})} />
                        <input type="password" placeholder="API Key (opsional — override .env)" className="w-full bg-white border border-steel-light/50 rounded p-2 text-xs outline-none focus:border-primary" value={botForm.smartsheetConfig.apiKey} onChange={e => setBotForm({...botForm, smartsheetConfig: {...botForm.smartsheetConfig, apiKey: e.target.value}})} />
                      </div>
                    )}
                  </div>

                  {/* OneDrive */}
                  <div className="border border-steel-light/30 rounded-lg p-4 bg-steel-lightest/50">
                    <div className="flex justify-between items-center mb-3">
                      <span className="font-bold text-gray-800 text-sm">OneDrive Integration</span>
                      <input type="checkbox" checked={botForm.onedriveConfig.enabled} onChange={e => setBotForm({...botForm, onedriveConfig: {...botForm.onedriveConfig, enabled: e.target.checked}})} className="w-4 h-4 accent-primary-dark" />
                    </div>
                    {botForm.onedriveConfig.enabled && (
                      <div className="space-y-2">
                        <input placeholder="Folder URL" className="w-full bg-white border border-steel-light/50 rounded p-2 text-xs outline-none focus:border-primary" value={botForm.onedriveConfig.folderUrl} onChange={e => setBotForm({...botForm, onedriveConfig: {...botForm.onedriveConfig, folderUrl: e.target.value}})} />
                        <div className="grid grid-cols-3 gap-2">
                          <input placeholder="Tenant ID" className="bg-white border border-steel-light/50 rounded p-2 text-xs outline-none focus:border-primary" value={botForm.onedriveConfig.tenantId} onChange={e => setBotForm({...botForm, onedriveConfig: {...botForm.onedriveConfig, tenantId: e.target.value}})} />
                          <input placeholder="Client ID" className="bg-white border border-steel-light/50 rounded p-2 text-xs outline-none focus:border-primary" value={botForm.onedriveConfig.clientId} onChange={e => setBotForm({...botForm, onedriveConfig: {...botForm.onedriveConfig, clientId: e.target.value}})} />
                          <input type="password" placeholder="Secret" className="bg-white border border-steel-light/50 rounded p-2 text-xs outline-none focus:border-primary" value={botForm.onedriveConfig.clientSecret} onChange={e => setBotForm({...botForm, onedriveConfig: {...botForm.onedriveConfig, clientSecret: e.target.value}})} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Kouventa */}
                  <div className="border border-steel-light/30 rounded-lg p-4 bg-steel-lightest/50">
                    <div className="flex justify-between items-center mb-3">
                      <span className="font-bold text-primary text-sm">Kouventa AI Engine</span>
                      <input type="checkbox" checked={botForm.kouventaConfig.enabled} onChange={e => setBotForm({...botForm, kouventaConfig: {...botForm.kouventaConfig, enabled: e.target.checked}})} className="w-4 h-4 accent-primary-dark" />
                    </div>
                    {botForm.kouventaConfig.enabled && (
                      <div className="space-y-2">
                        <input placeholder="Endpoint URL" className="w-full bg-white border border-steel-light/50 rounded p-2 text-xs outline-none focus:border-primary" value={botForm.kouventaConfig.endpoint} onChange={e => setBotForm({...botForm, kouventaConfig: {...botForm.kouventaConfig, endpoint: e.target.value}})} />
                        <input type="password" placeholder="API Key" className="w-full bg-white border border-steel-light/50 rounded p-2 text-xs outline-none focus:border-primary" value={botForm.kouventaConfig.apiKey} onChange={e => setBotForm({...botForm, kouventaConfig: {...botForm.kouventaConfig, apiKey: e.target.value}})} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-steel-light/30 flex justify-between items-center rounded-b-xl bg-steel-lightest/50">
              <div>
                {editingBot && <button onClick={() => handleDeleteBot(editingBot._id)} className="px-4 py-2 text-red-600 hover:text-red-700 font-bold text-sm">Hapus Bot</button>}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowBotModal(false)} className="px-4 py-2 text-steel hover:text-gray-800 font-bold text-sm">Batal</button>
                <button onClick={handleSaveBot} className="px-6 py-2 bg-primary-dark text-white rounded font-bold hover:bg-primary text-sm transition-colors">
                  {editingBot ? 'Simpan Perubahan' : 'Buat Bot'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── USER MODAL ──────────────────────────────────────── */}
      {showUserModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 border border-steel-light/30">
            <h3 className="font-bold text-primary-dark mb-4 text-lg">{editingUser ? 'Edit User' : 'Add User'}</h3>
            <div className="space-y-3">
              <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-sm focus:border-primary-dark outline-none" placeholder="Username" value={userForm.username} onChange={e => setUserForm({...userForm, username: e.target.value})} />
              <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-sm focus:border-primary-dark outline-none" type="password" placeholder="Password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} />
              <label className="flex items-center space-x-2 text-sm font-bold"><input type="checkbox" checked={userForm.isAdmin} onChange={e => setUserForm({...userForm, isAdmin: e.target.checked})} /><span>Set as Administrator</span></label>
              <div className="border border-steel-light/50 p-3 rounded max-h-32 overflow-y-auto bg-steel-lightest/50">
                <p className="text-xs font-bold text-steel mb-2 uppercase">Bot Assignment</p>
                {bots.map(b => (
                  <label key={b._id} className="flex items-center gap-2 mb-1 text-sm font-medium cursor-pointer">
                    <input type="checkbox" checked={userForm.assignedBots.includes(b._id)} onChange={() => toggleBotAssignment(b._id)} />
                    <BotAvatar bot={b} size="xs" />
                    <span className="truncate">{b.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowUserModal(false)} className="px-4 py-2 text-steel font-bold text-sm">Batal</button>
              <button onClick={handleSaveUser} className="px-4 py-2 bg-primary-dark text-white rounded font-bold text-sm">Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AVATAR PICKER ────────────────────────────────────── */}
      {avatarPickerBot && <AvatarPicker bot={avatarPickerBot} onSave={handleAvatarSaved} onClose={() => setAvatarPickerBot(null)} />}
    </div>
  );
}

const StatCard = ({ title, value, icon, color, border }) => (
  <div className={`bg-white p-5 rounded-lg border border-steel-light/30 shadow-sm flex items-center justify-between hover:shadow-md transition-all ${border}`}>
    <div><p className="text-xs text-steel uppercase tracking-wider mb-1 font-bold">{title}</p><h2 className={`text-2xl font-bold ${color}`}>{value}</h2></div>
    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${color}`}>{icon}</div>
  </div>
);

export default AdminDashboard;
