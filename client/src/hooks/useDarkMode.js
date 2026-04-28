import { useState, useEffect } from 'react';

/**
 * useDarkMode — persists dark/light preference to localStorage.
 * Adds/removes 'dark' class on <html> for Tailwind dark: variants.
 */
export default function useDarkMode() {
  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem('gys-theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('gys-theme', isDark ? 'dark' : 'light');
    } catch {}
  }, [isDark]);

  const toggle = () => setIsDark(prev => !prev);

  return { isDark, toggle };
}
