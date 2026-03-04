import OpenAI from 'openai';
import axios from 'axios';

// ── Provider Model Catalogs ───────────────────────────────────
export const AI_PROVIDERS = {
  openai: {
    label: 'OpenAI',
    icon: '🟢',
    models: [
      { id: 'gpt-4o',            label: 'GPT-4o (Recommended)',  context: 128000 },
      { id: 'gpt-4o-mini',       label: 'GPT-4o Mini (Fast)',     context: 128000 },
      { id: 'gpt-4-turbo',       label: 'GPT-4 Turbo',           context: 128000 },
      { id: 'gpt-3.5-turbo',     label: 'GPT-3.5 Turbo (Cheap)', context: 16385  },
    ],
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    icon: '🟠',
    models: [
      { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6 (Most Capable)', context: 200000 },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 (Balanced)',   context: 200000 },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fast)',        context: 200000 },
    ],
    envKey: 'ANTHROPIC_API_KEY',
  },
  google: {
    label: 'Google Gemini',
    icon: '🔵',
    models: [
      { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro (Best)',  context: 1000000 },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Fast)', context: 1000000 },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash',        context: 1000000 },
    ],
    envKey: 'GOOGLE_API_KEY',
  },
  custom: {
    label: 'Custom / OpenAI-Compatible',
    icon: '⚙️',
    models: [],
    envKey: null,
  },
};

// ─────────────────────────────────────────────────────────────
// MAIN SERVICE
// ─────────────────────────────────────────────────────────────
class AIProviderService {

  /**
   * Get effective API key: bot-level override → env fallback
   */
  getApiKey(providerConfig) {
    if (providerConfig?.apiKey?.trim()) return providerConfig.apiKey.trim();
    const catalog = AI_PROVIDERS[providerConfig?.provider];
    if (catalog?.envKey) return process.env[catalog.envKey] || '';
    return '';
  }

  /**
   * Route to correct provider and return { text, usage }
   */
  async generateCompletion({ providerConfig = {}, systemPrompt, messages, userContent }) {
    const provider = providerConfig?.provider || 'openai';
    const model    = providerConfig?.model    || 'gpt-4o';
    const temp     = providerConfig?.temperature ?? 0.1;
    const maxTok   = providerConfig?.maxTokens  ?? 2000;
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
        return this._callOpenAI({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint });
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
  async _callOpenAI({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent, endpoint }) {
    const clientConfig = { apiKey };
    if (endpoint) clientConfig.baseURL = endpoint;

    const openai = new OpenAI(clientConfig);

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userContent },
      ],
      temperature: temp,
      max_tokens: maxTok,
    });

    return {
      text:  completion.choices[0].message.content,
      usage: completion.usage,
    };
  }

  // ── Anthropic Claude ───────────────────────────────────────
  async _callAnthropic({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent }) {
    // Build user content string
    const userText = Array.isArray(userContent)
      ? userContent.map(b => b.text || '').join('\n')
      : String(userContent);

    // Convert history to Anthropic format (must alternate user/assistant)
    const anthropicMessages = [];
    const history = messages.slice(-6);
    for (const m of history) {
      if (m.role === 'user' || m.role === 'assistant') {
        anthropicMessages.push({ role: m.role, content: m.content });
      }
    }
    anthropicMessages.push({ role: 'user', content: userText });

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model,
        max_tokens: maxTok,
        temperature: temp,
        system: systemPrompt,
        messages: anthropicMessages,
      },
      {
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        timeout: 60000,
      }
    );

    const text = response.data.content
      ?.filter(b => b.type === 'text')
      .map(b => b.text)
      .join('') || '';

    return { text, usage: response.data.usage };
  }

  // ── Google Gemini ──────────────────────────────────────────
  async _callGemini({ apiKey, model, temp, maxTok, systemPrompt, messages, userContent }) {
    const userText = Array.isArray(userContent)
      ? userContent.map(b => b.text || '').join('\n')
      : String(userContent);

    // Build Gemini contents array (alternating user/model)
    const contents = [];
    const history  = messages.slice(-6);
    for (const m of history) {
      contents.push({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }
    contents.push({ role: 'user', parts: [{ text: userText }] });

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await axios.post(
      endpoint,
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature:     temp,
          maxOutputTokens: maxTok,
        },
      },
      { timeout: 60000 }
    );

    const text = response.data.candidates?.[0]?.content?.parts
      ?.map(p => p.text).join('') || '';

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

    return {
      text:  completion.choices[0].message.content,
      usage: completion.usage,
    };
  }

  /**
   * Test connectivity: returns { ok, message, model }
   */
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
