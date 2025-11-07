import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

// ✅ Changed onLogout to handleLogout to match App.jsx
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
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <div className="flex items-center space-x-3">
          <span>Welcome, {user.username}</span>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg"
          >
            Chat
          </button>
          <button
            onClick={handleLogout} // ✅ Fixed
            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="mb-4 flex justify-between items-center">
        <h2 className="text-xl font-semibold">User Management</h2>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Create User
        </button>
      </div>

      {/* Users Table */}
      <table className="w-full table-auto border border-gray-300">
        <thead>
          <tr className="bg-gray-100">
            <th className="px-4 py-2 border">Username</th>
            <th className="px-4 py-2 border">Role</th>
            <th className="px-4 py-2 border">Assigned Bots</th>
            <th className="px-4 py-2 border">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u._id} className="text-center border-t">
              <td className="px-4 py-2">{u.username}</td>
              <td className="px-4 py-2">{u.isAdmin ? 'Admin' : 'User'}</td>
              <td className="px-4 py-2">
                {u.assignedBots.map(bot => bot.name).join(', ')}
              </td>
              <td className="px-4 py-2 space-x-2">
                <button
                  onClick={() => handleEdit(u)}
                  className="text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(u._id)}
                  className="text-red-600 hover:text-red-800"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white p-6 rounded-lg w-96">
            <h3 className="text-lg font-semibold mb-4">
              {editingUser ? 'Edit User' : 'Create User'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block mb-1">Username</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block mb-1">
                  Password {editingUser && '(leave blank to keep current)'}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required={!editingUser}
                />
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.isAdmin}
                  onChange={(e) => setFormData({ ...formData, isAdmin: e.target.checked })}
                  className="mr-2"
                />
                <span>Admin User</span>
              </div>
              <div>
                <span>Assigned Bots</span>
                <div className="flex flex-col mt-1 max-h-40 overflow-y-auto">
                  {bots.map(bot => (
                    <label key={bot._id} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={formData.assignedBots.includes(bot._id)}
                        onChange={() => toggleBotAssignment(bot._id)}
                        className="mr-2"
                      />
                      {bot.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-4">
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingUser ? 'Update' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
                >
                  Cancel
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
