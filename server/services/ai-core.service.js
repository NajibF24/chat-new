// server/services/ai-core.service.js — Updated with multi-provider + knowledge base
// ─────────────────────────────────────────────────────────────
// CHANGELOG vs original:
//   + import PptxService (1 line)
//   + isPptCommand() function (baru)
//   + extractStyleAndTopic() function (baru)
//   + if (isPptCommand(message)) block di processMessage() (3 lines)
//   + _handlePptCommand() method (baru)
//   SEMUA KODE LAIN IDENTIK DENGAN ASLINYA
// ─────────────────────────────────────────────────────────────

import pdf      from 'pdf-parse';
import mammoth  from 'mammoth';
import XLSX     from 'xlsx';
import fs       from 'fs';
import path     from 'path';

import Chat     from '../models/Chat.js';
import Thread   from '../models/Thread.js';
import Bot      from '../models/Bot.js';

import AIProviderService      from './ai-provider.service.js';
import KnowledgeBaseService   from './knowledge-base.service.js';
import SmartsheetLiveService  from './smartsheet-live.service.js';
import FileManagerService     from './file-manager.service.js';
import KouventaService        from './kouventa.service.js';
import PptxService            from './pptx.service.js';  // ← TAMBAHAN BARU

// ─────────────────────────────────────────────────────────────
// ← TAMBAHAN BARU: PPT command detection helpers
// ─────────────────────────────────────────────────────────────
function isPptCommand(message = '') {
  const t = (message || '').trim().toLowerCase();
  return (
    t.startsWith('/ppt') ||
    t.startsWith('/slide') ||
    t.startsWith('/presentation') ||
    /^(buatkan|buat|create|generate|tolong buat|please create|please make)\s+(presentasi|ppt|slide|powerpoint|deck)/i.test(t) ||
    (/\b(presentasi|powerpoint|ppt|slide deck|deck)\b/i.test(t) &&
     /\b(buat|buatkan|create|generate|make|tolong)\b/i.test(t))
  );
}

function extractStyleAndTopic(message = '') {
  let text = message
    .replace(/^\/ppt\s*/i, '')
    .replace(/^\/slide\s*/i, '')
    .replace(/^\/presentation\s*/i, '')
    .replace(/^(buatkan|buat|create|generate|tolong buat|please create|please make)\s+(presentasi|ppt|slide|powerpoint|deck)\s+(?:tentang|about|mengenai|on|untuk|for)?\s*/i, '')
    .trim();

  const styleMatch = text.match(
    /\b(?:style|gaya|tema|tampilan|dengan gaya|dengan style|look like|looks like|mirip|seperti|ala|inspired by|in the style of)\s+(.+?)(?:\s*[-–]\s*(.+))?$/i
  );

  let styleRequest = 'professional corporate executive with charts and photos';
  let topic = text;

  if (styleMatch) {
    styleRequest = styleMatch[0]
      .replace(/^.*?(?:style|gaya|tema|tampilan|dengan gaya|dengan style|look like|looks like|mirip|seperti|ala|inspired by|in the style of)\s+/i, '')
      .trim();
    topic = text.substring(0, styleMatch.index).trim();
  }

  topic = topic.replace(/\s*(style|gaya|tema)\s*$/i, '').trim();
  if (!topic) topic = text;

  return { styleRequest, topic };
}
// ─────────────────────────────────────────────────────────────
// END TAMBAHAN BARU
// ─────────────────────────────────────────────────────────────

class AICoreService {
  constructor() {
    this.fileManager = new FileManagerService();
  }

  // ─── Detect data query ─────────────────────────────────────
  // IDENTIK DENGAN ASLI
  isDataQuery(message) {
    const lowerMsg = (message || '').toLowerCase();
    const keywords = [
      'berikan','cari','list','daftar','semua','all','tampilkan','lihat',
      'show','get','find','temukan','search','project','proyek','dokumen',
      'document','file','tracking','status','progress','summary','analisa',
      'data','total','berapa','latest','terbaru','recent','this week',
      'minggu ini','today','hari ini','update','history','riwayat',
      'modified','upload','added','deleted','edit','activity','siapa','who',
      'overdue','delay','terlambat','laporan','report','health','red',
      'merah','kritis','critical','budget','biaya','cost','anggaran',
      'statistik','stats','count','jumlah','pm','manager','department',
    ];
    return keywords.some(k => lowerMsg.includes(k)) || message.includes('_') || message.includes('.');
  }

  // ─── Extract file content for inline attachment ────────────
  // IDENTIK DENGAN ASLI (termasuk label [ISI FILE] dan [END FILE])
  async extractFileContent(attachedFile) {
    const physicalPath = attachedFile.serverPath || attachedFile.path;
    if (!physicalPath || !fs.existsSync(physicalPath)) return '';
    const originalName = attachedFile.originalname || '';
    const ext = path.extname(originalName).toLowerCase();
    try {
      if (ext === '.pdf') {
        const data = await pdf(fs.readFileSync(physicalPath));
        return `\n\n[ISI FILE: ${originalName}]\n${data.text.substring(0, 8000)}\n[END FILE]\n`;
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: physicalPath });
        return `\n\n[ISI FILE: ${originalName}]\n${result.value.substring(0, 8000)}\n[END FILE]\n`;
      } else if (ext === '.xlsx' || ext === '.xls') {
        const workbook = XLSX.readFile(physicalPath);
        const content  = workbook.SheetNames.map(n => XLSX.utils.sheet_to_csv(workbook.Sheets[n])).join('\n');
        return `\n\n[ISI FILE: ${originalName}]\n${content.substring(0, 8000)}\n[END FILE]\n`;
      } else {
        return `\n\n[ISI FILE: ${originalName}]\n${fs.readFileSync(physicalPath, 'utf8').substring(0, 8000)}\n[END FILE]\n`;
      }
    } catch { return ''; }
  }

  // ─────────────────────────────────────────────────────────────
  // MAIN: Process message
  // IDENTIK DENGAN ASLI + 3 baris PPT check di awal
  // ─────────────────────────────────────────────────────────────
  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    // Create thread if needed — IDENTIK DENGAN ASLI
    if (!threadId) {
      const title     = message ? message.substring(0, 30) : `Chat with ${bot.name}`;
      const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
      await newThread.save();
      threadId = newThread._id;
    }

    // ← TAMBAHAN BARU: PPT command intercept
    if (isPptCommand(message)) {
      return this._handlePptCommand({ userId, botId, bot, message, threadId, history });
    }
    // END TAMBAHAN BARU ──────────────────────────────────────

    let contextData = '';

    // ── 1. KOUVENTA ── IDENTIK DENGAN ASLI
    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
      try {
        const kouventa = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
        const reply    = await kouventa.generateResponse(message || '');
        contextData   += `\n\n=== REFERENSI DOKUMEN INTERNAL ===\n${reply}\n`;
      } catch (error) { console.error('Kouventa Error:', error.message); }
    }

    // ── 2. SMARTSHEET LIVE ── IDENTIK DENGAN ASLI
    if (bot.smartsheetConfig?.enabled && this.isDataQuery(message)) {
      try {
        const apiKey  = bot.smartsheetConfig.apiKey || process.env.SMARTSHEET_API_KEY;
        const sheetId = bot.smartsheetConfig.sheetId || bot.smartsheetConfig.primarySheetId || process.env.SMARTSHEET_PRIMARY_SHEET_ID;
        if (apiKey && sheetId) {
          const smartsheet = new SmartsheetLiveService(apiKey);
          const sheet      = await smartsheet.fetchSheet(sheetId);
          const flatRows   = smartsheet.processToFlatRows(sheet);
          if (flatRows.length > 0) {
            contextData += `\n\n${smartsheet.buildAIContext(flatRows, message, sheet.name)}\n`;
          }
        }
      } catch (e) {
        console.error('Smartsheet Error:', e.message);
        contextData += `\n\n=== DATA SMARTSHEET ===\n❌ Gagal memuat data: ${e.message}\n`;
      }
    }

    // ── 3. KNOWLEDGE BASE (RAG) ── IDENTIK DENGAN ASLI
    if (bot.knowledgeFiles?.length > 0 && bot.knowledgeMode !== 'disabled') {
      const knowledgeCtx = KnowledgeBaseService.buildKnowledgeContext(
        bot.knowledgeFiles, message, bot.knowledgeMode || 'relevant'
      );
      if (knowledgeCtx) contextData += knowledgeCtx;
    }

    // ── 4. BUILD USER MESSAGE CONTENT ── IDENTIK DENGAN ASLI
    const userContent = [];
    if (message) userContent.push({ type: 'text', text: message });

    if (attachedFile) {
      if (attachedFile.mimetype?.startsWith('image/') && bot.aiProvider?.provider === 'openai') {
        // Vision for OpenAI
        const imgBuffer = fs.readFileSync(attachedFile.path);
        userContent.push({
          type: 'image_url',
          image_url: { url: `data:${attachedFile.mimetype};base64,${imgBuffer.toString('base64')}` },
        });
      } else {
        // Extract text for all providers
        const text = await this.extractFileContent(attachedFile);
        if (text) userContent.push({ type: 'text', text });
      }
    }

    const today = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // IDENTIK DENGAN ASLI — termasuk kalimat panjang "Jangan mengarang fakta"
    const systemPrompt = [
      bot.prompt || bot.systemPrompt || '',
      `[HARI INI: ${today}]`,
      contextData,
      contextData
        ? 'Gunakan data dan knowledge di atas untuk menjawab pertanyaan user secara akurat. Jangan mengarang fakta yang tidak ada di data.'
        : '',
    ].filter(Boolean).join('\n\n');

    // IDENTIK DENGAN ASLI — termasuk log tokens
    console.log(`🤖 Bot "${bot.name}" | Provider: ${bot.aiProvider?.provider || 'openai'} | Model: ${bot.aiProvider?.model || 'gpt-4o'}`);
    console.log(`📝 System prompt: ~${Math.ceil(systemPrompt.length / 4)} tokens`);

    // ── 5. CALL AI PROVIDER ── IDENTIK DENGAN ASLI
    const result = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt,
      messages: history.slice(-6),
      userContent: userContent.length === 1 && userContent[0].type === 'text'
        ? userContent[0].text
        : userContent,
    });

    const aiResponse = result.text;

    // ── 6. SAVE TO DB ── IDENTIK DENGAN ASLI
    let savedAttachments = [];
    if (attachedFile) {
      savedAttachments.push({
        name: attachedFile.originalname || attachedFile.filename,
        path: `/api/files/${attachedFile.filename}`,
        serverPath: attachedFile.path,
        type: attachedFile.mimetype?.includes('image') ? 'image'
          : attachedFile.mimetype?.includes('pdf') ? 'pdf' : 'file',
      });
    }

    await new Chat({ userId, botId, threadId, role: 'user', content: message || '', attachedFiles: savedAttachments }).save();
    await new Chat({ userId, botId, threadId, role: 'assistant', content: aiResponse }).save();

    await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });

    // IDENTIK DENGAN ASLI (tidak ada usage di return asli — dijaga sama)
    return { response: aiResponse, threadId, attachedFiles: savedAttachments };
  }

  // ─────────────────────────────────────────────────────────────
  // ← TAMBAHAN BARU SELURUHNYA: _handlePptCommand
  // Tidak mengubah apapun di method lain
  // ─────────────────────────────────────────────────────────────
  async _handlePptCommand({ userId, botId, bot, message, threadId, history = [] }) {
    try {
      // ── Deteksi style dari pesan sekarang, atau cari di history ──
      let { styleRequest, topic } = extractStyleAndTopic(message);

      // Jika style tidak disebut di pesan terakhir, cari di history chat sebelumnya
      if (styleRequest === 'professional corporate executive with charts and photos' && history.length > 0) {
        const historyText = history.map(h => h.content || '').join('\n');
        const historyStyle = extractStyleAndTopic(historyText);
        if (historyStyle.styleRequest !== 'professional corporate executive with charts and photos') {
          styleRequest = historyStyle.styleRequest;
          console.log(`📊 [PPT] Style ditemukan dari history: "${styleRequest}"`);
        }
      }

      const title = topic
        .replace(/^(tentang|about|mengenai|on|untuk|for)\s+/i, '')
        .trim()
        .substring(0, 60) || 'Presentation';

      console.log(`📊 [PPT] Topic: "${title}" | Style: "${styleRequest}"`);

      // ── Cek apakah ada konten/outline di history yang bisa langsung dipakai ──
      // Jika user bilang "berdasar itu", "dari itu", "sesuai itu" dll → pakai history sebagai konten
      const refersToHistory = /\b(berdasar|berdasarkan|dari|sesuai|pakai|gunakan|itu|tadi|di atas|sebelumnya|tersebut)\b/i.test(message);
      let slideContent = '';

      if (refersToHistory && history.length > 0) {
        // Ambil konten dari pesan-pesan sebelumnya (terutama assistant yang punya outline)
        const previousContent = history
          .filter(h => h.content && h.content.length > 100)
          .map(h => h.content)
          .join('\n\n---\n\n');

        if (previousContent.trim()) {
          console.log(`📊 [PPT] Menggunakan konten dari history (${previousContent.length} chars)`);

          // Minta AI untuk mengkonversi/merapikan outline dari history menjadi slide content
          const reworkRes = await AIProviderService.generateCompletion({
            providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
            systemPrompt: `You are an expert presentation writer.
The user wants to turn existing content/outline from the conversation into presentation slides.
Convert the provided content into clean slide markdown format:

# [Presentation Title]
[One powerful subtitle]

## [Slide Title]
- bullet (max 12 words)
- bullet

## [Slide Title]
[paragraph content]

Rules:
- Keep ALL the original content, ideas, and structure — do not invent new content
- Extract every section/point from the source material
- Generate as many slides as needed to cover all the content (typically 6-10)
- Match the original language (Indonesian/English)
- Preserve speaker script/notes in parentheses at end of each slide if present`,
            messages: [],
            userContent: `Convert this existing outline/content into slide format:\n\n${previousContent.substring(0, 6000)}`,
          });
          slideContent = reworkRes.text;
        }
      }

      // Jika tidak ada history yang relevan → generate konten baru dari topic
      if (!slideContent?.trim()) {
        console.log(`📊 [PPT] Generating fresh content for topic: "${topic}"`);
        const contentRes = await AIProviderService.generateCompletion({
          providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
          systemPrompt: `You are an expert presentation writer.
Generate professional slide content in markdown format:

# [Presentation Title]
[One powerful subtitle sentence]

## [Slide Title]
- bullet point (max 12 words)
- bullet point
- bullet point

## [Slide Title]
[2-3 sentences of paragraph content]

Rules:
- Generate 6-9 content slides total
- Mix bullet slides and paragraph slides for variety
- Include realistic numbers/data where relevant
- Language: match the user's request language (Indonesian or English)`,
          messages: [],
          userContent: `Create a professional presentation about: ${topic}`,
        });
        slideContent = contentRes.text;
      }

      if (!slideContent?.trim()) throw new Error('AI returned empty slide content');

      // Step 2: AI generates full PptxGenJS design code
      const designRes = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt: 'You are a JavaScript developer. Return ONLY raw JavaScript code. No markdown fences. No explanations.',
        messages: [],
        userContent: PptxService.buildDesignPrompt({ slideContent, styleRequest, title, topic }),
      });

      // Step 3: Execute code → write .pptx file
      const outputDir = path.join(process.cwd(), 'data', 'files');
      const result = await PptxService.generateFromAICode({
        aiCode: designRes.text,
        fallbackContent: slideContent,
        title,
        outputDir,
        styleDesc: styleRequest,
      });

      // Step 4: Build response markdown
      const styleList = PptxService.getStyleExamples()
        .slice(0, 5)
        .map(s => `• \`${s.example}\``)
        .join('\n');

      const responseMarkdown = `✅ **Presentasi berhasil dibuat!**

📊 **${title}**
🎨 Style: **${styleRequest}**
📑 ~${result.slideCount} slides${result.usedFallback ? ' _(fallback renderer)_' : ' — dengan charts, foto & infografis'}

---
### [⬇️ Download: ${result.filename}](${result.url})
*Klik link di atas untuk download file .pptx*

---
💡 **Style lain yang bisa dicoba:**
${styleList}

Deskripsikan style apapun secara bebas — AI akan mendesain sesuai permintaan.`;

      await new Chat({ userId, botId, threadId, role: 'user', content: message }).save();
      await new Chat({
        userId, botId, threadId, role: 'assistant',
        content: responseMarkdown,
        attachedFiles: [{ name: result.filename, path: result.url, type: 'file', size: '0' }],
      }).save();
      await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });

      return {
        response: responseMarkdown,
        threadId,
        attachedFiles: [{ name: result.filename, path: result.url, type: 'file', size: '0' }],
      };

    } catch (error) {
      console.error('❌ [PPT Command]', error);
      throw new Error(`Gagal membuat presentasi: ${error.message}`);
    }
  }
  // END TAMBAHAN BARU ──────────────────────────────────────────
}

export default new AICoreService();