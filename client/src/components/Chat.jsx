import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ChatMessage from './ChatMessage';

function Chat({ user, handleLogout }) {
  const navigate = useNavigate();
  const [bots, setBots] = useState([]);
  const [selectedBot, setSelectedBot] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchBots();
  }, []);

  useEffect(() => {
    if (selectedBot) {
      fetchChatHistory(selectedBot._id);
    }
  }, [selectedBot]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchBots = async () => {
    try {
      const response = await axios.get('/api/chat/bots');
      setBots(response.data.bots);
      if (response.data.bots.length > 0) setSelectedBot(response.data.bots[0]);
    } catch (error) {
      console.error('Error fetching bots:', error);
    }
  };

  const fetchChatHistory = async (botId) => {
    try {
      const response = await axios.get(`/api/chat/history/${botId}`);
      setMessages(response.data.messages);
    } catch (error) {
      console.error('Error fetching chat history:', error);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || !selectedBot || loading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setLoading(true);

    // Optimistic UI update
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: new Date() }]);

    try {
      const response = await axios.post('/api/chat/message', {
        botId: selectedBot._id,
        message: userMessage
      });

      setMessages(prev => [...prev, { role: 'assistant', content: response.data.message, timestamp: new Date() }]);
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message.');
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const handleClearChat = async () => {
    if (!selectedBot) return;
    if (!window.confirm('Are you sure you want to clear chat history?')) return;

    try {
      await axios.delete(`/api/chat/history/${selectedBot._id}`);
      setMessages([]);
    } catch (error) {
      console.error('Error clearing chat:', error);
      alert('Failed to clear chat history.');
    }
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-64 bg-gray-100 p-4 flex flex-col">
        <h2 className="text-xl font-bold mb-4">Internal Chat</h2>
        <div className="flex-1 overflow-y-auto">
          {bots.map(bot => (
            <button
              key={bot._id}
              onClick={() => setSelectedBot(bot)}
              className={`w-full text-left px-4 py-2 mb-2 rounded-lg hover:bg-gray-200 transition ${
                selectedBot?._id === bot._id ? 'bg-blue-50 border-l-4 border-blue-600' : ''
              }`}
            >
              <div className="font-semibold">{bot.name}</div>
              <div className="text-sm text-gray-600">{bot.description}</div>
            </button>
          ))}
        </div>
        {selectedBot && (
          <button
            onClick={handleClearChat}
            className="mt-2 px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
          >
            Clear Chat History
          </button>
        )}
        <button
          onClick={handleLogout}
          className="mt-2 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition"
        >
          Logout
        </button>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-white p-4">
        {selectedBot ? (
          <>
            <div className="flex-1 overflow-y-auto mb-4">
              {messages.length === 0 ? (
                <div className="text-gray-400 text-center mt-10">
                  💬 No messages yet. Start a conversation!
                </div>
              ) : (
                messages.map((msg, idx) => <ChatMessage key={idx} message={msg} />)
              )}
              {loading && <div className="text-gray-500 text-center">Typing...</div>}
              <div ref={messagesEndRef} />
            </div>

            <form className="flex" onSubmit={handleSendMessage}>
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={`Message ${selectedBot.name}...`}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-r-lg hover:bg-blue-700 transition"
                disabled={loading}
              >
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-xl">
            🤖 Select a bot to start chatting
          </div>
        )}
      </div>
    </div>
  );
}

export default Chat;
