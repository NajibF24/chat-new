// server/services/ai-core.service.js
// ✅ PATCH v1.5.0 — Adds:
//   1. IMAGE GENERATION: DALL-E 3 support via isImageGenerationRequest() detector
//      + _handleImageGenerationCommand() handler. Auto-detects size/quality/style from prompt.
//   2. FLEXIBLE PPT PROMPT: Detects freeform layout requests (no /ppt prefix needed)
//   3. CHUNKED LARGE DOC READING: Documents up to 100+ pages handled via chunked summarization
//   4. DYNAMIC TOKEN BUDGET: slide count detector + calcTokenBudget() for large decks
//   5. GRID_3X3 LAYOUT: 9-item 3×3 category grid for classification slides

import pdf      from 'pdf-parse';
import mammoth  from 'mammoth';
import ExcelJS  from 'exceljs';
import fs       from 'fs';
import path     from 'path';
import axios    from 'axios';

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
- If user specifies a number of slides (e.g. "12-slide", "10 slides"), produce EXACTLY that count — not fewer, not more.
  ⚠️ This is the most important rule. Never stop early due to length. Complete ALL slides.
  ⚠️ If the user says "12-slide presentation", you MUST write all 12 slide sections, even if content is brief.
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
// ✅ v1.5.0 — SLIDE COUNT DETECTOR
// Reads how many slides the user explicitly requested.
// Returns the number if found (min 1), or null if not specified.
// ─────────────────────────────────────────────────────────────
function detectRequestedSlideCount(message = '') {
  const t = message || '';

  // Patterns like "12-slide", "12 slide", "12 slides", "12 buah slide"
  const patterns = [
    /\b(\d+)[- ]?slide[s]?\b/i,
    /\b(\d+)[- ]?buah[- ]?slide\b/i,
    /\bslide[s]?\s+sebanyak\s+(\d+)\b/i,
    /\bsebanyak\s+(\d+)\s+slide\b/i,
    /\b(\d+)[- ]?halaman\s+(presentasi|slide)\b/i,
    /\bpresentation\s+(?:deck\s+)?(?:of\s+)?(\d+)\s+slide[s]?\b/i,
    /\b(\d+)\s+(?:total\s+)?slide[s]?\s+(?:deck|presentation)\b/i,
    /\bcomprehensive\s+(\d+)[- ]?slide\b/i,
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      const n = parseInt(m[1] || m[2], 10);
      if (!isNaN(n) && n >= 1 && n <= 50) return n;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// ✅ v1.5.0 — TOKEN BUDGET CALCULATOR
// Given requested slide count, returns appropriate maxTokens
// so that all slides can be generated without truncation.
// Rule of thumb: ~250 tokens per slide for content generation,
//                ~350 tokens per slide for JSON conversion.
// ─────────────────────────────────────────────────────────────
function calcTokenBudget(requestedSlides) {
  if (!requestedSlides) return { contentTokens: 4000, jsonTokens: 5000 };
  const contentTokens = Math.min(Math.max(requestedSlides * 350, 4000), 8000);
  const jsonTokens    = Math.min(Math.max(requestedSlides * 450, 5000), 10000);
  return { contentTokens, jsonTokens };
}

// ─────────────────────────────────────────────────────────────
// PPT COMMAND DETECTOR
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
    isFreeformLayoutRequest(message)
  );
}

// ─────────────────────────────────────────────────────────────
// ✅ NEW: IMAGE GENERATION DETECTOR
// Detects when user is requesting an image to be created/generated.
// Returns true if message is clearly an image generation request.
// ─────────────────────────────────────────────────────────────
function isImageGenerationRequest(message = '') {
  const t = (message || '').trim();

  // Must NOT be a PPT command — PPT takes priority
  if (isPptCommand(t)) return false;

  const triggers = [
    // English
    /^create\s+(a\s+|an\s+)?(image|photo|picture|illustration|drawing|artwork|render|visual|painting)/i,
    /^generate\s+(a\s+|an\s+)?(image|photo|picture|illustration|artwork|render|visual)/i,
    /^make\s+(a\s+|an\s+)?(image|photo|picture|illustration|artwork|render|visual)/i,
    /^draw\s+(a\s+|an\s+|me\s+)?/i,
    /^(design|render|illustrate|paint|sketch)\s+(a\s+|an\s+)?/i,
    /\b(generate|create|make|draw|produce)\s+(a\s+)?(realistic|detailed|cinematic|4k|high.?res|ultra|professional|photorealistic)\s+(image|photo|picture|render|illustration)/i,
    /\b(image|photo|picture|illustration)\s+of\b/i,
    /\bvisual(ize|ization)?\s+(of|for|showing)\b/i,

    // Indonesian
    /^(buatkan?|buat|generate|create)\s+(gambar|foto|ilustrasi|desain|visual|render)/i,
    /^(gambarkan|lukiskan|desainkan)\s+/i,
    /\b(buat|buatkan|generate|create)\s+(gambar|foto|ilustrasi)\b/i,
  ];

  return triggers.some(r => r.test(t));
}

// ─────────────────────────────────────────────────────────────
// ✅ NEW: PARSE IMAGE OPTIONS from prompt
// Extracts size/quality/style hints from the user message.
// ─────────────────────────────────────────────────────────────
function parseImageOptions(message = '') {
  const t = message.toLowerCase();

  // Size: portrait vs landscape vs square
  let size = '1792x1024'; // default landscape
  if (/\b(portrait|vertical|tall|1024.?x.?1792)\b/.test(t))  size = '1024x1792';
  if (/\b(square|1:1|1024.?x.?1024)\b/.test(t))              size = '1024x1024';

  // Quality: hd if user mentions detail/realistic/4k/8k
  let quality = 'standard';
  if (/\b(hd|4k|8k|high.?res|ultra|detailed|realistic|cinematic|professional|photorealistic)\b/.test(t)) {
    quality = 'hd';
  }

  // Style: natural if user says soft/calm/natural/watercolor
  let style = 'vivid';
  if (/\b(natural|soft|calm|watercolor|pastel|gentle|realistic.?photo)\b/.test(t)) {
    style = 'natural';
  }

  return { size, quality, style };
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
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const sheetTexts = [];
      workbook.eachSheet(sheet => {
        const rows = [];
        sheet.eachRow(row => {
          rows.push(row.values.slice(1).map(v => (v == null ? '' : String(v))).join(','));
        });
        sheetTexts.push(`=== Sheet: ${sheet.name} ===\n${rows.join('\n')}`);
      });
      fullText = sheetTexts.join('\n\n');

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
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const parts = [];
      workbook.eachSheet(sheet => {
        const rows = [];
        sheet.eachRow(row => {
          rows.push(row.values.slice(1).map(v => (v == null ? '' : String(v))).join(','));
        });
        parts.push(`=== Sheet: ${sheet.name} ===\n${rows.join('\n')}`);
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

    // ✅ PATCH v1.5.1 — Broader keyword list + natural-language pattern detection.
    // ANY question that could refer to sheet data must return true.
    const keywords = [
      // Action words
      'berikan','cari','list','daftar','semua','all','tampilkan','lihat',
      'show','get','find','temukan','search','tell','give','display','fetch',
      'check','view','see','ada','apa','mana','siapa','berapa',
      // Entity words
      'project','projects','proyek','dokumen','document','file','tracking','sheet','smartsheet',
      // Status / health
      'status','progress','summary','overview','dashboard','analisa','health',
      'overdue','delay','terlambat','active','aktif','complete','selesai',
      'done','finish','canceled','batal','laporan','report','red','merah',
      'kritis','critical','at risk','on track',
      // Data / metrics
      'data','total','latest','terbaru','recent','update','statistik','stats',
      'count','jumlah','number','banyak',
      // Time-based
      'today','hari ini','this week','minggu ini','this month','bulan ini',
      'next month','bulan depan','upcoming','segera','schedule','jadwal',
      'deadline','due','jatuh tempo','history','riwayat',
      // Activity / tracking
      'modified','upload','added','deleted','edit','activity','who',
      // Budget / cost
      'budget','biaya','cost','anggaran','afe','expenditure','spend',
      // People / org
      'pm','manager','department','dept','division','vendor','pic','team','tim',
      // Grouping
      'group','grupkan','kelompok','breakdown','ranking','rank',
      // Question words (EN + ID) — any question is potentially a data query
      'what','which','when','where','how many','how much',
      'apa','mana','kapan','dimana','bagaimana','gimana',
    ];

    if (keywords.some(k => lowerMsg.includes(k))) return true;

    // Special chars that indicate a structured query or project name
    if (message.includes('_') || message.includes('.') || message.includes('-')) return true;

    // Short messages (1-3 words) are likely direct project lookups or quick commands
    const wordCount = lowerMsg.trim().split(/\s+/).length;
    if (lowerMsg.trim().length >= 2 && wordCount <= 3) return true;

    return false;
  }

  async extractFileContent(attachedFile) {
    let physicalPath = attachedFile.serverPath || attachedFile.path;
    // Resolve relative paths (multer returns relative paths like "data/files/...")
    if (physicalPath && !path.isAbsolute(physicalPath)) {
      physicalPath = path.join(process.cwd(), physicalPath);
    }
    if (!physicalPath || !fs.existsSync(physicalPath)) return '';
    const originalName = attachedFile.originalname || '';
    const ext = path.extname(originalName).toLowerCase();
    try {
      if (ext === '.pdf') {
        const data = await pdf(fs.readFileSync(physicalPath));
        return `\n\n[ISI FILE: ${originalName}]\n${data.text.substring(0, 8000)}\n[END FILE]\n`;
      } else if (ext === '.docx' || ext === '.doc') {
        const result = await mammoth.extractRawText({ path: physicalPath });
        return `\n\n[ISI FILE: ${originalName}]\n${result.value.substring(0, 8000)}\n[END FILE]\n`;
      } else if (ext === '.xlsx' || ext === '.xls') {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(physicalPath);
        const parts = [];
        workbook.eachSheet(sheet => {
          const rows = [];
          sheet.eachRow(row => {
            rows.push(row.values.slice(1).map(v => (v == null ? '' : String(v))).join(','));
          });
          parts.push(rows.join('\n'));
        });
        const content = parts.join('\n');
        return `\n\n[ISI FILE: ${originalName}]\n${content.substring(0, 8000)}\n[END FILE]\n`;
      } else if (ext === '.pptx' || ext === '.ppt') {
        // ✅ FIX: Extract text from PPTX slides using JSZip (same as deepReadDocument)
        // Previously fell through to utf8 read which returned corrupted binary content.
        try {
          const JSZip = (await import('jszip')).default;
          const data  = fs.readFileSync(physicalPath);
          const zip   = await JSZip.loadAsync(data);
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
          const content = slideTexts.join('\n\n');
          if (!content) return '';
          return `\n\n[ISI FILE: ${originalName}]\n${content.substring(0, 8000)}\n[END FILE]\n`;
        } catch (e) {
          console.warn(`[AICoreService] PPTX extraction failed for "${originalName}":`, e.message);
          return '';
        }
      } else if (['.txt', '.md', '.csv'].includes(ext)) {
        return `\n\n[ISI FILE: ${originalName}]\n${fs.readFileSync(physicalPath, 'utf8').substring(0, 8000)}\n[END FILE]\n`;
      } else {
        // Unknown binary format — skip rather than returning garbage
        return '';
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

    // ── ✅ NEW: Image Generation Handler ───────────────────────
    // Skip if user attached a file — they want to analyze it, not generate a new image
    if (isImageGenerationRequest(message) && !attachedFile) {
      return this._handleImageGenerationCommand({ userId, botId, bot, message, threadId });
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
        const apiKey = bot.smartsheetConfig.apiKey || process.env.SMARTSHEET_API_KEY;

        // ✅ Build the full list of sheet IDs to query:
        //    1. New multi-sheet array (sheetIds)
        //    2. Legacy single sheetId / primarySheetId fields
        //    3. Environment variable fallback — ONLY when bot has no sheet IDs configured
        const botSheetIds = [
          ...(bot.smartsheetConfig.sheetIds || []),
          bot.smartsheetConfig.sheetId        || '',
          bot.smartsheetConfig.primarySheetId || '',
        ].map(id => String(id || '').trim()).filter(Boolean);

        // Only fall back to env var if the bot has no sheet IDs configured at all.
        // This prevents the env var sheet from being appended to a bot that already
        // has its own sheet(s) configured, which would cause unintended multi-sheet queries.
        const sheetIdsFromConfig = botSheetIds.length > 0
          ? botSheetIds
          : [process.env.SMARTSHEET_PRIMARY_SHEET_ID || ''].filter(Boolean);

        // Deduplicate
        const uniqueSheetIds = [...new Set(sheetIdsFromConfig)];

        if (apiKey && uniqueSheetIds.length > 0) {
          const smartsheet = new SmartsheetLiveService(apiKey);

          if (uniqueSheetIds.length === 1) {
            // Single sheet — original fast path
            const sheet    = await smartsheet.fetchSheet(uniqueSheetIds[0]);
            const flatRows = smartsheet.processToFlatRows(sheet);
            if (flatRows.length > 0) {
              contextData += `\n\n${smartsheet.buildAIContext(flatRows, message, sheet.name)}\n`;
            }
          } else {
            // ✅ Multi-sheet — fetch all and search across all sheets
            console.log(`📊 [AICoreService] Multi-sheet Smartsheet query: ${uniqueSheetIds.length} sheets`);
            const multiContext = await smartsheet.buildMultiSheetContext(uniqueSheetIds, message);
            if (multiContext) {
              contextData += `\n\n${multiContext}\n`;
            }
          }
        } else if (!apiKey) {
          console.warn('[AICoreService] Smartsheet enabled but no API key configured');
        } else {
          console.warn('[AICoreService] Smartsheet enabled but no sheet IDs configured');
        }
      } catch (e) {
        console.error('Smartsheet Error:', e.message);
        contextData += `\n\n=== SMARTSHEET ERROR ===\n❌ Failed to load data: ${e.message}\nPlease inform the user in their language that Smartsheet data is temporarily unavailable.\n`;
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
      const provider  = bot.aiProvider?.provider || 'openai';
      const isImage   = attachedFile.mimetype?.startsWith('image/');
      const isPdf     = attachedFile.mimetype === 'application/pdf' ||
                        (attachedFile.originalname || '').toLowerCase().endsWith('.pdf');

      // ── Vision-capable providers: OpenAI, Anthropic, Google, Custom (Azure OpenAI) ──
      const visionProviders = new Set(['openai', 'anthropic', 'google', 'custom']);
      const supportsVision  = visionProviders.has(provider);

      if (isImage && supportsVision) {
        // Send image directly to vision model
        // attachedFile.path is the disk path returned by multer (e.g. "data/files/123---img.png")
        // Resolve to absolute path in case it's relative
        let filePath = attachedFile.serverPath || attachedFile.path;
        if (filePath && !path.isAbsolute(filePath)) {
          filePath = path.join(process.cwd(), filePath);
        }
        console.log(`[AICoreService] Reading image from: ${filePath}`);
        if (!filePath || !fs.existsSync(filePath)) {
          console.warn(`[AICoreService] Image file not found: ${filePath}`);
          userContent.push({ type: 'text', text: `[User attached an image: ${attachedFile.originalname}, but the file could not be read from disk]` });
        } else {
          const imgBuffer = fs.readFileSync(filePath);
          const b64       = imgBuffer.toString('base64');
          const mime      = attachedFile.mimetype;

          if (provider === 'anthropic') {
            // Anthropic uses a different image format
            userContent.push({
              type:   'image',
              source: { type: 'base64', media_type: mime, data: b64 },
            });
          } else {
            // OpenAI, Google (Gemini), and Custom (Azure OpenAI) use image_url with data URI
            userContent.push({
              type:      'image_url',
              image_url: { url: `data:${mime};base64,${b64}` },
            });
          }
          console.log(`[AICoreService] Image attached (${provider}): ${attachedFile.originalname}`);
        }

      } else if (isPdf && supportsVision) {
        // Try text extraction first; fall back to vision if text is empty (scanned PDF)
        const text = await this.extractFileContent(attachedFile);
        if (text && text.trim().length > 50) {
          userContent.push({ type: 'text', text });
        } else {
          // Scanned/image-based PDF — inform the user we can't read it via vision
          userContent.push({
            type: 'text',
            text: `\n\n[FILE: ${attachedFile.originalname}]\nThis PDF appears to be image-based (scanned). Text extraction returned no content. Please describe what you need from this document.\n[END FILE]\n`,
          });
        }
      } else {
        // All other file types: extract text content
        const text = await this.extractFileContent(attachedFile);
        if (text) userContent.push({ type: 'text', text });
      }
    }

    // ── Ensure a vision-capable model is used when an image is attached ──
    const hasImageAttachment = userContent.some(c => c?.type === 'image' || c?.type === 'image_url');
    // ✅ FIX: Do NOT fall back to { provider: 'openai' } — use whatever the bot actually has.
    // Falling back to 'openai' when the bot uses 'custom' (Azure) or another provider
    // causes a "API Key not found for openai" error even though the bot has a valid key.
    const providerConfig = { ...(bot.aiProvider || {}) };
    if (!providerConfig.provider) {
      // Only set openai as default if bot truly has no provider configured at all
      providerConfig.provider = 'openai';
      providerConfig.model    = providerConfig.model || 'gpt-4o-mini';
    }
    if (hasImageAttachment) {
      const p = providerConfig.provider || 'openai';
      const m = (providerConfig.model || '').toLowerCase();
      const isOpenAIVision    = /gpt-4o|gpt-4-vision|gpt-4-turbo-vision|gpt-4\.1|gpt-5/.test(m);
      const isAnthropicVision = /claude-3|sonnet|haiku|opus/.test(m);
      const isGoogleVision    = /gemini|1\.5|vision/.test(m);
      // For custom (Azure OpenAI): trust the configured model — Azure vision models
      // are deployment-specific and the admin sets the correct model name.
      if (p === 'openai' && !isOpenAIVision) providerConfig.model = 'gpt-4o-mini';
      if (p === 'anthropic' && !isAnthropicVision) providerConfig.model = 'claude-3-haiku-20240307';
      if (p === 'google' && !isGoogleVision) providerConfig.model = 'gemini-1.5-flash';
      // 'custom' provider: keep the configured model as-is (admin knows their deployment)
    }

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // ✅ FIX: Bedakan instruksi untuk Smartsheet vs non-Smartsheet
    // Untuk Smartsheet: tambahkan larangan eksplisit agar AI tidak menambah data dari memori/training.
    const hasSmartsheetData = contextData.includes('DATA SMARTSHEET') ||
      contextData.includes('STATUS SUMMARY') ||
      contextData.includes('BUDGET') ||
      contextData.includes('OVERDUE PROJECTS') ||
      contextData.includes('ALL PROJECTS') ||
      contextData.includes('PROJECT DETAIL') ||
      contextData.includes('ACTIVITY SUMMARY') ||
      contextData.includes('DOCUMENTATION');
    const groundingInstruction = hasSmartsheetData
      ? [
          'CRITICAL DATA INTEGRITY RULES:',
          '1. Use ONLY the data provided above from Smartsheet API. Do NOT add, infer, or complete any field values from your training data or memory.',
          '2. If a field (e.g. Issues, Remarks) appears incomplete or ends mid-sentence in the data above, copy it EXACTLY as-is. Do NOT continue or complete the sentence.',
          '3. Never fabricate project names, dates, progress percentages, issue descriptions, or any other values.',
          '4. If data for a specific project is not in the context above, say so — do not guess.',
        ].join('\n')
      : contextData
        ? 'Use the data and knowledge provided above to answer the user accurately. Do not hallucinate facts.'
        : '';

    // ✅ PATCH v1.5.1 — Language enforcement & data confirmation
    // Detect user language from their message
    const userMsg = (message || '').trim();
    const isEnglishMsg = /^[a-zA-Z0-9\s\p{P}]+$/u.test(userMsg) &&
      !/[\u00C0-\u024F\u0080-\u009F]/.test(userMsg) &&
      /\b(show|list|get|find|what|which|how|give|tell|display|check|all|my|the|are|is|do|can|have|project|projects|status|report|overview|summary|active|overdue|budget|issue|vendor|department)\b/i.test(userMsg);

    const langRule = isEnglishMsg
      ? `[LANGUAGE: The user is writing in ENGLISH. You MUST respond entirely in English. Do NOT use Indonesian, Malay, or any other language. Every word of your response must be English — including table headers, notes, summaries, and error messages.]`
      : `[BAHASA: Deteksi bahasa pesan terakhir user dan balas dengan bahasa yang SAMA PERSIS. Jika user nulis Bahasa Indonesia → balas Indonesia. Jika English → balas English. JANGAN campur bahasa.]`;

    // ✅ Data confirmation block — injected when Smartsheet data is present
    // Prevents AI from falsely claiming "data tidak tersedia" when data IS provided
    const dataConfirmation = contextData
      ? `[DATA CONFIRMATION: Smartsheet data has been successfully fetched and is provided above. The data IS available. You MUST use this data to answer the user's question. Do NOT say "data tidak tersedia" or "data is not available" — that would be incorrect. The data is present in this prompt.]`
      : ``;

    const systemPrompt = [
      // Language rule FIRST — before bot's own system prompt so it cannot be overridden
      langRule,
      bot.prompt || bot.systemPrompt || '',
      `[TODAY: ${today}]`,
      contextData,
      dataConfirmation,
      groundingInstruction,
    ].filter(Boolean).join('\n\n');

    // ✅ FIX: Broader Smartsheet detection — covers all context section headers,
    // not just 'DATA SMARTSHEET' which won't appear for budget/group/doc queries.
    const isSmartsheetQuery = bot.smartsheetConfig?.enabled && (
      contextData.includes('DATA SMARTSHEET') ||
      contextData.includes('BUDGET') ||
      contextData.includes('PROYEK') ||
      contextData.includes('PROJECT') ||
      contextData.includes('DOKUMEN') ||
      contextData.includes('DOCUMENTATION')
    );
    const messagesForAI = isSmartsheetQuery ? [] : history.slice(-6);

    const result = await AIProviderService.generateCompletion({
      providerConfig,
      systemPrompt,
      messages:        messagesForAI,
      userContent:     userContent.length === 1 && userContent[0].type === 'text'
        ? userContent[0].text
        : userContent,
      // ✅ FIX: Pass bot capabilities so web search / code interpreter tools are actually enabled.
      // Previously buildTools() was never given capabilities, so tools were never sent to OpenAI.
      capabilities:    bot.capabilities || {},
    });

    // ✅ FIX: Strip HTML tags from AI response for Smartsheet bots.
    // Some AI models (especially when given HTML-rich context) output <br>, <b>, etc.
    // in their responses. We strip these to plain text before saving/returning.
    // Only applied when Smartsheet is enabled to avoid breaking other bots
    // that may legitimately return HTML (e.g. code generation bots).
    let aiResponse = result.text;
    if (bot.smartsheetConfig?.enabled && aiResponse) {
      aiResponse = aiResponse
        // <br> variants → newline
        .replace(/<br\s*\/?>/gi, '\n')
        // </p> → newline, <p> → nothing
        .replace(/<\/p>/gi, '\n')
        .replace(/<p[^>]*>/gi, '')
        // <li> → bullet
        .replace(/<li[^>]*>/gi, '\n• ')
        .replace(/<\/li>/gi, '')
        // list containers
        .replace(/<\/?[uo]l[^>]*>/gi, '')
        // inline formatting — strip tags, keep text
        .replace(/<\/?(b|strong|i|em|u|s|span|div|h[1-6])[^>]*>/gi, '')
        // any remaining tags
        .replace(/<[^>]+>/g, '')
        // HTML entities
        .replace(/&amp;/gi,  '&')
        .replace(/&lt;/gi,   '<')
        .replace(/&gt;/gi,   '>')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi,  "'")
        // collapse 3+ consecutive newlines → 2
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    // ✅ Extract token usage from AI response
    const usage = normalizeUsage(result.usage, bot.aiProvider?.provider || 'openai', bot.aiProvider?.model || '');
    const tokenUsage = {
      promptTokens:     usage?.prompt_tokens     || 0,
      completionTokens: usage?.completion_tokens || 0,
      totalTokens:      usage?.total_tokens      || 0,
      provider:         bot.aiProvider?.provider || 'openai',
      model:            bot.aiProvider?.model    || '',
    };

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
    await new Chat({ userId, botId, threadId, role: 'assistant', content: aiResponse, tokenUsage }).save();
    await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });

    // ✅ Log token usage to AuditLog for monitoring
    if (tokenUsage.totalTokens > 0) {
      try {
        const AuditService = (await import('./audit.service.js')).default;
        await AuditService.log({
          userId,
          username: undefined, // will be resolved from session if req available
          category: 'chat',
          action:   'AI_RESPONSE',
          targetId:   String(botId),
          targetName: bot.name,
          detail: {
            tokenUsage,
            messageLength: (message || '').length,
            responseLength: aiResponse.length,
          },
        });
      } catch (auditErr) {
        console.warn('[AICoreService] Token audit log failed:', auditErr.message);
      }
    }

    return { response: aiResponse, threadId, attachedFiles: savedAttachments };
  }

  // ─────────────────────────────────────────────────────────
  // ✅ NEW v1.5.0: IMAGE GENERATION COMMAND HANDLER
  //
  // Flow:
  //   1. Parse size/quality/style hints from prompt
  //   2. Call DALL-E 3 via AIProviderService.generateImage()
  //   3. Download + save to /data/files/ (DALL-E URLs expire in 1 hour)
  //   4. Return markdown with embedded preview + download link
  // ─────────────────────────────────────────────────────────
  async _handleImageGenerationCommand({ userId, botId, bot, message, threadId }) {
    try {
      console.log(`[ImageGen] Request: "${message.substring(0, 80)}..."`);

      const provider = bot.aiProvider?.provider || 'openai';
      if (provider !== 'openai') {
        const errMsg = `⚠️ **Image generation tidak tersedia untuk provider "${provider}".**\n\nFitur ini membutuhkan OpenAI (DALL-E 3). Hubungi admin untuk mengaktifkan provider OpenAI.`;
        await new Chat({ userId, botId, threadId, role: 'user',      content: message }).save();
        await new Chat({ userId, botId, threadId, role: 'assistant', content: errMsg  }).save();
        await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });
        return { response: errMsg, threadId };
      }

      const options = parseImageOptions(message);
      console.log(`[ImageGen] Options: size=${options.size} quality=${options.quality} style=${options.style}`);

      const { imageUrl, revisedPrompt } = await AIProviderService.generateImage(
        bot.aiProvider, message, options
      );

      // Save locally — DALL-E URLs expire after 1 hour
      const outputDir = path.join(process.cwd(), 'data', 'files');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const filename  = `GYS-image-${Date.now()}.png`;
      const filepath  = path.join(outputDir, filename);
      const publicUrl = `/api/files/${filename}`;
      let   savedUrl  = imageUrl; // fallback to direct URL if download fails

      try {
        const imgResp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
        fs.writeFileSync(filepath, Buffer.from(imgResp.data));
        savedUrl = publicUrl;
        console.log(`[ImageGen] Saved: ${filename} (${Math.round(imgResp.data.byteLength / 1024)} KB)`);
      } catch (dlErr) {
        console.warn('[ImageGen] Could not save locally, using direct URL:', dlErr.message);
      }

      const isIndo    = /\b(buat|buatkan|gambar|ilustrasi|desain|lukis)\b/i.test(message);
      const sizeLabel = options.size === '1792x1024' ? 'Landscape (1792×1024)'
        : options.size === '1024x1792' ? 'Portrait (1024×1792)'
        : 'Square (1024×1024)';
      const promptNote = revisedPrompt && revisedPrompt !== message
        ? `\n\n> 💡 **${isIndo ? 'Prompt direvisi oleh DALL-E' : 'Prompt revised by DALL-E'}:**\n> _${revisedPrompt.substring(0, 220)}${revisedPrompt.length > 220 ? '...' : ''}_`
        : '';

      const responseMarkdown = isIndo
        ? `✅ **Gambar berhasil dibuat!**

🎨 **Model:** DALL-E 3  |  📐 **Ukuran:** ${sizeLabel}  |  ✨ **Kualitas:** ${options.quality.toUpperCase()}  |  🖌️ **Gaya:** ${options.style}

![Generated Image](${savedUrl})

---
### [⬇️ Download Gambar](${savedUrl})${promptNote}`
        : `✅ **Image successfully generated!**

🎨 **Model:** DALL-E 3  |  📐 **Size:** ${sizeLabel}  |  ✨ **Quality:** ${options.quality.toUpperCase()}  |  🖌️ **Style:** ${options.style}

![Generated Image](${savedUrl})

---
### [⬇️ Download Image](${savedUrl})${promptNote}`;

      const fileAttachment = savedUrl === publicUrl
        ? [{ name: filename, path: savedUrl, type: 'image', size: '0' }]
        : [];

      await new Chat({ userId, botId, threadId, role: 'user',      content: message }).save();
      await new Chat({ userId, botId, threadId, role: 'assistant', content: responseMarkdown, attachedFiles: fileAttachment }).save();
      await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });

      return { response: responseMarkdown, threadId, attachedFiles: fileAttachment };

    } catch (error) {
      console.error('❌ [ImageGen]', error);
      const errMsg = `❌ **Gagal membuat gambar.**\n\n${error.message}`;
      await new Chat({ userId, botId, threadId, role: 'user',      content: message }).save();
      await new Chat({ userId, botId, threadId, role: 'assistant', content: errMsg  }).save();
      await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });
      return { response: errMsg, threadId };
    }
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

        // ✅ v1.5.0: If user specified exact slide count, reinforce it here to prevent AI from shortcutting
        const requestedSlides = detectRequestedSlideCount(userRequest);
        if (requestedSlides) {
          contentUserMsg += `\n⚠️ WAJIB: User meminta TEPAT ${requestedSlides} slide. Kamu HARUS generate tepat ${requestedSlides} slide — tidak lebih, tidak kurang. Jangan stop lebih awal. Setiap slide yang diminta harus ada.\n`;
        }
      }

      // Hard cap on total prompt
      const MAX_PROMPT_CHARS = 14000; // ✅ v1.4.0: increased from 12000 since chunked summaries are dense
      if (contentUserMsg.length > MAX_PROMPT_CHARS) {
        console.warn(`[PPT] contentUserMsg too large (${contentUserMsg.length} chars), trimming to ${MAX_PROMPT_CHARS}`);
        contentUserMsg = contentUserMsg.substring(0, MAX_PROMPT_CHARS) + '\n\n[... content trimmed for efficiency ...]\n';
      }

      // ── STEP 3: Content Generation ──────────────────────────────────────────
      console.log(`[PPT] Step 1 — generating content (freeform: ${freeformMode})...`);

      // ✅ v1.5.0: Dynamic token budget — scales with requested slide count
      const requestedSlides   = detectRequestedSlideCount(userRequest);
      const { contentTokens, jsonTokens } = calcTokenBudget(requestedSlides);
      const contentMaxTokens  = freeformMode ? 2000 : contentTokens;

      if (requestedSlides) {
        console.log(`[PPT] Detected ${requestedSlides} requested slides → contentTokens=${contentMaxTokens}, jsonTokens=${jsonTokens}`);
      }

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

      // ✅ v1.5.0: Truncation limit scales with slide count — 1200 chars per slide, min 10000
      const jsonTruncLimit     = requestedSlides
        ? Math.max(requestedSlides * 1200, 10000)
        : 10000;
      const slideContentForJson = slideContent.length > jsonTruncLimit
        ? slideContent.substring(0, jsonTruncLimit) + '\n\n[... trimmed ...]'
        : slideContent;

      if (slideContent.length > jsonTruncLimit) {
        console.warn(`[PPT] slideContent trimmed for JSON: ${slideContent.length} → ${jsonTruncLimit} chars`);
      }

      // ✅ v1.5.0: Add slide count enforcement to JSON conversion prompt
      const jsonSlideCountNote = requestedSlides
        ? `\n\n⚠️ CRITICAL: The presentation has EXACTLY ${requestedSlides} slides. Your JSON output MUST contain ALL ${requestedSlides} slide objects. Do NOT drop or merge any slides.`
        : '';

      const jsonResult = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt:   PPT_JSON_SYSTEM_PROMPT,
        messages:       [],
        userContent:    `Convert this presentation to JSON:${jsonSlideCountNote}\n\n${slideContentForJson}`,
        timeout:        120000,
        maxTokens:      freeformMode ? 4000 : jsonTokens,
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

      // ✅ v1.5.0: Warn if AI produced fewer slides than requested
      if (requestedSlides && pptData.slides.length < requestedSlides) {
        console.warn(`[PPT] ⚠️ AI returned ${pptData.slides.length} slides but user requested ${requestedSlides}. Consider increasing token budgets.`);
      }

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