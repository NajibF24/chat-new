// components/BotAvatar.jsx
// Komponen untuk menampilkan avatar bot di mana saja (chat header, list, dll)

import React from 'react';

/**
 * BotAvatar — render avatar bot berdasarkan type: image | emoji | icon
 *
 * Props:
 *   bot      — object bot (harus punya field .avatar)
 *   size     — 'xs' | 'sm' | 'md' | 'lg' | 'xl'  (default: 'md')
 *   className — tambahan class CSS
 */
const SIZES = {
  xs: { container: 'w-6 h-6 text-xs',    img: 'w-6 h-6'   },
  sm: { container: 'w-8 h-8 text-sm',    img: 'w-8 h-8'   },
  md: { container: 'w-10 h-10 text-lg',  img: 'w-10 h-10' },
  lg: { container: 'w-14 h-14 text-2xl', img: 'w-14 h-14' },
  xl: { container: 'w-20 h-20 text-4xl', img: 'w-20 h-20' },
};

export default function BotAvatar({ bot, size = 'md', className = '' }) {
  const avatar = bot?.avatar;
  const sizeClass = SIZES[size] || SIZES.md;

  const baseStyle = {
    backgroundColor: avatar?.bgColor || '#6366f1',
    color: avatar?.textColor || '#ffffff',
  };

  // ── Image upload ─────────────────────────────────────────
  if (avatar?.type === 'image' && avatar?.imageUrl) {
    return (
      <img
        src={avatar.imageUrl}
        alt={bot.name}
        className={`${sizeClass.img} rounded-full object-cover flex-shrink-0 ${className}`}
        onError={(e) => {
          // Fallback ke emoji jika gambar gagal load
          e.target.style.display = 'none';
          e.target.nextSibling?.style?.removeProperty('display');
        }}
      />
    );
  }

  // ── Icon (SVG string atau nama icon) ─────────────────────
  if (avatar?.type === 'icon' && avatar?.icon) {
    return (
      <div
        className={`${sizeClass.container} rounded-full flex items-center justify-center flex-shrink-0 ${className}`}
        style={baseStyle}
        dangerouslySetInnerHTML={{ __html: avatar.icon }}
      />
    );
  }

  // ── Emoji (default) ──────────────────────────────────────
  return (
    <div
      className={`${sizeClass.container} rounded-full flex items-center justify-center flex-shrink-0 select-none ${className}`}
      style={baseStyle}
    >
      {avatar?.emoji || '🤖'}
    </div>
  );
}
