import React from 'react';

function ChatMessage({ message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`mb-2 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`px-4 py-2 rounded-lg max-w-xs break-words ${
        isUser ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'
      }`}>
        {/* Pesan */}
        <div>{message.content}</div>
        
        {/* Timestamp */}
        {message.timestamp && (
          <div className="text-xs text-gray-500 mt-1 text-right">
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatMessage;
