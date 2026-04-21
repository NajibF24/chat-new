// server/services/ai-core.service.js
// ✅ PATCH v1.4.0 — Fixes:
//   1. FLEXIBLE PPT PROMPT: Detects freeform layout requests (no /ppt prefix needed)
//      and passes them directly without forcing GYS corporate template constraints
//   2. CHUNKED LARGE DOC READING: Documents up to 100+ pages now handled via
//      progressive chunking + AI-assisted summarization per section
//   3. TEXT OVERFLOW HARDENING: All layout renderers now use stricter autoFit + caps
//   4. ISOLATED CHANGE: Regular bot chat is 100% unaffected

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

const PPT_CONTENT_SYSTEM_PROMPT = `You are an expert Presentation Strategist and Visual Designer.
Your job is to produce polished, visually rich slide content — like Gamma.app or Beautiful.ai.

═══════════════════════════════════════════════════════
RULE #0 — FREEFORM LAYOUT REQUESTS (HIGHEST PRIORITY)
═══════════════════════════════════════════════════════
If the user provides an EXPLICIT detailed layout specification (describes exact zones,
panels, colors, icons, milestone steps, status badges, etc.), you MUST:
- Follow their layout structure EXACTLY, mapping it to the best matching layout type
- Do NOT impose a different structure or "improve" their design
- Preserve all their described content verbatim (text, labels, icon descriptions)
- Map their zones to STATUS_SLIDE, TWO_COLUMN, TIMELINE, GRID, STATS as appropriate
- A user-described "top panels + bottom timeline" → STATUS_SLIDE
- A user-described "side-by-side comparison" → TWO_COLUMN
- A user-described "milestone steps" → TIMELINE
- A user-described "KPI numbers/metrics" → STATS
- Freeform requests can produce 1 single slide if the spec fits on one slide

Signs a request is FREEFORM (user is the designer):
  • Contains explicit section labels (LEFT PANEL, RIGHT PANEL, TOP, BOTTOM)
  • Contains explicit color/style instructions (white background, teal accents)
  • Contains explicit icon flow descriptions ([Document] → [Shield])
  • Contains STATUS BADGE or PROGRESS indicator descriptions
  • Contains speech bubble or pin icon instructions
  • Contains explicit bullet text to preserve verbatim

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

  Does it present 5–9 categories, modules, or feature groups in a matrix view?
    → LAYOUT: GRID_3X3  (3×3 icon cards grid — ideal for classification/overview slides)
      Use GRID_3X3 when: user asks for a "3x3 grid", "9 categories", "matrix layout",
      or lists 5–9 distinct items that should each get their own card.
      Each item has: icon, title, and a subItems list (short bullet points).

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

  Does it show PROJECT STATUS with: panels + milestone timeline + issue/blocker card?
    → LAYOUT: STATUS_SLIDE  ← use when user describes a freeform status/project update slide
      with combinations of: side-by-side panels, milestone steps with status icons,
      issue cards, vendor pipelines, or status badge pills.
      Never use CONTENT or TWO_COLUMN for this — STATUS_SLIDE renders all zones correctly.

  Is it general narrative content?
    → LAYOUT: CONTENT  (fallback — use only when nothing else fits)

═══════════════════════════════════════════════════════
RULE #3 — RICH CONTENT STANDARDS (NO LAZY CONTENT)
═══════════════════════════════════════════════════════
- GRID items: emoji icon + short title (3–5 words) + 2–3 sentence description (20+ words)
- GRID_3X3 items: emoji icon + short title (2–4 words) + 2–4 subItems (each 2–5 words, concise)
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

## [9-Category Overview]
LAYOUT: GRID_3X3
items:
- icon: 🪖
  title: Personal PPE
  subItems:
    - Hardhat Detection
    - Safety Vest
    - Uniform Compliance
    - Gloves
- icon: 👤
  title: Personal Behavior
  subItems:
    - Over the Fence
    - Sleep Guard
    - Crowd Detection

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

## [Project Status Update]
LAYOUT: STATUS_SLIDE
statusBadge:
  text: "⚠️ DELAY"
  color: amber
leftPanel:
  title: "Technical Assessment & PoC Results"
  iconFlow:
    - icon: 📷
      label: PPE Detection
    - icon: 🤖
      label: AI Brain
    - icon: 🔔
      label: Alerts
    - icon: ✅
      label: Validated
  bullets:
    - PPE detection (Helmet & Vest) validated in real-time
    - Smoke & Fire early-warning confirmed
    - Omnichannel notifications (WhatsApp & Email) verified
    - Vendor selected: PT Simbu Teknologi Indonesia
rightPanel:
  title: "Vendor Evaluation Pipeline"
  vendors:
    - name: PT Simbu Teknologi Indonesia
      selected: true
      status: SELECTED
    - name: Beruang Alfa
    - name: Rastek
  pipelineStage: "Technical Alignment & PoC Testing"
  note: "Superior detection accuracy and seamless integration."
timelineTitle: "Current Project Status & Next Steps"
milestones:
  - label: Assessment & PoC
    status: done
  - label: Purchasing Negotiation
    status: current
    note: "Negotiation ongoing. Contract and PO pending."
  - label: Contract Progress
    status: pending
  - label: PO Release
    status: blocked
  - label: Kick-Off Meeting
    status: pending
issueCard:
  tag: "⚠️ CURRENT ISSUES & BLOCKERS"
  title: "Project Delayed — Purchasing Negotiation Ongoing"
  color: amber
  bullets:
    - Negotiation not yet finalized — contract cannot begin
    - PO Release blocked until contract is approved
    - Kick-Off Meeting on hold
    - Risk: timeline significantly delayed if negotiation not resolved soon

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

GRID (visual icon cards, 2–4 items):
{ "layout": "GRID", "title": "...", "items": [{ "icon": "🚀", "title": "Short Title", "text": "Full description sentence here." }] }

GRID_3X3 (3×3 matrix grid, 5–9 category cards):
{ "layout": "GRID_3X3", "title": "...", "items": [{ "icon": "🪖", "title": "Category Name", "subItems": ["Sub-item 1", "Sub-item 2", "Sub-item 3"] }] }
Note: GRID_3X3 uses "subItems" (array of short strings), NOT "text". Include 2–4 subItems per card.

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

STATUS_SLIDE (project status with panels + timeline + issue card):
{
  "layout": "STATUS_SLIDE",
  "title": "...",
  "statusBadge": { "text": "⚠️ DELAY", "color": "amber" },
  "leftPanel": {
    "title": "...",
    "iconFlow": [{ "icon": "📷", "label": "PPE Detection" }],
    "bullets": ["Bullet 1", "Bullet 2"]
  },
  "rightPanel": {
    "title": "...",
    "vendors": [{ "name": "Vendor Name", "selected": true, "status": "SELECTED" }],
    "pipelineStage": "Technical Alignment & PoC Testing",
    "note": "Short note text here."
  },
  "timelineTitle": "Current Project Status & Next Steps",
  "milestones": [
    { "label": "Assessment & PoC", "status": "done" },
    { "label": "Negotiation", "status": "current", "note": "Ongoing negotiation." },
    { "label": "Contract", "status": "pending" },
    { "label": "PO Release", "status": "blocked" },
    { "label": "Kick-Off", "status": "pending" }
  ],
  "issueCard": {
    "tag": "⚠️ CURRENT ISSUES & BLOCKERS",
    "title": "Project Delayed — Purchasing Negotiation Ongoing",
    "color": "amber",
    "bullets": ["Issue 1", "Issue 2", "Issue 3"]
  }
}
Notes for STATUS_SLIDE:
- statusBadge color: "amber" | "red" | "green" | "blue"
- milestones status: "done" | "current" | "pending" | "blocked"
- issueCard color: "amber" | "red"
- leftPanel.iconFlow: array of {icon, label} — max 5 items
- rightPanel.vendors: array of {name, selected?, status?}

CRITICAL RULES:
1. Preserve ALL slides in the exact same order — do NOT drop, merge, or reorder slides.
2. For TIMELINE: map "steps" array exactly. NEVER convert a TIMELINE to a TABLE.
3. For GRID: map "items" array exactly with icon, title, text fields.
4. For GRID_3X3: map "items" array with icon, title, and subItems (string array) fields. NEVER use "text" for GRID_3X3 — use "subItems".
5. For STATS: map "stats" array with icon, value, label, sub fields.
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
// ✅ v1.4.0 — FREEFORM LAYOUT DETECTOR
// Detects when user is providing an explicit detailed layout spec
// Returns true if the message looks like a designer-level layout description
// ─────────────────────────────────────────────────────────────
function isFreeformLayoutRequest(message = '') {
  const t = message || '';

  // ── EARLY EXIT: Grid/category layout requests are NOT freeform ──────────
  // These are content requests that should go through normal AI layout detection.
  const gridPatterns = [
    /\b(3x3|3 x 3|grid|matrix)\b/i,
    /\b(\d+)\s*(kategori|categories|category|items?)\b/i,
    /buatkan\s+(slide|ppt|presentasi)/i,
    /create\s+(a\s+)?(slide|ppt|presentation)/i,
  ];
  if (gridPatterns.some(r => r.test(t))) return false;

  const indicators = [
    /LEFT\s+PANEL/i,
    /RIGHT\s+PANEL/i,
    /TOP\s*:/i,
    /BOTTOM\s*:/i,
    /STATUS\s+BADGE/i,
    /PROGRESS\s*(?:bar|indicator|\()/i,
    /SPEECH\s+BUBBLE/i,
    /PIN\s+ICON/i,
    /ICON\s+FLOW/i,
    /\[Document\]/i,
    /\[Shield\]/i,
    /\[\w+\]\s*→/,           // [Icon] → [Icon] arrow flows
    /Step\s+\d+\s*[—–-]/i,   // Step 1 — Description
    /milestone/i,
    /solid\s+(?:green|teal)/i,
    /dashed\s+gray/i,
    /green\s+(?:pill|checkmark|check)/i,
    /white\s+background.*(?:teal|green)\s+accent/i,
    /LAYOUT\s*:\s*Top/i,
    /LAYOUT\s*:\s*Bottom/i,
  ];
  // Need at least 3 indicators to be considered freeform
  const matches = indicators.filter(r => r.test(t));
  return matches.length >= 3;
}

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
      /\b(buat|buatkan|create|generate|make|tolong)\b/i.test(t)) ||
    // ✅ v1.4.0: Also catch freeform detailed layout requests
    isFreeformLayoutRequest(message)
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
      const isGif = imgExt === '.gif';
      const minSize = isGif ? 50000 : 3000;
      if (imgBuffer.length < minSize) continue;

      const imgFilename = `upload_${safeBase}_img${i + 1}${imgExt}`;
      const imgPath     = path.join(IMAGE_OUTPUT_DIR, imgFilename);
      const imgUrl      = `/api/files/extracted-images/${imgFilename}`;

      fs.writeFileSync(imgPath, imgBuffer);
      
      const isLarge  = imgBuffer.length > 100000;
      const isMedium = imgBuffer.length > 30000;

      images.push({
        filename:      imgFilename,
        path:          imgPath,
        url:           imgUrl,
        mimeType:      mimeMap[imgExt],
        index:         i,
        sizeBytes:     imgBuffer.length,
        isLarge,
        isMedium,
        caption:       `Image ${i + 1} from ${path.basename(originalName)}`,
        sourceFile:    originalName,
        positionRatio: i / Math.max(imageEntries.length - 1, 1),
      });
    }

    console.log(`[AICoreService] Extracted ${images.length} images from uploaded "${originalName}"`);
  } catch (err) {
    console.warn(`[AICoreService] Image extraction from upload failed:`, err.message);
  }

  return images;
}

// ─────────────────────────────────────────────────────────────
// ✅ v1.2.0 — Smart image-to-slide assignment
// ─────────────────────────────────────────────────────────────
function smartAssignImagesToSlides(slides, extractedImages) {
  if (!extractedImages || extractedImages.length === 0) return slides;

  const usableImages = extractedImages.filter(img => img.isLarge || img.isMedium);
  if (usableImages.length === 0) return slides;

  const assigned = slides.map(s => ({ ...s }));
  const totalSlides = assigned.length;
  const usedImgIndices = new Set();

  for (let si = 0; si < assigned.length; si++) {
    const slide = assigned[si];
    const layout = (slide.layout || 'CONTENT').toUpperCase();
    const needsImage = (slide.needsImage || 'none').toLowerCase();
    
    if (needsImage === 'none') continue;
    if (['GRID', 'STATS', 'CHART', 'TIMELINE', 'TABLE', 'QUOTE'].includes(layout)) continue;
    if (slide.imagePath) continue;

    const slideRatio = si / Math.max(totalSlides - 1, 1);

    let bestImg = null;
    let bestScore = Infinity;

    for (let ii = 0; ii < usableImages.length; ii++) {
      if (usedImgIndices.has(ii)) continue;
      const img = usableImages[ii];
      const posDist   = Math.abs(img.positionRatio - slideRatio);
      const sizeBonus = img.isLarge ? -0.1 : 0;
      const score     = posDist + sizeBonus;

      if (score < bestScore) {
        bestScore = score;
        bestImg   = { img, idx: ii };
      }
    }

    if (bestImg && bestScore < 0.4) {
      assigned[si].imagePath = bestImg.img.path;
      assigned[si].caption   = bestImg.img.caption;
      usedImgIndices.add(bestImg.idx);
    }
  }

  return assigned;
}

// ─────────────────────────────────────────────────────────────
// ✅ v1.4.0 — CHUNKED LARGE DOCUMENT READER
// Handles 100+ page documents by reading in chunks and
// summarising each chunk before passing to the PPT AI.
// This prevents timeout and token overflow on huge docs.
// ─────────────────────────────────────────────────────────────
async function deepReadDocumentChunked(filePath, originalName, mimetype, providerConfig) {
  const ext = path.extname(originalName || '').toLowerCase();

  // ── Step 1: Extract full raw text ──────────────────────────
  let fullText = '';
  try {
    if (ext === '.pdf' || mimetype === 'application/pdf') {
      const buffer = fs.readFileSync(filePath);
      const data   = await pdf(buffer);
      fullText     = data.text || '';

    } else if (ext === '.docx' || ext === '.doc' || (mimetype || '').includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ path: filePath });
      fullText     = result.value || '';

    } else if (ext === '.xlsx' || ext === '.xls' || (mimetype || '').includes('spreadsheetml')) {
      const workbook = XLSX.readFile(filePath);
      fullText = workbook.SheetNames.map(n => {
        return `=== Sheet: ${n} ===\n${XLSX.utils.sheet_to_csv(workbook.Sheets[n])}`;
      }).join('\n\n');

    } else if (ext === '.pptx' || ext === '.ppt' || (mimetype || '').includes('presentationml')) {
      try {
        const JSZip  = (await import('jszip')).default;
        const data   = fs.readFileSync(filePath);
        const zip    = await JSZip.loadAsync(data);
        const slides = Object.keys(zip.files)
          .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
          .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

        const slideTexts = [];
        for (const sf of slides) {
          const xml     = await zip.files[sf].async('string');
          const matches = xml.match(/<a:t[^>]*>(.*?)<\/a:t>/g) || [];
          const text    = matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ').trim();
          if (text) slideTexts.push(`[Slide ${slideTexts.length + 1}]\n${text}`);
        }
        fullText = slideTexts.join('\n\n');
      } catch (e) {
        fullText = `[PPTX: ${originalName} — failed to extract: ${e.message}]`;
      }

    } else if (['.txt', '.md', '.csv'].includes(ext)) {
      fullText = fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    console.error(`[AICoreService] deepReadDocumentChunked error "${originalName}":`, err.message);
    return `[Error reading document "${originalName}": ${err.message}]`;
  }

  fullText = fullText.trim();
  if (!fullText) return `[Document "${originalName}" appears to be empty]`;

  console.log(`[PPT] Raw document length: ${fullText.length} chars from "${originalName}"`);

  // ── Step 2: If small enough, return directly (fast path) ───
  const DIRECT_LIMIT = 8000;
  if (fullText.length <= DIRECT_LIMIT) {
    return fullText;
  }

  // ── Step 3: Chunked summarization for large docs ────────────
  // Split into chunks of ~6000 chars with overlap for context
  const CHUNK_SIZE    = 6000;
  const CHUNK_OVERLAP = 500;
  const MAX_CHUNKS    = 12; // Safety cap — beyond 12 chunks we sample

  const chunks = [];
  let pos = 0;
  while (pos < fullText.length) {
    chunks.push(fullText.slice(pos, pos + CHUNK_SIZE));
    pos += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  console.log(`[PPT] Large doc: ${chunks.length} chunks to process from "${originalName}"`);

  // If too many chunks, sample strategically (start, middle sections, end)
  let chunksToProcess = chunks;
  if (chunks.length > MAX_CHUNKS) {
    const step = Math.floor(chunks.length / MAX_CHUNKS);
    chunksToProcess = [];
    for (let i = 0; i < chunks.length; i += step) {
      chunksToProcess.push(chunks[i]);
      if (chunksToProcess.length >= MAX_CHUNKS) break;
    }
    // Always include the last chunk (conclusion/summary sections)
    if (chunksToProcess[chunksToProcess.length - 1] !== chunks[chunks.length - 1]) {
      chunksToProcess.push(chunks[chunks.length - 1]);
    }
    console.log(`[PPT] Sampled ${chunksToProcess.length} chunks (was ${chunks.length})`);
  }

  // Summarize each chunk — parallel with concurrency limit of 3
  const CONCURRENCY = 3;
  const summaries   = new Array(chunksToProcess.length).fill('');

  for (let i = 0; i < chunksToProcess.length; i += CONCURRENCY) {
    const batch = chunksToProcess.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (chunk, bi) => {
      const chunkIdx = i + bi + 1;
      try {
        const res = await AIProviderService.generateCompletion({
          providerConfig: providerConfig || { provider: 'openai', model: 'gpt-4o' },
          systemPrompt: `You are a document summarizer. Extract the key information from this document section for use in creating presentation slides. Focus on: headings, key data points, statistics, named entities, and main conclusions. Be concise but preserve all important facts verbatim. Output plain text only.`,
          messages:     [],
          userContent:  `Summarize this document section (chunk ${chunkIdx} of ${chunksToProcess.length}):\n\n${chunk}`,
          timeout:      60000,
          maxTokens:    600,
        });
        return res.text || '';
      } catch (err) {
        console.warn(`[PPT] Chunk ${chunkIdx} summarization failed:`, err.message);
        // Fallback: use first 400 chars of chunk directly
        return chunk.substring(0, 400) + '...';
      }
    }));

    results.forEach((r, bi) => { summaries[i + bi] = r; });
    console.log(`[PPT] Summarized chunks ${i + 1}–${Math.min(i + CONCURRENCY, chunksToProcess.length)} of ${chunksToProcess.length}`);
  }

  // Combine summaries
  const combined = summaries
    .map((s, i) => `=== Section ${i + 1} ===\n${s}`)
    .join('\n\n');

  // Final safety cap on combined summaries
  const SUMMARY_LIMIT = 10000;
  if (combined.length > SUMMARY_LIMIT) {
    console.log(`[PPT] Combined summaries (${combined.length} chars) trimmed to ${SUMMARY_LIMIT}`);
    return combined.substring(0, SUMMARY_LIMIT) + '\n\n[... additional sections summarized above ...]';
  }

  console.log(`[PPT] Chunked summary complete: ${combined.length} chars from ${fullText.length} chars original`);
  return combined;
}

// ─────────────────────────────────────────────────────────────
// Legacy single-pass reader (kept for non-PPT file extraction)
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

    const MAX_CHARS = 8000;
    if (content.length > MAX_CHARS) {
      const lines = content.split('\n');
      let smartContent = '';
      let charCount = 0;
      
      for (const line of lines) {
        const trimmed = line.trim();
        const isHeading = trimmed.length < 80 && trimmed.length > 3 && 
                          !trimmed.startsWith('•') && !trimmed.startsWith('-') &&
                          !/^\s*\d+\.\s/.test(trimmed) === false ||
                          /^[A-Z][A-Z\s]+$/.test(trimmed) ||
                          /^\d+\.\s/.test(trimmed);
        
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

    // ── Regular bot flow (100% unchanged) ──────────────────────
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
  // ✅ PATCHED v1.4.0:
  //   - Freeform layout detection (no /ppt prefix needed)
  //   - Chunked large document reading (100+ pages)
  //   - Freeform requests skip corporate template constraints
  // ─────────────────────────────────────────────────────────
  async _handlePptCommand({ userId, botId, bot, message, threadId, history = [], attachedFile }) {
    try {
      // ── Detect if this is a freeform designer-style request ─────────────────
      const freeformMode = isFreeformLayoutRequest(message || '');
      if (freeformMode) {
        console.log('[PPT] Freeform layout request detected — bypassing corporate template constraints');
      }

      // ── STEP 0: Load DB history ──────────────────────────────────────────────
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
      // ✅ v1.4.0: Freeform requests don't use corporate templates
      if (!freeformMode) {
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
      }

      const kbExtractedImages = KnowledgeBaseService.getExtractedImages(
        knowledgeFiles, message, freshBot?.knowledgeMode || 'relevant'
      );

      let knowledgeCtx = '';
      if (!freeformMode && knowledgeFiles.length > 0 && freshBot?.knowledgeMode !== 'disabled') {
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

          // ✅ v1.4.0: Use chunked reader for large docs
          uploadedDocContent = await deepReadDocumentChunked(
            physicalPath, originalName, attachedFile.mimetype,
            bot.aiProvider || { provider: 'openai', model: 'gpt-4o' }
          );

          const ext = path.extname(originalName).toLowerCase();
          if (['.docx', '.pptx', '.xlsx'].includes(ext)) {
            uploadedDocImages = await extractImagesFromUploadedFile(physicalPath, originalName);
          }
          console.log(`[PPT] Document content: ${uploadedDocContent.length} chars, ${uploadedDocImages.length} images`);
        }
      }

      // ── STEP 1.5: Build conversation context ────────────────────────────────
      let conversationContext = '';
      let draftContent        = '';

      if (mergedHistory.length > 0) {
        const meaningfulMessages = mergedHistory
          .filter(h => h.content && h.content.trim().length > 50)
          .slice(-20);

        if (meaningfulMessages.length > 0) {
          const draftKeywords = [
            'slide 1', 'slide 2', 'slide 3', 'slide ke',
            'bab 1', 'bab 2', 'section 1', 'outline', 'struktur', 'structure',
            'draf', 'draft', 'poin 1', 'poin 2', 'point 1', '1.', '2.', '3.',
            '- ', '* ', 'agenda', 'konten', 'isi slide', 'slide content',
          ];

          const draftMessages = meaningfulMessages.filter(h => {
            if (h.role !== 'user') return false;
            const lower = h.content.toLowerCase();
            return draftKeywords.some(kw => lower.includes(kw));
          });

          if (draftMessages.length > 0) {
            const primaryDraft = draftMessages.sort((a, b) => b.content.length - a.content.length)[0];
            draftContent = primaryDraft.content;
          }

          const historyForContext = meaningfulMessages.slice(-10);
          const rawContext = historyForContext
            .map(h => `[${h.role === 'assistant' ? 'BOT' : 'USER'}]: ${h.content.substring(0, 300)}`)
            .join('\n\n---\n\n');
          
          conversationContext = rawContext.substring(0, 3000);
        }
      }

      const rawExtractedImages = [...uploadedDocImages, ...kbExtractedImages];

      // ── STEP 2: Build content generation prompt ──────────────────────────────
      const userRequest = message || '';
      let contentUserMsg = '';

      // ✅ v1.4.0: FREEFORM MODE — pass the request directly with minimal wrapping
      if (freeformMode) {
        contentUserMsg = `=== FREEFORM LAYOUT REQUEST ===
The user has provided a detailed layout specification. Follow it EXACTLY.
Map their described zones/panels/steps to the appropriate layout types.
Do NOT add extra slides, corporate branding, or alter their structure.

USER SPECIFICATION:
${userRequest}

IMPORTANT: If the spec describes a single slide, produce just ONE slide.
If it describes a status dashboard with panels + timeline, use STATUS_SLIDE.
Preserve all user-provided text verbatim. Match their language exactly.`;

      } else {
        // ── Normal mode ───────────────────────────────────────────────────────
        if (uploadedDocContent) {
          contentUserMsg += `=== DOKUMEN YANG DI-UPLOAD: "${uploadedDocName}" ===\n`;
          contentUserMsg += uploadedDocContent + '\n\n';
          
          if (rawExtractedImages.length > 0) {
            const largeImgs = rawExtractedImages.filter(i => i.isLarge).length;
            const medImgs   = rawExtractedImages.filter(i => i.isMedium && !i.isLarge).length;
            contentUserMsg += `GAMBAR TERSEDIA: ${rawExtractedImages.length} total (${largeImgs} besar/diagram, ${medImgs} sedang/screenshot)\n`;
            contentUserMsg += `INSTRUKSI GAMBAR: Untuk slide yang menjelaskan arsitektur/diagram/konfigurasi, tandai [NEEDS_IMAGE: architecture/diagram/screenshot]\n\n`;
          }
        }

        if (draftContent && !uploadedDocContent) {
          contentUserMsg += `=== DRAFT / STRUKTUR DARI CONVERSATION ===\n${draftContent}\n\n`;
        }

        if (conversationContext && !uploadedDocContent) {
          contentUserMsg += `=== RIWAYAT PERCAKAPAN ===\n${conversationContext}\n\n`;
        }

        if (knowledgeCtx) {
          contentUserMsg += `=== KNOWLEDGE BASE ===\n${knowledgeCtx.substring(0, 2000)}\n\n`;
        }

        contentUserMsg += `=== PERMINTAAN USER ===\n${userRequest}\n\n`;
        contentUserMsg += `INSTRUKSI: Buat presentasi berkualitas tinggi dari dokumen di atas. `;
        contentUserMsg += `Gunakan layout yang tepat per slide. Untuk slide yang butuh gambar, `;
        contentUserMsg += `tambahkan [NEEDS_IMAGE: architecture/diagram/screenshot] di akhir konten slide tersebut.\n`;
      }

      // Hard cap on total prompt
      const MAX_PROMPT_CHARS = 14000; // ✅ v1.4.0: increased from 12000 since chunked summaries are dense
      if (contentUserMsg.length > MAX_PROMPT_CHARS) {
        console.warn(`[PPT] contentUserMsg too large (${contentUserMsg.length} chars), trimming to ${MAX_PROMPT_CHARS}`);
        contentUserMsg = contentUserMsg.substring(0, MAX_PROMPT_CHARS) + '\n\n[... content trimmed for efficiency ...]\n';
      }

      // ── STEP 3: Content Generation ──────────────────────────────────────────
      console.log(`[PPT] Step 1 — generating content (freeform: ${freeformMode})...`);

      // ✅ v1.4.0: Freeform mode gets a higher token budget for detailed single slides
      const contentMaxTokens = freeformMode ? 2000 : 3500;

      const contentResult = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt:   PPT_CONTENT_SYSTEM_PROMPT,
        messages:       [],
        userContent:    contentUserMsg,
        timeout:        120000,
        maxTokens:      contentMaxTokens,
      });

      const slideContent = contentResult.text;
      if (!slideContent?.trim()) throw new Error('AI returned empty slide content');

      const titleMatch = slideContent.match(/^#\s+(.+)/m);
      const title = titleMatch ? titleMatch[1].trim().substring(0, 60)
        : freeformMode ? 'Status Dashboard' : 'GYS Executive Deck';

      const contentUsage = normalizeUsage(contentResult.usage, bot.aiProvider?.provider || 'openai', bot.aiProvider?.model || '');
      console.log(`[PPT] Content ready — Title: "${title}" | ${slideContent.length} chars`);

      // ── STEP 4: JSON Conversion ──────────────────────────────────────────────
      console.log('[PPT] Step 2 — converting to JSON...');

      const slideContentForJson = slideContent.length > 8000
        ? slideContent.substring(0, 8000) + '\n\n[... trimmed ...]'
        : slideContent;

      const jsonResult = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt:   PPT_JSON_SYSTEM_PROMPT,
        messages:       [],
        userContent:    `Convert this presentation to JSON:\n\n${slideContentForJson}`,
        timeout:        120000,
        maxTokens:      4000,
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
      let finalExtractedImages = [];

      if (rawExtractedImages.length > 0 && !freeformMode) {
        console.log(`[PPT] Step 2.5 — assigning images (${rawExtractedImages.length} available)...`);
        
        try {
          const { selectRelevantImages } = await import('./smart-image-selector.service.js');
          finalExtractedImages = await selectRelevantImages(
            rawExtractedImages, userRequest, slideContent, bot.aiProvider, 6
          );
        } catch (selErr) {
          const validImages = rawExtractedImages.filter(img => img.isLarge || img.isMedium);
          finalExtractedImages = validImages.slice(0, 8);
        }

        pptData.slides = smartAssignImagesToSlides(pptData.slides, finalExtractedImages);
        const assignedCount = pptData.slides.filter(s => s.imagePath).length;
        console.log(`[PPT] Image assignment: ${assignedCount} slides with images`);
      }

      // ── STEP 5: Render PPTX ─────────────────────────────────────────────────
      const outputDir = path.join(process.cwd(), 'data', 'files');
      const result = await PptxService.generate({
        pptData,
        slideContent,
        title,
        outputDir,
        styleDesc:       templatePath ? 'Custom Template' : freeformMode ? 'Freeform Design' : 'GYS Gamma Style',
        templatePath,
        extractedImages: finalExtractedImages,
      });

      // ── STEP 6: Build Response ───────────────────────────────────────────────
      const reqLower  = userRequest.toLowerCase();
      const engWords  = reqLower.match(/\b(create|make|generate|presentation|deck|please)\b/g) || [];
      const indWords  = reqLower.match(/\b(buat|buatkan|bikin|tolong|presentasi)\b/g) || [];
      const isEnglish = engWords.length > indWords.length || freeformMode;

      const layoutIcons = {
        TITLE: '🏷️', CONTENT: '📝', GRID: '🧩', GRID_3X3: '🔲', STATS: '📊',
        TIMELINE: '🗓️', TWO_COLUMN: '↔️', CHART: '📈',
        TABLE: '📋', QUOTE: '💬', SECTION: '📌', CLOSING: '🎯',
        IMAGE_SLIDE: '🖼️', STATUS_SLIDE: '🔄',
      };

      const layoutSummary = pptData.slides
        .map((s, i) => {
          const ic     = layoutIcons[(s.layout || 'CONTENT').toUpperCase()] || '📄';
          const hasImg = s.imagePath ? ' 🖼️' : '';
          return `${ic} **Slide ${i + 1}:** ${s.title || '—'} _(${s.layout || 'CONTENT'})_${hasImg}`;
        })
        .join('\n');

      const templateNote = result.usedTemplate ? '\n🎨 **Template:** Custom template applied' : '';
      const freeformNote = freeformMode ? '\n✏️ **Mode:** Freeform layout (your design spec)' : '';

      const assignedSlides = pptData.slides.filter(s => s.imagePath).length;
      let imageNote = '';
      if (rawExtractedImages.length > 0) {
        imageNote = `\n🖼️ **Images:** ${assignedSlides} slides include images from ${rawExtractedImages.length} extracted`;
      }

      const docNote = uploadedDocName
        ? `\n📄 **Source:** "${uploadedDocName}"`
        : (conversationContext ? `\n💬 **Source:** From conversation context` : '');

      const jsonUsage   = normalizeUsage(jsonResult.usage, bot.aiProvider?.provider || 'openai', bot.aiProvider?.model || '');
      const totalTokens = (contentUsage?.total_tokens || 0) + (jsonUsage?.total_tokens || 0);
      const tokenNote   = totalTokens > 0 ? `\n📊 **Tokens:** ${totalTokens.toLocaleString()}` : '';

      const responseMarkdown = isEnglish
        ? `✅ **Presentation successfully generated!**

📊 **Title:** ${title}
📑 **Total Slides:** ${result.slideCount} slides${templateNote}${freeformNote}${imageNote}${docNote}${tokenNote}

---
### [⬇️ Download Presentation (.pptx)](${result.pptxUrl})

**Slide layouts:**
${layoutSummary}`
        : `✅ **Presentasi berhasil dibuat!**

📊 **Judul:** ${title}
📑 **Jumlah Slide:** ${result.slideCount} slides${templateNote}${freeformNote}${imageNote}${docNote}${tokenNote}

---
### [⬇️ Download Presentasi (.pptx)](${result.pptxUrl})

**Layout per slide:**
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