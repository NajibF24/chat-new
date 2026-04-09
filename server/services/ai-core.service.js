// server/services/ai-core.service.js
// FIXED: Citations always shown when webSearch is enabled on bot
// FIXED: Better citation logic - never skip for informational queries
// ✅ FIXED: Instruksi AI jauh lebih kuat ketika ada OneDrive/Knowledge context
// ✅ FIXED: Deteksi hasOneDriveContext — paksa AI kutip isi dokumen
// ✅ FIXED: Tidak lagi katakan "tidak menemukan informasi" jika dokumen sudah ada
// ✅ FIXED: extractFileContent sekarang punya debug log + path validation

import pdf      from 'pdf-parse';
import mammoth  from 'mammoth';
import XLSX     from 'xlsx';
import fs       from 'fs';
import path     from 'path';
import https    from 'https';
import http     from 'http';

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
import PptxTemplateService from './pptx-template.service.js';

// ─────────────────────────────────────────────────────────────
// URL VALIDATOR — HEAD request to verify URL is reachable
// ─────────────────────────────────────────────────────────────

async function validateUrl(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    try {
      const parsed   = new URL(url);
      const lib      = parsed.protocol === 'https:' ? https : http;
      const req      = lib.request(
        { method: 'HEAD', hostname: parsed.hostname, path: parsed.pathname + parsed.search, timeout: timeoutMs,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GYSBot/1.0)' } },
        (res) => {
          resolve(res.statusCode < 400 || res.statusCode === 403);
        }
      );
      req.on('error',   () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// WEB SEARCH — Bing Search API (or SerpAPI as fallback)
// ─────────────────────────────────────────────────────────────

async function searchWeb(query, maxResults = 8) {
  const results = [];
  
  if (process.env.BING_SEARCH_API_KEY) {
    try {
      const encodedQuery = encodeURIComponent(query);
      const options = {
        method: 'GET',
        hostname: 'api.bing.microsoft.com',
        path: `/v7.0/search?q=${encodedQuery}&count=${maxResults}&mkt=en-US&freshness=Week`,
        headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_SEARCH_API_KEY },
        timeout: 8000,
      };
      const data = await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch { reject(new Error('Parse error')); }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
      });
      if (data?.webPages?.value?.length > 0) {
        return data.webPages.value.map(r => ({ title: r.name, url: r.url, snippet: r.snippet || '' }));
      }
    } catch (e) {
      console.warn('[WebSearch] Bing failed:', e.message);
    }
  }

  if (process.env.SERPAPI_KEY) {
    try {
      const encodedQuery = encodeURIComponent(query);
      const options = {
        method: 'GET',
        hostname: 'serpapi.com',
        path: `/search.json?q=${encodedQuery}&num=${maxResults}&api_key=${process.env.SERPAPI_KEY}&hl=en`,
        timeout: 8000,
      };
      const data = await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch { reject(new Error('Parse error')); }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
      });
      if (data?.organic_results?.length > 0) {
        return data.organic_results.map(r => ({ title: r.title, url: r.link, snippet: r.snippet || '' }));
      }
    } catch (e) {
      console.warn('[WebSearch] SerpAPI failed:', e.message);
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// BUILD VERIFIED CITATIONS
// ─────────────────────────────────────────────────────────────

async function buildVerifiedCitations({ message, aiResponse, contextSources, skipValidation = false }) {
  const citations = [];

  for (const src of contextSources) {
    if (src.startsWith('smartsheet:')) {
      citations.push({ title: src.replace('smartsheet:', ''), url: null, isInternal: true });
    } else if (src.startsWith('knowledge:')) {
      const files = src.replace('knowledge:', '').split(',');
      for (const f of files) {
        citations.push({ title: f.trim(), url: null, isInternal: true });
      }
    } else if (src === 'internal_document') {
      citations.push({ title: 'Internal Document', url: null, isInternal: true });
    } else if (src === 'azure_search') {
      citations.push({ title: 'Azure AI Search', url: null, isInternal: true });
    } else if (src === 'onedrive') {
      citations.push({ title: 'OneDrive Document', url: null, isInternal: true });
    }
  }

  const searchQuery = message.length > 150 ? message.substring(0, 150) : message;
  const webResults  = await searchWeb(searchQuery, 8);
  
  if (skipValidation) {
    for (const r of webResults) {
      citations.push({ title: r.title, url: r.url, isInternal: false });
    }
  } else {
    const validationResults = await Promise.allSettled(webResults.map(r => validateUrl(r.url)));
    for (let i = 0; i < webResults.length; i++) {
      const isValid = validationResults[i].status === 'fulfilled' && validationResults[i].value;
      if (isValid) {
        citations.push({ title: webResults[i].title, url: webResults[i].url, isInternal: false });
      }
    }
  }

  const seen    = new Set();
  const deduped = [];
  for (const c of citations) {
    const key = c.url ? (() => { try { return new URL(c.url).hostname; } catch { return c.url; } })() : c.title;
    if (!seen.has(key)) { seen.add(key); deduped.push(c); }
  }

  const maxCitations = skipValidation ? 8 : 6;
  const sorted       = [
    ...deduped.filter(c => c.isInternal),
    ...deduped.filter(c => !c.isInternal),
  ];

  return sorted.slice(0, maxCitations);
}

// ─────────────────────────────────────────────────────────────
// FORMAT CITATIONS BLOCK
// ─────────────────────────────────────────────────────────────

function formatCitationsBlock(citations) {
  if (!citations || citations.length === 0) return '';
  const webCitations = citations.filter(c => c.url);
  if (webCitations.length === 0) return '';
  const payload = webCitations.map(c => ({ url: c.url, title: c.title || c.url }));
  return `\n\n<!--CITATIONS_START-->\n${JSON.stringify(payload)}\n<!--CITATIONS_END-->`;
}

// ─────────────────────────────────────────────────────────────
// DETECT LANGUAGE
// ─────────────────────────────────────────────────────────────

function detectLanguage(message = '') {
  const indoWords = /\b(apa|bagaimana|mengapa|berapa|siapa|kapan|dimana|tolong|mohon|saya|kamu|ini|itu|adalah|dengan|untuk|dari|yang|dan|atau|tidak|bisa|akan|sudah|belum|lagi|juga|karena|kalau|jika|tapi|tetapi|namun|pada|dalam|oleh|ke|di|ya|iya|ok|oke|halo|hai)\b/i;
  return indoWords.test(message) ? 'id' : 'en';
}

// ─────────────────────────────────────────────────────────────
// DETECT CASUAL MESSAGES
// ─────────────────────────────────────────────────────────────

function isCasualMessage(message = '') {
  const t = (message || '').trim().toLowerCase();

  const pureCasualPatterns = [
    /^(halo|hai|hi+|hello|hey)\s*[!.]*$/i,
    /^(terima kasih|makasih|thanks?|thank you|thx)\s*[!.]*$/i,
    /^(ok|oke)\s*[!.]*$/i,
    /^\s*[😀😊🙏👍❤️🔥👋]+\s*$/,
  ];

  if (pureCasualPatterns.some(p => p.test(t))) return true;
  
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 2 && !t.includes('?') && !t.match(/\b(update|news|insight|snack|next|info|harga|market|steel|baja)\b/i)) {
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────
// SHOULD SKIP CITATION
// ─────────────────────────────────────────────────────────────

function shouldSkipCitation(message = '', aiResponse = '', botCapabilities = {}) {
  if (botCapabilities?.webSearch) return false;
  if (isCasualMessage(message)) return true;
  const wordCount = aiResponse.trim().split(/\s+/).length;
  if (wordCount < 30) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
// EXTRACT SEARCH TOPIC
// ─────────────────────────────────────────────────────────────

function extractSearchTopic(message = '', history = []) {
  const t = message.trim();
  
  const steelKeywords = /\b(steel|baja|besi|iron|scrap|billet|harga|price|market|pasar|industry|industri|indonesia|global|china|trade|ekspor|impor)\b/i;
  
  if (steelKeywords.test(t)) {
    const year = new Date().getFullYear();
    const baseQuery = t.length > 150 ? t.substring(0, 150) : t;
    return `${baseQuery} ${year}`;
  }
  
  if (t.split(/\s+/).length > 8) {
    return t.length > 180 ? t.substring(0, 180) : t;
  }

  const recentHistory = [...history].reverse();
  for (const h of recentHistory) {
    const content = h.content || h.text || '';
    if (content.length > 80 && !content.includes('<!--CITATIONS')) {
      const clean = content.replace(/<!--CITATIONS_START-->[\s\S]*?<!--CITATIONS_END-->/g, '').trim();
      if (clean.length > 50) return clean.substring(0, 180);
    }
  }

  return t;
}

// ─────────────────────────────────────────────────────────────
// PPT SYSTEM PROMPTS
// ─────────────────────────────────────────────────────────────

const PPT_CONTENT_SYSTEM_PROMPT = `You are an expert Presentation Strategist and Visual Designer for PT Garuda Yamato Steel (GYS).
Your job is to produce polished, visually rich slide content — like Gamma.app or Beautiful.ai.
 
═══════════════════════════════════════════════════════
RULE #1 — FOLLOW USER INSTRUCTIONS EXACTLY
═══════════════════════════════════════════════════════
- If user specifies slides explicitly (e.g. "slide 1: vision, slide 2: products"), follow that structure EXACTLY.
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
    → LAYOUT: GRID
 
  Does it show KPIs, metrics, percentages, or big numbers?
    → LAYOUT: STATS
 
  Does it describe a TIMELINE, ROADMAP, PHASES, or SCHEDULE?
    → LAYOUT: TIMELINE
 
  Does it compare two things?
    → LAYOUT: TWO_COLUMN
 
  Does it show a data TABLE or matrix?
    → LAYOUT: TABLE
 
  Does it show trend or comparison data for a chart?
    → LAYOUT: CHART
 
  Is it a powerful quote or mission/vision statement?
    → LAYOUT: QUOTE
 
  Is it the final/closing slide?
    → LAYOUT: CLOSING
 
  Does it show a screenshot, diagram, architecture, UI, or photo from the document?
    → LAYOUT: IMAGE (ONLY if images were provided in this request!)
    → Set imageIndex to the 0-based position of the image (first image = 0, second = 1, etc.)
 
  Is it general narrative content?
    → LAYOUT: CONTENT
 
═══════════════════════════════════════════════════════
RULE #3 — IMAGE SLIDES (CRITICAL)
═══════════════════════════════════════════════════════
When images are attached to this prompt:
- EVERY image MUST appear as its own IMAGE slide
- Use LAYOUT: IMAGE for each screenshot, diagram, architecture chart, or photo
- Set imageIndex to the exact 0-based position of that image
- Write a descriptive caption explaining what the image shows
- Place IMAGE slides near the topic they illustrate
- Do NOT describe the image in text — use IMAGE layout to show it directly
 
═══════════════════════════════════════════════════════
RULE #4 — RICH CONTENT STANDARDS
═══════════════════════════════════════════════════════
- GRID items: emoji icon + short title (3–5 words) + 2–3 sentence description
- STATS: emoji icon + bold value + label + context subtitle
- TIMELINE: 3–6 steps, each with time label + title + description
- TABLE: 3–5 columns, minimum 3 data rows
- CONTENT bullets: minimum 4 bullets, each 10+ words
 
═══════════════════════════════════════════════════════
OUTPUT FORMAT
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
  text: Zero-defect targets enforced by AI-powered visual inspection, reducing rework costs significantly.
 
## [Key Performance Indicators]
LAYOUT: STATS
stats:
- icon: 📈
  value: 94%
  label: Production Uptime
  sub: Target FY 2025
 
## [Implementation Roadmap]
LAYOUT: TIMELINE
steps:
- time: Week 1–2
  title: Discovery & Planning
  text: Stakeholder interviews, current state mapping, gap analysis and project charter sign-off
 
## [Production Trend Analysis]
LAYOUT: CHART
insightText: Production volume grew 23% over the year, with Q3 peak driven by export demand.
chartType: bar
chartData:
- series: Actual (Tons)
  labels: Q1, Q2, Q3, Q4
  values: 11200, 12400, 13800, 14500
 
## [Before vs After]
LAYOUT: TWO_COLUMN
leftTitle: ❌ Current State
left:
- Manual data entry causes 3-hour daily delays
rightTitle: ✅ Future State
right:
- Automated sync reduces reporting delays to under 15 minutes
 
## [AWS VPC Architecture]
LAYOUT: IMAGE
imageIndex: 0
caption: VPC configuration for prod_agent_ai_vpc with CIDR 10.200.0.0/17 in AWS Asia Pacific Jakarta
 
## [Closing]
LAYOUT: CLOSING
subtitle: Thank you for your attention
contact: info@gyssteel.com
`;

const PPT_JSON_SYSTEM_PROMPT = `You are a strict JSON converter for a PowerPoint generator.
Return ONLY valid JSON. No markdown fences. No explanation. No trailing commas.
 
COMPLETE SCHEMA:
 
TITLE:    { "layout": "TITLE", "title": "...", "subtitle": "...", "date": "...", "presenter": "..." }
SECTION:  { "layout": "SECTION", "title": "...", "subtitle": "...", "sectionNumber": "01" }
CONTENT:  { "layout": "CONTENT", "title": "...", "bullets": ["..."] }
GRID:     { "layout": "GRID", "title": "...", "items": [{ "icon": "🚀", "title": "...", "text": "..." }] }
STATS:    { "layout": "STATS", "title": "...", "stats": [{ "icon": "📈", "value": "94%", "label": "...", "sub": "..." }] }
TIMELINE: { "layout": "TIMELINE", "title": "...", "steps": [{ "time": "Week 1–2", "title": "...", "text": "..." }] }
TWO_COLUMN: { "layout": "TWO_COLUMN", "title": "...", "leftTitle": "...", "leftBullets": ["..."], "rightTitle": "...", "rightBullets": ["..."] }
CHART:    { "layout": "CHART", "title": "...", "insightText": "...", "chartConfig": { "type": "bar", "isStacked": false, "showDataLabels": true, "data": [{ "name": "Series", "labels": ["A","B"], "values": [10, 25] }] } }
TABLE:    { "layout": "TABLE", "title": "...", "tableHeaders": ["Col1","Col2"], "tableRows": [["val","val"]] }
QUOTE:    { "layout": "QUOTE", "quote": "...", "author": "..." }
CLOSING:  { "layout": "CLOSING", "title": "Thank You", "subtitle": "...", "contact": "..." }
IMAGE:    { "layout": "IMAGE", "title": "...", "imageIndex": 0, "caption": "..." }
 
CRITICAL RULES:
1. Preserve ALL slides in exact order.
2. For TIMELINE: map "steps" array exactly. NEVER convert to TABLE.
3. Preserve original language in ALL text fields.
4. "title" must never be empty.
5. Numbers in chartConfig values must be actual numbers, not strings.
6. For IMAGE layout: "imageIndex" MUST be the exact integer from the source (0-based). Preserve it exactly as a number.
 
Output format: { "slides": [ { ...slide1 }, { ...slide2 }, ... ] }
`;

// ─────────────────────────────────────────────────────────────
// PPT HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────

const PPT_RESPONSE_MARKERS = [
  '✅ **Presentation successfully',
  '✅ **Presentasi berhasil',
  '⬇️ Download',
  '/api/files/',
  '.pptx',
  '📑 **Total Slides',
  '📑 **Jumlah Slide',
  'GYS Corporate',
  'GYS Gamma',
  'fallback mode',
];

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

const MAX_IMAGES_CORE    = 6;
const MAX_IMAGE_KB_CORE  = 600;
const MAX_PAYLOAD_CORE   = 6 * 1024 * 1024;

async function extractDocxImagesForChat(filePath) {
  const images = [];
  try {
    const AdmZip = (await import('adm-zip')).default;
    const buffer = fs.readFileSync(filePath);
    const zip    = new AdmZip(buffer);
    const entries = zip.getEntries();

    const mediaEntries = [];
    for (const entry of entries) {
      if (!entry.entryName.startsWith('word/media/')) continue;
      const ext = path.extname(entry.entryName).toLowerCase();
      const mimeMap = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp' };
      const mime = mimeMap[ext];
      if (!mime) continue;
      const sizeKB = Math.round(entry.header.size / 1024);
      if (sizeKB < 5 || sizeKB > MAX_IMAGE_KB_CORE) continue;
      mediaEntries.push({ entry, ext, mime, sizeKB, name: path.basename(entry.entryName) });
    }

    mediaEntries.sort((a, b) => b.sizeKB - a.sizeKB);

    let totalBytes = 0;
    for (const { entry, ext, mime, sizeKB, name } of mediaEntries) {
      if (images.length >= MAX_IMAGES_CORE) break;
      let finalMime = mime, finalData = entry.getData();
      if (ext === '.gif') {
        try {
          const sharp = (await import('sharp')).default;
          finalData = await sharp(finalData).jpeg({ quality: 75 }).toBuffer();
          finalMime = 'image/jpeg';
        } catch { continue; }
      }
      const b64 = finalData.toString('base64');
      if (totalBytes + b64.length > MAX_PAYLOAD_CORE) break;
      totalBytes += b64.length;
      images.push({ name, mime: finalMime, base64: b64, sizeKB, data: finalData });
    }
    console.log(`[AICoreService] Extracted ${images.length} images from DOCX`);
  } catch (e) {
    console.warn('[AICoreService] extractDocxImagesForChat error:', e.message);
  }
  return images;
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

  // ─────────────────────────────────────────────────────────────
  // ✅ FIXED: extractFileContent — now with full debug logging
  // ─────────────────────────────────────────────────────────────
  async extractFileContent(attachedFile) {
    console.log(`[AICoreService] extractFileContent called`);
    console.log(`  keys       : ${Object.keys(attachedFile || {}).join(', ')}`);
    console.log(`  serverPath : ${attachedFile?.serverPath}`);
    console.log(`  path       : ${attachedFile?.path}`);
    console.log(`  filename   : ${attachedFile?.filename}`);
    console.log(`  originalname: ${attachedFile?.originalname}`);
    console.log(`  mimetype   : ${attachedFile?.mimetype}`);

    const physicalPath = attachedFile?.serverPath || attachedFile?.path;

    if (!physicalPath) {
      console.warn(`[AICoreService] ⚠️  No physical path available for file extraction`);
      console.warn(`  Received keys: ${Object.keys(attachedFile || {}).join(', ')}`);
      return '';
    }

    if (!fs.existsSync(physicalPath)) {
      console.warn(`[AICoreService] ⚠️  File tidak ditemukan di: ${physicalPath}`);
      // Try alternative paths
      const altPaths = [
        path.join(process.cwd(), 'data', 'files', path.basename(physicalPath)),
        path.join(process.cwd(), physicalPath.replace(/^\//, '')),
      ];
      let foundPath = null;
      for (const alt of altPaths) {
        if (fs.existsSync(alt)) {
          foundPath = alt;
          console.log(`[AICoreService] ✅ Found file at alternative path: ${alt}`);
          break;
        }
      }
      if (!foundPath) {
        console.warn(`[AICoreService] ❌ File not found at any path. Alt paths tried:`, altPaths);
        return '';
      }
      // Use the found path
      return this._readFileContent(foundPath, attachedFile?.originalname || path.basename(physicalPath));
    }

    console.log(`[AICoreService] ✅ Reading file: ${physicalPath}`);
    return this._readFileContent(physicalPath, attachedFile?.originalname || path.basename(physicalPath));
  }

  // ─────────────────────────────────────────────────────────────
  // Internal: actually read and extract text from file
  // ─────────────────────────────────────────────────────────────
  async _readFileContent(physicalPath, originalName) {
    const ext = path.extname(originalName || physicalPath).toLowerCase();
    try {
      if (ext === '.pdf') {
        const data = await pdf(fs.readFileSync(physicalPath));
        const text = data.text || '';
        console.log(`[AICoreService] PDF extracted: ${text.length} chars, ${data.numpages} pages`);
        return `\n\n[FILE CONTENT: ${originalName}]\n${text.substring(0, 8000)}\n[END FILE]\n`;
      } else if (ext === '.docx' || ext === '.doc') {
        const result = await mammoth.extractRawText({ path: physicalPath });
        const text = result.value || '';
        console.log(`[AICoreService] DOCX extracted: ${text.length} chars`);
        return `\n\n[FILE CONTENT: ${originalName}]\n${text.substring(0, 8000)}\n[END FILE]\n`;
      } else if (ext === '.xlsx' || ext === '.xls') {
        const workbook = XLSX.readFile(physicalPath);
        const content  = workbook.SheetNames.map(n => XLSX.utils.sheet_to_csv(workbook.Sheets[n])).join('\n');
        console.log(`[AICoreService] XLSX extracted: ${content.length} chars`);
        return `\n\n[FILE CONTENT: ${originalName}]\n${content.substring(0, 8000)}\n[END FILE]\n`;
      } else {
        const text = fs.readFileSync(physicalPath, 'utf8');
        console.log(`[AICoreService] Text file extracted: ${text.length} chars`);
        return `\n\n[FILE CONTENT: ${originalName}]\n${text.substring(0, 8000)}\n[END FILE]\n`;
      }
    } catch (err) {
      console.error(`[AICoreService] ❌ Failed to read file "${originalName}": ${err.message}`);
      return '';
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

    if (isPptCommand(message)) {
      return this._handlePptCommand({ userId, botId, bot, message, threadId, history, attachedFile });
    }

    let contextData    = '';
    let contextSources = [];
    
    const botHasWebSearch = Boolean(bot.capabilities?.webSearch);

    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
      try {
        const kouventa = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
        const reply    = await kouventa.generateResponse(message || '');
        contextData   += `\n\n=== INTERNAL DOCUMENT REFERENCE ===\n${reply}\n`;
        contextSources.push('internal_document');
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
          contextData += `\n\n=== AZURE AI SEARCH REFERENCE ===\n${context}\n`;
          const augmentedSystemPrompt = (bot.systemPrompt || bot.prompt || '') + '\n\n' + context;
          bot = { ...bot.toObject(), systemPrompt: augmentedSystemPrompt };
          contextSources.push('azure_search');
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
            contextSources.push(`smartsheet:${sheet.name}`);
          }
        }
      } catch (e) {
        console.error('Smartsheet Error:', e.message);
        contextData += `\n\n=== SMARTSHEET DATA ===\n❌ Failed to load data: ${e.message}\n`;
      }
    }

    if (bot.onedriveConfig?.enabled && 
        bot.onedriveConfig?.folderUrl && 
        bot.onedriveConfig?.tenantId && 
        bot.onedriveConfig?.clientId && 
        bot.onedriveConfig?.clientSecret) {
      try {
        const { default: OneDriveService } = await import('./onedrive.service.js');
        const svc = new OneDriveService(
          bot.onedriveConfig.tenantId,
          bot.onedriveConfig.clientId,
          bot.onedriveConfig.clientSecret
        );
        console.log(`[AICoreService] Fetching OneDrive context for: "${message?.substring(0, 50)}"`);
        const oneDriveCtx = await svc.buildContext(bot.onedriveConfig.folderUrl, message || '');
        if (oneDriveCtx) {
          contextData += oneDriveCtx;
          contextSources.push('onedrive');
          console.log('[AICoreService] ✅ OneDrive context injected, length:', oneDriveCtx.length);
        }
      } catch (odErr) {
        console.error('[AICoreService] OneDrive error:', odErr.message);
        contextData += `\n\n=== 📁 ONEDRIVE (ERROR) ===\n⚠️ Gagal membaca dokumen OneDrive: ${odErr.message}\nSilakan hubungi IT jika masalah berlanjut.\n=== AKHIR ONEDRIVE ===\n`;
      }
    }
    
    if (bot.knowledgeFiles?.length > 0 && bot.knowledgeMode !== 'disabled') {
      const knowledgeCtx = KnowledgeBaseService.buildKnowledgeContext(
        bot.knowledgeFiles, message, bot.knowledgeMode || 'relevant'
      );
      if (knowledgeCtx) {
        contextData += knowledgeCtx;
        const relevantFiles = bot.knowledgeFiles
          .filter(f => f.content && f.content.length > 0)
          .map(f => f.originalName)
          .slice(0, 3);
        if (relevantFiles.length > 0) {
          contextSources.push(`knowledge:${relevantFiles.join(',')}`);
        }
      }
    }

    const userContent = [];
    if (message) userContent.push({ type: 'text', text: message });

    // ✅ Handle attached file
    if (attachedFile) {
      console.log(`[AICoreService] Processing attachedFile: ${attachedFile.originalname || attachedFile.filename}`);
      if (attachedFile.mimetype?.startsWith('image/') && bot.aiProvider?.provider === 'openai') {
        const imgPath = attachedFile.serverPath || attachedFile.path;
        if (imgPath && fs.existsSync(imgPath)) {
          const imgBuffer = fs.readFileSync(imgPath);
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${attachedFile.mimetype};base64,${imgBuffer.toString('base64')}` },
          });
          console.log(`[AICoreService] ✅ Image attached as base64 (${attachedFile.mimetype})`);
        } else {
          console.warn(`[AICoreService] ⚠️ Image file not found at path for base64 encoding`);
        }
      } else {
        const text = await this.extractFileContent(attachedFile);
        if (text) {
          userContent.push({ type: 'text', text });
          console.log(`[AICoreService] ✅ File content extracted: ${text.length} chars`);
        } else {
          console.warn(`[AICoreService] ⚠️ File content extraction returned empty string`);
          // Still inform the AI about the file even if we can't read it
          userContent.push({ type: 'text', text: `[User attached a file: ${attachedFile.originalname || attachedFile.filename} but content could not be extracted]` });
        }
      }
    }

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const likelyCasual = isCasualMessage(message || '');

    // ✅ FIX: Deteksi apakah ada OneDrive context — jika ada, paksa AI mengutip isi dokumen
    const hasOneDriveContext = contextData.includes('=== DOKUMEN INTERNAL PT GARUDA YAMATO STEEL ===');
    const hasAnyContext = contextData.length > 200;

    // ✅ FIX: Instruksi citation yang jauh lebih kuat ketika ada konteks dokumen OneDrive
    let citationInstruction = '';

    if (hasOneDriveContext) {
      citationInstruction = `
🔴 INSTRUKSI WAJIB — JANGAN DIABAIKAN:
Kamu telah diberikan akses ke DOKUMEN INTERNAL perusahaan yang SUDAH DIBACA dan tersedia di bawah.
Dokumen-dokumen tersebut mengandung informasi yang relevan dengan pertanyaan user.

ATURAN YANG WAJIB DIIKUTI:
1. BACA seluruh konten dokumen yang tersedia dengan SANGAT TELITI
2. JANGAN PERNAH mengatakan "saya tidak menemukan informasi" — dokumennya SUDAH ADA
3. JANGAN PERNAH menyuruh user untuk "menghubungi departemen IT" jika informasinya ada di dokumen
4. KUTIP langsung bagian-bagian penting dari dokumen secara verbatim
5. SEBUTKAN nomor kebijakan/SOP/prosedur secara eksplisit (contoh: 007/POL/IT/GYS)
6. JAWAB dengan SANGAT DETAIL — jangan ringkas berlebihan
7. Jika dokumen berisi langkah-langkah atau prosedur, TULISKAN SEMUA LANGKAHNYA
8. Struktur jawaban dengan heading ## dan sub-heading ###
9. Di akhir jawaban, cantumkan sumber: 📂 **Sumber:** [nama file]

DILARANG KERAS:
❌ Mengatakan "tidak ada informasi tentang ini dalam dokumen yang tersedia"
❌ Mengatakan "silakan hubungi tim IT/HR/Finance"
❌ Hanya menyebut nama dokumen tanpa menjelaskan isinya
❌ Meringkas berlebihan tanpa kutipan dari dokumen
`;
    } else if (!likelyCasual) {
      citationInstruction = botHasWebSearch ? `
IMPORTANT: You are a web-search-enabled assistant. Always write your response referencing the most recent and relevant information.
Your response will automatically have source links appended below — do NOT add your own "Sources:" section.
Write your response, then the system will add verified web sources automatically.
` : `
IMPORTANT: Do NOT add a "Sources:" or "References:" section yourself.
The system will automatically append verified, clickable source links after your response.
If you used internal documents or Smartsheet data, mention the file name inline.
Do NOT fabricate URLs.
`;
    }

    const systemPrompt = [
      bot.prompt || bot.systemPrompt || '',
      `[TODAY: ${today}]`,
      citationInstruction,
      contextData,
      hasOneDriveContext
        ? `\n\n🔴 REMINDER TERAKHIR: Jawab pertanyaan "${(message || '').substring(0, 100)}" dengan DETAIL PENUH berdasarkan konten dokumen di atas. Kutip informasi spesifik. JANGAN katakan tidak ada informasi.`
        : hasAnyContext
        ? 'Gunakan data dan pengetahuan dari dokumen di atas untuk menjawab secara akurat. Jangan membuat-buat fakta.'
        : '',
    ].filter(Boolean).join('\n\n');

    const result = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt,
      messages: history.slice(-6),
      userContent: userContent.length === 1 && userContent[0].type === 'text'
        ? userContent[0].text
        : userContent,
      capabilities: bot.capabilities || {},
    });

    let aiResponse = result.text;

    const hasEmbeddedCitations = aiResponse.includes('<!--CITATIONS_START-->');

    if (!hasEmbeddedCitations) {
      const skipCitation = shouldSkipCitation(message || '', aiResponse, bot.capabilities || {});
      
      if (!skipCitation && !hasOneDriveContext) {
        try {
          const searchTopic = extractSearchTopic(message || '', history.slice(-6));
          console.log(`[Citations] Searching for: "${searchTopic.substring(0, 80)}" | webSearch bot: ${botHasWebSearch}`);
          
          const citations = await buildVerifiedCitations({
            message:        searchTopic,
            aiResponse,
            contextSources,
            skipValidation: botHasWebSearch,
          });
          
          if (citations.length > 0) {
            aiResponse = aiResponse
              .replace(/\n+---\s*\n.{0,10}(?:Sources?|References?|Sumber).{0,10}\n[\s\S]*$/im, '')
              .replace(/\*\*(?:Sources?|References?|Sumber)\*\*[\s\S]*$/im, '')
              .trim();
            aiResponse += formatCitationsBlock(citations);
            console.log(`[Citations] Added ${citations.length} citations`);
          } else {
            console.log('[Citations] No citations found');
          }
        } catch (citErr) {
          console.warn('[Citations] Failed to build citations:', citErr.message);
        }
      } else if (hasOneDriveContext) {
        console.log('[Citations] Skipped — OneDrive context present, internal docs cited');
      } else {
        console.log('[Citations] Skipped (casual message or short response)');
      }
    }

    let savedAttachments = [];
    if (attachedFile) {
      savedAttachments.push({
        name: attachedFile.originalname || attachedFile.filename,
        path: `/api/files/${attachedFile.filename}`,
        serverPath: attachedFile.serverPath || attachedFile.path,
        type: attachedFile.mimetype?.includes('image') ? 'image'
          : attachedFile.mimetype?.includes('pdf') ? 'pdf' : 'file',
      });
    }

    await new Chat({ userId, botId, threadId, role: 'user', content: message || '', attachedFiles: savedAttachments }).save();
    await new Chat({ userId, botId, threadId, role: 'assistant', content: aiResponse }).save();
    await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });

    return { response: aiResponse, threadId, attachedFiles: savedAttachments };
  }

  // ─────────────────────────────────────────────────────────────
  // PPT COMMAND HANDLER
  // ─────────────────────────────────────────────────────────────
  async _handlePptCommand({ userId, botId, bot, message, threadId, history = [], attachedFile = null }) {
    try {
      let dbHistory = [];
      try {
        if (threadId) {
          dbHistory = await Chat.find({ threadId }).sort({ createdAt: 1 }).limit(30).lean();
        }
        dbHistory = dbHistory.filter(h => {
          if (!h.content) return false;
          if (PPT_RESPONSE_MARKERS.some(m => h.content.includes(m))) return false;
          return true;
        });
      } catch (e) { console.warn('[PPT] DB history error:', e.message); }

      const userRequest     = message || '';
      const refersToHistory = /\b(based on|from|use|history|chat|conversation|above|previous|berdasarkan|dari|gunakan|pakai|tadi|di atas|sebelumnya)\b/i.test(userRequest);

      let historicalContent = '';
      if (refersToHistory && dbHistory.length > 0) {
        historicalContent = dbHistory
          .filter(h => h.content && h.content.length > 100)
          .filter(h => !PPT_RESPONSE_MARKERS.some(m => (h.content || '').includes(m)))
          .map(h => `[${h.role === 'assistant' ? 'ASSISTANT' : 'USER'}]:\n${h.content}`)
          .join('\n\n---\n\n')
          .substring(0, 8000);
      }

      console.log('[PPT] Step 1 — generating smart content with auto layout detection...');

      let docxImages    = [];
      let docxText      = '';
      let hasDocxImages = false;

      if (attachedFile) {
        const attachedExt = path.extname(
          attachedFile.originalname || attachedFile.filename || ''
        ).toLowerCase();
        if (attachedExt === '.docx' || attachedFile.mimetype?.includes('wordprocessingml')) {
          const physPath = attachedFile.serverPath || attachedFile.path;
          if (physPath && fs.existsSync(physPath)) {
            docxImages    = await extractDocxImagesForChat(physPath);
            hasDocxImages = docxImages.length > 0;
            try {
              const mammothMod = await import('mammoth');
              const result = await mammothMod.default.extractRawText({ path: physPath });
              docxText = result.value || '';
            } catch (e) { console.warn('[PPT] DOCX text error:', e.message); }
          }
        }
      }

      const isAnthropicProvider = bot.aiProvider?.provider === 'anthropic';
      let contentResult;

      if (isAnthropicProvider && hasDocxImages) {
        const axios  = (await import('axios')).default;
        const apiKey = bot.aiProvider.apiKey?.trim() || process.env.ANTHROPIC_API_KEY || '';
        const model  = bot.aiProvider.model || 'claude-sonnet-4-6';
        const maxTok = Math.max(bot.aiProvider.maxTokens ?? 4096, 8000);

        const contextText = [
          historicalContent ? `CONVERSATION:\n${historicalContent}\n\n` : '',
          docxText ? `DOCUMENT:\n${docxText.substring(0, 25000)}\n\n` : '',
          `REQUEST: ${userRequest}`,
          `\nMatch language exactly. ${docxImages.length} images attached below.`,
        ].filter(Boolean).join('');

        const blocks = [{ type: 'text', text: contextText }];
        docxImages.forEach((img, i) => {
          blocks.push({ type: 'text', text: `[IMAGE ${i+1}: "${img.name}" (${img.sizeKB}KB)]` });
          blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } });
        });

        try {
          const resp = await axios.post(
            'https://api.anthropic.com/v1/messages',
            { model, max_tokens: maxTok, temperature: bot.aiProvider.temperature ?? 0.1,
              system: PPT_CONTENT_SYSTEM_PROMPT, messages: [{ role: 'user', content: blocks }] },
            { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
              timeout: 180000 }
          );
          const text = resp.data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
          contentResult = { text, usage: resp.data.usage };
        } catch (err) {
          console.warn('[PPT/Vision] Failed, falling back to text-only:', err.message);
          contentResult = await AIProviderService.generateCompletion({
            providerConfig: bot.aiProvider, systemPrompt: PPT_CONTENT_SYSTEM_PROMPT,
            messages: [], userContent: contextText + '\n[Note: image analysis unavailable]',
          });
        }
      } else {
        const noImageConstraint = !hasDocxImages 
        ? `\n\nCRITICAL CONSTRAINT: This document has NO images or screenshots. You MUST NOT use LAYOUT: IMAGE for any slide. Allowed layouts ONLY: TITLE, SECTION, CONTENT, GRID, STATS, TIMELINE, TWO_COLUMN, CHART, TABLE, QUOTE, CLOSING.\n`
        : `\n\nThis document contains ${docxImages.length} image(s). Only use LAYOUT: IMAGE for those specific images.\n`;
 
      const contentUserMsg = `Generate a presentation.\nMatch language exactly.\n\n` +
        (historicalContent ? `History:\n${historicalContent}\n\n` : '') +
        (docxText ? `Document:\n${docxText.substring(0, 20000)}\n\n` : '') +
        `Request: ${userRequest}${noImageConstraint}`;
 
      contentResult = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt: PPT_CONTENT_SYSTEM_PROMPT, messages: [], userContent: contentUserMsg,
      });
      }

      const slideContent = contentResult.text;
      if (!slideContent?.trim()) throw new Error('AI returned empty slide content');

      const titleMatch = slideContent.match(/^#\s+(.+)/m);
      const title      = titleMatch ? titleMatch[1].trim().substring(0, 60) : 'GYS Executive Deck';

      console.log(`[PPT] Content ready — Title: "${title}" | ${slideContent.length} chars`);
      console.log('[PPT] Step 2 — converting to JSON...');

      const jsonResult = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt: PPT_JSON_SYSTEM_PROMPT,
        messages: [],
        userContent: `Convert this presentation to JSON:\n\n${slideContent}`,
      });

      let rawJson = jsonResult.text
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/gi, '')
        .trim();

      const jsonStart = rawJson.indexOf('{');
      const jsonEnd   = rawJson.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        rawJson = rawJson.substring(jsonStart, jsonEnd + 1);
      }

      let pptData;
      try {
        pptData = JSON.parse(rawJson);
      } catch (parseErr) {
        console.error('[PPT] JSON parse failed:', parseErr.message);
        throw new Error('AI failed to generate presentation data format. Please try again.');
      }

      if (!pptData?.slides?.length) {
        throw new Error('JSON has no slides. Please try again.');
      }

      const layoutLog = pptData.slides.map(s => s.layout || 'CONTENT').join(', ');
      console.log(`[PPT] JSON OK — ${pptData.slides.length} slides — Layouts: [${layoutLog}]`);

      const outputDir = path.join(process.cwd(), 'data', 'files');
      console.log(`[PPT] Step 3 — generating PPTX file (${pptData.slides.length} slides)...`);

      let result = null;

      if (PptxTemplateService.hasTemplate(bot)) {
        console.log('[PPT] Template PPTX found in knowledge base — using real template...');
        try {
          result = await PptxTemplateService.generate({
            bot,
            pptData,
            title,
            outputDir,
            docxImages,
          });

          if (result) {
            console.log(`[PPT] ✅ Generated using template: "${result.usedTemplate}"`);
          } else {
            console.log('[PPT] Template generation returned null, falling back to pptxgenjs...');
          }
        } catch (templateErr) {
          console.warn('[PPT] Template generation failed:', templateErr.message);
          console.warn('[PPT] Falling back to pptxgenjs renderer...');
          result = null;
        }
      }

      if (!result) {
        console.log('[PPT] Using pptxgenjs renderer...');
        result = await PptxService.generate({
          pptData,
          slideContent,
          title,
          outputDir,
          styleDesc: 'GYS Gamma Edition',
          images: docxImages,
        });
      }

      console.log(`[PPT] Step 3 done — ${result.pptxName}`);

      const reqLower = userRequest.toLowerCase();
      const reqIndo  = reqLower.includes('bahasa indonesia') || reqLower.includes('indo');
      const reqEng   = reqLower.includes('english') || reqLower.includes('inggris');

      let isEnglish = false;
      if (reqEng) {
        isEnglish = true;
      } else if (reqIndo) {
        isEnglish = false;
      } else {
        const engWords = reqLower.match(/\b(create|make|generate|presentation|deck|please)\b/g) || [];
        const indWords = reqLower.match(/\b(buat|buatkan|bikin|bikinkan|tolong|presentasi)\b/g) || [];
        isEnglish = engWords.length > indWords.length;
      }

      const layoutIcons = {
        TITLE: '🏷️', CONTENT: '📝', GRID: '🧩', STATS: '📊',
        TIMELINE: '🗓️', TWO_COLUMN: '↔️', CHART: '📈',
        TABLE: '📋', QUOTE: '💬', SECTION: '📌', CLOSING: '🎯',
        IMAGE: '🖼️',
      };

      const layoutSummary = (pptData.slides || [])
        .filter(Boolean)
        .map((s, i) => {
          const ic = layoutIcons[(s.layout || 'CONTENT').toUpperCase()] || '📄';
          return `${ic} **Slide ${i + 1}:** ${s.title || '—'} _(${s.layout || 'CONTENT'})_`;
        })
        .join('\n');

      const imageNote = hasDocxImages
        ? `\n\n📸 **${docxImages.length} gambar dari dokumen** dianalisis dan dimasukkan ke presentasi`
        : '';

      const templateNote = result.usedTemplate
        ? `\n\n📋 **Template:** Menggunakan template asli "${result.usedTemplate}" dari Knowledge Base`
        : '';

      const responseMarkdown = isEnglish
        ? `✅ **GYS Presentation successfully generated!**
 
📊 **Title:** ${title}
📑 **Total Slides:** ${result.slideCount} slides
🎨 **Theme:** GYS Gamma Style${result.usedFallback ? ' _(fallback mode)_' : ''}${templateNote}${imageNote}
 
---
### [⬇️ Download Presentation (.pptx)](${result.pptxUrl})
 
**Auto-detected slide layouts:**
${layoutSummary}
 
💡 _Tip: Upload a GYS-themed PPT file to the Knowledge Base for the bot to automatically use it as template._`
        : `✅ **Presentasi GYS berhasil dibuat!**
 
📊 **Judul:** ${title}
📑 **Jumlah Slide:** ${result.slideCount} slides
🎨 **Tema:** GYS Gamma Style${result.usedFallback ? ' _(fallback mode)_' : ''}${templateNote}${imageNote}
 
---
### [⬇️ Download Presentasi (.pptx)](${result.pptxUrl})
 
**Layout yang dipilih otomatis per slide:**
${layoutSummary}
 
💡 _Tip: Upload file PPT bertemakan GYS ke Knowledge Base agar bot otomatis menggunakan template asli Anda._`;

      try {
        await new Chat({ userId, botId, threadId, role: 'user', content: message }).save();
        await new Chat({
          userId, botId, threadId, role: 'assistant', content: responseMarkdown,
          attachedFiles: [{ name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }],
        }).save();
        await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });
      } catch (saveErr) {
        console.error('❌ [PPT] DB save error:', saveErr.message);
      }

      return {
        response: responseMarkdown, threadId,
        attachedFiles: [{ name: result.pptxName, path: result.pptxUrl, type: 'file', size: '0' }],
      };

    } catch (error) {
      console.error('❌ [PPT Command]', error);
      throw new Error(`Failed to create presentation: ${error.message}`);
    }
  }
}

export default new AICoreService();
