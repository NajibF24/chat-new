import OpenAI from 'openai';
import axios  from 'axios';

// ── Provider & Model Catalogs ─────────────────────────────────
export const AI_PROVIDERS = {
  openai: {
    label:  'OpenAI',
    icon:   '🟢',
    models: [
      // GPT-5.x family
      { id: 'gpt-5.2',               label: 'GPT-5.2',               context: 1000000, tier: 'flagship'  },
      { id: 'gpt-5.1',               label: 'GPT-5.1',               context: 1000000, tier: 'flagship'  },
      { id: 'gpt-5',                 label: 'GPT-5',                 context: 1000000, tier: 'flagship'  },
      { id: 'gpt-5-pro',             label: 'GPT-5 Pro',             context: 1000000, tier: 'flagship'  },
      // GPT-4o family
      { id: 'gpt-4o',                label: 'GPT-4o',                context: 128000,  tier: 'stable'    },
      // GPT-4.1 family
      { id: 'gpt-4.1',               label: 'GPT-4.1',               context: 1000000, tier: 'stable'    },
      { id: 'gpt-4.1-mini',          label: 'GPT-4.1 Mini',          context: 1000000, tier: 'efficient' },
      { id: 'gpt-4.1-nano',          label: 'GPT-4.1 Nano',          context: 1000000, tier: 'efficient' },
      // o-series reasoning
      { id: 'o3',                    label: 'o3 (Deep Reasoning)',    context: 200000,  tier: 'reasoning' },
      { id: 'o4-mini',               label: 'o4-mini (Reasoning)',    context: 200000,  tier: 'reasoning' },
      { id: 'o3-mini',               label: 'o3-mini (Reasoning)',    context: 200000,  tier: 'reasoning' },
      // Legacy
      { id: 'gpt-4-turbo',           label: 'GPT-4 Turbo',           context: 128000,  tier: 'legacy'    },
      { id: 'gpt-4',                 label: 'GPT-4',                 context: 8192,    tier: 'legacy'    },
      { id: 'gpt-3.5-turbo',         label: 'GPT-3.5 Turbo',         context: 16385,   tier: 'legacy'    },
      { id: 'gpt-3.5-turbo-16k',     label: 'GPT-3.5 Turbo 16K',     context: 16385,   tier: 'legacy'    },
    ],
    capabilities: ['webSearch', 'codeInterpreter', 'imageGeneration', 'canvas', 'fileSearch'],
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    label:  'Anthropic (Claude)',
    icon:   '🟠',
    models: [
      { id: 'claude-opus-4-6',            label: 'Claude Opus 4.6',  context: 200000, tier: 'flagship'  },
      { id: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6',context: 200000, tier: 'flagship'  },
      { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5', context: 200000, tier: 'efficient' },
    ],
    capabilities: ['fileSearch'],
    envKey: 'ANTHROPIC_API_KEY',
  },
  google: {
    label:  'Google Gemini',
    icon:   '🔵',
    models: [
      { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   context: 1000000, tier: 'flagship'  },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', context: 1000000, tier: 'efficient' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', context: 1000000, tier: 'stable'    },
      { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro',   context: 1000000, tier: 'stable'    },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', context: 1000000, tier: 'stable'    },
    ],
    capabilities: [],
    envKey: 'GOOGLE_API_KEY',
  },
  custom: {
    label:        'Custom / OpenAI-Compatible',
    icon:         '⚙️',
    models:       [],
    capabilities: [],
    envKey:       null,
  },
};

// ── Capabilities that can be toggled per-bot ──────────────────
export const BOT_CAPABILITIES = {
  webSearch: {
    label:       '🌐 Web Search',
    description: 'Bot dapat menelusuri internet untuk info terkini',
    providers:   ['openai'],
    tool:        { type: 'web_search_preview' },
  },
  codeInterpreter: {
    label:       '💻 Code Interpreter',
    description: 'Bot dapat menulis dan menjalankan kode Python untuk analisis data',
    providers:   ['openai'],
    tool:        { type: 'code_interpreter' },
  },
  imageGeneration: {
    label:       '🎨 Image Generation',
    description: 'Bot dapat membuat gambar menggunakan DALL-E',
    providers:   ['openai'],
    requiresKey: 'OPENAI_API_KEY',
  },
  fileSearch: {
    label:       '📂 File Search (RAG)',
    description: 'Bot dapat mencari melalui file yang di-upload (vector search)',
    providers:   ['openai', 'anthropic'],
    tool:        { type: 'file_search' },
  },
};

// ─────────────────────────────────────────────────────────────
// Helper: Detect non-chat models (instruct / completions only)
// These are NOT supported by v1/chat/completions endpoint
// ─────────────────────────────────────────────────────────────
const NON_CHAT_PATTERNS = [
  /instruct/i,
  /davinci/i,
  /curie/i,
  /babbage/i,
  /ada/i,
  /embedding/i,
  /whisper/i,
  /tts/i,
  /dall-e/i,
  /transcribe/i,
  /search/i,
];

function isChatModel(model) {
  return !NON_CHAT_PATTERNS.some(p => p.test(model));
}

// ─────────────────────────────────────────────────────────────
// Helper: Detect which parameter convention a model uses
// ─────────────────────────────────────────────────────────────

/**
 * Models that use `max_completion_tokens` instead of `max_tokens`:
 *   - All GPT-5.x variants (gpt-5, gpt-5.1, gpt-5.2, gpt-5-pro, gpt-5-mini, etc.)
 *   - All o-series reasoning models (o1, o3, o4, o4-mini, o3-mini, etc.)
 *
 * Models that do NOT support `temperature`:
 *   - o-series reasoning models only
 */
function getModelParams(model, temp, maxTok) {
  const isReasoningModel = /^o\d/.test(model);   // o1, o3, o4, o3-mini, o4-mini
  const isGpt5Plus       = /^gpt-5/.test(model);  // gpt-5, gpt-5.1, gpt-5.2, gpt-5-mini, gpt-5-nano

  // GPT-5+ and o-series both use max_completion_tokens
  const useCompletionTokens = isReasoningModel || isGpt5Plus;

  // GPT-5+ only supports temperature = 1 (default), so we omit it entirely.
  // o-series reasoning models also do not support temperature.
  const omitTemperature = isReasoningModel || isGpt5Plus;

  const params = {};

  if (useCompletionTokens) {
    params.max_completion_tokens = maxTok;
  } else {
    params.max_tokens = maxTok;
  }

  if (!omitTemperature) {
    params.temperature = temp;
  }

  return params;
}

// ─────────────────────────────────────────────────────────────
// MAIN SERVICE
// ─────────────────────────────────────────────────────────────
class AIProviderService {

  getApiKey(providerConfig) {
    if (providerConfig?.apiKey?.trim()) return providerConfig.apiKey.trim();
    const catalog = AI_PROVIDERS[providerConfig?.provider];
    if (catalog?.envKey) return process.env[catalog.envKey] || '';
    return '';
  }

  /**
   * Build OpenAI tools array based on bot capabilities config
   */
  //buildTools(providerConfig, capabilities = {}) {
 //   if (providerConfig?.provider !== 'openai') return undefined;

 //   const tools = [];
 //   const model = providerConfig?.model || '';

    // Web Search — supported on gpt-4o, gpt-4.1+, gpt-5+, o-series
//    const supportsWebSearch = capabilities.webSearch &&
  //    (model.includes('4.1') || model.startsWith('gpt-5') || /^o\d/.test(model) || model.includes('4o'));
   // if (supportsWebSearch) {
    //  tools.push({ type: 'web_search_preview' });
   // }

    // Code Interpreter
 //   if (capabilities.codeInterpreter) {
 //     tools.push({ type: 'code_interpreter', container: { type: 'auto' } });
 //   }
  buildTools(providerConfig, capabilities = {}) {
    // Kita kembalikan undefined (kosong) karena provider Anda
    // hanya mendukung type 'function', bukan native tools OpenAI.
    return undefined;
  }

  /**
   * Route to correct provider and return { text, usage }
   */
  async generateCompletion({ providerConfig = {}, systemPrompt, messages, userContent, capabilities = {} }) {
    const provider = providerConfig?.provider || 'openai';
    const model    = providerConfig?.model    || 'gpt-4o';
    const temp     = providerConfig?.temperature ?? 0.1;
    const maxTok   = providerConfig?.maxTokens   ?? 2000;
    const apiKey   = this.getApiKey(providerConfig);
    const endpoint = providerConfig?.endpoint?.trim() || '';

    if (!apiKey && provider !== 'custom') {
      throw new Error(
        `API Key untuk provider "${provider}" tidak ditemukan. ` +
        `Tambahkan di konfigurasi bot atau di .env (${AI_PROVIDERS[provider]?.envKey}).`
      );
    }

    switch (provider) {
      case 'openai':
        return this._callOpenAI({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint, capabilities });
      case 'anthropic':
        return this._callAnthropic({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent });
      case 'google':
        return this._callGemini({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent });
      case 'custom':
        return this._callCustom({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint });
      default:
        throw new Error(`Provider tidak dikenal: ${provider}`);
    }
  }

  // ── OpenAI ─────────────────────────────────────────────────
  async _callOpenAI({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint, capabilities = {} }) {
    // Guard: reject non-chat models early with a clear message
    if (!isChatModel(model)) {
      throw new Error(
        `Model "${model}" tidak didukung untuk chat (bukan chat model). ` +
        `Ubah model di konfigurasi bot — gunakan gpt-4o, gpt-4.1, atau gpt-5.`
      );
    }

    const clientConfig = { apiKey };
    if (endpoint) clientConfig.baseURL = endpoint;
    const openai = new OpenAI(clientConfig);

    const tools      = this.buildTools({ provider: 'openai', model }, capabilities);
    const tokenParams = getModelParams(model, temp, maxTok);

    const body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userContent },
      ],
      ...tokenParams,
    };

    if (tools) body.tools = tools;

    const completion = await openai.chat.completions.create(body);

    // Handle tool call responses (web search returns tool_calls first)
    const choice = completion.choices[0];

    // Debug: log raw response shape when content is empty
    if (!choice?.message?.content) {
      console.warn(`[AI DEBUG] model=${model} finish_reason=${choice?.finish_reason} message_keys=${Object.keys(choice?.message || {}).join(',')}`);
      if (choice?.message?.refusal) console.warn(`[AI DEBUG] refusal: ${choice.message.refusal}`);
      // Log full completion for deep inspection (truncated)
      console.warn('[AI DEBUG] raw completion:', JSON.stringify(completion).substring(0, 800));
    }

    // Primary: chat completions content
    let text = choice?.message?.content || '';

    // Fallback 1: Responses API style — completion.output array (GPT-5 variants)
    if (!text && completion.output) {
      text = (completion.output || [])
        .filter(o => o.type === 'message')
        .flatMap(o => o.content || [])
        .filter(c => c.type === 'output_text' || c.type === 'text')
        .map(c => c.text || c.output_text || '')
        .join('') || '';
    }

    // Fallback 2: tool_calls follow-up (web search etc.)
    if (!text && choice?.finish_reason === 'tool_calls' && choice?.message?.tool_calls) {
      const followUp = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: userContent },
          choice.message,
          ...choice.message.tool_calls.map(tc => ({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ status: 'ok', results: [] }),
          })),
        ],
        ...tokenParams,
      });
      text = followUp.choices[0]?.message?.content || '';
    }

    return { text, usage: completion.usage };
  }

  // ── Anthropic Claude ───────────────────────────────────────
  async _callAnthropic({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent }) {
    const userText = Array.isArray(userContent)
      ? userContent.map(b => b.text || '').join('\n')
      : String(userContent);

    const anthropicMessages = [];
    for (const m of messages.slice(-6)) {
      if (m.role === 'user' || m.role === 'assistant') {
        anthropicMessages.push({ role: m.role, content: m.content });
      }
    }
    anthropicMessages.push({ role: 'user', content: userText });

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model, max_tokens: maxTok, temperature: temp, system: systemPrompt, messages: anthropicMessages },
      {
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        timeout: 60000,
      }
    );

    const text = response.data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    return { text, usage: response.data.usage };
  }

  // ── Google Gemini ──────────────────────────────────────────
  async _callGemini({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent }) {
    const userText = Array.isArray(userContent)
      ? userContent.map(b => b.text || '').join('\n')
      : String(userContent);

    const contents = [];
    for (const m of messages.slice(-6)) {
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    }
    contents.push({ role: 'user', parts: [{ text: userText }] });

    const ep = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await axios.post(
      ep,
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: temp, maxOutputTokens: maxTok },
      },
      { timeout: 60000 }
    );

    const text = response.data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    return { text, usage: response.data.usageMetadata };
  }

  // ── Custom / OpenAI-compatible ─────────────────────────────
  async _callCustom({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint }) {
    if (!endpoint) throw new Error('Custom provider membutuhkan endpoint URL');
    const userText = Array.isArray(userContent)
      ? userContent.map(b => b.text || '').join('\n')
      : String(userContent);

    const openai = new OpenAI({ apiKey: apiKey || 'none', baseURL: endpoint });
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userText },
      ],
      temperature: temp,
      max_tokens: maxTok,
    });

    return { text: completion.choices[0].message.content, usage: completion.usage };
  }

  async testConnection(providerConfig) {
    try {
      const result = await this.generateCompletion({
        providerConfig,
        systemPrompt: 'You are a test assistant.',
        messages: [],
        userContent: 'Reply with exactly: "Connection OK"',
      });
      return { ok: true, message: result.text?.substring(0, 100), model: providerConfig.model };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
}

export default new AIProviderService();
