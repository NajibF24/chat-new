// server/routes/pptx.js
// ✅ FIXED: Claude vision API call sekarang mengirim gambar sebagai array content blocks
// ✅ FIXED: GYS theme matching dari knowledge base
// ✅ FIXED: Image extraction dari DOCX lebih robust

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
import KnowledgeBaseService from '../services/knowledge-base.service.js';

// ── Image extraction limits for Claude API ──────────────────
const MAX_IMAGES_PER_REQUEST  = 8;          // Claude: max 8 images untuk reliabilitas
const MAX_IMAGE_PAYLOAD_MB    = 8;          // Total payload max 8MB
const MAX_IMAGE_PAYLOAD_BYTES = MAX_IMAGE_PAYLOAD_MB * 1024 * 1024;
const MAX_SINGLE_IMAGE_KB     = 800;        // Skip gambar > 800KB
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

async function extractDocxImages(buffer) {
  const images = [];
  try {
    const AdmZip = (await import('adm-zip')).default;
    const zip    = new AdmZip(buffer);
    const entries = zip.getEntries();

    const mediaEntries = [];
    for (const entry of entries) {
      if (!entry.entryName.startsWith('word/media/')) continue;

      const ext  = path.extname(entry.entryName).toLowerCase();
      const mimeMap = {
        '.png':  'image/png',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif':  'image/gif',   // akan di-convert ke JPEG
        '.webp': 'image/webp',
      };
      const mime = mimeMap[ext];
      if (!mime) continue; // skip .bmp, .emf, .wmf

      const sizeKB = Math.round(entry.header.size / 1024);
      if (sizeKB < 5) continue;
      if (sizeKB > MAX_SINGLE_IMAGE_KB) {
        console.log(`[PPTX] Skip large image ${entry.entryName} (${sizeKB}KB > ${MAX_SINGLE_IMAGE_KB}KB)`);
        continue;
      }
      mediaEntries.push({ entry, ext, mime, sizeKB, name: path.basename(entry.entryName) });
    }

    // Sort by size descending (gambar besar = lebih banyak konten)
    mediaEntries.sort((a, b) => b.sizeKB - a.sizeKB);
    console.log(`[PPTX] Found ${mediaEntries.length} valid images in DOCX`);

    let totalPayloadBytes = 0;

    for (const { entry, ext, mime, sizeKB, name } of mediaEntries) {
      if (images.length >= MAX_IMAGES_PER_REQUEST) break;

      let finalMime = mime;
      let finalData = entry.getData();

      // Convert GIF → JPEG agar aman untuk Claude API
      if (ext === '.gif') {
        try {
          const sharp = (await import('sharp')).default;
          finalData = await sharp(finalData).jpeg({ quality: 80 }).toBuffer();
          finalMime = 'image/jpeg';
        } catch (sharpErr) {
          console.warn(`[PPTX] Cannot convert GIF (sharp unavailable), skipping ${name}`);
          continue;
        }
      }

      const base64 = finalData.toString('base64');
      if (totalPayloadBytes + base64.length > MAX_IMAGE_PAYLOAD_BYTES) {
        console.log(`[PPTX] Payload limit reached at ${images.length} images (${(totalPayloadBytes/1024/1024).toFixed(1)}MB)`);
        break;
      }

      totalPayloadBytes += base64.length;
      images.push({
        name,
        mime:    finalMime,
        base64,
        sizeKB,
        dataUrl: `data:${finalMime};base64,${base64}`,
      });
    }

    console.log(`[PPTX] Extracted ${images.length} images, total payload: ${(totalPayloadBytes/1024/1024).toFixed(2)}MB`);
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
    const mammoth = await import('mammoth');
    const result  = await mammoth.convertToMarkdown({ buffer });
    return result.value || '';
  } catch {
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
// DETECT IF CLAUDE IS BEING USED
// ─────────────────────────────────────────────────────────────

function isClaudeProvider(bot) {
  return bot?.aiProvider?.provider === 'anthropic';
}

function isGeminiProvider(bot) {
  return bot?.aiProvider?.provider === 'google';
}

// ─────────────────────────────────────────────────────────────
// BUILD CLAUDE VISION CONTENT ARRAY
// ✅ FIX UTAMA: Claude API menerima array of content blocks,
//    bukan string. Setiap gambar harus jadi block terpisah.
// ─────────────────────────────────────────────────────────────

function buildClaudeVisionContent(docText, images, userRequest, style, gysThemeInstructions) {
  const contentBlocks = [];

  const imageNote = images.length > 0
    ? `\n\nDocument contains ${images.length} images (attached below as vision inputs).\n` +
      `For EACH image, determine its type and incorporate into presentation:\n` +
      `  • Chart/graph/table → Create CHART or TABLE slide with extracted data\n` +
      `  • Architecture/diagram → Create CONTENT or GRID slide\n` +
      `  • Screenshot/UI → Create CONTENT slide summarizing it\n` +
      `  • NEVER skip an image — every image must appear in at least one slide\n`
    : '\n\nNo images in document — generate slides from text only.\n';

  const themeNote = gysThemeInstructions
    ? `\n\nMANDATORY GYS THEME:\n${gysThemeInstructions}\n`
    : '';

  contentBlocks.push({
    type: 'text',
    text:
      `You are an expert Presentation Designer.\n` +
      `Create a comprehensive presentation from the document below.\n\n` +
      `USER REQUEST: ${userRequest}\n` +
      `STYLE/THEME: ${style}\n` +
      `${imageNote}${themeNote}\n` +
      `DOCUMENT TEXT:\n${docText.substring(0, 30000)}\n\n` +
      `INSTRUCTIONS:\n` +
      `1. Extract ALL key information from the document\n` +
      `2. Create one slide per major section/heading\n` +
      `3. Analyze each image and create a dedicated slide for it\n` +
      `4. Match document language (Indonesian or English)\n` +
      `5. Minimum 8 slides\n`,
  });

  // Gambar sudah divalidasi dan dibatasi oleh extractDocxImages
  images.forEach((img, i) => {
    contentBlocks.push({
      type: 'text',
      text: `\n[IMAGE ${i + 1} of ${images.length}: "${img.name}" (${img.sizeKB}KB)]\n` +
            `Analyze: is it a chart, diagram, screenshot, or photo?`,
    });
    contentBlocks.push({
      type:   'image',
      source: {
        type:       'base64',
        media_type: img.mime,
        data:       img.base64,  // ← raw base64, TANPA prefix "data:..."
      },
    });
  });

  return contentBlocks;
}

// ─────────────────────────────────────────────────────────────
// BUILD OPENAI VISION CONTENT (GPT-4o etc)
// ─────────────────────────────────────────────────────────────

function buildOpenAIVisionContent(docText, images, userRequest, style, gysThemeInstructions) {
  const themeNote = gysThemeInstructions
    ? `\n\nTEMA GYS:\n${gysThemeInstructions}\n`
    : '';

  const blocks = [
    {
      type: 'text',
      text: `Buat presentasi dari dokumen ini.\n` +
            `Request: ${userRequest}\n` +
            `Style: ${style}\n` +
            `${themeNote}\n` +
            `Dokumen ini memiliki ${images.length} gambar yang ikut dilampirkan.\n` +
            `ISI DOKUMEN:\n${docText.substring(0, 25000)}`,
    },
  ];

  // OpenAI Vision format
  for (const img of images.slice(0, 10)) {
    blocks.push({
      type:      'image_url',
      image_url: { url: img.dataUrl, detail: 'auto' },
    });
  }

  return blocks;
}

// ─────────────────────────────────────────────────────────────
// DETECT GYS THEME FROM KNOWLEDGE BASE
// ─────────────────────────────────────────────────────────────

function extractGYSThemeInstructions(bot) {
  if (!bot?.knowledgeFiles?.length) return null;

  const pptxKnowledge = bot.knowledgeFiles.find(f =>
    /\.(pptx?|ppt)$/i.test(f.originalName) &&
    f.content &&
    f.content.includes('GYS (Garuda Yamato Steel)')
  );

  if (!pptxKnowledge) return null;

  // Extract the GYS theme section from knowledge content
  const content = pptxKnowledge.content;
  const startIdx = content.indexOf('GYS (Garuda Yamato Steel)');
  const endIdx   = content.indexOf('--- SLIDE CONTENT ---');

  if (startIdx === -1) return null;

  const themeSection = content.substring(startIdx, endIdx !== -1 ? endIdx : startIdx + 3000);

  return `Gunakan tema GYS resmi dari file referensi "${pptxKnowledge.originalName}".\n` +
         `Detail tema:\n${themeSection.substring(0, 2000)}`;
}

// ─────────────────────────────────────────────────────────────
// CONTENT SYSTEM PROMPT — Enhanced
// ─────────────────────────────────────────────────────────────

const PPT_CONTENT_SYSTEM_PROMPT = `You are an elite Presentation Strategist and Visual Designer.
You have exceptional ability to analyze documents and transform them into compelling presentations.

When given a document with images, charts, or diagrams:
- Analyze each image carefully
- Extract chart data and convert to CHART layout with real numbers
- Convert diagrams to GRID or TIMELINE layouts
- Use document's visual hierarchy to determine slide structure
- NEVER ignore images — each image must be represented in the presentation

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
  text: Full description with concrete details

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
- Generate 7-12 slides minimum for document conversion
- Each slide must have substantial content
- Match language to user's request exactly (Indonesian ↔ English)
- Use real data from the document when available
- NEVER create empty or placeholder slides
- For images: always create a slide based on what you see in each image`;

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
  return 'corporate';
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
// HELPER: Call AI with proper format per provider
// ─────────────────────────────────────────────────────────────

async function callAIWithContent({ bot, systemPrompt, userContent, isMultiModal }) {
  const providerConfig = bot.aiProvider;
  const provider = providerConfig?.provider || 'openai';

  if (provider === 'anthropic' && isMultiModal && Array.isArray(userContent)) {
    const axios  = (await import('axios')).default;
    const apiKey = providerConfig.apiKey?.trim() || process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) throw new Error('Anthropic API Key tidak ditemukan');

    const model  = providerConfig.model    || 'claude-sonnet-4-6';
    const maxTok = Math.max(providerConfig.maxTokens ?? 4096, 8000);
    const temp   = providerConfig.temperature ?? 0.1;

    const imageBlocks = userContent.filter(b => b.type === 'image');
    const approxKB = Math.round(
      userContent.reduce((sum, b) => sum + (b.source?.data?.length || b.text?.length || 0), 0) / 1024
    );
    console.log(`[PPTX/Claude Vision] ${imageBlocks.length} images, ~${approxKB}KB payload`);

    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model,
          max_tokens:  maxTok,
          temperature: temp,
          system:      systemPrompt,
          messages:    [{ role: 'user', content: userContent }],
        },
        {
          headers: {
            'x-api-key':         apiKey,
            'anthropic-version': '2023-06-01',
            'content-type':      'application/json',
          },
          timeout: 180000, // 3 menit untuk dokumen besar
          maxContentLength: 50 * 1024 * 1024,
        }
      );

      const text = response.data.content
        ?.filter(b => b.type === 'text').map(b => b.text).join('') || '';

      if (!text?.trim()) throw new Error('Empty response from Claude vision API');

      console.log(`[PPTX/Claude Vision] OK: ${text.length} chars, ${response.data.usage?.input_tokens} tokens`);
      return { text, usage: response.data.usage };

    } catch (visionErr) {
      const errMsg = visionErr.response?.data?.error?.message || visionErr.message;
      console.warn(`[PPTX/Claude Vision] FAILED: ${errMsg}`);
      console.warn('[PPTX/Claude Vision] Falling back to text-only...');

      // ← FALLBACK: text saja tanpa gambar
      const textContent = userContent
        .filter(b => b.type === 'text').map(b => b.text).join('\n\n');

      return AIProviderService.generateCompletion({
        providerConfig,
        systemPrompt,
        messages:    [],
        userContent: textContent + '\n\n[NOTE: Image analysis unavailable. Create slides from text only.]',
      });
    }
  }

  // Provider lain (OpenAI, Gemini, Custom)
  return AIProviderService.generateCompletion({
    providerConfig,
    systemPrompt,
    messages: [],
    userContent: Array.isArray(userContent)
      ? userContent.filter(b => b.type === 'text').map(b => b.text).join('\n')
      : userContent,
  });
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

    const detectedTheme = detectTheme(prompt);
    const styleDesc     = style || buildStyleDescription(detectedTheme);

    // Check for GYS theme in knowledge base
    const gysThemeInstructions = extractGYSThemeInstructions(bot);

    const title = prompt
      .replace(/^(buatkan|buat|create|generate|tolong|please)\s+/i, '')
      .replace(/\s+(presentasi|presentation|ppt|slide|powerpoint).*$/i, '')
      .replace(/\s+style\s+.*/i, '')
      .trim().substring(0, 60) || 'Presentation';

    const systemWithTheme = gysThemeInstructions
      ? PPT_CONTENT_SYSTEM_PROMPT + `\n\nGYS THEME REQUIREMENT:\n${gysThemeInstructions}`
      : PPT_CONTENT_SYSTEM_PROMPT;

    console.log(`[PPTX] Provider: ${bot.aiProvider?.provider} | Theme: ${detectedTheme} | GYS theme: ${!!gysThemeInstructions}`);

    // Step 1: Generate slide content
    const contentResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt:   systemWithTheme,
      messages:       [],
      userContent:    `Generate a comprehensive ${styleDesc} presentation.\nIMPORTANT: Match the language of this request exactly.\n\nRequest: ${prompt}`,
    });

    const slideContent = contentResult.text;
    if (!slideContent?.trim()) return res.status(500).json({ error: 'AI returned empty content' });

    // Step 2: Convert to JSON
    const jsonResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt:   PPT_JSON_SYSTEM_PROMPT,
      messages:       [],
      userContent:    `Convert this to JSON:\n\n${slideContent}`,
    });

    // Step 3: Parse & generate PPTX
    let rawJson = jsonResult.text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const js = rawJson.indexOf('{'), je = rawJson.lastIndexOf('}');
    if (js !== -1 && je !== -1) rawJson = rawJson.substring(js, je + 1);

    const pptData = JSON.parse(rawJson);
    if (!pptData?.slides?.length) throw new Error('No slides generated');

    const outputDir = path.join(process.cwd(), 'data', 'files');
    const result    = await PptxService.generate({ pptData, slideContent, title, outputDir, styleDesc });

    const isUsingClaude = isClaudeProvider(bot);
    const isUsingGemini = isGeminiProvider(bot);
    const providerBadge = isUsingClaude ? '🟠 Claude' : isUsingGemini ? '🔵 Gemini' : '🟢 GPT';
    const responseMarkdown = _buildPptResponseMarkdown({ title, result, styleDesc, providerBadge, lang: prompt, gysTheme: !!gysThemeInstructions });

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
      detail: { title, theme: detectedTheme, provider: bot.aiProvider?.provider, gysTheme: !!gysThemeInstructions }, username: req.session?.username }).catch(() => {});

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
// ✅ FIXED: Claude vision API call yang benar dengan array content blocks
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

    // Check for GYS theme reference in knowledge base
    const gysThemeInstructions = extractGYSThemeInstructions(bot);

    let docText  = '';
    let images   = [];
    let fileName = 'Document';

    // ── Extract document content ──────────────────────────────
    if (req.file) {
      fileName  = req.file.originalname;
      const ext = path.extname(fileName).toLowerCase();
      const buf = req.file.buffer;

      console.log(`[PPTX/Doc] File: ${fileName} | Size: ${Math.round(buf.length / 1024)}KB | Provider: ${providerName}`);

      if (ext === '.docx') {
        docText = await extractDocxText(buf, fileName);
        images  = extractDocxImages(buf);
        console.log(`[PPTX/Doc] Content: ${docText.length} chars text, ${images.length} images`);

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

    const userRequest = prompt || `Buat presentasi dari dokumen ini: ${fileName}`;
    const hasImages    = images.length > 0;
    const imageConstraint = !hasImages 
      ? '\n\nCRITICAL: This document has NO images. NEVER use LAYOUT: IMAGE. Only use: TITLE, SECTION, CONTENT, GRID, STATS, TIMELINE, TWO_COLUMN, CHART, TABLE, QUOTE, CLOSING.'
      : `\n\nDocument has ${images.length} image(s). Use LAYOUT: IMAGE only for actual images.`;
    const title       = (prompt || fileName).replace(/\.(docx|pdf|xlsx|txt|md)$/i, '').substring(0, 60);

    const isMultiModal = hasImages;

    // ── Build user content berdasarkan provider ───────────────
    let userContent;
    let systemWithTheme = PPT_CONTENT_SYSTEM_PROMPT;

    if (gysThemeInstructions) {
      systemWithTheme += `\n\nGYS THEME REQUIREMENT (WAJIB DIIKUTI):\n${gysThemeInstructions}`;
    }

    if (isUsingClaude && hasImages) {
      // ✅ FIX: Gunakan format array content block yang benar untuk Claude
      userContent = buildClaudeVisionContent(docText, images, userRequest, styleDesc, gysThemeInstructions);
      console.log(`[PPTX/Claude] Built ${userContent.length} content blocks (${images.length} image blocks)`);

    } else if (isUsingGemini && hasImages) {
      userContent = buildOpenAIVisionContent(docText, images, userRequest, styleDesc, gysThemeInstructions);
      console.log(`[PPTX/Gemini] Built vision content with ${images.length} images`);

    } else if (!isUsingClaude && !isUsingGemini && hasImages) {
      // OpenAI GPT-4o vision
      userContent = buildOpenAIVisionContent(docText, images, userRequest, styleDesc, gysThemeInstructions);
      console.log(`[PPTX/OpenAI] Built vision content with ${images.length} images`);

    } else {
      // No images or unsupported vision — text only
      const themeNote = gysThemeInstructions ? `\n\nGYS THEME:\n${gysThemeInstructions}\n` : '';
      userContent = `${userRequest}${imageConstraint}\n${themeNote}\nDOCUMENT CONTENT:\n${docText.substring(0, 35000)}`;
    }

    // ── Step 1: Generate slide content ───────────────────────
    console.log(`[PPTX/Doc] Step 1 — generating content with ${providerName}...`);

    const contentResult = await callAIWithContent({
      bot,
      systemPrompt: systemWithTheme,
      userContent,
      isMultiModal,
    });

    const slideContent = contentResult.text;
    if (!slideContent?.trim()) throw new Error('AI returned empty content for document');

    // ── Step 2: Convert to JSON ───────────────────────────────
    console.log(`[PPTX/Doc] Step 2 — converting to JSON...`);

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
    console.log(`[PPTX/Doc] Step 3 — generating PPTX (${pptData.slides.length} slides)...`);

    const outputDir = path.join(process.cwd(), 'data', 'files');
    const result    = await PptxService.generate({ pptData, slideContent, title, outputDir, styleDesc });

    // ── Step 4: Response ──────────────────────────────────────
    const providerBadge = isUsingClaude ? '🟠 Claude' : isUsingGemini ? '🔵 Gemini' : '🟢 GPT';
    const extraInfo     = hasImages
      ? `\n📸 **Gambar dalam dokumen:** ${images.length} gambar dianalisis dan dimasukkan ke presentasi`
      : '';

    const responseMarkdown = _buildPptResponseMarkdown({
      title, result, styleDesc, providerBadge, lang: userRequest,
      extraInfo, fromDoc: fileName, gysTheme: !!gysThemeInstructions,
    });

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
      detail: { title, fileName, imageCount: images.length, provider: providerName, theme: detectedTheme, gysTheme: !!gysThemeInstructions },
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

function _buildPptResponseMarkdown({ title, result, styleDesc, providerBadge, lang, extraInfo = '', fromDoc = '', gysTheme = false }) {
  const isIndo = /\b(buatkan|buat|presentasi|tolong|dari|dengan|untuk|summary|ringkas)\b/i.test(lang || '');

  const gysNote = gysTheme
    ? '\n🎨 **GYS Theme:** Tema resmi GYS diterapkan dari knowledge base'
    : '';

  if (isIndo) {
    return `✅ **Presentasi berhasil dibuat!**

📊 **Judul:** ${title}
📑 **Jumlah Slide:** ${result.slideCount} slides
🎨 **Tema:** ${styleDesc}
${providerBadge ? `🤖 **AI Provider:** ${providerBadge}` : ''}
${fromDoc ? `📄 **Dari Dokumen:** ${fromDoc}` : ''}${gysNote}${extraInfo}

---
### [⬇️ Download Presentasi (.pptx)](${result.pptxUrl})

💡 _Tip: Upload file PPT bertemakan GYS ke Knowledge Base di Admin Dashboard agar bot bisa menyesuaikan tema secara otomatis._`;
  }

  return `✅ **Presentation successfully generated!**

📊 **Title:** ${title}
📑 **Slides:** ${result.slideCount} slides
🎨 **Theme:** ${styleDesc}
${providerBadge ? `🤖 **AI Provider:** ${providerBadge}` : ''}
${fromDoc ? `📄 **From Document:** ${fromDoc}` : ''}${gysNote}${extraInfo}

---
### [⬇️ Download Presentation (.pptx)](${result.pptxUrl})

💡 _Tip: Upload a GYS-themed PPT file to the Knowledge Base in Admin Dashboard for automatic theme matching._`;
}

export default router;
