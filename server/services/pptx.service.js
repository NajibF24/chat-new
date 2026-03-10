// server/services/pptx.service.js
// ─────────────────────────────────────────────────────────────
// AI-DRIVEN PPT Generator
// The AI writes the full PptxGenJS code — unique layout, colors,
// typography, and geometry per request. No hardcoded templates.
// ─────────────────────────────────────────────────────────────

import PptxGenJS from 'pptxgenjs';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT — AI writes runnable PptxGenJS code
// ─────────────────────────────────────────────────────────────
export const PPTX_CODE_SYSTEM_PROMPT = `You are an elite presentation designer and JavaScript developer.
Generate complete, runnable PptxGenJS v3 code that produces a visually stunning PowerPoint file.

## OUTPUT FORMAT
Return ONLY raw JavaScript — no markdown fences, no explanation, no comments outside the code.
Structure:
  import PptxGenJS from 'pptxgenjs';
  export default async function buildPresentation(outputPath) {
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_16x9';
    // ... slides ...
    await pres.writeFile({ fileName: outputPath });
  }

## CRITICAL RULES (violations corrupt the file or crash)
1. NEVER prefix hex colors with "#" — use "FF0000" not "#FF0000"
2. NEVER encode opacity in hex — use opacity property: { color:"000000", opacity:0.15 } not { color:"00000026" }
3. shadow offset MUST be non-negative — negative values corrupt XML
4. NEVER use unicode bullets "•" — use bullet:true option only
5. NEVER reuse option objects across calls — PptxGenJS mutates objects in-place:
   BAD:  const shad = {type:"outer",blur:6,offset:2,color:"000000",opacity:0.12};
         slide.addShape(pres.shapes.RECTANGLE, {x:0,y:0,w:1,h:1, shadow:shad});
         slide.addShape(pres.shapes.RECTANGLE, {x:1,y:0,w:1,h:1, shadow:shad}); // ← corrupt
   GOOD: slide.addShape(pres.shapes.RECTANGLE, {x:0,y:0,w:1,h:1, shadow:{type:"outer",blur:6,offset:2,color:"000000",opacity:0.12}});
         slide.addShape(pres.shapes.RECTANGLE, {x:1,y:0,w:1,h:1, shadow:{type:"outer",blur:6,offset:2,color:"000000",opacity:0.12}});
6. ROUNDED_RECTANGLE + rectangular accent overlay = misaligned corners → use RECTANGLE instead
7. breakLine:true required between array text items
8. All elements must stay in bounds: x+w ≤ 10, y+h ≤ 5.625

## SLIDE DIMENSIONS
LAYOUT_16x9 = 10" wide × 5.625" tall. Use inches for all coordinates.

## DESIGN PHILOSOPHY — make it UNFORGETTABLE
Every deck must feel purpose-built for its topic and audience.

COLOR STRATEGY:
- Pick a palette designed for THIS specific topic — never generic blue
- One dominant color (60-70% presence), one support tone, one sharp accent
- "Dark sandwich": dark title + closing slide, light content slides (or fully dark for premium)

TYPOGRAPHY — interesting pairings only:
- Georgia + Calibri (editorial authority)
- Trebuchet MS + Calibri (modern professional)  
- Arial Black + Arial (bold impact)
- Cambria + Calibri (classic executive)
- Palatino + Garamond (luxury)
- Consolas + Calibri (tech/data)

LAYOUT VARIETY — each content slide MUST use a different layout:
- Left panel split: dark colored left 35-40%, content right 60-65%
- Stat row: 3-4 KPI boxes in a horizontal row with large numbers
- Two-column cards: two equal cards side by side
- Full-bleed header + content block with card
- Timeline: numbered boxes left to right
- Large quote or callout with geometric accent
- Icon grid: 2×2 or 2×3 colored blocks with labels

EVERY slide needs decorative shapes — accent bars, circles, rectangles. NO plain white text-only slides.
DO NOT put accent lines directly under title text — use background color blocks instead.

## FONT SIZES
- Presentation title: 38-44pt bold
- Slide titles: 24-30pt bold
- Body / bullets: 13-15pt
- Captions / labels: 9-11pt
- KPI numbers: 36-52pt bold

## BUILD ORDER
1. Title slide — full-color background, large title, subtitle, strong geometry
2-N. Content slides — varied layouts, strong visual hierarchy, no two slides the same layout
Last. Closing slide — mirrors title slide aesthetic, "Thank You" or summary

Output ONLY the code. Start with: import PptxGenJS from 'pptxgenjs';`;

// ─────────────────────────────────────────────────────────────
// Parse markdown content into slide objects (for fallback)
// ─────────────────────────────────────────────────────────────
function parseSlides(content) {
  const slides = [];
  const chunks = content.split(/\n(?=#{1,3}\s|---+)/i).filter(c => c.trim().length > 0);

  for (const chunk of chunks) {
    const lines = chunk.trim().split('\n').filter(l => l.trim());
    if (!lines.length) continue;
    let title = '';
    let bodyLines = [];

    for (const line of lines) {
      const t = line.trim();
      if (t.match(/^---+$/)) continue;
      const h = t.match(/^#{1,3}\s+(.+)/);
      const b = t.match(/^\*\*(.+)\*\*$/);
      if (!title && (h || b)) {
        title = (h ? h[1] : b[1]).trim();
      } else if (t.length > 0) {
        bodyLines.push(t);
      }
    }
    if (!title && bodyLines.length > 0) title = bodyLines.shift();
    const bullets = [];
    const paragraphs = [];
    for (const line of bodyLines) {
      const bm = line.match(/^[-*•]\s+(.+)/);
      const nm = line.match(/^\d+\.\s+(.+)/);
      if (bm) bullets.push(bm[1]);
      else if (nm) bullets.push(nm[1]);
      else if (line.trim()) paragraphs.push(line.trim());
    }
    if (title) slides.push({ title, bullets, paragraphs });
  }

  if (!slides.length) {
    slides.push({ title: 'Presentation', bullets: [], paragraphs: [content.substring(0, 300)] });
  }
  return slides;
}

// ─────────────────────────────────────────────────────────────
// FALLBACK: Static builder (used when AI code execution fails)
// ─────────────────────────────────────────────────────────────
async function buildFallbackPresentation(title, slides, outputPath) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  const W = 10, H = 5.625;

  // Title slide
  const ts = pres.addSlide();
  ts.background = { color: '0F2942' };
  ts.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.28, h: H, fill: { color: 'E6A817' }, line: { color: 'E6A817' } });
  ts.addShape(pres.shapes.OVAL, { x: 6.8, y: -1, w: 5, h: 5, fill: { color: 'E6A817', transparency: 90 }, line: { color: 'E6A817', transparency: 90 } });
  ts.addShape(pres.shapes.OVAL, { x: 7.8, y: 0.8, w: 3, h: 3, fill: { color: 'FFFFFF', transparency: 95 }, line: { color: 'FFFFFF', transparency: 95 } });
  ts.addText(title, { x: 0.7, y: 1.7, w: 7.8, h: 1.5, fontSize: 40, bold: true, fontFace: 'Georgia', color: 'FFFFFF', margin: 0 });
  ts.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 3.3, w: 1.8, h: 0.06, fill: { color: 'E6A817' }, line: { color: 'E6A817' } });
  ts.addText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' }), {
    x: 0.7, y: 3.5, w: 6, h: 0.4, fontSize: 13, color: '7BA7C4', fontFace: 'Calibri', margin: 0,
  });

  // Content slides
  slides.forEach((slide, idx) => {
    const s = pres.addSlide();
    s.background = { color: 'F4F6F9' };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 1.05, fill: { color: '0F2942' }, line: { color: '0F2942' } });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.18, h: 1.05, fill: { color: 'E6A817' }, line: { color: 'E6A817' } });
    s.addText(slide.title, { x: 0.4, y: 0.18, w: 9, h: 0.72, fontSize: 24, bold: true, fontFace: 'Georgia', color: 'FFFFFF', margin: 0 });

    // Content area card
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.35, y: 1.2, w: 9.3, h: 4.1,
      fill: { color: 'FFFFFF' },
      line: { color: 'E2E8F0', width: 0.5 },
      shadow: { type: 'outer', blur: 8, offset: 2, angle: 135, color: '000000', opacity: 0.07 },
    });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.35, y: 1.2, w: 0.1, h: 4.1, fill: { color: 'E6A817' }, line: { color: 'E6A817' } });

    const items = [...(slide.bullets || []), ...(slide.paragraphs || [])];
    if (items.length > 0) {
      const textItems = items.map((b, i) => ({
        text: b,
        options: { color: '1A2F45', fontSize: 14, fontFace: 'Calibri', bullet: true, breakLine: i < items.length - 1 },
      }));
      s.addText(textItems, { x: 0.65, y: 1.35, w: 8.8, h: 3.8, valign: 'top', paraSpaceAfter: 8, margin: [8, 8, 8, 0] });
    }

    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.35, w: W, h: 0.27, fill: { color: '0F2942' }, line: { color: '0F2942' } });
    s.addText(`${idx + 2} / ${slides.length + 2}`, { x: 8.5, y: 5.36, w: 1.3, h: 0.22, fontSize: 9, color: '7BA7C4', fontFace: 'Calibri', align: 'right', margin: 0 });
    s.addText(title, { x: 0.35, y: 5.36, w: 6, h: 0.22, fontSize: 9, color: '7BA7C4', fontFace: 'Calibri', margin: 0 });
  });

  // Closing slide
  const cs = pres.addSlide();
  cs.background = { color: '0F2942' };
  cs.addShape(pres.shapes.OVAL, { x: -1.2, y: 2.2, w: 5, h: 5, fill: { color: 'E6A817', transparency: 88 }, line: { color: 'E6A817', transparency: 88 } });
  cs.addShape(pres.shapes.OVAL, { x: 7.2, y: -0.8, w: 4, h: 4, fill: { color: 'E6A817', transparency: 85 }, line: { color: 'E6A817', transparency: 85 } });
  cs.addShape(pres.shapes.RECTANGLE, { x: 3.5, y: 3.05, w: 3, h: 0.07, fill: { color: 'E6A817' }, line: { color: 'E6A817' } });
  cs.addText('Thank You', { x: 1, y: 1.7, w: 8, h: 1.2, fontSize: 44, bold: true, fontFace: 'Georgia', color: 'FFFFFF', align: 'center', margin: 0 });
  cs.addText(title, { x: 1, y: 3.2, w: 8, h: 0.5, fontSize: 14, color: '7BA7C4', fontFace: 'Calibri', align: 'center', margin: 0 });

  await pres.writeFile({ fileName: outputPath });
  return slides.length + 2;
}

// ─────────────────────────────────────────────────────────────
// Execute AI-generated code in a temp .mjs file
// ─────────────────────────────────────────────────────────────
async function executeAICode(code, outputPath) {
  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const tmpFile = path.join(tmpDir, `pptx_${Date.now()}.mjs`);

  try {
    // Strip markdown fences if AI accidentally included them
    let cleanCode = code
      .replace(/^```(?:javascript|js|typescript)?\s*\n?/gm, '')
      .replace(/^```\s*$/gm, '')
      .trim();

    // Ensure ES module import is present
    if (!cleanCode.includes('import PptxGenJS')) {
      cleanCode = `import PptxGenJS from 'pptxgenjs';\n${cleanCode}`;
    }

    fs.writeFileSync(tmpFile, cleanCode, 'utf8');

    const fileUrl = pathToFileURL(tmpFile).href;
    const mod = await import(fileUrl);
    const buildFn = mod.default || mod.buildPresentation;

    if (typeof buildFn !== 'function') {
      throw new Error('No default export function found in AI-generated code');
    }

    await buildFn(outputPath);
    return true;
  } catch (err) {
    console.error('❌ [PptxService] AI code execution error:', err.message);
    // Log first 500 chars of code for debugging
    if (code) console.error('   Code preview:', code.substring(0, 500));
    return false;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN SERVICE
// ─────────────────────────────────────────────────────────────
const PptxService = {

  PPTX_CODE_SYSTEM_PROMPT,

  /**
   * Generate PPTX from AI-written PptxGenJS code
   * Falls back to static builder if AI code fails
   */
  async generateFromAICode({ aiCode, fallbackContent, title, outputDir, styleDesc }) {
    const safeTitle = title
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 40) || 'Presentation';
    const filename = `${safeTitle}-${Date.now()}.pptx`;
    const filepath = path.join(outputDir, filename);

    let slideCount = 0;
    let usedFallback = false;

    // ── Try AI code first ────────────────────────────────────
    const aiSuccess = await executeAICode(aiCode, filepath);

    if (!aiSuccess) {
      // ── Fallback: static builder ─────────────────────────
      console.warn('⚠️  [PptxService] Using fallback builder');
      const slides = parseSlides(fallbackContent || title);
      slideCount = await buildFallbackPresentation(title, slides, filepath);
      usedFallback = true;
    } else {
      try {
        const stats = fs.statSync(filepath);
        // Rough estimate: typical slide ~30-50KB
        slideCount = Math.max(5, Math.floor(stats.size / 40000));
      } catch { slideCount = 6; }
    }

    console.log(`✅ [PptxService] "${filename}" | Style: ${styleDesc} | Fallback: ${usedFallback}`);

    return { filename, filepath, url: `/api/files/${filename}`, styleDesc, slideCount, usedFallback };
  },

  /**
   * Build the design prompt sent to AI to generate PptxGenJS code
   */
  buildDesignPrompt({ slideContent, styleRequest, title }) {
    return `${PPTX_CODE_SYSTEM_PROMPT}

---
## PRESENTATION BRIEF

**Title:** "${title}"
**Style:** "${styleRequest}"

Based on this style description, choose a completely original:
- Color palette (3 colors: dominant + support + accent). Match the mood of "${styleRequest}".
- Font pairing (header font + body font). NO Arial for titles.
- Layout for each slide — every slide must use a different layout from the variety list above.

**Slide content to build:**
${slideContent}

---
Generate the complete PptxGenJS code now. Return ONLY raw JavaScript, nothing else.`;
  },

  /**
   * Style inspiration list shown to users
   */
  getStyleExamples() {
    return [
      { label: 'McKinsey / BCG Consulting',     example: 'style McKinsey — clean navy, sharp typography, data-forward' },
      { label: 'Apple Keynote Minimal',          example: 'style Apple Keynote — pure black/white, cinematic, large text' },
      { label: 'Google Material Design',         example: 'style Google Material — colorful, clean, card-based' },
      { label: 'Dark Futuristic / Tech',         example: 'style dark futuristic — near-black background, neon cyan accents' },
      { label: 'Startup Pitch Deck',             example: 'style startup pitch — bold gradient, high energy, investor-ready' },
      { label: 'Corporate Executive Board',      example: 'style executive corporate — deep navy, gold accents, formal' },
      { label: 'Warm Editorial / Agency',        example: 'style warm editorial — terracotta, cream, magazine aesthetic' },
      { label: 'Ultra Minimal White',            example: 'style ultra minimal — all white, hairline typography, no decoration' },
      { label: 'Bold Marketing / Ad Agency',     example: 'style bold red marketing — strong contrast, aggressive, punchy' },
      { label: 'Nature / Sustainability / ESG',  example: 'style nature sustainability — forest green, earthy, organic feel' },
      { label: 'Finance / Investment Report',    example: 'style finance report — slate gray, gold, Bloomberg terminal feel' },
      { label: 'Healthcare / Medical',           example: 'style healthcare clean — clinical white, teal, trustworthy' },
    ];
  },
};

export default PptxService;
export { parseSlides, buildFallbackPresentation };