// client/src/components/EmbedCodeModal.jsx
// Modal shown when admin clicks "Get Embed Code" on a bot card
// ✅ Updated: Added "Widget" tab — floating avatar button embed

import React, { useState } from 'react';
import BotAvatar from './BotAvatar';

const THEMES = [
  { id: 'light', label: '☀️ Light' },
  { id: 'dark',  label: '🌙 Dark'  },
];

const ACCENTS = [
  { hex: '#007857', label: 'GYS Green'  },
  { hex: '#004E36', label: 'Forest'      },
  { hex: '#3B82F6', label: 'Blue'        },
  { hex: '#8B5CF6', label: 'Purple'      },
  { hex: '#EC4899', label: 'Pink'        },
  { hex: '#F97316', label: 'Orange'      },
  { hex: '#EAB308', label: 'Yellow'      },
  { hex: '#14B8A6', label: 'Teal'        },
];

const SIZES = [
  { label: 'Compact',   w: 380,    h: 520    },
  { label: 'Standard',  w: 420,    h: 640    },
  { label: 'Wide',      w: 520,    h: 700    },
  { label: 'Full Page', w: '100%', h: '100%' },
];

const POSITIONS = [
  { id: 'bottom-right', label: '↘ Bottom Right' },
  { id: 'bottom-left',  label: '↙ Bottom Left'  },
];

// ── Tab definitions ───────────────────────────────────────────
const CODE_TABS = [
  { id: 'widget', label: '🪄 Widget',     badge: 'NEW' },
  { id: 'iframe', label: 'HTML/iFrame',   badge: null  },
  { id: 'react',  label: 'React JSX',     badge: null  },
  { id: 'script', label: 'JS Script',     badge: null  },
];

export default function EmbedCodeModal({ bot, onClose }) {
  const [theme,     setTheme]     = useState('light');
  const [accent,    setAccent]    = useState('#007857');
  const [sizeIdx,   setSizeIdx]   = useState(1);
  const [showBrand, setShowBrand] = useState(true);
  const [activeTab, setActiveTab] = useState('widget');
  const [position,  setPosition]  = useState('bottom-right');
  const [copied,    setCopied]    = useState(false);

  const baseUrl = window.location.origin;
  const botId   = bot._id;
  const size    = SIZES[sizeIdx];
  const wStr    = typeof size.w === 'number' ? `${size.w}px` : size.w;
  const hStr    = typeof size.h === 'number' ? `${size.h}px` : size.h;

  const embedUrl   = `${baseUrl}/embed/${botId}?theme=${theme}&accent=${encodeURIComponent(accent)}&brand=${showBrand}`;
  const widgetSrc  = `${baseUrl}/embed/EmbedChatWidget.js`;

  // ── Code generators ───────────────────────────────────────────
  const widgetCode =
`<!-- 💬 GYS Chat Widget — Floating Avatar Button -->
<!-- Paste this ONE line before </body> on any page -->
<script
  src="${widgetSrc}"
  data-bot-id="${botId}"
  data-theme="${theme}"
  data-accent="${accent}"
  data-position="${position}"
  data-brand="${showBrand}"
  defer
></script>`;

  const iframeCode =
`<iframe
  src="${embedUrl}"
  width="${wStr}"
  height="${hStr}"
  frameborder="0"
  allow="clipboard-write"
  style="border-radius:16px; box-shadow:0 4px 24px rgba(0,0,0,0.12);"
  title="${bot.name} AI Chat"
></iframe>`;

  const reactCode =
`import React from 'react';

function ${bot.name.replace(/\s+/g, '')}Widget() {
  return (
    <iframe
      src="${embedUrl}"
      width="${wStr}"
      height="${hStr}"
      frameBorder="0"
      allow="clipboard-write"
      style={{
        borderRadius: '16px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        border: 'none',
      }}
      title="${bot.name} AI Chat"
    />
  );
}

export default ${bot.name.replace(/\s+/g, '')}Widget;`;

  const scriptCode =
`<!-- Add this script to your page -->
<script>
(function() {
  var iframe = document.createElement('iframe');
  iframe.src = '${embedUrl}';
  iframe.width = '${wStr}';
  iframe.height = '${hStr}';
  iframe.frameBorder = '0';
  iframe.allow = 'clipboard-write';
  iframe.style.cssText = 'border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.12);border:none;';
  iframe.title = '${bot.name} AI Chat';
  document.getElementById('gys-ai-chat').appendChild(iframe);
})();
</script>
<div id="gys-ai-chat"></div>`;

  const codeMap = { widget: widgetCode, iframe: iframeCode, react: reactCode, script: scriptCode };
  const code    = codeMap[activeTab];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col border border-gray-200 overflow-hidden">

        {/* ── Header ── */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-green-50 to-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <BotAvatar bot={bot} size="sm" />
            <div>
              <h3 className="font-bold text-gray-900 text-sm">Embed — {bot.name}</h3>
              <p className="text-[10px] text-gray-500">Floating widget or iFrame — choose what suits your needs</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">

            {/* ── Tab selector ── */}
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">
                Embed Type
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {CODE_TABS.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative px-4 py-2 rounded-xl text-xs font-bold transition-all border-2 ${
                      activeTab === tab.id
                        ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {tab.label}
                    {tab.badge && (
                      <span className="absolute -top-2 -right-1 bg-green-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab description */}
              <div className="mt-2.5 text-xs px-3 py-2 rounded-lg border bg-gray-50 text-gray-500">
                {activeTab === 'widget' && (
                  <span>🪄 <strong className="text-gray-700">Floating Widget</strong> — Bot avatar appears as a floating button in the corner of the page. Click to open/close chat. Only <strong>1 line of script</strong>.</span>
                )}
                {activeTab === 'iframe' && (
                  <span>🖼 <strong className="text-gray-700">iFrame</strong> — Embed the chat directly inside your page at a position you choose.</span>
                )}
                {activeTab === 'react' && (
                  <span>⚛️ <strong className="text-gray-700">React Component</strong> — Use as a JSX component inside your React project.</span>
                )}
                {activeTab === 'script' && (
                  <span>📜 <strong className="text-gray-700">JS Script</strong> — Programmatically inject an iframe into a container of your choice.</span>
                )}
              </div>
            </div>

            {/* ── Customization grid ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* Theme */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">Theme</label>
                <div className="flex gap-2">
                  {THEMES.map(t => (
                    <button key={t.id} onClick={() => setTheme(t.id)}
                      className={`flex-1 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                        theme === t.id ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >{t.label}</button>
                  ))}
                </div>
              </div>

              {/* Size (only for iframe/react/script) / Position (widget) */}
              {activeTab === 'widget' ? (
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">Button Position</label>
                  <div className="flex gap-2">
                    {POSITIONS.map(p => (
                      <button key={p.id} onClick={() => setPosition(p.id)}
                        className={`flex-1 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                          position === p.id ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >{p.label}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">Size</label>
                  <select value={sizeIdx} onChange={e => setSizeIdx(Number(e.target.value))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-green-600">
                    {SIZES.map((s, i) => (
                      <option key={i} value={i}>{s.label} {typeof s.w === 'number' ? `(${s.w}×${s.h}px)` : '(100%)'}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Accent */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">Accent Color</label>
                <div className="flex flex-wrap gap-1.5">
                  {ACCENTS.map(a => (
                    <button key={a.hex} title={a.label} onClick={() => setAccent(a.hex)}
                      className={`w-7 h-7 rounded-full transition-all hover:scale-110 ${accent === a.hex ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : ''}`}
                      style={{ backgroundColor: a.hex }}
                    />
                  ))}
                  <input type="color" value={accent} onChange={e => setAccent(e.target.value)}
                    className="w-7 h-7 rounded-full cursor-pointer border border-gray-300 p-0" title="Custom color" />
                </div>
              </div>

              {/* Options */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">Options</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <button type="button" onClick={() => setShowBrand(!showBrand)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showBrand ? 'bg-green-600' : 'bg-gray-200'}`}>
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${showBrand ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                  </button>
                  <span className="text-xs text-gray-600">Show "Powered by GYS" branding</span>
                </label>
              </div>
            </div>

            {/* ── Widget preview (visual illustration) ── */}
            {activeTab === 'widget' && (
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">Widget Button Preview</label>
                <div className="bg-gray-100 rounded-xl p-6 relative overflow-hidden" style={{ minHeight: '120px' }}>
                  {/* Fake page content */}
                  <div className="space-y-2 opacity-30">
                    <div className="h-3 bg-gray-400 rounded w-3/4" />
                    <div className="h-3 bg-gray-400 rounded w-1/2" />
                    <div className="h-3 bg-gray-400 rounded w-5/6" />
                    <div className="h-3 bg-gray-400 rounded w-2/3" />
                  </div>
                  {/* Simulated widget button */}
                  <div
                    className={`absolute bottom-4 ${position === 'bottom-left' ? 'left-4' : 'right-4'}`}
                  >
                    <div className="relative">
                      {/* Pulse ring */}
                      <div
                        className="absolute inset-0 rounded-full animate-ping opacity-30"
                        style={{ backgroundColor: accent, transform: 'scale(1.3)' }}
                      />
                      {/* Avatar button */}
                      <div
                        className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg relative"
                        style={{ backgroundColor: accent }}
                      >
                        <BotAvatar bot={bot} size="md" />
                      </div>
                    </div>
                    {/* Tooltip */}
                    <div
                      className={`absolute bottom-full mb-2 ${position === 'bottom-left' ? 'left-0' : 'right-0'} whitespace-nowrap bg-gray-900 text-white text-[10px] font-medium px-2.5 py-1.5 rounded-lg`}
                    >
                      Chat with {bot.name}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  The avatar button will appear in the {position === 'bottom-right' ? 'bottom-right' : 'bottom-left'} corner of your website.
                </p>
              </div>
            )}

            {/* ── iFrame live preview ── */}
            {activeTab !== 'widget' && (
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">Live Preview</label>
                <div className="bg-gray-100 rounded-xl p-4 flex items-center justify-center overflow-hidden">
                  <iframe
                    key={`${theme}-${accent}-${showBrand}`}
                    src={embedUrl}
                    width={Math.min(typeof size.w === 'number' ? size.w : 400, 400)}
                    height={Math.min(typeof size.h === 'number' ? size.h : 480, 480)}
                    frameBorder="0"
                    allow="clipboard-write"
                    style={{ borderRadius: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.12)', border: 'none', maxWidth: '100%' }}
                    title="Preview"
                  />
                </div>
              </div>
            )}

            {/* ── Code output ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                  {activeTab === 'widget' ? 'Widget Code (1 line)' : 'Embed Code'}
                </label>
              </div>
              <div className="relative">
                <pre className="bg-gray-900 text-gray-100 rounded-xl p-4 text-xs overflow-x-auto whitespace-pre leading-relaxed font-mono"
                  style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {code}
                </pre>
                <button onClick={handleCopy}
                  className={`absolute top-3 right-3 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    copied ? 'bg-green-500 text-white' : 'bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white'
                  }`}
                >
                  {copied ? '✓ Copied!' : '⎘ Copy'}
                </button>
              </div>
            </div>

            {/* ── Widget: step-by-step instructions ── */}
            {activeTab === 'widget' && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-xs text-indigo-800 space-y-2">
                <p className="font-bold text-indigo-900">📋 How to Install (3 steps)</p>
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center font-black text-[9px]">1</span>
                    <span>Copy the code above</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center font-black text-[9px]">2</span>
                    <span>Paste it before the <code className="bg-indigo-100 px-1 rounded font-mono">&lt;/body&gt;</code> tag on your website</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center font-black text-[9px]">3</span>
                    <span>The bot avatar will automatically appear as a floating button</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Direct URL ── */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-xs font-bold text-blue-700 mb-1">📎 Direct Embed URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] text-blue-600 bg-blue-100 rounded-lg px-2 py-1.5 font-mono break-all">
                  {embedUrl}
                </code>
                <button
                  onClick={async () => { await navigator.clipboard.writeText(embedUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="flex-shrink-0 px-2 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 font-bold transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>

            {/* ── Notes ── */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700 space-y-1">
              <p className="font-bold">⚠️ Notes</p>
              <p>• Users accessing the embed must be <strong>logged in</strong> to GYS Portal first. If not, a login form will appear directly inside the widget.</p>
              <p>• The widget & iFrame share the same session cookie as the main portal.</p>
              {activeTab === 'widget' && (
                <p>• File <code className="bg-amber-100 px-1 rounded font-mono">EmbedChatWidget.js</code> must be available on your server at path <code className="bg-amber-100 px-1 rounded font-mono">/embed/EmbedChatWidget.js</code>.</p>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end bg-gray-50 flex-shrink-0">
          <button onClick={onClose}
            className="px-5 py-2 bg-gray-800 text-white rounded-xl text-sm font-bold hover:bg-gray-900 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
