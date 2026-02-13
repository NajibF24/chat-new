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
  ArcElement
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';

// Register ChartJS
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement);

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
  const [botForm, setBotForm] = useState({
      name: '', description: '', systemPrompt: '',
      starterQuestions: [],
      smartsheetConfig: { enabled: false, apiKey: '', sheetId: '' },
      kouventaConfig: { enabled: false, apiKey: '', endpoint: '' },
      onedriveConfig: { enabled: false, folderUrl: '', tenantId: '', clientId: '', clientSecret: '' }
  });

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
    try { const res = await axios.get('/api/admin/users'); setUsers(res.data.users); }
    catch (error) { console.error(error); }
  };

  const fetchBots = async () => {
    try { const res = await axios.get('/api/admin/bots'); setBots(res.data.bots); }
    catch (error) { console.error(error); }
  };

  const fetchChatLogs = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/admin/chat-logs?page=${logPage}&limit=20`);
      setChatLogs(res.data.chats);
      setLogTotalPages(res.data.totalPages);
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
  const handleEditBot = (bot) => {
      setEditingBot(bot);
      setBotForm({
          name: bot.name,
          description: bot.description,
          systemPrompt: bot.systemPrompt || '',
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
      setUserForm({ username: u.username, password: '', isAdmin: u.isAdmin, assignedBots: u.assignedBots.map(b => b._id) });
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

  // 1. Activity Trend Data
  const lineChartData = {
    labels: stats?.activityTrend?.map(d => d._id) || [],
    datasets: [{
        label: 'Daily Messages',
        data: stats?.activityTrend?.map(d => d.count) || [],
        // Ganti warna menjadi Biru GYS
        borderColor: '#0C2D48',
        backgroundColor: 'rgba(12, 45, 72, 0.1)',
        tension: 0.3,
        fill: true
    }]
  };

  // 2. Bot Popularity Data
  const botLabels = stats?.botPopularity?.map(b => b.name) || [];
  const botData = stats?.botPopularity?.map(b => b.count) || [];
  // Ganti warna menjadi tema Industrial
  const pieColors = ['#0C2D48', '#145DA0', '#2E8B57', '#B1B3B3', '#F59E0B', '#C1272D'];

  const pieChartData = {
    labels: botLabels,
    datasets: [{
        data: botData,
        backgroundColor: pieColors.slice(0, botLabels.length),
        borderWidth: 0
    }]
  };

  // ================= RENDER =================
  return (
    // UBAH ROOT BACKGROUND: bg-gys-bg (Abu cerah)
    <div className="min-h-screen bg-gys-bg text-gys-text font-sans">

      {/* HEADER: Putih Bersih */}
      <nav className="bg-white border-b border-gys-border sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
                {/* Logo GYS Sederhana */}
                <div className="w-9 h-9 bg-gys-navy rounded flex items-center justify-center font-bold text-white shadow-md text-lg">G</div>
                <h1 className="text-xl font-bold text-gys-navy tracking-wide">GYS Admin Portal</h1>
            </div>
            <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-gys-subtext">Welcome, {user.username}</span>
                <button onClick={() => navigate('/')} className="px-3 py-1.5 text-xs bg-slate-50 hover:bg-slate-100 text-gys-navy rounded border border-slate-300 transition-colors font-semibold">Back to Chat</button>
                <button onClick={handleLogout} className="px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded border border-red-200 transition-colors font-semibold">Logout</button>
            </div>
        </div>

        {/* TABS: Style Industrial */}
        <div className="max-w-7xl mx-auto px-6 mt-2">
            <div className="flex space-x-1">
                {[
                    {id: 'dashboard', label: '📊 Dashboard'},
                    {id: 'users', label: '👥 Users'},
                    {id: 'chats', label: '👁️ Logs'},
                    {id: 'bots', label: '🤖 Bots'}
                ].map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === tab.id ? 'border-gys-navy text-gys-navy' : 'border-transparent text-gys-subtext hover:text-gys-text hover:border-slate-300'}`}>
                        {tab.label}
                    </button>
                ))}
            </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* === TAB: DASHBOARD (UPDATED) === */}
        {activeTab === 'dashboard' && stats && (
            <div className="space-y-8">
                {/* 1. Stats Cards (Light Theme) */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <StatCard title="Total Users" value={stats.totalUsers} icon="👥" color="text-gys-navy" bg="bg-blue-50" border="border-l-4 border-l-gys-navy" />
                    <StatCard title="Active Bots" value={stats.totalBots} icon="🤖" color="text-gys-blue" bg="bg-sky-50" border="border-l-4 border-l-gys-blue" />
                    <StatCard title="Total Chats" value={stats.totalChats} icon="💬" color="text-gys-teal" bg="bg-emerald-50" border="border-l-4 border-l-gys-teal" />
                    <StatCard title="Total Threads" value={stats.totalThreads} icon="📂" color="text-orange-600" bg="bg-orange-50" border="border-l-4 border-l-orange-500" />
                </div>

                {/* 2. Charts Section (White Cards) */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Trend Line Chart */}
                    <div className="lg:col-span-2 bg-white p-6 rounded-lg border border-gys-border shadow-sm">
                        <h3 className="text-lg font-bold text-gys-navy mb-4">Weekly Activity</h3>
                        <div className="h-64">
                            <Line data={lineChartData} options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                scales: { y: { grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } },
                                plugins: { legend: { display: false } }
                            }} />
                        </div>
                    </div>

                    {/* Popularity Doughnut Chart */}
                    <div className="bg-white p-6 rounded-lg border border-gys-border shadow-sm flex flex-col items-center">
                        <h3 className="text-lg font-bold text-gys-navy mb-4">Bot Popularity</h3>
                        <div className="h-48 w-full flex justify-center">
                            <Doughnut data={pieChartData} options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { position: 'right', labels: { color: '#64748B', boxWidth: 10 } } }
                            }} />
                        </div>
                    </div>
                </div>

                {/* 3. Top Users Table (White Card) */}
                <div className="bg-white rounded-lg shadow-sm border border-gys-border overflow-hidden">
                    <div className="px-6 py-4 border-b border-gys-border bg-slate-50">
                        <h3 className="font-bold text-gys-navy">🏆 Top Contributors</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gys-text">
                            <thead className="bg-slate-100 text-gys-subtext uppercase text-xs">
                                <tr>
                                    <th className="px-6 py-3">Rank</th>
                                    <th className="px-6 py-3">Username</th>
                                    <th className="px-6 py-3">Email</th>
                                    <th className="px-6 py-3 text-right">Messages</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {stats.topUsers && stats.topUsers.length > 0 ? (
                                    stats.topUsers.map((u, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-3 font-bold text-slate-400">#{idx + 1}</td>
                                            <td className="px-6 py-3 font-semibold text-gys-text">{u.username}</td>
                                            <td className="px-6 py-3 text-gys-subtext">{u.email || '-'}</td>
                                            <td className="px-6 py-3 text-right font-mono text-gys-blue font-bold">{u.count}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan="4" className="px-6 py-4 text-center text-slate-400">No activity data yet.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        )}

        {/* === TAB: USERS (Existing Logic - Light Theme) === */}
        {activeTab === 'users' && (
            <div className="bg-white rounded-lg shadow-sm border border-gys-border overflow-hidden">
                <div className="px-6 py-4 border-b border-gys-border flex justify-between items-center bg-slate-50">
                    <h2 className="font-bold text-gys-navy">User Management</h2>
                    <button onClick={() => { setEditingUser(null); setUserForm({username:'', password:'', isAdmin:false, assignedBots:[]}); setShowUserModal(true); }}
                        className="px-4 py-2 bg-gys-navy text-white text-sm font-bold rounded hover:bg-slate-800 transition-colors shadow-sm">+ Add User</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gys-text">
                        <thead className="bg-slate-100 text-gys-subtext uppercase text-xs">
                            <tr><th className="px-6 py-3">User</th><th className="px-6 py-3">Role</th><th className="px-6 py-3">Bots Access</th><th className="px-6 py-3 text-right">Actions</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {users.map(u => (
                                <tr key={u._id} className="hover:bg-slate-50">
                                    <td className="px-6 py-3 font-medium text-gys-text">{u.username}</td>
                                    <td className="px-6 py-3">{u.isAdmin ? <span className="bg-gys-navy text-white px-2 py-0.5 rounded text-xs font-bold">ADMIN</span> : 'User'}</td>
                                    <td className="px-6 py-3">{u.assignedBots.length} assigned</td>
                                    <td className="px-6 py-3 text-right">
                                        <button onClick={() => handleEditUser(u)} className="text-gys-blue font-bold hover:underline">Edit</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {/* === TAB: CHATS (Existing Logic - Light Theme) === */}
        {activeTab === 'chats' && (
            <div className="bg-white rounded-lg shadow-sm border border-gys-border overflow-hidden flex flex-col h-[700px]">
                <div className="px-6 py-4 border-b border-gys-border flex justify-between items-center bg-slate-50">
                    <h2 className="font-bold text-gys-navy">Chat Logs</h2>
                    <div className="flex items-center gap-2">
                        <input type="month" value={exportFilter} onChange={(e) => setExportFilter(e.target.value)}
                            className="bg-white border border-slate-300 rounded text-sm text-gys-text px-3 py-1.5 focus:border-gys-navy outline-none" />
                        <button onClick={handleExport} className="px-4 py-2 bg-gys-teal text-white text-sm font-bold rounded flex items-center gap-2 hover:bg-emerald-700 transition-colors shadow-sm">
                            <span>⬇</span> Export CSV
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm text-left text-gys-text">
                        <thead className="bg-slate-100 text-gys-subtext uppercase text-xs sticky top-0">
                            <tr><th className="px-6 py-3">Time</th><th className="px-6 py-3">User</th><th className="px-6 py-3">Bot</th><th className="px-6 py-3">Message</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {chatLogs.map(log => (
                                <tr key={log._id} className="hover:bg-slate-50">
                                    <td className="px-6 py-3 whitespace-nowrap text-xs text-slate-400">{new Date(log.createdAt).toLocaleString()}</td>
                                    <td className="px-6 py-3 font-medium text-gys-text">{log.userId?.username || 'Unknown'}</td>
                                    <td className="px-6 py-3 text-gys-blue font-bold">{log.botId?.name || 'System'}</td>
                                    <td className="px-6 py-3 truncate max-w-xs text-slate-500" title={log.content}>
                                        {log.content || (log.attachedFiles?.length ? '📎 Attachment' : '-')}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="p-3 border-t border-gys-border bg-slate-50 flex justify-between items-center text-xs text-gys-subtext">
                    <span>Page {logPage} of {logTotalPages}</span>
                    <div className="space-x-2">
                        <button disabled={logPage===1} onClick={()=>setLogPage(p=>p-1)} className="px-3 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 text-slate-700">Prev</button>
                        <button disabled={logPage===logTotalPages} onClick={()=>setLogPage(p=>p+1)} className="px-3 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 text-slate-700">Next</button>
                    </div>
                </div>
            </div>
        )}

        {/* === TAB: BOTS (Existing Logic - Light Theme) === */}
        {activeTab === 'bots' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div onClick={() => { setEditingBot(null); setBotForm({name:'', description:'', systemPrompt:'', starterQuestions:[], smartsheetConfig:{enabled:false}, kouventaConfig:{enabled:false}, onedriveConfig:{enabled:false}}); setShowBotModal(true); }}
                     className="bg-slate-100 rounded-lg border-2 border-dashed border-slate-300 p-6 flex flex-col items-center justify-center cursor-pointer hover:border-gys-navy hover:bg-white transition-all min-h-[200px] group">
                    <div className="w-12 h-12 bg-slate-200 text-slate-400 rounded-full flex items-center justify-center mb-3 text-2xl font-bold group-hover:bg-gys-navy group-hover:text-white transition-colors">+</div>
                    <span className="font-semibold text-slate-500 group-hover:text-gys-navy">Create New Bot</span>
                </div>

                {bots.map(bot => (
                    <div key={bot._id} className="bg-white rounded-lg shadow-sm border border-gys-border p-6 hover:shadow-md transition-all relative">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="font-bold text-lg text-gys-navy">{bot.name}</h3>
                            <button onClick={() => handleEditBot(bot)} className="text-gys-subtext hover:text-gys-navy bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded text-xs font-bold transition-colors">CONFIG</button>
                        </div>
                        <p className="text-sm text-gys-subtext mb-4 h-10 overflow-hidden leading-relaxed">{bot.description}</p>
                        <div className="flex flex-wrap gap-2 text-[10px] uppercase font-bold tracking-wider">
                            {bot.smartsheetConfig?.enabled && <span className="bg-blue-50 text-gys-blue px-2 py-1 rounded border border-blue-100">Smartsheet</span>}
                            {bot.kouventaConfig?.enabled && <span className="bg-purple-50 text-purple-600 px-2 py-1 rounded border border-purple-100">Kouventa</span>}
                            {bot.onedriveConfig?.enabled && <span className="bg-orange-50 text-orange-600 px-2 py-1 rounded border border-orange-100">OneDrive</span>}
                        </div>
                    </div>
                ))}
            </div>
        )}
      </main>

      {/* --- MODAL BOT (Light Theme) --- */}
      {showBotModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-slate-200">
                <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-gys-navy text-lg">{editingBot ? 'Edit Configuration' : 'New Bot'}</h3>
                    <button onClick={() => setShowBotModal(false)} className="text-slate-400 hover:text-slate-700">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-xs font-bold text-gys-subtext block mb-1">Name</label><input className="w-full bg-slate-50 border border-slate-300 rounded p-2 text-gys-text text-sm focus:border-gys-navy outline-none" value={botForm.name} onChange={e=>setBotForm({...botForm, name:e.target.value})} /></div>
                        <div><label className="text-xs font-bold text-gys-subtext block mb-1">Description</label><input className="w-full bg-slate-50 border border-slate-300 rounded p-2 text-gys-text text-sm focus:border-gys-navy outline-none" value={botForm.description} onChange={e=>setBotForm({...botForm, description:e.target.value})} /></div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gys-subtext block mb-2">Starter Questions</label>
                        <div className="space-y-2">
                            {botForm.starterQuestions.map((q, idx) => (
                                <div key={idx} className="flex gap-2">
                                    <input className="flex-1 bg-slate-50 border border-slate-300 rounded p-2 text-gys-text text-sm" value={q} onChange={(e) => updateQuestion(idx, e.target.value)} />
                                    <button onClick={() => removeQuestion(idx)} className="text-red-400 hover:text-red-600">✕</button>
                                </div>
                            ))}
                            <button onClick={addQuestion} className="text-gys-blue text-xs font-bold hover:underline">+ Add Question</button>
                        </div>
                    </div>

                    <div className={botForm.kouventaConfig.enabled ? "opacity-50 pointer-events-none" : ""}>
                        <label className="text-xs font-bold text-gys-subtext block mb-1">System Prompt</label>
                        <textarea className="w-full bg-slate-50 border border-slate-300 rounded p-2 text-gys-text text-sm h-32 font-mono focus:border-gys-navy outline-none" value={botForm.systemPrompt} onChange={e=>setBotForm({...botForm, systemPrompt:e.target.value})} />
                        {botForm.kouventaConfig.enabled && <p className="text-xs text-purple-600 mt-1">Managed by Kouventa.</p>}
                    </div>

                    <div className="space-y-4">
                        {/* Smartsheet */}
                        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                            <div className="flex justify-between mb-3"><span className="font-bold text-gys-blue text-sm">Smartsheet</span><input type="checkbox" checked={botForm.smartsheetConfig.enabled} onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, enabled:e.target.checked}})} /></div>
                            {botForm.smartsheetConfig.enabled && <div className="space-y-2"><input placeholder="Sheet ID" className="w-full bg-white border border-slate-300 rounded p-2 text-xs text-gys-text" value={botForm.smartsheetConfig.sheetId} onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, sheetId:e.target.value}})} /><input type="password" placeholder="API Key" className="w-full bg-white border border-slate-300 rounded p-2 text-xs text-gys-text" value={botForm.smartsheetConfig.apiKey} onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, apiKey:e.target.value}})} /></div>}
                        </div>

                        {/* OneDrive */}
                        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                            <div className="flex justify-between mb-3"><span className="font-bold text-orange-600 text-sm">OneDrive</span><input type="checkbox" checked={botForm.onedriveConfig.enabled} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, enabled:e.target.checked}})} /></div>
                            {botForm.onedriveConfig.enabled && <div className="space-y-2"><input placeholder="Folder URL" className="w-full bg-white border border-slate-300 rounded p-2 text-xs text-gys-text" value={botForm.onedriveConfig.folderUrl} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, folderUrl:e.target.value}})} /><div className="grid grid-cols-3 gap-2"><input placeholder="Tenant ID" className="bg-white border border-slate-300 rounded p-2 text-xs text-gys-text" value={botForm.onedriveConfig.tenantId} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, tenantId:e.target.value}})} /><input placeholder="Client ID" className="bg-white border border-slate-300 rounded p-2 text-xs text-gys-text" value={botForm.onedriveConfig.clientId} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, clientId:e.target.value}})} /><input type="password" placeholder="Secret" className="bg-white border border-slate-300 rounded p-2 text-xs text-gys-text" value={botForm.onedriveConfig.clientSecret} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, clientSecret:e.target.value}})} /></div></div>}
                        </div>

                        {/* Kouventa */}
                        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                            <div className="flex justify-between mb-3"><span className="font-bold text-purple-600 text-sm">Kouventa AI</span><input type="checkbox" checked={botForm.kouventaConfig.enabled} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, enabled:e.target.checked}})} /></div>
                            {botForm.kouventaConfig.enabled && <div className="space-y-2"><input placeholder="Endpoint URL" className="w-full bg-white border border-slate-300 rounded p-2 text-xs text-gys-text" value={botForm.kouventaConfig.endpoint} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, endpoint:e.target.value}})} /><input type="password" placeholder="API Key" className="w-full bg-white border border-slate-300 rounded p-2 text-xs text-gys-text" value={botForm.kouventaConfig.apiKey} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, apiKey:e.target.value}})} /></div>}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-slate-200 flex justify-end gap-3 rounded-b-lg bg-slate-50">
                    {editingBot && <button onClick={()=>handleDeleteBot(editingBot._id)} className="px-4 py-2 text-red-600 hover:text-red-700 font-bold text-sm">Delete</button>}
                    <button onClick={()=>setShowBotModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-800 font-bold text-sm">Cancel</button>
                    <button onClick={handleSaveBot} className="px-6 py-2 bg-gys-navy text-white rounded font-bold hover:bg-slate-800 text-sm">Save Bot</button>
                </div>
            </div>
        </div>
      )}

      {/* --- MODAL USER (Light Theme) --- */}
      {showUserModal && (
          <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 border border-slate-200">
                  <h3 className="font-bold text-gys-navy mb-4 text-lg">{editingUser ? 'Edit User' : 'Add User'}</h3>
                  <div className="space-y-3">
                      <input className="w-full bg-slate-50 border border-slate-300 rounded p-2 text-gys-text focus:border-gys-navy outline-none" placeholder="Username" value={userForm.username} onChange={e=>setUserForm({...userForm, username:e.target.value})} />
                      <input className="w-full bg-slate-50 border border-slate-300 rounded p-2 text-gys-text focus:border-gys-navy outline-none" type="password" placeholder="Password" value={userForm.password} onChange={e=>setUserForm({...userForm, password:e.target.value})} />
                      <label className="flex items-center space-x-2 text-gys-text font-medium"><input type="checkbox" checked={userForm.isAdmin} onChange={e=>setUserForm({...userForm, isAdmin:e.target.checked})} /><span>Is Admin</span></label>
                      <div className="border border-slate-300 p-2 rounded max-h-32 overflow-y-auto bg-slate-50">
                          {bots.map(b => (
                              <label key={b._id} className="flex items-center space-x-2 mb-1 text-gys-text text-sm">
                                  <input type="checkbox" checked={userForm.assignedBots.includes(b._id)} onChange={()=>toggleBotAssignment(b._id)} />
                                  <span className="truncate">{b.name}</span>
                              </label>
                          ))}
                      </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                      <button onClick={()=>setShowUserModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-800 font-bold text-sm">Cancel</button>
                      <button onClick={handleSaveUser} className="px-4 py-2 bg-gys-navy text-white rounded hover:bg-slate-800 font-bold text-sm">Save</button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}

// Komponen Card dengan Light Theme & Border Warna
const StatCard = ({ title, value, icon, color, bg, border }) => (
    <div className={`bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between hover:shadow-md transition-all ${border}`}>
        <div>
            <p className="text-xs text-gys-subtext uppercase tracking-wider mb-1 font-bold">{title}</p>
            <h2 className={`text-2xl font-bold ${color}`}>{value}</h2>
        </div>
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl ${bg} ${color}`}>
            {icon}
        </div>
    </div>
);

export default AdminDashboard;
