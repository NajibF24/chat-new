import React from 'react';

function ChatMessage({ message }) {
  const isUser = message.role === 'user';

  // Function to parse and render formatted text
  const renderFormattedText = (text) => {
    if (!text) return null;

    // Split by lines
    const lines = text.split('\n');
    const elements = [];
    let currentList = [];
    let inList = false;

    lines.forEach((line, idx) => {
      const trimmedLine = line.trim();

      // Skip empty lines
      if (!trimmedLine) {
        if (inList && currentList.length > 0) {
          elements.push(
            <ul key={`list-${idx}`} className="list-disc list-inside ml-2 my-2 space-y-1">
              {currentList.map((item, i) => (
                <li key={i} className="text-sm leading-relaxed">
                  {renderInlineFormatting(item)}
                </li>
              ))}
            </ul>
          );
          currentList = [];
          inList = false;
        }
        elements.push(<br key={`br-${idx}`} />);
        return;
      }

      // Check if it's a bullet point (•, *, -)
      if (trimmedLine.startsWith('•') || trimmedLine.startsWith('*') || trimmedLine.startsWith('-')) {
        const content = trimmedLine.substring(1).trim();
        currentList.push(content);
        inList = true;
      }
      // Check if it's a header (starts with **)
      else if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**')) {
        if (inList && currentList.length > 0) {
          elements.push(
            <ul key={`list-${idx}`} className="list-disc list-inside ml-2 my-2 space-y-1">
              {currentList.map((item, i) => (
                <li key={i} className="text-sm leading-relaxed">
                  {renderInlineFormatting(item)}
                </li>
              ))}
            </ul>
          );
          currentList = [];
          inList = false;
        }
        const headerText = trimmedLine.replace(/\*\*/g, '');
        elements.push(
          <div key={`header-${idx}`} className="font-semibold text-base mt-3 mb-2">
            {headerText}
          </div>
        );
      }
      // Regular text
      else {
        if (inList && currentList.length > 0) {
          elements.push(
            <ul key={`list-${idx}`} className="list-disc list-inside ml-2 my-2 space-y-1">
              {currentList.map((item, i) => (
                <li key={i} className="text-sm leading-relaxed">
                  {renderInlineFormatting(item)}
                </li>
              ))}
            </ul>
          );
          currentList = [];
          inList = false;
        }
        elements.push(
          <div key={`text-${idx}`} className="text-sm leading-relaxed mb-1">
            {renderInlineFormatting(line)}
          </div>
        );
      }
    });

    // Flush remaining list items
    if (inList && currentList.length > 0) {
      elements.push(
        <ul key="list-final" className="list-disc list-inside ml-2 my-2 space-y-1">
          {currentList.map((item, i) => (
            <li key={i} className="text-sm leading-relaxed">
              {renderInlineFormatting(item)}
            </li>
          ))}
        </ul>
      );
    }

    return <div className="space-y-1">{elements}</div>;
  };

  // Function to render inline formatting (bold, italic, code)
  const renderInlineFormatting = (text) => {
    if (!text) return null;

    const parts = [];
    let currentText = text;
    let key = 0;

    // Process bold text (**text**)
    const boldRegex = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match;

    while ((match = boldRegex.exec(text)) !== null) {
      // Add text before bold
      if (match.index > lastIndex) {
        parts.push(
          <span key={key++}>{text.substring(lastIndex, match.index)}</span>
        );
      }
      // Add bold text
      parts.push(
        <strong key={key++} className="font-semibold">
          {match[1]}
        </strong>
      );
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(<span key={key++}>{text.substring(lastIndex)}</span>);
    }

    return parts.length > 0 ? parts : text;
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`flex items-start space-x-3 max-w-2xl ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}>
        {/* Avatar */}
        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
          isUser
            ? 'bg-primary-600'
            : 'bg-steel-200'
        }`}>
          {isUser ? (
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-steel-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          )}
        </div>

        {/* Message Content */}
        <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          <div className={`px-5 py-3 rounded-2xl shadow-sm ${
            isUser
              ? 'bg-primary-600 text-white rounded-tr-sm'
              : 'bg-white text-steel-800 border border-steel-200 rounded-tl-sm'
          }`}>
            <div className="leading-relaxed">
              {renderFormattedText(message.content)}
            </div>
          </div>

          {/* Timestamp */}
          {message.timestamp && (
            <div className={`text-xs text-steel-500 mt-1 px-2 ${isUser ? 'text-right' : 'text-left'}`}>
              {new Date(message.timestamp).toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatMessage;
