import React from 'react';

/**
 * DarkModeToggle — a sun/moon icon button.
 * Props: isDark (bool), toggle (fn), className (optional extra classes)
 */
const DarkModeToggle = ({ isDark, toggle, className = '' }) => (
  <button
    onClick={toggle}
    title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    className={`p-2 rounded-xl transition-all duration-200 hover:scale-110 active:scale-95 ${
      isDark
        ? 'bg-gray-700 text-yellow-400 hover:bg-gray-600'
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
    } ${className}`}
  >
    {isDark ? (
      // Sun icon
      <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ) : (
      // Moon icon
      <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>
    )}
  </button>
);

export default DarkModeToggle;
