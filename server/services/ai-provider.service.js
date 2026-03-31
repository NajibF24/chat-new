import OpenAI from 'openai';
import axios  from 'axios';

// ── Provider & Model Catalogs ─────────────────────────────────
export const AI_PROVIDERS = {
  openai: {
    label:  'OpenAI',
    icon:   '🟢',
    models: [
      { id: 'gpt-5.2',               label: 'GPT-5.2',               context: 1000000, tier: 'flagship',  webSearch: true  },
      { id: 'gpt-5.1',               label: 'GPT-5.1',               context: 1000000, tier: 'flagship',  webSearch: true  },
      { id: 'gpt-5',                 label: 'GPT-5',                 context: 1000000, tier: 'flagship',  webSearch: true  },
      { id: 'gpt-5-pro',             label: 'GPT-5 Pro',             context: 1000000, tier: 'flagship',  webSearch: true  },
      { id: 'gpt-4o',                label: 'GPT-4o',                context: 128000,  tier: 'stable',    webSearch: true  },
      { id: 'gpt-4.1',               label: 'GPT-4.1',               context: 1000000, tier: 'stable',    webSearch: true  },
      { id: 'gpt-4.1-mini',          label: 'GPT-4.1 Mini',          context: 1000000, tier: 'efficient', webSearch: true  },
      { id: 'gpt-4.1-nano',          label: 'GPT-4.1 Nano',          context: 1000000, tier: 'efficient', webSearch: true  },
      { id: 'o3',                    label: 'o3 (Deep Reasoning)',    context: 200000,  tier: 'reasoning', webSearch: false },
      { id: 'o4-mini',               label: 'o4-mini (Reasoning)',    context: 200000,  tier: 'reasoning', webSearch: false },
      { id: 'o3-mini',               label: 'o3-mini (Reasoning)',    context: 200000,  tier: 'reasoning', webSearch: false },
      { id: 'gpt-4-turbo',           label: 'GPT-4 Turbo',           context: 128000,  tier: 'legacy',    webSearch: false },
      { id: 'gpt-4',                 label: 'GPT-4',                 context: 8192,    tier: 'legacy',    webSearch: false },
      { id: 'gpt-3.5-turbo',         label: 'GPT-3.5 Turbo',         context: 16385,   tier: 'legacy',    webSearch: false },
      { id: 'gpt-3.5-turbo-16k',     label: 'GPT-3.5 Turbo 16K',     context: 16385,   tier: 'legacy',    webSearch: false },
    ],
    capabilities: ['webSearch', 'codeInterpreter', 'imageGeneration', 'canvas', 'fileSearch'],
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    label:  'Anthropic (Claude)',
    icon:   '🟠',
    // NOTE: Claude models do NOT support Web Search capability.
    // Citations will be provided via the fallback Bing/SerpAPI system.
    models: [
      { id: 'claude-opus-4-6',            label: 'Claude Opus 4.6',  context: 200000, tier: 'flagship',  webSearch: false },
      { id: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6',context: 200000, tier: 'flagship',  webSearch: false },
      { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5', context: 200000, tier: 'efficient', webSearch: false },
    ],
    capabilities: ['fileSearch'],
    envKey: 'ANTHROPIC_API_KEY',
  },
  google: {
    label:  'Google Gemini',
    icon:   '🔵',
    // NOTE: Gemini models do NOT support the Web Search capability toggle.
    // Citations will be provided via the fallback Bing/SerpAPI system.
    models: [
      { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   context: 1000000, tier: 'flagship',  webSearch: false },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', context: 1000000, tier: 'efficient', webSearch: false },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', context: 1000000, tier: 'stable',    webSearch: false },
      { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro',   context: 1000000, tier: 'stable',    webSearch: false },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', context: 1000000, tier: 'stable',    webSearch: false },
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

export const BOT_CAPABILITIES = {
  webSearch: {
    label:       '🌐 Web Search',
    description: 'Bot can browse the internet for up-to-date information',
    // ⚠️ Web Search (Responses API) is only natively supported by OpenAI GPT models (not o-series, not Claude, not Gemini).
    // For non-OpenAI providers, citations are provided via the Bing/SerpAPI fallback in ai-core.service.js.
    providers:   ['openai'],
    tool:        { type: 'web_search_preview' },
  },
  codeInterpreter: {
    label:       '💻 Code Interpreter',
    description: 'Bot can write and execute Python code for data analysis',
    providers:   ['openai'],
    tool:        { type: 'code_interpreter' },
  },
  imageGeneration: {
    label:       '🎨 Image Generation',
    description: 'Bot can create images using DALL-E',
    providers:   ['openai'],
    requiresKey: 'OPENAI_API_KEY',
  },
  fileSearch: {
    label:       '📂 File Search (RAG)',
    description: 'Bot can search through uploaded files using vector search',
    providers:   ['openai', 'anthropic'],
    tool:        { type: 'file_search' },
  },
};

const NON_CHAT_PATTERNS = [
  /instruct/i, /davinci/i, /curie/i, /babbage/i, /ada/i,
  /embedding/i, /whisper/i, /tts/i, /dall-e/i, /transcribe/i, /search/i,
];

function isChatModel(model) {
  return !NON_CHAT_PATTERNS.some(p => p.test(model));
}

function getModelParams(model, temp, maxTok) {
  const isReasoningModel    = /^o\d/.test(model);
  const isGpt5Plus          = /^gpt-5/.test(model);
  const useCompletionTokens = isReasoningModel || isGpt5Plus;
  const omitTemperature     = isReasoningModel || isGpt5Plus;

  const params = {};
  if (useCompletionTokens) { params.max_completion_tokens = maxTok; }
  else                     { params.max_tokens = maxTok; }
  if (!omitTemperature)    { params.temperature = temp; }
  return params;
}

// ─────────────────────────────────────────────────────────────
// CITATIONS BLOCK
// Format used by ChatMessage.jsx to render the clickable sources panel.
// MUST use these exact delimiters — the frontend splits on them.
// ─────────────────────────────────────────────────────────────

function buildCitationsBlock(citations) {
  if (!citations || citations.length === 0) return '';
  // Payload is a JSON array of { url, title } objects
  const payload = citations.map(c => ({ url: c.url, title: c.title || c.url }));
  return `\n\n<!--CITATIONS_START-->\n${JSON.stringify(payload)}\n<!--CITATIONS_END-->`;
}

// ─────────────────────────────────────────────────────────────
// EXTRACT CITATIONS FROM OPENAI ANNOTATIONS
// OpenAI Responses API returns url_citation annotations
// ─────────────────────────────────────────────────────────────

function extractCitationsFromAnnotations(message) {
  const citations = [];
  const seenUrls  = new Set();

  if (!message) return citations;

  // OpenAI Responses API style (content is array of parts)
  const contentParts = Array.isArray(message.content) ? message.content : [];
  for (const part of contentParts) {
    const annotations = part?.annotations || [];
    for (const ann of annotations) {
      if (ann.type === 'url_citation' && ann.url_citation?.url) {
        const { url, title } = ann.url_citation;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          citations.push({ url, title: title || url });
        }
      }
    }
  }

  // OpenAI Chat Completions style (message.annotations at root)
  const rootAnnotations = message.annotations || [];
  for (const ann of rootAnnotations) {
    if (ann.type === 'url_citation' && ann.url_citation?.url) {
      const { url, title } = ann.url_citation;
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        citations.push({ url, title: title || url });
      }
    }
  }

  return citations;
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

  async generateCompletion({ providerConfig = {}, systemPrompt, messages, userContent, capabilities = {} }) {
    const provider = providerConfig?.provider || 'openai';
    const model    = providerConfig?.model    || 'gpt-4o';
    const temp     = providerConfig?.temperature ?? 0.1;
    const maxTok   = providerConfig?.maxTokens   ?? 2000;
    const apiKey   = this.getApiKey(providerConfig);
    const endpoint = providerConfig?.endpoint?.trim() || '';

    if (!apiKey && provider !== 'custom') {
      throw new Error(
        `API Key for provider "${provider}" not found. ` +
        `Add it in the bot configuration or in .env (${AI_PROVIDERS[provider]?.envKey}).`
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
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  // ── OpenAI ─────────────────────────────────────────────────
  async _callOpenAI({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint, capabilities = {} }) {
    if (!isChatModel(model)) {
      throw new Error(
        `Model "${model}" is not supported for chat. ` +
        `Please change the model in the bot configuration.`
      );
    }

    const clientConfig = { apiKey };
    if (endpoint) clientConfig.baseURL = endpoint;
    const openai = new OpenAI(clientConfig);

    const tokenParams = getModelParams(model, temp, maxTok);

    // ── Web Search via Responses API ──────────────────────────
    // Supported on GPT-4o, GPT-4.1, GPT-5 series.
    // NOT supported on o-series reasoning models.
    // The Responses API returns url_citation annotations with real, clickable URLs.
    if (capabilities?.webSearch) {
      const isReasoningModel = /^o\d/.test(model);
      if (isReasoningModel) {
        console.warn(`[OpenAI] Web search not supported for reasoning model "${model}" — skipping.`);
      } else {
        try {
          const inputMessages = [
            { role: 'system', content: systemPrompt },
            ...messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: typeof userContent === 'string' ? userContent : JSON.stringify(userContent) },
          ];

          const responsesBody = {
            model,
            input: inputMessages,
            tools: [{ type: 'web_search_preview' }],
            ...tokenParams,
          };

          const response = await openai.responses.create(responsesBody);

          // Extract text and annotations from output
          let text = '';
          const allAnnotations = [];

          for (const output of (response.output || [])) {
            if (output.type === 'message') {
              for (const part of (output.content || [])) {
                if (part.type === 'output_text' || part.type === 'text') {
                  text += (part.text || part.output_text || '');
                  for (const ann of (part.annotations || [])) {
                    if (ann.type === 'url_citation' && ann.url_citation?.url) {
                      allAnnotations.push(ann);
                    }
                  }
                }
              }
            }
          }

          // Build deduplicated citations
          const seenUrls  = new Set();
          const citations = [];
          for (const ann of allAnnotations) {
            const { url, title } = ann.url_citation;
            if (!seenUrls.has(url)) {
              seenUrls.add(url);
              citations.push({ url, title: title || url });
            }
          }

          // Append citations block using the standard delimiter
          if (citations.length > 0) {
            text += buildCitationsBlock(citations);
          }

          return { text, usage: response.usage, citations };

        } catch (responsesErr) {
          console.warn('[OpenAI] Responses API web search failed, falling back to chat completions:', responsesErr.message);
          // Fall through to standard chat completions below
        }
      }
    }

    // ── Standard Chat Completions ─────────────────────────────
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
    }

    let text = choice?.message?.content || '';

    // Fallback: Responses API style output array
    if (!text && completion.output) {
      text = (completion.output || [])
        .filter(o => o.type === 'message')
        .flatMap(o => o.content || [])
        .filter(c => c.type === 'output_text' || c.type === 'text')
        .map(c => c.text || c.output_text || '')
        .join('') || '';
    }

    // Fallback: tool_calls follow-up
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

    // Check for annotations in newer chat completions responses
    const completionCitations = extractCitationsFromAnnotations(choice?.message);
    if (completionCitations.length > 0) {
      text += buildCitationsBlock(completionCitations);
    }

    return { text, usage: completion.usage };
  }

  // ── Anthropic Claude ───────────────────────────────────────
  // NOTE: Web Search capability is NOT supported natively.
  // Citations will be appended by the Bing/SerpAPI fallback in ai-core.service.js.
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
  // NOTE: Web Search capability is NOT supported natively.
  // Citations will be appended by the Bing/SerpAPI fallback in ai-core.service.js.
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
    if (!endpoint) throw new Error('Custom provider requires an endpoint URL');
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