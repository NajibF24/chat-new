import express from 'express';
import multer from 'multer';
import path from 'path';
import AICoreService from '../services/ai-core.service.js';
import { generateImage } from '../services/image.service.js';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';
import Bot from '../models/Bot.js';
import Chat from '../models/Chat.js';
import Thread from '../models/Thread.js';
import AuditService from '../services/audit.service.js';
import BaileysService from '../services/baileys.service.js';
import AIProviderService, { normalizeUsage } from '../services/ai-provider.service.js';

const router = express.Router();

// Config Upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, 'data/files'); },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '---' + file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── Helper: detect reasoning/GPT-5 model ─────────────────────
const isReasoningModel = (model = '') => /^o\d/.test(model) || /^gpt-5/.test(model);

// ── Helper: forward chat log to WhatsApp via Baileys ─────────
async function sendToWaha(bot, username, userMessage, aiResponse) {
  if (!bot.wahaConfig?.enabled || !bot.wahaConfig?.chatId) return;
  try {
    const waText = [
      `🤖 *LOG CHAT BOT:* ${bot.name}`,
      `👤 *User:* ${username || 'Unknown'}`,
      `💬 *Question:*\n${userMessage}`,
      `🤖 *Answer:*\n${aiResponse}`,
    ].join('\n');

    const ok = await BaileysService.sendText(bot.wahaConfig.chatId, waText);
    if (ok) {
      console.log(`[WAHA] ✅ Forwarded to: ${bot.wahaConfig.chatId}`);
    } else {
      console.warn(`[WAHA] ⚠️ Could not forward to: ${bot.wahaConfig.chatId} (Baileys offline or forbidden)`);
    }
  } catch (err) {
    console.error('[WAHA] ❌ Forward failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ENDPOINTS
// ─────────────────────────────────────────────────────────────

// 1. Upload File
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    filename: req.file.filename, originalname: req.file.originalname,
    path: req.file.path, mimetype: req.file.mimetype,
    url: `/api/files/${req.file.filename}`, size: req.file.size,
  });
});

// 2. Get Bots
router.get('/bots', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await User.findById(userId).populate('assignedBots');
    if (user.isAdmin && (!user.assignedBots || user.assignedBots.length === 0)) {
      const allBots = await Bot.find({});
      return res.json(allBots);
    }
    res.json(user.assignedBots);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. Get Threads
router.get('/threads', requireAuth, async (req, res) => {
  try {
    const threads = await Thread.find({ userId: req.session.userId })
      .populate('botId', 'name').sort({ lastMessageAt: -1 });
    res.json(threads);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 4. Get Messages
router.get('/thread/:threadId', requireAuth, async (req, res) => {
  try {
    const chats = await Chat.find({ threadId: req.params.threadId }).sort({ createdAt: 1 });
    res.json(chats);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 5. Delete Thread
router.delete('/thread/:threadId', requireAuth, async (req, res) => {
  try {
    await Thread.findOneAndDelete({ _id: req.params.threadId, userId: req.session.userId });
    await Chat.deleteMany({ threadId: req.params.threadId });
    res.json({ message: 'Deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 6. Send Message — MAIN ENDPOINT
router.post('/message', requireAuth, async (req, res) => {
  try {
    const { message, botId, history, threadId } = req.body;
    const userId          = req.session.userId;
    const attachedFile    = req.body.attachedFile || null;
    const sessionUsername = req.session?.username;

    const bot       = await Bot.findById(botId).lean();
    const botName   = bot?.name                  || 'Unknown Bot';
    const model     = bot?.aiProvider?.model     || 'unknown';
    const provider  = bot?.aiProvider?.provider  || 'openai';
    const maxTokens = bot?.aiProvider?.maxTokens ?? 2000;

    // ── Image Generation ─────────────────────────────────────
    const cleanMsg = message ? message.trim().toLowerCase() : '';
    if (cleanMsg.startsWith('/image') || cleanMsg.startsWith('/img') || cleanMsg.startsWith('gambarkan')) {
      try {
        let prompt = message.replace(/^\/image|^\/img|^gambarkan/i, '').trim();
        if (!prompt) prompt = 'High quality industrial steel art';

        const imageUrl = await generateImage(prompt);
        const markdownResponse = `![${prompt}](${imageUrl})\n\n*Generated for: "${prompt}"*`;

        let targetThreadId = threadId;
        if (!targetThreadId) {
          const newThread = new Thread({ userId, botId, title: prompt.substring(0, 30), lastMessageAt: new Date() });
          await newThread.save();
          targetThreadId = newThread._id;
        }

        await new Chat({ userId, botId, threadId: targetThreadId, role: 'user', content: message }).save();
        await new Chat({ userId, botId, threadId: targetThreadId, role: 'assistant', content: markdownResponse }).save();

        await AuditService.log({
          req, category: 'chat', action: 'IMAGE_GENERATE',
          targetId: botId, targetName: botName,
          detail: { prompt: prompt.substring(0, 100), model: 'dall-e', provider: 'openai' },
          username: sessionUsername,
        });

        return res.json({ response: markdownResponse, threadId: targetThreadId });
      } catch (imgError) {
        console.error('Image Service Error:', imgError);
        return res.status(500).json({ error: 'Gagal membuat gambar: ' + imgError.message });
      }
    }

    // ── Normal AI Message ────────────────────────────────────
    const startTime = Date.now();
    const result = await AICoreService.processMessage({
      userId, botId, message, attachedFile, threadId,
      history: (history || []).map(m => ({ role: m.role, content: m.content })),
    });
    const durationMs = Date.now() - startTime;

    // ── WAHA Forward (fire & forget) ─────────────────────────
    sendToWaha(bot, sessionUsername, message, result?.response || '');

    // ── Audit Log ────────────────────────────────────────────
    const usage = normalizeUsage(result?.usage, model);
    const auditDetail = {
      bot: botName, model, provider, durationMs, maxTokensConfig: maxTokens,
      tokens: usage ? {
        prompt:     usage.prompt_tokens,
        completion: usage.completion_tokens,
        total:      usage.total_tokens,
        ...(usage.reasoning_tokens != null && { reasoning: usage.reasoning_tokens }),
        provider:   usage.provider,
      } : null,
      ...(usage?.warningMaxTokens && {
        warning: `⚠️ Reasoning tokens (${usage.reasoning_tokens}) used most of max_tokens (${maxTokens}). Increase to at least ${Math.ceil(maxTokens * 2)}.`,
      }),
      ...(!result?.response?.trim() && {
        emptyResponse: true,
        emptyReason: usage?.warningMaxTokens ? 'max_tokens_exhausted_by_reasoning' : 'unknown',
      }),
    };

    await AuditService.log({
      req, category: 'chat',
      action:  result?.response?.trim() ? 'AI_RESPONSE' : 'AI_RESPONSE_EMPTY',
      status:  result?.response?.trim() ? 'success'     : 'failed',
      targetId: botId, targetName: botName,
      detail: auditDetail, username: sessionUsername,
    });

    res.json(result);

  } catch (error) {
    console.error('Chat Error:', error);
    await AuditService.log({
      req, category: 'chat', action: 'AI_RESPONSE_ERROR', status: 'failed',
      targetName: req.body?.botId || 'unknown',
      detail: { error: error.message },
      username: req.session?.username,
    }).catch(() => {});
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 🔥 STREAMING ENDPOINT — Server-Sent Events (SSE)
// ============================================================
router.post('/message/stream', requireAuth, async (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable Nginx buffering
  });

  const sendSSE = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { message, botId, history, threadId: reqThreadId } = req.body;
    const userId       = req.session.userId;
    const attachedFile = req.body.attachedFile || null;

    const bot = await Bot.findById(botId).lean();
    if (!bot) { sendSSE('error', { error: 'Bot not found' }); res.end(); return; }

    // ── Determine if this bot/request needs the full processMessage pipeline ──
    // Smartsheet, special commands, file attachments, image generation,
    // and Knowledge Files all require the complete processMessage flow.
    const cleanMsg = (message || '').trim().toLowerCase();

    // Special commands — must match the same detectors as processMessage
    const isSpecial = cleanMsg.startsWith('/ppt') || cleanMsg.startsWith('/doc') ||
      cleanMsg.startsWith('/pdf') || cleanMsg.startsWith('/excel') ||
      cleanMsg.startsWith('/newsletter') || cleanMsg.startsWith('/openclaw') || cleanMsg.startsWith('/image') ||
      cleanMsg.startsWith('/img') || cleanMsg.startsWith('/slide') ||
      cleanMsg.startsWith('/presentation') || cleanMsg.startsWith('gambarkan');

    // ✅ Check for freeform generation commands (PPT, DOC, image gen patterns)
    const hasPptPattern = /\b(presentasi|presentation|powerpoint|ppt|slide)\b/i.test(cleanMsg) &&
      /\b(buat|buatkan|bikin|bikinkan|bikinin|create|generate|make|tolong|give me)\b/i.test(cleanMsg);
    const hasDocPattern = /\b(doc|docx|word)\b/i.test(cleanMsg);
    const hasPdfPattern = /\b(pdf)\b/i.test(cleanMsg);
    const hasExcelPattern = /\b(excel|xlsx|spreadsheet|tabel)\b/i.test(cleanMsg);
    const hasNewsletterPattern = /\b(newsletter|signal)\b/i.test(cleanMsg);
    const hasOpenClawPattern = /\b(openclaw|production report|l2 report|report produksi)\b/i.test(cleanMsg);
    const hasImageGenPattern = /^(create|generate|make|draw|buatkan?|buat|gambarkan|lukiskan|desainkan)\s+(a\s+|an\s+)?(image|photo|picture|illustration|gambar|foto|ilustrasi)/i.test(cleanMsg);

    const hasSmartsheet   = bot.smartsheetConfig?.enabled;
    const hasAttachment   = !!attachedFile;
    const hasKnowledge    = bot.knowledgeFiles?.length > 0 && bot.knowledgeMode !== 'disabled';

    // ✅ FIX: Route through processMessage for ANY complex pipeline requirement
    if (isSpecial || hasSmartsheet || hasAttachment || hasKnowledge ||
        hasPptPattern || hasDocPattern || hasPdfPattern || hasExcelPattern ||
        hasNewsletterPattern || hasOpenClawPattern || hasImageGenPattern) {
      const result = await AICoreService.processMessage({
        userId, botId, message, attachedFile, threadId: reqThreadId,
        history: (history || []).map(m => ({ role: m.role, content: m.content })),
      });
      sendSSE('token', { token: result.response });
      sendSSE('done', { threadId: result.threadId, attachedFiles: result.attachedFiles || [] });
      res.end();
      return;
    }

    // ── Pure streaming path ──
    // Only reaches here for plain chat bots without:
    // Smartsheet, Knowledge Files, attachments, or special commands.

    // Create / reuse thread
    let threadId = reqThreadId;
    if (!threadId) {
      const title     = message ? message.substring(0, 30) : `Chat with ${bot.name}`;
      const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
      await newThread.save();
      threadId = newThread._id;
    }

    // Build context from Kouventa / Azure Search
    let contextData = '';

    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
      try {
        const kouventa = new (await import('../services/kouventa.service.js')).default(
          bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint
        );
        const reply = await kouventa.generateResponse(message || '');
        contextData += `\n\n=== REFERENSI DOKUMEN INTERNAL ===\n${reply}\n`;
      } catch (e) { console.error('Kouventa Error:', e.message); }
    }

    if (bot.azureSearchConfig?.enabled && bot.azureSearchConfig?.apiKey && bot.azureSearchConfig?.endpoint) {
      try {
        const AzureSearchService = (await import('../services/azure-search.service.js')).default;
        const azureSearch = new AzureSearchService(
          bot.azureSearchConfig.apiKey, bot.azureSearchConfig.endpoint
        );
        const context = await azureSearch.generateResponse(message || '');
        if (context) contextData += `\n\n=== REFERENSI AZURE AI SEARCH ===\n${context}\n`;
      } catch (e) { console.error('Azure Search Error:', e.message); }
    }

    // ── Language detection (mirrors processMessage logic) ──
    const userMsg = (message || '').trim();
    const EN_SIGNALS = [
      'show','list','get','find','what','which','how','give','tell','display',
      'check','all','my','the','are','is','do','can','have','project','projects',
      'status','report','overview','summary','active','overdue','budget','issue',
      'where','me','for','by','with','without','from','to','and','or','not','in','on','at','of','a','an',
    ];
    const ID_SIGNALS = [
      'tampilkan','cari','lihat','semua','daftar','berikan','apa','siapa',
      'kapan','dimana','bagaimana','gimana','berapa','proyek','status','laporan',
      'aktif','selesai','terlambat','anggaran','masalah','kendala','dari','untuk',
      'dengan','tanpa','oleh','di','ke','dan','atau','tidak','bukan','yang','ini',
      'itu','adalah','ada','tolong','mohon','bisa','boleh',
    ];
    const lowerUserMsg = userMsg.toLowerCase();
    const enCount = EN_SIGNALS.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(lowerUserMsg)).length;
    const idCount = ID_SIGNALS.filter(w => lowerUserMsg.includes(w)).length;
    const isEnglishMsg = enCount >= 1 && enCount >= idCount;

    const langRule = isEnglishMsg
      ? `[LANGUAGE: The user is writing in ENGLISH. You MUST respond entirely in English. Do NOT use Indonesian.]`
      : `[BAHASA: Deteksi bahasa pesan terakhir user dan balas dengan bahasa yang SAMA PERSIS. Jika user nulis Bahasa Indonesia → balas Indonesia. Jika English → balas English. JANGAN campur bahasa.]`;

    // ── Grounding instruction ──
    const groundingInstruction = contextData
      ? 'Use the data and knowledge provided above to answer the user accurately. Do not hallucinate facts.'
      : '';

    // Build user content
    const userContent = [];
    if (message) userContent.push({ type: 'text', text: message });

    // Build system prompt (mirrors processMessage structure)
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const systemPrompt = [
      langRule,
      bot.prompt || bot.systemPrompt || '',
      `[TODAY: ${today}]`,
      contextData,
      groundingInstruction,
    ].filter(Boolean).join('\n\n');

    const providerConfig = { ...(bot.aiProvider || {}) };
    if (!providerConfig.provider) {
      providerConfig.provider = 'openai';
      providerConfig.model    = providerConfig.model || 'gpt-4o-mini';
    }

    // Filter capabilities to only those supported by current provider
    const PROVIDER_CAPS = { openai: ['webSearch','codeInterpreter','imageGeneration','canvas','fileSearch'], anthropic: ['fileSearch'], google: [], custom: [] };
    const allowedCaps = PROVIDER_CAPS[providerConfig.provider] || [];
    const rawCaps     = bot.capabilities || {};
    const filteredCaps = Object.fromEntries(
      Object.entries(rawCaps).filter(([k]) => allowedCaps.includes(k))
    );

    // ── Stream AI response ────────────────────────────
    const finalUserContent = userContent.length === 1 && userContent[0].type === 'text'
      ? userContent[0].text
      : userContent;

    let fullResponse = '';
    await AIProviderService.streamCompletion({
      providerConfig,
      systemPrompt,
      messages:    (history || []).slice(-6),
      userContent: finalUserContent,
      capabilities: filteredCaps,
      onToken: (token) => {
        fullResponse += token;
        sendSSE('token', { token });
      },
    });

    // ── Save to DB ────────────────────────────────────
    await new Chat({ userId, botId, threadId, role: 'user', content: message || '' }).save();
    await new Chat({ userId, botId, threadId, role: 'assistant', content: fullResponse }).save();
    await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });

    // WAHA Forward (fire & forget)
    sendToWaha(bot, req.session?.username, message, fullResponse);

    // Done
    sendSSE('done', { threadId });
    res.end();

  } catch (error) {
    console.error('Stream Error:', error);
    try { sendSSE('error', { error: error.message }); } catch {}
    res.end();
  }
});

// ============================================================
// 🌐 EXTERNAL API CHAT — akses via x-api-key header
// ============================================================
// Contoh curl:
//   curl -X POST https://domain/api/chat/external \
//     -H "x-api-key: gys-bot-xxxx" \
//     -H "Content-Type: application/json" \
//     -d '{"message": "Give me what you got!", "username": "system.scheduler"}'
// ============================================================
router.post('/external', async (req, res) => {
  try {
    // 1. Validasi API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'Akses ditolak: x-api-key tidak ditemukan di header' });
    }

    // 2. Cari bot berdasarkan API Key
    const bot = await Bot.findOne({ botApiKey: apiKey }).lean();
    if (!bot) {
      return res.status(403).json({ error: 'Akses ditolak: API Key tidak valid atau Bot tidak ditemukan' });
    }

    // 3. Validasi message
    const { message, username, history, forward_wa } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ error: 'Field "message" wajib diisi' });
    }

    const callerUsername = username || 'system.external';
    // forward_wa: false by default — external API callers (curl, schedulers, apps)
    // don't want to trigger WhatsApp group sends on every API call.
    // Set forward_wa: true in request body to explicitly enable it.
    const shouldForwardWA = forward_wa === true;

    console.log(`[EXTERNAL] Bot: ${bot.name} | From: ${callerUsername} | WA-forward: ${shouldForwardWA} | Msg: ${message.substring(0, 80)}`);

    // 4. Derive base URL for absolute file links (e.g. newsletter images)
    //    Use SERVER_PUBLIC_URL env var so nginx proxying doesn't strip the port
    const baseUrl = (process.env.SERVER_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

    // 5. Route through AICoreService so newsletter/PPT/Excel detection works
    const startTime = Date.now();
    let responseText = '';
    let attachedFiles = [];

    try {
      const result = await AICoreService.processMessage({
        userId: bot._id,  // use bot id as stand-in for userId
        botId: bot._id,
        bot,
        message,
        threadId: null,
        history: (history || []).map(m => ({ role: m.role, content: m.content })),
        attachedFile: null,
      });
      responseText  = result.response || '';
      attachedFiles = result.attachedFiles || [];
    } catch (innerErr) {
      // Fallback to plain AIProviderService if AICoreService fails
      console.warn('[EXTERNAL] AICoreService failed, falling back to plain AI:', innerErr.message);
      const aiResponse = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider,
        systemPrompt:   bot.prompt || bot.systemPrompt || 'You are a professional AI assistant.',
        messages:       (history || []).map(m => ({ role: m.role, content: m.content })),
        userContent:    message,
        capabilities:   bot.capabilities,
        knowledgeFiles: bot.knowledgeFiles || [],
        knowledgeMode:  bot.knowledgeMode  || 'relevant',
      });
      responseText = aiResponse?.text || aiResponse?.response || '';
    }

    const durationMs = Date.now() - startTime;

    // Make relative image URLs absolute so caller can directly GET them
    const absoluteResponse = responseText.replace(
      /\(\/api\/files\//g,
      `(${baseUrl}/api/files/`
    );

    // 6. WAHA Forward (fire & forget) — only if caller explicitly requested it
    if (shouldForwardWA) {
      sendToWaha(bot, callerUsername, message, responseText);
    }

    // 7. Response
    const responsePayload = {
      success:  true,
      botName:  bot.name,
      response: absoluteResponse,
    };

    // If there are image files attached (newsletter), expose full URLs
    if (attachedFiles && attachedFiles.length > 0) {
      responsePayload.files = attachedFiles.map(f => ({
        name: f.name,
        url: f.path?.startsWith('/') ? `${baseUrl}${f.path}` : f.path,
        type: f.type,
      }));
    }

    res.json(responsePayload);

  } catch (error) {
    console.error('[EXTERNAL] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
