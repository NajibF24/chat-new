import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function AdminDashboard({ user, handleLogout }) {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [bots, setBots] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    isAdmin: false,
    assignedBots: []
  });

  useEffect(() => {
    fetchUsers();
    fetchBots();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await axios.get('/api/admin/users');
      setUsers(response.data.users);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const fetchBots = async () => {
    try {
      const response = await axios.get('/api/admin/bots');
      setBots(response.data.bots);
    } catch (error) {
      console.error('Error fetching bots:', error);
    }
  };

  const handleCreate = () => {
    setEditingUser(null);
    setFormData({
      username: '',
      password: '',
      isAdmin: false,
      assignedBots: []
    });
    setShowModal(true);
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '',
      isAdmin: user.isAdmin,
      assignedBots: user.assignedBots.map(bot => bot._id)
    });
    setShowModal(true);
  };

  const handleDelete = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;

    try {
      await axios.delete(`/api/admin/users/${userId}`);
      fetchUsers();
    } catch (error) {
      alert('Error deleting user');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await axios.put(`/api/admin/users/${editingUser._id}`, formData);
      } else {
        await axios.post('/api/admin/users', formData);
      }
      setShowModal(false);
      fetchUsers();
    } catch (error) {
      alert(error.response?.data?.error || 'Error saving user');
    }
  };

  const toggleBotAssignment = (botId) => {
    setFormData(prev => ({
      ...prev,
      assignedBots: prev.assignedBots.includes(botId)
        ? prev.assignedBots.filter(id => id !== botId)
        : [...prev.assignedBots, botId]
    }));
  };

  return (
    <div className="min-h-screen bg-steel-50">
      {/* Header */}
      <div className="bg-white border-b border-steel-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 rounded-xl bg-primary-600 flex items-center justify-center">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-steel-800">Admin Dashboard</h1>
                <p className="text-steel-600 text-sm">Garuda Yamato Steel - User Management</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="text-right mr-4">
                <p className="text-sm font-semibold text-steel-800">{user.username}</p>
                <p className="text-xs text-steel-500">Administrator</p>
              </div>
              <button
                onClick={() => navigate('/')}
                className="px-4 py-2 bg-steel-100 hover:bg-steel-200 text-steel-700 rounded-lg transition-colors font-medium flex items-center space-x-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <span>Chat</span>
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors font-medium flex items-center space-x-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="bg-white rounded-2xl shadow-sm border border-steel-200 overflow-hidden">
          {/* Table Header */}
          <div className="px-6 py-4 border-b border-steel-200 flex justify-between items-center bg-steel-50">
            <div>
              <h2 className="text-xl font-semibold text-steel-800">User Management</h2>
              <p className="text-sm text-steel-600 mt-1">Manage user accounts and permissions</p>
            </div>
            <button
              onClick={handleCreate}
              className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors font-semibold flex items-center space-x-2 shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span>Create User</span>
            </button>
          </div>

          {/* Users Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-steel-50 border-b border-steel-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-steel-600 uppercase tracking-wider">Username</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-steel-600 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-steel-600 uppercase tracking-wider">Assigned Bots</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-steel-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-steel-200">
                {users.map(u => (
                  <tr key={u._id} className="hover:bg-steel-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                          <svg className="w-5 h-5 text-primary-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <span className="font-medium text-steel-800">{u.username}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {u.isAdmin ? (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-primary-100 text-primary-700">
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          Admin
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-steel-100 text-steel-700">
                          User
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        {u.assignedBots.slice(0, 2).map(bot => (
                          <span key={bot._id} className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                            {bot.name}
                          </span>
                        ))}
                        {u.assignedBots.length > 2 && (
                          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-steel-100 text-steel-600">
                            +{u.assignedBots.length - 2} more
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => handleEdit(u)}
                          className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(u._id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-steel-200 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-steel-200 bg-gradient-to-r from-primary-600 to-primary-700">
              <h3 className="text-xl font-semibold text-white">
                {editingUser ? 'Edit User' : 'Create New User'}
              </h3>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-steel-700 mb-2">Username</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-steel-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all outline-none"
                  placeholder="Enter username"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-steel-700 mb-2">
                  Password {editingUser && <span className="text-steel-500 font-normal">(leave blank to keep current)</span>}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-steel-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all outline-none"
                  placeholder="Enter password"
                  required={!editingUser}
                />
              </div>

              <div className="flex items-center space-x-3 p-4 bg-steel-50 rounded-lg">
                <input
                  type="checkbox"
                  id="isAdmin"
                  checked={formData.isAdmin}
                  onChange={(e) => setFormData({ ...formData, isAdmin: e.target.checked })}
                  className="w-5 h-5 text-primary-600 border-steel-300 rounded focus:ring-2 focus:ring-primary-500"
                />
                <label htmlFor="isAdmin" className="text-sm font-medium text-steel-700 cursor-pointer">
                  Grant Administrator Privileges
                </label>
              </div>

              <div>
                <label className="block text-sm font-semibold text-steel-700 mb-3">Assigned Bots</label>
                <div className="space-y-2 max-h-48 overflow-y-auto p-1">
                  {bots.map(bot => (
                    <label
                      key={bot._id}
                      className="flex items-center space-x-3 p-3 bg-steel-50 hover:bg-primary-50 rounded-lg cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={formData.assignedBots.includes(bot._id)}
                        onChange={() => toggleBotAssignment(bot._id)}
                        className="w-5 h-5 text-primary-600 border-steel-300 rounded focus:ring-2 focus:ring-primary-500"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-steel-800">{bot.name}</div>
                        <div className="text-xs text-steel-600">{bot.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex justify-end space-x-3 pt-4 border-t border-steel-200">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 bg-steel-100 hover:bg-steel-200 text-steel-700 rounded-lg transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors font-semibold shadow-md hover:shadow-lg"
                >
                  {editingUser ? 'Update User' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;