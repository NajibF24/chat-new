// server/routes/pptx.js
// ✅ ENHANCED: Support Claude API untuk ekstraksi gambar dari DOCX + theme matching
// Claude dapat:
//   1. Membaca & menganalisis dokumen Word (DOCX) termasuk gambar embedded
//   2. Mencocokkan tema PPT dengan template yang ada
//   3. Menghasilkan slide yang lebih kaya konten dengan context window 200K token
//   4. Mempertahankan struktur heading/tabel/gambar dari dokumen asli

import express   from 'express';
import path      from 'path';
import fs        from 'fs';
import { fileURLToPath } from 'url';
import multer    from 'multer';
import AdmZip    from 'adm-zip';
import { requireAuth } from '../middleware/auth.js';
import Bot       from '../models/Bot.js';
import Thread    from '../models/Thread.js';
import Chat      from '../models/Chat.js';
import AIProviderService from '../services/ai-provider.service.js';
import PptxService, { HTML_SLIDE_SYSTEM_PROMPT } from '../services/pptx.service.js';
import AuditService from '../services/audit.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const router     = express.Router();

// ── Multer untuk upload dokumen ke PPT route ──────────────────
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_, file, cb) => {
    const allowed = ['.docx', '.doc', '.pdf', '.txt', '.md', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ─────────────────────────────────────────────────────────────
// EXTRACT IMAGES FROM DOCX (embedded images → base64)
// ─────────────────────────────────────────────────────────────

function extractDocxImages(buffer) {
  const images = [];
  try {
    const zip   = new AdmZip(buffer);
    const entries = zip.getEntries();

    for (const entry of entries) {
      // Images are stored in word/media/
      if (!entry.entryName.startsWith('word/media/')) continue;

      const ext  = path.extname(entry.entryName).toLowerCase();
      const mime = ext === '.png'  ? 'image/png'
                 : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
                 : ext === '.gif'  ? 'image/gif'
                 : ext === '.webp' ? 'image/webp'
                 : ext === '.bmp'  ? 'image/bmp'
                 : null;

      if (!mime) continue;

      const imageData = entry.getData();
      const base64    = imageData.toString('base64');
      const sizeKB    = Math.round(imageData.length / 1024);

      // Skip tiny images (icons, bullets etc)
      if (sizeKB < 5) continue;

      images.push({
        name:     path.basename(entry.entryName),
        mime,
        base64,
        sizeKB,
        dataUrl:  `data:${mime};base64,${base64}`,
      });
    }
  } catch (e) {
    console.warn('[PPTX] extractDocxImages error:', e.message);
  }
  return images;
}

// ─────────────────────────────────────────────────────────────
// EXTRACT TEXT FROM DOCX (preserve structure)
// ─────────────────────────────────────────────────────────────

async function extractDocxText(buffer, originalName) {
  try {
    // Try mammoth for best DOCX text extraction
    const mammoth = await import('mammoth');
    const result  = await mammoth.convertToMarkdown({ buffer });
    return result.value || '';
  } catch {
    // Fallback: raw XML text extraction
    try {
      const zip = new AdmZip(buffer);
      const doc = zip.getEntry('word/document.xml');
      if (!doc) return '';
      const xml  = doc.getData().toString('utf8');
      return xml.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, '\n').trim();
    } catch {
      return `[File: ${originalName}]`;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD CLAUDE VISION PROMPT FOR DOCUMENT ANALYSIS
// Claude 200K context = can handle full document + all images simultaneously
// ─────────────────────────────────────────────────────────────

function buildClaudeDocumentPrompt(docText, images, userRequest, style) {
  const imageSection = images.length > 0
    ? `\n\nDOCUMENT CONTAINS ${images.length} EMBEDDED IMAGE(S) — I will send them as vision inputs.
Each image should be analyzed and described. If the image is a chart/graph/diagram, extract its data and convert it to a CHART or TABLE layout slide.
If the image is a photo/illustration, include it in the most relevant slide using an IMAGE layout.`
    : '';

  return `You are an expert Presentation Designer. Analyze this document and create a stunning presentation.

USER REQUEST: ${userRequest}
PRESENTATION STYLE: ${style}
${imageSection}

DOCUMENT CONTENT:
${docText.substring(0, 40000)}

CRITICAL INSTRUCTIONS:
1. Extract and use ALL key information from the document
2. For charts/graphs in images → create CHART layout slides with extracted data
3. For diagrams/infographics → describe and recreate as GRID or TWO_COLUMN slides
4. For photos → reference them in relevant slide descriptions
5. Preserve the document's key structure (headings become slide titles)
6. Match the presentation theme/style to: ${style}

Generate a comprehensive ${style} presentation following the exact output format specified.`;
}

// ─────────────────────────────────────────────────────────────
// DETECT IF CLAUDE IS BEING USED
// ─────────────────────────────────────────────────────────────

function isClaudeProvider(bot) {
  return bot?.aiProvider?.provider === 'anthropic';
}

function isGeminiProvider(bot) {
  return bot?.aiProvider?.provider === 'google';
}

// ─────────────────────────────────────────────────────────────
// CONTENT SYSTEM PROMPT — Enhanced for Claude
// ─────────────────────────────────────────────────────────────

const PPT_CONTENT_SYSTEM_PROMPT_CLAUDE = `You are an elite Presentation Strategist and Visual Designer.
You have exceptional ability to analyze documents and transform them into compelling presentations.

When given a document with images, charts, or diagrams:
- Extract chart data and convert to CHART layout with real numbers
- Convert diagrams to GRID or TIMELINE layouts
- Use document's visual hierarchy to determine slide structure

LAYOUT AUTO-DETECTION (MANDATORY — pick the best for each slide):

  Opening slide?           → LAYOUT: TITLE
  Section divider?         → LAYOUT: SECTION
  2-4 pillars/features?    → LAYOUT: GRID
  KPIs/metrics/numbers?    → LAYOUT: STATS
  Roadmap/timeline?        → LAYOUT: TIMELINE
  Comparing two things?    → LAYOUT: TWO_COLUMN
  Data table/matrix?       → LAYOUT: TABLE
  Chart/trend data?        → LAYOUT: CHART
  Quote/statement?         → LAYOUT: QUOTE
  Final slide?             → LAYOUT: CLOSING
  General narrative?       → LAYOUT: CONTENT

OUTPUT FORMAT (STRICT):

# [Presentation Title]

## [Slide Title]
LAYOUT: [LAYOUT_TYPE]
[layout-specific fields]

LAYOUT EXAMPLES:

## Title Slide
LAYOUT: TITLE
subtitle: [Subtitle text]
date: [Date]
presenter: [Name]

## Section
LAYOUT: SECTION
subtitle: [Description]
sectionNumber: 01

## Grid Layout
LAYOUT: GRID
items:
- icon: 🚀
  title: Speed
  text: Full description with concrete details and metrics

## Stats Layout
LAYOUT: STATS
stats:
- icon: 📈
  value: 94%
  label: Production Uptime
  sub: Target FY 2025

## Timeline Layout
LAYOUT: TIMELINE
steps:
- time: Q1 2025
  title: Foundation
  text: Detailed description of this phase

## Chart Layout
LAYOUT: CHART
insightText: Key insight about this data
chartType: bar
chartData:
- series: Sales
  labels: Jan, Feb, Mar, Apr
  values: 120, 145, 132, 178

## Table Layout
LAYOUT: TABLE
tableHeaders: [Category, Value, Status, Notes]
tableRows:
- [Item 1, 100, Active, Good performance]
- [Item 2, 85, Review, Needs attention]

## Two Column
LAYOUT: TWO_COLUMN
leftTitle: ❌ Before
left:
- Pain point 1
rightTitle: ✅ After
right:
- Solution 1

## Closing
LAYOUT: CLOSING
subtitle: Thank you
contact: info@company.com

RULES:
- Generate 7-10 slides minimum
- Each slide must have substantial content
- Match language to user's request exactly (Indonesian ↔ English)
- Use real data from the document when available
- NEVER create empty or placeholder slides`;

// ─────────────────────────────────────────────────────────────
// JSON CONVERSION PROMPT
// ─────────────────────────────────────────────────────────────

const PPT_JSON_SYSTEM_PROMPT = `You are a strict JSON converter for a PowerPoint generator.
Return ONLY valid JSON. No markdown fences. No explanation. No trailing commas.

COMPLETE SCHEMA:
TITLE:      { "layout": "TITLE",      "title": "...", "subtitle": "...", "date": "...", "presenter": "..." }
SECTION:    { "layout": "SECTION",    "title": "...", "subtitle": "...", "sectionNumber": "01" }
CONTENT:    { "layout": "CONTENT",    "title": "...", "bullets": ["..."] }
GRID:       { "layout": "GRID",       "title": "...", "items": [{ "icon": "🚀", "title": "...", "text": "..." }] }
STATS:      { "layout": "STATS",      "title": "...", "stats": [{ "icon": "📈", "value": "94%", "label": "...", "sub": "..." }] }
TIMELINE:   { "layout": "TIMELINE",   "title": "...", "steps": [{ "time": "Q1 2025", "title": "...", "text": "..." }] }
TWO_COLUMN: { "layout": "TWO_COLUMN", "title": "...", "leftTitle": "...", "leftBullets": ["..."], "rightTitle": "...", "rightBullets": ["..."] }
CHART:      { "layout": "CHART",      "title": "...", "insightText": "...", "chartConfig": { "type": "bar", "isStacked": false, "showDataLabels": true, "data": [{ "name": "Series", "labels": ["A","B"], "values": [10, 25] }] } }
TABLE:      { "layout": "TABLE",      "title": "...", "tableHeaders": ["Col1","Col2"], "tableRows": [["val","val"]] }
QUOTE:      { "layout": "QUOTE",      "quote": "...", "author": "..." }
CLOSING:    { "layout": "CLOSING",    "title": "Thank You", "subtitle": "...", "contact": "..." }

CRITICAL: Output format must be: { "slides": [ {...slide1}, {...slide2}, ... ] }
Preserve ALL slides. Preserve original language. Never add trailing commas.`;

// ─────────────────────────────────────────────────────────────
// THEME MATCHING SYSTEM
// ─────────────────────────────────────────────────────────────

const THEME_KEYWORDS = {
  corporate:    ['corporate', 'business', 'professional', 'formal', 'enterprise', 'perusahaan', 'bisnis', 'profesional'],
  modern:       ['modern', 'minimal', 'clean', 'sleek', 'contemporary', 'minimalis', 'bersih'],
  creative:     ['creative', 'colorful', 'vibrant', 'artistic', 'kreatif', 'warna', 'menarik'],
  dark:         ['dark', 'gelap', 'night', 'malam', 'elegant', 'elegan', 'premium'],
  tech:         ['tech', 'teknologi', 'digital', 'innovation', 'inovasi', 'startup', 'ai', 'data'],
  education:    ['education', 'pendidikan', 'training', 'pelatihan', 'academic', 'akademik', 'school'],
  report:       ['report', 'laporan', 'analysis', 'analisis', 'annual', 'tahunan', 'quarterly'],
};

function detectTheme(userRequest) {
  const lower = (userRequest || '').toLowerCase();
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return theme;
  }
  return 'corporate'; // default
}

function buildStyleDescription(theme) {
  const styles = {
    corporate:  'GYS Corporate Professional — clean greens, structured layouts, executive feel',
    modern:     'GYS Modern Minimal — generous whitespace, bold typography, subtle accents',
    creative:   'GYS Creative Bold — vibrant accents, dynamic layouts, eye-catching visuals',
    dark:       'GYS Dark Premium — dark backgrounds, gold/teal accents, sophisticated elegance',
    tech:       'GYS Tech Innovation — blue-green gradient, data-forward, digital aesthetic',
    education:  'GYS Education Clear — readable fonts, organized structure, friendly visuals',
    report:     'GYS Executive Report — dense data, charts, professional reporting format',
  };
  return styles[theme] || styles.corporate;
}

// ─────────────────────────────────────────────────────────────
// ROUTE: GET /api/pptx/styles
// ─────────────────────────────────────────────────────────────

router.get('/styles', requireAuth, (req, res) => {
  res.json({
    themes: Object.keys(THEME_KEYWORDS),
    styles: Object.fromEntries(
      Object.keys(THEME_KEYWORDS).map(t => [t, buildStyleDescription(t)])
    ),
  });
});

// ─────────────────────────────────────────────────────────────
// ROUTE: POST /api/pptx/generate
// Standard text-based PPT generation (all providers)
// ─────────────────────────────────────────────────────────────

router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { prompt, style, botId, threadId } = req.body;
    const userId = req.session.userId;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    let bot = botId ? await Bot.findById(botId).lean() : null;
    if (!bot) bot = await Bot.findOne({}).lean();
    if (!bot) return res.status(400).json({ error: 'No bot configured' });

    // Auto-detect theme from prompt
    const detectedTheme = detectTheme(prompt);
    const styleDesc     = style || buildStyleDescription(detectedTheme);

    const title = prompt
      .replace(/^(buatkan|buat|create|generate|tolong|please)\s+/i, '')
      .replace(/\s+(presentasi|presentation|ppt|slide|powerpoint).*$/i, '')
      .replace(/\s+style\s+.*/i, '')
      .trim().substring(0, 60) || 'Presentation';

    const isUsingClaude = isClaudeProvider(bot);
    const isUsingGemini = isGeminiProvider(bot);
    const contentPrompt = isUsingClaude ? PPT_CONTENT_SYSTEM_PROMPT_CLAUDE : PPT_CONTENT_SYSTEM_PROMPT_CLAUDE;

    console.log(`[PPTX] Provider: ${bot.aiProvider?.provider} | Model: ${bot.aiProvider?.model} | Theme: ${detectedTheme}`);

    // ── Step 1: Generate slide content ───────────────────────
    const contentResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt:   contentPrompt,
      messages:       [],
      userContent:    `Generate a comprehensive ${styleDesc} presentation.\nIMPORTANT: Match the language of this request exactly.\n\nRequest: ${prompt}`,
    });

    const slideContent = contentResult.text;
    if (!slideContent?.trim()) return res.status(500).json({ error: 'AI returned empty content' });

    // ── Step 2: Convert to JSON ───────────────────────────────
    const jsonResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt:   PPT_JSON_SYSTEM_PROMPT,
      messages:       [],
      userContent:    `Convert this to JSON:\n\n${slideContent}`,
    });

    // ── Step 3: Parse & generate PPTX ────────────────────────
    let rawJson = jsonResult.text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const js = rawJson.indexOf('{'), je = rawJson.lastIndexOf('}');
    if (js !== -1 && je !== -1) rawJson = rawJson.substring(js, je + 1);

    const pptData = JSON.parse(rawJson);
    if (!pptData?.slides?.length) throw new Error('No slides generated');

    const outputDir = path.join(process.cwd(), 'data', 'files');
    const result    = await PptxService.generate({ pptData, slideContent, title, outputDir, styleDesc });

    // ── Step 4: Build response ────────────────────────────────
    const providerBadge = isUsingClaude ? '🟠 Claude' : isUsingGemini ? '🔵 Gemini' : '🟢 GPT';
    const responseMarkdown = _buildPptResponseMarkdown({ title, result, styleDesc, providerBadge, lang: prompt });

    // Save to DB
    let targetThreadId = threadId;
    if (!targetThreadId) {
      const t = new Thread({ userId, botId: bot._id, title: `PPT: ${title.substring(0, 30)}`, lastMessageAt: new Date() });
      await t.save();
      targetThreadId = t._id;
    }
    await new Chat({ userId, botId: bot._id, threadId: targetThreadId, role: 'user', content: prompt }).save();
    await new Chat({
      userId, botId: bot._id, threadId: targetThreadId, role: 'assistant', content: responseMarkdown,
      attachedFiles: [{ name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }],
    }).save();
    await Thread.findByIdAndUpdate(targetThreadId, { lastMessageAt: new Date() });
    await AuditService.log({ req, category: 'chat', action: 'PPTX_GENERATE', targetId: bot._id, targetName: bot.name,
      detail: { title, theme: detectedTheme, provider: bot.aiProvider?.provider }, username: req.session?.username }).catch(() => {});

    res.json({
      response: responseMarkdown, threadId: targetThreadId, pptx: result,
      attachedFiles: [{ name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }],
    });

  } catch (error) {
    console.error('❌ [PPTX Generate]', error);
    res.status(500).json({ error: `Failed: ${error.message}` });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE: POST /api/pptx/from-document
// ✅ CLAUDE ENHANCED: Upload DOCX → extract images + text → PPT
// Works best with Claude (200K context + vision), also supports OpenAI/Gemini
// ─────────────────────────────────────────────────────────────

router.post('/from-document', requireAuth, docUpload.single('document'), async (req, res) => {
  try {
    const { prompt, style, botId, threadId } = req.body;
    const userId = req.session.userId;

    if (!req.file && !prompt) return res.status(400).json({ error: 'Document or prompt required' });

    let bot = botId ? await Bot.findById(botId).lean() : null;
    if (!bot) bot = await Bot.findOne({}).lean();
    if (!bot) return res.status(400).json({ error: 'No bot configured' });

    const isUsingClaude = isClaudeProvider(bot);
    const isUsingGemini = isGeminiProvider(bot);
    const providerName  = bot.aiProvider?.provider || 'openai';

    const detectedTheme = detectTheme((prompt || '') + ' ' + (req.file?.originalname || ''));
    const styleDesc     = style || buildStyleDescription(detectedTheme);

    let docText   = '';
    let images    = [];
    let fileName  = 'Document';
    let userContent;

    // ── Extract document content ──────────────────────────────
    if (req.file) {
      fileName  = req.file.originalname;
      const ext = path.extname(fileName).toLowerCase();
      const buf = req.file.buffer;

      console.log(`[PPTX/Doc] File: ${fileName} | Size: ${Math.round(buf.length / 1024)}KB | Provider: ${providerName}`);

      if (ext === '.docx') {
        // Extract text (markdown format)
        docText = await extractDocxText(buf, fileName);
        // Extract embedded images
        images  = extractDocxImages(buf);
        console.log(`[PPTX/Doc] Extracted: ${docText.length} chars text, ${images.length} images`);

      } else if (ext === '.pdf') {
        try {
          const pdfParse = (await import('pdf-parse')).default;
          const data     = await pdfParse(buf);
          docText        = data.text || '';
        } catch (e) {
          docText = `[PDF: ${fileName} — text extraction failed: ${e.message}]`;
        }

      } else if (ext === '.xlsx') {
        try {
          const XLSX   = (await import('xlsx')).default;
          const wb     = XLSX.read(buf, { type: 'buffer' });
          const sheets = wb.SheetNames.map(n => `=== ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`);
          docText      = sheets.join('\n\n');
        } catch (e) {
          docText = `[Excel: ${fileName}]`;
        }

      } else if (ext === '.txt' || ext === '.md') {
        docText = buf.toString('utf8');
      }
    }

    const userRequest = prompt || `Create a presentation from this document: ${fileName}`;
    const title       = (prompt || fileName).replace(/\.(docx|pdf|xlsx|txt|md)$/i, '').substring(0, 60);

    // ── Build AI user content ─────────────────────────────────
    // For Claude with images: use multi-modal content array
    if (isUsingClaude && images.length > 0) {
      // Claude supports vision — send images directly
      console.log(`[PPTX/Doc] Using Claude vision with ${images.length} images`);

      const textPart = {
        type: 'text',
        text: buildClaudeDocumentPrompt(docText, images, userRequest, styleDesc),
      };

      const imageParts = images.slice(0, 10).map(img => ({
        type:   'image',
        source: {
          type:       'base64',
          media_type: img.mime,
          data:       img.base64,
        },
      }));

      userContent = [textPart, ...imageParts];

    } else if (isUsingGemini && images.length > 0) {
      // Gemini also supports vision
      console.log(`[PPTX/Doc] Using Gemini vision with ${images.length} images`);

      userContent = [
        { type: 'text', text: buildClaudeDocumentPrompt(docText, images, userRequest, styleDesc) },
        ...images.slice(0, 10).map(img => ({
          type:      'image_url',
          image_url: { url: img.dataUrl },
        })),
      ];

    } else {
      // OpenAI or no images — text only
      userContent = `${userRequest}\n\nDOCUMENT CONTENT:\n${docText.substring(0, 30000)}`;
    }

    // ── Step 1: Generate content ──────────────────────────────
    const contentResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider,
      systemPrompt:   PPT_CONTENT_SYSTEM_PROMPT_CLAUDE,
      messages:       [],
      userContent,
    });

    const slideContent = contentResult.text;
    if (!slideContent?.trim()) throw new Error('AI returned empty content for document');

    // ── Step 2: Convert to JSON ───────────────────────────────
    const jsonResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider,
      systemPrompt:   PPT_JSON_SYSTEM_PROMPT,
      messages:       [],
      userContent:    `Convert to JSON:\n\n${slideContent}`,
    });

    let rawJson = jsonResult.text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const js = rawJson.indexOf('{'), je = rawJson.lastIndexOf('}');
    if (js !== -1 && je !== -1) rawJson = rawJson.substring(js, je + 1);

    const pptData = JSON.parse(rawJson);
    if (!pptData?.slides?.length) throw new Error('No slides generated from document');

    // ── Step 3: Generate PPTX ────────────────────────────────
    const outputDir = path.join(process.cwd(), 'data', 'files');
    const result    = await PptxService.generate({ pptData, slideContent, title, outputDir, styleDesc });

    // ── Step 4: Response ──────────────────────────────────────
    const providerBadge = isUsingClaude ? '🟠 Claude' : isUsingGemini ? '🔵 Gemini' : '🟢 GPT';
    const extraInfo     = images.length > 0
      ? `\n📸 **Images extracted from document:** ${images.length} image(s) analyzed`
      : '';

    const responseMarkdown = _buildPptResponseMarkdown({
      title, result, styleDesc, providerBadge, lang: userRequest, extraInfo,
      fromDoc: fileName,
    });

    // Save to DB
    const chatContent = req.file
      ? `[Document uploaded: ${fileName}] ${prompt || ''}`.trim()
      : prompt;

    let targetThreadId = threadId;
    if (!targetThreadId) {
      const t = new Thread({ userId, botId: bot._id, title: `PPT: ${title.substring(0, 30)}`, lastMessageAt: new Date() });
      await t.save();
      targetThreadId = t._id;
    }
    await new Chat({ userId, botId: bot._id, threadId: targetThreadId, role: 'user', content: chatContent }).save();
    await new Chat({
      userId, botId: bot._id, threadId: targetThreadId, role: 'assistant', content: responseMarkdown,
      attachedFiles: [{ name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }],
    }).save();
    await Thread.findByIdAndUpdate(targetThreadId, { lastMessageAt: new Date() });
    await AuditService.log({
      req, category: 'chat', action: 'PPTX_FROM_DOCUMENT',
      targetId: bot._id, targetName: bot.name,
      detail: { title, fileName, imageCount: images.length, provider: providerName, theme: detectedTheme },
      username: req.session?.username,
    }).catch(() => {});

    res.json({
      response: responseMarkdown, threadId: targetThreadId, pptx: result,
      attachedFiles: [{ name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }],
    });

  } catch (error) {
    console.error('❌ [PPTX from-document]', error);
    res.status(500).json({ error: `Failed: ${error.message}` });
  }
});

// ─────────────────────────────────────────────────────────────
// HELPER: Build response markdown
// ─────────────────────────────────────────────────────────────

function _buildPptResponseMarkdown({ title, result, styleDesc, providerBadge, lang, extraInfo = '', fromDoc = '' }) {
  const isIndo = /\b(buatkan|buat|presentasi|tolong|dari|dengan|untuk)\b/i.test(lang || '');
  const layoutIcons = {
    TITLE: '🏷️', CONTENT: '📝', GRID: '🧩', STATS: '📊',
    TIMELINE: '🗓️', TWO_COLUMN: '↔️', CHART: '📈',
    TABLE: '📋', QUOTE: '💬', SECTION: '📌', CLOSING: '🎯',
  };

  if (isIndo) {
    return `✅ **Presentasi berhasil dibuat!**

📊 **Judul:** ${title}
📑 **Jumlah Slide:** ${result.slideCount} slides
🎨 **Tema:** ${styleDesc}
${providerBadge ? `🤖 **AI Provider:** ${providerBadge}` : ''}
${fromDoc ? `📄 **Dari Dokumen:** ${fromDoc}` : ''}${extraInfo}

---
### [⬇️ Download Presentasi (.pptx)](${result.pptxUrl})

💡 _Tip: Untuk hasil terbaik saat konversi dari dokumen, gunakan **Claude** karena mendukung analisis gambar/diagram dari DOCX secara langsung (Vision AI)._`;
  }

  return `✅ **Presentation successfully generated!**

📊 **Title:** ${title}
📑 **Slides:** ${result.slideCount} slides
🎨 **Theme:** ${styleDesc}
${providerBadge ? `🤖 **AI Provider:** ${providerBadge}` : ''}
${fromDoc ? `📄 **From Document:** ${fromDoc}` : ''}${extraInfo}

---
### [⬇️ Download Presentation (.pptx)](${result.pptxUrl})

💡 _Tip: For best results when converting documents, use **Claude** — it can analyze images, charts, and diagrams embedded in DOCX files directly (Vision AI)._`;
}

export default router;
