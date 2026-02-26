import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  Filler // ✅ FIX 1: Import Plugin Filler agar opsi 'fill: true' tidak error
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';

// ✅ FIX 1: Register Filler
ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, 
  BarElement, Title, Tooltip, Legend, ArcElement, Filler
);

function AdminDashboard({ user, handleLogout }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'users' | 'chats' | 'bots'

  // --- STATES DATA ---
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [bots, setBots] = useState([]);
  const [chatLogs, setChatLogs] = useState([]);

  // --- STATES UI ---
  const [logPage, setLogPage] = useState(1);
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exportFilter, setExportFilter] = useState(''); // "YYYY-MM"

  // --- FORMS STATE ---
  const [showBotModal, setShowBotModal] = useState(false);
  const [editingBot, setEditingBot] = useState(null);
  
  // ✅ FIX 3: Definisi State Awal Bot yang Lengkap (Mencegah error saat Create New Bot)
  const initialBotState = {
      name: '', 
      description: '', 
      systemPrompt: 'Anda adalah asisten AI profesional.',
      prompt: '', // Field baru untuk custom prompt backend
      starterQuestions: [],
      smartsheetConfig: { enabled: false, apiKey: '', sheetId: '' },
      kouventaConfig: { enabled: false, apiKey: '', endpoint: '' },
      onedriveConfig: { enabled: false, folderUrl: '', tenantId: '', clientId: '', clientSecret: '' }
  };

  const [botForm, setBotForm] = useState(initialBotState);

  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({ username: '', password: '', isAdmin: false, assignedBots: [] });

  // --- INITIAL LOAD ---
  useEffect(() => {
    fetchStats();
    fetchUsers();
    fetchBots();
  }, []);

  useEffect(() => {
    if (activeTab === 'chats') fetchChatLogs();
  }, [activeTab, logPage]);

  // === API CALLS ===
  const fetchStats = async () => {
    try {
      const res = await axios.get('/api/admin/stats');
      setStats(res.data);
    } catch (error) { console.error("Stats error:", error); }
  };

  const fetchUsers = async () => {
    try { 
        const res = await axios.get('/api/admin/users'); 
        // Safeguard: Pastikan users selalu array
        setUsers(res.data.users || []); 
    }
    catch (error) { console.error(error); setUsers([]); }
  };

  const fetchBots = async () => {
    try { 
        const res = await axios.get('/api/admin/bots'); 
        // ✅ FIX 2: Handle response format (Array langsung vs Object)
        // Mencegah error "map of undefined" jika backend mengembalikan array langsung
        const botData = Array.isArray(res.data) ? res.data : (res.data.bots || []);
        setBots(botData); 
    }
    catch (error) { console.error("Fetch Bots Error:", error); setBots([]); }
  };

  const fetchChatLogs = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/admin/chat-logs?page=${logPage}&limit=20`);
      setChatLogs(res.data.chats || []);
      setLogTotalPages(res.data.totalPages || 1);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  const handleExport = async () => {
      try {
          let url = '/api/admin/export-chats';
          if (exportFilter) {
              const [year, month] = exportFilter.split('-');
              url += `?year=${year}&month=${month}`;
          }
          const response = await axios.get(url, { responseType: 'blob' });
          const urlObj = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = urlObj;
          const fileName = exportFilter ? `chat-logs-${exportFilter}.csv` : `chat-logs-all-${new Date().toISOString().slice(0,10)}.csv`;
          link.setAttribute('download', fileName);
          document.body.appendChild(link);
          link.click();
          link.remove();
      } catch (error) { alert('Export failed'); }
  };

  // === BOT LOGIC ===
  const handleCreateBot = () => {
      setEditingBot(null);
      setBotForm(initialBotState); // ✅ Reset form dengan state yang bersih & lengkap
      setShowBotModal(true);
  };

  const handleEditBot = (bot) => {
      setEditingBot(bot);
      // ✅ Populate form dengan data yang ada, fallback ke default jika kosong
      setBotForm({
          name: bot.name,
          description: bot.description || '',
          systemPrompt: bot.systemPrompt || '',
          prompt: bot.prompt || '', // Field prompt baru
          starterQuestions: bot.starterQuestions || [],
          smartsheetConfig: { enabled: false, apiKey: '', sheetId: '', ...bot.smartsheetConfig },
          kouventaConfig: { enabled: false, apiKey: '', endpoint: '', ...bot.kouventaConfig },
          onedriveConfig: { enabled: false, folderUrl: '', tenantId: '', clientId: '', clientSecret: '', ...bot.onedriveConfig }
      });
      setShowBotModal(true);
  };

  const handleSaveBot = async (e) => {
      e.preventDefault();
      try {
          const cleanedForm = { ...botForm, starterQuestions: botForm.starterQuestions.filter(q => q.trim() !== '') };
          if (editingBot) await axios.put(`/api/admin/bots/${editingBot._id}`, cleanedForm);
          else await axios.post('/api/admin/bots', cleanedForm);
          setShowBotModal(false);
          fetchBots();
          fetchStats();
      } catch (error) { alert(error.response?.data?.error || error.message); }
  };

  const handleDeleteBot = async (id) => {
      if(!window.confirm("Delete this bot?")) return;
      try { await axios.delete(`/api/admin/bots/${id}`); fetchBots(); fetchStats(); } catch(e) { alert(e.message); }
  };

  const addQuestion = () => setBotForm({ ...botForm, starterQuestions: [...botForm.starterQuestions, ''] });
  const updateQuestion = (i, v) => { const n = [...botForm.starterQuestions]; n[i] = v; setBotForm({ ...botForm, starterQuestions: n }); };
  const removeQuestion = (i) => { const n = botForm.starterQuestions.filter((_, idx) => idx !== i); setBotForm({ ...botForm, starterQuestions: n }); };

  // === USER LOGIC ===
  const handleEditUser = (u) => {
      setEditingUser(u);
      setUserForm({ username: u.username, password: '', isAdmin: u.isAdmin, assignedBots: u.assignedBots ? u.assignedBots.map(b => b._id) : [] });
      setShowUserModal(true);
  };

  const handleSaveUser = async (e) => {
      e.preventDefault();
      try {
          if (editingUser) await axios.put(`/api/admin/users/${editingUser._id}`, userForm);
          else await axios.post('/api/admin/users', userForm);
          setShowUserModal(false);
          fetchUsers();
          fetchStats();
      } catch (error) { alert(error.response?.data?.error || error.message); }
  };

  const toggleBotAssignment = (botId) => {
    setUserForm(prev => ({
      ...prev,
      assignedBots: prev.assignedBots.includes(botId)
        ? prev.assignedBots.filter(id => id !== botId)
        : [...prev.assignedBots, botId]
    }));
  };

  // === CHART DATA CONFIG ===
  const lineChartData = {
    labels: stats?.activityTrend?.map(d => d._id) || [],
    datasets: [{
        label: 'Daily Messages',
        data: stats?.activityTrend?.map(d => d.count) || [],
        borderColor: '#007857',
        backgroundColor: 'rgba(0, 120, 87, 0.15)',
        tension: 0.3,
        fill: true, // ✅ Ini sekarang aman karena Filler sudah diregister
        pointBackgroundColor: '#004E36'
    }]
  };

  const botLabels = stats?.botPopularity?.map(b => b.name) || [];
  const botData = stats?.botPopularity?.map(b => b.count) || [];
  const pieColors = ['#004E36', '#007857', '#48AE92', '#6E6F72', '#A5A7AA', '#F0F1F1'];

  const pieChartData = {
    labels: botLabels,
    datasets: [{
        data: botData,
        backgroundColor: pieColors.slice(0, botLabels.length),
        borderWidth: 2,
        borderColor: '#ffffff'
    }]
  };

  // ================= RENDER =================
  return (
    <div className="min-h-screen bg-steel-lightest/50 text-gray-800 font-sans">
      {/* HEADER */}
      <nav className="bg-white border-b border-steel-light/30 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
                <img src="/assets/gys-logo.webp" alt="GYS Logo" className="h-9 w-auto object-contain" onError={(e) => { e.target.style.display = 'none'; document.getElementById('admin-logo-fallback').style.display = 'flex'; }} />
                <div id="admin-logo-fallback" className="hidden w-9 h-9 bg-primary-dark rounded items-center justify-center font-bold text-white shadow-sm text-lg">G</div>
                <h1 className="text-xl font-bold text-primary-dark tracking-wide">GYS Admin Portal</h1>
            </div>
            <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-steel">Welcome, {user.username}</span>
                <button onClick={() => navigate('/')} className="px-3 py-1.5 text-xs bg-steel-lightest hover:bg-steel-light/30 text-primary-dark rounded border border-steel-light/50 transition-colors font-bold">Back to Chat</button>
                <button onClick={handleLogout} className="px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded border border-red-200 transition-colors font-bold">Logout</button>
            </div>
        </div>

        {/* TABS */}
        <div className="max-w-7xl mx-auto px-6 mt-2">
            <div className="flex space-x-1">
                {[{id:'dashboard',label:'📊 Dashboard'},{id:'users',label:'👥 Users'},{id:'chats',label:'👁️ Logs'},{id:'bots',label:'🤖 Bots'}].map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === tab.id ? 'border-primary-dark text-primary-dark' : 'border-transparent text-steel hover:text-gray-800 hover:border-steel-light/50'}`}>
                        {tab.label}
                    </button>
                ))}
            </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* === TAB: DASHBOARD === */}
        {activeTab === 'dashboard' && stats && (
            <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <StatCard title="Total Users" value={stats.totalUsers} icon="👥" color="text-primary-dark" bg="bg-primary-dark/10" border="border-l-4 border-l-primary-dark" />
                    <StatCard title="Active Bots" value={stats.totalBots} icon="🤖" color="text-primary" bg="bg-primary/10" border="border-l-4 border-l-primary" />
                    <StatCard title="Total Chats" value={stats.totalChats} icon="💬" color="text-primary-light" bg="bg-primary-light/20" border="border-l-4 border-l-primary-light" />
                    <StatCard title="Total Threads" value={stats.totalThreads} icon="📂" color="text-steel" bg="bg-steel/10" border="border-l-4 border-l-steel" />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-white p-6 rounded-lg border border-steel-light/30 shadow-sm">
                        <h3 className="text-lg font-bold text-primary-dark mb-4">Weekly Activity</h3>
                        <div className="h-64"><Line data={lineChartData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { grid: { color: '#F0F1F1' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }} /></div>
                    </div>
                    <div className="bg-white p-6 rounded-lg border border-steel-light/30 shadow-sm flex flex-col items-center">
                        <h3 className="text-lg font-bold text-primary-dark mb-4">Bot Popularity</h3>
                        <div className="h-48 w-full flex justify-center"><Doughnut data={pieChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#6E6F72', boxWidth: 12, padding: 15 } } }, cutout: '65%' }} /></div>
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-steel-light/30 overflow-hidden">
                    <div className="px-6 py-4 border-b border-steel-light/30 bg-steel-lightest/50"><h3 className="font-bold text-primary-dark">🏆 Top Contributors</h3></div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-800"><thead className="bg-steel-lightest text-steel uppercase text-xs"><tr><th className="px-6 py-3">Rank</th><th className="px-6 py-3">Username</th><th className="px-6 py-3">Email</th><th className="px-6 py-3 text-right">Messages</th></tr></thead><tbody className="divide-y divide-steel-light/30">{stats.topUsers && stats.topUsers.length > 0 ? (stats.topUsers.map((u, idx) => (<tr key={idx} className="hover:bg-steel-lightest/50 transition-colors"><td className="px-6 py-3 font-bold text-steel">#{idx + 1}</td><td className="px-6 py-3 font-semibold text-gray-800">{u.username}</td><td className="px-6 py-3 text-steel-light">{u.email || '-'}</td><td className="px-6 py-3 text-right font-mono text-primary font-bold">{u.count}</td></tr>))) : (<tr><td colSpan="4" className="px-6 py-4 text-center text-steel-light">No activity data yet.</td></tr>)}</tbody></table>
                    </div>
                </div>
            </div>
        )}

        {/* === TAB: USERS === */}
        {activeTab === 'users' && (
            <div className="bg-white rounded-lg shadow-sm border border-steel-light/30 overflow-hidden">
                <div className="px-6 py-4 border-b border-steel-light/30 flex justify-between items-center bg-steel-lightest/50">
                    <h2 className="font-bold text-primary-dark">User Management</h2>
                    <button onClick={() => { setEditingUser(null); setUserForm({username:'', password:'', isAdmin:false, assignedBots:[]}); setShowUserModal(true); }} className="px-4 py-2 bg-primary-dark text-white text-sm font-bold rounded hover:bg-primary transition-colors shadow-sm">+ Add User</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-800"><thead className="bg-steel-lightest text-steel uppercase text-xs"><tr><th className="px-6 py-3">User</th><th className="px-6 py-3">Role</th><th className="px-6 py-3">Bots Access</th><th className="px-6 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-steel-light/30">{users.map(u => (<tr key={u._id} className="hover:bg-steel-lightest/50"><td className="px-6 py-3 font-medium text-gray-800">{u.username}</td><td className="px-6 py-3">{u.isAdmin ? <span className="bg-primary-dark text-white px-2 py-0.5 rounded text-xs font-bold">ADMIN</span> : 'User'}</td><td className="px-6 py-3">{u.assignedBots?.length || 0} assigned</td><td className="px-6 py-3 text-right"><button onClick={() => handleEditUser(u)} className="text-primary hover:text-primary-dark font-bold hover:underline">Edit</button></td></tr>))}</tbody></table>
                </div>
            </div>
        )}

        {/* === TAB: CHATS === */}
        {activeTab === 'chats' && (
            <div className="bg-white rounded-lg shadow-sm border border-steel-light/30 overflow-hidden flex flex-col h-[700px]">
                <div className="px-6 py-4 border-b border-steel-light/30 flex justify-between items-center bg-steel-lightest/50">
                    <h2 className="font-bold text-primary-dark">Chat Logs</h2>
                    <div className="flex items-center gap-2">
                        <input type="month" value={exportFilter} onChange={(e) => setExportFilter(e.target.value)} className="bg-white border border-steel-light/50 rounded text-sm text-gray-800 px-3 py-1.5 focus:border-primary-dark outline-none" />
                        <button onClick={handleExport} className="px-4 py-2 bg-primary text-white text-sm font-bold rounded flex items-center gap-2 hover:bg-primary-dark transition-colors shadow-sm"><span>⬇</span> Export CSV</button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm text-left text-gray-800"><thead className="bg-steel-lightest text-steel uppercase text-xs sticky top-0"><tr><th className="px-6 py-3">Time</th><th className="px-6 py-3">User</th><th className="px-6 py-3">Bot</th><th className="px-6 py-3">Message</th></tr></thead><tbody className="divide-y divide-steel-light/30">{chatLogs.map(log => (<tr key={log._id} className="hover:bg-steel-lightest/50"><td className="px-6 py-3 whitespace-nowrap text-xs text-steel">{new Date(log.createdAt).toLocaleString()}</td><td className="px-6 py-3 font-medium text-gray-800">{log.userId?.username || 'Unknown'}</td><td className="px-6 py-3 text-primary font-bold">{log.botId?.name || 'System'}</td><td className="px-6 py-3 truncate max-w-xs text-steel" title={log.content}>{log.content || (log.attachedFiles?.length ? '📎 Attachment' : '-')}</td></tr>))}</tbody></table>
                </div>
                <div className="p-3 border-t border-steel-light/30 bg-steel-lightest/50 flex justify-between items-center text-xs text-steel"><span>Page {logPage} of {logTotalPages}</span><div className="space-x-2"><button disabled={logPage===1} onClick={()=>setLogPage(p=>p-1)} className="px-3 py-1 bg-white border border-steel-light/50 rounded hover:bg-steel-lightest disabled:opacity-50 text-gray-700 font-bold">Prev</button><button disabled={logPage===logTotalPages} onClick={()=>setLogPage(p=>p+1)} className="px-3 py-1 bg-white border border-steel-light/50 rounded hover:bg-steel-lightest disabled:opacity-50 text-gray-700 font-bold">Next</button></div></div>
            </div>
        )}

        {/* === TAB: BOTS === */}
        {activeTab === 'bots' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Ganti onClick untuk menggunakan handler baru */}
                <div onClick={handleCreateBot} className="bg-steel-lightest/30 rounded-lg border-2 border-dashed border-steel-light/50 p-6 flex flex-col items-center justify-center cursor-pointer hover:border-primary-dark hover:bg-white transition-all min-h-[200px] group">
                    <div className="w-12 h-12 bg-steel-lightest text-steel rounded-full flex items-center justify-center mb-3 text-2xl font-bold group-hover:bg-primary-dark group-hover:text-white transition-colors border border-steel-light/30">+</div>
                    <span className="font-semibold text-steel group-hover:text-primary-dark transition-colors">Create New Bot</span>
                </div>

                {/* ✅ FIX 2: Safeguard render bots array */}
                {Array.isArray(bots) && bots.map(bot => (
                    <div key={bot._id} className="bg-white rounded-lg shadow-sm border border-steel-light/30 p-6 hover:shadow-md transition-all relative">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="font-bold text-lg text-primary-dark">{bot.name}</h3>
                            <button onClick={() => handleEditBot(bot)} className="text-steel hover:text-primary-dark bg-steel-lightest hover:bg-steel-light/30 px-3 py-1 rounded text-xs font-bold transition-colors">CONFIG</button>
                        </div>
                        <p className="text-sm text-steel mb-4 h-10 overflow-hidden leading-relaxed">{bot.description}</p>
                        <div className="flex flex-wrap gap-2 text-[10px] uppercase font-bold tracking-wider">
                            {bot.smartsheetConfig?.enabled && <span className="bg-steel-lightest text-steel px-2 py-1 rounded border border-steel-light/50">Smartsheet</span>}
                            {bot.kouventaConfig?.enabled && <span className="bg-primary-light/10 text-primary-dark px-2 py-1 rounded border border-primary-light/30">Kouventa</span>}
                            {bot.onedriveConfig?.enabled && <span className="bg-steel-lightest text-steel px-2 py-1 rounded border border-steel-light/50">OneDrive</span>}
                        </div>
                    </div>
                ))}
            </div>
        )}
      </main>

      {/* --- MODAL BOT --- */}
      {showBotModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-steel-light/30">
                <div className="px-6 py-4 border-b border-steel-light/30 flex justify-between items-center bg-steel-lightest/50">
                    <h3 className="font-bold text-primary-dark text-lg">{editingBot ? 'Edit Configuration' : 'New Bot'}</h3>
                    <button onClick={() => setShowBotModal(false)} className="text-steel hover:text-gray-800">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-xs font-bold text-steel block mb-1">Name</label><input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-gray-800 text-sm focus:border-primary-dark outline-none" value={botForm.name} onChange={e=>setBotForm({...botForm, name:e.target.value})} /></div>
                        <div><label className="text-xs font-bold text-steel block mb-1">Description</label><input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-gray-800 text-sm focus:border-primary-dark outline-none" value={botForm.description} onChange={e=>setBotForm({...botForm, description:e.target.value})} /></div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-steel block mb-2">Starter Questions</label>
                        <div className="space-y-2">
                            {botForm.starterQuestions.map((q, idx) => (
                                <div key={idx} className="flex gap-2">
                                    <input className="flex-1 bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-gray-800 text-sm focus:border-primary outline-none" value={q} onChange={(e) => updateQuestion(idx, e.target.value)} />
                                    <button onClick={() => removeQuestion(idx)} className="text-red-400 hover:text-red-600 font-bold">✕</button>
                                </div>
                            ))}
                            <button onClick={addQuestion} className="text-primary text-xs font-bold hover:underline">+ Add Question</button>
                        </div>
                    </div>

                    {/* ✅ PROMPT FIELD BARU */}
                    <div>
                        <label className="text-xs font-bold text-steel block mb-1">System Prompt / Instructions (Main)</label>
                        <textarea className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-gray-800 text-sm h-32 font-mono focus:border-primary-dark outline-none" 
                            placeholder="Contoh: Anda adalah asisten HR yang membantu menjawab pertanyaan cuti..."
                            value={botForm.prompt} 
                            onChange={e=>setBotForm({...botForm, prompt:e.target.value})} />
                        <p className="text-[10px] text-steel mt-1">Ini adalah prompt utama yang akan digunakan oleh AI.</p>
                    </div>

                    {/* Hidden SystemPrompt untuk kompatibilitas */}
                    <div className="hidden"><input value={botForm.systemPrompt} readOnly /></div>

                    <div className="space-y-4">
                        {/* Smartsheet */}
                        <div className="border border-steel-light/30 rounded-lg p-4 bg-steel-lightest/50">
                            <div className="flex justify-between mb-3"><span className="font-bold text-gray-800 text-sm">Smartsheet Integration</span><input type="checkbox" checked={botForm.smartsheetConfig.enabled} onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, enabled:e.target.checked}})} /></div>
                            {botForm.smartsheetConfig.enabled && (
                                <div className="space-y-2">
                                    <input placeholder="Sheet ID (Contoh: 3743772018954116)" className="w-full bg-white border border-steel-light/50 rounded p-2 text-xs text-gray-800 outline-none focus:border-primary" 
                                        value={botForm.smartsheetConfig.sheetId} 
                                        onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, sheetId:e.target.value}})} 
                                    />
                                    <input type="password" placeholder="API Key (Optional, default use server env)" className="w-full bg-white border border-steel-light/50 rounded p-2 text-xs text-gray-800 outline-none focus:border-primary" 
                                        value={botForm.smartsheetConfig.apiKey} 
                                        onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, apiKey:e.target.value}})} 
                                    />
                                </div>
                            )}
                        </div>

                        {/* OneDrive */}
                        <div className="border border-steel-light/30 rounded-lg p-4 bg-steel-lightest/50">
                            <div className="flex justify-between mb-3"><span className="font-bold text-gray-800 text-sm">OneDrive Integration</span><input type="checkbox" checked={botForm.onedriveConfig.enabled} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, enabled:e.target.checked}})} /></div>
                            {botForm.onedriveConfig.enabled && <div className="space-y-2"><input placeholder="Folder URL" className="w-full bg-white border border-steel-light/50 rounded p-2 text-xs text-gray-800 outline-none focus:border-primary" value={botForm.onedriveConfig.folderUrl} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, folderUrl:e.target.value}})} /><div className="grid grid-cols-3 gap-2"><input placeholder="Tenant ID" className="bg-white border border-steel-light/50 rounded p-2 text-xs text-gray-800 outline-none focus:border-primary" value={botForm.onedriveConfig.tenantId} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, tenantId:e.target.value}})} /><input placeholder="Client ID" className="bg-white border border-steel-light/50 rounded p-2 text-xs text-gray-800 outline-none focus:border-primary" value={botForm.onedriveConfig.clientId} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, clientId:e.target.value}})} /><input type="password" placeholder="Secret" className="bg-white border border-steel-light/50 rounded p-2 text-xs text-gray-800 outline-none focus:border-primary" value={botForm.onedriveConfig.clientSecret} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, clientSecret:e.target.value}})} /></div></div>}
                        </div>

                        {/* Kouventa */}
                        <div className="border border-steel-light/30 rounded-lg p-4 bg-steel-lightest/50">
                            <div className="flex justify-between mb-3"><span className="font-bold text-primary text-sm">Kouventa AI Engine</span><input type="checkbox" checked={botForm.kouventaConfig.enabled} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, enabled:e.target.checked}})} /></div>
                            {botForm.kouventaConfig.enabled && <div className="space-y-2"><input placeholder="Endpoint URL" className="w-full bg-white border border-steel-light/50 rounded p-2 text-xs text-gray-800 outline-none focus:border-primary" value={botForm.kouventaConfig.endpoint} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, endpoint:e.target.value}})} /><input type="password" placeholder="API Key" className="w-full bg-white border border-steel-light/50 rounded p-2 text-xs text-gray-800 outline-none focus:border-primary" value={botForm.kouventaConfig.apiKey} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, apiKey:e.target.value}})} /></div>}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-steel-light/30 flex justify-end gap-3 rounded-b-lg bg-steel-lightest/50">
                    {editingBot && <button onClick={()=>handleDeleteBot(editingBot._id)} className="px-4 py-2 text-red-600 hover:text-red-700 font-bold text-sm">Delete</button>}
                    <button onClick={()=>setShowBotModal(false)} className="px-4 py-2 text-steel hover:text-gray-800 font-bold text-sm">Cancel</button>
                    <button onClick={handleSaveBot} className="px-6 py-2 bg-primary-dark text-white rounded font-bold hover:bg-primary text-sm transition-colors">Save Bot</button>
                </div>
            </div>
        </div>
      )}

      {/* --- MODAL USER (Tidak Berubah) --- */}
      {showUserModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 border border-steel-light/30">
                  <h3 className="font-bold text-primary-dark mb-4 text-lg">{editingUser ? 'Edit User' : 'Add User'}</h3>
                  <div className="space-y-3">
                      <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-gray-800 focus:border-primary-dark outline-none text-sm" placeholder="Username" value={userForm.username} onChange={e=>setUserForm({...userForm, username:e.target.value})} />
                      <input className="w-full bg-steel-lightest/50 border border-steel-light/50 rounded p-2 text-gray-800 focus:border-primary-dark outline-none text-sm" type="password" placeholder="Password" value={userForm.password} onChange={e=>setUserForm({...userForm, password:e.target.value})} />
                      <label className="flex items-center space-x-2 text-gray-800 font-bold text-sm"><input type="checkbox" checked={userForm.isAdmin} onChange={e=>setUserForm({...userForm, isAdmin:e.target.checked})} /><span>Set as Administrator</span></label>
                      <div className="border border-steel-light/50 p-3 rounded max-h-32 overflow-y-auto bg-steel-lightest/50 custom-scrollbar mt-2">
                          <p className="text-xs font-bold text-steel mb-2 uppercase">Bot Assignment</p>
                          {bots.map(b => (
                              <label key={b._id} className="flex items-center space-x-2 mb-1 text-gray-800 text-sm font-medium">
                                  <input type="checkbox" checked={userForm.assignedBots.includes(b._id)} onChange={()=>toggleBotAssignment(b._id)} />
                                  <span className="truncate">{b.name}</span>
                              </label>
                          ))}
                      </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-6">
                      <button onClick={()=>setShowUserModal(false)} className="px-4 py-2 text-steel hover:text-gray-800 font-bold text-sm">Cancel</button>
                      <button onClick={handleSaveUser} className="px-4 py-2 bg-primary-dark text-white rounded hover:bg-primary font-bold text-sm transition-colors">Save Changes</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

// Komponen Card
const StatCard = ({ title, value, icon, color, bg, border }) => (
    <div className={`bg-white p-5 rounded-lg border border-steel-light/30 shadow-sm flex items-center justify-between hover:shadow-md transition-all ${border}`}>
        <div>
            <p className="text-xs text-steel uppercase tracking-wider mb-1 font-bold">{title}</p>
            <h2 className={`text-2xl font-bold ${color}`}>{value}</h2>
        </div>
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl ${bg} ${color}`}>
            {icon}
        </div>
    </div>
);

export default AdminDashboard;
