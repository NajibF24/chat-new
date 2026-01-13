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
  const [stats, setStats] = useState(null); // Data Statistik
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
          fetchStats(); // Refresh stats incase bot count changes
      } catch (error) { alert(error.response?.data?.error || error.message); }
  };

  const handleDeleteBot = async (id) => {
      if(!window.confirm("Delete this bot?")) return;
      try { await axios.delete(`/api/admin/bots/${id}`); fetchBots(); fetchStats(); } catch(e) { alert(e.message); }
  };

  // Questions Logic
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
  const lineChartData = {
    labels: stats?.dailyActivity?.map(d => d._id) || [],
    datasets: [{
        label: 'Daily Messages',
        data: stats?.dailyActivity?.map(d => d.count) || [],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        tension: 0.4,
        fill: true
    }]
  };

  const pieChartData = {
    labels: stats?.botUsage?.map(b => b.name) || [],
    datasets: [{
        data: stats?.botUsage?.map(b => b.count) || [],
        backgroundColor: ['#ef4444', '#3b82f6', '#eab308', '#10b981', '#a855f7'],
        borderWidth: 0
    }]
  };

  // ================= RENDER =================
  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans">
      
      {/* HEADER */}
      <nav className="bg-slate-800 border-b border-slate-700 sticky top-0 z-30 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-lg flex items-center justify-center font-bold text-white shadow-lg">A</div>
                <h1 className="text-xl font-bold text-white tracking-wide">GYS Admin Portal</h1>
            </div>
            <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-slate-400">Welcome, {user.username}</span>
                <button onClick={() => navigate('/')} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded border border-slate-600 transition-colors">Back to Chat</button>
                <button onClick={handleLogout} className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded border border-red-500/20 transition-colors">Logout</button>
            </div>
        </div>

        {/* TABS */}
        <div className="max-w-7xl mx-auto px-6 mt-2">
            <div className="flex space-x-1">
                {[
                    {id: 'dashboard', label: '📊 Dashboard'},
                    {id: 'users', label: '👥 Users'},
                    {id: 'chats', label: '👁️ Logs'},
                    {id: 'bots', label: '🤖 Bots'}
                ].map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} 
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                        {tab.label}
                    </button>
                ))}
            </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        
        {/* === TAB: DASHBOARD (NEW) === */}
        {activeTab === 'dashboard' && stats && (
            <div className="space-y-6">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <StatCard title="Total Users" value={stats.counts.totalUsers} icon="👥" color="text-blue-400" bg="bg-blue-500/10" />
                    <StatCard title="Active Bots" value={stats.counts.totalBots} icon="🤖" color="text-purple-400" bg="bg-purple-500/10" />
                    <StatCard title="Total Chats" value={stats.counts.totalChats} icon="💬" color="text-green-400" bg="bg-green-500/10" />
                    <StatCard title="Active Threads" value={stats.counts.activeThreads} icon="🔥" color="text-orange-400" bg="bg-orange-500/10" />
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                        <h3 className="text-lg font-semibold text-white mb-4">Activity Trend (7 Days)</h3>
                        <div className="h-64">
                            <Line data={lineChartData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { grid: { color: '#334155' } }, x: { grid: { display: false } } } }} />
                        </div>
                    </div>
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg flex flex-col items-center">
                        <h3 className="text-lg font-semibold text-white mb-4">Bot Popularity</h3>
                        <div className="h-64 w-full flex justify-center">
                            <Doughnut data={pieChartData} options={{ responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } } }} />
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* === TAB: USERS === */}
        {activeTab === 'users' && (
            <div className="bg-slate-800 rounded-xl shadow-lg border border-slate-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                    <h2 className="font-bold text-white">User Management</h2>
                    <button onClick={() => { setEditingUser(null); setUserForm({username:'', password:'', isAdmin:false, assignedBots:[]}); setShowUserModal(true); }} 
                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 transition-colors">+ Add User</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-300">
                        <thead className="bg-slate-900 text-slate-400 uppercase text-xs">
                            <tr><th className="px-6 py-3">User</th><th className="px-6 py-3">Role</th><th className="px-6 py-3">Bots Access</th><th className="px-6 py-3 text-right">Actions</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700">
                            {users.map(u => (
                                <tr key={u._id} className="hover:bg-slate-700/50">
                                    <td className="px-6 py-3 font-medium text-white">{u.username}</td>
                                    <td className="px-6 py-3">{u.isAdmin ? <span className="bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded text-xs border border-purple-500/30">Admin</span> : 'User'}</td>
                                    <td className="px-6 py-3">{u.assignedBots.length} assigned</td>
                                    <td className="px-6 py-3 text-right">
                                        <button onClick={() => handleEditUser(u)} className="text-blue-400 hover:text-blue-300 hover:underline">Edit</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {/* === TAB: CHATS === */}
        {activeTab === 'chats' && (
            <div className="bg-slate-800 rounded-xl shadow-lg border border-slate-700 overflow-hidden flex flex-col h-[700px]">
                <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                    <h2 className="font-bold text-white">Chat Logs</h2>
                    <div className="flex items-center gap-2">
                        <input type="month" value={exportFilter} onChange={(e) => setExportFilter(e.target.value)} 
                            className="bg-slate-900 border border-slate-600 rounded text-sm text-white px-3 py-1.5 focus:border-blue-500 outline-none" />
                        <button onClick={handleExport} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded flex items-center gap-2 transition-colors">
                            <span>⬇</span> Export
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm text-left text-slate-300">
                        <thead className="bg-slate-900 text-slate-400 uppercase text-xs sticky top-0">
                            <tr><th className="px-6 py-3">Time</th><th className="px-6 py-3">User</th><th className="px-6 py-3">Bot</th><th className="px-6 py-3">Message</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700">
                            {chatLogs.map(log => (
                                <tr key={log._id} className="hover:bg-slate-700/30">
                                    <td className="px-6 py-3 whitespace-nowrap text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</td>
                                    <td className="px-6 py-3 text-white">{log.userId?.username || 'Unknown'}</td>
                                    <td className="px-6 py-3 text-blue-300">{log.botId?.name || 'Deleted'}</td>
                                    <td className="px-6 py-3 truncate max-w-xs text-slate-400" title={log.content}>
                                        {log.content || (log.attachedFiles?.length ? '📎 Attachment' : '-')}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="p-3 border-t border-slate-700 bg-slate-800/50 flex justify-between items-center text-xs text-slate-400">
                    <span>Page {logPage} of {logTotalPages}</span>
                    <div className="space-x-2">
                        <button disabled={logPage===1} onClick={()=>setLogPage(p=>p-1)} className="px-3 py-1 bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-50">Prev</button>
                        <button disabled={logPage===logTotalPages} onClick={()=>setLogPage(p=>p+1)} className="px-3 py-1 bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-50">Next</button>
                    </div>
                </div>
            </div>
        )}

        {/* === TAB: BOTS === */}
        {activeTab === 'bots' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div onClick={() => { setEditingBot(null); setBotForm({name:'', description:'', systemPrompt:'', starterQuestions:[], smartsheetConfig:{enabled:false}, kouventaConfig:{enabled:false}, onedriveConfig:{enabled:false}}); setShowBotModal(true); }} 
                     className="bg-slate-800/50 rounded-xl border-2 border-dashed border-slate-600 p-6 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-slate-800 transition-all min-h-[200px] group">
                    <div className="w-12 h-12 bg-slate-700 text-slate-400 rounded-full flex items-center justify-center mb-3 text-2xl font-bold group-hover:bg-blue-600 group-hover:text-white transition-colors">+</div>
                    <span className="font-semibold text-slate-400 group-hover:text-white">Create New Bot</span>
                </div>

                {bots.map(bot => (
                    <div key={bot._id} className="bg-slate-800 rounded-xl shadow-lg border border-slate-700 p-6 hover:border-slate-500 transition-all relative">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="font-bold text-lg text-white">{bot.name}</h3>
                            <button onClick={() => handleEditBot(bot)} className="text-blue-400 hover:text-white bg-blue-900/30 hover:bg-blue-600 px-3 py-1 rounded text-sm transition-colors">Config</button>
                        </div>
                        <p className="text-sm text-slate-400 mb-4 h-10 overflow-hidden">{bot.description}</p>
                        <div className="flex flex-wrap gap-2 text-[10px] uppercase font-bold tracking-wider">
                            {bot.smartsheetConfig?.enabled && <span className="bg-blue-900/50 text-blue-300 px-2 py-1 rounded border border-blue-500/30">Smartsheet</span>}
                            {bot.kouventaConfig?.enabled && <span className="bg-purple-900/50 text-purple-300 px-2 py-1 rounded border border-purple-500/30">Kouventa</span>}
                            {bot.onedriveConfig?.enabled && <span className="bg-orange-900/50 text-orange-300 px-2 py-1 rounded border border-orange-500/30">OneDrive</span>}
                        </div>
                    </div>
                ))}
            </div>
        )}
      </main>

      {/* --- MODAL BOT (DARK) --- */}
      {showBotModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-slate-600">
                <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
                    <h3 className="font-bold text-white text-lg">{editingBot ? 'Edit Configuration' : 'New Bot'}</h3>
                    <button onClick={() => setShowBotModal(false)} className="text-slate-400 hover:text-white">✕</button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-xs font-bold text-slate-400 block mb-1">Name</label><input className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" value={botForm.name} onChange={e=>setBotForm({...botForm, name:e.target.value})} /></div>
                        <div><label className="text-xs font-bold text-slate-400 block mb-1">Description</label><input className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" value={botForm.description} onChange={e=>setBotForm({...botForm, description:e.target.value})} /></div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-400 block mb-2">Starter Questions</label>
                        <div className="space-y-2">
                            {botForm.starterQuestions.map((q, idx) => (
                                <div key={idx} className="flex gap-2">
                                    <input className="flex-1 bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" value={q} onChange={(e) => updateQuestion(idx, e.target.value)} />
                                    <button onClick={() => removeQuestion(idx)} className="text-red-400 hover:text-red-300">✕</button>
                                </div>
                            ))}
                            <button onClick={addQuestion} className="text-blue-400 text-xs font-bold hover:underline">+ Add Question</button>
                        </div>
                    </div>

                    <div className={botForm.kouventaConfig.enabled ? "opacity-30 pointer-events-none" : ""}>
                        <label className="text-xs font-bold text-slate-400 block mb-1">System Prompt</label>
                        <textarea className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm h-32 font-mono" value={botForm.systemPrompt} onChange={e=>setBotForm({...botForm, systemPrompt:e.target.value})} />
                        {botForm.kouventaConfig.enabled && <p className="text-xs text-purple-400 mt-1">Managed by Kouventa.</p>}
                    </div>

                    <div className="space-y-4">
                        {/* Smartsheet */}
                        <div className="border border-slate-600 rounded-lg p-4 bg-slate-900/30">
                            <div className="flex justify-between mb-3"><span className="font-bold text-blue-400 text-sm">Smartsheet</span><input type="checkbox" checked={botForm.smartsheetConfig.enabled} onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, enabled:e.target.checked}})} /></div>
                            {botForm.smartsheetConfig.enabled && <div className="space-y-2"><input placeholder="Sheet ID" className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-xs text-white" value={botForm.smartsheetConfig.sheetId} onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, sheetId:e.target.value}})} /><input type="password" placeholder="API Key" className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-xs text-white" value={botForm.smartsheetConfig.apiKey} onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, apiKey:e.target.value}})} /></div>}
                        </div>

                        {/* OneDrive */}
                        <div className="border border-slate-600 rounded-lg p-4 bg-slate-900/30">
                            <div className="flex justify-between mb-3"><span className="font-bold text-orange-400 text-sm">OneDrive</span><input type="checkbox" checked={botForm.onedriveConfig.enabled} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, enabled:e.target.checked}})} /></div>
                            {botForm.onedriveConfig.enabled && <div className="space-y-2"><input placeholder="Folder URL" className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-xs text-white" value={botForm.onedriveConfig.folderUrl} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, folderUrl:e.target.value}})} /><div className="grid grid-cols-3 gap-2"><input placeholder="Tenant ID" className="bg-slate-800 border border-slate-600 rounded p-2 text-xs text-white" value={botForm.onedriveConfig.tenantId} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, tenantId:e.target.value}})} /><input placeholder="Client ID" className="bg-slate-800 border border-slate-600 rounded p-2 text-xs text-white" value={botForm.onedriveConfig.clientId} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, clientId:e.target.value}})} /><input type="password" placeholder="Secret" className="bg-slate-800 border border-slate-600 rounded p-2 text-xs text-white" value={botForm.onedriveConfig.clientSecret} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, clientSecret:e.target.value}})} /></div></div>}
                        </div>

                        {/* Kouventa */}
                        <div className="border border-slate-600 rounded-lg p-4 bg-slate-900/30">
                            <div className="flex justify-between mb-3"><span className="font-bold text-purple-400 text-sm">Kouventa AI</span><input type="checkbox" checked={botForm.kouventaConfig.enabled} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, enabled:e.target.checked}})} /></div>
                            {botForm.kouventaConfig.enabled && <div className="space-y-2"><input placeholder="Endpoint URL" className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-xs text-white" value={botForm.kouventaConfig.endpoint} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, endpoint:e.target.value}})} /><input type="password" placeholder="API Key" className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-xs text-white" value={botForm.kouventaConfig.apiKey} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, apiKey:e.target.value}})} /></div>}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-slate-700 flex justify-end gap-3 rounded-b-xl">
                    {editingBot && <button onClick={()=>handleDeleteBot(editingBot._id)} className="px-4 py-2 text-red-400 hover:text-red-300">Delete</button>}
                    <button onClick={()=>setShowBotModal(false)} className="px-4 py-2 text-slate-400 hover:text-white">Cancel</button>
                    <button onClick={handleSaveBot} className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-500">Save Bot</button>
                </div>
            </div>
        </div>
      )}

      {/* --- MODAL USER (DARK) --- */}
      {showUserModal && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
              <div className="bg-slate-800 rounded-xl shadow-xl w-full max-w-md p-6 border border-slate-600">
                  <h3 className="font-bold text-white mb-4">{editingUser ? 'Edit User' : 'Add User'}</h3>
                  <div className="space-y-3">
                      <input className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" placeholder="Username" value={userForm.username} onChange={e=>setUserForm({...userForm, username:e.target.value})} />
                      <input className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" type="password" placeholder="Password" value={userForm.password} onChange={e=>setUserForm({...userForm, password:e.target.value})} />
                      <label className="flex items-center space-x-2 text-slate-300"><input type="checkbox" checked={userForm.isAdmin} onChange={e=>setUserForm({...userForm, isAdmin:e.target.checked})} /><span>Is Admin</span></label>
                      <div className="border border-slate-600 p-2 rounded max-h-32 overflow-y-auto bg-slate-900/50">
                          {bots.map(b => (
                              <label key={b._id} className="flex items-center space-x-2 mb-1 text-slate-300">
                                  <input type="checkbox" checked={userForm.assignedBots.includes(b._id)} onChange={()=>toggleBotAssignment(b._id)} />
                                  <span className="text-sm">{b.name}</span>
                              </label>
                          ))}
                      </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                      <button onClick={()=>setShowUserModal(false)} className="px-4 py-2 text-slate-400 hover:text-white">Cancel</button>
                      <button onClick={handleSaveUser} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500">Save</button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}

const StatCard = ({ title, value, icon, color, bg }) => (
    <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-lg flex items-center justify-between hover:bg-slate-750 transition-colors">
        <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">{title}</p>
            <h2 className="text-2xl font-bold text-white">{value}</h2>
        </div>
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl ${bg} ${color}`}>
            {icon}
        </div>
    </div>
);

export default AdminDashboard;