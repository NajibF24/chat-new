import React, { useState, useRef, useEffect, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────
// Utility: detect artifact type from code block
// ─────────────────────────────────────────────────────────────
export function detectArtifactType(lang = '', code = '') {
  const l = lang.toLowerCase();
  if (['html', 'htm'].includes(l)) return 'html';
  if (['react', 'jsx', 'tsx'].includes(l)) return 'react';
  if (['svg'].includes(l)) return 'svg';
  if (['python', 'py'].includes(l)) return 'python';
  if (['js', 'javascript', 'ts', 'typescript'].includes(l)) return 'javascript';
  if (['sql'].includes(l)) return 'sql';
  if (['css'].includes(l)) return 'css';
  if (l === '' || l === 'text') {
    // Heuristic: detect HTML by content
    if (code.trim().startsWith('<!DOCTYPE') || code.includes('<html') || (code.includes('<div') && code.includes('</div>'))) return 'html';
    if (code.includes('import React') || code.includes('export default') || (code.includes('useState') && code.includes('return ('))) return 'react';
  }
  return 'code';
}

// ─────────────────────────────────────────────────────────────
// Build runnable HTML for iframe preview
// ─────────────────────────────────────────────────────────────
function buildPreviewHTML(type, code) {
  if (type === 'html') {
    // If already full HTML, return as-is
    if (code.trim().startsWith('<!DOCTYPE') || code.trim().startsWith('<html')) return code;
    // Wrap snippet
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; padding: 16px; }
</style>
</head>
<body>
${code}
</body>
</html>`;
  }

  if (type === 'react') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2/dist/tailwind.min.css" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; }
</style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
 // CommonJS/UMD guards so "exports" references don't throw
 window.exports = window.exports || {};
 window.module = window.module || { exports: window.exports };

 // User code
 ${code}

 // Mount the component
 const rootEl = document.getElementById('root');
 const root = ReactDOM.createRoot(rootEl);

 // Resolve exported component
 const exported = (() => {
   try {
     if (typeof exports !== 'undefined' && exports?.default) return exports.default;
     if (typeof module !== 'undefined' && module?.exports?.default) return module.exports.default;
     if (typeof module !== 'undefined' && module?.exports && module.exports !== window.exports) return module.exports;
     if (typeof App !== 'undefined') return App;
     if (typeof default_1 !== 'undefined') return default_1;
     return null;
   } catch (err) {
     console.error('Failed to resolve export:', err);
     return null;
   }
 })();

 if (exported) {
   if (React.isValidElement(exported)) root.render(exported);
   else root.render(React.createElement(exported));
 } else {
   rootEl.innerHTML = '<p style="color:red;padding:16px">No default export found. Name your component "App" or add export default.</p>';
 }
</script>
</body>
</html>`;
  }

  if (type === 'svg') {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8f8f8;}svg{max-width:100%;max-height:90vh;}</style>
</head><body>${code}</body></html>`;
  }

  if (type === 'css') {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>${code}</style>
</head><body><div class="preview-wrapper"><h1>CSS Preview</h1><p>Apply your classes here.</p><button class="btn">Button</button></div></body></html>`;
  }

  return null; // non-previewable types
}

// ─────────────────────────────────────────────────────────────
// Syntax highlighting (simple tokenizer, no deps)
// ─────────────────────────────────────────────────────────────
function SyntaxHighlight({ code, lang }) {
  const highlight = (text, language) => {
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Strings
    escaped = escaped.replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g,
      '<span style="color:#a8ff78">$1$2$1</span>');
    // Comments
    escaped = escaped.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/g,
      '<span style="color:#6a9955">$1</span>');
    // Numbers
    escaped = escaped.replace(/\b(\d+\.?\d*)\b/g,
      '<span style="color:#b5cea8">$1</span>');
    // Keywords
    const kw = ['const','let','var','function','return','if','else','for','while','class','import','export','default','from','async','await','try','catch','new','this','typeof','null','undefined','true','false','def','print','for','in','range','pass','self','import','from'];
    kw.forEach(k => {
      escaped = escaped.replace(new RegExp(`\\b(${k})\\b`, 'g'),
        '<span style="color:#569cd6">$1</span>');
    });

    return escaped;
  };

  return (
    <pre
      className="text-sm leading-relaxed overflow-auto h-full"
      style={{ fontFamily: '"Fira Code", "Cascadia Code", monospace', color: '#d4d4d4' }}
      dangerouslySetInnerHTML={{ __html: highlight(code, lang) }}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// ARTIFACT PANEL COMPONENT
// ─────────────────────────────────────────────────────────────
export default function ArtifactPanel({ artifact, onClose }) {
  const [activeTab, setActiveTab] = useState('preview');
  const [copied, setCopied]       = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewKey, setPreviewKey]     = useState(0); // force iframe reload
  const [consoleOutput, setConsoleOutput] = useState([]);
  const iframeRef = useRef(null);
  const panelRef  = useRef(null);

  const { code = '', lang = '', title = 'Artifact' } = artifact || {};
  const type = detectArtifactType(lang, code);
  const previewHTML = buildPreviewHTML(type, code);
  const canPreview = !!previewHTML;

  // Default to code tab if not previewable
  useEffect(() => {
    if (!canPreview) setActiveTab('code');
    else setActiveTab('preview');
  }, [artifact?.code]);

  // Intercept console from iframe
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'artifact-console') {
        setConsoleOutput(prev => [...prev.slice(-49), e.data.entry]);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const ext = {
      html: 'html', react: 'jsx', svg: 'svg', python: 'py',
      javascript: 'js', sql: 'sql', css: 'css', code: 'txt'
    }[type] || 'txt';
    const blob = new Blob([code], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `artifact.${ext}`;
    a.click();
  };

  const handleRefresh = () => {
    setPreviewKey(k => k + 1);
    setConsoleOutput([]);
  };

  const typeLabel = {
    html: '🌐 HTML',
    react: '⚛️ React',
    svg: '🎨 SVG',
    python: '🐍 Python',
    javascript: '📜 JS',
    sql: '🗄️ SQL',
    css: '💅 CSS',
    code: '📄 Code',
  }[type] || '📄 Code';

  const typeColor = {
    html: 'bg-orange-500',
    react: 'bg-blue-500',
    svg: 'bg-pink-500',
    python: 'bg-yellow-500',
    javascript: 'bg-yellow-400',
    sql: 'bg-sky-500',
    css: 'bg-purple-500',
    code: 'bg-gray-500',
  }[type] || 'bg-gray-500';

  // Build preview HTML with console capture
  const previewHTMLWithConsole = previewHTML ? previewHTML.replace(
    '</head>',
    `<script>
(function() {
  const _log = console.log.bind(console);
  const _err = console.error.bind(console);
  const _warn = console.warn.bind(console);
  const send = (level, args) => window.parent.postMessage({ type: 'artifact-console', entry: { level, text: args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '), time: new Date().toLocaleTimeString() } }, '*');
  console.log   = (...a) => { send('log',   a); _log(...a);  };
  console.error = (...a) => { send('error', a); _err(...a);  };
  console.warn  = (...a) => { send('warn',  a); _warn(...a); };
  window.onerror = (msg, src, line) => send('error', [msg + ' (line ' + line + ')']);
})();
</script>
</head>`
  ) : null;

  if (!artifact) return null;

  return (
    <div
      ref={panelRef}
      className={`flex flex-col bg-[#1e1e2e] border-l border-gray-700/50 transition-all duration-200 ${
        isFullscreen
          ? 'fixed inset-0 z-50'
          : 'h-full'
      }`}
      style={{ minWidth: 0 }}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#16161f] border-b border-gray-700/50 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`${typeColor} text-white text-xs font-bold px-2.5 py-1 rounded-lg flex-shrink-0`}>
            {typeLabel}
          </span>
          <span className="text-gray-300 text-sm font-semibold truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleRefresh}
            title="Refresh preview"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors text-sm"
          >⟳</button>
          <button
            onClick={handleCopy}
            title="Copy code"
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-sm ${copied ? 'bg-green-600/30 text-green-400' : 'hover:bg-gray-700 text-gray-400 hover:text-white'}`}
          >{copied ? '✓' : '⎘'}</button>
          <button
            onClick={handleDownload}
            title="Download"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors text-sm"
          >⬇</button>
          <button
            onClick={() => setIsFullscreen(f => !f)}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors text-sm"
          >{isFullscreen ? '⊡' : '⊞'}</button>
          <button
            onClick={onClose}
            title="Close panel"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-700/40 text-gray-400 hover:text-red-300 transition-colors text-base ml-1"
          >✕</button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex border-b border-gray-700/50 bg-[#16161f] flex-shrink-0">
        {[
          ...(canPreview ? [{ id: 'preview', label: 'Preview', icon: '👁' }] : []),
          { id: 'code', label: 'Code', icon: '{ }' },
          { id: 'console', label: `Console${consoleOutput.length > 0 ? ` (${consoleOutput.length})` : ''}`, icon: '>' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-semibold transition-all flex items-center gap-2 border-b-2 ${
              activeTab === tab.id
                ? 'text-white border-blue-500 bg-blue-500/10'
                : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-700/30'
            }`}
          >
            <span className="text-xs">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden">

        {/* Preview */}
        {activeTab === 'preview' && canPreview && (
          <div className="h-full bg-white relative">
            <iframe
              key={previewKey}
              ref={iframeRef}
              srcDoc={previewHTMLWithConsole}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
              className="w-full h-full border-0"
              title="Artifact Preview"
            />
          </div>
        )}

        {/* Code */}
        {activeTab === 'code' && (
          <div className="h-full overflow-auto p-5 bg-[#1e1e2e]">
            <SyntaxHighlight code={code} lang={lang} />
          </div>
        )}

        {/* Console */}
        {activeTab === 'console' && (
          <div className="h-full flex flex-col bg-[#0d0d14]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700/40">
              <span className="text-xs text-gray-500 font-mono">Console Output</span>
              <button
                onClick={() => setConsoleOutput([])}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >Clear</button>
            </div>
            <div className="flex-1 overflow-auto p-4 font-mono text-xs space-y-1">
              {consoleOutput.length === 0 ? (
                <p className="text-gray-600 italic">No console output yet. Run the preview to see logs.</p>
              ) : (
                consoleOutput.map((entry, i) => (
                  <div key={i} className={`flex gap-3 ${
                    entry.level === 'error' ? 'text-red-400' :
                    entry.level === 'warn'  ? 'text-yellow-400' :
                    'text-gray-300'
                  }`}>
                    <span className="text-gray-600 flex-shrink-0">{entry.time}</span>
                    <span className={`flex-shrink-0 ${
                      entry.level === 'error' ? 'text-red-500' :
                      entry.level === 'warn'  ? 'text-yellow-500' :
                      'text-gray-500'
                    }`}>
                      {entry.level === 'error' ? '✕' : entry.level === 'warn' ? '⚠' : '›'}
                    </span>
                    <span className="break-all whitespace-pre-wrap">{entry.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer info bar ── */}
      <div className="px-4 py-2 bg-[#16161f] border-t border-gray-700/30 flex items-center gap-4 flex-shrink-0">
        <span className="text-xs text-gray-600">{code.split('\n').length} lines</span>
        <span className="text-xs text-gray-600">{(code.length / 1024).toFixed(1)} KB</span>
        {canPreview && activeTab === 'preview' && (
          <span className="text-xs text-green-600 ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block"></span>
            Live Preview
          </span>
        )}
      </div>
    </div>
  );
}
