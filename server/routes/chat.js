import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, 'data/files'); },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '---' + file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const isReasoningModel = (model = '') => /^o\d/.test(model) || /^gpt-5/.test(model);

function normalizeUsage(usage, model = '') {
  if (!usage) return null;
  const promptTokens     = usage.prompt_tokens       ?? usage.input_tokens      ?? usage.promptTokenCount     ?? 0;
  const completionTokens = usage.completion_tokens   ?? usage.output_tokens     ?? usage.candidatesTokenCount ?? 0;
  const totalTokens      = usage.total_tokens        ?? usage.totalTokenCount   ?? (promptTokens + completionTokens);
  const reasoningTokens  = usage.completion_tokens_details?.reasoning_tokens    ?? null;
  const warningMaxTokens = isReasoningModel(model) && reasoningTokens
    ? reasoningTokens >= (completionTokens * 0.9)
    : false;
  return { promptTokens, completionTokens, totalTokens, reasoningTokens, warningMaxTokens };
}

// 1. Upload File
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    filename:     req.file.filename,
    originalname: req.file.originalname,
    path:         req.file.path,
    mimetype:     req.file.mimetype,
    url:          `/api/files/${req.file.filename}`,
    size:         req.file.size,
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

    // ── ✅ FIX UTAMA: Resolve physical server path untuk attachedFile ──
    // Bug sebelumnya: hanya cek attachedFile?.filename
    // Jika frontend kirim field dengan nama berbeda (name, file_name, dll)
    // maka resolvedAttachedFile = null dan file tidak diproses sama sekali
    let resolvedAttachedFile = null;

    if (attachedFile) {
      // ✅ Ekstrak filename dari berbagai kemungkinan field name yang dikirim frontend
      const rawFilename = attachedFile.filename        // format standar dari /upload
        || attachedFile.name                           // beberapa frontend pakai 'name'
        || attachedFile.file_name                      // variasi lain
        || (attachedFile.url && attachedFile.url.startsWith('/api/files/')
            ? attachedFile.url.replace('/api/files/', '')  // ekstrak dari URL
            : null);

      if (rawFilename) {
        const serverPath = path.join(process.cwd(), 'data', 'files', rawFilename);

        // ✅ Cek apakah file benar-benar ada di disk
        const fileExists = fs.existsSync(serverPath);

        console.log(`[Chat] attachedFile received:`);
        console.log(`  rawFilename  : ${rawFilename}`);
        console.log(`  originalname : ${attachedFile.originalname || attachedFile.originalName || 'unknown'}`);
        console.log(`  mimetype     : ${attachedFile.mimetype || attachedFile.type || 'unknown'}`);
        console.log(`  serverPath   : ${serverPath}`);
        console.log(`  fileExists   : ${fileExists}`);

        if (fileExists) {
          resolvedAttachedFile = {
            // Normalize semua field name agar konsisten
            filename:     rawFilename,
            originalname: attachedFile.originalname || attachedFile.originalName || rawFilename,
            mimetype:     attachedFile.mimetype || attachedFile.type || 'application/octet-stream',
            size:         attachedFile.size || 0,
            url:          attachedFile.url || `/api/files/${rawFilename}`,
            path:         serverPath,
            serverPath:   serverPath,
          };
        } else {
          console.warn(`[Chat] ⚠️ File tidak ditemukan di disk: ${serverPath}`);
          // Coba cari file dengan prefix yang cocok (fallback jika nama sedikit beda)
          try {
            const filesDir = path.join(process.cwd(), 'data', 'files');
            const allFiles = fs.readdirSync(filesDir);
            // Cari file yang mengandung bagian dari originalname
            const origName = attachedFile.originalname || attachedFile.originalName || '';
            const matchingFile = allFiles.find(f =>
              f.includes(origName) || f.endsWith('---' + origName)
            );
            if (matchingFile) {
              const altPath = path.join(filesDir, matchingFile);
              console.log(`[Chat] ✅ Found via scan: ${matchingFile}`);
              resolvedAttachedFile = {
                filename:     matchingFile,
                originalname: origName || matchingFile,
                mimetype:     attachedFile.mimetype || attachedFile.type || 'application/octet-stream',
                size:         attachedFile.size || 0,
                url:          `/api/files/${matchingFile}`,
                path:         altPath,
                serverPath:   altPath,
              };
            }
          } catch (scanErr) {
            console.warn(`[Chat] File scan error: ${scanErr.message}`);
          }
        }
      } else {
        // ✅ Tidak ada filename sama sekali — log agar mudah debug
        console.warn(`[Chat] ⚠️ attachedFile diterima tapi tidak ada field filename/name/url:`);
        console.warn(`  Fields yang ada: ${Object.keys(attachedFile).join(', ')}`);
        console.warn(`  Value: ${JSON.stringify(attachedFile).substring(0, 200)}`);
      }
    }

    const startTime = Date.now();
    const result = await AICoreService.processMessage({
      userId,
      botId,
      message,
      attachedFile: resolvedAttachedFile,
      threadId,
      history: (history || []).map(m => ({ role: m.role, content: m.content })),
    });
    const durationMs = Date.now() - startTime;

    const usage = normalizeUsage(result?.usage, model);
    const auditDetail = {
      bot: botName, model, provider, durationMs, maxTokensConfig: maxTokens,
      hasAttachment: Boolean(resolvedAttachedFile),
      attachmentName: resolvedAttachedFile?.originalname || null,
      tokens: usage ? {
        prompt:     usage.promptTokens,
        completion: usage.completionTokens,
        total:      usage.totalTokens,
        ...(usage.reasoningTokens !== null && { reasoning: usage.reasoningTokens }),
      } : null,
      ...(usage?.warningMaxTokens && {
        warning: `⚠️ Reasoning tokens (${usage.reasoningTokens}) used up most of max_tokens (${maxTokens}).`,
      }),
      ...((!result?.response || result.response.trim() === '') && {
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
    console.error('Chat Error:', error.message);
    console.error('Chat Error stack:', error.stack);
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
// 🌐 EXTERNAL API CHAT — akses via x-api-key header
// ============================================================
router.post('/external', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'Akses ditolak: x-api-key tidak ditemukan di header' });
    }

    const bot = await Bot.findOne({ botApiKey: apiKey }).lean();
    if (!bot) {
      return res.status(403).json({ error: 'Akses ditolak: API Key tidak valid atau Bot tidak ditemukan' });
    }

    const { message, username, history } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ error: 'Field "message" wajib diisi' });
    }

    const callerUsername = username || 'system.external';
    const model          = bot.aiProvider?.model     || 'unknown';
    const provider       = bot.aiProvider?.provider  || 'openai';
    const maxTokens      = bot.aiProvider?.maxTokens ?? 2000;

    const startTime = Date.now();
    const aiResponse = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider,
      systemPrompt:   bot.prompt || bot.systemPrompt || 'You are a professional AI assistant.',
      messages:       (history || []).map(m => ({ role: m.role, content: m.content })),
      userContent:    message,
      capabilities:   bot.capabilities,
      knowledgeFiles: bot.knowledgeFiles || [],
      knowledgeMode:  bot.knowledgeMode  || 'relevant',
    });

    const durationMs  = Date.now() - startTime;
    const responseText = aiResponse?.text || aiResponse?.response || '';

    const usage = normalizeUsage(aiResponse?.usage, model);
    await AuditService.log({
      req,
      category:   'chat',
      action:     responseText.trim() ? 'AI_RESPONSE' : 'AI_RESPONSE_EMPTY',
      status:     responseText.trim() ? 'success'     : 'failed',
      targetId:   bot._id,
      targetName: bot.name,
      username:   callerUsername,
      detail: {
        bot: bot.name, model, provider, durationMs, maxTokensConfig: maxTokens,
        source: 'external_api',
        tokens: usage ? {
          prompt: usage.promptTokens, completion: usage.completionTokens,
          total: usage.totalTokens,
          ...(usage.reasoningTokens !== null && { reasoning: usage.reasoningTokens }),
        } : null,
      },
    }).catch(() => {});

    res.json({ success: true, botName: bot.name, response: responseText });

  } catch (error) {
    console.error('[EXTERNAL] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;