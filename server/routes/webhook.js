// server/routes/webhook.js
//
// CHANGELOG:
//   ✅ Global endpoint  POST /api/webhook/waha  — satu nomor untuk semua bot
//   ✅ Bot routing: session → chatId target match → fallback incomingEnabled bot
//   ✅ Group: hanya jawab bila bot di-mention (@nomor atau mentionedIds)
//   ✅ Private: selalu jawab
//   ✅ Backward compat: POST /api/webhook/waha/:botId tetap jalan

import express  from 'express';
import path     from 'path';
import fs       from 'fs';
import axios    from 'axios';

import Bot                  from '../models/Bot.js';
import WahaConversation     from '../models/WahaConversation.js';
import WahaService          from '../services/waha.service.js';
import AIProviderService    from '../services/ai-provider.service.js';
import KnowledgeBaseService from '../services/knowledge-base.service.js';
import SmartsheetLiveService from '../services/smartsheet-live.service.js';
import AuditService         from '../services/audit.service.js';

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────
const MAX_HISTORY    = 12;
const RESET_COMMANDS = ['/reset', '/clear', '/mulai', 'reset', 'clear'];
const HELP_COMMANDS  = ['/help', '/bantuan', 'help', 'bantuan', '/start'];
const SERVER_INTERNAL_URL = (process.env.SERVER_INTERNAL_URL || 'http://172.16.31.48:8080').replace(/\/$/, '');

// ── Deteksi PPT command ───────────────────────────────────────
const isPptCommand = (msg = '') => {
  const t = msg.toLowerCase().trim();
  return (
    t.startsWith('/ppt') || t.startsWith('/slide') ||
    /^(buatkan|buat|create|generate)\s+(presentasi|ppt|slide|powerpoint|deck)/i.test(t) ||
    (/\b(presentasi|powerpoint|ppt|slide deck)\b/i.test(t) &&
      /\b(buat|buatkan|create|generate|tolong)\b/i.test(t))
  );
};

const isImageCommand = (msg = '') => {
  const t = msg.toLowerCase().trim();
  return (
    t.startsWith('/image') || t.startsWith('/img') ||
    t.startsWith('/gambar') || /^gambarkan\s/i.test(t)
  );
};

// ── Deteksi apakah bot di-mention dalam pesan grup ────────────
// WAHA mengirim mentionedIds berisi JID dari user yang di-mention.
// Kita tidak tahu JID bot sendiri, tapi kita bisa cek:
//   1. Ada @number dalam body text
//   2. mentionedIds tidak kosong (ada yang di-mention)
// Ini berarti: "jawab kalau ada orang di-mention di pesan ini"
// Pendekatan ini aman untuk kebanyakan kasus grup.
function isBotMentionedInGroup(payload) {
  const body       = payload.body || '';
  const mentioned  = payload.mentionedIds || payload._data?.mentionedJidList || [];

  // Cek mention via array mentionedIds
  if (Array.isArray(mentioned) && mentioned.length > 0) return true;

  // Cek mention via @number pattern dalam body
  if (/@\d{6,}/.test(body)) return true;

  // Cek body mulai dengan @
  if (body.trim().startsWith('@')) return true;

  return false;
}

// ── Save media ────────────────────────────────────────────────
async function saveTempMedia(buffer, mimeType, filename) {
  const ext = mimeType.includes('pdf')          ? '.pdf'
    : mimeType.includes('word')                 ? '.docx'
    : mimeType.includes('excel') || mimeType.includes('spreadsheet') ? '.xlsx'
    : mimeType.includes('powerpoint') || mimeType.includes('presentation') ? '.pptx'
    : mimeType.includes('image/jpeg')           ? '.jpg'
    : mimeType.includes('image/png')            ? '.png'
    : mimeType.includes('image')                ? '.jpg'
    : path.extname(filename || '').toLowerCase() || '.bin';

  const tmpDir  = path.join(process.cwd(), 'data', 'files', 'tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const tmpName = `waha-${Date.now()}${ext}`;
  const tmpPath = path.join(tmpDir, tmpName);
  await fs.promises.writeFile(tmpPath, buffer);
  return { path: tmpPath, filename: filename || tmpName, mimetype: mimeType };
}

// ── Download media dari WAHA ──────────────────────────────────
async function downloadWahaMedia(wahaConfig, payload) {
  const candidateUrls = [
    payload.media?.url, payload.mediaUrl,
    payload._data?.body, payload.body?.startsWith?.('http') ? payload.body : null,
  ].filter(Boolean);

  const mimeType = payload.mimetype || payload.media?.mimetype || payload._data?.mimetype || 'application/octet-stream';
  const filename = payload.filename || payload.media?.filename || payload._data?.filename || `file-${Date.now()}`;

  if (!candidateUrls.length) throw new Error('Tidak ada URL media di payload');

  let wahaBaseUrl = '';
  try {
    const u = new URL(wahaConfig.endpoint);
    wahaBaseUrl = `${u.protocol}//${u.host}`;
  } catch {
    wahaBaseUrl = wahaConfig.endpoint.replace(/\/api\/.*$/, '');
  }

  const headers = { Accept: '*/*' };
  if (wahaConfig.apiKey) headers['X-Api-Key'] = wahaConfig.apiKey;

  for (const rawUrl of candidateUrls) {
    try {
      let downloadUrl = rawUrl;
      if (rawUrl.startsWith('/')) {
        downloadUrl = `${wahaBaseUrl}${rawUrl}`;
      } else if (rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1') || rawUrl.includes('waha:')) {
        const urlObj = new URL(rawUrl), baseObj = new URL(wahaBaseUrl);
        urlObj.hostname = baseObj.hostname;
        urlObj.port     = baseObj.port;
        urlObj.protocol = baseObj.protocol;
        downloadUrl = urlObj.toString();
      }

      const res = await axios.get(downloadUrl, { headers, responseType: 'arraybuffer', timeout: 20000 });
      return {
        buffer:   Buffer.from(res.data),
        mimeType: res.headers['content-type']?.split(';')[0] || mimeType,
        filename,
      };
    } catch { continue; }
  }

  // Fallback: WAHA files API
  const messageId = payload.id || payload._data?.id?.id;
  if (messageId) {
    try {
      const apiUrl = `${wahaBaseUrl}/api/files/${wahaConfig.session || 'default'}/${messageId}`;
      const res    = await axios.get(apiUrl, { headers, responseType: 'arraybuffer', timeout: 20000 });
      return { buffer: Buffer.from(res.data), mimeType: res.headers['content-type']?.split(';')[0] || mimeType, filename };
    } catch {}
  }

  throw new Error('Semua strategi download media gagal');
}

// ── Build system prompt ───────────────────────────────────────
function buildSystemPrompt(bot, phoneNumber) {
  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  return [
    bot.prompt || bot.systemPrompt || 'Kamu adalah asisten AI profesional.',
    `[TODAY: ${today}]`,
    `[CHANNEL: WhatsApp | User: ${phoneNumber}]`,
    `PENTING: Balas dalam format WhatsApp.
- Gunakan *bold* bukan **bold**
- Gunakan _italic_
- Jangan buat tabel markdown (WA tidak mendukung), gunakan daftar bullet
- Jawaban ringkas — maks 3-4 paragraf kecuali diminta detail
- Untuk list gunakan bullet • bukan -`,
  ].filter(Boolean).join('\n\n');
}

// ── Knowledge & Smartsheet context ───────────────────────────
function buildKnowledgeContext(bot, message) {
  if (!bot.knowledgeFiles?.length || bot.knowledgeMode === 'disabled') return '';
  return KnowledgeBaseService.buildKnowledgeContext(
    bot.knowledgeFiles, message, bot.knowledgeMode || 'relevant'
  );
}

async function buildSmartsheetContext(bot, message) {
  if (!bot.smartsheetConfig?.enabled) return '';
  const keywords = /\b(list|daftar|status|progress|proyek|project|semua|all|summary|data)\b/i;
  if (!keywords.test(message)) return '';
  try {
    const apiKey  = bot.smartsheetConfig.apiKey || process.env.SMARTSHEET_API_KEY;
    const sheetId = bot.smartsheetConfig.sheetId || process.env.SMARTSHEET_PRIMARY_SHEET_ID;
    if (!apiKey || !sheetId) return '';
    const ss    = new SmartsheetLiveService(apiKey);
    const sheet = await ss.fetchSheet(sheetId);
    const rows  = ss.processToFlatRows(sheet);
    return rows.length > 0 ? ss.buildAIContext(rows, message, sheet.name) : '';
  } catch (e) {
    console.error('[WA Webhook] Smartsheet error:', e.message);
    return '';
  }
}

// ── Save conversation history ─────────────────────────────────
async function saveHistory(botId, phoneNumber, userMsg, assistantMsg, maxLen) {
  try {
    const newEntries = [];
    if (userMsg)      newEntries.push({ role: 'user',      content: userMsg });
    if (assistantMsg) newEntries.push({ role: 'assistant', content: assistantMsg });
    if (!newEntries.length) return;

    await WahaConversation.findOneAndUpdate(
      { botId, phoneNumber },
      {
        $push: { history: { $each: newEntries, $slice: -maxLen } },
        $set:  { lastActivity: new Date() },
      },
      { upsert: true }
    );
  } catch (e) {
    console.error('[WA Webhook] saveHistory error:', e.message);
  }
}

// ── Send file with fallback ───────────────────────────────────
async function sendFileWithFallback(waha, wahaConfig, phoneNumber, fileUrl, filename, caption) {
  try {
    await waha.post('/api/sendFile', {
      session: wahaConfig.session || 'default',
      chatId:  phoneNumber,
      file:    { url: fileUrl, filename },
      caption,
    });
  } catch (err) {
    await waha.sendText(phoneNumber,
      `${caption}\n\n📥 *Download file:*\n${fileUrl}\n\n_Buka link di browser (pastikan terhubung jaringan GYS)_`
    );
  }
}

async function sendImageWithFallback(waha, wahaConfig, phoneNumber, imageUrl, caption) {
  try {
    await waha.post('/api/sendImage', {
      session: wahaConfig.session || 'default',
      chatId:  phoneNumber,
      file:    { url: imageUrl },
      caption,
    });
  } catch (err) {
    await waha.sendText(phoneNumber,
      `${caption}\n\n🖼️ *Lihat gambar:*\n${imageUrl}\n\n_Buka link di browser_`
    );
  }
}

// ══════════════════════════════════════════════════════════════
// CORE HANDLER — shared by global and per-bot endpoints
// ══════════════════════════════════════════════════════════════

async function processIncomingMessage(bot, body, req) {
  const botId   = bot._id.toString();
  const payload = body?.payload;
  if (!payload) return;

  // Ignore outgoing messages & reactions
  if (payload.fromMe === true) return;
  if (payload.type === 'reaction') return;

  const phoneNumber   = payload.from || payload.chatId;
  if (!phoneNumber) return;

  const incomingText  = (payload.body || '').trim();
  const hasMedia      = Boolean(payload.hasMedia || payload.media || payload.mediaUrl);
  const mediaFilename = payload.filename || payload.media?.filename || 'attachment';
  const displayName   = payload._data?.notifyName || payload.pushName || phoneNumber;
  const isGroup       = phoneNumber.endsWith('@g.us');

  // ── GROUP: only respond if bot is mentioned ────────────────
  if (isGroup) {
    if (!isBotMentionedInGroup(payload)) {
      console.log(`[WA Webhook] Group message without mention — skipping (${phoneNumber})`);
      return;
    }
    console.log(`[WA Webhook] Group mention detected — responding (${phoneNumber})`);
  }

  // ── PRIVATE: always respond ────────────────────────────────
  console.log(`[WA Webhook] From: ${phoneNumber} | Text: "${incomingText.substring(0, 60)}" | hasMedia: ${hasMedia} | group: ${isGroup}`);

  const wahaConfig = bot.wahaConfig;
  const waha       = new WahaService(wahaConfig);
  const lowerText  = incomingText.toLowerCase();

  // ── Reset / Help commands ──────────────────────────────────
  if (RESET_COMMANDS.includes(lowerText)) {
    await WahaConversation.findOneAndUpdate(
      { botId, phoneNumber },
      { $set: { history: [], lastActivity: new Date() } }
    );
    await waha.sendText(phoneNumber,
      `✅ *Percakapan direset!*\n\nHalo! Saya *${bot.name}*, ada yang bisa saya bantu?\n\nKetik */help* untuk daftar perintah.`
    );
    return;
  }

  if (HELP_COMMANDS.includes(lowerText)) {
    const helpLines = [
      `🤖 *${bot.name}*`,
      bot.description ? `_${bot.description}_` : '',
      '',
      '*Perintah tersedia:*',
      '• Ketik pertanyaan apa saja untuk mulai chat',
      '• Kirim file PDF/Word/Excel untuk dianalisis',
      '• */image [deskripsi]* — Buat gambar dengan AI',
      '• */ppt [topik]* — Buat file presentasi (.pptx)',
      '• */reset* — Mulai percakapan baru',
      '• */help* — Tampilkan bantuan ini',
    ];
    if (bot.starterQuestions?.length) {
      helpLines.push('', '*Contoh pertanyaan:*');
      bot.starterQuestions.slice(0, 3).forEach(q => helpLines.push(`• ${q}`));
    }
    await waha.sendText(phoneNumber, helpLines.filter(l => l !== undefined && l !== null).join('\n'));
    return;
  }

  // ── Load conversation history ──────────────────────────────
  const conv = await WahaConversation.findOneAndUpdate(
    { botId, phoneNumber },
    { $set: { lastActivity: new Date(), displayName } },
    { upsert: true, new: true }
  );
  const historyForAI = (conv.history || []).slice(-MAX_HISTORY).map(h => ({
    role: h.role, content: h.content,
  }));

  await waha.startTyping(phoneNumber);

  // ── Handle media ───────────────────────────────────────────
  let attachedFile = null;
  if (hasMedia) {
    try {
      const { buffer, mimeType, filename } = await downloadWahaMedia(wahaConfig, payload);
      attachedFile = await saveTempMedia(buffer, mimeType, filename);
    } catch (e) {
      console.error('[WA Webhook] Media download failed:', e.message);
      await waha.stopTyping(phoneNumber);
      await waha.sendText(phoneNumber,
        `⚠️ Maaf, gagal mengunduh file. Pastikan file tidak terlalu besar (maks 20MB) dan coba lagi.`
      );
      return;
    }
  }

  // ── PPT command ────────────────────────────────────────────
  if (isPptCommand(incomingText)) {
    await waha.stopTyping(phoneNumber);
    await waha.sendText(phoneNumber, `⏳ *Membuat presentasi...*\nMohon tunggu 30-60 detik.`);
    await waha.startTyping(phoneNumber);

    try {
      const AICore       = (await import('../services/ai-core.service.js')).default;
      const virtualUserId = bot.createdBy || bot._id;

      const result = await AICore.processMessage({
        userId:   virtualUserId,
        botId:    botId,
        message:  incomingText,
        threadId: null,
        history:  historyForAI,
      });

      await waha.stopTyping(phoneNumber);

      const pptxUrlMatch = result?.response?.match(/\/api\/files\/[^\s)"]+\.pptx/);
      if (pptxUrlMatch) {
        const relativePath = pptxUrlMatch[0].replace('/api/files/', '');
        const filePath     = path.join(process.cwd(), 'data', 'files', relativePath);
        const filename     = relativePath.split('/').pop();
        if (fs.existsSync(filePath)) {
          await sendFileWithFallback(waha, wahaConfig, phoneNumber,
            `${SERVER_INTERNAL_URL}/api/files/${relativePath}`, filename, `📊 *Presentasi siap!*`
          );
        } else {
          await waha.sendText(phoneNumber, `📊 *Presentasi selesai!*\n\n${result.response}`);
        }
      } else {
        await waha.sendText(phoneNumber, result?.response || 'Maaf, terjadi kesalahan membuat presentasi.');
      }

      await saveHistory(botId, phoneNumber, incomingText, '[PPT dibuat]', MAX_HISTORY);
    } catch (err) {
      console.error('[WA Webhook] PPT error:', err);
      await waha.stopTyping(phoneNumber);
      await waha.sendText(phoneNumber, `❌ Gagal membuat presentasi: ${err.message}`);
    }
    return;
  }

  // ── Image command ──────────────────────────────────────────
  if (isImageCommand(incomingText)) {
    const prompt = incomingText
      .replace(/^\/(image|img|gambar)\s*/i, '')
      .replace(/^gambarkan\s*/i, '')
      .trim() || 'Abstract modern art';

    await waha.stopTyping(phoneNumber);
    await waha.sendText(phoneNumber, `🎨 *Membuat gambar...*\nMohon tunggu sebentar.`);
    await waha.startTyping(phoneNumber);

    try {
      const { generateImage } = await import('../services/image.service.js');
      const relativeUrl = await generateImage(prompt);
      const imageUrl    = `${SERVER_INTERNAL_URL}${relativeUrl}`;

      await waha.stopTyping(phoneNumber);
      await sendImageWithFallback(waha, wahaConfig, phoneNumber, imageUrl, `🎨 ${prompt}`);

      const filePath = path.join(process.cwd(), 'data', 'files', relativeUrl.replace('/api/files/', ''));
      setTimeout(() => fs.promises.unlink(filePath).catch(() => {}), 5 * 60 * 1000);

      await saveHistory(botId, phoneNumber, incomingText, `[Gambar dibuat: ${prompt}]`, MAX_HISTORY);
      await AuditService.log({
        req, category: 'chat', action: 'IMAGE_GENERATE',
        targetId: botId, targetName: bot.name,
        username: phoneNumber, detail: { prompt, channel: 'whatsapp' },
      });
    } catch (err) {
      await waha.stopTyping(phoneNumber);
      await waha.sendText(phoneNumber, `❌ Gagal membuat gambar: ${err.message}`);
    }
    return;
  }

  // ── Normal AI chat ─────────────────────────────────────────
  let userContent = incomingText || (hasMedia ? `[File dikirim: ${mediaFilename}]` : '');

  if (attachedFile) {
    try {
      const isImage = attachedFile.mimetype.startsWith('image/');
      if (!isImage) {
        const { content } = await KnowledgeBaseService.extractContent(
          attachedFile.path, attachedFile.filename, attachedFile.mimetype
        );
        if (content) {
          userContent = [
            userContent || 'Tolong analisis file ini.',
            `\n[ISI FILE: ${attachedFile.filename}]\n${content.substring(0, 8000)}\n[AKHIR FILE]`,
          ].join('\n');
        }
      } else {
        userContent = userContent || `Tolong analisis gambar ini (${attachedFile.filename}).`;
      }
    } catch (e) {
      console.warn('[WA Webhook] File extraction failed:', e.message);
      userContent = userContent || `[File diterima: ${attachedFile.filename}, tapi gagal dibaca]`;
    }
    setTimeout(() => fs.promises.unlink(attachedFile.path).catch(() => {}), 10 * 60 * 1000);
  }

  const knowledgeCtx  = buildKnowledgeContext(bot, userContent);
  const smartsheetCtx = await buildSmartsheetContext(bot, userContent);
  const contextData   = [knowledgeCtx, smartsheetCtx].filter(Boolean).join('\n\n');

  let systemPrompt = buildSystemPrompt(bot, phoneNumber);
  if (contextData) systemPrompt += `\n\n${contextData}`;

  const aiResult = await AIProviderService.generateCompletion({
    providerConfig: bot.aiProvider,
    systemPrompt,
    messages:       historyForAI,
    userContent,
    capabilities:   {
      ...bot.capabilities,
      webSearch:       false,
      codeInterpreter: false,
      imageGeneration: false,
    },
  });

  const aiText = aiResult?.text || 'Maaf, saya tidak dapat memproses permintaan ini saat ini.';

  await waha.stopTyping(phoneNumber);
  await waha.sendText(phoneNumber, aiText);

  await saveHistory(botId, phoneNumber, userContent.substring(0, 500), aiText, MAX_HISTORY);

  await AuditService.log({
    req, category: 'chat', action: 'AI_RESPONSE',
    targetId: botId, targetName: bot.name,
    username: phoneNumber,
    detail: { channel: 'whatsapp', isGroup, model: bot.aiProvider?.model, tokens: aiResult?.usage?.total_tokens },
  });
}

// ══════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════

/**
 * GLOBAL WEBHOOK  POST /api/webhook/waha
 *
 * Routing logic:
 *   1. session → find bots with matching session
 *   2. chatId  → find bot with this chatId in its targets (most specific)
 *   3. fallback → any bot with incomingEnabled=true for this session
 *   4. last resort → first enabled bot with this session
 *
 * Configure WAHA to send all events to:
 *   POST https://your-server/api/webhook/waha
 */
router.post('/waha', async (req, res) => {
  // Respond immediately so WAHA doesn't retry
  res.status(200).json({ ok: true });

  try {
    const body    = req.body;
    const payload = body?.payload;
    if (!payload) return;

    // Ignore outgoing & reactions early
    if (payload.fromMe === true) return;
    if (payload.type === 'reaction') return;

    // Detect session from various WAHA payload formats
    const sessionName = body?.session
      || body?.metadata?.session
      || payload?.session
      || 'default';

    const senderChatId = payload.from || payload.chatId;
    if (!senderChatId) return;

    console.log(`[WA Global] event=${body?.event} session=${sessionName} from=${senderChatId}`);

    // Only process message events
    const event = body?.event;
    if (!['message', 'message.any'].includes(event)) return;

    // Find all bots with WAHA enabled for this session
    const bots = await Bot.find({
      'wahaConfig.enabled':  true,
      'wahaConfig.session':  sessionName,
    }).lean();

    if (!bots.length) {
      console.log(`[WA Global] No bots found for session: ${sessionName}`);
      return;
    }

    let targetBot = null;

    // Priority 1: bot with exact chatId match in targets
    for (const bot of bots) {
      if (!bot.wahaConfig.incomingEnabled) continue;
      const targets = bot.wahaConfig.targets || [];
      if (targets.some(t => t.enabled !== false && t.chatId === senderChatId)) {
        targetBot = bot;
        console.log(`[WA Global] Routed to "${bot.name}" (chatId target match)`);
        break;
      }
    }

    // Priority 2: first bot with incomingEnabled for this session
    if (!targetBot) {
      targetBot = bots.find(b => b.wahaConfig.incomingEnabled);
      if (targetBot) {
        console.log(`[WA Global] Routed to "${targetBot.name}" (default incomingEnabled bot)`);
      }
    }

    // Priority 3: first enabled bot with this session
    if (!targetBot) {
      targetBot = bots[0];
      console.log(`[WA Global] Routed to "${targetBot.name}" (fallback first bot)`);
    }

    if (!targetBot) {
      console.log(`[WA Global] No suitable bot found for session=${sessionName}`);
      return;
    }

    await processIncomingMessage(targetBot, body, req);

  } catch (error) {
    console.error('[WA Global Webhook] Unhandled error:', error.message, error.stack);
  }
});

/**
 * PER-BOT WEBHOOK  POST /api/webhook/waha/:botId
 *
 * Backward compatible. Kept for existing WAHA configurations.
 * New setups should prefer the global endpoint above.
 */
router.post('/waha/:botId', async (req, res) => {
  // Respond immediately
  res.status(200).json({ ok: true });

  try {
    const body  = req.body;
    const event = body?.event;

    if (!['message', 'message.any'].includes(event)) return;

    const bot = await Bot.findById(req.params.botId).lean();
    if (!bot) {
      console.warn(`[WA Webhook] Bot ${req.params.botId} not found`);
      return;
    }
    if (!bot.wahaConfig?.enabled || !bot.wahaConfig?.endpoint) {
      console.warn(`[WA Webhook] WAHA not enabled for bot ${req.params.botId}`);
      return;
    }
    if (!bot.wahaConfig.incomingEnabled) {
      console.warn(`[WA Webhook] Incoming not enabled for bot ${req.params.botId}`);
      return;
    }

    await processIncomingMessage(bot, body, req);

  } catch (error) {
    console.error('[WA Webhook] Unhandled error:', error.message, error.stack);
  }
});

export default router;