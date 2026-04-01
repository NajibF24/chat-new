// server/routes/webhook.js
// POST /api/webhook/waha/:botId
// Menerima incoming message dari WAHA, proses via AI, kirim balik

import express from 'express';
import path    from 'path';
import fs      from 'fs';
import axios   from 'axios';

import Bot                from '../models/Bot.js';
import WahaConversation   from '../models/WahaConversation.js';
import WahaService        from '../services/waha.service.js';
import AIProviderService  from '../services/ai-provider.service.js';
import KnowledgeBaseService from '../services/knowledge-base.service.js';
import SmartsheetLiveService from '../services/smartsheet-live.service.js';
import AuditService       from '../services/audit.service.js';

const router = express.Router();

// ── Konstanta ─────────────────────────────────────────────────
const MAX_HISTORY = 12;       // jumlah pesan history yang dikirim ke AI
const RESET_COMMANDS = ['/reset', '/clear', '/mulai', 'reset', 'clear'];
const HELP_COMMANDS  = ['/help', '/bantuan', 'help', 'bantuan', '/start'];

// ── Deteksi apakah pesan adalah command PPT ───────────────────
const isPptCommand = (msg = '') => {
  const t = msg.toLowerCase().trim();
  return (
    t.startsWith('/ppt') ||
    t.startsWith('/slide') ||
    /^(buatkan|buat|create|generate)\s+(presentasi|ppt|slide|powerpoint|deck)/i.test(t) ||
    (/\b(presentasi|powerpoint|ppt|slide deck)\b/i.test(t) &&
      /\b(buat|buatkan|create|generate|tolong)\b/i.test(t))
  );
};

// ── Deteksi command generate gambar ───────────────────────────
const isImageCommand = (msg = '') => {
  const t = msg.toLowerCase().trim();
  return (
    t.startsWith('/image') ||
    t.startsWith('/img') ||
    t.startsWith('/gambar') ||
    /^gambarkan\s/i.test(t)
  );
};

// ── Simpan file media sementara ───────────────────────────────
async function saveTempMedia(buffer, mimeType, filename) {
  const ext = mimeType.includes('pdf') ? '.pdf'
    : mimeType.includes('word') ? '.docx'
    : mimeType.includes('excel') ? '.xlsx'
    : mimeType.includes('powerpoint') ? '.pptx'
    : mimeType.includes('image') ? '.jpg'
    : path.extname(filename || '.bin') || '.bin';

  const tmpDir  = path.join(process.cwd(), 'data', 'files', 'tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const tmpName = `waha-${Date.now()}${ext}`;
  const tmpPath = path.join(tmpDir, tmpName);
  await fs.promises.writeFile(tmpPath, buffer);

  return { path: tmpPath, filename: filename || tmpName, mimetype: mimeType };
}

// ── Build system prompt dari bot ──────────────────────────────
function buildSystemPrompt(bot, phoneNumber) {
  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  return [
    bot.prompt || bot.systemPrompt || 'Kamu adalah asisten AI profesional.',
    `[TODAY: ${today}]`,
    `[CHANNEL: WhatsApp | User: ${phoneNumber}]`,
    `PENTING: Balas dalam format WhatsApp. Gunakan *bold* bukan **bold**.
Jangan buat tabel markdown (WA tidak mendukung), gunakan daftar bullet saja.
Jawaban ringkas dan padat — maks 3-4 paragraf kecuali jika diminta detail.`,
  ].filter(Boolean).join('\n\n');
}

// ── Proses knowledge base jika ada ───────────────────────────
function buildKnowledgeContext(bot, message) {
  if (!bot.knowledgeFiles?.length || bot.knowledgeMode === 'disabled') return '';
  return KnowledgeBaseService.buildKnowledgeContext(
    bot.knowledgeFiles, message, bot.knowledgeMode || 'relevant'
  );
}

// ── Proses Smartsheet jika dikonfigurasi ──────────────────────
async function buildSmartsheetContext(bot, message) {
  if (!bot.smartsheetConfig?.enabled) return '';
  const keywords = /\b(list|daftar|status|progress|proyek|project|semua|all|summary|data)\b/i;
  if (!keywords.test(message)) return '';
  try {
    const apiKey  = bot.smartsheetConfig.apiKey || process.env.SMARTSHEET_API_KEY;
    const sheetId = bot.smartsheetConfig.sheetId || process.env.SMARTSHEET_PRIMARY_SHEET_ID;
    if (!apiKey || !sheetId) return '';
    const ss      = new SmartsheetLiveService(apiKey);
    const sheet   = await ss.fetchSheet(sheetId);
    const rows    = ss.processToFlatRows(sheet);
    return rows.length > 0 ? ss.buildAIContext(rows, message, sheet.name) : '';
  } catch (e) {
    console.error('[WA Webhook] Smartsheet error:', e.message);
    return '';
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN WEBHOOK HANDLER
// POST /api/webhook/waha/:botId
// ─────────────────────────────────────────────────────────────
router.post('/waha/:botId', async (req, res) => {
  // Segera balas 200 agar WAHA tidak retry
  res.status(200).json({ ok: true });

  try {
    const { botId } = req.params;
    const body      = req.body;

    // ── 1. Validasi event ────────────────────────────────────
    const event   = body?.event;
    const payload = body?.payload;

    if (event !== 'message' && event !== 'message.any') return;
    if (!payload) return;
    if (payload.fromMe === true) return;  // abaikan pesan dari bot sendiri
    if (payload.type === 'reaction') return;

    const phoneNumber = payload.from || payload.chatId;
    if (!phoneNumber) return;

    const incomingText   = (payload.body || '').trim();
    const hasMedia       = Boolean(payload.hasMedia || payload.media);
    const mediaUrl       = payload.mediaUrl || payload.media?.url;
    const mediaMimeType  = payload.mimetype || payload.media?.mimetype || '';
    const mediaFilename  = payload.filename || payload.media?.filename || 'attachment';
    const displayName    = payload._data?.notifyName || payload.pushName || phoneNumber;

    // ── 2. Load Bot ──────────────────────────────────────────
    const bot = await Bot.findById(botId).lean();
    if (!bot) { console.warn(`[WA Webhook] Bot ${botId} tidak ditemukan`); return; }

    const wahaConfig = bot.wahaConfig;
    if (!wahaConfig?.enabled || !wahaConfig?.endpoint) return;
    // Cek fitur incoming aktif
    if (!wahaConfig.incomingEnabled) return;

    const waha = new WahaService(wahaConfig);

    // ── 3. Command: Reset / Help ─────────────────────────────
    const lowerText = incomingText.toLowerCase();

    if (RESET_COMMANDS.includes(lowerText)) {
      await WahaConversation.findOneAndUpdate(
        { botId, phoneNumber },
        { $set: { history: [], lastActivity: new Date() } }
      );
      await waha.sendText(phoneNumber, `✅ *Percakapan direset!*\nHalo! Saya ${bot.name}, ada yang bisa saya bantu?`);
      return;
    }

    if (HELP_COMMANDS.includes(lowerText)) {
      const helpText = [
        `🤖 *${bot.name}*`,
        bot.description ? `_${bot.description}_` : '',
        '',
        '*Perintah tersedia:*',
        '• Ketik pertanyaan apa saja untuk mulai chat',
        '• Kirim file PDF/dokumen untuk dianalisis',
        '• `/reset` — Mulai percakapan baru',
        '• `/help` — Tampilkan bantuan ini',
        isImageCommand('/image') ? '• `/image [deskripsi]` — Buat gambar' : '',
        isPptCommand('/ppt') ? '• `/ppt [topik]` — Buat presentasi' : '',
        '',
        '*Starter questions:*',
        ...(bot.starterQuestions?.slice(0, 3).map(q => `• ${q}`) || []),
      ].filter(s => s !== null && s !== undefined).join('\n');
      await waha.sendText(phoneNumber, helpText);
      return;
    }

    // ── 4. Load / buat percakapan ────────────────────────────
    let conv = await WahaConversation.findOneAndUpdate(
      { botId, phoneNumber },
      { $set: { lastActivity: new Date(), displayName } },
      { upsert: true, new: true }
    );

    const historyForAI = (conv.history || [])
      .slice(-MAX_HISTORY)
      .map(h => ({ role: h.role, content: h.content }));

    // ── 5. Typing indicator ──────────────────────────────────
    await waha.startTyping(phoneNumber);

    // ── 6. Handle media attachment dari WA ──────────────────
    let attachedFile = null;
    if (hasMedia && mediaUrl) {
      try {
        const { buffer, mimeType } = await waha.downloadMedia(mediaUrl, mediaMimeType);
        attachedFile = await saveTempMedia(buffer, mimeType, mediaFilename);
        console.log(`[WA Webhook] Media saved: ${attachedFile.filename}`);
      } catch (e) {
        console.error('[WA Webhook] Failed to download media:', e.message);
        await waha.stopTyping(phoneNumber);
        await waha.sendText(phoneNumber, '⚠️ Maaf, gagal mengunduh file yang dikirim. Silakan coba lagi.');
        return;
      }
    }

    // ── 7. Handle PPT command ────────────────────────────────
    if (isPptCommand(incomingText)) {
      await waha.stopTyping(phoneNumber);
      await waha.sendText(phoneNumber, `⏳ *Membuat presentasi...*\nMohon tunggu, ini membutuhkan waktu 30-60 detik.`);
      await waha.startTyping(phoneNumber);

      try {
        // Import PptxService dan AIProviderService
        const { default: AICore } = await import('./ai-core.service.js').catch(
          () => import('../services/ai-core.service.js')
        );

        // Buat virtual userId (gunakan phoneNumber sebagai identifier)
        const virtualUserId = `wa_${phoneNumber.replace(/[^a-zA-Z0-9]/g, '_')}`;

        const result = await AICore.processMessage({
          userId:   virtualUserId,
          botId:    bot._id.toString(),
          message:  incomingText,
          threadId: null,
          history:  historyForAI,
        });

        await waha.stopTyping(phoneNumber);

        // Cek apakah response mengandung link file .pptx
        const pptxUrlMatch = result?.response?.match(/\/api\/files\/[^\s)]+\.pptx/);
        if (pptxUrlMatch) {
          const fileUrl  = `${getServerBaseUrl()}${pptxUrlMatch[0]}`;
          const filename = pptxUrlMatch[0].split('/').pop();
          const caption  = '📊 *Presentasi siap!* Silakan unduh file di bawah.';
          await waha.sendFile(phoneNumber, fileUrl, filename, caption);
        } else {
          await waha.sendText(phoneNumber, result?.response || 'Maaf, terjadi kesalahan.');
        }

        // Simpan ke history
        await saveHistory(botId, phoneNumber, incomingText, result?.response || '', MAX_HISTORY);
      } catch (err) {
        await waha.stopTyping(phoneNumber);
        await waha.sendText(phoneNumber, `❌ Gagal membuat presentasi: ${err.message}`);
      }
      return;
    }

    // ── 8. Handle Image generation command ──────────────────
    if (isImageCommand(incomingText)) {
      const prompt = incomingText.replace(/^\/(image|img|gambar)\s*/i, '').trim() || 'Abstract art';
      await waha.stopTyping(phoneNumber);
      await waha.sendText(phoneNumber, '🎨 *Membuat gambar...* Mohon tunggu sebentar.');
      await waha.startTyping(phoneNumber);

      try {
        const { generateImage } = await import('../services/image.service.js');
        const relativeUrl = await generateImage(prompt);
        const fullUrl     = `${getServerBaseUrl()}${relativeUrl}`;

        await waha.stopTyping(phoneNumber);
        await waha.sendImage(phoneNumber, fullUrl, `🎨 ${prompt}`);

        await saveHistory(botId, phoneNumber, incomingText, `[Gambar dibuat: ${prompt}]`, MAX_HISTORY);
        await AuditService.log({
          req,
          category: 'chat', action: 'IMAGE_GENERATE',
          targetId: botId, targetName: bot.name,
          username: phoneNumber,
          detail:   { prompt, channel: 'whatsapp' },
        });
      } catch (err) {
        await waha.stopTyping(phoneNumber);
        await waha.sendText(phoneNumber, `❌ Gagal membuat gambar: ${err.message}`);
      }
      return;
    }

    // ── 9. Normal AI chat ────────────────────────────────────
    const knowledgeCtx   = buildKnowledgeContext(bot, incomingText);
    const smartsheetCtx  = await buildSmartsheetContext(bot, incomingText);
    const contextData    = [knowledgeCtx, smartsheetCtx].filter(Boolean).join('\n\n');

    // Build system prompt
    let systemPrompt = buildSystemPrompt(bot, phoneNumber);
    if (contextData) systemPrompt += `\n\n${contextData}`;

    // Build user content (text + optional file)
    let userContent = incomingText || (hasMedia ? `[File dikirim: ${mediaFilename}]` : '');

    if (attachedFile) {
      // Extract file content
      try {
        const KBService = KnowledgeBaseService;
        const { content } = await KBService.extractContent(
          attachedFile.path, attachedFile.filename, attachedFile.mimetype
        );
        if (content) {
          userContent = `${userContent}\n\n[ISI FILE: ${attachedFile.filename}]\n${content.substring(0, 8000)}\n[AKHIR FILE]`;
        }
      } catch (e) {
        console.warn('[WA Webhook] File extraction failed:', e.message);
      }

      // Hapus tmp file
      setTimeout(() => fs.promises.unlink(attachedFile.path).catch(() => {}), 60000);
    }

    // Panggil AI provider
    const aiResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider,
      systemPrompt,
      messages:       historyForAI,
      userContent,
      capabilities:   { ...bot.capabilities, webSearch: false }, // WA tidak perlu web search native
    });

    const aiText = aiResult?.text || 'Maaf, saya tidak dapat memproses permintaan ini.';

    await waha.stopTyping(phoneNumber);
    await waha.sendText(phoneNumber, aiText);

    // Simpan history
    await saveHistory(botId, phoneNumber, incomingText || `[${mediaFilename}]`, aiText, MAX_HISTORY);

    // Audit log
    await AuditService.log({
      req,
      category: 'chat', action: 'AI_RESPONSE',
      targetId: botId, targetName: bot.name,
      username: phoneNumber,
      detail:   {
        channel: 'whatsapp', model: bot.aiProvider?.model,
        hasMedia, tokens: aiResult?.usage?.total_tokens,
      },
    });

  } catch (error) {
    console.error('[WA Webhook] Unhandled error:', error.message);
    // Jangan kirim error message ke user di sini karena res sudah dikirim
  }
});

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

async function saveHistory(botId, phoneNumber, userMsg, assistantMsg, maxLen) {
  try {
    const newEntries = [];
    if (userMsg)     newEntries.push({ role: 'user',      content: userMsg });
    if (assistantMsg) newEntries.push({ role: 'assistant', content: assistantMsg });

    await WahaConversation.findOneAndUpdate(
      { botId, phoneNumber },
      {
        $push: {
          history: {
            $each:  newEntries,
            $slice: -maxLen,  // Hanya simpan maxLen entry terakhir
          },
        },
        $set: { lastActivity: new Date() },
      },
      { upsert: true }
    );
  } catch (e) {
    console.error('[WA Webhook] saveHistory error:', e.message);
  }
}

function getServerBaseUrl() {
  // Gunakan env var jika ada, fallback ke localhost
  return process.env.SERVER_BASE_URL || `http://server:${process.env.PORT || 5000}`;
}

export default router;
