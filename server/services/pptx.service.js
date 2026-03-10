// server/services/pptx.service.js
// ═══════════════════════════════════════════════════════════════
// REDESIGNED: AI generates HTML slides (like Gamma/Nano Banana)
// Flow:
//   1. AI generates full HTML presentation (beautiful, visual)
//   2. Puppeteer screenshots each slide → PNG images
//   3. PptxGenJS embeds images → .pptx file
//   4. HTML file saved for in-chat preview
//
// Why HTML approach:
//   - AI can use CSS, photos, SVG, gradients, animations
//   - Cannot crash like PptxGenJS code execution
//   - Output is visually rich by default
//   - Same approach as Gamma, Beautiful.ai, Tome
// ═══════════════════════════════════════════════════════════════

import PptxGenJS  from 'pptxgenjs';
import puppeteer  from 'puppeteer';
import path       from 'path';
import fs         from 'fs';

// ───────────────────────────────────────────────────────────────
// SYSTEM PROMPT — AI generates a full HTML presentation
// ───────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────
// SYSTEM PROMPT — AI generates a full HTML presentation
// ───────────────────────────────────────────────────────────────
export const HTML_SLIDE_SYSTEM_PROMPT = `You are an elite presentation designer.
Generate a complete, self-contained HTML file that displays a beautiful presentation.

════════════════════════════════════════════════
MANDATORY THINKING PHASE
════════════════════════════════════════════════
Before generating the HTML, you MUST wrap your thought process in <thinking>...</thinking> tags.
Use this block to:
1. Analyze the core message and target audience (Executive/Professional).
2. Plan the visual hierarchy, color palette, and layout for each slide.
3. Ensure the design perfectly matches the professional style requested.

════════════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════════════
After the </thinking> tag, return ONLY a complete HTML document. No explanation. No markdown fences.
Start directly with <!DOCTYPE html>

════════════════════════════════════════════════
TECHNICAL REQUIREMENTS
════════════════════════════════════════════════
- Single HTML file, fully self-contained (no external files except Google Fonts & Unsplash)
- Each slide is a <div class="slide"> with fixed size: width:1280px height:720px
- All slides stacked vertically (display:block), separated by 20px gap
- Each slide has a data-slide-index attribute: data-slide-index="1", "2", etc.
- Google Fonts allowed via @import in <style>
- Unsplash photos allowed via <img src="https://images.unsplash.com/photo-ID?auto=format&fit=crop&w=1280&q=80">
- Inline SVG allowed for icons and diagrams
- NO JavaScript required for display (slides are static)
- Use CSS for all visual effects (gradients, shadows, animations are ok)

════════════════════════════════════════════════
VISUAL CAPABILITIES — USE ALL OF THESE
════════════════════════════════════════════════

── 1. FULL-BLEED PHOTO BACKGROUNDS ──
<div class="slide" style="position:relative; overflow:hidden;">
  <img src="https://source.unsplash.com/1280x720/?steel,factory,industrial"
       style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0;">
  <div style="position:absolute;top:0;left:0;width:100%;height:100%;
              background:linear-gradient(135deg,rgba(0,0,0,0.75) 0%,rgba(0,20,60,0.6) 100%);z-index:1;"></div>
  <div style="position:relative;z-index:2; padding:60px;">
    <!-- content here -->
  </div>
</div>

── 2. SPLIT LAYOUT (photo right, content left) ──
<div class="slide" style="display:flex;">
  <div style="width:55%;padding:60px;background:#0F1923;display:flex;flex-direction:column;justify-content:center;">
    <!-- text content -->
  </div>
  <div style="width:45%;position:relative;">
    <img src="https://source.unsplash.com/600x720/?technology,AI"
         style="width:100%;height:100%;object-fit:cover;">
    <div style="position:absolute;inset:0;background:rgba(0,30,80,0.3);"></div>
  </div>
</div>

── 3. INLINE SVG CHARTS (no external libs needed) ──
<!-- Bar chart using SVG rects -->
<svg width="900" height="300" style="overflow:visible;">
  <!-- Y axis -->
  <line x1="60" y1="10" x2="60" y2="260" stroke="#334155" stroke-width="1"/>
  <!-- Bars -->
  <rect x="80"  y="60"  width="120" height="200" fill="#0EA5E9" rx="4"/>
  <rect x="230" y="100" width="120" height="160" fill="#0EA5E9" rx="4" opacity="0.8"/>
  <rect x="380" y="40"  width="120" height="220" fill="#0EA5E9" rx="4" opacity="0.9"/>
  <rect x="530" y="130" width="120" height="130" fill="#0EA5E9" rx="4" opacity="0.7"/>
  <!-- Labels -->
  <text x="140" y="278" text-anchor="middle" fill="#94A3B8" font-size="13" font-family="Inter">Q1</text>
  <text x="290" y="278" text-anchor="middle" fill="#94A3B8" font-size="13" font-family="Inter">Q2</text>
  <text x="440" y="278" text-anchor="middle" fill="#94A3B8" font-size="13" font-family="Inter">Q3</text>
  <text x="590" y="278" text-anchor="middle" fill="#94A3B8" font-size="13" font-family="Inter">Q4</text>
  <!-- Values -->
  <text x="140" y="52" text-anchor="middle" fill="#E2E8F0" font-size="14" font-weight="bold" font-family="Inter">$4.2M</text>
  <text x="290" y="92" text-anchor="middle" fill="#E2E8F0" font-size="14" font-weight="bold" font-family="Inter">$3.8M</text>
  <text x="440" y="32" text-anchor="middle" fill="#E2E8F0" font-size="14" font-weight="bold" font-family="Inter">$5.1M</text>
  <text x="590" y="122" text-anchor="middle" fill="#E2E8F0" font-size="14" font-weight="bold" font-family="Inter">$3.3M</text>
</svg>

<!-- Donut/pie chart using SVG stroke-dasharray trick -->
<svg width="200" height="200" viewBox="0 0 200 200">
  <!-- Background circle -->
  <circle cx="100" cy="100" r="80" fill="none" stroke="#1E293B" stroke-width="30"/>
  <!-- Segment 1: 40% = 200.96 of 502.4 circumference -->
  <circle cx="100" cy="100" r="80" fill="none" stroke="#0EA5E9" stroke-width="30"
          stroke-dasharray="201 301" stroke-dashoffset="0" transform="rotate(-90 100 100)"/>
  <!-- Segment 2: 35% -->
  <circle cx="100" cy="100" r="80" fill="none" stroke="#10B981" stroke-width="30"
          stroke-dasharray="176 326" stroke-dashoffset="-201" transform="rotate(-90 100 100)"/>
  <!-- Segment 3: 25% -->
  <circle cx="100" cy="100" r="80" fill="none" stroke="#F59E0B" stroke-width="30"
          stroke-dasharray="125 377" stroke-dashoffset="-377" transform="rotate(-90 100 100)"/>
  <!-- Center label -->
  <text x="100" y="95" text-anchor="middle" fill="white" font-size="22" font-weight="bold" font-family="Inter">100%</text>
  <text x="100" y="115" text-anchor="middle" fill="#94A3B8" font-size="11" font-family="Inter">Total</text>
</svg>

── 4. KPI STAT CARDS ──
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:40px 60px;">
  <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
              border-radius:16px;padding:28px;border-top:3px solid #0EA5E9;">
    <div style="font-size:42px;font-weight:800;color:#0EA5E9;font-family:'Montserrat';">94%</div>
    <div style="font-size:13px;color:#94A3B8;margin-top:8px;font-family:'Inter';">Client Retention</div>
  </div>
  <!-- repeat for other KPIs -->
</div>

── 5. PROGRESS BARS ──
<div style="padding:20px 0;">
  <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
    <span style="color:#E2E8F0;font-size:14px;font-family:'Inter';">Project Alpha</span>
    <span style="color:#0EA5E9;font-size:14px;font-weight:700;font-family:'Inter';">87%</span>
  </div>
  <div style="background:rgba(255,255,255,0.1);border-radius:999px;height:8px;">
    <div style="background:linear-gradient(90deg,#0EA5E9,#38BDF8);width:87%;height:8px;border-radius:999px;"></div>
  </div>
</div>

── 6. TIMELINE / PROCESS STEPS ──
<div style="display:flex;gap:0;align-items:flex-start;padding:40px 60px;">
  <div style="flex:1;text-align:center;position:relative;">
    <div style="width:48px;height:48px;border-radius:50%;background:#0EA5E9;color:white;
                font-size:18px;font-weight:800;display:flex;align-items:center;justify-content:center;
                margin:0 auto 16px;font-family:'Montserrat';">1</div>
    <div style="position:absolute;top:24px;left:50%;width:100%;height:2px;background:rgba(14,165,233,0.3);z-index:-1;"></div>
    <div style="font-size:13px;font-weight:700;color:#E2E8F0;font-family:'Inter';">Discovery</div>
    <div style="font-size:11px;color:#94A3B8;margin-top:6px;font-family:'Inter';">Week 1-2</div>
  </div>
  <!-- repeat steps -->
</div>

── 7. ICON-LIKE SVG ELEMENTS ──
<!-- Checkmark icon -->
<svg width="32" height="32" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="16" fill="#10B981"/>
  <polyline points="8,16 13,22 24,10" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>
</svg>

<!-- Gear/settings icon -->
<svg width="32" height="32" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="5" fill="none" stroke="#0EA5E9" stroke-width="2.5"/>
  <path d="M16 4 L18 8 L22 6 L22 10 L26 12 L24 16 L26 20 L22 22 L22 26 L18 24 L16 28 L14 24 L10 26 L10 22 L6 20 L8 16 L6 12 L10 10 L10 6 L14 8 Z"
        fill="none" stroke="#0EA5E9" stroke-width="2" stroke-linejoin="round"/>
</svg>

── 8. INLINE SVG DIAGRAMS ──
<!-- Architecture/layer diagram -->
<svg width="700" height="300" style="overflow:visible;">
  <!-- Layer boxes with labels -->
  <rect x="50" y="20" width="600" height="55" rx="8" fill="rgba(14,165,233,0.15)" stroke="#0EA5E9" stroke-width="1.5"/>
  <text x="350" y="52" text-anchor="middle" fill="#0EA5E9" font-size="16" font-weight="700" font-family="Inter">AI Intelligence Layer</text>
  
  <rect x="50" y="110" width="600" height="55" rx="8" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
  <text x="350" y="142" text-anchor="middle" fill="#CBD5E1" font-size="16" font-family="Inter">Machines &amp; Sensors (OT)</text>
  
  <rect x="50" y="200" width="600" height="55" rx="8" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
  <text x="350" y="232" text-anchor="middle" fill="#CBD5E1" font-size="16" font-family="Inter">ERP / IT Systems</text>
  
  <!-- Arrows -->
  <line x1="350" y1="75" x2="350" y2="108" stroke="#0EA5E9" stroke-width="2" marker-end="url(#arr)"/>
  <line x1="350" y1="167" x2="350" y2="198" stroke="#0EA5E9" stroke-width="2" marker-end="url(#arr)"/>
  <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
    <path d="M0,0 L8,4 L0,8 Z" fill="#0EA5E9"/>
  </marker></defs>
</svg>

════════════════════════════════════════════════
DESIGN RULES
════════════════════════════════════════════════

PALETTE: Pick a strong theme matching the style request.
- Dark/tech: bg #0A0F1E, accent #0EA5E9/#38BDF8, text white
- Minimal: bg white, accent #1E3A8A, text #1E293B  
- Warm exec: bg #1A0A00, accent #D97706/#F59E0B, text white
- Nature/ESG: bg #0A1A0A, accent #10B981/#34D399, text white

FONTS via Google Fonts (pick per style):
- Tech/modern: Montserrat + Inter
- Executive: Playfair Display + Inter
- Minimal: DM Sans + DM Serif Display
- Bold: Bebas Neue + Inter

SLIDE VARIETY — never repeat same layout:
- Slide 1 (Title): Full-bleed photo bg + overlay + large centered title
- Slide 2: KPI stat cards (3-4 across)  
- Slide 3: Split (content left, photo right)
- Slide 4: SVG chart (bar or line matching topic data)
- Slide 5: Progress bars or timeline
- Slide 6: SVG diagram or infographic (architecture, flow, etc.)
- Slide 7: Two-column comparison or feature grid with icons
- Slide 8: Donut chart + key insights text
- Closing: Full-bleed photo + overlay + closing statement

PHOTOS — use Unsplash with precise keywords:
https://source.unsplash.com/1280x720/?steel,factory,industrial
https://source.unsplash.com/600x720/?artificial,intelligence,technology
(Vary keywords per slide for different photos)

CHART DATA — invent plausible, specific numbers matching the topic.

SLIDE STRUCTURE (each slide must be exactly 1280x720):
<div class="slide" data-slide-index="N" style="width:1280px;height:720px;overflow:hidden;position:relative;box-sizing:border-box;">

SLIDE TITLE (always present, except title slide):
<div style="position:absolute;top:0;left:0;right:0;height:72px;
            background:rgba(0,0,0,0.4);display:flex;align-items:center;padding:0 60px;
            border-bottom:1px solid rgba(255,255,255,0.08);">
  <h2 style="margin:0;font-size:22px;font-weight:700;color:white;font-family:'Montserrat';">Slide Title Here</h2>
</div>

PAGE NUMBER (bottom right, always):
<div style="position:absolute;bottom:20px;right:40px;font-size:12px;color:rgba(255,255,255,0.35);font-family:'Inter';">N / TOTAL</div>

════════════════════════════════════════════════
HTML WRAPPER STRUCTURE
════════════════════════════════════════════════
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;800;900&family=Inter:wght@400;500;600&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#111; display:flex; flex-direction:column; align-items:center; gap:20px; padding:20px; }
  .slide { width:1280px; height:720px; overflow:hidden; position:relative; border-radius:4px; }
</style>
</head>
<body>
  <!-- slides here, one per section -->
</body>
</html>`;

// ───────────────────────────────────────────────────────────────
// Screenshot each slide via Puppeteer → PNG buffers
// ───────────────────────────────────────────────────────────────
async function screenshotSlides(htmlFilePath) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,720',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 }); // retina quality

    const fileUrl = `file://${htmlFilePath}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for fonts and images
    await page.waitForTimeout(2000);

    // Get all slide elements
    const slideCount = await page.evaluate(() =>
      document.querySelectorAll('.slide').length
    );

    console.log(`📸 [PPT] Screenshotting ${slideCount} slides...`);

    const screenshots = [];
    for (let i = 0; i < slideCount; i++) {
      const slideEl = await page.$$(`.slide`);
      if (!slideEl[i]) continue;

      const box = await slideEl[i].boundingBox();
      const png = await page.screenshot({
        clip: { x: box.x, y: box.y, width: 1280, height: 720 },
        type: 'png',
      });
      screenshots.push(png);
      console.log(`  📸 Slide ${i + 1}/${slideCount} captured`);
    }

    return screenshots;
  } finally {
    if (browser) await browser.close();
  }
}

// ───────────────────────────────────────────────────────────────
// Build PPTX from slide screenshots
// ───────────────────────────────────────────────────────────────
async function buildPptxFromScreenshots(screenshots, title, outputPath) {
  const pres = new PptxGenJS();
  pres.layout  = 'LAYOUT_16x9';
  pres.title   = title;
  pres.subject = title;

  for (const png of screenshots) {
    const slide = pres.addSlide();
    const b64   = png.toString('base64');
    slide.addImage({
      data: `image/png;base64,${b64}`,
      x: 0, y: 0, w: 10, h: 5.625,
    });
  }

  await pres.writeFile({ fileName: outputPath });
  return screenshots.length;
}

// ───────────────────────────────────────────────────────────────
// Fallback: plain PPTX from slide content (no screenshots)
// ───────────────────────────────────────────────────────────────
async function buildFallbackPptx(title, slideContent, outputPath) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';

  const slides = slideContent.split(/\n(?=##\s)/m).filter(s => s.trim());

  // Title slide
  const ts = pres.addSlide();
  ts.background = { color: '0A0F1E' };
  ts.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:0.3, h:5.625, fill:{color:'0EA5E9'}, line:{color:'0EA5E9'} });
  ts.addText(title, { x:0.6, y:1.8, w:8.8, h:1.8, fontSize:38, bold:true, color:'FFFFFF', fontFace:'Calibri', margin:0 });
  ts.addText(new Date().toLocaleDateString('en-US',{year:'numeric',month:'long'}),
    { x:0.6, y:3.8, w:6, h:0.4, fontSize:14, color:'94A3B8', fontFace:'Calibri', margin:0 });

  for (const block of slides.slice(0, 8)) {
    const lines = block.trim().split('\n');
    const slideTitle = lines[0].replace(/^##\s+/, '').trim();
    const bullets = lines.slice(1).filter(l => l.trim()).map(l => l.replace(/^[-*]\s+/, '').trim());

    const s = pres.addSlide();
    s.background = { color: '0A0F1E' };
    s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.9, fill:{color:'0F172A'}, line:{color:'0F172A'} });
    s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:0.18, h:0.9, fill:{color:'0EA5E9'}, line:{color:'0EA5E9'} });
    s.addText(slideTitle, { x:0.35, y:0.1, w:9.3, h:0.72, fontSize:22, bold:true, color:'FFFFFF', fontFace:'Calibri', margin:0 });
    if (bullets.length) {
      const items = bullets.map((b,i) => ({ text:b, options:{color:'CBD5E1', fontSize:14, fontFace:'Calibri', bullet:true, breakLine:i<bullets.length-1} }));
      s.addText(items, { x:0.4, y:1.1, w:9.2, h:4.3, valign:'top', paraSpaceAfter:10, margin:[6,6,6,0] });
    }
  }

  await pres.writeFile({ fileName: outputPath });
  return Math.min(slides.length + 1, 9);
}

// ───────────────────────────────────────────────────────────────
// MAIN SERVICE
// ───────────────────────────────────────────────────────────────
const PptxService = {
  HTML_SLIDE_SYSTEM_PROMPT,

  // Build the prompt sent to AI for HTML generation
  buildHtmlPrompt({ slideContent, styleRequest, title, topic }) {
    const photoKeywords = (topic || title)
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 3)
      .join(',') || 'business,professional';

    return `${HTML_SLIDE_SYSTEM_PROMPT}

═══════════════════════════════════════
PRESENTATION TO BUILD
═══════════════════════════════════════
Title: "${title}"
Style: "${styleRequest}"
Primary photo keywords: "${photoKeywords}"

SLIDE CONTENT TO VISUALIZE:
${slideContent}

═══════════════════════════════════════
YOUR TASK
═══════════════════════════════════════
Create a stunning HTML presentation in the style: "${styleRequest}"

Rules:
- Match the EXACT slide structure from the content above (same titles, same sections)
- For each slide, choose the most fitting visual:
  • Data/numbers → SVG bar chart or donut chart with real numbers from the content
  • Process/steps → Timeline or flowchart diagram  
  • Comparisons → Two-column or grid layout
  • Key metrics → KPI stat cards
  • Overview/intro → Full-bleed photo with overlay
  • Architecture/layers → SVG layered diagram
- EVERY slide must have at minimum: a photo background OR chart/diagram OR infographic
- NO plain text-only slides
- Invent specific, realistic data for charts that fits the topic
- Photo keywords must match the slide topic specifically

Return ONLY the complete HTML. Start immediately with <!DOCTYPE html>`;
  },

  // Main generator: HTML → screenshots → PPTX
  async generate({ htmlCode, slideContent, title, outputDir, styleDesc }) {
    const safeTitle = title
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 40) || 'Presentation';
    const timestamp  = Date.now();
    const htmlFile   = path.join(outputDir, `${safeTitle}-${timestamp}.html`);
    const pptxFile   = path.join(outputDir, `${safeTitle}-${timestamp}.pptx`);

    // 1. Save HTML file (for in-chat preview)
    let cleanHtml = htmlCode
      .replace(/^```html\s*\n?/gm, '')
      .replace(/^```\s*$/gm, '')
      .trim();
    if (!cleanHtml.startsWith('<!DOCTYPE') && !cleanHtml.startsWith('<html')) {
      throw new Error('AI did not return valid HTML');
    }
    fs.writeFileSync(htmlFile, cleanHtml, 'utf8');
    console.log(`✅ [PPT] HTML saved: ${path.basename(htmlFile)}`);

    // 2. Screenshot slides via Puppeteer
    let slideCount = 0;
    let usedFallback = false;
    try {
      const screenshots = await screenshotSlides(htmlFile);
      if (screenshots.length === 0) throw new Error('No slides captured');
      slideCount = await buildPptxFromScreenshots(screenshots, title, pptxFile);
      console.log(`✅ [PPT] PPTX built from ${slideCount} screenshots`);
    } catch (err) {
      console.error('⚠️ [PPT] Puppeteer failed, using fallback:', err.message);
      slideCount = await buildFallbackPptx(title, slideContent, pptxFile);
      usedFallback = true;
    }

    return {
      htmlFile,
      pptxFile,
      htmlUrl:   `/api/files/${path.basename(htmlFile)}`,
      pptxUrl:   `/api/files/${path.basename(pptxFile)}`,
      pptxName:  path.basename(pptxFile),
      htmlName:  path.basename(htmlFile),
      slideCount,
      usedFallback,
      styleDesc,
    };
  },

  getStyleExamples() {
    return [
      { label: 'McKinsey / BCG',      example: 'style McKinsey consulting — navy, data charts, sharp typography' },
      { label: 'Apple Keynote',       example: 'style Apple Keynote — pure black, full-bleed photos, white text' },
      { label: 'Dark Futuristic',     example: 'style dark futuristic tech — black background, neon cyan, glowing charts' },
      { label: 'Startup Pitch',       example: 'style startup pitch deck — bold gradient, large KPI stats, investor-ready' },
      { label: 'Corporate Executive', example: 'style executive boardroom — deep navy, gold accents, formal' },
      { label: 'Warm Editorial',      example: 'style editorial magazine — terracotta, cream, organic photos' },
      { label: 'Finance / Bloomberg', example: 'style finance report — slate gray, gold, data-heavy charts' },
      { label: 'Nature / ESG',        example: 'style sustainability ESG — forest green, earthy photos, nature' },
      { label: 'Healthcare',          example: 'style medical report — clinical white, teal accents, clean tables' },
      { label: 'Bold Marketing',      example: 'style bold agency — high contrast, punchy, full-bleed photos' },
    ];
  },
};

export default PptxService;
