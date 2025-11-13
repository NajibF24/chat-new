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
  const [sidebarOpen, setSidebarOpen] = useState(true);
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

    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: new Date() }]);

    try {
      const response = await axios.post('/api/chat/message', {
        botId: selectedBot._id,
        message: userMessage
      });

      setMessages(prev => [...prev, { role: 'assistant', content: response.data.message, timestamp: new Date() }]);
    } catch (error) {
      console.error('Error sending message:', error);
      alert(error.response?.data?.error || 'Failed to send message.');
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const handleClearChat = async () => {
    if (!selectedBot) return;
    if (!window.confirm('Clear chat history?')) return;

    try {
      await axios.delete(`/api/chat/history/${selectedBot._id}`);
      setMessages([]);
    } catch (error) {
      console.error('Error clearing chat:', error);
      alert('Failed to clear chat history.');
    }
  };

  return (
    <div className="flex h-screen bg-steel-50">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-80' : 'w-0'} bg-white border-r border-steel-200 transition-all duration-300 overflow-hidden flex flex-col shadow-lg`}>
        {/* Header */}
        <div className="p-6 border-b border-steel-200 bg-gradient-to-r from-primary-600 to-primary-700">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">GYS AI Portal</h2>
              <p className="text-primary-100 text-sm">Garuda Yamato Steel</p>
            </div>
          </div>
          
          <div className="flex items-center justify-between text-white text-sm">
            <span className="flex items-center">
              <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              {user.username}
            </span>
            {user.isAdmin && (
              <span className="bg-white/20 px-2 py-1 rounded text-xs font-semibold">Admin</span>
            )}
          </div>
        </div>

        {/* Bots List */}
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-xs font-semibold text-steel-500 uppercase tracking-wider mb-3 px-2">Available Assistants</h3>
          <div className="space-y-2">
            {bots.map(bot => (
              <button
                key={bot._id}
                onClick={() => setSelectedBot(bot)}
                className={`w-full text-left p-4 rounded-xl transition-all duration-200 ${
                  selectedBot?._id === bot._id 
                    ? 'bg-primary-50 border-2 border-primary-500 shadow-md' 
                    : 'bg-steel-50 border-2 border-transparent hover:border-primary-200 hover:bg-primary-50/50'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    selectedBot?._id === bot._id ? 'bg-primary-500' : 'bg-primary-400'
                  }`}>
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-steel-800">{bot.name}</div>
                    <div className="text-xs text-steel-600 mt-1">{bot.description}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="p-4 border-t border-steel-200 space-y-2">
          {user.isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              className="w-full px-4 py-2.5 bg-steel-100 hover:bg-steel-200 text-steel-700 rounded-lg transition-colors font-medium flex items-center justify-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Admin Panel</span>
            </button>
          )}
          
          {selectedBot && (
            <button
              onClick={handleClearChat}
              className="w-full px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors font-medium flex items-center justify-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>Clear History</span>
            </button>
          )}
          
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2.5 bg-steel-700 hover:bg-steel-800 text-white rounded-lg transition-colors font-medium flex items-center justify-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <div className="bg-white border-b border-steel-200 px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-steel-100 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6 text-steel-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            
            {selectedBot && (
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-lg bg-primary-500 flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-steel-800">{selectedBot.name}</h3>
                  <p className="text-sm text-steel-500">{selectedBot.description}</p>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex items-center space-x-2">
            <span className="px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-sm font-medium">
              ● Online
            </span>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-steel-50">
          {selectedBot ? (
            <>
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-20 h-20 rounded-full bg-primary-100 flex items-center justify-center mb-4">
                    <svg className="w-10 h-10 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-steel-800 mb-2">Start a Conversation</h3>
                  <p className="text-steel-600 max-w-md">
                    Ask me anything about {selectedBot.name.toLowerCase()}. I'm here to help!
                  </p>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto space-y-4">
                  {messages.map((msg, idx) => <ChatMessage key={idx} message={msg} />)}
                  {loading && (
                    <div className="flex items-center space-x-2 text-steel-500">
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                      <span className="text-sm">AI is typing...</span>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-24 h-24 rounded-full bg-steel-200 flex items-center justify-center mb-4">
                <svg className="w-12 h-12 text-steel-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-2xl font-semibold text-steel-700 mb-2">Welcome to GYS AI Portal</h3>
              <p className="text-steel-500 max-w-md">
                Select an AI assistant from the sidebar to start chatting
              </p>
            </div>
          )}
        </div>

        {/* Input Area */}
        {selectedBot && (
          <div className="bg-white border-t border-steel-200 p-4 shadow-lg">
            <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto">
              <div className="flex space-x-3">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder={`Message ${selectedBot.name}...`}
                  className="flex-1 px-6 py-4 border-2 border-steel-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all outline-none text-steel-800 placeholder-steel-400"
                  disabled={loading}
                />
                <button
                  type="submit"
                  className="px-8 py-4 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  disabled={loading || !inputMessage.trim()}
                >
                  <span>Send</span>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default Chat;