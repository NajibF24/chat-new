import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, ArcElement, Filler
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import BotAvatar from './BotAvatar';
import AvatarPicker from './AvatarPicker';
import EmbedCodeModal from './EmbedCodeModal';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement, Filler);

// ── AI Provider catalog ───────────────────────────────────────
const AI_PROVIDERS = {
  openai: {
    label: 'OpenAI', icon: '🟢',
    models: [
      { id: 'gpt-5.2',               label: 'GPT-5.2',               tier: 'flagship'  },
      { id: 'gpt-5.1',               label: 'GPT-5.1',               tier: 'flagship'  },
      { id: 'gpt-5',                 label: 'GPT-5',                 tier: 'flagship'  },
      { id: 'gpt-5-mini',            label: 'GPT-5 Mini',            tier: 'efficient' },
      { id: 'gpt-5-nano',            label: 'GPT-5 Nano',            tier: 'efficient' },
      { id: 'gpt-4o',                label: 'GPT-4o',                tier: 'stable'    },
      { id: 'gpt-4o-mini',           label: 'GPT-4o Mini',           tier: 'efficient' },
      { id: 'gpt-4.1',               label: 'GPT-4.1',               tier: 'stable'    },
      { id: 'gpt-4.1-mini',          label: 'GPT-4.1 Mini',          tier: 'efficient' },
      { id: 'gpt-4.1-nano',          label: 'GPT-4.1 Nano',          tier: 'efficient' },
      { id: 'o3',                    label: 'o3 (Reasoning)',         tier: 'reasoning' },
      { id: 'o4-mini',               label: 'o4-mini (Reasoning)',    tier: 'reasoning' },
      { id: 'o3-mini',               label: 'o3-mini (Reasoning)',    tier: 'reasoning' },
      { id: 'gpt-4-turbo',           label: 'GPT-4 Turbo',           tier: 'legacy'    },
      { id: 'gpt-4',                 label: 'GPT-4',                 tier: 'legacy'    },
      { id: 'gpt-3.5-turbo',         label: 'GPT-3.5 Turbo',         tier: 'legacy'    },
      { id: 'gpt-3.5-turbo-16k',     label: 'GPT-3.5 Turbo 16K',     tier: 'legacy'    },
    ],
    capabilities: ['webSearch', 'codeInterpreter', 'imageGeneration', 'canvas', 'fileSearch'],
  },
  anthropic: {
    label: 'Anthropic (Claude)', icon: '🟠',
    models: [
      { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6',  tier: 'flagship'  },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',tier: 'flagship'  },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', tier: 'efficient' },
    ],
    capabilities: ['fileSearch'],
  },
  google: {
    label: 'Google Gemini', icon: '🔵',
    models: [
      { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   tier: 'flagship'  },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'efficient' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tier: 'stable'    },
      { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro',   tier: 'stable'    },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', tier: 'stable'    },
    ],
    capabilities: [],
  },
  custom: { label: 'Custom / OpenAI-Compatible', icon: '⚙️', models: [], capabilities: [] },
};

const TIER_STYLE = {
  flagship:  'bg-amber-50 text-amber-700 border border-amber-200',
  efficient: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  reasoning: 'bg-violet-50 text-violet-700 border border-violet-200',
  stable:    'bg-blue-50 text-blue-700 border border-blue-200',
  legacy:    'bg-gray-100 text-gray-500 border border-gray-200',
};

const TIER_GROUP_LABEL = {
  flagship:  '⭐ Flagship',
  efficient: '⚡ Efficient',
  reasoning: '🧠 Reasoning',
  stable:    '✅ Stable',
  legacy:    '🕰 Legacy',
};

const ALL_CAPABILITIES = [
  { id: 'webSearch',       icon: '🌐', label: 'Web Search',        desc: 'Bot can browse the internet for up-to-date information', providers: ['openai'] },
  { id: 'codeInterpreter', icon: '💻', label: 'Code Interpreter',  desc: 'Bot can write and execute Python code', providers: ['openai'] },
  { id: 'imageGeneration', icon: '🎨', label: 'Image Generation',  desc: 'Bot can create images using DALL-E', providers: ['openai'] },
  { id: 'canvas',          icon: '📝', label: 'Canvas Mode',       desc: 'Interactive document editing and canvas mode', providers: ['openai'] },
  { id: 'fileSearch',      icon: '📂', label: 'File Search (RAG)', desc: 'Semantic search across the entire knowledge base', providers: ['openai', 'anthropic'] },
];

const KNOWLEDGE_MODES = [
  { id: 'relevant', label: '🎯 Relevant Only', desc: 'Inject knowledge only when relevant' },
  { id: 'always',   label: '📚 Always',        desc: 'Always inject all knowledge' },
  { id: 'disabled', label: '🚫 Disabled',       desc: 'Do not use knowledge base' },
];

const TONE_OPTIONS = [
  { id: 'professional', label: '👔 Professional' },
  { id: 'friendly',     label: '😊 Friendly' },
  { id: 'formal',       label: '🎩 Formal' },
  { id: 'concise',      label: '⚡ Concise' },
  { id: 'detailed',     label: '📖 Detailed' },
  { id: 'custom',       label: '✏️ Custom' },
];

const SUPPORTED_FILE_TYPES = '.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.csv,.md';
const FILE_TYPE_ICON = { pdf: '📕', docx: '📘', doc: '📘', xlsx: '📗', xls: '📗', pptx: '📙', ppt: '📙', txt: '📄', csv: '📊', md: '📝' };
const getFileIcon = (name = '') => FILE_TYPE_ICON[name.split('.').pop()?.toLowerCase()] || '📄';
const fmtSize = (b) => !b ? '0 B' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;

const initialBotState = {
  name: '', description: '', persona: '', tone: 'professional',
  systemPrompt: 'You are a professional AI assistant.',
  prompt: '',
  starterQuestions: [],
  knowledgeMode: 'relevant',
  pptTemplateFileId: null, // ✅ NEW: reference to template pptx in knowledge files
  aiProvider: { provider: 'openai', model: 'gpt-4o', apiKey: '', endpoint: '', temperature: 0.1, maxTokens: 8000 }, // ✅ 8000
  capabilities: { webSearch: false, codeInterpreter: false, imageGeneration: false, canvas: false, fileSearch: false },
  smartsheetConfig:  { enabled: false, apiKey: '', sheetId: '' },
  kouventaConfig:    { enabled: false, apiKey: '', endpoint: '' },
  azureSearchConfig: { enabled: false, apiKey: '', endpoint: '' },
  // ✅ UPDATED wahaConfig with new schema
  wahaConfig: {
    enabled: false,
    endpoint: '',
    session: 'default',
    apiKey: '',
    webhookEnabled: false,
    webhookSecret: '',
    botPhoneNumber: '',
    targets: [],    // [{ _id, chatId, label, type, tagOnly, active }]
    schedules: [],  // [{ _id, label, prompt, active, scheduleType, time, times, intervalMinutes, intervalStart, intervalEnd, targetIds }]
    // legacy
    chatId: '',
    dailySchedule: { enabled: false, time: '08:00', prompt: '' },
  },
  onedriveConfig: { enabled: false, folderUrl: '', tenantId: '', clientId: '', clientSecret: '' },
  avatar: { type: 'emoji', emoji: '🤖', bgColor: '#6366f1', textColor: '#ffffff' },
};

function groupModelsByTier(models) {
  const order = ['flagship', 'efficient', 'reasoning', 'stable', 'legacy'];
  const groups = {};
  models.forEach(m => { const t = m.tier || 'stable'; if (!groups[t]) groups[t] = []; groups[t].push(m); });
  return order.filter(t => groups[t]).map(t => ({ tier: t, models: groups[t] }));
}

// ─────────────────────────────────────────────────────────────
// API KEY WIDGET
// ─────────────────────────────────────────────────────────────
function ApiKeyWidget({ botId, hasKey }) {
  const [state,    setState]    = useState('hidden');
  const [keyValue, setKeyValue] = useState('');
  const [copied,   setCopied]   = useState(false);
  const [serverHasKey, setServerHasKey] = useState(hasKey);

  const hideTimer = useRef(null);
  useEffect(() => {
    if (state === 'visible') {
      hideTimer.current = setTimeout(() => { setState('hidden'); setKeyValue(''); }, 60000);
    }
    return () => clearTimeout(hideTimer.current);
  }, [state]);

  const handleReveal = async () => {
    setState('loading');
    try {
      const res = await axios.get(`/api/admin/bots/${botId}/api-key`);
      if (res.data.botApiKey) { setKeyValue(res.data.botApiKey); setState('visible'); }
      else { setState('hidden'); setServerHasKey(false); }
    } catch (err) {
      setState('hidden');
      alert('Failed to retrieve API Key: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleGenerate = async () => {
    if (serverHasKey) {
      if (!window.confirm('Are you sure you want to regenerate the API Key?\n\nThe old key will no longer work and all external systems using it will be disconnected.')) return;
    }
    setState('generating');
    try {
      const res = await axios.post(`/api/admin/bots/${botId}/regenerate-key`);
      setKeyValue(res.data.botApiKey); setServerHasKey(true); setState('visible');
    } catch (err) {
      setState('hidden');
      alert('Failed to generate API Key: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleCopy = () => {
    if (!keyValue) return;
    navigator.clipboard.writeText(keyValue).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const handleHide = () => { setState('hidden'); setKeyValue(''); clearTimeout(hideTimer.current); };
  const isLoading = state === 'loading' || state === 'generating';
  const isVisible = state === 'visible';

  return (
    <div className="border border-gray-200 bg-gray-50 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🔑</span>
          <span className="font-semibold text-sm text-gray-800">Bot API Key (External Access)</span>
        </div>
        {serverHasKey
          ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">✅ Key available</span>
          : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">⚠️ Not generated</span>
        }
      </div>

      <div className="flex gap-2">
        <div className={`flex-1 relative bg-white border rounded-lg px-3 py-2 font-mono text-xs overflow-hidden transition-all ${isVisible ? 'border-emerald-300 bg-emerald-50/20' : 'border-gray-200'}`}>
          {isLoading ? (
            <div className="flex items-center gap-2 text-gray-500">
              <div className="w-3 h-3 border-2 border-gray-200 border-t-primary rounded-full animate-spin flex-shrink-0" />
              <span>{state === 'generating' ? 'Generating new key...' : 'Retrieving API Key...'}</span>
            </div>
          ) : isVisible ? (
            <span className="text-emerald-700 break-all select-all">{keyValue}</span>
          ) : (
            <span className="text-gray-400 tracking-widest select-none">
              {serverHasKey ? '••••••••••••••••••••••••••••••••••••••••••••••••' : 'No API Key — click Generate'}
            </span>
          )}
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          {serverHasKey && !isLoading && (
            isVisible ? (
              <button type="button" onClick={handleHide} title="Hide key"
                className="px-2.5 py-2 bg-gray-100 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-200 text-xs transition-colors">🙈</button>
            ) : (
              <button type="button" onClick={handleReveal} title="Reveal API Key"
                className="px-2.5 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 font-semibold text-xs transition-colors">👁 View</button>
            )
          )}
          {isVisible && (
            <button type="button" onClick={handleCopy}
              className={`px-2.5 py-2 rounded-lg font-semibold text-xs transition-colors border ${copied ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {copied ? '✅ Copied' : '📋 Copy'}
            </button>
          )}
          <button type="button" onClick={handleGenerate} disabled={isLoading}
            title={serverHasKey ? 'Regenerate API Key (old key will be invalidated)' : 'Generate API Key'}
            className={`px-2.5 py-2 rounded-lg font-semibold text-xs transition-colors border disabled:opacity-50 disabled:cursor-not-allowed ${serverHasKey ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'bg-primary-dark text-white border-primary-dark hover:bg-primary'}`}>
            {state === 'generating' ? '⏳' : serverHasKey ? '🔄 Regenerate' : '✨ Generate'}
          </button>
        </div>
      </div>

      {isVisible && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[10px] text-amber-700 flex items-start gap-1.5">
          <span className="flex-shrink-0">⏱</span>
          <span>Key will be hidden automatically in 60 seconds. Store this key in a safe place now.</span>
        </div>
      )}
      <p className="text-[10px] text-gray-500">
        Use this API Key in the <code className="bg-white px-1 py-0.5 rounded border border-gray-200">x-api-key</code> header when calling the chat API endpoint externally.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AUDIT TRAIL helpers
// ─────────────────────────────────────────────────────────────
const AUDIT_CATEGORY_META = {
  auth:      { icon: '🔐', label: 'Auth',      color: 'bg-blue-50   text-blue-700   border-blue-200'    },
  bot:       { icon: '🤖', label: 'Bot',       color: 'bg-violet-50 text-violet-700 border-violet-200'  },
  user:      { icon: '👤', label: 'User',      color: 'bg-amber-50  text-amber-700  border-amber-200'   },
  knowledge: { icon: '📚', label: 'Knowledge', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  export:    { icon: '⬇️', label: 'Export',    color: 'bg-sky-50    text-sky-700    border-sky-200'      },
  chat:      { icon: '💬', label: 'AI Chat',   color: 'bg-rose-50   text-rose-700   border-rose-200'    },
  system:    { icon: '⚙️', label: 'System',    color: 'bg-gray-100  text-gray-600   border-gray-200'    },
};

const ACTION_LABEL = {
  LOGIN_SUCCESS:     { label: 'Login',               color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  LOGIN_FAILED:      { label: 'Login Failed',         color: 'text-red-600     bg-red-50     border-red-200'      },
  LOGOUT:            { label: 'Logout',               color: 'text-slate-600   bg-slate-100  border-slate-200'   },
  BOT_CREATE:        { label: 'Create Bot',           color: 'text-violet-600  bg-violet-50  border-violet-200'  },
  BOT_UPDATE:        { label: 'Update Bot',           color: 'text-blue-600    bg-blue-50    border-blue-200'    },
  BOT_DELETE:        { label: 'Delete Bot',           color: 'text-red-600     bg-red-50     border-red-200'      },
  BOT_APIKEY_VIEWED: { label: 'API Key Viewed',       color: 'text-amber-600   bg-amber-50   border-amber-200'   },
  USER_CREATE:       { label: 'Create User',          color: 'text-violet-600  bg-violet-50  border-violet-200'  },
  USER_UPDATE:       { label: 'Update User',          color: 'text-blue-600    bg-blue-50    border-blue-200'    },
  USER_DELETE:       { label: 'Delete User',          color: 'text-red-600     bg-red-50     border-red-200'      },
  KNOWLEDGE_UPLOAD:  { label: 'Upload File',          color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  KNOWLEDGE_DELETE:  { label: 'Delete File',          color: 'text-red-600     bg-red-50     border-red-200'      },
  EXPORT_CHATS:      { label: 'Export CSV',           color: 'text-sky-600     bg-sky-50     border-sky-200'      },
  AI_RESPONSE:       { label: 'AI Response',          color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  AI_RESPONSE_EMPTY: { label: '⚠️ Empty Response',   color: 'text-orange-600  bg-orange-50  border-orange-200'  },
  AI_RESPONSE_ERROR: { label: '❌ AI Error',          color: 'text-red-600     bg-red-50     border-red-200'      },
  IMAGE_GENERATE:    { label: 'Image Generated',      color: 'text-pink-600    bg-pink-50    border-pink-200'    },
};

function TokenPanel({ detail }) {
  if (!detail?.tokens) return null;
  const t = detail.tokens;
  const hasReasoning = t.reasoning !== undefined && t.reasoning !== null;
  const isWarning = detail.emptyResponse || detail.warning;
  return (
    <div className="space-y-1.5">
      {isWarning && (
        <div className="flex items-start gap-1.5 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1.5">
          <span className="text-orange-500 text-xs flex-shrink-0">⚠️</span>
          <span className="text-[10px] text-orange-700 font-medium leading-tight">
            {detail.emptyResponse
              ? `Empty response — reasoning used ${(t.reasoning||0).toLocaleString()} / ${detail.maxTokensConfig?.toLocaleString()} tokens. Increase Max Tokens to ${Math.ceil((detail.maxTokensConfig||2000)*2).toLocaleString()}+`
              : detail.warning}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">📥 {(t.prompt||0).toLocaleString()} prompt</span>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">📤 {(t.completion||0).toLocaleString()} completion</span>
        {hasReasoning && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${isWarning ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-violet-50 text-violet-700 border-violet-200'}`}>🧠 {(t.reasoning||0).toLocaleString()} reasoning</span>
        )}
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">Σ {(t.total||0).toLocaleString()} total</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-gray-500">
        <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">{detail.model||'?'}</span>
        {detail.durationMs && <span>⏱ {(detail.durationMs/1000).toFixed(1)}s</span>}
        {detail.maxTokensConfig && <span className="opacity-60">limit: {detail.maxTokensConfig.toLocaleString()}</span>}
      </div>
    </div>
  );
}

function DetailPanel({ detail, action }) {
  if (!detail) return <span className="text-gray-400 italic text-[10px]">—</span>;
  if (['AI_RESPONSE','AI_RESPONSE_EMPTY','AI_RESPONSE_ERROR'].includes(action)) return <TokenPanel detail={detail} />;
  if (action === 'IMAGE_GENERATE') {
    return (
      <div className="flex items-center gap-2 text-[10px]">
        <span>🎨</span>
        <span className="font-medium text-gray-700 truncate max-w-[180px]">{detail.prompt||'—'}</span>
        {detail.durationMs && <span className="text-gray-500">⏱ {(detail.durationMs/1000).toFixed(1)}s</span>}
      </div>
    );
  }
  if (action === 'BOT_UPDATE' && detail.before && detail.after) {
    const changed = Object.keys(detail.before).filter(k => JSON.stringify(detail.before[k]) !== JSON.stringify(detail.after[k]));
    if (!changed.length) return <span className="text-[10px] text-gray-500">No changes</span>;
    return (
      <div className="space-y-0.5">
        {changed.map(k => (
          <div key={k} className="flex items-start gap-1.5 text-[10px]">
            <span className="font-bold text-gray-500 capitalize min-w-[72px]">{k}:</span>
            <span className="line-through text-red-400 truncate max-w-[60px]">{String(detail.before[k]??'—')}</span>
            <span className="text-gray-400">→</span>
            <span className="text-emerald-600 font-medium truncate max-w-[60px]">{String(detail.after[k]??'—')}</span>
          </div>
        ))}
      </div>
    );
  }
  if (action === 'USER_UPDATE') {
    const lines = [];
    if (detail.before?.isAdmin !== detail.after?.isAdmin) lines.push({ key:'Admin', before:String(detail.before?.isAdmin), after:String(detail.after?.isAdmin) });
    if (detail.before?.isBotCreator !== detail.after?.isBotCreator) lines.push({ key:'Bot Creator', before:String(detail.before?.isBotCreator), after:String(detail.after?.isBotCreator) });
    if (detail.before?.assignedBotsCount !== detail.after?.assignedBotsCount) lines.push({ key:'Bots', before:`${detail.before?.assignedBotsCount}`, after:`${detail.after?.assignedBotsCount}` });
    if (detail.passwordChanged) lines.push({ key:'Password', before:'••••••', after:'(changed)' });
    if (!lines.length) return <span className="text-[10px] text-gray-500">No changes</span>;
    return (
      <div className="space-y-0.5">
        {lines.map(l => (
          <div key={l.key} className="flex items-center gap-1.5 text-[10px]">
            <span className="font-bold text-gray-500 min-w-[60px]">{l.key}:</span>
            <span className="line-through text-red-400">{l.before}</span>
            <span className="text-gray-400">→</span>
            <span className="text-emerald-600 font-medium">{l.after}</span>
          </div>
        ))}
      </div>
    );
  }
  if (action === 'KNOWLEDGE_UPLOAD' && detail.files) {
    return (
      <div className="space-y-0.5">
        {detail.files.map((f,i) => (
          <div key={i} className="text-[10px] text-gray-500 flex items-center gap-1">
            <span>📄</span><span className="font-medium text-gray-700">{f.name}</span><span>({fmtSize(f.size)})</span>
          </div>
        ))}
      </div>
    );
  }
  if (action === 'EXPORT_CHATS') {
    return <span className="text-[10px] text-gray-500">{detail.filter==='all'?'All time':detail.filter} · {detail.totalRows} rows</span>;
  }
  const entries = Object.entries(detail).filter(([k]) => !['before','after','tokens'].includes(k));
  if (!entries.length) return <span className="text-[10px] text-gray-500 italic">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.slice(0,4).map(([k,v]) => (
        <span key={k} className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
          <span className="font-bold text-gray-600">{k}:</span> {String(v).substring(0,30)}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
function AdminDashboard({ user, handleLogout }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab]   = useState('dashboard');
  const [stats, setStats]           = useState(null);
  const [users, setUsers]           = useState([]);
  const [bots,  setBots]            = useState([]);
  const [chatLogs, setChatLogs]     = useState([]);
  const [logPage, setLogPage]       = useState(1);
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [loading, setLoading]       = useState(false);
  const [exportFilter, setExportFilter] = useState('');

  const [showBotModal, setShowBotModal] = useState(false);
  const [editingBot,   setEditingBot]   = useState(null);
  const [botForm,      setBotForm]      = useState(initialBotState);
  const [botModalTab,  setBotModalTab]  = useState('basic');
  const [testAIState,  setTestAIState]  = useState(null);
  const [onedriveTestState, setOnedriveTestState] = useState(null);
  const [knowledgeUploading, setKnowledgeUploading] = useState(false);
  const [knowledgeFiles,     setKnowledgeFiles]     = useState([]);
  const knowledgeInputRef = useRef(null);

  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser,   setEditingUser]   = useState(null);
  const [userForm, setUserForm] = useState({ username: '', password: '', isAdmin: false, isBotCreator: false, assignedBots: [] });

  const [avatarPickerBot, setAvatarPickerBot] = useState(null);
  const [botSearch, setBotSearch] = useState('');
  const [embedBot, setEmbedBot] = useState(null);

  // Audit Trail state
  const [auditLogs,       setAuditLogs]       = useState([]);
  const [auditPage,       setAuditPage]       = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditTotal,      setAuditTotal]      = useState(0);
  const [auditLoading,    setAuditLoading]    = useState(false);
  const [auditCategory,   setAuditCategory]   = useState('');
  const [auditSearch,     setAuditSearch]     = useState('');
  const [auditDateFrom,   setAuditDateFrom]   = useState('');
  const [auditDateTo,     setAuditDateTo]     = useState('');
  const [auditExpanded,   setAuditExpanded]   = useState(null);
  const [auditTokenStats, setAuditTokenStats] = useState(null);

  useEffect(() => { fetchStats(); fetchBots(); if (user?.isAdmin) fetchUsers(); }, []);
  useEffect(() => { if (activeTab === 'chats' && user?.isAdmin) fetchChatLogs(); }, [activeTab, logPage]);
  useEffect(() => { if (activeTab === 'audit' && user?.isAdmin) fetchAuditLogs(); }, [activeTab, auditPage, auditCategory]);

  const fetchStats    = async () => { try { const r = await axios.get('/api/admin/stats'); setStats(r.data); } catch {} };
  const fetchUsers    = async () => { if (!user?.isAdmin) return; try { const r = await axios.get('/api/admin/users'); setUsers(r.data.users || []); } catch {} };
  const fetchBots     = async () => { try { const r = await axios.get('/api/admin/bots'); setBots(Array.isArray(r.data) ? r.data : r.data.bots || []); } catch {} };
  const fetchChatLogs = async () => {
    if (!user?.isAdmin) return;
    setLoading(true);
    try { const r = await axios.get(`/api/admin/chat-logs?page=${logPage}&limit=20`); setChatLogs(r.data.chats || []); setLogTotalPages(r.data.totalPages || 1); }
    finally { setLoading(false); }
  };

  const fetchAuditLogs = async () => {
    if (!user?.isAdmin) return;
    setAuditLoading(true);
    try {
      const p = new URLSearchParams({ page: auditPage, limit: 30 });
      if (auditCategory) p.set('category', auditCategory);
      if (auditSearch)   p.set('search',   auditSearch);
      if (auditDateFrom) p.set('dateFrom',  auditDateFrom);
      if (auditDateTo)   p.set('dateTo',    auditDateTo);
      const r = await axios.get(`/api/admin/audit-logs?${p}`);
      const logs = r.data.logs || [];
      setAuditLogs(logs);
      setAuditTotalPages(r.data.totalPages || 1);
      setAuditTotal(r.data.total || 0);
      const chatRows = logs.filter(l => l.category === 'chat' && l.detail?.tokens);
      if (chatRows.length > 0) {
        setAuditTokenStats({
          total:       chatRows.reduce((s,l) => s + (l.detail.tokens.total     || 0), 0),
          reasoning:   chatRows.reduce((s,l) => s + (l.detail.tokens.reasoning || 0), 0),
          emptyCount:  chatRows.filter(l => l.action === 'AI_RESPONSE_EMPTY').length,
          sampleCount: chatRows.length,
        });
      } else { setAuditTokenStats(null); }
    } catch {} finally { setAuditLoading(false); }
  };

  const handleAuditSearch = () => { setAuditPage(1); fetchAuditLogs(); };
  const handleAuditReset  = () => {
    setAuditCategory(''); setAuditSearch(''); setAuditDateFrom(''); setAuditDateTo('');
    setAuditPage(1); setAuditTokenStats(null);
    setTimeout(fetchAuditLogs, 50);
  };

  // Bot CRUD
  const handleCreateBot = () => {
    setEditingBot(null); setBotForm(initialBotState); setKnowledgeFiles([]);
    setBotModalTab('basic'); setTestAIState(null); setShowBotModal(true);
  };

  const handleEditBot = (bot) => {
  setEditingBot(bot);

  // ✅ NEW: prepare WAHA config (clean + backward compatible)
  const wahaConfigForForm = {
    enabled:        bot.wahaConfig?.enabled        || false,
    endpoint:       bot.wahaConfig?.endpoint       || '',
    session:        bot.wahaConfig?.session        || 'default',
    apiKey:         bot.wahaConfig?.apiKey         || '',
    webhookEnabled: bot.wahaConfig?.webhookEnabled || false,
    webhookSecret:  bot.wahaConfig?.webhookSecret  || '',
    botPhoneNumber: bot.wahaConfig?.botPhoneNumber || '',
    targets:        bot.wahaConfig?.targets        || [],
    schedules:      bot.wahaConfig?.schedules      || [],

    // legacy support
    chatId: bot.wahaConfig?.chatId || '',
    dailySchedule: {
      enabled: bot.wahaConfig?.dailySchedule?.enabled || false,
      time:    bot.wahaConfig?.dailySchedule?.time    || '08:00',
      prompt:  bot.wahaConfig?.dailySchedule?.prompt  || '',
    },
  };

  setBotForm({
    name: bot.name,
    description: bot.description || '',
    persona: bot.persona || '',
    tone: bot.tone || 'professional',
    systemPrompt: bot.systemPrompt || '',
    prompt: bot.prompt || '',
    starterQuestions: bot.starterQuestions || [],
    knowledgeMode: bot.knowledgeMode || 'relevant',

    aiProvider: {
      provider:    bot.aiProvider?.provider    || 'openai',
      model:       bot.aiProvider?.model       || 'gpt-4o',
      apiKey:      bot.aiProvider?.apiKey      || '',
      endpoint:    bot.aiProvider?.endpoint    || '',
      temperature: bot.aiProvider?.temperature ?? 0.1,
      maxTokens:   bot.aiProvider?.maxTokens   ?? 2000,
    },

    capabilities: {
      webSearch:       bot.capabilities?.webSearch       || false,
      codeInterpreter: bot.capabilities?.codeInterpreter || false,
      imageGeneration: bot.capabilities?.imageGeneration || false,
      canvas:          bot.capabilities?.canvas          || false,
      fileSearch:      bot.capabilities?.fileSearch      || false,
    },

    smartsheetConfig:  { enabled: false, apiKey: '', sheetId: '', ...bot.smartsheetConfig },
    kouventaConfig:    { enabled: false, apiKey: '', endpoint: '', ...bot.kouventaConfig },
    azureSearchConfig: { enabled: false, apiKey: '', endpoint: '', ...bot.azureSearchConfig },
    onedriveConfig:    { enabled: false, folderUrl: '', tenantId: '', clientId: '', clientSecret: '', ...bot.onedriveConfig },

    // ✅ REPLACED HERE
    wahaConfig: wahaConfigForForm,

    avatar: bot.avatar || { type: 'emoji', emoji: '🤖', bgColor: '#6366f1' },
  });

  setKnowledgeFiles(bot.knowledgeFiles || []);
  setBotModalTab('basic');
  setTestAIState(null);
  setShowBotModal(true);
  };

  const handleSaveBot = async (e) => {
    e.preventDefault();
    try {
      const { botApiKey: _omit, ...payload } = botForm;
      const cleanPayload = {
        ...payload,
        starterQuestions: botForm.starterQuestions.filter(q => q.trim()),
        pptTemplateFileId: botForm.pptTemplateFileId
      };
      if (editingBot) await axios.put(`/api/admin/bots/${editingBot._id}`, cleanPayload);
      else            await axios.post('/api/admin/bots', cleanPayload);
      setShowBotModal(false); fetchBots(); fetchStats();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const handleDeleteBot = async (id) => {
    if (!window.confirm('Delete this bot?')) return;
    try { await axios.delete(`/api/admin/bots/${id}`); fetchBots(); fetchStats(); } catch (e) { alert(e.message); }
  };

  const handleTestAI = async () => {
    setTestAIState('testing');
    try {
      let res;
      if (editingBot) { await axios.put(`/api/admin/bots/${editingBot._id}`, { ...botForm }); res = await axios.post(`/api/admin/bots/${editingBot._id}/test-ai`); }
      else            { res = await axios.post('/api/admin/test-ai-config', botForm.aiProvider); }
      setTestAIState(res.data);
    } catch (err) { setTestAIState({ ok: false, message: err.response?.data?.message || err.message }); }
  };

  const handleTestOneDrive = async () => {
    setOnedriveTestState('testing');
    try {
      if (editingBot) {
        await axios.put(`/api/admin/bots/${editingBot._id}`, { ...botForm });
        const res = await axios.post(`/api/admin/bots/${editingBot._id}/test-onedrive`);
        setOnedriveTestState(res.data);
      } else {
        setOnedriveTestState({ ok: false, message: 'Save the bot first before testing the connection.' });
      }
    } catch (err) {
      setOnedriveTestState({ ok: false, message: err.response?.data?.error || err.message });
    }
  };

  // Knowledge
  const handleKnowledgeUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!editingBot) { alert('Please save the bot before uploading knowledge files.'); return; }
    setKnowledgeUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      const res = await axios.post(`/api/admin/bots/${editingBot._id}/knowledge`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      alert(res.data.message);
      const updated = await axios.get('/api/admin/bots');
      const fresh   = (Array.isArray(updated.data) ? updated.data : updated.data.bots || []).find(b => b._id === editingBot._id);
      setKnowledgeFiles(fresh?.knowledgeFiles || []);
      setBots(Array.isArray(updated.data) ? updated.data : updated.data.bots || []);
    } catch (err) { alert('Upload failed: ' + (err.response?.data?.error || err.message)); }
    finally { setKnowledgeUploading(false); if (knowledgeInputRef.current) knowledgeInputRef.current.value = ''; }
  };

  const handleDeleteKnowledge = async (fileId, fileName) => {
    if (!window.confirm(`Delete file "${fileName}"?`)) return;
    try { await axios.delete(`/api/admin/bots/${editingBot._id}/knowledge/${fileId}`); setKnowledgeFiles(prev => prev.filter(f => f._id !== fileId)); }
    catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const handleAvatarSaved = (updatedBot) => {
    setBots(prev => prev.map(b => b._id === updatedBot._id ? updatedBot : b));
    if (editingBot?._id === updatedBot._id) { setEditingBot(updatedBot); setBotForm(p => ({ ...p, avatar: updatedBot.avatar })); }
  };

  const addQuestion    = ()     => setBotForm({ ...botForm, starterQuestions: [...botForm.starterQuestions, ''] });
  const updateQuestion = (i, v) => { const n = [...botForm.starterQuestions]; n[i] = v; setBotForm({ ...botForm, starterQuestions: n }); };
  const removeQuestion = (i)    => setBotForm({ ...botForm, starterQuestions: botForm.starterQuestions.filter((_, idx) => idx !== i) });

  // User CRUD
  const handleEditUser = (u) => {
    setEditingUser(u);
    setUserForm({ username: u.username, password: '', isAdmin: u.isAdmin, isBotCreator: u.isBotCreator || false, assignedBots: u.assignedBots?.map(b => b._id) || [] });
    setShowUserModal(true);
  };
  const handleSaveUser = async (e) => {
    e.preventDefault();
    try {
      if (editingUser) await axios.put(`/api/admin/users/${editingUser._id}`, userForm);
      else             await axios.post('/api/admin/users', userForm);
      setShowUserModal(false); fetchUsers(); fetchStats();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };
  const toggleBotAssignment = (id) => setUserForm(p => ({
    ...p, assignedBots: p.assignedBots.includes(id) ? p.assignedBots.filter(x => x !== id) : [...p.assignedBots, id]
  }));

  const handleExport = async () => {
    try {
      let url = '/api/admin/export-chats';
      if (exportFilter) { const [y, m] = exportFilter.split('-'); url += `?year=${y}&month=${m}`; }
      const response = await axios.get(url, { responseType: 'blob' });
      const a = document.createElement('a'); a.href = window.URL.createObjectURL(new Blob([response.data]));
      a.setAttribute('download', exportFilter ? `chat-logs-${exportFilter}.csv` : `chat-logs-all.csv`);
      document.body.appendChild(a); a.click(); a.remove();
    } catch { alert('Export failed'); }
  };

  // Chart data
  const lineChartData = {
    labels: stats?.activityTrend?.map(d => d._id) || [],
    datasets: [{ label: 'Messages', data: stats?.activityTrend?.map(d => d.count) || [], borderColor: '#007857', backgroundColor: 'rgba(0,120,87,0.08)', tension: 0.4, fill: true, pointBackgroundColor: '#004E36', pointRadius: 4, pointHoverRadius: 6, borderWidth: 2 }]
  };
  const pieColors = ['#004E36','#007857','#48AE92','#6E6F72','#A5A7AA'];
  const pieChartData = {
    labels: stats?.botPopularity?.map(b => b.name) || [],
    datasets: [{ data: stats?.botPopularity?.map(b => b.count) || [], backgroundColor: pieColors, borderWidth: 3, borderColor: '#ffffff' }]
  };

  const currentProvider = botForm.aiProvider?.provider || 'openai';
  const availableModels = AI_PROVIDERS[currentProvider]?.models || [];
  const modelGroups     = groupModelsByTier(availableModels);
  const providerCaps    = AI_PROVIDERS[currentProvider]?.capabilities || [];
  const filteredBots    = bots.filter(b => b.name.toLowerCase().includes(botSearch.toLowerCase()));
  const activeCapCount  = Object.values(botForm.capabilities || {}).filter(Boolean).length;
  const isReasoningOrGpt5 = /^(o\d|gpt-5)/.test(botForm.aiProvider?.model || '');

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F7F8FA] text-gray-900 font-sans">

      {/* NAV */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src="/assets/gys-logo.webp" alt="GYS" className="h-9 w-auto" onError={e => e.target.style.display='none'} />
            <div>
              <h1 className="text-base font-bold text-primary-dark leading-tight">GYS Admin Portal</h1>
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">AI Management Console</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1 rounded-full text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              System Online
            </div>
            <span className="text-xs text-gray-400 hidden md:block px-2 border-l border-gray-100">Hi, {user.username}</span>
            <button onClick={() => navigate('/')} className="px-3 py-1.5 text-xs bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-lg border border-gray-200 font-medium transition-colors">← Back to Chat</button>
            <button onClick={handleLogout} className="px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg border border-red-200 font-medium transition-colors">Logout</button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-0.5 overflow-x-auto">
            {[
              { id: 'dashboard', icon: '📊', label: 'Dashboard',   show: true },
              { id: 'bots',      icon: '🤖', label: 'Bots',        show: true },
              { id: 'users',     icon: '👥', label: 'User Access', show: user?.isAdmin },
              { id: 'chats',     icon: '💬', label: 'Chat Logs',   show: user?.isAdmin },
              { id: 'audit',     icon: '🕵️', label: 'Audit Trail', show: user?.isAdmin },
            ].filter(t => t.show).map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === t.id ? 'border-primary-dark text-primary-dark' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
                }`}>
                {t.icon} {t.label}
                {t.id === 'bots' && bots.length > 0 && (
                  <span className="ml-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px] font-bold">{bots.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* DASHBOARD */}
        {activeTab === 'dashboard' && stats && (
          <div className="space-y-6">
            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { title: 'Total Users',  value: stats.totalUsers,   icon: '👥', gradient: 'from-blue-500 to-blue-600',    light: 'bg-blue-50', text: 'text-blue-600'   },
                { title: 'Active Bots',  value: stats.totalBots,    icon: '🤖', gradient: 'from-emerald-500 to-emerald-600', light: 'bg-emerald-50', text: 'text-emerald-600' },
                { title: 'Total Chats',  value: stats.totalChats,   icon: '💬', gradient: 'from-violet-500 to-violet-600', light: 'bg-violet-50', text: 'text-violet-600' },
                { title: 'Threads',      value: stats.totalThreads, icon: '📂', gradient: 'from-amber-500 to-amber-600',  light: 'bg-amber-50',  text: 'text-amber-600'  },
              ].map((s, i) => (
                <div key={s.title} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all group">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-10 h-10 rounded-xl ${s.light} flex items-center justify-center text-xl group-hover:scale-110 transition-transform`}>{s.icon}</div>
                    <div className="w-1 h-8 rounded-full bg-gradient-to-b opacity-30 group-hover:opacity-60 transition-opacity" style={{ background: `linear-gradient(to bottom, var(--tw-gradient-from), var(--tw-gradient-to))` }} />
                  </div>
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-0.5">{s.title}</p>
                  <h2 className={`text-2xl font-bold ${s.text} tabular-nums`}>{(s.value || 0).toLocaleString()}</h2>
                </div>
              ))}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="font-bold text-gray-800">Activity Trend</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Message volume over time</p>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-lg">Last 7 days</span>
                </div>
                <div className="h-52">
                  <Line data={lineChartData} options={{
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                      y: { grid: { color: '#F3F4F6' }, ticks: { color: '#9CA3AF', font: { size: 10 } }, border: { display: false } },
                      x: { grid: { display: false }, ticks: { color: '#9CA3AF', font: { size: 10 } }, border: { display: false } }
                    },
                    plugins: { legend: { display: false } }
                  }} />
                </div>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                <div className="mb-5">
                  <h3 className="font-bold text-gray-800">Bot Usage</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Message distribution</p>
                </div>
                <div className="h-40">
                  <Doughnut data={pieChartData} options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { color: '#6B7280', boxWidth: 10, padding: 12, font: { size: 10 } } } },
                    cutout: '72%'
                  }} />
                </div>
              </div>
            </div>

            {/* Top contributors */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-gray-800">Top Contributors</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Most active users this week</p>
                </div>
              </div>
              <div className="divide-y divide-gray-50">
                {stats.topUsers?.map((u, i) => (
                  <div key={i} className="px-6 py-3.5 flex items-center justify-between hover:bg-gray-50/80 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-100 text-gray-600' : 'bg-orange-50 text-orange-600'}`}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`}
                      </div>
                      <span className="font-medium text-sm text-gray-700">{u.username}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, (u.count / (stats.topUsers[0]?.count || 1)) * 100)}%` }} />
                      </div>
                      <span className="font-bold text-primary text-sm tabular-nums w-16 text-right">{u.count} msgs</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* BOTS */}
        {activeTab === 'bots' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-800">AI Assistants</h2>
                <p className="text-sm text-gray-400 mt-0.5">{bots.length} bot{bots.length !== 1 ? 's' : ''} configured</p>
              </div>
              <div className="flex gap-2.5">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/></svg>
                  <input value={botSearch} onChange={e => setBotSearch(e.target.value)} placeholder="Search bots..." className="pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all w-44" />
                </div>
                <button onClick={handleCreateBot} className="px-4 py-2 bg-primary-dark text-white text-sm font-semibold rounded-xl hover:bg-primary transition-all shadow-sm flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                  Create Bot
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Create new card */}
              <div onClick={handleCreateBot} className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-6 flex flex-col items-center justify-center cursor-pointer hover:border-primary/40 hover:bg-primary/2 transition-all min-h-[200px] group">
                <div className="w-12 h-12 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center mb-3 text-gray-400 group-hover:border-primary group-hover:text-primary group-hover:bg-primary/5 transition-all">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                </div>
                <span className="font-semibold text-gray-500 group-hover:text-primary-dark text-sm transition-colors">Create New Bot</span>
                <p className="text-xs text-gray-400 mt-1 text-center">Configure AI model, knowledge & capabilities</p>
              </div>

              {filteredBots.map(bot => {
                const capCount = Object.values(bot.capabilities || {}).filter(Boolean).length;
                return (
                  <div key={bot._id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-all flex flex-col group">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="relative cursor-pointer flex-shrink-0" onClick={() => setAvatarPickerBot(bot)}>
                        <BotAvatar bot={bot} size="md" />
                        <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-0 hover:!opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-white text-[8px] font-bold">EDIT</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-gray-800 truncate text-sm">{bot.name}</h3>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{bot.description || 'No description'}</p>
                      </div>
                      <button onClick={() => handleEditBot(bot)} className="flex-shrink-0 text-xs font-semibold text-gray-500 hover:text-primary-dark bg-gray-50 hover:bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-100 transition-all">Edit</button>
                    </div>

                    {/* Model badge */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {(() => {
                        const p = bot.aiProvider?.provider || 'openai';
                        const m = bot.aiProvider?.model || 'gpt-4o';
                        const provData = AI_PROVIDERS[p];
                        const modelData = provData?.models.find(x => x.id === m);
                        return <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold ${TIER_STYLE[modelData?.tier || 'stable']}`}>{provData?.icon} {m}</span>;
                      })()}
                      {bot.knowledgeFiles?.length > 0 && <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-lg text-[10px] font-semibold">📚 {bot.knowledgeFiles.length} doc{bot.knowledgeFiles.length !== 1 ? 's' : ''}</span>}
                      {capCount > 0 && <span className="bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-lg text-[10px] font-semibold">⚡ {capCount} cap{capCount > 1 ? 's' : ''}</span>}
                    </div>

                    {capCount > 0 && (
                      <div className="flex gap-1 mb-3">
                        {ALL_CAPABILITIES.filter(c => bot.capabilities?.[c.id]).map(c => (
                          <span key={c.id} title={c.label} className="w-6 h-6 bg-gray-50 border border-gray-100 rounded-lg text-xs flex items-center justify-center">{c.icon}</span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between flex-wrap gap-1 mt-auto pt-3 border-t border-gray-50">
                      <div className="flex flex-wrap gap-1">
                        {bot.smartsheetConfig?.enabled  && <span className="text-[9px] px-1.5 py-0.5 bg-green-50 text-green-700 border border-green-100 rounded-lg font-medium">Smartsheet</span>}
                        {bot.kouventaConfig?.enabled     && <span className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg font-medium">Kouventa</span>}
                        {bot.onedriveConfig?.enabled     && <span className="text-[9px] px-1.5 py-0.5 bg-sky-50 text-sky-700 border border-sky-100 rounded-lg font-medium">OneDrive</span>}
                        {bot.azureSearchConfig?.enabled  && <span className="text-[9px] px-1.5 py-0.5 bg-purple-50 text-purple-700 border border-purple-100 rounded-lg font-medium">Azure Search</span>}
                        {!bot.smartsheetConfig?.enabled && !bot.kouventaConfig?.enabled && !bot.onedriveConfig?.enabled && !bot.azureSearchConfig?.enabled && <span className="text-[9px] text-gray-400">No integrations</span>}
                      </div>
                      <button onClick={() => setEmbedBot(bot)} className="text-[10px] font-semibold px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-100 rounded-lg transition-colors flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
                        Embed
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* USERS */}
        {activeTab === 'users' && user?.isAdmin && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-50 flex justify-between items-center">
              <div>
                <h2 className="font-bold text-gray-800">User Management</h2>
                <p className="text-xs text-gray-400 mt-0.5">{users.length} registered user{users.length !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => { setEditingUser(null); setUserForm({username:'',password:'',isAdmin:false,isBotCreator:false,assignedBots:[]}); setShowUserModal(true); }}
                className="px-4 py-2 bg-primary-dark text-white text-sm font-semibold rounded-xl hover:bg-primary transition-colors flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                Add User
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50/80 text-gray-400 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="px-6 py-3.5 text-left font-semibold">User</th>
                    <th className="px-6 py-3.5 text-left font-semibold">Role</th>
                    <th className="px-6 py-3.5 text-left font-semibold">Auth</th>
                    <th className="px-6 py-3.5 text-left font-semibold">Bots</th>
                    <th className="px-6 py-3.5 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.map(u => (
                    <tr key={u._id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-xs font-bold text-primary-dark">{u.username.substring(0,2).toUpperCase()}</div>
                          <span className="font-medium text-sm text-gray-800">{u.username}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3.5">
                        {u.isAdmin
                          ? <span className="bg-primary-dark text-white px-2.5 py-0.5 rounded-lg text-[10px] font-bold">ADMIN</span>
                          : u.isBotCreator
                          ? <span className="bg-violet-600 text-white px-2.5 py-0.5 rounded-lg text-[10px] font-bold">BOT CREATOR</span>
                          : <span className="text-gray-400 text-xs">User</span>}
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border ${u.authMethod === 'ldap' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                          {u.authMethod === 'ldap' ? 'LDAP/AD' : 'Local'}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-gray-500 text-xs">{u.assignedBots?.length || 0} bot(s)</td>
                      <td className="px-6 py-3.5 text-right">
                        <button onClick={() => handleEditUser(u)} className="text-primary hover:text-primary-dark font-semibold text-xs px-3 py-1.5 bg-primary/5 hover:bg-primary/10 rounded-lg transition-colors">Edit →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CHAT LOGS */}
        {activeTab === 'chats' && user?.isAdmin && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[700px]">
            <div className="px-6 py-5 border-b border-gray-50 flex justify-between items-center flex-shrink-0">
              <div>
                <h2 className="font-bold text-gray-800">Chat Logs</h2>
                <p className="text-xs text-gray-400 mt-0.5">Monitor all conversations</p>
              </div>
              <div className="flex items-center gap-2">
                <input type="month" value={exportFilter} onChange={e => setExportFilter(e.target.value)} className="bg-white border border-gray-200 rounded-xl text-xs px-3 py-2 outline-none focus:border-primary/40" />
                <button onClick={handleExport} className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary-dark transition-colors flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Export CSV
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50/80 text-gray-400 uppercase text-[10px] tracking-wider sticky top-0">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">Time</th>
                    <th className="px-5 py-3 text-left font-semibold">User</th>
                    <th className="px-5 py-3 text-left font-semibold">Bot</th>
                    <th className="px-5 py-3 text-left font-semibold">Role</th>
                    <th className="px-5 py-3 text-left font-semibold">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {chatLogs.map(log => (
                    <tr key={log._id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-5 py-2.5 text-gray-400 whitespace-nowrap tabular-nums">{new Date(log.createdAt).toLocaleString('en-US')}</td>
                      <td className="px-5 py-2.5 font-medium text-gray-700">{log.userId?.username || '—'}</td>
                      <td className="px-5 py-2.5 text-primary font-semibold">{log.botId?.name || 'System'}</td>
                      <td className="px-5 py-2.5">
                        <span className={`px-2 py-0.5 rounded-lg text-[9px] font-bold ${log.role === 'user' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>{log.role}</span>
                      </td>
                      <td className="px-5 py-2.5 truncate max-w-xs text-gray-500">{log.content || (log.attachedFiles?.length ? '📎 File attachment' : '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3.5 border-t border-gray-50 flex justify-between items-center text-xs text-gray-400 flex-shrink-0">
              <span>Page {logPage} of {logTotalPages}</span>
              <div className="flex gap-1.5">
                <button disabled={logPage===1} onClick={()=>setLogPage(p=>p-1)} className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 font-medium transition-colors">← Prev</button>
                <button disabled={logPage===logTotalPages} onClick={()=>setLogPage(p=>p+1)} className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 font-medium transition-colors">Next →</button>
              </div>
            </div>
          </div>
        )}

        {/* AUDIT TRAIL */}
        {activeTab === 'audit' && user?.isAdmin && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Audit Trail</h2>
                <p className="text-sm text-gray-400 mt-0.5">{auditTotal.toLocaleString()} total log entries</p>
              </div>
              <button onClick={fetchAuditLogs} className="px-4 py-2 bg-white border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors flex items-center gap-1.5 text-gray-600 self-start">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                Refresh
              </button>
            </div>

            {/* Token stats */}
            {auditTokenStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total Tokens (page)',  value: auditTokenStats.total.toLocaleString(),     icon: 'Σ',  bg: 'bg-primary/5', text: 'text-primary-dark' },
                  { label: 'Reasoning Tokens',     value: auditTokenStats.reasoning.toLocaleString(), icon: '🧠', bg: 'bg-violet-50', text: 'text-violet-700'  },
                  { label: 'Empty Responses',      value: auditTokenStats.emptyCount,                 icon: '⚠️', bg: 'bg-orange-50', text: 'text-orange-700'  },
                  { label: 'AI Calls (page)',       value: auditTokenStats.sampleCount,                icon: '💬', bg: 'bg-emerald-50', text: 'text-emerald-700' },
                ].map(s => (
                  <div key={s.label} className={`${s.bg} p-4 rounded-2xl border border-gray-100 shadow-sm`}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{s.label}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-lg">{s.icon}</span>
                      <span className={`text-xl font-bold tabular-nums ${s.text}`}>{s.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Filters */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1.5 min-w-[150px]">
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Category</label>
                  <select value={auditCategory} onChange={e => { setAuditCategory(e.target.value); setAuditPage(1); }} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-primary/40 transition-colors">
                    <option value="">All Categories</option>
                    {Object.entries(AUDIT_CATEGORY_META).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Search</label>
                  <input value={auditSearch} onChange={e => setAuditSearch(e.target.value)} onKeyDown={e => e.key==='Enter' && handleAuditSearch()} placeholder="Username, bot, action..." className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-primary/40 transition-colors" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">From</label>
                  <input type="date" value={auditDateFrom} onChange={e => setAuditDateFrom(e.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-primary/40" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">To</label>
                  <input type="date" value={auditDateTo} onChange={e => setAuditDateTo(e.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-primary/40" />
                </div>
                <div className="flex gap-2 pb-0.5">
                  <button onClick={handleAuditSearch} className="px-4 py-2 bg-primary-dark text-white text-xs font-semibold rounded-xl hover:bg-primary transition-colors flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/></svg>
                    Search
                  </button>
                  <button onClick={handleAuditReset} className="px-3 py-2 bg-gray-50 border border-gray-200 text-xs font-medium rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">Reset</button>
                </div>
              </div>
              {/* Category quick filter */}
              <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-gray-50">
                <button onClick={() => { setAuditCategory(''); setAuditPage(1); setTimeout(fetchAuditLogs, 50); }}
                  className={`px-3 py-1 rounded-full text-[10px] font-semibold border transition-colors ${!auditCategory ? 'bg-primary-dark text-white border-primary-dark' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}>All</button>
                {Object.entries(AUDIT_CATEGORY_META).map(([k,v]) => (
                  <button key={k} onClick={() => { setAuditCategory(k); setAuditPage(1); setTimeout(fetchAuditLogs, 50); }}
                    className={`px-3 py-1 rounded-full text-[10px] font-semibold border transition-colors ${auditCategory===k ? 'bg-primary-dark text-white border-primary-dark' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}>
                    {v.icon} {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Audit table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {auditLoading ? (
                <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
                  <div className="w-5 h-5 border-2 border-gray-200 border-t-primary rounded-full animate-spin" />
                  <span className="text-sm">Loading audit logs...</span>
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
                  <span className="text-4xl">🕵️</span>
                  <p className="font-semibold text-sm">No audit logs found</p>
                  <p className="text-xs">Try adjusting your filters or perform some actions first.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50/80 text-gray-400 uppercase text-[10px] tracking-wider sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">Timestamp</th>
                        <th className="px-4 py-3.5 text-left font-semibold">User</th>
                        <th className="px-4 py-3.5 text-left font-semibold">Category</th>
                        <th className="px-4 py-3.5 text-left font-semibold">Action</th>
                        <th className="px-4 py-3.5 text-left font-semibold">Target</th>
                        <th className="px-4 py-3.5 text-left font-semibold">Status</th>
                        <th className="px-4 py-3.5 text-left font-semibold">Details</th>
                        <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">IP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {auditLogs.map(log => {
                        const catMeta = AUDIT_CATEGORY_META[log.category] || AUDIT_CATEGORY_META.system;
                        const actMeta = ACTION_LABEL[log.action] || { label: log.action, color: 'text-gray-600 bg-gray-100 border-gray-200' };
                        const isExpanded = auditExpanded === log._id;
                        const hasWarning = log.detail?.emptyResponse || log.detail?.warning;
                        return (
                          <React.Fragment key={log._id}>
                            <tr className={`hover:bg-gray-50/60 transition-colors cursor-pointer ${isExpanded ? 'bg-gray-50/80' : ''} ${hasWarning ? 'bg-orange-50/30' : ''}`}
                              onClick={() => setAuditExpanded(isExpanded ? null : log._id)}>
                              <td className="px-4 py-3 whitespace-nowrap font-mono text-[10px] text-gray-400">
                                <div className="font-medium text-gray-600">{new Date(log.createdAt).toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'})}</div>
                                <div className="opacity-60">{new Date(log.createdAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary-dark flex-shrink-0">{(log.username||'?').substring(0,2).toUpperCase()}</div>
                                  <span className="font-medium text-gray-700">{log.username||'—'}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${catMeta.color}`}>{catMeta.icon} {catMeta.label}</span></td>
                              <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${actMeta.color}`}>{actMeta.label}</span></td>
                              <td className="px-4 py-3 max-w-[130px]">{log.targetName ? <span className="font-medium text-gray-700 truncate block">{log.targetName}</span> : <span className="text-gray-400">—</span>}</td>
                              <td className="px-4 py-3">
                                {log.status === 'success'
                                  ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"/>OK</span>
                                  : <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block"/>Failed</span>}
                              </td>
                              <td className="px-4 py-3 max-w-[280px]"><DetailPanel detail={log.detail} action={log.action} /></td>
                              <td className="px-4 py-3 font-mono text-[10px] text-gray-400 whitespace-nowrap">{log.ip||'—'}</td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-indigo-50/20">
                                <td colSpan={8} className="px-6 py-4">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">{log.category === 'chat' ? '📊 Token Usage Detail' : '📋 Full Detail'}</p>
                                      <div className="bg-white rounded-xl border border-gray-100 p-3">
                                        {log.category === 'chat' && log.detail?.tokens ? <TokenPanel detail={log.detail} /> : <DetailPanel detail={log.detail} action={log.action} />}
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">🌐 Request Info</p>
                                      <div className="bg-white rounded-xl border border-gray-100 p-3 space-y-2">
                                        <div className="flex items-center gap-2 text-xs"><span className="text-gray-400 font-semibold w-20">User ID:</span><span className="font-mono text-[10px] text-gray-600 break-all">{log.userId||'—'}</span></div>
                                        <div className="flex items-center gap-2 text-xs"><span className="text-gray-400 font-semibold w-20">Target ID:</span><span className="font-mono text-[10px] text-gray-600 break-all">{log.targetId||'—'}</span></div>
                                        <div className="flex items-start gap-2 text-xs"><span className="text-gray-400 font-semibold w-20 flex-shrink-0">User Agent:</span><span className="text-[10px] text-gray-500 break-all line-clamp-2">{log.userAgent||'—'}</span></div>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {auditLogs.length > 0 && (
                <div className="px-5 py-3.5 border-t border-gray-50 flex justify-between items-center text-xs text-gray-400 bg-gray-50/30">
                  <span>Showing {auditLogs.length} of {auditTotal.toLocaleString()} entries · Page {auditPage} of {auditTotalPages}</span>
                  <div className="flex gap-1.5">
                    <button disabled={auditPage===1} onClick={()=>setAuditPage(p=>p-1)} className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 font-medium transition-colors">← Prev</button>
                    <button disabled={auditPage===auditTotalPages} onClick={()=>setAuditPage(p=>p+1)} className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 font-medium transition-colors">Next →</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* BOT MODAL */}
      {showBotModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col border border-gray-100 overflow-hidden">
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center flex-shrink-0 bg-gray-50/50">
              <div className="flex items-center gap-3">
                <BotAvatar bot={editingBot || { avatar: botForm.avatar }} size="sm" />
                <div>
                  <h3 className="font-bold text-gray-800 text-sm">{editingBot ? `Edit — ${editingBot.name}` : 'Create New Bot'}</h3>
                  <p className="text-[10px] text-gray-400">{editingBot ? 'Configure an existing bot' : 'Create a new AI assistant with full capabilities'}</p>
                </div>
              </div>
              <button onClick={() => setShowBotModal(false)} className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>

            {/* Modal tabs */}
            <div className="flex border-b border-gray-100 bg-white px-4 overflow-x-auto flex-shrink-0">
              {[
                { id: 'basic',        label: 'Basic',        icon: '📝' },
                { id: 'ai',           label: 'AI & Model',   icon: '🤖' },
                { id: 'capabilities', label: `Capabilities${activeCapCount > 0 ? ` (${activeCapCount})` : ''}`, icon: '⚡' },
                { id: 'knowledge',    label: `Knowledge${knowledgeFiles.length > 0 ? ` (${knowledgeFiles.length})` : ''}`, icon: '📚' },
                { id: 'integrations', label: 'Integrations', icon: '🔌' },
              ].map(t => (
                <button key={t.id} onClick={() => setBotModalTab(t.id)}
                  className={`px-4 py-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${botModalTab === t.id ? 'border-primary-dark text-primary-dark' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 min-h-0">

              {/* BASIC TAB */}
              {botModalTab === 'basic' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="relative cursor-pointer group/av" onClick={() => editingBot && setAvatarPickerBot(editingBot)}>
                      <BotAvatar bot={editingBot || { avatar: botForm.avatar }} size="sm" />
                      {editingBot && <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover/av:opacity-100 transition-opacity flex items-center justify-center"><span className="text-white text-[8px] font-bold">EDIT</span></div>}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-gray-800">Bot Avatar</p>
                      <p className="text-xs text-gray-400 mt-0.5">Upload an image, choose an emoji, or pick an icon</p>
                      {editingBot
                        ? <button type="button" onClick={() => setAvatarPickerBot(editingBot)} className="mt-2 px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-semibold transition-colors">🎨 Edit Avatar</button>
                        : <p className="text-xs text-gray-400 mt-1.5 italic">💡 Save the bot first to edit the avatar</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Bot Name *</label>
                      <input className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-sm focus:border-primary/40 focus:ring-2 focus:ring-primary/10 outline-none transition-all" placeholder="e.g. HR Assistant" value={botForm.name} onChange={e => setBotForm({...botForm, name: e.target.value})} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Description</label>
                      <input className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-sm focus:border-primary/40 outline-none transition-all" placeholder="Short description for the sidebar" value={botForm.description} onChange={e => setBotForm({...botForm, description: e.target.value})} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Persona (optional)</label>
                      <input className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-sm focus:border-primary/40 outline-none transition-all" placeholder="e.g. Expert HR Consultant" value={botForm.persona} onChange={e => setBotForm({...botForm, persona: e.target.value})} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Tone / Communication Style</label>
                      <select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-sm focus:border-primary/40 outline-none" value={botForm.tone} onChange={e => setBotForm({...botForm, tone: e.target.value})}>
                        {TONE_OPTIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">System Prompt / Bot Instructions</label>
                    <textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm h-36 font-mono focus:border-primary/40 outline-none resize-none transition-all" placeholder="Example: You are an HR assistant..." value={botForm.prompt} onChange={e => setBotForm({...botForm, prompt: e.target.value})} />
                    <p className="text-[10px] text-gray-400 mt-1">💡 This prompt defines the bot's personality, tasks, and boundaries</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Starter Questions</label>
                      <button onClick={addQuestion} className="text-xs font-semibold text-primary hover:text-primary-dark transition-colors">+ Add</button>
                    </div>
                    <div className="space-y-2">
                      {botForm.starterQuestions.map((q, i) => (
                        <div key={i} className="flex gap-2">
                          <input className="flex-1 bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-sm focus:border-primary/40 outline-none transition-all" value={q} onChange={e => updateQuestion(i, e.target.value)} placeholder={`Question ${i+1}...`} />
                          <button onClick={() => removeQuestion(i)} className="text-red-400 hover:text-red-600 font-bold px-2 transition-colors">✕</button>
                        </div>
                      ))}
                      {botForm.starterQuestions.length === 0 && <p className="text-xs text-gray-400 italic">No starter questions yet.</p>}
                    </div>
                  </div>
                </div>
              )}

              {/* AI & MODEL TAB */}
              {botModalTab === 'ai' && (
                <div className="space-y-5">
                  <div className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                    💡 Select an AI provider and model. The API Key can be set per-bot or left blank to use the key from the server <code className="bg-blue-100 px-1 rounded">.env</code>.
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-2">AI Provider</label>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(AI_PROVIDERS).map(([key, prov]) => (
                        <button key={key} type="button" onClick={() => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, provider: key, model: prov.models[0]?.id || '' } }))}
                          className={`p-3.5 rounded-xl border-2 text-left transition-all ${currentProvider === key ? 'border-primary-dark bg-primary/5 shadow-sm' : 'border-gray-100 hover:border-gray-200 bg-white'}`}>
                          <div className="text-xl mb-1">{prov.icon}</div>
                          <div className="text-xs font-bold text-gray-800">{prov.label}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{prov.models.length > 0 ? `${prov.models.length} models` : 'Custom endpoint'}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  {availableModels.length > 0 && (
                    <div>
                      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-2">Model</label>
                      <div className="max-h-64 overflow-y-auto pr-1 space-y-3 rounded-xl border border-gray-100 p-3 bg-gray-50">
                        {modelGroups.map(({ tier, models }) => (
                          <div key={tier}>
                            <div className="flex items-center gap-2 mb-1.5 sticky top-0 bg-gray-50 py-1 rounded">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TIER_STYLE[tier]}`}>{TIER_GROUP_LABEL[tier]}</span>
                              <div className="flex-1 h-px bg-gray-200" />
                            </div>
                            <div className="space-y-1">
                              {models.map(m => (
                                <button key={m.id} type="button" onClick={() => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, model: m.id } }))}
                                  className={`w-full px-3 py-2.5 rounded-xl border-2 text-left flex items-center justify-between transition-all ${botForm.aiProvider?.model === m.id ? 'border-primary bg-primary/5 shadow-sm' : 'border-transparent bg-white hover:border-gray-200'}`}>
                                  <div>
                                    <span className="text-sm font-semibold text-gray-800">{m.label}</span>
                                    <div className="text-[10px] text-gray-400 font-mono">{m.id}</div>
                                  </div>
                                  {botForm.aiProvider?.model === m.id && (
                                    <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {currentProvider === 'custom' && (
                    <div>
                      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Model ID</label>
                      <input className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-sm focus:border-primary/40 outline-none" placeholder="e.g. llama3:8b" value={botForm.aiProvider?.model || ''} onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, model: e.target.value } }))} />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">API Key (override .env — optional)</label>
                    <div className="relative">
                      <input type="text" autoComplete="off" readOnly onFocus={e => e.target.removeAttribute('readOnly')}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-sm focus:border-primary/40 outline-none font-mono"
                        placeholder="Leave blank to use OPENAI_API_KEY from .env"
                        value={botForm.aiProvider?.apiKey || ''} onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, apiKey: e.target.value } }))} />
                      {botForm.aiProvider?.apiKey && (
                        <button type="button" onClick={() => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, apiKey: '' } }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-red-400 hover:text-red-600 font-semibold px-1.5 py-0.5 rounded transition-colors">✕ Remove</button>
                      )}
                    </div>
                    <p className="text-[10px] mt-1">
                      {botForm.aiProvider?.apiKey
                        ? <span className="text-amber-600 font-semibold">⚠️ Using a custom API Key (not from .env)</span>
                        : <span className="text-emerald-600 font-semibold">✅ Using OPENAI_API_KEY from server .env</span>}
                    </p>
                  </div>
                  {(currentProvider === 'custom' || currentProvider === 'openai') && (
                    <div>
                      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">{currentProvider === 'custom' ? 'Endpoint URL *' : 'Custom Base URL (Azure / proxy — optional)'}</label>
                      <input autoComplete="off" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-sm focus:border-primary/40 outline-none" placeholder="https://..." value={botForm.aiProvider?.endpoint || ''} onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, endpoint: e.target.value } }))} />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5">
                      <label className="text-xs font-semibold text-gray-500 block mb-2">Temperature: <span className="text-primary-dark font-bold">{botForm.aiProvider?.temperature ?? 0.1}</span></label>
                      <input type="range" min="0" max="1" step="0.05" value={botForm.aiProvider?.temperature ?? 0.1} onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, temperature: parseFloat(e.target.value) } }))} className="w-full accent-primary-dark" />
                      <div className="flex justify-between text-[9px] text-gray-400 mt-1"><span>Precise (0)</span><span>Creative (1)</span></div>
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5">
                      <label className="text-xs font-semibold text-gray-500 block mb-2">Max Tokens</label>
                      <input type="number" min="256" max="32000" step="256" className="w-full bg-white border border-gray-200 rounded-lg p-2 text-sm focus:border-primary/40 outline-none"
                        value={botForm.aiProvider?.maxTokens ?? 2000} onChange={e => setBotForm(f => ({ ...f, aiProvider: { ...f.aiProvider, maxTokens: parseInt(e.target.value) } }))} />
                      {isReasoningOrGpt5 && (botForm.aiProvider?.maxTokens ?? 2000) < 8000 && (
                        <p className="text-[10px] text-orange-600 font-semibold mt-1.5">⚠️ Reasoning model — increase to at least 8000</p>
                      )}
                    </div>
                  </div>
                  <div className="pt-3 border-t border-gray-100">
                    <button type="button" onClick={handleTestAI} disabled={testAIState === 'testing'} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 transition-colors flex items-center gap-2">
                      {testAIState === 'testing' ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Testing...</> : '🔌 Test Connection'}
                    </button>
                    {testAIState && testAIState !== 'testing' && (
                      <div className={`mt-3 p-3 rounded-xl text-xs font-medium border ${testAIState.ok ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                        {testAIState.ok ? '✅' : '❌'} {testAIState.message}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* CAPABILITIES TAB */}
              {botModalTab === 'capabilities' && (
                <div className="space-y-4">
                  <div className="text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-xl px-4 py-3">⚡ Enable additional capabilities similar to ChatGPT. Availability depends on the selected provider and model.</div>
                  <div className="space-y-3">
                    {ALL_CAPABILITIES.map(cap => {
                      const isSupported = cap.providers.includes(currentProvider);
                      const isOn = botForm.capabilities?.[cap.id] || false;
                      return (
                        <div key={cap.id} className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${!isSupported ? 'opacity-50 border-gray-100 bg-gray-50' : isOn ? 'border-primary/30 bg-primary/5' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                          <div className="flex items-start gap-3">
                            <span className="text-xl">{cap.icon}</span>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-sm text-gray-800">{cap.label}</p>
                                {!isSupported && <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-semibold">Not available for {currentProvider}</span>}
                              </div>
                              <p className="text-xs text-gray-400 mt-0.5">{cap.desc}</p>
                              <div className="flex gap-1 mt-1">{cap.providers.map(p => <span key={p} className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-semibold">{AI_PROVIDERS[p]?.icon} {p}</span>)}</div>
                            </div>
                          </div>
                          <button type="button" disabled={!isSupported} onClick={() => setBotForm(f => ({ ...f, capabilities: { ...f.capabilities, [cap.id]: !isOn } }))}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${isOn && isSupported ? 'bg-primary-dark' : 'bg-gray-200'} ${!isSupported ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isOn && isSupported ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {activeCapCount > 0 && <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">⚠️ <strong>{activeCapCount} capability{activeCapCount !== 1 ? 'ies' : ''} active.</strong> May require a paid API tier.</div>}
                </div>
              )}

              {/* KNOWLEDGE TAB */}
              {/* KNOWLEDGE TAB */}
              {botModalTab === 'knowledge' && (
                <div className="space-y-5">

                  {/* Info */}
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    📚 Upload documents as the bot's knowledge source. Supports <strong>PDF, Word, Excel, PowerPoint, TXT, CSV, MD</strong>.
                    {!editingBot && (
                      <span className="block mt-1 font-bold text-amber-800">
                        ⚠️ Save the bot first before uploading files.
                      </span>
                    )}
                  </div>

                  {/* Knowledge Mode */}
                  <div>
                    <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-2">
                      Knowledge Base Mode
                    </label>
                    <div className="space-y-2">
                      {KNOWLEDGE_MODES.map(m => (
                        <label
                          key={m.id}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                            botForm.knowledgeMode === m.id
                              ? 'border-primary bg-primary/5'
                              : 'border-gray-100 hover:border-gray-200'
                          }`}
                        >
                          <input
                            type="radio"
                            name="knowledgeMode"
                            value={m.id}
                            checked={botForm.knowledgeMode === m.id}
                            onChange={() => setBotForm({ ...botForm, knowledgeMode: m.id })}
                            className="accent-primary-dark"
                          />
                          <div>
                            <div className="text-sm font-semibold text-gray-800">{m.label}</div>
                            <div className="text-xs text-gray-400">{m.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* ✅ PATCH 5: PPT TEMPLATE SELECTOR */}
                  {editingBot && knowledgeFiles.some(f => f.originalName?.toLowerCase().endsWith('.pptx')) && (
                    <div className="border border-indigo-100 bg-indigo-50 rounded-xl p-3">
                      <label className="text-[10px] font-semibold text-indigo-700 uppercase tracking-wide block mb-2">
                        🎨 Template PPT (dari Knowledge Base)
                      </label>

                      <select
                        className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-400"
                        value={botForm.pptTemplateFileId || ''}
                        onChange={e =>
                          setBotForm({
                            ...botForm,
                            pptTemplateFileId: e.target.value || null
                          })
                        }
                      >
                        <option value="">— Gunakan tema GYS default —</option>

                        {knowledgeFiles
                          .filter(f => f.originalName?.toLowerCase().endsWith('.pptx'))
                          .map(f => (
                            <option key={f._id} value={f._id}>
                              🎨 {f.originalName}
                            </option>
                          ))}
                      </select>

                      <p className="text-[9px] text-indigo-600 mt-1">
                        Bot akan mengadopsi warna & font dari template PPTX yang dipilih saat membuat presentasi
                      </p>
                    </div>
                  )}

                  {/* Upload Files */}
                  {editingBot && (
                    <div>
                      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-2">
                        Upload Files
                      </label>

                      <div
                        onClick={() => knowledgeInputRef.current?.click()}
                        className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-amber-300 hover:bg-amber-50/50 transition-all"
                      >
                        {knowledgeUploading ? (
                          <div className="flex flex-col items-center gap-2 text-amber-600">
                            <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin"/>
                            <p className="font-semibold text-sm">Processing files...</p>
                          </div>
                        ) : (
                          <>
                            <div className="text-4xl mb-2">📁</div>
                            <p className="text-sm font-semibold text-gray-600">Click or drag & drop files</p>
                            <p className="text-xs text-gray-400 mt-1">
                              PDF • Word • Excel • PowerPoint • TXT • CSV • MD
                            </p>
                          </>
                        )}
                      </div>

                      <input
                        ref={knowledgeInputRef}
                        type="file"
                        multiple
                        accept={SUPPORTED_FILE_TYPES}
                        className="hidden"
                        onChange={handleKnowledgeUpload}
                      />
                    </div>
                  )}

                  {/* File List */}
                  {knowledgeFiles.length > 0 && (
                    <div>
                      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-2">
                        Documents ({knowledgeFiles.length})
                      </label>

                      <div className="space-y-2">
                        {knowledgeFiles.map(f => (
                          <div
                            key={f._id}
                            className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors"
                          >
                            <span className="text-xl flex-shrink-0">
                              {getFileIcon(f.originalName)}
                            </span>

                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate text-gray-800">
                                {f.originalName}
                              </p>
                              <p className="text-[10px] text-gray-400">
                                {fmtSize(f.size)} · {new Date(f.uploadedAt).toLocaleDateString('en-US')}
                              </p>
                              {f.summary && (
                                <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">
                                  {f.summary}
                                </p>
                              )}
                            </div>

                            {editingBot && (
                              <button
                                onClick={() => handleDeleteKnowledge(f._id, f.originalName)}
                                className="text-red-400 hover:text-red-600 text-xs font-bold flex-shrink-0 transition-colors"
                              >
                                🗑
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* INTEGRATIONS TAB */}
              {botModalTab === 'integrations' && (
                <div className="space-y-4">
                  {/* API Key Widget */}
                  {editingBot ? (
                    <ApiKeyWidget botId={editingBot._id} hasKey={editingBot.botApiKey === '***'} />
                  ) : (
                    <div className="border border-gray-200 bg-gray-50 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-base">🔑</span>
                        <span className="font-semibold text-sm text-gray-800">Bot API Key (External Access)</span>
                      </div>
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        ⚠️ Save the bot first, then generate an API Key from here.
                      </p>
                    </div>
                  )}

                  {/* ──── WAHA WhatsApp Integration ──── */}
                  {(() => {
                    const waha = botForm.wahaConfig || {};
                    const setWaha = (patch) => setBotForm(f => ({
                      ...f,
                      wahaConfig: { ...f.wahaConfig, ...patch }
                    }));

                    const targets = waha.targets || [];
                    const schedules = waha.schedules || [];

                    const addTarget = () => setWaha({ targets: [...targets, newTarget()] });
                    const removeTarget = (id) => setWaha({ targets: targets.filter(t => t._id !== id) });
                    const updateTarget = (id, patch) => setWaha({ targets: targets.map(t => t._id === id ? { ...t, ...patch } : t) });

                    const addSchedule = () => setWaha({ schedules: [...schedules, newSchedule()] });
                    const removeSchedule = (id) => setWaha({ schedules: schedules.filter(s => s._id !== id) });
                    const updateSchedule = (id, patch) => setWaha({ schedules: schedules.map(s => s._id === id ? { ...s, ...patch } : s) });

                    return (
                      <div className={`border-2 rounded-xl p-4 transition-all ${waha.enabled ? 'border-[#25D366]/40 bg-[#25D366]/5' : 'border-gray-100 bg-white'}`}>
                        
                        {/* HEADER */}
                        <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">💬</span>
                            <span className="font-semibold text-sm text-gray-800">WhatsApp Integration (WAHA)</span>
                          </div>
                          <button type="button"
                            onClick={() => setWaha({ enabled: !waha.enabled })}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full ${waha.enabled ? 'bg-[#25D366]' : 'bg-gray-200'}`}>
                            <span className={`inline-block h-3.5 w-3.5 bg-white rounded-full transform ${waha.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                          </button>
                        </div>

                        {waha.enabled && (
                          <div className="space-y-4 mt-4 pt-4 border-t border-[#25D366]/20">

                            {/* BASIC CONFIG */}
                            <input
                              type="text"
                              value={waha.endpoint || ''}
                              onChange={e => setWaha({ endpoint: e.target.value })}
                              placeholder="http://your-waha-server:3000"
                              className="w-full border rounded-xl p-2 text-xs"
                            />

                            {/* TARGETS */}
                            <div>
                              <div className="flex justify-between mb-2">
                                <span className="text-xs font-semibold">Targets</span>
                                <button onClick={addTarget} type="button" className="text-xs text-green-600">+ Add</button>
                              </div>

                              {targets.map(t => (
                                <div key={t._id} className="flex gap-2 mb-2">
                                  <input
                                    value={t.chatId}
                                    onChange={e => updateTarget(t._id, { chatId: e.target.value })}
                                    placeholder="628xxx@c.us"
                                    className="flex-1 border rounded p-1 text-xs"
                                  />
                                  <button onClick={() => removeTarget(t._id)} className="text-red-500 text-xs">x</button>
                                </div>
                              ))}
                            </div>

                            {/* SCHEDULE */}
                            <div>
                              <div className="flex justify-between mb-2">
                                <span className="text-xs font-semibold">Schedules</span>
                                <button onClick={addSchedule} type="button" className="text-xs text-green-600">+ Add</button>
                              </div>

                              {schedules.map(s => (
                                <div key={s._id} className="border rounded p-2 mb-2">
                                  <input
                                    value={s.prompt}
                                    onChange={e => updateSchedule(s._id, { prompt: e.target.value })}
                                    placeholder="Prompt"
                                    className="w-full border rounded p-1 text-xs mb-1"
                                  />
                                  <input
                                    type="time"
                                    value={s.time}
                                    onChange={e => updateSchedule(s._id, { time: e.target.value })}
                                    className="border rounded p-1 text-xs"
                                  />
                                </div>
                              ))}
                            </div>

                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Smartsheet / Kouventa / Azure Search */}
                  {[
                    { key: 'smartsheet',  label: 'Smartsheet Integration', icon: '📊', fields: [{ key: 'sheetId', label: 'Sheet ID', type: 'text' }, { key: 'apiKey', label: 'API Key (override .env)', type: 'password' }] },
                    { key: 'kouventa',    label: 'Kouventa AI Engine',     icon: '🔗', fields: [{ key: 'endpoint', label: 'Endpoint URL', type: 'text' }, { key: 'apiKey', label: 'API Key', type: 'password' }] },
                    { key: 'azureSearch', label: 'Azure AI Search',        icon: '🔍', fields: [{ key: 'endpoint', label: 'Endpoint URL', type: 'text' }, { key: 'apiKey', label: 'API Key', type: 'password' }] },
                  ].map(intg => {
                    const configKey = `${intg.key}Config`;
                    const config = botForm[configKey] || {};
                    return (
                      <div key={intg.key} className={`border-2 rounded-xl p-4 transition-all ${config.enabled ? 'border-primary/30 bg-primary/5' : 'border-gray-100 bg-white'}`}>
                        <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center gap-2"><span className="text-lg">{intg.icon}</span><span className="font-semibold text-sm text-gray-800">{intg.label}</span></div>
                          <button type="button" onClick={() => setBotForm(f => ({ ...f, [configKey]: { ...f[configKey], enabled: !config.enabled } }))}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.enabled ? 'bg-primary-dark' : 'bg-gray-200'}`}>
                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${config.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                        {config.enabled && (
                          <div className="space-y-2">
                            {intg.fields.map(field => (
                              <input key={field.key} type={field.type} placeholder={field.label} autoComplete="new-password"
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-primary/40 transition-colors"
                                value={config[field.key] || ''} onChange={e => setBotForm(f => ({ ...f, [configKey]: { ...f[configKey], [field.key]: e.target.value } }))} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* OneDrive */}
                  {(() => {
                    const config = botForm.onedriveConfig || {};
                    return (
                      <div className={`border-2 rounded-xl p-4 transition-all ${config.enabled ? 'border-sky-200 bg-sky-50/30' : 'border-gray-100 bg-white'}`}>
                        <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center gap-2"><span className="text-lg">☁️</span><span className="font-semibold text-sm text-gray-800">OneDrive / SharePoint Integration</span></div>
                          <button type="button" onClick={() => { setBotForm(f => ({ ...f, onedriveConfig: { ...f.onedriveConfig, enabled: !config.enabled } })); setOnedriveTestState(null); }}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.enabled ? 'bg-sky-600' : 'bg-gray-200'}`}>
                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${config.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                        {config.enabled && (
                          <div className="space-y-3">
                            <div className="bg-sky-50 border border-sky-100 rounded-xl px-3 py-2 text-[10px] text-sky-700">
                              📋 Bot will read files from your OneDrive/SharePoint folder. Use <strong>Application permissions</strong> in Azure AD.
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Folder URL</label>
                              <input type="text" placeholder="https://company.sharepoint.com/..." autoComplete="off"
                                className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-sky-400 transition-colors"
                                value={config.folderUrl || ''} onChange={e => setBotForm(f => ({ ...f, onedriveConfig: { ...f.onedriveConfig, folderUrl: e.target.value } }))} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {['tenantId', 'clientId'].map(field => (
                                <div key={field}>
                                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">{field === 'tenantId' ? 'Tenant ID' : 'Client ID'}</label>
                                  <input type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off"
                                    className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs font-mono outline-none focus:border-sky-400 transition-colors"
                                    value={config[field] || ''} onChange={e => setBotForm(f => ({ ...f, onedriveConfig: { ...f.onedriveConfig, [field]: e.target.value } }))} />
                                </div>
                              ))}
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Client Secret</label>
                              <input type="password" placeholder="Client Secret Value" autoComplete="new-password"
                                className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-sky-400 transition-colors"
                                value={config.clientSecret || ''} onChange={e => setBotForm(f => ({ ...f, onedriveConfig: { ...f.onedriveConfig, clientSecret: e.target.value } }))} />
                            </div>
                            <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-[10px] text-amber-700 space-y-0.5">
                              <p className="font-bold">⚠️ Required Azure App Permissions:</p>
                              <p>✅ <code className="bg-amber-100 px-1 rounded">Files.Read.All</code> — Application</p>
                              <p>✅ <code className="bg-amber-100 px-1 rounded">Sites.Read.All</code> — Application</p>
                            </div>
                            <div className="pt-1 border-t border-gray-100">
                              <button type="button" onClick={handleTestOneDrive}
                                disabled={onedriveTestState === 'testing' || !config.folderUrl || !config.tenantId || !config.clientId || !config.clientSecret}
                                className="px-4 py-2 bg-sky-600 text-white text-xs font-semibold rounded-xl hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
                                {onedriveTestState === 'testing' ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Testing...</> : '🔌 Test OneDrive Connection'}
                              </button>
                              {onedriveTestState && onedriveTestState !== 'testing' && (
                                <div className={`mt-2 p-3 rounded-xl text-xs font-medium border ${onedriveTestState.ok ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                                  {onedriveTestState.ok ? <div><p className="font-bold">✅ Connection successful!</p>{onedriveTestState.fileCount !== undefined && <p>📁 {onedriveTestState.fileCount} file(s) found</p>}</div> : <div><p className="font-bold">❌ Connection failed</p><p>{onedriveTestState.message}</p></div>}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center bg-gray-50/40 flex-shrink-0">
              <div>
                {editingBot && (
                  <button onClick={() => handleDeleteBot(editingBot._id)} className="px-4 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 font-semibold text-sm rounded-xl transition-colors flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    Delete Bot
                  </button>
                )}
              </div>
              <div className="flex gap-2.5">
                <button onClick={() => setShowBotModal(false)} className="px-4 py-2 text-gray-500 hover:text-gray-700 font-medium text-sm transition-colors">Cancel</button>
                <button onClick={handleSaveBot} className="px-6 py-2 bg-primary-dark text-white rounded-xl font-semibold hover:bg-primary text-sm transition-all shadow-sm">
                  {editingBot ? '✓ Save Changes' : '+ Create Bot'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* USER MODAL */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-gray-100">
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-bold text-gray-800 text-lg">{editingUser ? 'Edit User' : 'Add User'}</h3>
              <button onClick={() => setShowUserModal(false)} className="text-gray-400 hover:text-gray-600 w-8 h-8 rounded-xl hover:bg-gray-100 flex items-center justify-center transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="space-y-3">
              <input autoComplete="off" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm focus:border-primary/40 outline-none transition-all" placeholder="Username" value={userForm.username} onChange={e => setUserForm({...userForm, username: e.target.value})} />
              <input autoComplete="new-password" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm focus:border-primary/40 outline-none transition-all" type="password" placeholder="Password (leave blank to keep unchanged)" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} />
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer text-gray-700">
                  <input type="checkbox" checked={userForm.isAdmin} onChange={e => setUserForm({...userForm, isAdmin: e.target.checked})} className="accent-primary-dark" />
                  Administrator
                </label>
                {!userForm.isAdmin && (
                  <label className="flex items-center gap-2 text-sm font-medium cursor-pointer text-violet-700">
                    <input type="checkbox" checked={userForm.isBotCreator} onChange={e => setUserForm({...userForm, isBotCreator: e.target.checked})} className="accent-violet-600" />
                    Bot Creator
                  </label>
                )}
              </div>
              <div className="border border-gray-100 p-3 rounded-xl max-h-36 overflow-y-auto bg-gray-50">
                <p className="text-[10px] font-semibold text-gray-400 mb-2 uppercase tracking-wide">Bot Access</p>
                {bots.map(b => (
                  <label key={b._id} className="flex items-center gap-2 mb-1.5 text-sm cursor-pointer hover:bg-white rounded-lg px-1 py-0.5 transition-colors">
                    <input type="checkbox" checked={userForm.assignedBots.includes(b._id)} onChange={() => toggleBotAssignment(b._id)} className="accent-primary-dark" />
                    <BotAvatar bot={b} size="xs" />
                    <span className="truncate font-medium text-gray-700">{b.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowUserModal(false)} className="px-4 py-2 text-gray-500 font-medium text-sm hover:text-gray-700 transition-colors">Cancel</button>
              <button onClick={handleSaveUser} className="px-5 py-2 bg-primary-dark text-white rounded-xl font-semibold text-sm hover:bg-primary transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}

      {avatarPickerBot && <AvatarPicker bot={avatarPickerBot} onSave={handleAvatarSaved} onClose={() => setAvatarPickerBot(null)} />}
      {embedBot && <EmbedCodeModal bot={embedBot} onClose={() => setEmbedBot(null)} />}
    </div>
  );
}

export default AdminDashboard;
