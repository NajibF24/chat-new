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
  // ── UPDATED: Custom now supports Azure OpenAI + any OpenAI-compatible ──
  custom: {
    label:        'Custom / Azure / AWS (OpenAI-Compatible)',
    icon:         '⚙️',
    models:       [],
    capabilities: [],
    envKey:       null,
    description:  'Works with Azure OpenAI, AWS Bedrock (OpenAI-compatible), Ollama, LM Studio, etc.',
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
// ✅ NEW: Detect if endpoint is Azure OpenAI
// Azure endpoints look like: https://{resource}.openai.azure.com/
// ─────────────────────────────────────────────────────────────
function isAzureEndpoint(endpoint = '') {
  return endpoint.includes('.openai.azure.com');
}

// ─────────────────────────────────────────────────────────────
// ✅ NEW: Detect if endpoint is AWS Bedrock OpenAI-compatible
// e.g.: https://{gateway-id}.lambda-url.{region}.on.aws/
// or any non-Azure custom endpoint
// ─────────────────────────────────────────────────────────────
function isAwsEndpoint(endpoint = '') {
  return endpoint.includes('.amazonaws.com') ||
         endpoint.includes('.lambda-url.') ||
         endpoint.includes('.on.aws');
}

// ─────────────────────────────────────────────────────────────
// Normalize usage object to a consistent shape
// ─────────────────────────────────────────────────────────────
export function normalizeUsage(rawUsage, provider = 'openai', model = '') {
  if (!rawUsage) return null;

  let prompt     = 0;
  let completion = 0;
  let total      = 0;
  let reasoning  = null;

  if (provider === 'anthropic') {
    prompt     = rawUsage.input_tokens  ?? 0;
    completion = rawUsage.output_tokens ?? 0;
    total      = prompt + completion;

  } else if (provider === 'google') {
    prompt     = rawUsage.promptTokenCount     ?? 0;
    completion = rawUsage.candidatesTokenCount ?? 0;
    total      = rawUsage.totalTokenCount       ?? (prompt + completion);

  } else {
    // OpenAI / Custom / Azure — all follow same schema
    prompt     = rawUsage.prompt_tokens     ?? 0;
    completion = rawUsage.completion_tokens ?? 0;
    total      = rawUsage.total_tokens       ?? (prompt + completion);

    const rt = rawUsage.completion_tokens_details?.reasoning_tokens;
    if (rt != null) reasoning = rt;
  }

  const isReasoningModel = /^o\d/.test(model);
  const warningMaxTokens = isReasoningModel && reasoning != null
    ? reasoning >= (completion * 0.9)
    : false;

  return {
    prompt_tokens:     prompt,
    completion_tokens: completion,
    total_tokens:      total,
    ...(reasoning !== null && { reasoning_tokens: reasoning }),
    warningMaxTokens,
    provider,
  };
}

// ─────────────────────────────────────────────────────────────
// Helper: model parameter convention
// ─────────────────────────────────────────────────────────────
function getModelParams(model, temp, maxTok) {
  const isReasoningModel = /^o\d/.test(model);
  const isGpt5Plus       = /^gpt-5/.test(model);
  const useCompletionTokens = isReasoningModel || isGpt5Plus;
  const omitTemperature     = isReasoningModel || isGpt5Plus;

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

  buildTools(providerConfig, capabilities = {}) {
    const provider = providerConfig?.provider || 'openai';
    const tools = [];

    // ── Web Search (OpenAI only) ──────────────────────────────
    // Uses OpenAI's built-in web_search_preview tool.
    // When enabled, OpenAI performs real-time web search and returns
    // grounded results with actual URLs from the search results.
    if (capabilities.webSearch && provider === 'openai') {
      tools.push({ type: 'web_search_preview' });
    }

    // ── Code Interpreter (OpenAI only) ────────────────────────
    if (capabilities.codeInterpreter && provider === 'openai') {
      tools.push({ type: 'code_interpreter' });
    }

    return tools.length > 0 ? tools : undefined;
  }

  /**
   * Route to correct provider and return { text, usage }
   *
   * ✅ PATCH v1.3.0: Added `timeout` and `maxTokens` params so callers
   * (e.g. _handlePptCommand) can override the defaults for long-running tasks.
   */
  async generateCompletion({ providerConfig = {}, systemPrompt, messages, userContent, capabilities = {}, timeout, maxTokens }) {
    const provider   = providerConfig?.provider || 'openai';
    const model      = providerConfig?.model    || 'gpt-4o';
    const temp       = providerConfig?.temperature ?? 0.1;
    // ✅ caller's maxTokens takes priority over providerConfig, then falls back to 2000
    const maxTok     = maxTokens ?? providerConfig?.maxTokens ?? 2000;
    // ✅ caller's timeout takes priority, default 60s for normal calls
    const reqTimeout = timeout ?? 60000;
    const apiKey     = this.getApiKey(providerConfig);
    const endpoint   = providerConfig?.endpoint?.trim() || '';

    if (!apiKey && provider !== 'custom') {
      throw new Error(
        `API Key untuk provider "${provider}" tidak ditemukan. ` +
        `Tambahkan di konfigurasi bot atau di .env (${AI_PROVIDERS[provider]?.envKey}).`
      );
    }

    // ✅ Custom provider: auto-detect Azure vs generic
    if (provider === 'custom') {
      if (isAzureEndpoint(endpoint)) {
        return this._callAzureOpenAI({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint, providerConfig, timeout: reqTimeout });
      } else {
        return this._callCustom({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint, timeout: reqTimeout });
      }
    }

    switch (provider) {
      case 'openai':
        return this._callOpenAI({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint, capabilities, timeout: reqTimeout });
      case 'anthropic':
        return this._callAnthropic({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, timeout: reqTimeout });
      case 'google':
        return this._callGemini({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, timeout: reqTimeout });
      default:
        throw new Error(`Provider tidak dikenal: ${provider}`);
    }
  }

  // ── OpenAI ─────────────────────────────────────────────────
  // ✅ FIX: web_search_preview is only available via the Responses API
  // (openai.responses.create), NOT via Chat Completions.
  // When webSearch capability is enabled, we route to _callOpenAIResponses.
  // For all other cases, we use the standard Chat Completions API.
  async _callOpenAI({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint, capabilities = {}, timeout = 60000 }) {
    if (!isChatModel(model)) {
      throw new Error(
        `Model "${model}" tidak didukung untuk chat (bukan chat model). ` +
        `Ubah model di konfigurasi bot — gunakan gpt-4o, gpt-4.1, atau gpt-5.`
      );
    }

    const clientConfig = { apiKey };
    if (endpoint) clientConfig.baseURL = endpoint;
    clientConfig.timeout = timeout;
    const openai = new OpenAI(clientConfig);

    // ── Route to Responses API when web search is enabled ─────
    if (capabilities.webSearch) {
      return this._callOpenAIWithWebSearch({ openai, model, maxTok, systemPrompt, messages, userContent });
    }

    // ── Standard Chat Completions (no web search) ─────────────
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

    const completion = await openai.chat.completions.create(body);
    const choice     = completion.choices[0];

    if (!choice?.message?.content) {
      console.warn(`[AI DEBUG] model=${model} finish_reason=${choice?.finish_reason}`);
      if (choice?.message?.refusal) console.warn(`[AI DEBUG] refusal: ${choice.message.refusal}`);
    }

    let text = choice?.message?.content || '';

    // Fallback: Responses API style (GPT-5 variants)
    if (!text && completion.output) {
      text = (completion.output || [])
        .filter(o => o.type === 'message')
        .flatMap(o => o.content || [])
        .filter(c => c.type === 'output_text' || c.type === 'text')
        .map(c => c.text || c.output_text || '')
        .join('') || '';
    }

    // Fallback: generic tool_calls follow-up (non-web-search tools)
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

    const usage = normalizeUsage(completion.usage, 'openai', model);
    return { text, usage };
  }

  // ── OpenAI Responses API (web_search_preview) ───────────────
  // The web_search_preview tool is ONLY available via the Responses API.
  // It performs real-time web search and returns grounded answers with
  // actual URLs from the search results — not fabricated links.
  //
  // Responses API input format:
  //   input: [ { role: 'user', content: '...' } ]  (no system message in messages)
  //   instructions: systemPrompt  (system prompt goes here)
  //   tools: [{ type: 'web_search_preview' }]
  //
  // The response contains output[] array with message items.
  async _callOpenAIWithWebSearch({ openai, model, maxTok, systemPrompt, messages, userContent }) {
    console.log(`[WebSearch] Using Responses API with web_search_preview for model=${model}`);

    // Build input array: history + current user message
    const userText = Array.isArray(userContent)
      ? userContent.map(b => b.text || '').join('\n')
      : String(userContent);

    const inputMessages = [
      ...messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText },
    ];

    const responseBody = {
      model,
      instructions: systemPrompt,
      input:        inputMessages,
      tools:        [{ type: 'web_search_preview' }],
      max_output_tokens: maxTok,
    };

    let response;
    try {
      // openai.responses is available in SDK >= 4.77.0
      // For older SDK versions, fall back to chat completions without web search
      if (typeof openai.responses?.create === 'function') {
        response = await openai.responses.create(responseBody);
      } else {
        console.warn('[WebSearch] openai.responses API not available in this SDK version. Falling back to chat completions without web search.');
        const fallback = await openai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userText },
          ],
          max_tokens: maxTok,
        });
        const text = fallback.choices[0]?.message?.content || '';
        const usage = normalizeUsage(fallback.usage, 'openai', model);
        return { text, usage };
      }
    } catch (err) {
      console.error(`[WebSearch] Responses API error: ${err.message}. Falling back to chat completions.`);
      const fallback = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: userText },
        ],
        max_tokens: maxTok,
      });
      const text = fallback.choices[0]?.message?.content || '';
      const usage = normalizeUsage(fallback.usage, 'openai', model);
      return { text, usage };
    }

    // Extract text from Responses API output
    const text = (response.output || [])
      .filter(o => o.type === 'message')
      .flatMap(o => o.content || [])
      .filter(c => c.type === 'output_text' || c.type === 'text')
      .map(c => c.text || c.output_text || '')
      .join('') || response.output_text || '';

    console.log(`[WebSearch] Response received (${text.length} chars)`);

    const usage = normalizeUsage(response.usage, 'openai', model);
    return { text, usage };
  }

  // ── ✅ NEW: Azure OpenAI ────────────────────────────────────
  // Azure uses deployment names instead of model IDs.
  // URL format: {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}
  async _callAzureOpenAI({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint, providerConfig, timeout = 120000 }) {
    if (!apiKey) {
      throw new Error('Azure OpenAI membutuhkan API Key. Masukkan di kolom "API Key" pada konfigurasi bot.');
    }
    if (!endpoint) {
      throw new Error('Azure OpenAI membutuhkan Endpoint URL. Contoh: https://resource-name.openai.azure.com/');
    }

    // model field = deployment name in Azure
    const deploymentName = model;
    // API version — use from config or default to a stable version
    const apiVersion = providerConfig?.apiVersion || '2024-12-01-preview';

    // Normalize endpoint (remove trailing slash)
    const baseEndpoint = endpoint.replace(/\/$/, '');

    // Azure OpenAI chat completions URL
    const azureUrl = `${baseEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

    const userText = Array.isArray(userContent)
      ? userContent.map(b => b.text || '').join('\n')
      : String(userContent);

    const body = {
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userText },
      ],
      temperature: temp,
      max_tokens:  maxTok,
    };

    console.log(`[Azure OpenAI] Calling deployment="${deploymentName}" api-version="${apiVersion}"`);

    let response;
    try {
      response = await axios.post(azureUrl, body, {
        headers: {
          'Content-Type':  'application/json',
          'api-key':       apiKey,  // Azure uses 'api-key' header, not 'Authorization: Bearer'
        },
        timeout, // ✅ PATCH: dynamic timeout
      });
    } catch (err) {
      const status  = err.response?.status;
      const errData = err.response?.data;
      const errMsg  = errData?.error?.message || errData?.message || err.message;

      if (status === 401) throw new Error(`Azure OpenAI: API Key tidak valid. (${errMsg})`);
      if (status === 404) throw new Error(`Azure OpenAI: Deployment "${deploymentName}" tidak ditemukan. Pastikan nama model/deployment sudah benar. (${errMsg})`);
      if (status === 429) throw new Error(`Azure OpenAI: Rate limit atau quota habis. (${errMsg})`);
      throw new Error(`Azure OpenAI error ${status || ''}: ${errMsg}`);
    }

    const text  = response.data.choices?.[0]?.message?.content || '';
    const usage = normalizeUsage(response.data.usage, 'custom', model);

    return { text, usage };
  }

  // ── Anthropic Claude ───────────────────────────────────────
  // ✅ PATCH v1.3.0: Added `timeout` param (was hardcoded 60000)
  async _callAnthropic({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, timeout = 60000 }) {
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
        timeout, // ✅ PATCH: was hardcoded 60000, now dynamic
      }
    );

    const text = response.data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    const usage = normalizeUsage(response.data.usage, 'anthropic', model);
    return { text, usage };
  }

  // ── Google Gemini ──────────────────────────────────────────
  // ✅ PATCH v1.3.0: Added `timeout` param (was hardcoded 60000)
  async _callGemini({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, timeout = 60000 }) {
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
      { timeout } // ✅ PATCH: was hardcoded 60000, now dynamic
    );

    const text = response.data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    const usage = normalizeUsage(response.data.usageMetadata, 'google', model);
    return { text, usage };
  }

  // ── ✅ IMPROVED: Custom / OpenAI-compatible (non-Azure) ────
  // Supports: Ollama, LM Studio, AWS Bedrock (OpenAI-compatible mode),
  //           Groq, Together AI, Mistral, etc.
  // ✅ PATCH v1.3.0: Added `timeout` param
  async _callCustom({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint, timeout = 60000 }) {
    if (!endpoint) throw new Error(
      'Custom provider membutuhkan Endpoint URL. ' +
      'Contoh Ollama: http://localhost:11434/v1 | ' +
      'Contoh AWS Bedrock: https://bedrock.{region}.amazonaws.com/...'
    );

    const userText = Array.isArray(userContent)
      ? userContent.map(b => b.text || '').join('\n')
      : String(userContent);

    // Use OpenAI SDK with custom baseURL — works for any OpenAI-compatible endpoint
    const openai = new OpenAI({
      apiKey:  apiKey || 'none', // some local servers don't require a key
      baseURL: endpoint,
      timeout, // ✅ PATCH: pass timeout to SDK
    });

    let completion;
    try {
      completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: userText },
        ],
        temperature: temp,
        max_tokens:  maxTok,
      });
    } catch (err) {
      const status = err.status || err.response?.status;
      const msg    = err.message || 'Unknown error';

      if (status === 401) throw new Error(`Custom endpoint: Unauthorized — cek API Key. (${msg})`);
      if (status === 404) throw new Error(`Custom endpoint: URL tidak ditemukan — cek Endpoint URL dan Model ID. (${msg})`);
      throw new Error(`Custom endpoint error: ${msg}`);
    }

    const text  = completion.choices?.[0]?.message?.content || '';
    const usage = normalizeUsage(completion.usage, 'custom', model);
    return { text, usage };
  }

  // ─────────────────────────────────────────────────────────────
  // ✅ NEW: generateImage — DALL-E 3 image generation
  //
  // @param {object} providerConfig  - bot.aiProvider config
  // @param {string} prompt          - image description prompt
  // @param {object} options         - { size, quality, style }
  // @returns {object}               - { imageUrl, revisedPrompt }
  //
  // Size options   : "1024x1024" | "1792x1024" | "1024x1792"
  // Quality options: "standard" | "hd"
  // Style options  : "vivid" | "natural"
  // ─────────────────────────────────────────────────────────────
  async generateImage(providerConfig, prompt, options = {}) {
    const apiKey = this.getApiKey(providerConfig);
    if (!apiKey) {
      throw new Error(
        'Image generation membutuhkan OpenAI API Key. ' +
        'Tambahkan OPENAI_API_KEY di .env atau di konfigurasi bot.'
      );
    }

    const provider = providerConfig?.provider || 'openai';
    if (provider !== 'openai') {
      throw new Error(
        `Image generation hanya tersedia untuk provider OpenAI (DALL-E). ` +
        `Provider saat ini: "${provider}".`
      );
    }

    const {
      size    = '1792x1024',  // landscape default — lebih cocok untuk industrial
      quality = 'hd',         // hd for detailed/realistic requests
      style   = 'vivid',      // vivid = dramatic/detailed, natural = softer
      n       = 1,
    } = options;

    const openai = new OpenAI({ apiKey, timeout: 120000 });

    console.log(`[ImageGen] Calling DALL-E 3 | size=${size} quality=${quality} style=${style}`);
    console.log(`[ImageGen] Prompt (${prompt.length} chars): ${prompt.substring(0, 100)}...`);

    let response;
    try {
      response = await openai.images.generate({
        model:   'dall-e-3',
        prompt,
        n,
        size,
        quality,
        style,
        response_format: 'url',
      });
    } catch (err) {
      const status = err.status || err.response?.status;
      const msg    = err.message || 'Unknown error';

      if (status === 400) {
        // Content policy violation
        if (msg.includes('content_policy') || msg.includes('safety')) {
          throw new Error(
            'Prompt ditolak oleh OpenAI content policy. ' +
            'Coba ubah deskripsi gambar — hindari konten yang sensitif atau terlalu spesifik tentang orang nyata.'
          );
        }
        throw new Error(`DALL-E error: ${msg}`);
      }
      if (status === 401) throw new Error('OpenAI API Key tidak valid untuk image generation.');
      if (status === 429) throw new Error('Rate limit OpenAI tercapai. Coba beberapa saat lagi.');
      if (status === 503 || msg.includes('timeout')) throw new Error('OpenAI image generation timeout. Coba lagi.');
      throw new Error(`Image generation gagal: ${msg}`);
    }

    const imageData    = response.data?.[0];
    const imageUrl     = imageData?.url;
    const revisedPrompt = imageData?.revised_prompt || prompt;

    if (!imageUrl) throw new Error('DALL-E tidak mengembalikan URL gambar.');

    console.log(`[ImageGen] Success — URL: ${imageUrl.substring(0, 80)}...`);
    return { imageUrl, revisedPrompt };
  }

  async testConnection(providerConfig) {
    try {
      const result = await this.generateCompletion({
        providerConfig,
        systemPrompt: 'You are a test assistant.',
        messages:     [],
        userContent:  'Reply with exactly: "Connection OK"',
      });
      return { ok: true, message: result.text?.substring(0, 100), model: providerConfig.model };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
}

export default new AIProviderService();