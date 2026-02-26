// components/AvatarPicker.jsx
// Modal/panel untuk memilih avatar bot: upload gambar, emoji, atau icon SVG

import React, { useState, useRef, useCallback } from 'react';

// ── EMOJI DATA ────────────────────────────────────────────────
const EMOJI_CATEGORIES = {
  'Robot & AI': ['🤖', '🧠', '💡', '⚡', '🔮', '🛸', '👾', '🤯', '💻', '🖥️', '🖨️', '⌨️', '🖱️'],
  'Business': ['📊', '📈', '📉', '💼', '🏢', '📋', '📌', '📍', '🗂️', '📁', '📂', '🗃️', '📄', '📃'],
  'Communication': ['💬', '📢', '📣', '📨', '📧', '📬', '📮', '🔔', '🔕', '📯'],
  'Tools': ['🔧', '🔨', '⚙️', '🛠️', '🔩', '🔗', '📎', '✂️', '🖊️', '✏️', '📝'],
  'Data & Analytics': ['📊', '🗄️', '💾', '💿', '📀', '🔍', '🔎', '🧮', '📐', '📏'],
  'Industry': ['🏭', '⚙️', '🏗️', '🔩', '⛏️', '🪛', '🔬', '🧪', '⚗️', '🏚️'],
  'Finance': ['💰', '💵', '💴', '💶', '💷', '💳', '🏦', '💹', '📈'],
  'Nature': ['🌱', '🌿', '🍃', '🌳', '🌊', '⭐', '🌟', '✨', '🌈', '🔥'],
  'Fun': ['🎯', '🎲', '🎮', '🕹️', '🎪', '🎨', '🎭', '🎬', '🎤', '🎧'],
};

// ── ICON LIBRARY ──────────────────────────────────────────────
const ICON_LIBRARY = [
  {
    name: 'Chart Bar',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>`
  },
  {
    name: 'Bot',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>`
  },
  {
    name: 'Document',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`
  },
  {
    name: 'Database',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`
  },
  {
    name: 'Settings',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2M12 20v2M20 12h2M2 12h2M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41"/></svg>`
  },
  {
    name: 'Users',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
  },
  {
    name: 'Search',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
  },
  {
    name: 'Lightning',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`
  },
  {
    name: 'Shield',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
  },
  {
    name: 'Factory',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/></svg>`
  },
  {
    name: 'Truck',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`
  },
  {
    name: 'Analytics',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`
  },
  {
    name: 'Folder',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
  },
  {
    name: 'Calendar',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`
  },
  {
    name: 'Mail',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`
  },
  {
    name: 'Lock',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="60%" height="60%"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
  },
];

// ── PRESET BACKGROUND COLORS ──────────────────────────────────
const BG_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#1e293b', '#374151',
  '#0f172a', '#065f46', '#7c2d12', '#831843',
];

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

export default function AvatarPicker({ bot, onSave, onClose }) {
  const [tab, setTab] = useState('emoji'); // 'image' | 'emoji' | 'icon'
  const [selectedEmoji, setSelectedEmoji] = useState(bot?.avatar?.emoji || '🤖');
  const [selectedIcon, setSelectedIcon] = useState(bot?.avatar?.icon || null);
  const [selectedIconName, setSelectedIconName] = useState('');
  const [bgColor, setBgColor] = useState(bot?.avatar?.bgColor || '#6366f1');
  const [customBg, setCustomBg] = useState(bot?.avatar?.bgColor || '#6366f1');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(bot?.avatar?.imageUrl || null);
  const [isDragging, setIsDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const fileInputRef = useRef(null);

  // ── Preview avatar saat ini ──────────────────────────────
  const previewAvatar = () => {
    if (tab === 'image' && imagePreview) {
      return <img src={imagePreview} alt="Preview" className="w-full h-full object-cover rounded-full" />;
    }
    if (tab === 'icon' && selectedIcon) {
      return (
        <div
          className="w-full h-full rounded-full flex items-center justify-center"
          style={{ backgroundColor: bgColor }}
          dangerouslySetInnerHTML={{ __html: selectedIcon }}
        />
      );
    }
    return (
      <div
        className="w-full h-full rounded-full flex items-center justify-center text-4xl"
        style={{ backgroundColor: tab === 'emoji' ? bgColor : bgColor }}
      >
        {selectedEmoji}
      </div>
    );
  };

  // ── Drag & Drop ──────────────────────────────────────────
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) processImageFile(file);
  }, []);

  const processImageFile = (file) => {
    if (file.size > 2 * 1024 * 1024) {
      alert('Ukuran file maksimal 2MB');
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target.result);
    reader.readAsDataURL(file);
  };

  // ── Save ─────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      if (tab === 'image' && imageFile) {
        // Upload file
        const formData = new FormData();
        formData.append('avatar', imageFile);
        const res = await fetch(`/api/bots/${bot._id}/avatar`, {
          method: 'POST',
          body: formData,
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        onSave(data.bot);
      } else {
        // Update emoji or icon
        const body = {
          type: tab,
          emoji: tab === 'emoji' ? selectedEmoji : bot?.avatar?.emoji,
          icon: tab === 'icon' ? selectedIcon : null,
          bgColor,
          textColor: '#ffffff',
        };
        const res = await fetch(`/api/bots/${bot._id}/avatar`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        onSave(data.bot);
      }
      onClose();
    } catch (err) {
      alert('Gagal menyimpan avatar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Filter emoji by search ───────────────────────────────
  const filteredEmojis = (emojis) => {
    if (!emojiSearch) return emojis;
    // Simple filter by search text (in real app, add emoji names)
    return emojis;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">

        {/* ── HEADER ───────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">Pilih Avatar — {bot?.name}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* ── PREVIEW ────────────────────────────────────── */}
          <div className="flex justify-center">
            <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-indigo-100 shadow-lg">
              {previewAvatar()}
            </div>
          </div>

          {/* ── TABS ───────────────────────────────────────── */}
          <div className="flex rounded-xl bg-gray-100 p-1 gap-1">
            {[
              { id: 'emoji', label: '😀 Emoji' },
              { id: 'icon', label: '🔷 Icon' },
              { id: 'image', label: '🖼️ Upload' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                  tab === t.id
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── TAB: EMOJI ──────────────────────────────────── */}
          {tab === 'emoji' && (
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Cari emoji..."
                value={emojiSearch}
                onChange={e => setEmojiSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <div className="max-h-52 overflow-y-auto space-y-3 pr-1">
                {Object.entries(EMOJI_CATEGORIES).map(([cat, emojis]) => (
                  <div key={cat}>
                    <p className="text-xs font-medium text-gray-400 mb-1.5">{cat}</p>
                    <div className="flex flex-wrap gap-1">
                      {emojis.map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => setSelectedEmoji(emoji)}
                          className={`w-9 h-9 text-xl rounded-lg flex items-center justify-center transition-all hover:scale-110 ${
                            selectedEmoji === emoji
                              ? 'bg-indigo-100 ring-2 ring-indigo-400 scale-110'
                              : 'hover:bg-gray-100'
                          }`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {/* Background color for emoji */}
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Warna background</p>
                <div className="flex flex-wrap gap-2">
                  {BG_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => { setBgColor(color); setCustomBg(color); }}
                      className={`w-7 h-7 rounded-full transition-all hover:scale-110 ${
                        bgColor === color ? 'ring-2 ring-offset-2 ring-indigo-400 scale-110' : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <input
                    type="color"
                    value={customBg}
                    onChange={e => { setCustomBg(e.target.value); setBgColor(e.target.value); }}
                    className="w-7 h-7 rounded-full cursor-pointer border-2 border-gray-300 p-0"
                    title="Warna custom"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: ICON ───────────────────────────────────── */}
          {tab === 'icon' && (
            <div className="space-y-3">
              <div className="grid grid-cols-5 gap-2 max-h-52 overflow-y-auto pr-1">
                {ICON_LIBRARY.map(icon => (
                  <button
                    key={icon.name}
                    onClick={() => { setSelectedIcon(icon.svg); setSelectedIconName(icon.name); }}
                    title={icon.name}
                    className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all hover:scale-105 ${
                      selectedIconName === icon.name
                        ? 'ring-2 ring-indigo-400 scale-105'
                        : 'hover:bg-gray-100'
                    }`}
                    style={{
                      backgroundColor: selectedIconName === icon.name ? bgColor : '#f3f4f6',
                      color: selectedIconName === icon.name ? '#ffffff' : '#374151',
                    }}
                    dangerouslySetInnerHTML={{ __html: icon.svg }}
                  />
                ))}
              </div>
              {/* Background color for icon */}
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Warna background</p>
                <div className="flex flex-wrap gap-2">
                  {BG_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => { setBgColor(color); setCustomBg(color); }}
                      className={`w-7 h-7 rounded-full transition-all hover:scale-110 ${
                        bgColor === color ? 'ring-2 ring-offset-2 ring-indigo-400 scale-110' : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <input
                    type="color"
                    value={customBg}
                    onChange={e => { setCustomBg(e.target.value); setBgColor(e.target.value); }}
                    className="w-7 h-7 rounded-full cursor-pointer border-2 border-gray-300 p-0"
                    title="Warna custom"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: IMAGE UPLOAD ───────────────────────────── */}
          {tab === 'image' && (
            <div className="space-y-3">
              {/* Drop zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                }`}
              >
                {imagePreview ? (
                  <div className="flex flex-col items-center gap-2">
                    <img src={imagePreview} alt="Preview" className="w-16 h-16 rounded-full object-cover" />
                    <p className="text-sm text-gray-500">Klik atau drag untuk ganti gambar</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-gray-400">
                    <span className="text-4xl">📁</span>
                    <p className="text-sm font-medium">Drag & drop atau klik untuk upload</p>
                    <p className="text-xs">JPG, PNG, GIF, WebP, SVG · Maks 2MB</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => e.target.files[0] && processImageFile(e.target.files[0])}
              />
              {imageFile && (
                <p className="text-xs text-gray-500 text-center">{imageFile.name} ({(imageFile.size / 1024).toFixed(0)} KB)</p>
              )}
            </div>
          )}
        </div>

        {/* ── FOOTER ───────────────────────────────────────── */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-100 transition-colors"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (tab === 'image' && !imageFile && !imagePreview)}
            className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Menyimpan...' : 'Simpan Avatar'}
          </button>
        </div>
      </div>
    </div>
  );
}
