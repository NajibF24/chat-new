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

// ── Helper: normalize usage across providers ──────────────────
// OpenAI:    { prompt_tokens, completion_tokens, total_tokens, completion_tokens_details }
// Anthropic: { input_tokens, output_tokens }
// Gemini:    { promptTokenCount, candidatesTokenCount, totalTokenCount }
function normalizeUsage(usage, model = '') {
  if (!usage) return null;

  const promptTokens =
    usage.prompt_tokens       ??
    usage.input_tokens         ??
    usage.promptTokenCount     ?? 0;

  const completionTokens =
    usage.completion_tokens       ??
    usage.output_tokens            ??
    usage.candidatesTokenCount     ?? 0;

  const totalTokens =
    usage.total_tokens        ??
    usage.totalTokenCount      ??
    (promptTokens + completionTokens);

  // Reasoning-specific: how many tokens were used for internal thinking
  const reasoningTokens =
    usage.completion_tokens_details?.reasoning_tokens ?? null;

  // Detect if response was cut off because max_tokens was hit
  const isReasoningMod = isReasoningModel(model);
  const warningMaxTokens = isReasoningMod && reasoningTokens
    ? reasoningTokens >= (completionTokens * 0.9)   // 90%+ used for thinking
    : false;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens,          // null for non-reasoning models
    warningMaxTokens,         // true = likely hit max_tokens limit (empty response risk)
  };
}

// ─────────────────────────────────────────────────────────────
// ENDPOINTS
// ─────────────────────────────────────────────────────────────

// 1. Upload File
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    filename: req.file.filename,
    originalname: req.file.originalname,
    path: req.file.path,
    mimetype: req.file.mimetype,
    url: `/api/files/${req.file.filename}`,
    size: req.file.size
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
      .populate('botId', 'name')
      .sort({ lastMessageAt: -1 });
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

// 6. Send Message ── MAIN ENDPOINT with token audit logging
router.post('/message', requireAuth, async (req, res) => {
  try {
    const { message, botId, history, threadId } = req.body;
    const userId = req.session.userId;
    const attachedFile = req.body.attachedFile || null;

    // ── Fetch bot for audit context ──────────────────────────
    const bot = await Bot.findById(botId).lean();
    const botName  = bot?.name  || 'Unknown Bot';
    const model    = bot?.aiProvider?.model || 'unknown';
    const provider = bot?.aiProvider?.provider || 'openai';
    const maxTokens = bot?.aiProvider?.maxTokens ?? 2000;

    // ── USERNAME from session or DB ──────────────────────────
    const sessionUsername = req.session?.username;

    // ─────────────────────────────────────────────────────────
    // GENERATE IMAGE (/image command)
    // ─────────────────────────────────────────────────────────
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
        const botMsg = new Chat({ userId, botId, threadId: targetThreadId, role: 'assistant', content: markdownResponse });
        await botMsg.save();

        // Audit: image generation (no token usage)
        await AuditService.log({
          req,
          category:   'chat',
          action:     'IMAGE_GENERATE',
          targetId:   botId,
          targetName: botName,
          detail:     { prompt: prompt.substring(0, 100), model: 'dall-e', provider: 'openai' },
          username:   sessionUsername,
        });

        return res.json({ response: markdownResponse, threadId: targetThreadId });
      } catch (imgError) {
        console.error('Image Service Error:', imgError);
        return res.status(500).json({ error: 'Gagal membuat gambar: ' + imgError.message });
      }
    }

    // ─────────────────────────────────────────────────────────
    // NORMAL AI MESSAGE — delegate to AICoreService
    // ─────────────────────────────────────────────────────────
    const startTime = Date.now();

    const result = await AICoreService.processMessage({
      userId,
      botId,
      message,
      attachedFile,
      threadId,
      history: (history || []).map(m => ({ role: m.role, content: m.content })),
    });

    const durationMs = Date.now() - startTime;

    // ── Normalize token usage ────────────────────────────────
    const usage = normalizeUsage(result?.usage, model);

    // ── Build audit detail ───────────────────────────────────
    const auditDetail = {
      bot:      botName,
      model,
      provider,
      durationMs,
      maxTokensConfig: maxTokens,
      // Token breakdown
      tokens: usage ? {
        prompt:     usage.promptTokens,
        completion: usage.completionTokens,
        total:      usage.totalTokens,
        ...(usage.reasoningTokens !== null && { reasoning: usage.reasoningTokens }),
      } : null,
      // Warning flags
      ...(usage?.warningMaxTokens && {
        warning: `⚠️ Reasoning tokens (${usage.reasoningTokens}) used up most of max_tokens (${maxTokens}). Response may be empty. Increase Max Tokens to at least ${Math.ceil(maxTokens * 2)}.`,
      }),
      // Empty response flag
      ...((!result?.response || result.response.trim() === '') && {
        emptyResponse: true,
        emptyReason: usage?.warningMaxTokens
          ? 'max_tokens_exhausted_by_reasoning'
          : 'unknown',
      }),
    };

    // ── Write audit log ──────────────────────────────────────
    await AuditService.log({
      req,
      category:   'chat',
      action:     result?.response?.trim() ? 'AI_RESPONSE' : 'AI_RESPONSE_EMPTY',
      status:     result?.response?.trim() ? 'success' : 'failed',
      targetId:   botId,
      targetName: botName,
      detail:     auditDetail,
      username:   sessionUsername,
    });

    res.json(result);

  } catch (error) {
    console.error('Chat Error:', error);

    // Log failed AI calls too
    await AuditService.log({
      req,
      category:   'chat',
      action:     'AI_RESPONSE_ERROR',
      status:     'failed',
      targetName: req.body?.botId || 'unknown',
      detail:     { error: error.message },
      username:   req.session?.username,
    }).catch(() => {});

    res.status(500).json({ error: error.message });
  }
});

export default router;