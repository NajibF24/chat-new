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
      // ─────────────────────────────────────────────────────────
      // STEP 0: Ambil history langsung dari DB (lebih reliable
      // daripada mengandalkan history yang dikirim frontend)
      // ─────────────────────────────────────────────────────────
      let dbHistory = [];
      try {
        if (threadId) {
          // Query by threadId — paling akurat
          dbHistory = await Chat.find({ threadId })
            .sort({ createdAt: 1 })
            .limit(30)
            .lean();
        } else {
          // Fallback: ambil dari userId+botId (thread baru, belum punya ID)
          dbHistory = await Chat.find({ userId, botId })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();
          dbHistory = dbHistory.reverse();
        }
        // Exclude pesan PPT command yang sekarang (belum disave, tapi jaga-jaga)
        dbHistory = dbHistory.filter(h =>
          h.content && !isPptCommand(h.content)
        );
        console.log(`📊 [PPT] DB history: ${dbHistory.length} pesan dari threadId=${threadId}`);
      } catch (e) {
        console.warn('⚠️ [PPT] Gagal ambil history dari DB:', e.message);
        dbHistory = history;
      }

      const allHistory = dbHistory.length > 0 ? dbHistory : history;

      // ─────────────────────────────────────────────────────────
      // STEP 1: Deteksi apakah user merujuk ke konten sebelumnya
      // ─────────────────────────────────────────────────────────
      // Kata kunci referensi: "itu", "tadi", "berdasar", dll
      const refersToHistory = /\b(berdasar|berdasarkan|dari|sesuai|pakai|gunakan|itu|tadi|di atas|sebelumnya|tersebut|nya|ini)\b/i.test(message)
        || message.trim().length < 60; // pesan pendek hampir pasti merujuk ke sebelumnya

      // Kumpulkan semua konten dari history yang substantial (>150 char)
      const historicalContent = allHistory
        .filter(h => h.content && h.content.length > 150)
        .map(h => `[${h.role === 'assistant' ? 'ASSISTANT' : 'USER'}]:\n${h.content}`)
        .join('\n\n---\n\n');

      const hasRelevantHistory = historicalContent.trim().length > 200;

      console.log(`📊 [PPT] refersToHistory=${refersToHistory} | hasHistory=${hasRelevantHistory} | historyItems=${allHistory.length}`);

      // ─────────────────────────────────────────────────────────
      // STEP 2: Deteksi style — dari pesan sekarang ATAU history
      // ─────────────────────────────────────────────────────────
      let { styleRequest, topic } = extractStyleAndTopic(message);
      const DEFAULT_STYLE = 'professional corporate executive with charts and photos';

      if (styleRequest === DEFAULT_STYLE && hasRelevantHistory) {
        // Cari style keyword di seluruh history
        const historyStyleMatch = extractStyleAndTopic(historicalContent);
        if (historyStyleMatch.styleRequest !== DEFAULT_STYLE) {
          styleRequest = historyStyleMatch.styleRequest;
          console.log(`📊 [PPT] Style dari history: "${styleRequest}"`);
        }
        // Cari juga keyword Apple/McKinsey/dark dll secara eksplisit
        const styleKeywords = historicalContent.match(/\b(apple keynote|mckinsey|dark futuristic|startup pitch|bloomberg|minimal|cinematic|hitam|black background|navy|gradient)\b/gi);
        if (styleKeywords && styleRequest === DEFAULT_STYLE) {
          styleRequest = styleKeywords.slice(0, 3).join(', ') + ' style';
          console.log(`📊 [PPT] Style dari keyword scan: "${styleRequest}"`);
        }
      }

      // ─────────────────────────────────────────────────────────
      // STEP 3: Siapkan slide content
      // ─────────────────────────────────────────────────────────
      let slideContent = '';
      let title = 'Presentation';

      if (refersToHistory && hasRelevantHistory) {
        // ── CASE A: Ada outline/konten di history → konversi langsung ──
        console.log(`📊 [PPT] Converting ${historicalContent.length} chars of history to slides`);

        const reworkRes = await AIProviderService.generateCompletion({
          providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
          systemPrompt: `You are an expert presentation writer.
The user wants to turn existing content/outline from this conversation into a PowerPoint presentation.

Your job:
1. Extract ALL content from the conversation history provided
2. Convert it into clean slide markdown format
3. Preserve ALL original ideas, titles, sections, bullets, and scripts
4. Do NOT invent new content — only use what is already in the conversation

Output format:
# [Exact Presentation Title from the content]
[Subtitle from the content]

## [Slide Title exactly as in the source]
- bullet from source (keep original wording)
- bullet from source

[SCRIPT: speaker notes if present in source]

## [Next Slide Title]
[paragraph if the source uses paragraphs]

Rules:
- Generate exactly as many slides as there are sections in the source
- Keep SLIDE TITLES exactly as in the source (e.g. "EXECUTIVE HERO", "CURRENT STATE", etc.)
- Keep ALL bullet points from the source verbatim
- Keep ALL speaker scripts/notes
- Language: keep original language (English/Indonesian as in source)`,
          messages: [],
          userContent: `Convert this conversation content into slide format. Extract every slide, section, title, bullet, and script:\n\n${historicalContent.substring(0, 8000)}`,
        });

        slideContent = reworkRes.text;

        // Ekstrak judul dari konten yang dikonversi
        const titleMatch = slideContent.match(/^#\s+(.+)/m);
        if (titleMatch) {
          title = titleMatch[1].trim().substring(0, 60);
        } else {
          // Cari judul dari history langsung
          const titleScan = historicalContent.match(/TITLE[:\s]+([^\n]{5,60})/i)
            || historicalContent.match(/^#\s+(.+)/m);
          if (titleScan) title = titleScan[1].replace(/[*_]/g, '').trim().substring(0, 60);
        }

      } else {
        // ── CASE B: Tidak ada history → generate konten baru dari topic ──
        let { topic: extractedTopic } = extractStyleAndTopic(message);
        extractedTopic = extractedTopic
          .replace(/^(tentang|about|mengenai|on|untuk|for)\s+/i, '')
          .trim() || 'Presentation';
        title = extractedTopic.substring(0, 60);

        console.log(`📊 [PPT] Generating fresh content for: "${title}"`);

        const contentRes = await AIProviderService.generateCompletion({
          providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
          systemPrompt: `You are an expert presentation writer.
Generate professional slide content in markdown format:

# [Presentation Title]
[One powerful subtitle]

## [Slide Title]
- bullet (max 12 words)
- bullet

## [Slide Title]
[2-3 sentence paragraph]

Rules:
- 6-9 content slides
- Mix bullets and paragraphs
- Include realistic data/numbers
- Language: match user's language`,
          messages: [],
          userContent: `Create a professional presentation about: ${extractedTopic}`,
        });
        slideContent = contentRes.text;

        const titleMatch2 = slideContent.match(/^#\s+(.+)/m);
        if (titleMatch2) title = titleMatch2[1].trim().substring(0, 60);
      }

      if (!slideContent?.trim()) throw new Error('AI returned empty slide content');
      console.log(`📊 [PPT] Title: "${title}" | Style: "${styleRequest}" | Content: ${slideContent.length} chars`);

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
