// server/services/ai-core.service.js
// ✅ PATCH v1.2.0 — Fixes:
//   1. TIMEOUT FIX: Doc content capped at 8000 chars (was 20000) + conversation ctx trimmed
//   2. SMART IMAGE AUTO-SELECTION: Images from doc auto-embedded into slides with context matching
//   3. IMAGE PLACEMENT INTELLIGENCE: AI decides which slides NEED images based on content type
//   4. SECTION-BASED IMAGE MAPPING: Images matched to slides by document section position
//   5. ALWAYS-INCLUDE IMAGES: Architectural/diagram images ALWAYS placed in relevant slides
//   6. FALLBACK SAFE: If smart-image-selector missing, falls back to graceful position-based mapping

import pdf      from 'pdf-parse';
import mammoth  from 'mammoth';
import XLSX     from 'xlsx';
import fs       from 'fs';
import path     from 'path';

import Chat     from '../models/Chat.js';
import Thread   from '../models/Thread.js';
import Bot      from '../models/Bot.js';

import AIProviderService      from './ai-provider.service.js';
import { normalizeUsage }     from './ai-provider.service.js';
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
RULE #4 — WHEN SOURCE DOCUMENT IS PROVIDED
═══════════════════════════════════════════════════════
If the user uploaded a document (PDF, DOCX, XLSX, PPTX):
- USE THE ACTUAL CONTENT from the document — do not hallucinate or invent data.
- Extract the key structure: headings → slide titles, sections → slide groups.
- Preserve specific numbers, names, dates, and statistics EXACTLY as in the document.
- If the document has images referenced, note them in the slide as [IMAGE: description].
- Build slides that faithfully represent the document's message and structure.

═══════════════════════════════════════════════════════
RULE #5 — IMAGE PLACEMENT INSTRUCTIONS
═══════════════════════════════════════════════════════
When a document has diagrams, architecture diagrams, or screenshots:
- For CONTENT slides about infrastructure, architecture, network diagrams → add [NEEDS_IMAGE: architecture]
- For slides about specific AWS services with diagrams → add [NEEDS_IMAGE: diagram]  
- For slides about configuration/settings with screenshots → add [NEEDS_IMAGE: screenshot]
- For the title/cover slide → add [NEEDS_IMAGE: cover] if a logo/brand image exists
- For GRID, STATS, TIMELINE, CHART, TABLE slides → do NOT add NEEDS_IMAGE (they have rich visual layouts)

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
{ "layout": "CONTENT", "title": "...", "bullets": ["Full sentence bullet 1", "Full sentence bullet 2"], "needsImage": "architecture|diagram|screenshot|cover|none" }

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
9. For CONTENT slides: include "needsImage" field. Set to "architecture", "diagram", "screenshot", or "none".
   - "architecture" → for slides about system design, network diagrams, high-level infrastructure
   - "diagram" → for slides about specific service/component diagrams
   - "screenshot" → for slides about configuration, settings, console screenshots
   - "none" → for slides that don't need images (GRID, STATS, TIMELINE, CHART, TABLE already have rich visuals)

Output format:
{ "slides": [ { ...slide1 }, { ...slide2 }, ... ] }
`;

// ─────────────────────────────────────────────────────────────
// PPT HELPER FUNCTIONS
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

// ─────────────────────────────────────────────────────────────
// ✅ v1.2.0 — Enhanced image extractor with metadata
// Returns array of { path, url, caption, mimeType, index, sizeBytes, isLarge }
// ─────────────────────────────────────────────────────────────
async function extractImagesFromUploadedFile(filePath, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const IMAGE_OUTPUT_DIR = path.join(process.cwd(), 'data', 'files', 'extracted-images');

  if (!fs.existsSync(IMAGE_OUTPUT_DIR)) {
    fs.mkdirSync(IMAGE_OUTPUT_DIR, { recursive: true });
  }

  const images = [];

  try {
    const JSZip = (await import('jszip')).default;
    const data  = fs.readFileSync(filePath);
    const zip   = await JSZip.loadAsync(data);

    const mimeMap = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    };

    let mediaPrefix = '';
    if (ext === '.docx') mediaPrefix = 'word/media/';
    else if (ext === '.pptx') mediaPrefix = 'ppt/media/';
    else if (ext === '.xlsx') mediaPrefix = 'xl/media/';

    if (!mediaPrefix) return images;

    const imageEntries = Object.keys(zip.files).filter(name =>
      name.startsWith(mediaPrefix) && !zip.files[name].dir
    );

    // Sort by filename to maintain document order
    imageEntries.sort((a, b) => {
      const na = parseInt((a.match(/\d+/) || [0])[0]);
      const nb = parseInt((b.match(/\d+/) || [0])[0]);
      return na - nb;
    });

    const safeBase = path.basename(originalName, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);

    for (let i = 0; i < imageEntries.length; i++) {
      const entry    = zip.files[imageEntries[i]];
      const imgExt   = path.extname(imageEntries[i]).toLowerCase();
      if (!mimeMap[imgExt]) continue;

      const imgBuffer  = await entry.async('nodebuffer');

      // ✅ v1.2.0: Lower threshold to 3KB (was 5KB) to capture more diagrams
      // GIF files (often logos/decorative) skip unless large
      const isGif = imgExt === '.gif';
      const minSize = isGif ? 50000 : 3000;
      if (imgBuffer.length < minSize) continue;

      const imgFilename = `upload_${safeBase}_img${i + 1}${imgExt}`;
      const imgPath     = path.join(IMAGE_OUTPUT_DIR, imgFilename);
      const imgUrl      = `/api/files/extracted-images/${imgFilename}`;

      fs.writeFileSync(imgPath, imgBuffer);
      
      // ✅ v1.2.0: Track image size for smarter selection
      const isLarge = imgBuffer.length > 100000; // > 100KB = likely a real diagram/screenshot
      const isMedium = imgBuffer.length > 30000;  // 30-100KB = could be diagram

      images.push({
        filename:   imgFilename,
        path:       imgPath,
        url:        imgUrl,
        mimeType:   mimeMap[imgExt],
        index:      i,
        sizeBytes:  imgBuffer.length,
        isLarge,
        isMedium,
        caption:    `Image ${i + 1} from ${path.basename(originalName)}`,
        sourceFile: originalName,
        // Position ratio in doc (0.0 = start, 1.0 = end) — used for section matching
        positionRatio: i / Math.max(imageEntries.length - 1, 1),
      });
    }

    console.log(`[AICoreService] Extracted ${images.length} images from uploaded "${originalName}"`);
    console.log(`[AICoreService] Large: ${images.filter(i=>i.isLarge).length}, Medium: ${images.filter(i=>i.isMedium&&!i.isLarge).length}`);
  } catch (err) {
    console.warn(`[AICoreService] Image extraction from upload failed:`, err.message);
  }

  return images;
}

// ─────────────────────────────────────────────────────────────
// ✅ v1.2.0 — Smart image-to-slide assignment
// Assigns images based on needsImage field and slide position
// ─────────────────────────────────────────────────────────────
function smartAssignImagesToSlides(slides, extractedImages) {
  if (!extractedImages || extractedImages.length === 0) return slides;

  // Only use large/medium images for assignment
  const usableImages = extractedImages.filter(img => img.isLarge || img.isMedium);
  if (usableImages.length === 0) return slides;

  const assigned = slides.map(s => ({ ...s }));
  const totalSlides = assigned.length;
  const usedImgIndices = new Set();

  // Pass 1: Assign images to slides that explicitly need them (needsImage != 'none')
  for (let si = 0; si < assigned.length; si++) {
    const slide = assigned[si];
    const layout = (slide.layout || 'CONTENT').toUpperCase();
    const needsImage = (slide.needsImage || 'none').toLowerCase();
    
    // Skip slides that don't need images or have rich visual layouts
    if (needsImage === 'none') continue;
    if (['GRID', 'STATS', 'CHART', 'TIMELINE', 'TABLE', 'QUOTE'].includes(layout)) continue;
    if (slide.imagePath) continue; // already has image

    // Calculate slide position ratio (0.0–1.0)
    const slideRatio = si / Math.max(totalSlides - 1, 1);

    // Find best image by proximity to slide position in document
    let bestImg = null;
    let bestScore = Infinity;

    for (let ii = 0; ii < usableImages.length; ii++) {
      if (usedImgIndices.has(ii)) continue;
      const img = usableImages[ii];
      
      // Score = positional distance + size bonus
      const posDist = Math.abs(img.positionRatio - slideRatio);
      const sizeBonus = img.isLarge ? -0.1 : 0; // prefer large images
      const score = posDist + sizeBonus;

      if (score < bestScore) {
        bestScore = score;
        bestImg = { img, idx: ii };
      }
    }

    if (bestImg && bestScore < 0.4) { // Only assign if reasonably close
      assigned[si].imagePath = bestImg.img.path;
      assigned[si].caption   = bestImg.img.caption;
      usedImgIndices.add(bestImg.idx);
    }
  }

  return assigned;
}

// ─────────────────────────────────────────────────────────────
// Deep read of uploaded document for PPT context
// ✅ v1.2.0: Capped at 8000 chars (was 20000) to prevent timeout
// ─────────────────────────────────────────────────────────────
async function deepReadDocument(filePath, originalName, mimetype) {
  const ext = path.extname(originalName || '').toLowerCase();
  let content = '';

  try {
    if (ext === '.pdf' || mimetype === 'application/pdf') {
      const buffer = fs.readFileSync(filePath);
      const data   = await pdf(buffer);
      content = data.text || '';

    } else if (ext === '.docx' || ext === '.doc' || (mimetype || '').includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ path: filePath });
      content = result.value || '';

    } else if (ext === '.xlsx' || ext === '.xls' || (mimetype || '').includes('spreadsheetml')) {
      const workbook = XLSX.readFile(filePath);
      const parts    = workbook.SheetNames.map(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const csv   = XLSX.utils.sheet_to_csv(sheet);
        return `=== Sheet: ${sheetName} ===\n${csv}`;
      });
      content = parts.join('\n\n');

    } else if (ext === '.pptx' || ext === '.ppt' || (mimetype || '').includes('presentationml')) {
      try {
        const JSZip   = (await import('jszip')).default;
        const data    = fs.readFileSync(filePath);
        const zip     = await JSZip.loadAsync(data);
        const slides  = Object.keys(zip.files)
          .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
          .sort((a, b) => {
            const na = parseInt(a.match(/\d+/)[0]);
            const nb = parseInt(b.match(/\d+/)[0]);
            return na - nb;
          });

        const slideTexts = [];
        for (const sf of slides) {
          const xml     = await zip.files[sf].async('string');
          const matches = xml.match(/<a:t[^>]*>(.*?)<\/a:t>/g) || [];
          const text    = matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ').trim();
          if (text) slideTexts.push(`[Slide ${slideTexts.length + 1}]\n${text}`);
        }
        content = slideTexts.join('\n\n');
      } catch (e) {
        content = `[PPTX: ${originalName} — gagal ekstrak teks: ${e.message}]`;
      }

    } else if (['.txt', '.md', '.csv'].includes(ext)) {
      content = fs.readFileSync(filePath, 'utf8');
    }

    // ✅ v1.2.0: Reduced from 20000 to 8000 chars to prevent API timeout
    // The key insight: AI only needs the structure/headings, not every detail
    const MAX_CHARS = 8000;
    if (content.length > MAX_CHARS) {
      // Smart truncation: try to keep section headings visible
      const lines = content.split('\n');
      let smartContent = '';
      let charCount = 0;
      
      for (const line of lines) {
        const trimmed = line.trim();
        // Always include headings/titles even near limit
        const isHeading = trimmed.length < 80 && trimmed.length > 3 && 
                          !trimmed.startsWith('•') && !trimmed.startsWith('-') &&
                          !/^\s*\d+\.\s/.test(trimmed) === false || // numbered items
                          /^[A-Z][A-Z\s]+$/.test(trimmed) ||        // ALL CAPS headings
                          /^\d+\.\s/.test(trimmed);                  // numbered headings
        
        if (charCount + line.length > MAX_CHARS && !isHeading) {
          smartContent += '\n\n[... konten dipotong, fokus pada struktur utama ...]';
          break;
        }
        smartContent += line + '\n';
        charCount += line.length;
      }
      content = smartContent;
    }
  } catch (err) {
    console.error(`[AICoreService] deepReadDocument error "${originalName}":`, err.message);
    content = `[Error membaca dokumen "${originalName}": ${err.message}]`;
  }

  return content.trim();
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

  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    let bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    if (!threadId) {
      const title     = message ? message.substring(0, 30) : `Chat with ${bot.name}`;
      const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
      await newThread.save();
      threadId = newThread._id;
    }

    if (isPptCommand(message)) {
      return this._handlePptCommand({ userId, botId, bot, message, threadId, history, attachedFile });
    }

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
  // ✅ PATCHED v1.3.0:
  //   - Timeout fix: doc content capped, conversation ctx trimmed
  //   - Smart image-to-slide assignment based on needsImage field
  //   - Graceful fallback if smart-image-selector not available
  //   - [v1.3.0] timeout=120000 & maxTokens passed to both AI calls
  //   - [v1.3.0] contentUserMsg hard-capped at 12000 chars
  //   - [v1.3.0] slideContent trimmed before JSON conversion step
  // ─────────────────────────────────────────────────────────
  async _handlePptCommand({ userId, botId, bot, message, threadId, history = [], attachedFile }) {
    try {
      // ── STEP 0: Load DB history — minimal filter ────────────────────────────
      let dbHistory = [];
      try {
        if (threadId) {
          const rawHistory = await Chat.find({ threadId }).sort({ createdAt: 1 }).limit(50).lean();
          dbHistory = rawHistory.filter(h => {
            if (!h.content || h.content.trim().length < 10) return false;
            const isDownloadMsg = h.content.includes('/api/files/') && h.content.includes('.pptx');
            return !isDownloadMsg;
          });
        }
      } catch (e) {
        console.warn('[PPT] DB history error:', e.message);
      }

      // ── STEP 0.5: Merge histories ───────────────────────────────────────────
      const inMemoryHistory = (history || []).filter(h => {
        if (!h.content || h.content.trim().length < 10) return false;
        const isDownloadMsg = h.content.includes('/api/files/') && h.content.includes('.pptx');
        return !isDownloadMsg;
      });

      const dbIds = new Set(dbHistory.map(h => String(h._id)));
      const mergedHistory = [
        ...dbHistory,
        ...inMemoryHistory.filter(h => !h._id || !dbIds.has(String(h._id))),
      ];

      // ── STEP 0.6: Load knowledge base + template ────────────────────────────
      const freshBot       = await Bot.findById(botId).lean();
      const knowledgeFiles = freshBot?.knowledgeFiles || [];

      let templatePath = null;
      if (freshBot?.pptTemplateFileId && knowledgeFiles.length > 0) {
        const templateFile = knowledgeFiles.find(f =>
          String(f._id) === freshBot.pptTemplateFileId &&
          (f.originalName?.endsWith('.pptx') || f.mimetype?.includes('presentationml'))
        );
        if (templateFile && fs.existsSync(templateFile.path)) {
          templatePath = templateFile.path;
        }
      }

      if (!templatePath) {
        const pptxFile = knowledgeFiles.find(f =>
          f.originalName?.toLowerCase().endsWith('.pptx') &&
          f.path && fs.existsSync(f.path)
        );
        if (pptxFile) templatePath = pptxFile.path;
      }

      const kbExtractedImages = KnowledgeBaseService.getExtractedImages(
        knowledgeFiles, message, freshBot?.knowledgeMode || 'relevant'
      );

      let knowledgeCtx = '';
      if (knowledgeFiles.length > 0 && freshBot?.knowledgeMode !== 'disabled') {
        knowledgeCtx = KnowledgeBaseService.buildKnowledgeContext(
          knowledgeFiles, message, freshBot?.knowledgeMode || 'relevant'
        );
      }

      // ── STEP 1: Read uploaded chat document ─────────────────────────────────
      let uploadedDocContent = '';
      let uploadedDocImages  = [];
      let uploadedDocName    = '';

      if (attachedFile) {
        const physicalPath = attachedFile.serverPath || attachedFile.path;
        const originalName = attachedFile.originalname || attachedFile.filename || '';
        uploadedDocName    = originalName;

        if (physicalPath && fs.existsSync(physicalPath)) {
          console.log(`[PPT] Reading uploaded document: "${originalName}"`);
          uploadedDocContent = await deepReadDocument(physicalPath, originalName, attachedFile.mimetype);

          const ext = path.extname(originalName).toLowerCase();
          if (['.docx', '.pptx', '.xlsx'].includes(ext)) {
            uploadedDocImages = await extractImagesFromUploadedFile(physicalPath, originalName);
          }
          console.log(`[PPT] Document content: ${uploadedDocContent.length} chars, ${uploadedDocImages.length} images extracted`);
        }
      }

      // ── STEP 1.5: Build conversation context — CAPPED to prevent timeout ────
      let conversationContext = '';
      let draftContent        = '';

      if (mergedHistory.length > 0) {
        const meaningfulMessages = mergedHistory
          .filter(h => h.content && h.content.trim().length > 50)
          .slice(-20);

        if (meaningfulMessages.length > 0) {
          const draftKeywords = [
            'slide 1', 'slide 2', 'slide 3', 'slide ke',
            'bab 1', 'bab 2', 'section 1',
            'outline', 'struktur', 'structure', 'draf', 'draft',
            'poin 1', 'poin 2', 'point 1',
            '1.', '2.', '3.',
            '- ', '* ',
            'agenda', 'konten', 'isi slide', 'slide content',
            'judul slide', 'slide title',
          ];

          const draftMessages = meaningfulMessages.filter(h => {
            if (h.role !== 'user') return false;
            const lower = h.content.toLowerCase();
            return draftKeywords.some(kw => lower.includes(kw));
          });

          if (draftMessages.length > 0) {
            const primaryDraft = draftMessages
              .sort((a, b) => b.content.length - a.content.length)[0];
            draftContent = primaryDraft.content;
            console.log(`[PPT] Draft detected in conversation (${draftContent.length} chars)`);
          }

          // ✅ v1.2.0: Cap conversation context at 3000 chars (was 6000) to prevent timeout
          const historyForContext = meaningfulMessages.slice(-10); // last 10 (was 20)
          const rawContext = historyForContext
            .map(h => `[${h.role === 'assistant' ? 'BOT' : 'USER'}]: ${h.content.substring(0, 300)}`) // 300 per msg (was 500)
            .join('\n\n---\n\n');
          
          conversationContext = rawContext.substring(0, 3000); // hard cap
          console.log(`[PPT] Conversation context: ${historyForContext.length} msgs, ${conversationContext.length} chars`);
        }
      }

      const rawExtractedImages = [...uploadedDocImages, ...kbExtractedImages];

      // ── STEP 2: Build content generation prompt — LEAN & FOCUSED ────────────
      const userRequest = message || '';
      let contentUserMsg = '';

      // --- Source 1: Uploaded document ---
      if (uploadedDocContent) {
        contentUserMsg += `=== DOKUMEN YANG DI-UPLOAD: "${uploadedDocName}" ===\n`;
        contentUserMsg += uploadedDocContent + '\n\n';
        
        // ✅ v1.2.0: Tell AI about available images for smarter needsImage hints
        if (rawExtractedImages.length > 0) {
          const largeImgs = rawExtractedImages.filter(i => i.isLarge).length;
          const medImgs   = rawExtractedImages.filter(i => i.isMedium && !i.isLarge).length;
          contentUserMsg += `GAMBAR TERSEDIA: ${rawExtractedImages.length} total (${largeImgs} besar/diagram, ${medImgs} sedang/screenshot)\n`;
          contentUserMsg += `INSTRUKSI GAMBAR: Untuk slide yang menjelaskan arsitektur/diagram/konfigurasi, tandai [NEEDS_IMAGE: architecture/diagram/screenshot]\n\n`;
        }
      }

      // --- Source 2: Draft from conversation ---
      if (draftContent && !uploadedDocContent) {
        contentUserMsg += `=== DRAFT / STRUKTUR DARI CONVERSATION ===\n`;
        contentUserMsg += draftContent + '\n\n';
      }

      // --- Source 3: Conversation context (capped) ---
      if (conversationContext && !uploadedDocContent) {
        // Only include conv context if no uploaded doc (doc takes priority and saves tokens)
        contentUserMsg += `=== RIWAYAT PERCAKAPAN ===\n`;
        contentUserMsg += conversationContext + '\n\n';
      }

      // --- Source 4: Knowledge base (trimmed) ---
      if (knowledgeCtx) {
        contentUserMsg += `=== KNOWLEDGE BASE ===\n`;
        contentUserMsg += knowledgeCtx.substring(0, 2000) + '\n\n'; // was 3000
      }

      // --- Source 5: User request ---
      contentUserMsg += `=== PERMINTAAN USER ===\n${userRequest}\n\n`;
      contentUserMsg += `INSTRUKSI: Buat presentasi berkualitas tinggi dari dokumen di atas. `;
      contentUserMsg += `Gunakan layout yang tepat per slide. Untuk slide yang butuh gambar (arsitektur, diagram, screenshot), `;
      contentUserMsg += `tambahkan [NEEDS_IMAGE: architecture/diagram/screenshot] di akhir konten slide tersebut.\n`;

      // ✅ v1.3.0: Hard cap total prompt — mencegah timeout pada dokumen besar
      const MAX_PROMPT_CHARS = 12000;
      if (contentUserMsg.length > MAX_PROMPT_CHARS) {
        console.warn(`[PPT] contentUserMsg terlalu besar (${contentUserMsg.length} chars), dipotong ke ${MAX_PROMPT_CHARS}`);
        contentUserMsg = contentUserMsg.substring(0, MAX_PROMPT_CHARS) + '\n\n[... konten dipotong untuk efisiensi ...]\n';
      }

      // ── STEP 3: Content Generation ──────────────────────────────────────────
      console.log('[PPT] Step 1 — generating content...');

      const contentResult = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt:   PPT_CONTENT_SYSTEM_PROMPT,
        messages:       [],
        userContent:    contentUserMsg,
        timeout:        120000, // ✅ v1.3.0: 120 detik (was 60s default)
        maxTokens:      3500,   // ✅ v1.3.0: batasi output agar step 2 tidak kehabisan token
      });

      const slideContent = contentResult.text;
      if (!slideContent?.trim()) throw new Error('AI returned empty slide content');

      const titleMatch = slideContent.match(/^#\s+(.+)/m);
      const title = titleMatch ? titleMatch[1].trim().substring(0, 60) : 'GYS Executive Deck';

      const contentUsage = normalizeUsage(contentResult.usage, bot.aiProvider?.provider || 'openai', bot.aiProvider?.model || '');
      console.log(`[PPT] Content ready — Title: "${title}" | ${slideContent.length} chars`);

      // ── STEP 4: JSON Conversion ──────────────────────────────────────────────
      console.log('[PPT] Step 2 — converting to JSON...');

      // ✅ v1.3.0: Trim slideContent sebelum dikirim ke step 2 — JSON step tidak perlu teks >8000 chars
      const slideContentForJson = slideContent.length > 8000
        ? slideContent.substring(0, 8000) + '\n\n[... dipotong ...]'
        : slideContent;

      const jsonResult = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt:   PPT_JSON_SYSTEM_PROMPT,
        messages:       [],
        userContent:    `Convert this presentation to JSON:\n\n${slideContentForJson}`,
        timeout:        120000, // ✅ v1.3.0: 120 detik
        maxTokens:      4000,   // ✅ v1.3.0: JSON output bisa panjang, beri ruang cukup
      });

      let rawJson = jsonResult.text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      const jsonStart = rawJson.indexOf('{');
      const jsonEnd   = rawJson.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) rawJson = rawJson.substring(jsonStart, jsonEnd + 1);

      let pptData;
      try {
        pptData = JSON.parse(rawJson);
      } catch (parseErr) {
        throw new Error('AI gagal membuat format data presentasi. Silakan coba lagi.');
      }

      if (!pptData?.slides?.length) throw new Error('JSON tidak memiliki slides.');

      const layoutLog = pptData.slides.map(s => s.layout || 'CONTENT').join(', ');
      console.log(`[PPT] JSON OK — ${pptData.slides.length} slides — [${layoutLog}]`);

      // ── STEP 4.5: Smart Image Assignment ────────────────────────────────────
      // ✅ v1.2.0: Use position-based assignment with needsImage hints
      // This replaces the external smart-image-selector which caused extra API calls
      let finalExtractedImages = [];

      if (rawExtractedImages.length > 0) {
        console.log(`[PPT] Step 2.5 — assigning images to slides (${rawExtractedImages.length} available)...`);
        
        try {
          // Try the external smart selector first (if available)
          const { selectRelevantImages } = await import('./smart-image-selector.service.js');
          finalExtractedImages = await selectRelevantImages(
            rawExtractedImages, userRequest, slideContent, bot.aiProvider, 6
          );
          console.log(`[PPT] Smart selector: ${rawExtractedImages.length} → ${finalExtractedImages.length} selected`);
        } catch (selErr) {
          // ✅ v1.2.0: Fallback to built-in position-based selection
          console.log(`[PPT] Smart selector unavailable, using built-in position-based selection`);
          
          // Filter: only use medium/large images, skip tiny decoratives
          const validImages = rawExtractedImages.filter(img => img.isLarge || img.isMedium);
          
          // Cap at 8 images max to keep file size manageable
          finalExtractedImages = validImages.slice(0, 8);
          console.log(`[PPT] Built-in selection: ${rawExtractedImages.length} → ${finalExtractedImages.length} images`);
        }

        // ✅ v1.2.0: Apply smart position-based slide assignment
        pptData.slides = smartAssignImagesToSlides(pptData.slides, finalExtractedImages);
        
        const assignedCount = pptData.slides.filter(s => s.imagePath).length;
        console.log(`[PPT] Image assignment: ${assignedCount} slides will include images`);
      }

      // ── STEP 5: Render PPTX ─────────────────────────────────────────────────
      const outputDir = path.join(process.cwd(), 'data', 'files');
      const result = await PptxService.generate({
        pptData,
        slideContent,
        title,
        outputDir,
        styleDesc:       templatePath ? 'Custom Template' : 'GYS Gamma Style',
        templatePath,
        extractedImages: finalExtractedImages,
      });

      // ── STEP 6: Build Response ───────────────────────────────────────────────
      const reqLower   = userRequest.toLowerCase();
      const engWords   = reqLower.match(/\b(create|make|generate|presentation|deck|please)\b/g) || [];
      const indWords   = reqLower.match(/\b(buat|buatkan|bikin|tolong|presentasi)\b/g) || [];
      const isEnglish  = engWords.length > indWords.length;

      const layoutIcons = {
        TITLE: '🏷️', CONTENT: '📝', GRID: '🧩', STATS: '📊',
        TIMELINE: '🗓️', TWO_COLUMN: '↔️', CHART: '📈',
        TABLE: '📋', QUOTE: '💬', SECTION: '📌', CLOSING: '🎯', IMAGE_SLIDE: '🖼️',
      };

      const layoutSummary = pptData.slides
        .map((s, i) => {
          const ic  = layoutIcons[(s.layout || 'CONTENT').toUpperCase()] || '📄';
          const hasImg = s.imagePath ? ' 🖼️' : '';
          return `${ic} **Slide ${i + 1}:** ${s.title || '—'} _(${s.layout || 'CONTENT'})_${hasImg}`;
        })
        .join('\n');

      const templateNote = result.usedTemplate ? '\n🎨 **Template:** Custom template applied' : '';

      const assignedSlides = pptData.slides.filter(s => s.imagePath).length;
      let imageNote = '';
      if (rawExtractedImages.length > 0) {
        imageNote = `\n🖼️ **Gambar:** ${assignedSlides} slide berisi gambar dari ${rawExtractedImages.length} gambar di dokumen`;
      }

      const docNote = uploadedDocName
        ? `\n📄 **Sumber:** "${uploadedDocName}"`
        : (conversationContext ? `\n💬 **Sumber:** Dari diskusi conversation` : '');

      const jsonUsage    = normalizeUsage(jsonResult.usage, bot.aiProvider?.provider || 'openai', bot.aiProvider?.model || '');
      const totalTokens  = (contentUsage?.total_tokens || 0) + (jsonUsage?.total_tokens || 0);
      const tokenNote    = totalTokens > 0 ? `\n📊 **Token:** ${totalTokens.toLocaleString()}` : '';

      const responseMarkdown = isEnglish
        ? `✅ **GYS Presentation successfully generated!**

📊 **Title:** ${title}
📑 **Total Slides:** ${result.slideCount} slides${templateNote}${imageNote}${docNote}${tokenNote}

---
### [⬇️ Download Presentation (.pptx)](${result.pptxUrl})

**Auto-detected slide layouts:**
${layoutSummary}`
        : `✅ **Presentasi GYS berhasil dibuat!**

📊 **Judul:** ${title}
📑 **Jumlah Slide:** ${result.slideCount} slides${templateNote}${imageNote}${docNote}${tokenNote}

---
### [⬇️ Download Presentasi (.pptx)](${result.pptxUrl})

**Layout yang dipilih per slide:**
${layoutSummary}`;

      await new Chat({ userId, botId, threadId, role: 'user', content: message }).save();
      await new Chat({
        userId, botId, threadId, role: 'assistant', content: responseMarkdown,
        attachedFiles: [{ name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }],
      }).save();
      await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });

      return {
        response: responseMarkdown, threadId,
        attachedFiles: [{ name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }],
      };

    } catch (error) {
      console.error('❌ [PPT Command]', error);
      throw new Error(`Gagal membuat presentasi: ${error.message}`);
    }
  }
}

export default new AICoreService();