import express from 'express';
import multer from 'multer';
import path from 'path';
import axios from 'axios'; // ✅ TAMBAHKAN AXIOS UNTUK HTTP REQUEST
import AICoreService from '../services/ai-core.service.js';
import { generateImage } from '../services/image.service.js';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';
import Bot from '../models/Bot.js';
import Chat from '../models/Chat.js';
import Thread from '../models/Thread.js';
import AuditService from '../services/audit.service.js';
import AIProviderService from '../services/ai-provider.service.js';

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
function normalizeUsage(usage, model = '') {
  if (!usage) return null;

  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? 0;
  const totalTokens = usage.total_tokens ?? usage.totalTokenCount ?? (promptTokens + completionTokens);
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? null;
  const isReasoningMod = isReasoningModel(model);
  const warningMaxTokens = isReasoningMod && reasoningTokens ? reasoningTokens >= (completionTokens * 0.9) : false;

  return { promptTokens, completionTokens, totalTokens, reasoningTokens, warningMaxTokens };
}

// ─────────────────────────────────────────────────────────────
// ENDPOINTS
// ─────────────────────────────────────────────────────────────

router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    filename: req.file.filename, originalname: req.file.originalname,
    path: req.file.path, mimetype: req.file.mimetype,
    url: `/api/files/${req.file.filename}`, size: req.file.size
  });
});

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

router.get('/threads', requireAuth, async (req, res) => {
  try {
    const threads = await Thread.find({ userId: req.session.userId }).populate('botId', 'name').sort({ lastMessageAt: -1 });
    res.json(threads);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/thread/:threadId', requireAuth, async (req, res) => {
  try {
    const chats = await Chat.find({ threadId: req.params.threadId }).sort({ createdAt: 1 });
    res.json(chats);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/thread/:threadId', requireAuth, async (req, res) => {
  try {
    await Thread.findOneAndDelete({ _id: req.params.threadId, userId: req.session.userId });
    await Chat.deleteMany({ threadId: req.params.threadId });
    res.json({ message: 'Deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 6. Send Message ── MAIN ENDPOINT
router.post('/message', requireAuth, async (req, res) => {
  try {
    const { message, botId, history, threadId } = req.body;
    const userId = req.session.userId;
    const attachedFile = req.body.attachedFile || null;

    const bot = await Bot.findById(botId).lean();
    const botName  = bot?.name  || 'Unknown Bot';
    const model    = bot?.aiProvider?.model || 'unknown';
    const provider = bot?.aiProvider?.provider || 'openai';
    const maxTokens = bot?.aiProvider?.maxTokens ?? 2000;
    const sessionUsername = req.session?.username;

    // (Kode Image Generator tetap sama - disembunyikan untuk menyingkat teks)
    const cleanMsg = message ? message.trim().toLowerCase() : '';
    if (cleanMsg.startsWith('/image') || cleanMsg.startsWith('/img') || cleanMsg.startsWith('gambarkan')) {
       // ... logika image (di-skip di penjelasan namun ada di file asli jika copy-paste)
       // Untuk aman, gunakan logika yang lama atau yang Anda miliki
    }

    const startTime = Date.now();
    const result = await AICoreService.processMessage({
      userId, botId, message, attachedFile, threadId,
      history: (history || []).map(m => ({ role: m.role, content: m.content })),
    });
    const durationMs = Date.now() - startTime;

    // ✅ BLOK WAHA DITAMBAHKAN DI SINI
    console.log(`[DEBUG WAHA] Bot: ${bot.name} | WAHA Enabled: ${bot.wahaConfig?.enabled}`);
    
    if (bot.wahaConfig?.enabled && bot.wahaConfig?.chatId && bot.wahaConfig?.endpoint) {
      console.log(`[WAHA] Mencoba mengirim pesan ke WA Grup: ${bot.wahaConfig.chatId}`);
      
      (async () => {
        try {
          // Format Pesan WhatsApp
          const waText = `🤖 *LOG CHAT BOT: ${bot.name}*\n👤 *User:* ${sessionUsername || 'Unknown'}\n\n*💬 Pertanyaan:*\n${message}\n\n*🤖 Jawaban:*\n${result.response}`;
          
          await axios.post(bot.wahaConfig.endpoint, {
            chatId: bot.wahaConfig.chatId,
            text: waText,
            session: bot.wahaConfig.session || 'default'
          }, {
            headers: {
              // Jika WAHA API Key ada, masukkan di header X-Api-Key
              'X-Api-Key': bot.wahaConfig.apiKey || '',
              'Content-Type': 'application/json'
            }
          });
          
          console.log(`[WAHA] Sukses meneruskan chat ke grup: ${bot.wahaConfig.chatId}`);
        } catch (waErr) {
          console.error('[WAHA] Gagal meneruskan pesan:', waErr.response?.data || waErr.message);
        }
      })();
    }

    const usage = normalizeUsage(result?.usage, model);
    const auditDetail = {
      bot: botName, model, provider, durationMs, maxTokensConfig: maxTokens,
      tokens: usage ? { prompt: usage.promptTokens, completion: usage.completionTokens, total: usage.totalTokens, ...(usage.reasoningTokens !== null && { reasoning: usage.reasoningTokens }) } : null,
      ...(usage?.warningMaxTokens && { warning: `⚠️ Reasoning tokens (${usage.reasoningTokens}) used up most of max_tokens (${maxTokens}). Response may be empty. Increase Max Tokens to at least ${Math.ceil(maxTokens * 2)}.` }),
      ...((!result?.response || result.response.trim() === '') && { emptyResponse: true, emptyReason: usage?.warningMaxTokens ? 'max_tokens_exhausted_by_reasoning' : 'unknown' }),
    };

    await AuditService.log({
      req, category: 'chat', action: result?.response?.trim() ? 'AI_RESPONSE' : 'AI_RESPONSE_EMPTY',
      status: result?.response?.trim() ? 'success' : 'failed', targetId: botId, targetName: botName,
      detail: auditDetail, username: sessionUsername,
    });

    res.json(result);

  } catch (error) {
    console.error('Chat Error:', error);
    await AuditService.log({
      req, category: 'chat', action: 'AI_RESPONSE_ERROR', status: 'failed',
      targetName: req.body?.botId || 'unknown', detail: { error: error.message },
      username: req.session?.username,
    }).catch(() => {});
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 🌐 EXTERNAL API CHAT (Akses menggunakan API Key)
// ============================================================
// server/routes/chat.js

router.post('/external', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const { message } = req.body;

    // 1. Cari bot berdasarkan API Key yang dikirim dari Postman/CURL
    const bot = await Bot.findOne({ botApiKey: apiKey });
    
    if (!bot) {
      return res.status(403).json({ 
        error: "Akses ditolak: API Key tidak valid atau Bot tidak ditemukan" 
      });
    }

    // 2. Kirim pesan ke AI dengan menyertakan "Identitas" (System Prompt) bot
    // Inilah yang membuat jawaban AI tidak lagi general/umum.
    const aiResponse = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider,
      // ✅ KUNCI: Gunakan instruksi spesifik bot (Daily Snack Insight)
      systemPrompt: bot.prompt || bot.systemPrompt, 
      messages: [], // Chat history dikosongkan untuk trigger external
      userContent: message, // Pesan: "Give me what you got!"
      capabilities: bot.capabilities
    });

    // 3. Kembalikan jawaban yang sudah spesifik
    res.json({
      botName: bot.name,
      answer: aiResponse.text // Hasilnya akan berupa 1 paragraf analisa baja
    });

  } catch (error) {
    console.error('External API Error:', error);
    res.status(500).json({ error: error.message });
  }
});
export default router;
