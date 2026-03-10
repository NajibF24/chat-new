// server/services/ai-core.service.js
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

  let styleRequest = 'professional corporate executive — dark navy, data charts, clean typography';
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

const PPT_RESPONSE_MARKERS = [
  '✅ **Presentasi berhasil',
  '⬇️ Download File Presentasi',
  'Style lain yang bisa dicoba',
  'fallback renderer',
  'Deskripsikan style apapun',
  '/api/files/',
  '.pptx',
  '🎨 Style:',
  '📑 ~',
  '📑 Jumlah:'
];

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
        const content  = workbook.SheetNames.map(n => XLSX.utils.sheet_to_csv(workbook.Sheets[n])).join('\n');
        return `\n\n[ISI FILE: ${originalName}]\n${content.substring(0, 8000)}\n[END FILE]\n`;
      } else {
        return `\n\n[ISI FILE: ${originalName}]\n${fs.readFileSync(physicalPath, 'utf8').substring(0, 8000)}\n[END FILE]\n`;
      }
    } catch { return ''; }
  }

  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    if (!threadId) {
      const title     = message ? message.substring(0, 30) : `Chat with ${bot.name}`;
      const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
      await newThread.save();
      threadId = newThread._id;
    }

    if (isPptCommand(message)) {
      return this._handlePptCommand({ userId, botId, bot, message, threadId, history });
    }

    let contextData = '';

    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
      try {
        const kouventa = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
        const reply    = await kouventa.generateResponse(message || '');
        contextData   += `\n\n=== REFERENSI DOKUMEN INTERNAL ===\n${reply}\n`;
      } catch (error) { console.error('Kouventa Error:', error.message); }
    }

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

    if (bot.knowledgeFiles?.length > 0 && bot.knowledgeMode !== 'disabled') {
      const knowledgeCtx = KnowledgeBaseService.buildKnowledgeContext(
        bot.knowledgeFiles, message, bot.knowledgeMode || 'relevant'
      );
      if (knowledgeCtx) contextData += knowledgeCtx;
    }

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

    const result = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt,
      messages: history.slice(-6),
      userContent: userContent.length === 1 && userContent[0].type === 'text'
        ? userContent[0].text
        : userContent,
    });

    const aiResponse = result.text;

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

    return { response: aiResponse, threadId, attachedFiles: savedAttachments };
  }

  async _handlePptCommand({ userId, botId, bot, message, threadId, history = [] }) {
    try {
      // ── STEP 0: Ambil history dari DB ──────────────────────
      let dbHistory = [];
      try {
        if (threadId) {
          dbHistory = await Chat.find({ threadId })
            .sort({ createdAt: 1 })
            .limit(30)
            .lean();
        } else {
          dbHistory = await Chat.find({ userId, botId })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();
          dbHistory = dbHistory.reverse();
        }
        dbHistory = dbHistory.filter(h => {
          if (!h.content) return false;
          if (isPptCommand(h.content)) return false;
          if (PPT_RESPONSE_MARKERS.some(m => h.content.includes(m))) return false;
          return true;
        });
      } catch (e) {
        console.warn('⚠️ [PPT] DB query failed:', e.message);
        dbHistory = history.filter(h => !PPT_RESPONSE_MARKERS.some(m => (h.content||'').includes(m)));
      }

      const allHistory = dbHistory.length > 0 ? dbHistory : history;

      // ── STEP 1: Deteksi style ──────────────────────────────
      const DEFAULT_STYLE = 'professional corporate executive — dark navy, data charts, clean typography';
      let { styleRequest, topic } = extractStyleAndTopic(message);

      if (styleRequest === DEFAULT_STYLE && allHistory.length > 0) {
        const histText = allHistory.map(h => h.content || '').join('\n');
        const fromHistory = extractStyleAndTopic(histText);
        if (fromHistory.styleRequest !== DEFAULT_STYLE) {
          styleRequest = fromHistory.styleRequest;
        }
        const styleKw = histText.match(/\b(apple keynote|mckinsey|dark futuristic|startup pitch|bloomberg|editorial|minimal|cinematic|hitam|navy|gradient|warm|nature|healthcare)\b/gi);
        if (styleKw && styleRequest === DEFAULT_STYLE) {
          styleRequest = [...new Set(styleKw.map(s => s.toLowerCase()))].slice(0,3).join(', ') + ' style';
        }
      }

      // ── STEP 2: Siapkan slide content ──────────────────────
      const isTopicEmpty = topic.replace(/buatkan|file|ppt|-nya|nya|tolong/gi, '').trim().length === 0;
      const refersToHistory = isTopicEmpty || /\b(berdasarkan history|berdasarkan chat|dari data di atas|percakapan sebelumnya|teks tadi|yang tadi|ppt nya|ppt-nya)\b/i.test(message);

      const historicalContent = allHistory
        .filter(h => {
          if (!h.content || h.content.length < 200) return false;
          if (h.role === 'assistant' && (h.content.includes('⬇️') || h.content.includes('/api/files/'))) return false;
          return true;
        })
        .map(h => `[${h.role === 'assistant' ? 'ASSISTANT' : 'USER'}]:\n${h.content}`)
        .join('\n\n---\n\n');

      const hasHistory = historicalContent.trim().length > 200;
      let slideContent = '';
      let title = 'Presentation';

      if (refersToHistory && hasHistory) {
        console.log(`📊 [PPT] Converting history (${historicalContent.length} chars) → slides`);
        const res = await AIProviderService.generateCompletion({
          providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
          systemPrompt: `You are a presentation writer. Extract and structure all content from the conversation into slide format.

Output format (markdown):
# [Exact title from the source content]
[Subtitle]

## [Slide Title exactly as in source]
- bullet from source
- bullet from source
[SCRIPT: speaker notes if present]

## [Next Slide Title]
[paragraph content]

RULES:
- Keep ALL original content, titles, bullets, scripts verbatim
- Do not invent new content
- Match original language (EN/ID)
- Produce as many ## sections as there are slides/sections in the source`,
          messages: [],
          userContent: `Convert this conversation into slide markdown:\n\n${historicalContent.substring(0, 8000)}`,
        });
        slideContent = res.text;
        const tm = slideContent.match(/^#\s+(.+)/m);
        if (tm) title = tm[1].trim().substring(0, 60);
      } else {
        let { topic: tp } = extractStyleAndTopic(message);
        tp = tp.replace(/^(tentang|about|mengenai|untuk|for)\s+/i, '').trim() || 'Presentation';
        title = tp.substring(0, 60);
        console.log(`📊 [PPT] Generating fresh content: "${title}"`);
        
        const res = await AIProviderService.generateCompletion({
          providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
          systemPrompt: `You are an elite Management Consultant and Executive Presentation Writer.
Your task is to create a comprehensive, highly detailed, and persuasive presentation. 
DO NOT give short, empty, or lazy slides. Each slide MUST contain substantial, professional content.

Format strictly in markdown:
# [Hero Title: Catchy and Strategic]
[Compelling Subtitle]

## [Slide 1: Executive Summary]
- [Detailed bullet point 1: Explain the core concept thoroughly, minimum 15-25 words].
- [Detailed bullet point 2: Highlight the business impact, efficiency, or cost reduction].
- [Detailed bullet point 3: Add realistic industry context or metrics].
[Short paragraph summarizing the strategic takeaway of this slide]

## [Slide 2: The Problem / Current State]
- [Detailed analysis point 1]
- [Detailed analysis point 2]
- [Detailed analysis point 3]

## [Slide 3: ...] 
(Continue this rich, detailed structure for 7 to 9 slides. Include topics like Core Features, Implementation Strategy, Business Value/ROI, and Conclusion).

RULES:
1. Provide rich, actionable text. Do NOT just write short 3-word bullets.
2. Include realistic placeholder data, percentages, or metrics to make it look professional.
3. Write in the exact same language as the user's prompt. Make the tone Executive and Professional.`,
          messages: [],
          userContent: `Buatkan presentasi lengkap, mendetail, dan sangat profesional tentang: ${tp}`,
        });
        
        slideContent = res.text;
        const tm = slideContent.match(/^#\s+(.+)/m);
        if (tm) title = tm[1].trim().substring(0, 60);
      }

      if (!slideContent?.trim()) throw new Error('Empty slide content');

// ── STEP 3: AI generates JSON structure for Native PPT ─────────────
      console.log(`📊 [PPT] Generating Native JSON slides...`);
      const jsonPrompt = `You are a data architect for PowerPoint presentations.
Based on the presentation content, create a structured JSON for a native PowerPoint presentation.
      
Return ONLY valid JSON. No markdown formatting (\`\`\`json).
Structure:
{
  "slides": [
    {
      "layout": "TITLE",
      "title": "Hero Title",
      "subtitle": "Subtitle text here"
    },
    {
      "layout": "CONTENT",
      "title": "Slide Title",
      "bullets": ["Point 1", "Point 2", "Point 3"]
    },
    {
      "layout": "CHART",
      "title": "Data Comparison (IMPORTANT)",
      "chartType": "bar",
      "chartData": [
        { "name": "Model Tradisional", "labels": ["Q1", "Q2", "Q3"], "values": [10, 25, 40] },
        { "name": "DevSecOps", "labels": ["Q1", "Q2", "Q3"], "values": [30, 50, 80] }
      ]
    }
  ]
}
RULES: 
- Include at least 2 CHART slides (use chartType "bar", "pie", or "line").
- Make sure "chartData" contains actual numbers and labels relevant to the topic.`;

      const jsonRes = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt: jsonPrompt,
        messages: [],
        userContent: `Convert this content into the requested JSON format:\n\n${slideContent}`
      });

      // Bersihkan output JSON
      let rawJson = jsonRes.text.replace(/```json/gi, '').replace(/```/gi, '').trim();
      let pptData;
      try {
        pptData = JSON.parse(rawJson);
      } catch (err) {
        console.error("AI JSON Parse Error:", rawJson.substring(0, 100));
        throw new Error("AI gagal menghasilkan format data native PPT.");
      }

      // ── STEP 4: Render JSON to NATIVE PPTX ─────────────────
      const outputDir = path.join(process.cwd(), 'data', 'files');
      const result = await PptxService.generate({
        pptData: pptData, // <-- KIRIM DATA JSON KE SERVICE
        slideContent,
        title,
        outputDir,
        styleDesc: styleRequest,
      });

      // ── STEP 5: Response ───────────────────────────────────
      const styleList = PptxService.getStyleExamples()
        .slice(0, 5)
        .map(s => `• *${s.example}*`)
        .join('\n');

      const responseMarkdown = `✅ **Presentasi berhasil dibuat!**

📊 **Topik:** ${title}
🎨 **Style:** ${styleRequest}
📑 **Jumlah:** ${result.slideCount} slides ${result.usedFallback ? '_(mode teks dasar)_' : ''}

---
### [⬇️ Download File Presentasi (.pptx)](${result.pptxUrl})

💡 **Ingin mencoba style lain? Cukup ketik salah satu contoh berikut:**
${styleList}`;

      await new Chat({ userId, botId, threadId, role: 'user', content: message }).save();
      await new Chat({
        userId, botId, threadId, role: 'assistant',
        content: responseMarkdown,
        attachedFiles: [
          { name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }
        ],
      }).save();
      await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });

      return {
        response: responseMarkdown,
        threadId,
        attachedFiles: [
          { name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }
        ],
      };

    } catch (error) {
      console.error('❌ [PPT Command]', error);
      throw new Error(`Gagal membuat presentasi: ${error.message}`);
    }
  }
}

export default new AICoreService();
