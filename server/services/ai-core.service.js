// server/services/ai-core.service.js
// Updated: PPT command now passes style description freely to AI designer

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
import PptxService            from './pptx.service.js';

// ─────────────────────────────────────────────────────────────
// PPT Command Detection
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

/**
 * Extract the style description from the message.
 * Everything after "style", "gaya", "tema", "dengan tampilan", "look like" etc.
 * is treated as a free-text style description.
 */
function extractStyleAndTopic(message = '') {
  let text = message
    .replace(/^\/ppt\s*/i, '')
    .replace(/^\/slide\s*/i, '')
    .replace(/^\/presentation\s*/i, '')
    .replace(/^(buatkan|buat|create|generate|tolong buat|please create|please make)\s+(presentasi|ppt|slide|powerpoint|deck)\s+(tentang|about|mengenai|on|untuk|for)?\s*/i, '')
    .trim();

  // Look for style indicator keywords
  const styleMatch = text.match(
    /\b(?:style|gaya|tema|tampilan|dengan gaya|dengan style|look like|looks like|mirip|seperti|ala|inspired by|in the style of)\s+(.+)/i
  );

  let styleRequest = 'professional corporate executive';
  let topic = text;

  if (styleMatch) {
    styleRequest = styleMatch[1].trim();
    topic = text.substring(0, styleMatch.index).trim();
  }

  // Clean topic
  topic = topic
    .replace(/\s*(style|gaya|tema)\s*$/i, '')
    .trim();

  if (!topic) topic = text;

  return { styleRequest, topic };
}

class AICoreService {
  constructor() {
    this.fileManager = new FileManagerService();
  }

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
        const content = workbook.SheetNames.map(n => XLSX.utils.sheet_to_csv(workbook.Sheets[n])).join('\n');
        return `\n\n[ISI FILE: ${originalName}]\n${content.substring(0, 8000)}\n[END FILE]\n`;
      } else {
        return `\n\n[ISI FILE: ${originalName}]\n${fs.readFileSync(physicalPath, 'utf8').substring(0, 8000)}\n[END FILE]\n`;
      }
    } catch { return ''; }
  }

  // ─────────────────────────────────────────────────────────────
  // MAIN
  // ─────────────────────────────────────────────────────────────
  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    if (!threadId) {
      const title = message ? message.substring(0, 30) : `Chat with ${bot.name}`;
      const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
      await newThread.save();
      threadId = newThread._id;
    }

    // ── PPT COMMAND ──────────────────────────────────────────
    if (isPptCommand(message)) {
      return this._handlePptCommand({ userId, botId, bot, message, threadId });
    }

    let contextData = '';

    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
      try {
        const kouventa = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
        const reply = await kouventa.generateResponse(message || '');
        contextData += `\n\n=== REFERENSI DOKUMEN INTERNAL ===\n${reply}\n`;
      } catch (error) { console.error('Kouventa Error:', error.message); }
    }

    if (bot.smartsheetConfig?.enabled && this.isDataQuery(message)) {
      try {
        const apiKey = bot.smartsheetConfig.apiKey || process.env.SMARTSHEET_API_KEY;
        const sheetId = bot.smartsheetConfig.sheetId || bot.smartsheetConfig.primarySheetId || process.env.SMARTSHEET_PRIMARY_SHEET_ID;
        if (apiKey && sheetId) {
          const smartsheet = new SmartsheetLiveService(apiKey);
          const sheet = await smartsheet.fetchSheet(sheetId);
          const flatRows = smartsheet.processToFlatRows(sheet);
          if (flatRows.length > 0) contextData += `\n\n${smartsheet.buildAIContext(flatRows, message, sheet.name)}\n`;
        }
      } catch (e) {
        console.error('Smartsheet Error:', e.message);
        contextData += `\n\n=== DATA SMARTSHEET ===\n❌ Gagal memuat data: ${e.message}\n`;
      }
    }

    if (bot.knowledgeFiles?.length > 0 && bot.knowledgeMode !== 'disabled') {
      const knowledgeCtx = KnowledgeBaseService.buildKnowledgeContext(bot.knowledgeFiles, message, bot.knowledgeMode || 'relevant');
      if (knowledgeCtx) contextData += knowledgeCtx;
    }

    const userContent = [];
    if (message) userContent.push({ type: 'text', text: message });

    if (attachedFile) {
      if (attachedFile.mimetype?.startsWith('image/') && bot.aiProvider?.provider === 'openai') {
        const imgBuffer = fs.readFileSync(attachedFile.path);
        userContent.push({ type: 'image_url', image_url: { url: `data:${attachedFile.mimetype};base64,${imgBuffer.toString('base64')}` } });
      } else {
        const text = await this.extractFileContent(attachedFile);
        if (text) userContent.push({ type: 'text', text });
      }
    }

    const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const systemPrompt = [
      bot.prompt || bot.systemPrompt || '',
      `[HARI INI: ${today}]`,
      contextData,
      contextData ? 'Gunakan data dan knowledge di atas untuk menjawab pertanyaan user secara akurat.' : '',
    ].filter(Boolean).join('\n\n');

    console.log(`🤖 Bot "${bot.name}" | Provider: ${bot.aiProvider?.provider || 'openai'} | Model: ${bot.aiProvider?.model || 'gpt-4o'}`);

    const result = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt,
      messages: history.slice(-6),
      userContent: userContent.length === 1 && userContent[0].type === 'text' ? userContent[0].text : userContent,
    });

    const aiResponse = result.text;
    let savedAttachments = [];

    if (attachedFile) {
      savedAttachments.push({
        name: attachedFile.originalname || attachedFile.filename,
        path: `/api/files/${attachedFile.filename}`,
        serverPath: attachedFile.path,
        type: attachedFile.mimetype?.includes('image') ? 'image' : attachedFile.mimetype?.includes('pdf') ? 'pdf' : 'file',
      });
    }

    await new Chat({ userId, botId, threadId, role: 'user', content: message || '', attachedFiles: savedAttachments }).save();
    await new Chat({ userId, botId, threadId, role: 'assistant', content: aiResponse }).save();
    await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });

    return { response: aiResponse, threadId, attachedFiles: savedAttachments, usage: result.usage };
  }

  // ─────────────────────────────────────────────────────────────
  // PPT COMMAND HANDLER
  // ─────────────────────────────────────────────────────────────
  async _handlePptCommand({ userId, botId, bot, message, threadId }) {
    try {
      const { styleRequest, topic } = extractStyleAndTopic(message);

      const title = topic
        .replace(/^(tentang|about|mengenai|on|untuk|for)\s+/i, '')
        .trim()
        .substring(0, 60) || 'Presentation';

      console.log(`📊 [PPT Command] Topic: "${title}" | Style: "${styleRequest}"`);

      // ── Step 1: Generate slide content ──────────────────────
      const contentResult = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt: `You are an expert presentation writer.
Generate professional slide content in markdown format:

# [Presentation Title]
[One powerful subtitle sentence]

## [Slide Title]
- bullet (max 12 words)
- bullet
- bullet

## [Slide Title]
[2-3 sentences paragraph]

Generate 6-9 content slides. Mix bullets and paragraphs.
Write in the same language as the user request.`,
        messages: [],
        userContent: `Create a professional presentation about: ${topic}`,
      });

      const slideContent = contentResult.text;
      if (!slideContent?.trim()) throw new Error('AI returned empty slide content');

      // ── Step 2: AI designs full PptxGenJS code ───────────────
      const designPrompt = PptxService.buildDesignPrompt({ slideContent, styleRequest, title });

      const designResult = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt: 'You are a JavaScript developer. Return ONLY raw JavaScript code with NO markdown fences and NO explanations.',
        messages: [],
        userContent: designPrompt,
      });

      // ── Step 3: Execute → PPTX file ─────────────────────────
      const outputDir = path.join(process.cwd(), 'data', 'files');
      const result = await PptxService.generateFromAICode({
        aiCode: designResult.text,
        fallbackContent: slideContent,
        title,
        outputDir,
        styleDesc: styleRequest,
      });

      // ── Build response ────────────────────────────────────
      const styleExamples = PptxService.getStyleExamples()
        .slice(0, 5)
        .map(s => `\`${s.example}\``)
        .join('\n');

      const responseMarkdown = `✅ **Presentasi berhasil dibuat!**

📊 **${title}**
🎨 Style: **${styleRequest}**
📑 ~${result.slideCount} slides${result.usedFallback ? ' _(fallback renderer)_' : ''}

---
### [⬇️ Download: ${result.filename}](${result.url})
*Klik link di atas untuk mengunduh file .pptx*

---
💡 **Coba style lainnya:**
${styleExamples}

Tulis style apapun secara bebas — AI akan mendesain sesuai deskripsi Anda.`;

      await new Chat({ userId, botId, threadId, role: 'user', content: message }).save();
      await new Chat({
        userId, botId, threadId, role: 'assistant', content: responseMarkdown,
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
}

export default new AICoreService();