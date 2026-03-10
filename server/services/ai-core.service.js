// server/services/ai-core.service.js — Updated with multi-provider + knowledge base + PPTX

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

// ── PPT Style aliases (for natural language detection) ────────
const PPT_STYLE_ALIASES = {
  corporate: ['corporate', 'navy', 'executive', 'profesional', 'formal', 'a'],
  modern:    ['modern', 'teal', 'startup', 'tech', 'clean', 'b'],
  bold:      ['bold', 'red', 'merah', 'tegas', 'marketing', 'c'],
  minimal:   ['minimal', 'dark', 'gelap', 'premium', 'simple', 'd'],
  warm:      ['warm', 'terracotta', 'hangat', 'earthy', 'consultancy', 'e'],
};

function detectPptStyle(message = '') {
  const lower = message.toLowerCase();
  for (const [style, aliases] of Object.entries(PPT_STYLE_ALIASES)) {
    if (aliases.some(alias => lower.includes(alias))) return style;
  }
  return 'corporate'; // default
}

function isPptCommand(message = '') {
  const lower = (message || '').trim().toLowerCase();
  return (
    lower.startsWith('/ppt') ||
    lower.startsWith('/slide') ||
    lower.startsWith('/presentation') ||
    /^(buatkan|buat|create|generate|tolong buat)\s+(presentasi|ppt|slide|powerpoint)/i.test(lower) ||
    /\b(presentasi|powerpoint|ppt|slide deck)\b/.test(lower) && /\b(buat|buatkan|create|generate|make)\b/.test(lower)
  );
}

class AICoreService {
  constructor() {
    this.fileManager = new FileManagerService();
  }

  // ─── Detect data query ─────────────────────────────────────
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
  // ─────────────────────────────────────────────────────────────
  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    // Create thread if needed
    if (!threadId) {
      const title     = message ? message.substring(0, 30) : `Chat with ${bot.name}`;
      const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
      await newThread.save();
      threadId = newThread._id;
    }

    // ── PPT GENERATION COMMAND ───────────────────────────────
    if (isPptCommand(message)) {
      return this._handlePptCommand({ userId, botId, bot, message, threadId });
    }

    let contextData = '';

    // ── 1. KOUVENTA ──────────────────────────────────────────
    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
      try {
        const kouventa = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
        const reply    = await kouventa.generateResponse(message || '');
        contextData   += `\n\n=== REFERENSI DOKUMEN INTERNAL ===\n${reply}\n`;
      } catch (error) { console.error('Kouventa Error:', error.message); }
    }

    // ── 2. SMARTSHEET LIVE ───────────────────────────────────
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

    // ── 3. KNOWLEDGE BASE (RAG) ──────────────────────────────
    if (bot.knowledgeFiles?.length > 0 && bot.knowledgeMode !== 'disabled') {
      const knowledgeCtx = KnowledgeBaseService.buildKnowledgeContext(
        bot.knowledgeFiles, message, bot.knowledgeMode || 'relevant'
      );
      if (knowledgeCtx) contextData += knowledgeCtx;
    }

    // ── 4. BUILD USER MESSAGE CONTENT ───────────────────────
    const userContent = [];
    if (message) userContent.push({ type: 'text', text: message });

    if (attachedFile) {
      if (attachedFile.mimetype?.startsWith('image/') && bot.aiProvider?.provider === 'openai') {
        const imgBuffer = fs.readFileSync(attachedFile.path);
        userContent.push({
          type: 'image_url',
          image_url: { url: `data:${attachedFile.mimetype};base64,${imgBuffer.toString('base64')}` },
        });
      } else {
        const text = await this.extractFileContent(attachedFile);
        if (text) userContent.push({ type: 'text', text });
      }
    }

    const today = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const systemPrompt = [
      bot.prompt || bot.systemPrompt || '',
      `[HARI INI: ${today}]`,
      contextData,
      contextData
        ? 'Gunakan data dan knowledge di atas untuk menjawab pertanyaan user secara akurat. Jangan mengarang fakta yang tidak ada di data.'
        : '',
    ].filter(Boolean).join('\n\n');

    console.log(`🤖 Bot "${bot.name}" | Provider: ${bot.aiProvider?.provider || 'openai'} | Model: ${bot.aiProvider?.model || 'gpt-4o'}`);
    console.log(`📝 System prompt: ~${Math.ceil(systemPrompt.length / 4)} tokens`);

    // ── 5. CALL AI PROVIDER ──────────────────────────────────
    const result = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt,
      messages: history.slice(-6),
      userContent: userContent.length === 1 && userContent[0].type === 'text'
        ? userContent[0].text
        : userContent,
    });

    const aiResponse = result.text;

    // ── 6. SAVE TO DB ────────────────────────────────────────
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

    return { response: aiResponse, threadId, attachedFiles: savedAttachments, usage: result.usage };
  }

  // ─────────────────────────────────────────────────────────────
  // PPT COMMAND HANDLER
  // ─────────────────────────────────────────────────────────────
  async _handlePptCommand({ userId, botId, bot, message, threadId }) {
    try {
      // Extract style from message
      const style = detectPptStyle(message);

      // Clean the prompt: remove command prefix & style keywords
      let prompt = message
        .replace(/^\/ppt\s*|^\/slide\s*|^\/presentation\s*/i, '')
        .replace(/\b(style|gaya|tema)\s*(a|b|c|d|e|corporate|modern|bold|minimal|warm)\b/gi, '')
        .replace(/\b(corporate|modern|bold|minimal|warm|navy|teal|red|dark|terracotta)\b/gi, '')
        .trim();

      if (!prompt) {
        // Fallback: use the whole message as topic
        prompt = message.replace(/^(buatkan|buat|create|generate)\s+/i, '').trim();
      }

      const presentationTitle = prompt
        .replace(/^(presentasi|ppt|slide|powerpoint)\s+(tentang|about|mengenai|on)\s+/i, '')
        .replace(/\s+(presentasi|ppt|slide deck|powerpoint)$/i, '')
        .trim()
        .substring(0, 60) || 'Presentation';

      console.log(`📊 [PPTX via AI-Core] Prompt: "${prompt}" | Style: ${style}`);

      // Build slide content via AI
      const systemPrompt = `You are an expert presentation writer.
Generate professional slide content in the following exact format:

# [Presentation Title]
[One sentence subtitle or key message]

## [Slide 2 Title]
- bullet point 1
- bullet point 2
- bullet point 3
- bullet point 4

## [Slide 3 Title]
- bullet point 1
- bullet point 2
- bullet point 3

## [Slide 4 Title]
[Write 2-3 sentences of paragraph content here]

## [Slide 5 Title]
- bullet point 1
- bullet point 2
- bullet point 3

[Continue for all slides...]

Rules:
- First slide (# heading) = Title slide with subtitle
- Use ## for content slide titles  
- Mix bullets and paragraph slides for variety
- Each slide: 1 title + 3-5 bullets OR 2-3 sentences
- Keep bullet text concise (under 15 words each)
- Generate 6-10 content slides total
- Language: match the user's request language (Indonesian or English)
- DO NOT add style instructions, just pure content`;

      const aiResult = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt,
        messages: [],
        userContent: `Create a professional presentation about: ${prompt}`,
      });

      if (!aiResult.text) throw new Error('AI returned empty content for slides');

      // Generate the PPTX file
      const outputDir = path.join(process.cwd(), 'data', 'files');
      const result = await PptxService.generate(aiResult.text, style, presentationTitle, outputDir);

      const styleName = PptxService.STYLES[style]?.name || style;
      const styleList = Object.entries(PptxService.STYLES)
        .map(([k, v]) => `• \`${k}\` — ${v.name}`)
        .join('\n');

      const responseMarkdown = `✅ **Presentasi berhasil dibuat!**

📊 **${presentationTitle}**
🎨 Style: **${styleName}**
📑 **${result.slideCount} slides**

---
### [⬇️ Download: ${result.filename}](${result.url})
*Klik link di atas untuk mengunduh file PowerPoint (.pptx)*

---

💡 **Style tersedia:**
${styleList}

Contoh penggunaan: \`buatkan presentasi tentang [topik] style modern\``;

      // Save to DB
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
      console.error('❌ [PPTX Command] Error:', error);
      throw new Error(`Gagal membuat presentasi: ${error.message}`);
    }
  }
}

export default new AICoreService();