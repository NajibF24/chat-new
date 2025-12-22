import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function AdminDashboard({ user, handleLogout }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('users'); // 'users' | 'chats' | 'bots'
  
  // --- STATES ---
  const [users, setUsers] = useState([]);
  const [bots, setBots] = useState([]);
  const [chatLogs, setChatLogs] = useState([]);
  const [logPage, setLogPage] = useState(1);
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [loadingLogs, setLoadingLogs] = useState(false);
  
  // ✅ STATE BARU: FILTER EXPORT
  const [exportFilter, setExportFilter] = useState(''); // Format: "YYYY-MM"

  // Bot Editing State
  const [editingBot, setEditingBot] = useState(null);
  const [showBotModal, setShowBotModal] = useState(false);
  
  // ✅ STATE FORM BOT LENGKAP
  const [botForm, setBotForm] = useState({
      name: '', description: '', systemPrompt: '', 
      starterQuestions: [], // Array string
      smartsheetConfig: { enabled: false, apiKey: '', sheetId: '' },
      kouventaConfig: { enabled: false, apiKey: '', endpoint: '' },
      onedriveConfig: { enabled: false, folderUrl: '', tenantId: '', clientId: '', clientSecret: '' }
  });

  // User Editing State
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({ username: '', password: '', isAdmin: false, assignedBots: [] });

  useEffect(() => {
    fetchUsers();
    fetchBots();
  }, []);

  useEffect(() => {
    if (activeTab === 'chats') fetchChatLogs();
  }, [activeTab, logPage]);

  // === API CALLS ===
  const fetchUsers = async () => {
    try {
      const response = await axios.get('/api/admin/users');
      setUsers(response.data.users);
    } catch (error) { console.error(error); }
  };

  const fetchBots = async () => {
    try {
      const response = await axios.get('/api/admin/bots');
      setBots(response.data.bots);
    } catch (error) { console.error(error); }
  };

  const fetchChatLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await axios.get(`/api/admin/chat-logs?page=${logPage}&limit=20`);
      setChatLogs(res.data.chats);
      setLogTotalPages(res.data.totalPages);
    } catch (error) { console.error(error); } finally { setLoadingLogs(false); }
  };

  // ✅ FUNGSI EXPORT YANG DIPERBARUI
  const handleExport = async () => {
      try {
          let url = '/api/admin/export-chats';
          
          // Jika filter bulan dipilih, tambahkan query params
          if (exportFilter) {
              const [year, month] = exportFilter.split('-');
              url += `?year=${year}&month=${month}`;
          }

          const response = await axios.get(url, { responseType: 'blob' });
          const urlObj = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = urlObj;
          
          // Nama file dinamis sesuai filter
          const fileName = exportFilter 
            ? `chat-logs-${exportFilter}.csv`
            : `chat-logs-all-${new Date().toISOString().slice(0,10)}.csv`;
            
          link.setAttribute('download', fileName);
          document.body.appendChild(link);
          link.click();
          link.remove();
      } catch (error) { alert('Export failed'); }
  };

  // === BOT HANDLERS ===
  const handleEditBot = (bot) => {
      setEditingBot(bot);
      setBotForm({
          name: bot.name,
          description: bot.description,
          systemPrompt: bot.systemPrompt || '',
          starterQuestions: bot.starterQuestions || [], 
          smartsheetConfig: {
              enabled: bot.smartsheetConfig?.enabled || false,
              apiKey: bot.smartsheetConfig?.apiKey || '',
              sheetId: bot.smartsheetConfig?.sheetId || ''
          },
          kouventaConfig: {
              enabled: bot.kouventaConfig?.enabled || false,
              apiKey: bot.kouventaConfig?.apiKey || '',
              endpoint: bot.kouventaConfig?.endpoint || ''
          },
          onedriveConfig: {
              enabled: bot.onedriveConfig?.enabled || false,
              folderUrl: bot.onedriveConfig?.folderUrl || '',
              tenantId: bot.onedriveConfig?.tenantId || '',
              clientId: bot.onedriveConfig?.clientId || '',
              clientSecret: bot.onedriveConfig?.clientSecret || ''
          }
      });
      setShowBotModal(true);
  };

  const handleSaveBot = async (e) => {
      e.preventDefault();
      try {
          // Filter pertanyaan kosong sebelum disimpan
          const cleanedForm = {
              ...botForm,
              starterQuestions: botForm.starterQuestions.filter(q => q.trim() !== '')
          };

          if (editingBot) await axios.put(`/api/admin/bots/${editingBot._id}`, cleanedForm);
          else await axios.post('/api/admin/bots', cleanedForm);
          setShowBotModal(false);
          fetchBots();
      } catch (error) { alert(error.response?.data?.error || error.message); }
  };

  const handleDeleteBot = async (id) => {
      if(!window.confirm("Delete this bot?")) return;
      try { await axios.delete(`/api/admin/bots/${id}`); fetchBots(); } catch(e) { alert(e.message); }
  };

  // --- QUESTION HANDLERS ---
  const addQuestion = () => {
      setBotForm({ ...botForm, starterQuestions: [...botForm.starterQuestions, ''] });
  };

  const updateQuestion = (index, value) => {
      const newQuestions = [...botForm.starterQuestions];
      newQuestions[index] = value;
      setBotForm({ ...botForm, starterQuestions: newQuestions });
  };

  const removeQuestion = (index) => {
      const newQuestions = botForm.starterQuestions.filter((_, i) => i !== index);
      setBotForm({ ...botForm, starterQuestions: newQuestions });
  };

  // === USER HANDLERS ===
  const handleEditUser = (user) => {
      setEditingUser(user);
      setUserForm({
          username: user.username, password: '', isAdmin: user.isAdmin,
          assignedBots: user.assignedBots.map(b => b._id)
      });
      setShowUserModal(true);
  };

  const handleSaveUser = async (e) => {
      e.preventDefault();
      try {
          if (editingUser) await axios.put(`/api/admin/users/${editingUser._id}`, userForm);
          else await axios.post('/api/admin/users', userForm);
          setShowUserModal(false);
          fetchUsers();
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

  return (
    <div className="min-h-screen bg-steel-50">
      {/* Header */}
      <div className="bg-white border-b border-steel-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
            <div className="flex items-center space-x-3">
                <div className="bg-primary-600 text-white p-2 rounded-lg font-bold">Admin</div>
                <h1 className="text-xl font-bold text-gray-800">GYS Portal</h1>
            </div>
            <div className="flex items-center space-x-3">
                <span className="text-sm font-medium text-gray-600 mr-2">{user.username}</span>
                <button onClick={() => navigate('/')} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded text-gray-700">Chat App</button>
                <button onClick={handleLogout} className="px-3 py-1.5 text-sm bg-red-50 hover:bg-red-100 text-red-600 rounded">Logout</button>
            </div>
        </div>
        
        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-6">
            <div className="flex space-x-6">
                {['users', 'chats', 'bots'].map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} 
                        className={`pb-3 px-2 text-sm font-medium border-b-2 capitalize transition-colors ${activeTab === tab ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                        {tab === 'users' ? '👥 Users' : tab === 'chats' ? '👁️ Monitoring' : '🤖 Bot Settings'}
                    </button>
                ))}
            </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        
        {/* === USERS TAB === */}
        {activeTab === 'users' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
                    <h2 className="font-bold text-gray-700">User Management</h2>
                    <button onClick={() => { setEditingUser(null); setUserForm({username:'', password:'', isAdmin:false, assignedBots:[]}); setShowUserModal(true); }} 
                        className="px-4 py-2 bg-primary-600 text-white text-sm rounded hover:bg-primary-700">Add User</button>
                </div>
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-100 text-gray-600 uppercase text-xs">
                        <tr><th className="px-6 py-3">User</th><th className="px-6 py-3">Role</th><th className="px-6 py-3">Bots</th><th className="px-6 py-3 text-right">Actions</th></tr>
                    </thead>
                    <tbody className="divide-y">
                        {users.map(u => (
                            <tr key={u._id} className="hover:bg-gray-50">
                                <td className="px-6 py-3 font-medium">{u.username}</td>
                                <td className="px-6 py-3">{u.isAdmin ? <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs">Admin</span> : 'User'}</td>
                                <td className="px-6 py-3">{u.assignedBots.length} assigned</td>
                                <td className="px-6 py-3 text-right space-x-2">
                                    <button onClick={() => handleEditUser(u)} className="text-blue-600 hover:underline">Edit</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}

        {/* === CHATS TAB (WITH MONTH FILTER) === */}
        {activeTab === 'chats' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-[600px]">
                <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
                    <h2 className="font-bold text-gray-700">Chat History Logs</h2>
                    
                    <div className="flex items-center space-x-2">
                        {/* INPUT BULAN */}
                        <input 
                            type="month" 
                            value={exportFilter}
                            onChange={(e) => setExportFilter(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                            title="Filter export by month"
                        />
                        <button onClick={handleExport} className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 shadow-sm flex items-center">
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            Export {exportFilter ? 'Month' : 'All'}
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-100 text-gray-600 uppercase text-xs sticky top-0">
                            <tr><th className="px-6 py-3">Time</th><th className="px-6 py-3">User</th><th className="px-6 py-3">Bot</th><th className="px-6 py-3">Message</th></tr>
                        </thead>
                        <tbody className="divide-y">
                            {chatLogs.map(log => (
                                <tr key={log._id} className="hover:bg-gray-50">
                                    <td className="px-6 py-3 whitespace-nowrap text-xs text-gray-500">{new Date(log.createdAt).toLocaleString()}</td>
                                    <td className="px-6 py-3">{log.userId?.username}</td>
                                    <td className="px-6 py-3">{log.botId?.name}</td>
                                    <td className="px-6 py-3 truncate max-w-xs" title={log.content}>{log.content || (log.attachedFiles?.length ? '📎 Attachment' : '')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="p-3 border-t bg-gray-50 flex justify-between items-center">
                    <span className="text-xs text-gray-500">Page {logPage} of {logTotalPages}</span>
                    <div className="space-x-2">
                        <button disabled={logPage===1} onClick={()=>setLogPage(p=>p-1)} className="px-3 py-1 border rounded text-xs disabled:opacity-50">Prev</button>
                        <button disabled={logPage===logTotalPages} onClick={()=>setLogPage(p=>p+1)} className="px-3 py-1 border rounded text-xs disabled:opacity-50">Next</button>
                    </div>
                </div>
            </div>
        )}

        {/* === BOTS TAB (UPDATED FORM) === */}
        {activeTab === 'bots' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Create New Card */}
                <div onClick={() => { setEditingBot(null); setBotForm({name:'', description:'', systemPrompt:'', starterQuestions:[], smartsheetConfig:{enabled:false}, kouventaConfig:{enabled:false}, onedriveConfig:{enabled:false}}); setShowBotModal(true); }} 
                     className="bg-white rounded-xl border-2 border-dashed border-gray-300 p-6 flex flex-col items-center justify-center cursor-pointer hover:border-primary-500 hover:bg-primary-50 transition-all min-h-[200px]">
                    <div className="w-12 h-12 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center mb-3 text-2xl font-bold">+</div>
                    <span className="font-semibold text-gray-600">Create New Bot</span>
                </div>

                {bots.map(bot => (
                    <div key={bot._id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow relative group">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="font-bold text-lg text-gray-800">{bot.name}</h3>
                            <button onClick={() => handleEditBot(bot)} className="text-primary-600 hover:text-primary-800 bg-primary-50 px-3 py-1 rounded text-sm font-medium">Config</button>
                        </div>
                        <p className="text-sm text-gray-500 mb-4 h-10 overflow-hidden">{bot.description}</p>
                        
                        <div className="flex flex-wrap gap-2 text-xs">
                            {bot.smartsheetConfig?.enabled && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">Smartsheet</span>}
                            {bot.kouventaConfig?.enabled && <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-bold">Kouventa</span>}
                            {bot.onedriveConfig?.enabled && <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-bold">OneDrive</span>}
                        </div>
                    </div>
                ))}
            </div>
        )}
      </div>

      {/* MODAL BOT */}
      {showBotModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center rounded-t-xl">
                    <h3 className="font-bold text-gray-800">{editingBot ? 'Edit Configuration' : 'New Bot'}</h3>
                    <button onClick={() => setShowBotModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-xs font-bold text-gray-500 block mb-1">Name</label><input className="w-full border rounded p-2 text-sm" value={botForm.name} onChange={e=>setBotForm({...botForm, name:e.target.value})} /></div>
                        <div><label className="text-xs font-bold text-gray-500 block mb-1">Description</label><input className="w-full border rounded p-2 text-sm" value={botForm.description} onChange={e=>setBotForm({...botForm, description:e.target.value})} /></div>
                    </div>

                    {/* STARTER QUESTIONS */}
                    <div>
                        <label className="text-xs font-bold text-gray-500 block mb-2">Starter Questions (Chips)</label>
                        <div className="space-y-2">
                            {botForm.starterQuestions.map((q, idx) => (
                                <div key={idx} className="flex gap-2">
                                    <input 
                                        className="flex-1 border rounded p-2 text-sm" 
                                        value={q} 
                                        onChange={(e) => updateQuestion(idx, e.target.value)}
                                        placeholder="e.g. List active projects"
                                    />
                                    <button onClick={() => removeQuestion(idx)} className="text-red-500 px-2 hover:bg-red-50 rounded">✕</button>
                                </div>
                            ))}
                            <button onClick={addQuestion} className="text-primary-600 text-xs font-bold hover:underline">+ Add Question</button>
                        </div>
                    </div>

                    {/* SYSTEM PROMPT (Disable if Kouventa) */}
                    <div className={botForm.kouventaConfig.enabled ? "opacity-50 pointer-events-none grayscale" : ""}>
                        <label className="text-xs font-bold text-gray-500 block mb-1">System Prompt (OpenAI Only)</label>
                        <textarea className="w-full border rounded p-2 text-sm h-32 font-mono bg-gray-50" value={botForm.systemPrompt} onChange={e=>setBotForm({...botForm, systemPrompt:e.target.value})} placeholder="You are a helpful assistant..." />
                        {botForm.kouventaConfig.enabled && <p className="text-[10px] text-purple-600 font-bold mt-1">Prompting handled by Kouventa Platform.</p>}
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        {/* SMARTSHEET */}
                        <div className="border rounded-lg p-4 bg-blue-50/50 border-blue-100">
                            <div className="flex justify-between items-center mb-3"><span className="font-bold text-blue-800 text-sm">Smartsheet Data</span><input type="checkbox" checked={botForm.smartsheetConfig.enabled} onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, enabled:e.target.checked}})} className="w-4 h-4" /></div>
                            {botForm.smartsheetConfig.enabled && ( <div className="space-y-2"><input placeholder="Sheet ID" className="w-full border rounded p-2 text-xs" value={botForm.smartsheetConfig.sheetId} onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, sheetId:e.target.value}})} /><input type="password" placeholder="API Key" className="w-full border rounded p-2 text-xs" value={botForm.smartsheetConfig.apiKey} onChange={e=>setBotForm({...botForm, smartsheetConfig:{...botForm.smartsheetConfig, apiKey:e.target.value}})} /></div> )}
                        </div>

                        {/* ONEDRIVE */}
                        <div className="border rounded-lg p-4 bg-orange-50/50 border-orange-100">
                            <div className="flex justify-between items-center mb-3"><span className="font-bold text-orange-800 text-sm">OneDrive / SharePoint</span><input type="checkbox" checked={botForm.onedriveConfig.enabled} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, enabled:e.target.checked}})} className="w-4 h-4" /></div>
                            {botForm.onedriveConfig.enabled && ( 
                                <div className="space-y-2">
                                    <input placeholder="Folder URL" className="w-full border rounded p-2 text-xs" value={botForm.onedriveConfig.folderUrl} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, folderUrl:e.target.value}})} />
                                    <div className="grid grid-cols-3 gap-2">
                                        <input placeholder="Tenant ID" className="border rounded p-2 text-xs" value={botForm.onedriveConfig.tenantId} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, tenantId:e.target.value}})} />
                                        <input placeholder="Client ID" className="border rounded p-2 text-xs" value={botForm.onedriveConfig.clientId} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, clientId:e.target.value}})} />
                                        <input type="password" placeholder="Client Secret" className="border rounded p-2 text-xs" value={botForm.onedriveConfig.clientSecret} onChange={e=>setBotForm({...botForm, onedriveConfig:{...botForm.onedriveConfig, clientSecret:e.target.value}})} />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* KOUVENTA */}
                        <div className="border rounded-lg p-4 bg-purple-50/50 border-purple-100">
                            <div className="flex justify-between items-center mb-3"><span className="font-bold text-purple-800 text-sm">Kouventa AI Engine</span><input type="checkbox" checked={botForm.kouventaConfig.enabled} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, enabled:e.target.checked}})} className="w-4 h-4" /></div>
                            {botForm.kouventaConfig.enabled && ( 
                                <div className="space-y-2">
                                    <input placeholder="Runner URL" className="w-full border rounded p-2 text-xs" value={botForm.kouventaConfig.endpoint} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, endpoint:e.target.value}})} />
                                    <input type="password" placeholder="API Key" className="w-full border rounded p-2 text-xs" value={botForm.kouventaConfig.apiKey} onChange={e=>setBotForm({...botForm, kouventaConfig:{...botForm.kouventaConfig, apiKey:e.target.value}})} />
                                </div> 
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t bg-gray-50 flex justify-end space-x-3 rounded-b-xl">
                    {editingBot && <button onClick={()=>handleDeleteBot(editingBot._id)} className="px-4 py-2 text-red-600 hover:bg-red-50 rounded text-sm">Delete</button>}
                    <button onClick={()=>setShowBotModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded text-sm">Cancel</button>
                    <button onClick={handleSaveBot} className="px-6 py-2 bg-primary-600 text-white rounded shadow text-sm hover:bg-primary-700">Save Bot</button>
                </div>
            </div>
        </div>
      )}

      {/* MODAL USER (Sama seperti sebelumnya) */}
      {showUserModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                  <h3 className="font-bold mb-4">{editingUser ? 'Edit User' : 'Add User'}</h3>
                  <div className="space-y-3">
                      <input className="w-full border rounded p-2" placeholder="Username" value={userForm.username} onChange={e=>setUserForm({...userForm, username:e.target.value})} />
                      <input className="w-full border rounded p-2" type="password" placeholder="Password" value={userForm.password} onChange={e=>setUserForm({...userForm, password:e.target.value})} />
                      <label className="flex items-center space-x-2"><input type="checkbox" checked={userForm.isAdmin} onChange={e=>setUserForm({...userForm, isAdmin:e.target.checked})} /><span>Is Admin</span></label>
                      <div className="border p-2 rounded max-h-32 overflow-y-auto">
                          {bots.map(b => (
                              <label key={b._id} className="flex items-center space-x-2 mb-1">
                                  <input type="checkbox" checked={userForm.assignedBots.includes(b._id)} onChange={()=>toggleBotAssignment(b._id)} />
                                  <span className="text-sm">{b.name}</span>
                              </label>
                          ))}
                      </div>
                  </div>
                  <div className="flex justify-end space-x-2 mt-4">
                      <button onClick={()=>setShowUserModal(false)} className="px-4 py-2 border rounded">Cancel</button>
                      <button onClick={handleSaveUser} className="px-4 py-2 bg-primary-600 text-white rounded">Save</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

export default AdminDashboard;
