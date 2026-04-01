// server/routes/webhook.js
// POST /api/webhook/waha/:botId
// Menerima incoming message dari WAHA, proses via AI, kirim balik

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

// ── Konstanta ─────────────────────────────────────────────────
const MAX_HISTORY    = 12;
const RESET_COMMANDS = ['/reset', '/clear', '/mulai', 'reset', 'clear'];
const HELP_COMMANDS  = ['/help', '/bantuan', 'help', 'bantuan', '/start'];

// Base URL internal — user & WAHA harus bisa akses ini (jaringan GYS)
const SERVER_INTERNAL_URL = (process.env.SERVER_INTERNAL_URL || 'http://172.16.31.48:8080').replace(/\/$/, '');

// ── Deteksi PPT command ───────────────────────────────────────
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

// ── Deteksi Image command ─────────────────────────────────────
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
  const ext = mimeType.includes('pdf')         ? '.pdf'
    : mimeType.includes('word')                ? '.docx'
    : mimeType.includes('excel') ||
      mimeType.includes('spreadsheet')         ? '.xlsx'
    : mimeType.includes('powerpoint') ||
      mimeType.includes('presentation')        ? '.pptx'
    : mimeType.includes('image/jpeg')          ? '.jpg'
    : mimeType.includes('image/png')           ? '.png'
    : mimeType.includes('image')               ? '.jpg'
    : path.extname(filename || '').toLowerCase() || '.bin';

  const tmpDir  = path.join(process.cwd(), 'data', 'files', 'tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const tmpName = `waha-${Date.now()}${ext}`;
  const tmpPath = path.join(tmpDir, tmpName);
  await fs.promises.writeFile(tmpPath, buffer);

  return { path: tmpPath, filename: filename || tmpName, mimetype: mimeType };
}

// ── Download media dari WAHA dengan berbagai strategi ─────────
async function downloadWahaMedia(wahaConfig, payload) {
  const candidateUrls = [
    payload.media?.url,
    payload.mediaUrl,
    payload._data?.body,
    payload.body?.startsWith?.('http') ? payload.body : null,
  ].filter(Boolean);

  const mimeType = payload.mimetype
    || payload.media?.mimetype
    || payload._data?.mimetype
    || 'application/octet-stream';

  const filename = payload.filename
    || payload.media?.filename
    || payload._data?.filename
    || `file-${Date.now()}`;

  if (candidateUrls.length === 0) {
    throw new Error('Tidak ada URL media yang ditemukan di payload');
  }

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
        const urlObj    = new URL(rawUrl);
        const baseObj   = new URL(wahaBaseUrl);
        urlObj.hostname = baseObj.hostname;
        urlObj.port     = baseObj.port;
        urlObj.protocol = baseObj.protocol;
        downloadUrl     = urlObj.toString();
      }

      console.log(`[WA Webhook] Trying download: ${downloadUrl}`);
      const res = await axios.get(downloadUrl, {
        headers,
        responseType: 'arraybuffer',
        timeout:      20000,
      });

      const buffer = Buffer.from(res.data);
      const mime   = res.headers['content-type']?.split(';')[0] || mimeType;
      console.log(`[WA Webhook] Media downloaded OK: ${buffer.length} bytes, type: ${mime}`);
      return { buffer, mimeType: mime, filename };

    } catch (err) {
      console.warn(`[WA Webhook] Download failed for ${rawUrl}: ${err.message}`);
      continue;
    }
  }

  const messageId = payload.id || payload._data?.id?.id;
  if (messageId) {
    try {
      const apiUrl = `${wahaBaseUrl}/api/files/${wahaConfig.session || 'default'}/${messageId}`;
      console.log(`[WA Webhook] Trying WAHA files API: ${apiUrl}`);
      const res = await axios.get(apiUrl, {
        headers,
        responseType: 'arraybuffer',
        timeout:      20000,
      });
      const buffer = Buffer.from(res.data);
      const mime   = res.headers['content-type']?.split(';')[0] || mimeType;
      return { buffer, mimeType: mime, filename };
    } catch (err) {
      console.warn(`[WA Webhook] WAHA files API also failed: ${err.message}`);
    }
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
- Gunakan _italic_ bukan _italic_  
- Jangan buat tabel markdown (WA tidak mendukung), gunakan daftar bullet
- Jawaban ringkas dan padat — maks 3-4 paragraf kecuali diminta detail
- Untuk list gunakan bullet • bukan -`,
  ].filter(Boolean).join('\n\n');
}

// ── Knowledge base context ────────────────────────────────────
function buildKnowledgeContext(bot, message) {
  if (!bot.knowledgeFiles?.length || bot.knowledgeMode === 'disabled') return '';
  return KnowledgeBaseService.buildKnowledgeContext(
    bot.knowledgeFiles, message, bot.knowledgeMode || 'relevant'
  );
}

// ── Smartsheet context ────────────────────────────────────────
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

// ── Simpan history percakapan ─────────────────────────────────
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

// ── Kirim file via WAHA — URL-first, fallback ke link teks ────
async function sendFileWithFallback(waha, wahaConfig, phoneNumber, fileUrl, filename, caption) {
  try {
    // WAHA fetch file dari URL lalu forward ke WhatsApp
    await waha.post('/api/sendFile', {
      session: wahaConfig.session || 'default',
      chatId:  phoneNumber,
      file:    { url: fileUrl, filename },
      caption,
    });
    console.log(`[WA Webhook] sendFile via URL OK: ${filename}`);
  } catch (err) {
    console.warn(`[WA Webhook] sendFile gagal (${err?.response?.status || err.message}), fallback ke link teks`);
    // Fallback: kirim link — user bisa buka di browser (selama di jaringan GYS)
    await waha.sendText(phoneNumber,
      `${caption}\n\n` +
      `📥 *Download file:*\n${fileUrl}\n\n` +
      `_Buka link di browser HP kamu (pastikan terhubung jaringan GYS)_`
    );
  }
}

// ── Kirim gambar via WAHA — URL-first, fallback ke link teks ──
async function sendImageWithFallback(waha, wahaConfig, phoneNumber, imageUrl, caption) {
  try {
    // WAHA fetch gambar dari URL lalu forward ke WhatsApp
    await waha.post('/api/sendImage', {
      session: wahaConfig.session || 'default',
      chatId:  phoneNumber,
      file:    { url: imageUrl },
      caption,
    });
    console.log(`[WA Webhook] sendImage via URL OK`);
  } catch (err) {
    console.warn(`[WA Webhook] sendImage gagal (${err?.response?.status || err.message}), fallback ke link teks`);
    // Fallback: kirim link — user bisa buka di browser
    await waha.sendText(phoneNumber,
      `${caption}\n\n` +
      `🖼️ *Lihat gambar:*\n${imageUrl}\n\n` +
      `_Buka link di browser HP kamu (pastikan terhubung jaringan GYS)_`
    );
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

    if (!['message', 'message.any'].includes(event)) return;
    if (!payload) return;
    if (payload.fromMe === true) return;
    if (payload.type === 'reaction') return;

    const phoneNumber   = payload.from || payload.chatId;
    if (!phoneNumber) return;

    const incomingText  = (payload.body || '').trim();
    const hasMedia      = Boolean(payload.hasMedia || payload.media || payload.mediaUrl);
    const mediaMimeType = payload.mimetype || payload.media?.mimetype || '';
    const mediaFilename = payload.filename || payload.media?.filename || 'attachment';
    const displayName   = payload._data?.notifyName || payload.pushName || phoneNumber;

    console.log(`[WA Webhook] From: ${phoneNumber} | Text: "${incomingText}" | hasMedia: ${hasMedia}`);

    // ── 2. Load Bot ──────────────────────────────────────────
    const bot = await Bot.findById(botId).lean();
    if (!bot) { console.warn(`[WA Webhook] Bot ${botId} tidak ditemukan`); return; }

    const wahaConfig = bot.wahaConfig;
    if (!wahaConfig?.enabled || !wahaConfig?.endpoint) {
      console.warn(`[WA Webhook] WAHA tidak diaktifkan di bot ${botId}`); return;
    }
    if (!wahaConfig.incomingEnabled) {
      console.warn(`[WA Webhook] Incoming tidak diaktifkan di bot ${botId}`); return;
    }

    const waha = new WahaService(wahaConfig);

    // ── 3. Command: Reset / Help ─────────────────────────────
    const lowerText = incomingText.toLowerCase();

    if (RESET_COMMANDS.includes(lowerText)) {
      await WahaConversation.findOneAndUpdate(
        { botId, phoneNumber },
        { $set: { history: [], lastActivity: new Date() } }
      );
      await waha.sendText(phoneNumber,
        `✅ *Percakapan direset!*\n\nHalo! Saya *${bot.name}*, ada yang bisa saya bantu?\n\nKetik */help* untuk melihat daftar perintah.`
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
      if (bot.starterQuestions?.length > 0) {
        helpLines.push('', '*Contoh pertanyaan:*');
        bot.starterQuestions.slice(0, 3).forEach(q => helpLines.push(`• ${q}`));
      }
      await waha.sendText(phoneNumber, helpLines.filter(l => l !== null && l !== undefined).join('\n'));
      return;
    }

    // ── 4. Load / buat percakapan ────────────────────────────
    const conv = await WahaConversation.findOneAndUpdate(
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
    if (hasMedia) {
      try {
        const { buffer, mimeType, filename } = await downloadWahaMedia(wahaConfig, payload);
        attachedFile = await saveTempMedia(buffer, mimeType, filename);
        console.log(`[WA Webhook] Media saved: ${attachedFile.filename} (${attachedFile.mimetype})`);
      } catch (e) {
        console.error('[WA Webhook] Failed to download media:', e.message);
        await waha.stopTyping(phoneNumber);
        await waha.sendText(phoneNumber,
          `⚠️ Maaf, gagal mengunduh file yang dikirim.\n\nPastikan file tidak terlalu besar (maks 20MB) dan coba lagi.`
        );
        return;
      }
    }

    // ── 7. Handle PPT command ────────────────────────────────
    if (isPptCommand(incomingText)) {
      await waha.stopTyping(phoneNumber);
      await waha.sendText(phoneNumber,
        `⏳ *Membuat presentasi...*\nMohon tunggu, ini membutuhkan waktu 30-60 detik.`
      );
      await waha.startTyping(phoneNumber);

      try {
        const AICoreModule = await import('../services/ai-core.service.js');
        const AICore       = AICoreModule.default;

        const virtualUserId = bot.createdBy || bot._id;

        const result = await AICore.processMessage({
          userId:   virtualUserId,
          botId:    bot._id.toString(),
          message:  incomingText,
          threadId: null,
          history:  historyForAI,
        });

        await waha.stopTyping(phoneNumber);

        // Cek apakah response mengandung path file .pptx
        const pptxUrlMatch = result?.response?.match(/\/api\/files\/[^\s)"]+\.pptx/);
        if (pptxUrlMatch) {
          const relativePath = pptxUrlMatch[0].replace('/api/files/', '');
          const filePath     = path.join(process.cwd(), 'data', 'files', relativePath);
          const filename     = relativePath.split('/').pop();

          if (fs.existsSync(filePath)) {
            const fileUrl = `${SERVER_INTERNAL_URL}/api/files/${relativePath}`;
            await sendFileWithFallback(
              waha, wahaConfig, phoneNumber,
              fileUrl, filename,
              `📊 *Presentasi siap!*\nFile: ${filename}`
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

    // ── 8. Handle Image generation command ──────────────────
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

        // Bentuk URL internal yang bisa diakses di jaringan GYS
        const imageUrl = `${SERVER_INTERNAL_URL}${relativeUrl}`;

        await waha.stopTyping(phoneNumber);

        await sendImageWithFallback(
          waha, wahaConfig, phoneNumber,
          imageUrl,
          `🎨 ${prompt}`
        );

        // Hapus file sementara setelah 5 menit
        const filePath = path.join(process.cwd(), 'data', 'files',
          relativeUrl.replace('/api/files/', ''));
        setTimeout(() => fs.promises.unlink(filePath).catch(() => {}), 5 * 60 * 1000);

        await saveHistory(botId, phoneNumber, incomingText, `[Gambar dibuat: ${prompt}]`, MAX_HISTORY);

        await AuditService.log({
          req,
          category: 'chat', action: 'IMAGE_GENERATE',
          targetId: botId, targetName: bot.name,
          username: phoneNumber,
          detail:   { prompt, channel: 'whatsapp' },
        });

      } catch (err) {
        console.error('[WA Webhook] Image error:', err);
        await waha.stopTyping(phoneNumber);
        await waha.sendText(phoneNumber, `❌ Gagal membuat gambar: ${err.message}`);
      }
      return;
    }

    // ── 9. Normal AI chat ────────────────────────────────────
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
            console.log(`[WA Webhook] File extracted: ${attachedFile.filename} (${content.length} chars)`);
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
      req,
      category: 'chat', action: 'AI_RESPONSE',
      targetId: botId, targetName: bot.name,
      username: phoneNumber,
      detail: {
        channel:  'whatsapp',
        model:    bot.aiProvider?.model,
        hasMedia,
        tokens:   aiResult?.usage?.total_tokens,
      },
    });

  } catch (error) {
    console.error('[WA Webhook] Unhandled error:', error.message, error.stack);
  }
});

export default router;
