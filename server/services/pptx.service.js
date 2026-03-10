// server/services/pptx.service.js
// ─────────────────────────────────────────────────────────────
// AI-DRIVEN PPT Generator — Rich Visual Edition
// AI writes full PptxGenJS code with:
//   • Native bar/line/pie/doughnut charts
//   • Infographic shapes (progress bars, stat callouts, icon-like geometry)
//   • Real photos from Unsplash (free, no API key needed)
//   • Tables with styled headers
//   • Varied layouts per slide — never the same twice
// ─────────────────────────────────────────────────────────────

import PptxGenJS from 'pptxgenjs';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT — Teaches AI ALL visual capabilities
// ─────────────────────────────────────────────────────────────
export const PPTX_CODE_SYSTEM_PROMPT = `You are an elite presentation designer and JavaScript developer.
Generate complete, runnable PptxGenJS v3 ES-module code for a visually rich PowerPoint presentation.

════════════════════════════════════════════════
OUTPUT FORMAT — CRITICAL
════════════════════════════════════════════════
Return ONLY raw JavaScript. No markdown fences, no explanation, no prose.
Your entire response must be valid JavaScript that starts with:

import PptxGenJS from 'pptxgenjs';

export default async function buildPresentation(outputPath) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  // ... all slides ...
  await pres.writeFile({ fileName: outputPath });
}

════════════════════════════════════════════════
PPTXGENJS HARD RULES — violations corrupt the file
════════════════════════════════════════════════
1. NO "#" prefix in hex colors:          "FF0000" ✅   "#FF0000" ❌
2. NO 8-char hex for shadow opacity:     {color:"000000",opacity:0.15} ✅   {color:"00000026"} ❌
3. NO negative shadow offset:            offset:2 ✅   offset:-2 ❌
4. NO unicode bullet chars "•":          bullet:true ✅   "• text" ❌
5. NEVER reuse option objects across calls — PptxGenJS mutates them in-place.
   Always inline or recreate for every addShape/addText/addChart call.
   BAD:  const fill = {color:"FF0000"}; addShape(...,{fill}); addShape(...,{fill}); // 2nd call is corrupt
   GOOD: addShape(...,{fill:{color:"FF0000"}}); addShape(...,{fill:{color:"FF0000"}});
6. ROUNDED_RECTANGLE + rectangular accent bar = corner mismatch → use RECTANGLE instead
7. breakLine:true required between array text runs
8. All coords must stay in bounds: x+w ≤ 10, y+h ≤ 5.625 (LAYOUT_16x9)
9. Chart data: values must be numbers, labels must be strings

════════════════════════════════════════════════
SLIDE DIMENSIONS
════════════════════════════════════════════════
LAYOUT_16x9 = 10.0" wide × 5.625" tall. All coordinates in inches.
Minimum margin from slide edge: 0.3"

════════════════════════════════════════════════
VISUAL TOOLKIT — use ALL of these across slides
════════════════════════════════════════════════

── 1. NATIVE CHARTS ────────────────────────────
Use real chart data that matches the slide topic. Make data plausible and specific.

// Bar chart (vertical columns)
slide.addChart(pres.charts.BAR, [{
  name: "Revenue", labels: ["Q1","Q2","Q3","Q4"], values: [4200,5800,6100,7400]
}], {
  x: 0.4, y: 1.2, w: 9.2, h: 3.8, barDir: "col",
  chartColors: ["1E3A8A","3B82F6","93C5FD"],
  chartArea: { fill: { color: "FFFFFF" }, roundedCorners: true },
  catAxisLabelColor: "64748B", valAxisLabelColor: "64748B",
  valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" },
  showValue: true, dataLabelColor: "1E293B", dataLabelFontSize: 10,
  showLegend: false,
});

// Line chart (trends)
slide.addChart(pres.charts.LINE, [{
  name: "Growth", labels: ["Jan","Feb","Mar","Apr","May","Jun"], values: [42,55,61,58,70,84]
}], {
  x: 0.4, y: 1.2, w: 9.2, h: 3.8,
  chartColors: ["0EA5E9"],
  chartArea: { fill: { color: "FFFFFF" } },
  lineSize: 3, lineSmooth: true,
  catAxisLabelColor: "64748B", valAxisLabelColor: "64748B",
  valGridLine: { color: "E2E8F0" }, catGridLine: { style: "none" },
  showValue: false, showLegend: false,
});

// Pie / Doughnut chart
slide.addChart(pres.charts.DOUGHNUT, [{
  name: "Distribution", labels: ["Category A","Category B","Category C","Other"],
  values: [38, 29, 21, 12]
}], {
  x: 2.5, y: 0.9, w: 5, h: 4.2,
  chartColors: ["1E3A8A","0EA5E9","38BDF8","BAE6FD"],
  showPercent: true, showLegend: true, legendPos: "b",
  dataLabelFontSize: 12, dataLabelColor: "1E293B",
  chartArea: { fill: { color: "F8FAFC" } },
});

── 2. INFOGRAPHIC SHAPES ────────────────────────
Build visual elements entirely from shapes — no external assets needed.

// Progress bars (one per metric)
function addProgressBar(slide, x, y, w, label, pct, color, bgColor) {
  // Background track
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h:0.18, fill:{color:bgColor}, line:{color:bgColor} });
  // Filled portion
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w: w * (pct/100), h:0.18, fill:{color}, line:{color} });
  // Label + percentage
  slide.addText(label, { x, y:y+0.22, w:w*0.7, h:0.22, fontSize:11, color:"475569", fontFace:"Calibri", margin:0 });
  slide.addText(pct+"%", { x:x+w*0.72, y:y+0.22, w:w*0.28, h:0.22, fontSize:11, bold:true, color, fontFace:"Calibri", align:"right", margin:0 });
}
// Usage:
addProgressBar(slide, 0.6, 1.5, 4.0, "Project Alpha", 87, "0EA5E9", "E0F2FE");
addProgressBar(slide, 0.6, 2.1, 4.0, "Project Beta",  64, "10B981", "D1FAE5");
addProgressBar(slide, 0.6, 2.7, 4.0, "Project Gamma", 41, "F59E0B", "FEF3C7");

// KPI stat boxes (3 or 4 across)
function addKpiBox(slide, pres, x, y, w, h, value, label, color, bgColor) {
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill:{color:bgColor}, line:{color:"E2E8F0",width:0.5},
    shadow:{type:"outer",blur:6,offset:2,angle:135,color:"000000",opacity:0.08} });
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h:0.08, fill:{color}, line:{color} });
  slide.addText(value, { x, y:y+0.25, w, h:0.8, fontSize:38, bold:true, fontFace:"Georgia", color, align:"center", margin:0 });
  slide.addText(label, { x, y:y+h-0.45, w, h:0.35, fontSize:11, fontFace:"Calibri", color:"475569", align:"center", margin:0 });
}
// Usage (4 boxes):
addKpiBox(slide, pres, 0.3, 1.3, 2.1, 1.7, "$4.2M",  "Total Revenue",  "1E3A8A", "F8FAFC");
addKpiBox(slide, pres, 2.6, 1.3, 2.1, 1.7, "94%",    "Client Retention","10B981","F0FDF4");
addKpiBox(slide, pres, 4.9, 1.3, 2.1, 1.7, "3,840",  "Units Delivered", "F59E0B","FFFBEB");
addKpiBox(slide, pres, 7.2, 1.3, 2.1, 1.7, "↑ 12%",  "YoY Growth",      "0EA5E9","F0F9FF");

// Timeline / process steps (horizontal)
function addTimeline(slide, pres, steps, colors, y) {
  const n = steps.length;
  const boxW = 9.0 / n;
  steps.forEach((step, i) => {
    const x = 0.5 + i * boxW;
    const col = colors[i % colors.length];
    // Connector line
    if (i < n-1) slide.addShape(pres.shapes.LINE, {
      x: x + boxW - 0.05, y: y + 0.35, w: 0.1, h: 0,
      line: {color:"CBD5E1", width:1.5}
    });
    // Step box
    slide.addShape(pres.shapes.RECTANGLE, { x, y, w: boxW - 0.15, h: 1.1,
      fill:{color:col}, line:{color:col},
      shadow:{type:"outer",blur:5,offset:2,angle:135,color:"000000",opacity:0.1} });
    // Number badge
    slide.addShape(pres.shapes.OVAL, { x: x + (boxW-0.15)/2 - 0.22, y: y - 0.22, w: 0.44, h: 0.44,
      fill:{color:"FFFFFF"}, line:{color:col,width:2} });
    slide.addText(String(i+1), { x: x + (boxW-0.15)/2 - 0.22, y: y - 0.22, w: 0.44, h: 0.44,
      fontSize:12, bold:true, color:col, align:"center", valign:"middle", margin:0 });
    slide.addText(step.title, { x: x+0.08, y: y+0.1, w: boxW-0.3, h: 0.35,
      fontSize:11, bold:true, color:"FFFFFF", align:"center", fontFace:"Calibri", margin:0 });
    if (step.desc) slide.addText(step.desc, { x: x+0.08, y: y+0.5, w: boxW-0.3, h: 0.5,
      fontSize:9, color:"FFFFFF", align:"center", fontFace:"Calibri", margin:0 });
  });
}

// Comparison two-column with colored headers
function addComparisonColumns(slide, pres, left, right, leftColor, rightColor) {
  // Left card
  slide.addShape(pres.shapes.RECTANGLE, {x:0.3, y:1.1, w:4.5, h:4.2,
    fill:{color:"FFFFFF"}, line:{color:"E2E8F0",width:0.5},
    shadow:{type:"outer",blur:6,offset:2,angle:135,color:"000000",opacity:0.07}});
  slide.addShape(pres.shapes.RECTANGLE, {x:0.3, y:1.1, w:4.5, h:0.55, fill:{color:leftColor}, line:{color:leftColor}});
  slide.addText(left.title, {x:0.35, y:1.12, w:4.4, h:0.5, fontSize:14, bold:true, color:"FFFFFF", fontFace:"Calibri", align:"center", margin:0});
  const leftItems = left.items.map((t,i)=>({text:t, options:{color:"1E293B",fontSize:12,fontFace:"Calibri",bullet:true,breakLine:i<left.items.length-1}}));
  slide.addText(leftItems, {x:0.45, y:1.75, w:4.2, h:3.4, valign:"top", paraSpaceAfter:8, margin:[4,4,4,4]});
  // Right card
  slide.addShape(pres.shapes.RECTANGLE, {x:5.2, y:1.1, w:4.5, h:4.2,
    fill:{color:"FFFFFF"}, line:{color:"E2E8F0",width:0.5},
    shadow:{type:"outer",blur:6,offset:2,angle:135,color:"000000",opacity:0.07}});
  slide.addShape(pres.shapes.RECTANGLE, {x:5.2, y:1.1, w:4.5, h:0.55, fill:{color:rightColor}, line:{color:rightColor}});
  slide.addText(right.title, {x:5.25, y:1.12, w:4.4, h:0.5, fontSize:14, bold:true, color:"FFFFFF", fontFace:"Calibri", align:"center", margin:0});
  const rightItems = right.items.map((t,i)=>({text:t, options:{color:"1E293B",fontSize:12,fontFace:"Calibri",bullet:true,breakLine:i<right.items.length-1}}));
  slide.addText(rightItems, {x:5.3, y:1.75, w:4.2, h:3.4, valign:"top", paraSpaceAfter:8, margin:[4,4,4,4]});
}

── 3. PHOTOS FROM UNSPLASH ──────────────────────
Use landscape photos as full or half-slide backgrounds.
Unsplash Source API — always available, no key needed:
  https://source.unsplash.com/1600x900/?{keyword1},{keyword2}

Example keywords by topic:
  business meeting → "office,business,team"
  technology       → "technology,computer,digital"
  finance          → "finance,money,charts"
  nature/ESG       → "nature,forest,sustainability"
  construction     → "construction,engineering,building"
  healthcare       → "hospital,medical,healthcare"
  energy           → "energy,solar,power"
  manufacturing    → "factory,manufacturing,industrial"

// Full-bleed background photo with dark overlay
slide.background = { path: "https://source.unsplash.com/1600x900/?office,business" };
slide.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:5.625,
  fill:{color:"000000", transparency:45}, line:{color:"000000",transparency:45} });

// Half-slide photo (right side), content on left
slide.addImage({
  path: "https://source.unsplash.com/800x600/?technology,digital",
  x: 5.2, y: 0, w: 4.8, h: 5.625,
  sizing: { type: "cover", w: 4.8, h: 5.625 }
});
// Subtle overlay on photo side
slide.addShape(pres.shapes.RECTANGLE, { x:5.2, y:0, w:4.8, h:5.625,
  fill:{color:"000000", transparency:60}, line:{color:"000000",transparency:60} });

// Photo in a card/frame
slide.addImage({
  path: "https://source.unsplash.com/800x500/?engineering,project",
  x: 5.4, y: 1.3, w: 4.2, h: 2.8,
  sizing: { type: "cover", w: 4.2, h: 2.8 }
});

── 4. TABLES ────────────────────────────────────
slide.addTable([
  [
    {text:"Project",  options:{bold:true, fill:{color:"1E3A8A"}, color:"FFFFFF", fontSize:11}},
    {text:"Status",   options:{bold:true, fill:{color:"1E3A8A"}, color:"FFFFFF", fontSize:11}},
    {text:"Progress", options:{bold:true, fill:{color:"1E3A8A"}, color:"FFFFFF", fontSize:11}},
    {text:"Due Date", options:{bold:true, fill:{color:"1E3A8A"}, color:"FFFFFF", fontSize:11}},
  ],
  ["Alpha Pipeline", "On Track", "87%", "Dec 2025"],
  ["Beta Upgrade",   "At Risk",  "42%", "Nov 2025"],
  ["Gamma Launch",   "Complete", "100%","Sep 2025"],
], {
  x: 0.4, y: 1.3, w: 9.2, colW: [3.2, 1.8, 1.8, 2.4],
  border: { type:"solid", pt:0.5, color:"E2E8F0" },
  autoPage: false,
  fontSize: 11, fontFace: "Calibri",
  align: "left",
  rowH: 0.42,
});

── 5. ICON-LIKE ELEMENTS ────────────────────────
Build icons from basic shapes (no external icon library needed):

// Checkmark circle
slide.addShape(pres.shapes.OVAL, {x:0.5, y:1.5, w:0.5, h:0.5, fill:{color:"10B981"}, line:{color:"10B981"}});
slide.addText("✓", {x:0.5, y:1.5, w:0.5, h:0.5, fontSize:16, bold:true, color:"FFFFFF", align:"center", valign:"middle", margin:0});

// Warning diamond (rotated square)
slide.addShape(pres.shapes.RECTANGLE, {x:0.5, y:1.5, w:0.4, h:0.4, fill:{color:"F59E0B"}, line:{color:"F59E0B"}, rotate:45});
slide.addText("!", {x:0.5, y:1.52, w:0.4, h:0.36, fontSize:14, bold:true, color:"FFFFFF", align:"center", margin:0});

// Numbered circle
slide.addShape(pres.shapes.OVAL, {x:0.4, y:1.4, w:0.55, h:0.55, fill:{color:"1E3A8A"}, line:{color:"1E3A8A"}});
slide.addText("1", {x:0.4, y:1.4, w:0.55, h:0.55, fontSize:18, bold:true, color:"FFFFFF", align:"center", valign:"middle", margin:0});

════════════════════════════════════════════════
DESIGN RULES
════════════════════════════════════════════════

PALETTE: Choose 3 colors specifically designed for this topic & style.
  - Dominant (60-70%), Support, Sharp Accent
  - Never default to generic blue — pick what fits the mood

FONTS: Interesting pairings — vary per style:
  Georgia+Calibri (authority), Trebuchet MS+Calibri (modern),
  Arial Black+Arial (bold), Cambria+Calibri (classic), Palatino+Garamond (luxury)

LAYOUT VARIETY — each slide MUST use a different layout:
  Slide 1 (Title):   Full photo background + overlay + large title
  Slide 2:           KPI stat boxes (3-4 across)
  Slide 3:           Half-photo split + bullet content
  Slide 4:           Native chart (bar/line matching the data)
  Slide 5:           Progress bars infographic
  Slide 6:           Timeline / process steps
  Slide 7:           Comparison two-column OR table
  Slide 8:           Doughnut/pie chart + insight text
  Slide N (Closing): Full photo background + overlay + "Thank You"

EVERY slide must have at least one of: photo, chart, infographic shape, or decorative geometry.
NO plain white slides with only text bullets.

CHART DATA: Invent plausible, specific data that fits the slide topic. Use real-looking numbers.
PHOTO KEYWORDS: Match keywords precisely to slide topic for relevant Unsplash photos.

FONT SIZES:
  Title slide heading: 42-48pt bold
  Section/slide titles: 22-28pt bold  
  Body / bullets: 12-14pt
  Captions / KPI labels: 9-11pt
  KPI values: 36-48pt bold

════════════════════════════════════════════════
NOW GENERATE THE CODE
════════════════════════════════════════════════
Output ONLY the JavaScript code. Start immediately with:
import PptxGenJS from 'pptxgenjs';`;

// ─────────────────────────────────────────────────────────────
// Parse slide content (for fallback)
// ─────────────────────────────────────────────────────────────
function parseSlides(content) {
  const slides = [];
  const chunks = content.split(/\n(?=#{1,3}\s|---+)/i).filter(c => c.trim().length > 0);
  for (const chunk of chunks) {
    const lines = chunk.trim().split('\n').filter(l => l.trim());
    if (!lines.length) continue;
    let title = '', bodyLines = [];
    for (const line of lines) {
      const t = line.trim();
      if (t.match(/^---+$/)) continue;
      const h = t.match(/^#{1,3}\s+(.+)/);
      const b = t.match(/^\*\*(.+)\*\*$/);
      if (!title && (h || b)) { title = (h ? h[1] : b[1]).trim(); }
      else if (t.length > 0) bodyLines.push(t);
    }
    if (!title && bodyLines.length > 0) title = bodyLines.shift();
    const bullets = [], paragraphs = [];
    for (const line of bodyLines) {
      const bm = line.match(/^[-*•]\s+(.+)/);
      const nm = line.match(/^\d+\.\s+(.+)/);
      if (bm) bullets.push(bm[1]);
      else if (nm) bullets.push(nm[1]);
      else if (line.trim()) paragraphs.push(line.trim());
    }
    if (title) slides.push({ title, bullets, paragraphs });
  }
  if (!slides.length) slides.push({ title: 'Presentation', bullets: [], paragraphs: [content.substring(0, 300)] });
  return slides;
}

// ─────────────────────────────────────────────────────────────
// FALLBACK static builder (when AI code execution fails)
// ─────────────────────────────────────────────────────────────
async function buildFallbackPresentation(title, slides, outputPath) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  const W = 10, H = 5.625;
  const COL = { dark: '0F2942', accent: 'E6A817', mid: '1E5799', light: 'F4F6F9', muted: '7BA7C4' };

  // Title slide with chart
  const ts = pres.addSlide();
  ts.background = { color: COL.dark };
  ts.addShape(pres.shapes.RECTANGLE, { x:0,y:0, w:0.28,h:H, fill:{color:COL.accent}, line:{color:COL.accent} });
  ts.addShape(pres.shapes.OVAL, { x:6.5,y:-1, w:5.5,h:5.5, fill:{color:COL.accent,transparency:90}, line:{color:COL.accent,transparency:90} });
  ts.addShape(pres.shapes.OVAL, { x:7.5,y:0.8, w:3,h:3, fill:{color:'FFFFFF',transparency:95}, line:{color:'FFFFFF',transparency:95} });
  ts.addText(title, { x:0.7,y:1.6, w:7.8,h:1.6, fontSize:40, bold:true, fontFace:'Georgia', color:'FFFFFF', margin:0 });
  ts.addShape(pres.shapes.RECTANGLE, { x:0.7,y:3.35, w:1.8,h:0.06, fill:{color:COL.accent}, line:{color:COL.accent} });
  ts.addText(new Date().toLocaleDateString('en-US',{year:'numeric',month:'long'}), { x:0.7,y:3.5, w:6,h:0.4, fontSize:13, color:COL.muted, fontFace:'Calibri', margin:0 });

  // Slide with chart (first content slide if data-like)
  if (slides.length > 1) {
    const cs = pres.addSlide();
    cs.background = { color: COL.light };
    cs.addShape(pres.shapes.RECTANGLE, { x:0,y:0, w:W,h:1.0, fill:{color:COL.dark}, line:{color:COL.dark} });
    cs.addShape(pres.shapes.RECTANGLE, { x:0,y:0, w:0.18,h:1.0, fill:{color:COL.accent}, line:{color:COL.accent} });
    cs.addText('Overview', { x:0.4,y:0.15, w:9,h:0.72, fontSize:24, bold:true, fontFace:'Georgia', color:'FFFFFF', margin:0 });
    // Add a sample bar chart
    cs.addChart(pres.charts.BAR, [{
      name:'Progress', labels:slides.slice(0,5).map(s=>s.title.substring(0,15)),
      values: slides.slice(0,5).map(()=>Math.floor(40+Math.random()*55))
    }], {
      x:0.4, y:1.1, w:9.2, h:4.2, barDir:'col',
      chartColors:[COL.mid,'0EA5E9','38BDF8','1D4ED8','7C3AED'],
      chartArea:{ fill:{color:'FFFFFF'}, roundedCorners:true },
      catAxisLabelColor:'64748B', valAxisLabelColor:'64748B',
      valGridLine:{color:'E2E8F0',size:0.5}, catGridLine:{style:'none'},
      showValue:true, dataLabelColor:'1E293B', dataLabelFontSize:10, showLegend:false,
    });
  }

  // Remaining content slides
  slides.forEach((slide, idx) => {
    if (idx === 0) return; // skip, already covered above
    const s = pres.addSlide();
    s.background = { color: COL.light };
    s.addShape(pres.shapes.RECTANGLE, { x:0,y:0, w:W,h:1.0, fill:{color:COL.dark}, line:{color:COL.dark} });
    s.addShape(pres.shapes.RECTANGLE, { x:0,y:0, w:0.18,h:1.0, fill:{color:COL.accent}, line:{color:COL.accent} });
    s.addText(slide.title, { x:0.4,y:0.15, w:9,h:0.72, fontSize:24, bold:true, fontFace:'Georgia', color:'FFFFFF', margin:0 });

    // Card
    s.addShape(pres.shapes.RECTANGLE, { x:0.35,y:1.15, w:9.3,h:4.15,
      fill:{color:'FFFFFF'}, line:{color:'E2E8F0',width:0.5},
      shadow:{type:'outer',blur:8,offset:2,angle:135,color:'000000',opacity:0.07}
    });
    s.addShape(pres.shapes.RECTANGLE, { x:0.35,y:1.15, w:0.1,h:4.15, fill:{color:COL.accent}, line:{color:COL.accent} });

    const items = [...(slide.bullets||[]), ...(slide.paragraphs||[])];
    if (items.length > 0) {
      const textItems = items.map((b,i) => ({
        text: b,
        options: { color:'1A2F45', fontSize:13, fontFace:'Calibri', bullet:true, breakLine: i < items.length-1 }
      }));
      s.addText(textItems, { x:0.6,y:1.3, w:8.9,h:3.9, valign:'top', paraSpaceAfter:9, margin:[8,8,8,0] });
    }

    s.addShape(pres.shapes.RECTANGLE, { x:0,y:5.33, w:W,h:0.3, fill:{color:COL.dark}, line:{color:COL.dark} });
    s.addText(`${idx+2} / ${slides.length+1}`, { x:8.5,y:5.34, w:1.3,h:0.24, fontSize:9, color:COL.muted, fontFace:'Calibri', align:'right', margin:0 });
    s.addText(title, { x:0.35,y:5.34, w:6,h:0.24, fontSize:9, color:COL.muted, fontFace:'Calibri', margin:0 });
  });

  // Closing
  const cs2 = pres.addSlide();
  cs2.background = { color: COL.dark };
  cs2.addShape(pres.shapes.OVAL, { x:-1.2,y:2.2, w:5,h:5, fill:{color:COL.accent,transparency:88}, line:{color:COL.accent,transparency:88} });
  cs2.addShape(pres.shapes.OVAL, { x:7.2,y:-0.8, w:4,h:4, fill:{color:COL.accent,transparency:85}, line:{color:COL.accent,transparency:85} });
  cs2.addShape(pres.shapes.RECTANGLE, { x:3.5,y:3.05, w:3,h:0.07, fill:{color:COL.accent}, line:{color:COL.accent} });
  cs2.addText('Thank You', { x:1,y:1.7, w:8,h:1.2, fontSize:44, bold:true, fontFace:'Georgia', color:'FFFFFF', align:'center', margin:0 });
  cs2.addText(title, { x:1,y:3.2, w:8,h:0.5, fontSize:14, color:COL.muted, fontFace:'Calibri', align:'center', margin:0 });

  await pres.writeFile({ fileName: outputPath });
  return slides.length + 2;
}

// ─────────────────────────────────────────────────────────────
// Execute AI-generated code via temp .mjs file
// ─────────────────────────────────────────────────────────────
async function executeAICode(code, outputPath) {
  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `pptx_${Date.now()}.mjs`);
  let cleanCode = '';
  try {
    cleanCode = code
      .replace(/^```(?:javascript|js|typescript)?\s*\n?/gm, '')
      .replace(/^```\s*$/gm, '')
      .trim();
    if (!cleanCode.includes('import PptxGenJS')) {
      cleanCode = `import PptxGenJS from 'pptxgenjs';\n${cleanCode}`;
    }
    fs.writeFileSync(tmpFile, cleanCode, 'utf8');
    const mod = await import(pathToFileURL(tmpFile).href);
    const buildFn = mod.default || mod.buildPresentation;
    if (typeof buildFn !== 'function') throw new Error('No default export function found');
    await buildFn(outputPath);
    return true;
  } catch (err) {
    // Log detail untuk debugging
    console.error('❌ [PptxService] AI code execution FAILED');
    console.error('   Error:', err.message);
    console.error('   Stack:', err.stack?.split('\n').slice(0, 5).join('\n   '));
    if (cleanCode) {
      const lines = cleanCode.split('\n');
      console.error(`   Generated code (first 40 lines):\n${lines.slice(0, 40).map((l, i) => `     ${i+1}: ${l}`).join('\n')}`);
      // Simpan file error agar bisa diinspeksi
      const errFile = path.join(tmpDir, `pptx_ERROR_${Date.now()}.mjs`);
      try { fs.writeFileSync(errFile, cleanCode, 'utf8'); console.error(`   Full code saved to: ${errFile}`); } catch {}
    }
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

  async generateFromAICode({ aiCode, fallbackContent, title, outputDir, styleDesc }) {
    const safeTitle = title.replace(/[^a-zA-Z0-9\s-]/g,'').replace(/\s+/g,'-').substring(0,40) || 'Presentation';
    const filename = `${safeTitle}-${Date.now()}.pptx`;
    const filepath = path.join(outputDir, filename);

    let slideCount = 0, usedFallback = false;
    const aiSuccess = await executeAICode(aiCode, filepath);

    if (!aiSuccess) {
      console.warn('⚠️ [PptxService] Falling back to static builder');
      const slides = parseSlides(fallbackContent || title);
      slideCount = await buildFallbackPresentation(title, slides, filepath);
      usedFallback = true;
    } else {
      try { slideCount = Math.max(6, Math.floor(fs.statSync(filepath).size / 40000)); } catch { slideCount = 8; }
    }
    console.log(`✅ [PptxService] "${filename}" | Style: ${styleDesc} | Fallback: ${usedFallback}`);
    return { filename, filepath, url: `/api/files/${filename}`, styleDesc, slideCount, usedFallback };
  },

  buildDesignPrompt({ slideContent, styleRequest, title, topic }) {
    // Derive photo keywords from topic
    const photoKeywords = (topic || title)
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 3)
      .join(',') || 'business,professional';

    return `${PPTX_CODE_SYSTEM_PROMPT}

═══════════════════════════════════════
PRESENTATION TO BUILD
═══════════════════════════════════════
Title: "${title}"
Style: "${styleRequest}"
Photo keywords for Unsplash: "${photoKeywords}"

SLIDE CONTENT:
${slideContent}

═══════════════════════════════════════
YOUR TASK
═══════════════════════════════════════
Design a stunning presentation based on the style "${styleRequest}".

For EVERY slide, choose the most appropriate visual approach:
- Data/metrics slides → native chart (addChart)
- Progress/status slides → progress bar infographic
- KPI slides → stat boxes
- Process/workflow slides → timeline
- Comparison slides → two-column cards
- Overview/intro slides → half-photo split layout
- Opening/closing → full photo background with overlay

IMPORTANT for photos:
- Use the Unsplash URL format: https://source.unsplash.com/1600x900/?{keywords}
- Vary keywords per slide to get different relevant photos
- Always add a semi-transparent dark overlay (transparency: 40-60) over photos before adding text

Generate the complete JavaScript code now. START IMMEDIATELY with "import PptxGenJS from 'pptxgenjs';"`;
  },

  getStyleExamples() {
    return [
      { label: 'McKinsey / BCG',         example: 'style McKinsey consulting deck — dark navy, sharp data charts, gold accents' },
      { label: 'Apple Keynote',           example: 'style Apple Keynote — pure black, cinematic full-bleed photos, white text' },
      { label: 'Google Material',         example: 'style Google Slides clean — white cards, colorful charts, material shadows' },
      { label: 'Dark Futuristic',         example: 'style dark futuristic tech — black background, neon cyan charts, glow effects' },
      { label: 'Startup Pitch',           example: 'style startup pitch deck — bold gradient, large KPI stats, investor-ready' },
      { label: 'Corporate Executive',     example: 'style executive boardroom — deep navy, gold, formal typography' },
      { label: 'Warm Editorial',          example: 'style editorial magazine — terracotta, cream, organic full-page photos' },
      { label: 'Finance / Bloomberg',     example: 'style finance report — slate gray, gold, data-heavy charts, Bloomberg feel' },
      { label: 'Nature / ESG',            example: 'style sustainability ESG — forest green, earthy photos, nature-inspired' },
      { label: 'Healthcare / Medical',    example: 'style medical report — clinical white, teal accents, clean data tables' },
      { label: 'Bold Marketing',          example: 'style bold ad agency — high contrast black/red, punchy full-bleed photos' },
      { label: 'Tech / SaaS Product',     example: 'style SaaS product deck — dark blue gradient, line charts, modern sans-serif' },
    ];
  },
};

export default PptxService;
export { parseSlides, buildFallbackPresentation };
