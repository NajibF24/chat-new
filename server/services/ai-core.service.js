// server/services/ai-core.service.js
// ============================================================
// PATCH CHANGES:
//   1. isPptCommand() — multi-language detection (ID, EN, Malay)
//   2. processMessage() — extract images from chat attachment for PPT
//   3. _handlePptCommand() — images come from attachment, NOT knowledge base
//      Knowledge base = text content (RAG) + template .pptx only
// ============================================================

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
import AzureSearchService     from './azure-search.service.js';
import PptxService            from './pptx.service.js';

// ─────────────────────────────────────────────────────────────
// PPT SYSTEM PROMPTS
// ─────────────────────────────────────────────────────────────

const PPT_CONTENT_SYSTEM_PROMPT = `You are an expert Presentation Strategist and Visual Designer for PT Garuda Yamato Steel (GYS).
Your job is to produce polished, visually rich slide content — like Gamma.app or Beautiful.ai.

═══════════════════════════════════════════════════════
RULE #1 — FOLLOW USER INSTRUCTIONS EXACTLY
═══════════════════════════════════════════════════════
- If user specifies slides explicitly (e.g. "slide 1: visi, slide 2: produk"), follow that structure EXACTLY.
- If user specifies a number of slides, produce exactly that count.
- If user only gives a title/topic, generate a logical 7–9 slide narrative arc.
- Match the user's language 100% (Indonesian → Indonesian, English → English).

═══════════════════════════════════════════════════════
RULE #2 — SMART LAYOUT AUTO-DETECTION (MANDATORY)
═══════════════════════════════════════════════════════
You MUST select the most impactful layout for each slide. Apply this decision tree:

  Is it the opening slide?
    → LAYOUT: TITLE

  Is it a topic transition / section divider?
    → LAYOUT: SECTION

  Does it present 2–4 strategic pillars, features, or themes?
    → LAYOUT: GRID  (icon cards — most visual impact)

  Does it show KPIs, metrics, percentages, or big numbers?
    → LAYOUT: STATS  (large callout cards with icons)

  Does it describe a TIMELINE, ROADMAP, PHASES, SCHEDULE, or WEEK-BY-WEEK plan?
    → LAYOUT: TIMELINE  ← ALWAYS use this for anything time-based
      Never use TABLE for timelines. Never use CONTENT for timelines.
      A "timeline slide" or "roadmap" or "implementation plan" MUST become TIMELINE.

  Does it compare two things (before/after, pros/cons, option A vs B)?
    → LAYOUT: TWO_COLUMN

  Does it show a data TABLE, matrix, or multi-column structured list?
    → LAYOUT: TABLE  (3+ columns of data)

  Does it show trend, growth, or comparison data suitable for a bar/line chart?
    → LAYOUT: CHART

  Is it a powerful quote, mission/vision statement?
    → LAYOUT: QUOTE

  Is it the final/closing slide?
    → LAYOUT: CLOSING

  Is it general narrative content?
    → LAYOUT: CONTENT  (fallback — use only when nothing else fits)

═══════════════════════════════════════════════════════
RULE #3 — RICH CONTENT STANDARDS (NO LAZY CONTENT)
═══════════════════════════════════════════════════════
- GRID items: emoji icon + short title (3–5 words) + 2–3 sentence description (20+ words)
- STATS: emoji icon + bold value + label + context subtitle
- TIMELINE: 3–6 steps, each with time label + title + 1–2 sentence description
- TABLE: 3–5 columns, minimum 3 data rows, each cell has real content
- CONTENT bullets: minimum 4 bullets, each 10+ words. No 2-word bullets ever.
- CHART: insightText (2 sentences explaining business impact) + real numeric chartData

═══════════════════════════════════════════════════════
OUTPUT FORMAT — exact syntax required
═══════════════════════════════════════════════════════

# [Presentation Title]

## [Opening Slide Title]
LAYOUT: TITLE
subtitle: [Subtitle]
date: [Date if provided]
presenter: [Name if provided]

## [Strategic Overview]
LAYOUT: GRID
items:
- icon: 🚀
  title: Speed & Agility
  text: Accelerating production cycles by 25% through lean methodology and real-time IoT monitoring across all lines.
- icon: 🛡️
  title: Quality Assurance
  text: Zero-defect targets enforced by AI-powered visual inspection, reducing rework costs by Rp 1.2B annually.
- icon: 🌱
  title: Sustainability
  text: Carbon footprint reduced 18% through energy optimization aligned with Yamato Steel Group global standards.

## [Key Performance Indicators]
LAYOUT: STATS
stats:
- icon: 📈
  value: 94%
  label: Production Uptime
  sub: Target FY 2025
- icon: 💰
  value: Rp 2.8B
  label: Cost Reduction
  sub: Annual Projection
- icon: 🏆
  value: 12K
  label: Tons/Month
  sub: Average Output

## [Implementation Roadmap]
LAYOUT: TIMELINE
steps:
- time: Week 1–2
  title: Discovery & Planning
  text: Stakeholder interviews, current state mapping, gap analysis and project charter sign-off
- time: Week 3–4
  title: Design & Architecture
  text: Solution blueprint, vendor evaluation, resource allocation and budget finalization
- time: Month 2
  title: Development Sprint 1
  text: Core module build, API integrations, and internal UAT preparation
- time: Month 3
  title: Pilot & Validation
  text: Controlled rollout to Line A, performance benchmarking, user acceptance testing
- time: Month 4
  title: Full Deployment
  text: Company-wide rollout, staff training, hypercare support and go-live sign-off

## [Production Trend Analysis]
LAYOUT: CHART
insightText: Production volume grew 23% over the year, with Q3 peak driven by export demand. Q4 requires 12% acceleration to meet annual target.
chartType: bar
isStacked: false
showDataLabels: true
chartData:
- series: Actual (Tons)
  labels: Q1, Q2, Q3, Q4
  values: 11200, 12400, 13800, 14500
- series: Target (Tons)
  labels: Q1, Q2, Q3, Q4
  values: 12000, 13000, 13500, 15000

## [Before vs After]
LAYOUT: TWO_COLUMN
leftTitle: ❌ Current State
left:
- Manual data entry causes 3-hour daily delays in reporting
- No real-time visibility into production floor status
- Siloed systems prevent cross-department collaboration
rightTitle: ✅ Future State
right:
- Automated sync reduces reporting delays to under 15 minutes
- Live dashboard accessible from any device, anywhere
- Unified platform enables real-time cross-team coordination

## [Project Cost Breakdown]
LAYOUT: TABLE
tableHeaders: ["Work Package", "Owner", "Budget (Rp)", "Timeline", "Status"]
tableRows:
- ["Infrastructure Setup", "IT Dept", "450,000,000", "Month 1", "✅ Approved"]
- ["Software Licensing", "Procurement", "320,000,000", "Month 1–2", "🔄 In Progress"]
- ["Training & Change Mgmt", "HR Dept", "180,000,000", "Month 3–4", "⏳ Pending"]

## [Closing]
LAYOUT: CLOSING
subtitle: Terima kasih atas perhatiannya
contact: info@gyssteel.com
`;

const PPT_JSON_SYSTEM_PROMPT = `You are a strict JSON converter for a PowerPoint generator.
Return ONLY valid JSON. No markdown fences. No explanation. No trailing commas.

COMPLETE SCHEMA — one object per layout type:

TITLE:
{ "layout": "TITLE", "title": "...", "subtitle": "...", "date": "...", "presenter": "..." }

SECTION:
{ "layout": "SECTION", "title": "...", "subtitle": "...", "sectionNumber": "01" }

CONTENT:
{ "layout": "CONTENT", "title": "...", "bullets": ["Full sentence bullet 1", "Full sentence bullet 2"] }

GRID (visual icon cards):
{ "layout": "GRID", "title": "...", "items": [{ "icon": "🚀", "title": "Short Title", "text": "Full description sentence here." }] }

STATS (KPI number cards):
{ "layout": "STATS", "title": "...", "stats": [{ "icon": "📈", "value": "94%", "label": "Metric Name", "sub": "Context description" }] }

TIMELINE (roadmap / schedule / phases):
{ "layout": "TIMELINE", "title": "...", "steps": [{ "time": "Week 1–2", "title": "Phase Title", "text": "What happens in this phase." }] }

TWO_COLUMN (comparison / before-after):
{ "layout": "TWO_COLUMN", "title": "...", "leftTitle": "...", "leftBullets": ["..."], "rightTitle": "...", "rightBullets": ["..."] }

CHART (bar, line, pie):
{ "layout": "CHART", "title": "...", "insightText": "Business insight sentence.", "chartConfig": { "type": "bar", "isStacked": false, "showDataLabels": true, "data": [{ "name": "Series Name", "labels": ["A","B","C"], "values": [10, 25, 40] }] } }

TABLE (structured data):
{ "layout": "TABLE", "title": "...", "tableHeaders": ["Col1","Col2","Col3"], "tableRows": [["val","val","val"],["val","val","val"]] }

QUOTE (vision/mission/impact):
{ "layout": "QUOTE", "quote": "Full quote text here.", "author": "Author Name" }

CLOSING:
{ "layout": "CLOSING", "title": "Thank You", "subtitle": "...", "contact": "..." }

CRITICAL RULES:
1. Preserve ALL slides in the exact same order — do NOT drop, merge, or reorder slides.
2. For TIMELINE: map "steps" array exactly. NEVER convert a TIMELINE to a TABLE.
3. For GRID: map "items" array exactly with icon, title, text fields.
4. For STATS: map "stats" array with icon, value, label, sub fields.
5. Preserve original language (ID/EN) in ALL text fields.
6. "title" must never be empty — use a short placeholder if blank.
7. All string values must be properly escaped JSON strings.
8. Numbers in chartConfig values must be actual numbers, not strings.

Output format:
{ "slides": [ { ...slide1 }, { ...slide2 }, ... ] }
`;

// ─────────────────────────────────────────────────────────────
// PPT HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────

const PPT_RESPONSE_MARKERS = [
  '✅ **Presentasi berhasil',
  '✅ **GYS Presentation successfully',
  '⬇️ Download',
  '/api/files/',
  '.pptx',
  '📑 **Jumlah Slide',
  '📑 **Total Slides',
  'GYS Corporate',
  'GYS Gamma',
  'fallback mode',
];

/**
 * ✅ UPDATED: Multi-language PPT command detection
 * Supports: Indonesian, English, Malay, mixed
 */
function isPptCommand(message = '') {
  const t = (message || '').trim().toLowerCase();

  // ── Prefix commands ──────────────────────────────────────
  if (t.startsWith('/ppt'))          return true;
  if (t.startsWith('/slide'))        return true;
  if (t.startsWith('/presentation')) return true;

  // ── Indonesia ────────────────────────────────────────────
  if (/^(buatkan|buat|bikin|tolong\s+buat|tolong\s+buatkan|bikinin)\s+(presentasi|ppt|slide|powerpoint|deck)/i.test(t)) return true;
  if (
    /\b(presentasi|powerpoint|ppt|slide\s+deck|deck)\b/i.test(t) &&
    /\b(buat|buatkan|bikin|bikinin|tolong|jadikan|konversi|ubah|rangkum|ringkas|summarikan)\b/i.test(t)
  ) return true;
  if (/\b(jadikan|ubah|konversi|ringkas|rangkum)\b.{0,40}\b(presentasi|ppt|slide|powerpoint)\b/i.test(t)) return true;
  // "dari dokumen ini buatkan presentasi", "dari file ini buat ppt"
  if (/\b(dari\s+(dokumen|file|ini|laporan|data))\b.{0,40}\b(presentasi|ppt|slide)\b/i.test(t)) return true;

  // ── English ──────────────────────────────────────────────
  if (/^(create|make|generate|build|prepare|convert|turn)\s+(a\s+|an\s+|me\s+a\s+)?(presentation|ppt|slides?|powerpoint|deck)/i.test(t)) return true;
  if (
    /\b(presentation|powerpoint|ppt|slide\s+deck|slideshow|slides)\b/i.test(t) &&
    /\b(create|make|generate|build|prepare|convert|turn\s+into|summarize\s+into|from\s+this|based\s+on)\b/i.test(t)
  ) return true;
  if (/\b(turn|convert|transform)\b.{0,30}\b(presentation|slides?|ppt|powerpoint|deck)\b/i.test(t)) return true;
  // "make a ppt from this document", "create slides from this file"
  if (/\b(from\s+(this|the)\s+(document|file|report|doc|data))\b.{0,40}\b(presentation|slides?|ppt|powerpoint)\b/i.test(t)) return true;
  if (/\b(presentation|slides?|ppt|powerpoint)\b.{0,40}\b(from\s+(this|the)\s+(document|file|report|doc|data))\b/i.test(t)) return true;

  // ── Malay ─────────────────────────────────────────────────
  if (/\b(buat|hasilkan|jadikan|cipta)\b.{0,30}\b(persembahan|slaid|pembentangan)\b/i.test(t)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────
// MAIN SERVICE CLASS
// ─────────────────────────────────────────────────────────────

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

  /**
   * ✅ NEW: Extract images from a file uploaded via chat message.
   * Only works for .docx and .pptx — these contain embedded images.
   * This is SEPARATE from knowledge base image extraction.
   */
  async extractImagesFromAttachment(attachedFile) {
    if (!attachedFile) return [];

    const filePath     = attachedFile.serverPath || attachedFile.path;
    const originalName = attachedFile.originalname || attachedFile.filename || '';
    const mimetype     = attachedFile.mimetype || '';
    const ext          = path.extname(originalName).toLowerCase();

    const supportedExts = ['.docx', '.pptx'];
    const supportedMime = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];

    if (!supportedExts.includes(ext) && !supportedMime.includes(mimetype)) {
      return [];
    }

    if (!filePath || !fs.existsSync(filePath)) {
      console.warn(`[PPT] Attachment file not found: ${filePath}`);
      return [];
    }

    try {
      const { extractedImages } = await KnowledgeBaseService.extractContent(
        filePath, originalName, mimetype
      );
      const images = extractedImages || [];
      console.log(`[PPT] Extracted ${images.length} images from chat attachment: ${originalName}`);
      return images;
    } catch (err) {
      console.error(`[PPT] Failed to extract images from attachment: ${err.message}`);
      return [];
    }
  }

  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    let bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    if (!threadId) {
      const title     = message ? message.substring(0, 30) : `Chat with ${bot.name}`;
      const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
      await newThread.save();
      threadId = newThread._id;
    }

    // ✅ UPDATED: PPT command check — extract images from attachment, not knowledge base
    if (isPptCommand(message)) {
      let attachmentImages = [];
      if (attachedFile) {
        // Gambar untuk PPT diambil dari file yang di-upload user di chat
        attachmentImages = await this.extractImagesFromAttachment(attachedFile);
      }
      return this._handlePptCommand({
        userId, botId, bot, message, threadId, history,
        attachedFile,       // untuk ekstrak teks konten
        attachmentImages,   // gambar dari file upload user (bukan knowledge base)
      });
    }

    // ── Normal chat (non-PPT) — perilaku tidak berubah ──────
    let contextData = '';

    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
      try {
        const kouventa = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
        const reply    = await kouventa.generateResponse(message || '');
        contextData   += `\n\n=== REFERENSI DOKUMEN INTERNAL ===\n${reply}\n`;
      } catch (error) { console.error('Kouventa Error:', error.message); }
    }

    if (bot.azureSearchConfig?.enabled && bot.azureSearchConfig?.apiKey && bot.azureSearchConfig?.endpoint) {
      try {
        const azureSearch = new AzureSearchService(
          bot.azureSearchConfig.apiKey,
          bot.azureSearchConfig.endpoint
        );
        const context = await azureSearch.generateResponse(message || '');
        if (context) {
          contextData += `\n\n=== REFERENSI AZURE AI SEARCH ===\n${context}\n`;
          const augmentedSystemPrompt = (bot.systemPrompt || bot.prompt || '') + '\n\n' + context;
          bot = { ...bot.toObject(), systemPrompt: augmentedSystemPrompt };
        }
      } catch (err) {
        console.error('Azure Search error:', err.message);
      }
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

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const systemPrompt = [
      bot.prompt || bot.systemPrompt || '',
      `[TODAY: ${today}]`,
      contextData,
      contextData
        ? 'Use the data and knowledge provided above to answer the user accurately. Do not hallucinate facts.'
        : '',
    ].filter(Boolean).join('\n\n');

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

  // ─────────────────────────────────────────────────────────
  // PPT COMMAND HANDLER
  // ✅ UPDATED: attachmentImages dari file chat, bukan knowledge base
  // ─────────────────────────────────────────────────────────
  async _handlePptCommand({ userId, botId, bot, message, threadId, history = [], attachedFile = null, attachmentImages = [] }) {
  try {
    // ── STEP 0: Load DB history ────────────────────────────────
    let dbHistory = [];
    try {
      if (threadId) {
        const rawHistory = await Chat.find({ threadId }).sort({ createdAt: 1 }).limit(30).lean();
        dbHistory = rawHistory.filter(h =>
          h.content && !PPT_RESPONSE_MARKERS.some(m => h.content.includes(m))
        );
      }
    } catch (e) { console.warn('[PPT] DB history error:', e.message); }
 
    // ── STEP 0.5: Find template PPTX in knowledge base ─────────
    const freshBot     = await Bot.findById(botId).lean();
    const knowledgeFiles = freshBot?.knowledgeFiles || [];
 
    // Find template .pptx — check pptTemplateFileId first, then auto-detect
    let templatePath = null;
 
    if (freshBot?.pptTemplateFileId) {
      const templateFile = knowledgeFiles.find(f =>
        String(f._id) === freshBot.pptTemplateFileId &&
        /\.pptx?$/i.test(f.originalName || '') &&
        f.path && fs.existsSync(f.path)
      );
      if (templateFile) {
        templatePath = templateFile.path;
        console.log(`[PPT] Using assigned template: ${templateFile.originalName}`);
      }
    }
 
    // Auto-detect: find any .pptx in knowledge base
    if (!templatePath) {
      const priorityWords = ['template', 'master', 'tema', 'theme', 'gys'];
      const pptxFiles = knowledgeFiles
        .filter(f => /\.pptx?$/i.test(f.originalName || '') && f.path && fs.existsSync(f.path))
        .sort((a, b) => {
          // Sort: files with priority keywords first
          const aScore = priorityWords.filter(w => (a.originalName || '').toLowerCase().includes(w)).length;
          const bScore = priorityWords.filter(w => (b.originalName || '').toLowerCase().includes(w)).length;
          return bScore - aScore;
        });
 
      if (pptxFiles.length > 0) {
        templatePath = pptxFiles[0].path;
        console.log(`[PPT] Auto-detected template: ${pptxFiles[0].originalName}`);
      }
    }
 
    const hasTemplate = templatePath && PptxTemplateService.isValidTemplate(templatePath);
    console.log(`[PPT] Template: ${hasTemplate ? templatePath : 'none — using GYS default'}`);
 
    // ── STEP 1: Extract text & images from attachment ───────────
    let attachmentText   = '';
    let attachmentImages_ = attachmentImages; // passed in from processMessage
 
    if (attachedFile) {
      try {
        attachmentText = await this.extractFileContent(attachedFile);
        if (attachmentText) {
          console.log(`[PPT] Extracted ${attachmentText.length} chars from attachment`);
        }
        // Also extract images if not already done
        if (!attachmentImages_.length) {
          attachmentImages_ = await this.extractImagesFromAttachment(attachedFile);
        }
      } catch (e) {
        console.warn('[PPT] Attachment extraction failed:', e.message);
      }
    }
 
    // ── STEP 2: Knowledge base text context (for RAG) ──────────
    // NOTE: Images from knowledge base are NOT used for PPT.
    //       Only text content is used as RAG context.
    //       Images come only from the chat attachment.
    let knowledgeCtx = '';
    if (knowledgeFiles.length > 0 && freshBot?.knowledgeMode !== 'disabled') {
      knowledgeCtx = KnowledgeBaseService.buildKnowledgeContext(
        knowledgeFiles.filter(f => !/\.pptx?$/i.test(f.originalName || '')), // exclude the template file itself
        message,
        freshBot?.knowledgeMode || 'relevant'
      );
    }
 
    // ── STEP 3: Build content generation prompt ─────────────────
    const userRequest = message || '';
    const refersToHistory = /\b(based on|from|use|history|chat|conversation|above|previous|berdasarkan|dari|gunakan|pakai|tadi|di atas|sebelumnya)\b/i.test(userRequest);
 
    let historicalContent = '';
    if (refersToHistory && dbHistory.length > 0) {
      historicalContent = dbHistory
        .filter(h => h.content && h.content.length > 100)
        .map(h => `[${h.role === 'assistant' ? 'ASSISTANT' : 'USER'}]:\n${h.content}`)
        .join('\n\n---\n\n')
        .substring(0, 8000);
    }
 
    let contentUserMsg = '';
    if (historicalContent) {
      contentUserMsg = `Generate a professional presentation based on this conversation.\nIMPORTANT: Match language exactly. Auto-detect best layout per slide.\n\nHistory:\n${historicalContent}\n\n`;
    } else {
      contentUserMsg = `Generate a professional presentation.\nIMPORTANT: Match language exactly. Auto-detect best layout.\n\n`;
    }
 
    // Priority: attachment text > knowledge base text > prompt only
    if (attachmentText) {
      contentUserMsg += `DOCUMENT CONTENT (PRIMARY SOURCE — extract key points, structure, data):\n${attachmentText.substring(0, 8000)}\n\n`;
      if (knowledgeCtx) {
        contentUserMsg += `ADDITIONAL CONTEXT:\n${knowledgeCtx.substring(0, 3000)}\n\n`;
      }
    } else if (knowledgeCtx) {
      contentUserMsg += `KNOWLEDGE BASE CONTEXT:\n${knowledgeCtx.substring(0, 6000)}\n\n`;
    }
 
    contentUserMsg += `User request: ${userRequest}`;
 
    // ── STEP 4: Generate slide content with AI ──────────────────
    console.log('[PPT] Step 1 — generating content...');
    const contentResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt:   PPT_CONTENT_SYSTEM_PROMPT,
      messages:       [],
      userContent:    contentUserMsg,
    });
 
    const slideContent = contentResult.text;
    if (!slideContent?.trim()) throw new Error('AI returned empty slide content');
 
    const titleMatch = slideContent.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].trim().substring(0, 60) : 'Presentation';
 
    console.log(`[PPT] Content ready — Title: "${title}" | ${slideContent.length} chars`);
 
    // ── STEP 5: Convert to JSON ─────────────────────────────────
    console.log('[PPT] Step 2 — converting to JSON...');
    const jsonResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt:   PPT_JSON_SYSTEM_PROMPT,
      messages:       [],
      userContent:    `Convert this presentation to JSON:\n\n${slideContent}`,
    });
 
    let rawJson = jsonResult.text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const jsonStart = rawJson.indexOf('{');
    const jsonEnd   = rawJson.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) rawJson = rawJson.substring(jsonStart, jsonEnd + 1);
 
    let pptData;
    try {
      pptData = JSON.parse(rawJson);
    } catch {
      throw new Error('AI gagal membuat format data presentasi. Silakan coba lagi.');
    }
    if (!pptData?.slides?.length) throw new Error('JSON tidak memiliki slides.');
 
    // ── STEP 6: Smart image selection ───────────────────────────
    // Ask AI to pick at most 2 relevant images from attachment
    let selectedImages = [];
    if (attachmentImages_.length > 0) {
      console.log(`[PPT] Step 3 — selecting images (${attachmentImages_.length} available)...`);
      try {
        selectedImages = await ImageSelectorService.selectImagesForSlides(
          pptData.slides,
          attachmentImages_,
          bot.aiProvider || { provider: 'openai', model: 'gpt-4o' }
        );
        console.log(`[PPT] Image selection: ${selectedImages.length} image(s) chosen`);
        selectedImages.forEach(img =>
          console.log(`  → Slide ${img.slideIndex}: "${img.caption}"`)
        );
      } catch (e) {
        console.warn('[PPT] Image selection failed, continuing without images:', e.message);
        selectedImages = [];
      }
    }
 
    // ── STEP 7: Render PPTX ─────────────────────────────────────
    const outputDir = path.join(process.cwd(), 'data', 'files');
    let result;
 
    if (hasTemplate) {
      // ✅ USE REAL TEMPLATE — slides inherit the template's theme,
      //    background, master layout, fonts, colors, logo, etc.
      console.log('[PPT] Step 4 — rendering with template...');
      result = await PptxTemplateService.generate({
        templatePath,
        pptData,
        title,
        outputDir,
        selectedImages,
      });
    } else {
      // Fallback: use GYS built-in theme from pptx.service.js
      console.log('[PPT] Step 4 — rendering with GYS default theme...');
      result = await PptxService.generate({
        pptData,
        slideContent,
        title,
        outputDir,
        styleDesc:       'GYS Corporate',
        templatePath:    null,
        extractedImages: selectedImages.map(img => ({
          path:       img.imagePath,
          caption:    img.caption,
          mimeType:   img.mimeType,
          slideIndex: img.slideIndex,
        })),
      });
    }
 
    // ── STEP 8: Build response message ──────────────────────────
    const reqLower = (userRequest || '').toLowerCase();
    const isEnglish = /\b(create|make|generate|presentation|deck|please|english)\b/i.test(reqLower) &&
      !/\b(buat|buatkan|bikin|tolong|presentasi|bahasa indonesia)\b/i.test(reqLower);
 
    const layoutIcons = {
      TITLE: '🏷️', CONTENT: '📝', GRID: '🧩', STATS: '📊',
      TIMELINE: '🗓️', TWO_COLUMN: '↔️', CHART: '📈',
      TABLE: '📋', QUOTE: '💬', SECTION: '📌', CLOSING: '🎯',
    };
 
    const layoutSummary = pptData.slides
      .map((s, i) => {
        const ic = layoutIcons[(s.layout || 'CONTENT').toUpperCase()] || '📄';
        return `${ic} **Slide ${i + 1}:** ${s.title || '—'} _(${s.layout || 'CONTENT'})_`;
      })
      .join('\n');
 
    const templateNote  = result.usedTemplate
      ? `\n🎨 **Template:** ${result.usedTemplate}`
      : '';
    const imageNote = selectedImages.length > 0
      ? `\n🖼️ **Images:** ${selectedImages.length} image(s) embedded`
      : '';
    const sourceNote = attachmentText
      ? `\n📄 **Source:** Content extracted from uploaded document`
      : '';
 
    const responseMarkdown = isEnglish
      ? `✅ **Presentation successfully generated!**
 
📊 **Title:** ${title}
📑 **Slides:** ${result.slideCount}${templateNote}${imageNote}${sourceNote}
 
---
### [⬇️ Download Presentation (.pptx)](${result.pptxUrl})
 
**Slide layouts:**
${layoutSummary}`
      : `✅ **Presentasi berhasil dibuat!**
 
📊 **Judul:** ${title}
📑 **Jumlah Slide:** ${result.slideCount}${templateNote}${imageNote}${sourceNote}
 
---
### [⬇️ Download Presentasi (.pptx)](${result.pptxUrl})
 
**Layout per slide:**
${layoutSummary}`;
 
    // Save to DB
    let savedAttachments = [];
    if (attachedFile) {
      savedAttachments.push({
        name:       attachedFile.originalname || attachedFile.filename,
        path:       `/api/files/${attachedFile.filename}`,
        serverPath: attachedFile.path,
        type:       'file',
      });
    }
 
    await new Chat({
      userId, botId, threadId,
      role: 'user',
      content: message,
      attachedFiles: savedAttachments,
    }).save();
 
    await new Chat({
      userId, botId, threadId,
      role: 'assistant',
      content: responseMarkdown,
      attachedFiles: [{ name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }],
    }).save();
 
    await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });
 
    return {
      response: responseMarkdown,
      threadId,
      attachedFiles: [{ name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }],
    };
 
    } catch (error) {
      console.error('❌ [PPT Command]', error);
      throw new Error(`Gagal membuat presentasi: ${error.message}`);
    }
  }
}

export default new AICoreService();
