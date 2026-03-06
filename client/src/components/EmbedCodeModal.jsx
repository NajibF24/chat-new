// client/src/components/EmbedCodeModal.jsx
// Modal shown when admin clicks "Get Embed Code" on a bot card

import React, { useState, useRef } from 'react';
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
  { label: 'Compact',   w: 380,  h: 520  },
  { label: 'Standard',  w: 420,  h: 640  },
  { label: 'Wide',      w: 520,  h: 700  },
  { label: 'Full Page', w: '100%', h: '100%' },
];

export default function EmbedCodeModal({ bot, onClose }) {
  const [theme,     setTheme]     = useState('light');
  const [accent,    setAccent]    = useState('#007857');
  const [sizeIdx,   setSizeIdx]   = useState(1);
  const [showBrand, setShowBrand] = useState(true);
  const [copied,    setCopied]    = useState(false);
  const [activeTab, setActiveTab] = useState('iframe');
  const textareaRef = useRef(null);

  const baseUrl = window.location.origin;
  const botId   = bot._id;

  const size = SIZES[sizeIdx];
  const wStr = typeof size.w === 'number' ? `${size.w}px` : size.w;
  const hStr = typeof size.h === 'number' ? `${size.h}px` : size.h;

  const embedUrl = `${baseUrl}/embed/${botId}?theme=${theme}&accent=${encodeURIComponent(accent)}&brand=${showBrand}`;

  const iframeCode = `<iframe
  src="${embedUrl}"
  width="${wStr}"
  height="${hStr}"
  frameborder="0"
  allow="clipboard-write"
  style="border-radius:16px; box-shadow:0 4px 24px rgba(0,0,0,0.12);"
  title="${bot.name} AI Chat"
></iframe>`;

  const reactCode = `import React from 'react';

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

  const scriptCode = `<!-- Add this script to your page -->
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

  // Replace this with your target container selector
  document.getElementById('gys-ai-chat').appendChild(iframe);
})();
</script>
<div id="gys-ai-chat"></div>`;

  const codeMap = { iframe: iframeCode, react: reactCode, script: scriptCode };
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
              <p className="text-[10px] text-gray-500">Get iframe code to embed this bot anywhere</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">

            {/* ── Customization ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* Theme */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">
                  Theme
                </label>
                <div className="flex gap-2">
                  {THEMES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      className={`flex-1 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                        theme === t.id
                          ? 'border-green-600 bg-green-50 text-green-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">
                  Size
                </label>
                <select
                  value={sizeIdx}
                  onChange={e => setSizeIdx(Number(e.target.value))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-green-600"
                >
                  {SIZES.map((s, i) => (
                    <option key={i} value={i}>
                      {s.label} {typeof s.w === 'number' ? `(${s.w}×${s.h}px)` : '(100%)'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Accent */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">
                  Accent Color
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ACCENTS.map(a => (
                    <button
                      key={a.hex}
                      title={a.label}
                      onClick={() => setAccent(a.hex)}
                      className={`w-7 h-7 rounded-full transition-all hover:scale-110 ${
                        accent === a.hex ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : ''
                      }`}
                      style={{ backgroundColor: a.hex }}
                    />
                  ))}
                  <input
                    type="color"
                    value={accent}
                    onChange={e => setAccent(e.target.value)}
                    className="w-7 h-7 rounded-full cursor-pointer border border-gray-300 p-0"
                    title="Custom color"
                  />
                </div>
              </div>

              {/* Branding */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">
                  Options
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <button
                    type="button"
                    onClick={() => setShowBrand(!showBrand)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      showBrand ? 'bg-green-600' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                        showBrand ? 'translate-x-4.5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  <span className="text-xs text-gray-600">Show "Powered by GYS" branding</span>
                </label>
              </div>
            </div>

            {/* ── Preview ── */}
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">
                Live Preview
              </label>
              <div className="bg-gray-100 rounded-xl p-4 flex items-center justify-center overflow-hidden">
                <iframe
                  key={`${theme}-${accent}-${showBrand}`}
                  src={embedUrl}
                  width={Math.min(typeof size.w === 'number' ? size.w : 400, 400)}
                  height={Math.min(typeof size.h === 'number' ? size.h : 480, 480)}
                  frameBorder="0"
                  allow="clipboard-write"
                  style={{
                    borderRadius: '12px',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
                    border: 'none',
                    maxWidth: '100%',
                  }}
                  title="Preview"
                />
              </div>
            </div>

            {/* ── Code output ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                  Embed Code
                </label>
                <div className="flex gap-1">
                  {['iframe', 'react', 'script'].map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                        activeTab === tab
                          ? 'bg-gray-800 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {tab === 'iframe' ? 'HTML/iFrame' : tab === 'react' ? 'React JSX' : 'JS Script'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative">
                <pre
                  ref={textareaRef}
                  className="bg-gray-900 text-gray-100 rounded-xl p-4 text-xs overflow-x-auto whitespace-pre leading-relaxed font-mono"
                  style={{ maxHeight: '200px', overflowY: 'auto' }}
                >
                  {code}
                </pre>
                <button
                  onClick={handleCopy}
                  className={`absolute top-3 right-3 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    copied
                      ? 'bg-green-500 text-white'
                      : 'bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white'
                  }`}
                >
                  {copied ? '✓ Copied!' : '⎘ Copy'}
                </button>
              </div>
            </div>

            {/* ── Direct URL ── */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-xs font-bold text-blue-700 mb-1">📎 Direct Embed URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] text-blue-600 bg-blue-100 rounded-lg px-2 py-1.5 font-mono break-all">
                  {embedUrl}
                </code>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(embedUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="flex-shrink-0 px-2 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 font-bold transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>

            {/* ── Notes ── */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700 space-y-1">
              <p className="font-bold">⚠️ Notes</p>
              <p>• Users accessing the embed must be <strong>logged in</strong> to the GYS Portal. If not, they'll see a sign-in prompt.</p>
              <p>• For public access, contact the admin to set up public bot authentication.</p>
              <p>• This embed uses the same session cookie as the main portal.</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end bg-gray-50 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-gray-800 text-white rounded-xl text-sm font-bold hover:bg-gray-900 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
