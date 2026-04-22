// server/services/pptx.service.js
// ============================================================
// GYS Portal AI — Native PPTX Service
// ✅ PATCH v1.5.0:
//   1. OVERFLOW HARDENING: Every text zone has a strict pixel budget
//      enforced by calcFontSize + bulletFontSize + truncateText
//   2. STATUS_SLIDE ZONES: All 5 sub-zones (header, panels, timeline,
//      issue card) have explicit Y-budget guards — nothing bleeds out
//   3. autoFit: true on ALL multi-line text boxes — PptxGenJS shrinks
//      text automatically as a final safety net
//   4. CONTENT slide image layout recalculated to avoid overlap
//   5. Timeline speech bubble Y-anchor fixed to never cover header
//   6. Issue card bullets use column layout when > 3 items
//   7. All v1.3.0 image placement logic preserved
// ============================================================

import PptxGenJS from "pptxgenjs";
import path from "path";
import fs from "fs";
import JSZip from "jszip";

export const HTML_SLIDE_SYSTEM_PROMPT = "";

// ────────────────────────────────────────────────────────────
// GYS BRAND TOKENS (defaults)
// ────────────────────────────────────────────────────────────
const GYS_DEFAULTS = {
  teal:         "006A4E",
  tealDark:     "004D38",
  tealMid:      "007857",
  tealAccent:   "00A878",
  tealLight:    "E8F5F0",
  white:        "FFFFFF",
  offWhite:     "F8FAFC",
  cardWhite:    "FFFFFF",
  darkText:     "111827",
  bodyText:     "374151",
  mutedText:    "6B7280",
  grayBorder:   "E5E7EB",
  grayFoot:     "1F2937",
  chartColors:  ["006A4E", "00A878", "4CAF87", "A8D8C8", "D1EDE5", "F0F9F5"],
  fontTitle:    "Calibri",
  fontBody:     "Calibri",
  slideW:       10,
  slideH:       5.625,
};

// ────────────────────────────────────────────────────────────
// ✅ v1.5.0 — Stricter font size helpers
//
// calcFontSize: scales down proportionally based on character count
//   vs the "comfortable" maxChars threshold, with a hard minFontSize floor.
//
// calcFontSizeByArea: scales based on estimated rendered area
//   (characters × lines) vs available box area. More accurate for
//   multi-line text boxes.
//
// bulletFontSize: estimates total line count and scales to fit containerH.
//
// truncateText: hard-clips text with ellipsis as last resort.
// ────────────────────────────────────────────────────────────

function calcFontSize(text, maxChars, baseFontSize, minFontSize = 8) {
  if (!text) return baseFontSize;
  const len = String(text).length;
  if (len <= maxChars) return baseFontSize;
  // Aggressive scaling: reduce more steeply for very long text
  const ratio   = maxChars / len;
  const reduced = Math.floor(baseFontSize * Math.sqrt(ratio));
  return Math.max(minFontSize, reduced);
}

/**
 * calcFontSizeByArea — fits text into a bounding box (in inches).
 * Estimates character columns and line height at baseFontSize,
 * computes total lines needed, then scales down if overflowing.
 */
function calcFontSizeByArea(text, boxW, boxH, baseFontSize, minFontSize = 7) {
  if (!text) return baseFontSize;
  const s = String(text);
  // Approximate characters per line at baseFontSize in a boxW-inch container
  // Rule of thumb: 1pt ≈ 0.0138 inches; chars per line = boxW / (fontSize * 0.007)
  const charsPerLine = Math.max(10, Math.floor(boxW / (baseFontSize * 0.007)));
  const lineHeightIn = (baseFontSize / 72) * 1.4; // 1.4× leading
  const totalLines   = Math.ceil(s.length / charsPerLine);
  const neededH      = totalLines * lineHeightIn;
  if (neededH <= boxH) return baseFontSize;
  // Scale font down so neededH fits in boxH
  const scaleFactor  = boxH / neededH;
  const scaled       = Math.floor(baseFontSize * scaleFactor);
  return Math.max(minFontSize, scaled);
}

function truncateText(text, maxLen) {
  if (!text) return '';
  const s = String(text);
  return s.length > maxLen ? s.substring(0, maxLen - 1) + '…' : s;
}

/**
 * bulletFontSize — fits a list of bullets into a container of height containerH (inches).
 * Counts estimated lines (wrapping long bullets) and scales font to fit.
 */
function bulletFontSize(bullets = [], containerH = 4.2, baseSize = 16, minSize = 9, containerW = 9.0) {
  if (!bullets.length) return baseSize;
  // chars per line at baseSize in containerW
  const charsPerLine = Math.max(10, Math.floor(containerW / (baseSize * 0.007)));
  const lineH        = (baseSize / 72) * 1.4;
  let totalLines     = 0;
  for (const b of bullets) {
    const chars = String(b).length;
    totalLines += Math.max(1, Math.ceil(chars / charsPerLine));
  }
  // Add spacing between bullets (~0.12in per bullet gap)
  const spacingH = bullets.length * (baseSize / 72) * 0.35;
  const neededH  = totalLines * lineH + spacingH;
  if (neededH <= containerH) return baseSize;
  const scale  = containerH / neededH;
  const scaled = Math.floor(baseSize * scale);
  return Math.max(minSize, scaled);
}

// ────────────────────────────────────────────────────────────
// TEMPLATE PARSER
// ────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
// Helper: resolve a relationship rId → image base64 from a zip
// basePath is the folder of the XML file (e.g. 'ppt/slides')
// ────────────────────────────────────────────────────────────
async function resolveRelsImage(zip, xmlFilePath, rId) {
  // Build the .rels path: ppt/slides/_rels/slide1.xml.rels
  const parts    = xmlFilePath.split('/');
  const fileName = parts.pop();
  const relsPath = [...parts, '_rels', `${fileName}.rels`].join('/');

  if (!zip.files[relsPath]) return null;

  const relsXml  = await zip.files[relsPath].async('string');
  const relMatch = relsXml.match(new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`));
  if (!relMatch) return null;

  let imgPath = relMatch[1];
  // Resolve relative path from the XML file's folder
  if (!imgPath.startsWith('ppt/')) {
    imgPath = [...parts, imgPath].join('/');
  }
  // Normalize ../  sequences
  const resolved = [];
  for (const seg of imgPath.split('/')) {
    if (seg === '..') resolved.pop();
    else if (seg && seg !== '.') resolved.push(seg);
  }
  imgPath = resolved.join('/');

  // Case-insensitive lookup in zip
  const imgKey = Object.keys(zip.files).find(k =>
    k.toLowerCase() === imgPath.toLowerCase() ||
    k.toLowerCase().endsWith('/' + imgPath.toLowerCase().split('/').pop())
  );
  if (!imgKey) return null;

  const imgData = await zip.files[imgKey].async('base64');
  const ext     = imgKey.split('.').pop().toLowerCase();
  return { data: imgData, ext: ext === 'jpg' ? 'jpeg' : (ext || 'png'), key: imgKey };
}

// ────────────────────────────────────────────────────────────
// Helper: extract background (image or solid color) from a
// slide/layout/master XML string + its zip + its file path.
// Returns { bgImageData, bgImageExt, bgColor, hasTemplateBg }
// ────────────────────────────────────────────────────────────
async function extractBgFromXml(zip, xmlFilePath, xml) {
  const result = { bgImageData: null, bgImageExt: 'png', bgColor: null, hasTemplateBg: false };

  // Background image via blipFill
  const blipMatch = xml.match(/<p:bg[\s\S]*?<a:blip\s[^>]*r:embed="([^"]+)"/);
  if (blipMatch) {
    const img = await resolveRelsImage(zip, xmlFilePath, blipMatch[1]);
    if (img) {
      result.bgImageData   = img.data;
      result.bgImageExt    = img.ext;
      result.hasTemplateBg = true;
      console.log(`[PPT Template] Slide bg image from ${xmlFilePath}: ${img.key}`);
      return result;
    }
  }

  // Solid fill color
  const solidMatch = xml.match(/<p:bg[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
  if (solidMatch) {
    result.bgColor       = solidMatch[1].toUpperCase();
    result.hasTemplateBg = true;
    return result;
  }

  return result;
}

async function extractTemplateTheme(pptxFilePath) {
  const theme = {
    ...GYS_DEFAULTS,
    // Per-slide backgrounds extracted from the template's actual slides:
    //   slide1Bg — used for TITLE / SECTION / CLOSING layouts
    //   slide2Bg — used for all other content layouts
    // Each is: { bgImageData, bgImageExt, bgColor, hasTemplateBg }
    slide1Bg: null,
    slide2Bg: null,
    // Legacy single-bg fields (kept for applyTemplateBackground fallback)
    bgImageData:    null,
    bgImageExt:     'png',
    bgColor:        null,
    hasTemplateBg:  false,
  };

  try {
    if (!pptxFilePath || !fs.existsSync(pptxFilePath)) return theme;

    const data = fs.readFileSync(pptxFilePath);
    const zip  = await JSZip.loadAsync(data);

    // ── 1. Extract accent colors and fonts from theme XML ─────
    const themeFiles = Object.keys(zip.files).filter(f =>
      f.match(/ppt\/theme\/theme\d*\.xml$/)
    );

    if (themeFiles.length > 0) {
      const themeXml = await zip.files[themeFiles[0]].async('string');

      const accentMatches = themeXml.matchAll(/<a:accent\d[^>]*>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/g);
      const accents = [];
      for (const m of accentMatches) accents.push(m[1].toUpperCase());

      if (accents.length > 0) {
        theme.teal        = accents[0];
        theme.tealAccent  = accents[1] || accents[0];
        theme.chartColors = accents.slice(0, 6).length >= 2
          ? accents.slice(0, 6)
          : [accents[0], accents[0] + '88', accents[0] + '55', 'CCCCCC', 'AAAAAA', '888888'];
      }

      const dk1Match = themeXml.match(/<a:dk1>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
      const lt1Match = themeXml.match(/<a:lt1>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
      if (dk1Match) theme.darkText = dk1Match[1].toUpperCase();
      if (lt1Match) theme.white    = lt1Match[1].toUpperCase();

      const fontMatch = themeXml.match(/<a:latin\s+typeface="([^"]+)"/);
      if (fontMatch) {
        theme.fontTitle = fontMatch[1];
        theme.fontBody  = fontMatch[1];
      }
    }

    // ── 2. Extract per-slide backgrounds from the template's actual slides ──
    // Sort slide files numerically so slide1 < slide2 < slide3 ...
    const slideFiles = Object.keys(zip.files)
      .filter(f => f.match(/ppt\/slides\/slide\d+\.xml$/))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || '0');
        const nb = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || '0');
        return na - nb;
      });

    console.log(`[PPT Template] Found ${slideFiles.length} slides in template: ${slideFiles.join(', ')}`);

    if (slideFiles.length >= 1) {
      const xml1 = await zip.files[slideFiles[0]].async('string');
      theme.slide1Bg = await extractBgFromXml(zip, slideFiles[0], xml1);
    }

    if (slideFiles.length >= 2) {
      const xml2 = await zip.files[slideFiles[1]].async('string');
      theme.slide2Bg = await extractBgFromXml(zip, slideFiles[1], xml2);
    }

    // ── 3. Fallback: if slides have no bg, try slide master ───
    if (!theme.slide1Bg?.hasTemplateBg && !theme.slide2Bg?.hasTemplateBg) {
      const masterFiles = Object.keys(zip.files).filter(f =>
        f.match(/ppt\/slideMasters\/slideMaster\d*\.xml$/)
      );
      if (masterFiles.length > 0) {
        const masterXml = await zip.files[masterFiles[0]].async('string');
        const masterBg  = await extractBgFromXml(zip, masterFiles[0], masterXml);
        if (masterBg.hasTemplateBg) {
          theme.slide1Bg = masterBg;
          theme.slide2Bg = masterBg;
        }
      }
    }

    // Populate legacy single-bg fields from slide2 (content) or slide1
    const primaryBg = theme.slide2Bg?.hasTemplateBg ? theme.slide2Bg : theme.slide1Bg;
    if (primaryBg?.hasTemplateBg) {
      theme.bgImageData   = primaryBg.bgImageData;
      theme.bgImageExt    = primaryBg.bgImageExt;
      theme.bgColor       = primaryBg.bgColor;
      theme.hasTemplateBg = true;
    }

    console.log(`[PPT Template] Extracted theme — primary: #${theme.teal}, font: ${theme.fontTitle}, slide1Bg: ${theme.slide1Bg?.hasTemplateBg}, slide2Bg: ${theme.slide2Bg?.hasTemplateBg}`);

  } catch (err) {
    console.warn('[PPT Template] Theme extraction failed, using defaults:', err.message);
  }

  theme.tealDark  = theme.teal;
  theme.tealMid   = theme.tealAccent || theme.teal;
  theme.tealLight = theme.offWhite || 'F0F9F6';

  return theme;
}

// ────────────────────────────────────────────────────────────
// Apply template background to a slide.
// bgData: { bgImageData, bgImageExt, bgColor, hasTemplateBg }
//   — comes from GYS.slide1Bg (title slides) or GYS.slide2Bg (content slides)
// GYS: full theme object (for slideW/slideH dimensions)
// ────────────────────────────────────────────────────────────
function applyTemplateBackground(slide, GYS, bgData) {
  // bgData can be a per-slide bg object or fall back to legacy GYS fields
  const bg = bgData || GYS;
  if (!bg.hasTemplateBg) return;

  if (bg.bgImageData) {
    // Full-bleed background image from the template slide
    slide.addImage({
      data: `data:image/${bg.bgImageExt};base64,${bg.bgImageData}`,
      x: 0, y: 0,
      w: GYS.slideW,
      h: GYS.slideH,
      sizing: { type: 'cover', w: GYS.slideW, h: GYS.slideH },
    });
  } else if (bg.bgColor) {
    // Solid background color
    slide.background = { color: bg.bgColor };
  }
}

// ────────────────────────────────────────────────────────────
// Pick the correct per-slide background from GYS based on layout.
// TITLE / SECTION / CLOSING → slide1Bg (title slide from template)
// Everything else            → slide2Bg (content slide from template)
// Falls back to legacy GYS fields if per-slide bgs are not available.
// ────────────────────────────────────────────────────────────
function pickSlideBg(GYS, layout) {
  const titleLayouts = new Set(['TITLE', 'SECTION', 'CLOSING', 'THANKYOU', 'THANK_YOU']);
  const isTitle = titleLayouts.has((layout || '').toUpperCase());
  if (isTitle && GYS.slide1Bg?.hasTemplateBg) return GYS.slide1Bg;
  if (!isTitle && GYS.slide2Bg?.hasTemplateBg) return GYS.slide2Bg;
  // Fallback: use whichever is available
  if (GYS.slide1Bg?.hasTemplateBg) return GYS.slide1Bg;
  if (GYS.slide2Bg?.hasTemplateBg) return GYS.slide2Bg;
  // Final fallback: legacy GYS fields
  return GYS;
}

// ────────────────────────────────────────────────────────────
// SHARED HELPERS
// ────────────────────────────────────────────────────────────
function addFooter(slide, pptx, GYS, pageLabel = "") {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 5.35, w: GYS.slideW, h: 0.22,
    fill: { color: GYS.grayFoot }, line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 5.35, w: 2.6, h: 0.22,
    fill: { color: GYS.tealAccent }, line: { type: "none" },
  });
  slide.addText("Member of Yamato Steel Group", {
    x: 0.18, y: 5.36, w: 3.5, h: 0.18,
    fontSize: 8, color: GYS.white, fontFace: GYS.fontBody, valign: "middle",
  });
  if (pageLabel) {
    slide.addText(pageLabel, {
      x: 7.2, y: 5.36, w: 2.6, h: 0.18,
      fontSize: 8, color: "9CA3AF", align: "right", fontFace: GYS.fontBody, valign: "middle",
    });
  }
}

function addLogoLight(slide, pptx, GYS, x = 0.22, y = 0.14) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w: 0.58, h: 0.4,
    fill: { color: GYS.teal }, line: { type: "none" }, rectRadius: 0.05,
  });
  slide.addText("GYS", {
    x, y, w: 0.58, h: 0.4,
    fontSize: 10, bold: true, color: GYS.white, align: "center", valign: "middle",
    fontFace: GYS.fontTitle,
  });
}

function addLogoDark(slide, pptx, GYS, x = 0.22, y = 0.18) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w: 0.58, h: 0.4,
    fill: { color: GYS.white }, line: { type: "none" }, rectRadius: 0.05,
  });
  slide.addText("GYS", {
    x, y, w: 0.58, h: 0.4,
    fontSize: 10, bold: true, color: GYS.teal, align: "center", valign: "middle",
    fontFace: GYS.fontTitle,
  });
}

function addHeaderBar(slide, pptx, GYS) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: 0.82,
    fill: { color: GYS.white }, line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0.82, w: GYS.slideW, h: 0.025,
    fill: { color: GYS.grayBorder }, line: { type: "none" },
  });
}

function addLeftAccent(slide, pptx, GYS, y = 0.85, h = 4.3) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.12, y, w: 0.05, h,
    fill: { color: GYS.tealAccent }, line: { type: "none" },
  });
}

function addSlideTitle(slide, GYS, title) {
  const titleStr  = String(title || '');
  // ✅ v1.5.0: tighter box (w=8.0 to leave room for badge) + stricter scaling
  const titleSize = calcFontSize(titleStr, 45, 22, 13);
  slide.addText(titleStr, {
    x: 0.95, y: 0.10, w: 8.0, h: 0.62,
    fontSize: titleSize, bold: true, color: GYS.darkText, valign: "middle",
    fontFace: GYS.fontTitle, autoFit: true,
  });
}

// ────────────────────────────────────────────────────────────
// IMAGE_SLIDE layout
// ────────────────────────────────────────────────────────────
function renderImageSlide(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.offWhite }, line: { type: "none" },
  });
  addHeaderBar(slide, pptx, GYS);
  addLogoLight(slide, pptx, GYS);
  addSlideTitle(slide, GYS, data.title);

  const imagePath = data.imagePath;
  const caption   = data.caption || '';
  const bodyText  = data.body || (data.bullets || []).join('\n') || '';

  // Content zone: y=0.90 → y=5.30 (= 4.40 in)
  const ZONE_TOP = 0.90;
  const ZONE_BOT = 5.30;
  const ZONE_H   = ZONE_BOT - ZONE_TOP;

  if (imagePath && fs.existsSync(imagePath)) {
    if (bodyText) {
      slide.addImage({
        path: imagePath,
        x: 0.22, y: ZONE_TOP, w: 5.0, h: ZONE_H - 0.25,
        sizing: { type: 'contain', w: 5.0, h: ZONE_H - 0.25 },
      });
      const bodyFs = calcFontSizeByArea(bodyText, 4.2, ZONE_H, 14, 9);
      slide.addText(bodyText, {
        x: 5.4, y: ZONE_TOP, w: 4.3, h: ZONE_H,
        fontSize: bodyFs, color: GYS.bodyText, wrap: true, valign: "top",
        fontFace: GYS.fontBody, lineSpacingMultiple: 1.35, autoFit: true,
      });
      if (caption) {
        slide.addText(caption, {
          x: 0.22, y: ZONE_BOT - 0.20, w: 5.0, h: 0.18,
          fontSize: 8, color: GYS.mutedText, italic: true, fontFace: GYS.fontBody,
        });
      }
    } else {
      slide.addImage({
        path: imagePath,
        x: 0.3, y: ZONE_TOP, w: 9.4, h: ZONE_H - 0.25,
        sizing: { type: 'contain', w: 9.4, h: ZONE_H - 0.25 },
      });
      if (caption) {
        slide.addText(caption, {
          x: 0.3, y: ZONE_BOT - 0.20, w: 9.4, h: 0.18,
          fontSize: 9, color: GYS.mutedText, align: "center", italic: true,
          fontFace: GYS.fontBody,
        });
      }
    }
  } else {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.3, y: ZONE_TOP, w: 9.4, h: ZONE_H,
      fill: { color: GYS.tealLight }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.1,
    });
    slide.addText('🖼️ Image\n' + (caption || 'Visual'), {
      x: 0.3, y: ZONE_TOP, w: 9.4, h: ZONE_H,
      fontSize: 18, color: GYS.mutedText, align: "center", valign: "middle",
      fontFace: GYS.fontBody,
    });
  }

  addFooter(slide, pptx, GYS, pageLabel);
}

// ────────────────────────────────────────────────────────────
// SLIDE RENDERERS
// ────────────────────────────────────────────────────────────

function renderTitle(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.teal }, line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 7.2, y: -1.5, w: 5.0, h: 5.0,
    fill: { color: GYS.tealDark }, line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 8.0, y: 2.8, w: 3.2, h: 3.2,
    fill: { color: GYS.tealMid }, line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: -0.3, y: 4.5, w: 1.8, h: 1.8,
    fill: { color: GYS.tealMid }, line: { type: "none" },
  });
  addLogoDark(slide, pptx, GYS, 0.3, 0.2);
  slide.addText("GARUDA YAMATO STEEL", {
    x: 1.0, y: 0.22, w: 5.5, h: 0.34,
    fontSize: 10, bold: true, color: GYS.white, charSpacing: 2.0,
    fontFace: GYS.fontTitle,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.65, w: 3.5, h: 0.04,
    fill: { color: GYS.tealAccent }, line: { type: "none" },
  });
  const mainTitle = String(data.title || "Presentation Title");
  const titleFs   = calcFontSize(mainTitle, 35, 40, 22);
  slide.addText(mainTitle, {
    x: 0.5, y: 1.75, w: 8.5, h: 1.8,
    fontSize: titleFs, bold: true, color: GYS.white, wrap: true,
    fontFace: GYS.fontTitle, lineSpacingMultiple: 1.1, autoFit: true,
  });
  if (data.subtitle) {
    const subStr = String(data.subtitle);
    const subFs  = calcFontSizeByArea(subStr, 7.5, 0.65, 18, 11);
    slide.addText(subStr, {
      x: 0.5, y: 3.6, w: 7.5, h: 0.65,
      fontSize: subFs, color: "A8D5C2", fontFace: GYS.fontBody,
      lineSpacingMultiple: 1.2, autoFit: true,
    });
  }
  const metaLine = [data.presenter, data.date].filter(Boolean).join("   •   ");
  if (metaLine) {
    slide.addText(truncateText(metaLine, 80), {
      x: 0.5, y: 4.35, w: 7.5, h: 0.32,
      fontSize: 12, color: "7BC8AD", fontFace: GYS.fontBody,
    });
  }
  addFooter(slide, pptx, GYS, pageLabel);
}

function renderSection(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.offWhite }, line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 3.0, h: GYS.slideH,
    fill: { color: GYS.teal }, line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: -0.8, y: 3.5, w: 2.8, h: 2.8,
    fill: { color: GYS.tealMid }, line: { type: "none" },
  });
  addLogoDark(slide, pptx, GYS, 0.25, 0.2);
  if (data.sectionNumber) {
    slide.addText(String(data.sectionNumber), {
      x: 0.2, y: 1.7, w: 2.6, h: 1.5,
      fontSize: 80, bold: true, color: "004D38", align: "center", fontFace: GYS.fontTitle,
    });
  }
  const sectionTitle = String(data.title || "Section");
  const stFs = calcFontSize(sectionTitle, 28, 34, 18);
  slide.addText(sectionTitle, {
    x: 3.3, y: 1.6, w: 6.3, h: 1.4,
    fontSize: stFs, bold: true, color: GYS.darkText, valign: "middle",
    fontFace: GYS.fontTitle, wrap: true, autoFit: true,
  });
  if (data.subtitle) {
    const ssStr = String(data.subtitle);
    const ssFs  = calcFontSizeByArea(ssStr, 6.3, 0.9, 16, 10);
    slide.addText(ssStr, {
      x: 3.3, y: 3.1, w: 6.3, h: 0.9,
      fontSize: ssFs, color: GYS.bodyText, valign: "top",
      fontFace: GYS.fontBody, wrap: true, lineSpacingMultiple: 1.3, autoFit: true,
    });
  }
  addFooter(slide, pptx, GYS, pageLabel);
}

function renderGrid(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.offWhite }, line: { type: "none" },
  });
  addHeaderBar(slide, pptx, GYS);
  addLogoLight(slide, pptx, GYS);
  addSlideTitle(slide, GYS, data.title);

  const items   = (data.items || []).slice(0, 4);
  const count   = Math.max(items.length, 1);
  const totalGap = 0.22;
  const startX   = 0.25;
  const availW   = GYS.slideW - startX * 2;
  const cardW    = (availW - totalGap * (count - 1)) / count;
  const cardH    = 3.8;
  const cardY    = 1.0;

  items.forEach((item, i) => {
    const cx = startX + i * (cardW + totalGap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: cx + 0.04, y: cardY + 0.05, w: cardW, h: cardH,
      fill: { color: "E2E8E6" }, line: { type: "none" }, rectRadius: 0.12,
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: cx, y: cardY, w: cardW, h: cardH,
      fill: { color: GYS.cardWhite }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.12,
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: cx, y: cardY, w: cardW, h: 0.12,
      fill: { color: GYS.teal }, line: { type: "none" }, rectRadius: 0.06,
    });
    const iconBgSize = 0.55;
    const iconBgX    = cx + (cardW - iconBgSize) / 2;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: iconBgX, y: cardY + 0.22, w: iconBgSize, h: iconBgSize,
      fill: { color: GYS.tealLight }, line: { type: "none" },
    });
    slide.addText(item.icon || "💠", {
      x: iconBgX, y: cardY + 0.22, w: iconBgSize, h: iconBgSize,
      fontSize: count <= 2 ? 22 : 18, align: "center", valign: "middle",
    });

    // Title zone: cardY+0.88 → cardY+1.48 (= 0.60in)
    const cardTitleStr = truncateText(item.title || "Item", count <= 2 ? 40 : 22);
    const cardTitleFs  = calcFontSize(cardTitleStr, count <= 2 ? 30 : 18, count <= 2 ? 15 : 12, 9);
    slide.addText(cardTitleStr, {
      x: cx + 0.1, y: cardY + 0.88, w: cardW - 0.2, h: 0.55,
      fontSize: cardTitleFs, bold: true, color: GYS.darkText,
      align: "center", wrap: true, fontFace: GYS.fontTitle, autoFit: true,
    });

    // Body text zone: cardY+1.48 → cardY+cardH-0.1 (= 2.22in)
    const textAreaH    = cardH - 1.58;
    const textAreaW    = cardW - 0.28;
    const cardBodyFs   = calcFontSizeByArea(
      String(item.text || ''), textAreaW, textAreaH,
      count <= 2 ? 12 : 10, 7
    );
    slide.addText(String(item.text || ''), {
      x: cx + 0.14, y: cardY + 1.48, w: textAreaW, h: textAreaH,
      fontSize: cardBodyFs, color: GYS.bodyText,
      valign: "top", wrap: true, fontFace: GYS.fontBody, lineSpacingMultiple: 1.25,
      autoFit: true,
    });
  });

  addFooter(slide, pptx, GYS, pageLabel);
}

// ────────────────────────────────────────────────────────────
// GRID_3X3 — 3×3 grid layout for 5–9 category cards
// Slide layout: LAYOUT_16x9 (10" × 5.625")
// Header bar: 0.72in → content starts at y=0.85in
// 3 columns × 3 rows of cards, each with icon + title + sub-items
// ────────────────────────────────────────────────────────────
function renderGrid3x3(pptx, slide, data, GYS, pageLabel) {
  // Background
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.offWhite }, line: { type: "none" },
  });
  addHeaderBar(slide, pptx, GYS);
  addLogoLight(slide, pptx, GYS);
  addSlideTitle(slide, GYS, data.title);

  const allItems = (data.items || []).slice(0, 9);
  const COLS     = 3;
  const ROWS     = Math.ceil(allItems.length / COLS);

  // Grid geometry — tight fit for 3×3
  const startX  = 0.22;
  const startY  = 0.95;       // just below the header+title zone
  const gapX    = 0.14;
  const gapY    = 0.12;
  const availW  = GYS.slideW - startX * 2;
  const availH  = GYS.slideH - startY - 0.38; // leave room for footer
  const cardW   = (availW - gapX * (COLS - 1)) / COLS;
  const cardH   = (availH - gapY * (ROWS - 1)) / ROWS;

  allItems.forEach((item, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const cx  = startX + col * (cardW + gapX);
    const cy  = startY + row * (cardH + gapY);

    // Card shadow
    slide.addShape(pptx.ShapeType.roundRect, {
      x: cx + 0.03, y: cy + 0.04, w: cardW, h: cardH,
      fill: { color: "D8E4E0" }, line: { type: "none" }, rectRadius: 0.10,
    });
    // Card body
    slide.addShape(pptx.ShapeType.roundRect, {
      x: cx, y: cy, w: cardW, h: cardH,
      fill: { color: GYS.cardWhite }, line: { color: GYS.grayBorder, width: 0.75 }, rectRadius: 0.10,
    });
    // Top accent strip
    slide.addShape(pptx.ShapeType.roundRect, {
      x: cx, y: cy, w: cardW, h: 0.09,
      fill: { color: GYS.teal }, line: { type: "none" }, rectRadius: 0.05,
    });

    // Icon circle
    const iconSize = 0.38;
    const iconX    = cx + 0.12;
    const iconY    = cy + 0.13;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: iconX, y: iconY, w: iconSize, h: iconSize,
      fill: { color: GYS.tealLight }, line: { type: "none" },
    });
    slide.addText(item.icon || "📦", {
      x: iconX, y: iconY, w: iconSize, h: iconSize,
      fontSize: 14, align: "center", valign: "middle",
    });

    // Category title (right of icon)
    const titleX  = cx + 0.57;
    const titleW  = cardW - 0.64;
    const titleStr = truncateText(item.title || "Category", 28);
    const titleFs  = calcFontSize(titleStr, 20, 9, 7);
    slide.addText(titleStr, {
      x: titleX, y: iconY, w: titleW, h: iconSize,
      fontSize: titleFs, bold: true, color: GYS.darkText,
      valign: "middle", wrap: true, fontFace: GYS.fontTitle, autoFit: true,
    });

    // Sub-items / description below icon row
    const subY     = cy + 0.13 + iconSize + 0.06;
    const subH     = cardH - (iconSize + 0.13 + 0.06) - 0.06;
    const subItems = item.subItems || item.bullets || [];

    if (subItems.length > 0) {
      // Render as small bullet list
      const subFs = bulletFontSize(subItems, subH, 7.5, 6, cardW - 0.16);
      slide.addText(
        subItems.map(s => ({ text: String(s), options: { bullet: true, breakLine: true } })),
        {
          x: cx + 0.10, y: subY, w: cardW - 0.16, h: subH,
          fontSize: subFs, color: GYS.bodyText, fontFace: GYS.fontBody,
          valign: "top", paraSpaceAfter: 1, lineSpacingMultiple: 1.15, autoFit: true,
        }
      );
    } else if (item.text) {
      // Fallback: plain description text
      const textFs = calcFontSizeByArea(String(item.text), cardW - 0.18, subH, 7.5, 6);
      slide.addText(String(item.text), {
        x: cx + 0.10, y: subY, w: cardW - 0.18, h: subH,
        fontSize: textFs, color: GYS.bodyText, fontFace: GYS.fontBody,
        valign: "top", wrap: true, lineSpacingMultiple: 1.15, autoFit: true,
      });
    }
  });

  addFooter(slide, pptx, GYS, pageLabel);
}

function renderContent(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.offWhite }, line: { type: "none" },
  });
  addHeaderBar(slide, pptx, GYS);
  addLogoLight(slide, pptx, GYS);
  addLeftAccent(slide, pptx, GYS, 0.85, 4.3);
  addSlideTitle(slide, GYS, data.title);

  const imagePath = data.imagePath;
  const hasImage  = imagePath && fs.existsSync(imagePath);
  const bullets   = (data.bullets || []).filter(Boolean);

  // Content zone: y=0.90 → y=5.30 (4.40in total)
  const ZONE_Y = 0.90;
  const ZONE_H = 4.35; // strict — footer at 5.35, leave 0.10 gap
  const textX  = 0.32;
  const textW  = hasImage ? 5.0 : 9.3;

  if (hasImage) {
    // Image occupies right half: x=5.5, w=4.2, h=ZONE_H
    slide.addImage({
      path: imagePath,
      x: 5.5, y: ZONE_Y, w: 4.2, h: ZONE_H - 0.25,
      sizing: { type: 'contain', w: 4.2, h: ZONE_H - 0.25 },
    });
    if (data.caption) {
      slide.addText(truncateText(data.caption, 60), {
        x: 5.5, y: ZONE_Y + ZONE_H - 0.22, w: 4.2, h: 0.18,
        fontSize: 8, color: GYS.mutedText, italic: true, align: "center",
        fontFace: GYS.fontBody,
      });
    }
  }

  if (bullets.length > 0) {
    const baseFontSize = hasImage ? 13 : 15;
    const fs_size = bulletFontSize(bullets, ZONE_H, baseFontSize, 8, textW);
    const bulletItems = bullets.map(b => {
      const raw   = typeof b === "string" ? b : String(b);
      const isSub = raw.startsWith("  ") || raw.startsWith("\t") || raw.startsWith("- ");
      const text  = raw.replace(/^[\s\t-]+/, "");
      return {
        text,
        options: {
          bullet:      isSub ? { indent: 20 } : { type: "bullet" },
          color:       isSub ? GYS.mutedText : GYS.bodyText,
          fontSize:    isSub ? Math.max(7, fs_size - 2) : fs_size,
          breakLine:   true,
          indentLevel: isSub ? 1 : 0,
        },
      };
    });
    slide.addText(bulletItems, {
      x: textX, y: ZONE_Y, w: textW, h: ZONE_H,
      fontFace: GYS.fontBody, valign: "top",
      paraSpaceAfter:    bullets.length > 8 ? 3 : 8,
      lineSpacingMultiple: bullets.length > 8 ? 1.1 : 1.25,
      autoFit: true,
    });
  } else if (data.body) {
    const bodyStr = String(data.body);
    const bodyFs  = calcFontSizeByArea(bodyStr, textW, ZONE_H, 15, 9);
    slide.addText(bodyStr, {
      x: textX, y: ZONE_Y, w: textW, h: ZONE_H,
      fontSize: bodyFs, color: GYS.bodyText, wrap: true, valign: "top",
      fontFace: GYS.fontBody, lineSpacingMultiple: 1.4, autoFit: true,
    });
  }
  addFooter(slide, pptx, GYS, pageLabel);
}

function renderTwoColumn(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.offWhite }, line: { type: "none" },
  });
  addHeaderBar(slide, pptx, GYS);
  addLogoLight(slide, pptx, GYS);
  addSlideTitle(slide, GYS, data.title);

  // Cards: y=1.0 → y=5.30 (h=4.3)
  const CARD_Y = 1.0;
  const CARD_H = 4.25; // strict budget
  const HDR_H  = 0.50;
  const BODY_Y = CARD_Y + HDR_H;
  const BODY_H = CARD_H - HDR_H - 0.06;

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.22, y: CARD_Y, w: 4.6, h: CARD_H,
    fill: { color: GYS.cardWhite }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.1,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 5.18, y: CARD_Y, w: 4.6, h: CARD_H,
    fill: { color: GYS.cardWhite }, line: { color: GYS.teal, width: 2 }, rectRadius: 0.1,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.22, y: CARD_Y, w: 4.6, h: HDR_H,
    fill: { color: GYS.tealLight }, line: { type: "none" }, rectRadius: 0.1,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 5.18, y: CARD_Y, w: 4.6, h: HDR_H,
    fill: { color: GYS.teal }, line: { type: "none" }, rectRadius: 0.1,
  });
  if (data.leftTitle) {
    slide.addText(truncateText(String(data.leftTitle), 35), {
      x: 0.38, y: CARD_Y + 0.02, w: 4.3, h: HDR_H - 0.04,
      fontSize: calcFontSize(String(data.leftTitle), 28, 13, 9),
      bold: true, color: GYS.teal, valign: "middle", fontFace: GYS.fontTitle,
    });
  }
  if (data.rightTitle) {
    slide.addText(truncateText(String(data.rightTitle), 35), {
      x: 5.3, y: CARD_Y + 0.02, w: 4.3, h: HDR_H - 0.04,
      fontSize: calcFontSize(String(data.rightTitle), 28, 13, 9),
      bold: true, color: GYS.white, valign: "middle", fontFace: GYS.fontTitle,
    });
  }

  const leftBullets  = (data.leftBullets  || data.left  || []).filter(Boolean);
  const rightBullets = (data.rightBullets || data.right || []).filter(Boolean);

  if (leftBullets.length) {
    const lfs = bulletFontSize(leftBullets, BODY_H, 13, 8, 4.2);
    slide.addText(
      leftBullets.map(b => ({ text: String(b), options: { bullet: true, breakLine: true } })),
      { x: 0.38, y: BODY_Y, w: 4.3, h: BODY_H,
        fontSize: lfs, color: GYS.bodyText, fontFace: GYS.fontBody, valign: "top",
        paraSpaceAfter:      leftBullets.length > 6 ? 3 : 8,
        lineSpacingMultiple: leftBullets.length > 6 ? 1.1 : 1.3,
        autoFit: true,
      }
    );
  }
  if (rightBullets.length) {
    const rfs = bulletFontSize(rightBullets, BODY_H, 13, 8, 4.2);
    slide.addText(
      rightBullets.map(b => ({ text: String(b), options: { bullet: true, breakLine: true } })),
      { x: 5.3, y: BODY_Y, w: 4.3, h: BODY_H,
        fontSize: rfs, color: GYS.bodyText, fontFace: GYS.fontBody, valign: "top",
        paraSpaceAfter:      rightBullets.length > 6 ? 3 : 8,
        lineSpacingMultiple: rightBullets.length > 6 ? 1.1 : 1.3,
        autoFit: true,
      }
    );
  }
  addFooter(slide, pptx, GYS, pageLabel);
}

function renderStats(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.offWhite }, line: { type: "none" },
  });
  addHeaderBar(slide, pptx, GYS);
  addLogoLight(slide, pptx, GYS);
  addSlideTitle(slide, GYS, data.title);

  const stats  = (data.stats || []).slice(0, 4);
  const count  = Math.max(stats.length, 1);
  const gap    = 0.25;
  const startX = 0.25;
  const availW = GYS.slideW - startX * 2;
  const cardW  = (availW - gap * (count - 1)) / count;
  const cardH  = 3.8;
  const cardY  = 1.0;

  stats.forEach((s, i) => {
    const cx     = startX + i * (cardW + gap);
    const isDark = i % 2 === 0;

    slide.addShape(pptx.ShapeType.roundRect, {
      x: cx + 0.04, y: cardY + 0.06, w: cardW, h: cardH,
      fill: { color: "D1D5DB" }, line: { type: "none" }, rectRadius: 0.12,
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: cx, y: cardY, w: cardW, h: cardH,
      fill: { color: isDark ? GYS.teal : GYS.cardWhite },
      line: { color: isDark ? GYS.teal : GYS.grayBorder, width: isDark ? 0 : 1.5 },
      rectRadius: 0.12,
    });
    const textColor = isDark ? GYS.white  : GYS.darkText;
    const subColor  = isDark ? "A8D5C2"  : GYS.mutedText;
    const valColor  = isDark ? GYS.white  : GYS.teal;

    if (s.icon) {
      slide.addShape(pptx.ShapeType.ellipse, {
        x: cx + (cardW - 0.55) / 2, y: cardY + 0.28, w: 0.55, h: 0.55,
        fill: { color: isDark ? "005840" : GYS.tealLight }, line: { type: "none" },
      });
      slide.addText(s.icon, {
        x: cx + (cardW - 0.55) / 2, y: cardY + 0.28, w: 0.55, h: 0.55,
        fontSize: 20, align: "center", valign: "middle",
      });
    }

    const valueY      = s.icon ? cardY + 0.95 : cardY + 0.6;
    const valStr      = String(s.value || "—");
    // ✅ v1.5.0: value box h=1.0 max; scale font to fit value string
    const valueFsBase = count <= 2 ? 48 : count === 3 ? 40 : 32;
    const valueFs     = calcFontSize(valStr, 7, valueFsBase, 18);
    slide.addText(valStr, {
      x: cx + 0.08, y: valueY, w: cardW - 0.16, h: 1.0,
      fontSize: valueFs, bold: true, color: valColor, align: "center",
      fontFace: GYS.fontTitle, autoFit: true,
    });

    // Label zone: valueY+1.0 → valueY+1.6 (0.60in)
    const labelStr = String(s.label || "");
    slide.addText(truncateText(labelStr, 35), {
      x: cx + 0.08, y: valueY + 1.0, w: cardW - 0.16, h: 0.58,
      fontSize: calcFontSize(labelStr, 22, 13, 8),
      bold: true, color: textColor, align: "center", wrap: true,
      fontFace: GYS.fontBody, autoFit: true,
    });

    // Sub zone: valueY+1.6 → cardY+cardH-0.1 (remaining)
    if (s.sub) {
      const subStr  = String(s.sub);
      const subZoneH = (cardY + cardH) - (valueY + 1.6) - 0.08;
      const subFs   = calcFontSizeByArea(subStr, cardW - 0.16, Math.max(0.3, subZoneH), 10, 7);
      slide.addText(truncateText(subStr, 60), {
        x: cx + 0.08, y: valueY + 1.6, w: cardW - 0.16, h: Math.max(0.3, subZoneH),
        fontSize: subFs, color: subColor, align: "center",
        wrap: true, fontFace: GYS.fontBody, autoFit: true,
      });
    }
  });
  addFooter(slide, pptx, GYS, pageLabel);
}

function renderTimeline(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.offWhite }, line: { type: "none" },
  });
  addHeaderBar(slide, pptx, GYS);
  addLogoLight(slide, pptx, GYS);
  addSlideTitle(slide, GYS, data.title);

  const steps = (data.steps || []).slice(0, 6);
  const count = Math.max(steps.length, 1);
  const lineY = 2.2;
  const padX  = 0.5;
  const lineLen  = GYS.slideW - padX * 2;
  const nodeSize = 0.36;

  slide.addShape(pptx.ShapeType.rect, {
    x: padX, y: lineY - 0.025, w: lineLen, h: 0.05,
    fill: { color: GYS.tealLight }, line: { type: "none" },
  });

  const stepW = lineLen / count;

  steps.forEach((step, i) => {
    const cx    = padX + i * stepW + stepW / 2;
    const nodeX = cx - nodeSize / 2;
    const nodeY = lineY - nodeSize / 2;

    slide.addShape(pptx.ShapeType.ellipse, {
      x: nodeX - 0.06, y: nodeY - 0.06, w: nodeSize + 0.12, h: nodeSize + 0.12,
      fill: { color: GYS.tealLight }, line: { type: "none" },
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: nodeX, y: nodeY, w: nodeSize, h: nodeSize,
      fill: { color: GYS.teal }, line: { type: "none" },
    });
    slide.addText(String(i + 1), {
      x: nodeX, y: nodeY, w: nodeSize, h: nodeSize,
      fontSize: 12, bold: true, color: GYS.white, align: "center", valign: "middle",
      fontFace: GYS.fontTitle,
    });

    // Time label: lineY-0.90 → lineY-0.02 (0.88in box)
    const timeStr = String(step.time || `Step ${i + 1}`);
    const timeFs  = calcFontSize(timeStr, 10, 10, 7);
    slide.addText(timeStr, {
      x: cx - stepW * 0.44, y: lineY - 0.90, w: stepW * 0.88, h: 0.38,
      fontSize: timeFs, bold: true, color: GYS.tealAccent,
      align: "center", fontFace: GYS.fontTitle, wrap: true,
    });

    // Card: lineY+0.42 → 5.30 (ZONE_BOT)
    const ZONE_BOT = 5.30;
    const cardX    = cx - stepW * 0.44;
    const cardY    = lineY + 0.42;
    const cardW    = stepW * 0.88;
    const cardH    = ZONE_BOT - cardY;

    slide.addShape(pptx.ShapeType.roundRect, {
      x: cardX, y: cardY, w: cardW, h: cardH,
      fill: { color: GYS.cardWhite }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.1,
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: cardX, y: cardY, w: cardW, h: 0.1,
      fill: { color: GYS.teal }, line: { type: "none" }, rectRadius: 0.05,
    });

    // Step title: cardY+0.12 → cardY+0.66 (0.54in)
    const TITLE_H   = 0.54;
    const stepTitle = String(step.title || "Phase");
    const stTitleFs = calcFontSizeByArea(stepTitle, cardW - 0.2, TITLE_H, count <= 3 ? 12 : 10, 7);
    slide.addText(stepTitle, {
      x: cardX + 0.1, y: cardY + 0.12, w: cardW - 0.2, h: TITLE_H,
      fontSize: stTitleFs, bold: true, color: GYS.darkText,
      wrap: true, fontFace: GYS.fontTitle, valign: "top", autoFit: true,
    });

    // Step body: cardY+0.68 → ZONE_BOT-0.06
    const BODY_H    = cardH - 0.74;
    const stepText  = String(step.text || "");
    const stepBodyFs = calcFontSizeByArea(stepText, cardW - 0.2, Math.max(0.3, BODY_H), count <= 3 ? 11 : 9, 6);
    slide.addText(stepText, {
      x: cardX + 0.1, y: cardY + 0.68, w: cardW - 0.2, h: Math.max(0.3, BODY_H),
      fontSize: stepBodyFs, color: GYS.bodyText,
      wrap: true, fontFace: GYS.fontBody, valign: "top",
      lineSpacingMultiple: 1.2, autoFit: true,
    });
  });
  addFooter(slide, pptx, GYS, pageLabel);
}

function renderChart(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.offWhite }, line: { type: "none" },
  });
  addHeaderBar(slide, pptx, GYS);
  addLogoLight(slide, pptx, GYS);
  addSlideTitle(slide, GYS, data.title);

  const cfg     = data.chartConfig || {};
  const rawType = (cfg.type || "bar").toLowerCase();
  let chartType = pptx.ChartType.bar;
  if (rawType === "line" || rawType === "area") chartType = pptx.ChartType.line;
  if (rawType === "pie")                        chartType = pptx.ChartType.pie;
  if (rawType === "doughnut" || rawType === "donut") chartType = pptx.ChartType.doughnut;

  const chartData  = cfg.data || [];
  const hasInsight = Boolean(data.insightText);

  // Insight panel: y=1.0 → y=5.15 (4.15in)
  const CHART_TOP = 1.0;
  const CHART_H   = 4.15;

  if (hasInsight) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.18, y: CHART_TOP, w: 3.0, h: CHART_H,
      fill: { color: GYS.tealLight }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.1,
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.18, y: CHART_TOP, w: 3.0, h: 0.42,
      fill: { color: GYS.teal }, line: { type: "none" }, rectRadius: 0.1,
    });
    slide.addText("Key Insight", {
      x: 0.28, y: CHART_TOP + 0.02, w: 2.8, h: 0.38,
      fontSize: 12, bold: true, color: GYS.white, valign: "middle", fontFace: GYS.fontTitle,
    });
    const insightStr = String(data.insightText);
    const insightFs  = calcFontSizeByArea(insightStr, 2.8, CHART_H - 0.52, 13, 8);
    slide.addText(insightStr, {
      x: 0.28, y: CHART_TOP + 0.50, w: 2.8, h: CHART_H - 0.52,
      fontSize: insightFs, color: GYS.bodyText, wrap: true, valign: "top",
      fontFace: GYS.fontBody, lineSpacingMultiple: 1.35, autoFit: true,
    });
  }

  const chartX = hasInsight ? 3.4 : 0.25;
  const chartW = hasInsight ? 6.3 : 9.5;

  if (chartData.length > 0) {
    slide.addChart(chartType, chartData, {
      x: chartX, y: CHART_TOP, w: chartW, h: CHART_H,
      showTitle: false, showLegend: true, legendPos: "b",
      legendFontSize: 10, legendColor: GYS.mutedText,
      chartColors: GYS.chartColors,
      dataLabelColor: GYS.white, dataLabelFontSize: 10,
      valAxisLabelColor: GYS.mutedText, catAxisLabelColor: GYS.mutedText,
      valAxisLabelFontSize: 10, catAxisLabelFontSize: 10,
      showValue: cfg.showDataLabels !== false,
      barGrouping: cfg.isStacked ? "stacked" : "clustered",
    });
  }
  addFooter(slide, pptx, GYS, pageLabel);
}

function renderTable(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.offWhite }, line: { type: "none" },
  });
  addHeaderBar(slide, pptx, GYS);
  addLogoLight(slide, pptx, GYS);
  addSlideTitle(slide, GYS, data.title);

  const headers = data.tableHeaders || [];
  const rows    = data.tableRows    || [];
  if (!headers.length && !rows.length) { addFooter(slide, pptx, GYS, pageLabel); return; }

  const colCount   = Math.max(headers.length, rows[0] ? (Array.isArray(rows[0]) ? rows[0].length : 1) : 1);
  const totalRows  = rows.length + (headers.length ? 1 : 0);
  let headerFs = 11;
  let cellFs   = 10;
  if (colCount >= 5 || totalRows >= 8)  { headerFs = 9;  cellFs = 8; }
  if (colCount >= 6 || totalRows >= 12) { headerFs = 8;  cellFs = 7; }

  const maxCellChars = Math.floor(100 / colCount);

  const tableData = [];
  if (headers.length) {
    tableData.push(
      headers.map(h => ({
        text: truncateText(String(h), maxCellChars + 10),
        options: {
          bold: true, color: GYS.white, fill: GYS.teal,
          align: "left", fontSize: headerFs, valign: "middle", fontFace: GYS.fontTitle,
        },
      }))
    );
  }
  rows.forEach((row, ri) => {
    tableData.push(
      (Array.isArray(row) ? row : [row]).map((cell, ci) => ({
        text: truncateText(String(cell ?? ""), maxCellChars),
        options: {
          color: GYS.bodyText, fill: ri % 2 === 0 ? GYS.cardWhite : GYS.offWhite,
          fontSize: cellFs, valign: "middle", align: "left",
          bold: ci === 0, fontFace: GYS.fontBody,
        },
      }))
    );
  });

  const TABLE_H  = 4.15;
  const TABLE_Y  = 1.0;
  const rowH     = Math.min(0.52, TABLE_H / Math.max(tableData.length, 1));
  slide.addTable(tableData, {
    x: 0.25, y: TABLE_Y, w: 9.5, h: TABLE_H,
    border: { type: "solid", color: GYS.grayBorder, pt: 0.75 },
    rowH, autoPage: false,
  });
  addFooter(slide, pptx, GYS, pageLabel);
}

function renderQuote(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.teal }, line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: -1.2, y: -1.5, w: 5, h: 5,
    fill: { color: GYS.tealDark }, line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 7.8, y: 2.8, w: 3.5, h: 3.5,
    fill: { color: GYS.tealMid }, line: { type: "none" },
  });
  addLogoDark(slide, pptx, GYS, 0.28, 0.2);
  slide.addText("\u201C", {
    x: 0.5, y: 0.6, w: 1.8, h: 1.4,
    fontSize: 110, color: GYS.tealAccent, bold: true, fontFace: "Georgia",
  });
  const quoteText = String(data.quote || data.title || "");
  const quoteFs   = calcFontSizeByArea(quoteText, 8.4, 2.5, 24, 13);
  slide.addText(quoteText, {
    x: 0.8, y: 1.5, w: 8.4, h: 2.5,
    fontSize: quoteFs, color: GYS.white, italic: true,
    wrap: true, align: "center", valign: "middle",
    fontFace: "Georgia", lineSpacingMultiple: 1.3, autoFit: true,
  });
  if (data.author) {
    slide.addText(truncateText("— " + data.author, 60), {
      x: 0.8, y: 4.25, w: 8.4, h: 0.42,
      fontSize: 14, color: "A8D5C2", align: "right", fontFace: GYS.fontBody,
    });
  }
  addFooter(slide, pptx, GYS, pageLabel);
}

function renderClosing(pptx, slide, data, GYS, pageLabel) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.teal }, line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: -1.5, y: -2, w: 6, h: 6,
    fill: { color: GYS.tealDark }, line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 7.5, y: 2.5, w: 4, h: 4,
    fill: { color: GYS.tealMid }, line: { type: "none" },
  });
  addLogoDark(slide, pptx, GYS, 0.3, 0.22);
  slide.addText("GARUDA YAMATO STEEL", {
    x: 1.0, y: 0.24, w: 5.5, h: 0.32,
    fontSize: 10, bold: true, color: GYS.white, charSpacing: 2.0, fontFace: GYS.fontTitle,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 3.5, y: 2.0, w: 3.0, h: 0.04,
    fill: { color: GYS.tealAccent }, line: { type: "none" },
  });
  const closingTitle = String(data.title || "Thank You");
  const ctFs = calcFontSize(closingTitle, 18, 48, 26);
  slide.addText(closingTitle, {
    x: 0.6, y: 1.8, w: 8.8, h: 1.4,
    fontSize: ctFs, bold: true, color: GYS.white, align: "center",
    fontFace: GYS.fontTitle, autoFit: true,
  });
  if (data.subtitle) {
    const subStr = String(data.subtitle);
    slide.addText(truncateText(subStr, 80), {
      x: 0.6, y: 3.3, w: 8.8, h: 0.7,
      fontSize: calcFontSizeByArea(subStr, 8.8, 0.7, 18, 11), color: "A8D5C2",
      align: "center", fontFace: GYS.fontBody, autoFit: true,
    });
  }
  if (data.contact) {
    slide.addText(truncateText(String(data.contact), 80), {
      x: 0.6, y: 4.05, w: 8.8, h: 0.35,
      fontSize: 13, color: "7BC8AD", align: "center", fontFace: GYS.fontBody,
    });
  }
  addFooter(slide, pptx, GYS, pageLabel);
}


// ────────────────────────────────────────────────────────────
// STATUS_SLIDE layout — v1.5.0
//
// STRICT ZONE BUDGET (inches):
//   Header bar      : 0.00 → 0.82  (addHeaderBar)
//   Slide title     : 0.12 → 0.74  (inside header)
//   Status badge    : 0.16 → 0.58  (top-right corner)
//   Panels          : 0.86 → 2.96  panelH = 2.10
//   Timeline header : 3.00 → 3.28  tlHdrH = 0.28
//   Timeline body   : 3.28 → 4.36  tlAreaH = 1.08
//   Issue card      : 4.40 → 5.32  issueH = 0.92
//   Footer          : 5.35 → 5.625 (addFooter)
//
// Every sub-zone has Y+H <= its budget. autoFit:true on all text.
// ────────────────────────────────────────────────────────────
function renderStatusSlide(pptx, slide, data, GYS, pageLabel) {
  // ── Background ───────────────────────────────────────────
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: GYS.slideW, h: GYS.slideH,
    fill: { color: GYS.offWhite }, line: { type: "none" },
  });
  addHeaderBar(slide, pptx, GYS);
  addLogoLight(slide, pptx, GYS);

  // ── Slide Title (left of badge) ──────────────────────────
  const slideTitle = String(data.title || "Project Status Update");
  slide.addText(slideTitle, {
    x: 0.95, y: 0.12, w: 6.80, h: 0.58,  // ✅ shorter w to leave room for badge
    fontSize: calcFontSize(slideTitle, 50, 19, 12),
    bold: true, color: GYS.darkText, valign: "middle",
    fontFace: GYS.fontTitle, autoFit: true,
  });

  // ── STATUS BADGE ─────────────────────────────────────────
  const badge      = data.statusBadge || {};
  const badgeText  = String(badge.text || "STATUS");
  const badgeColor = badge.color === "red"   ? "DC2626"
                   : badge.color === "green" ? "16A34A"
                   : badge.color === "blue"  ? "2563EB" : "D97706";
  const badgeBg    = badge.color === "red"   ? "FEF2F2"
                   : badge.color === "green" ? "F0FDF4"
                   : badge.color === "blue"  ? "EFF6FF" : "FFFBEB";
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.08, y: 0.16, w: 1.74, h: 0.42,
    fill: { color: badgeBg }, line: { color: badgeColor, width: 1.5 }, rectRadius: 0.21,
  });
  slide.addText(badgeText, {
    x: 8.08, y: 0.16, w: 1.74, h: 0.42,
    fontSize: calcFontSize(badgeText, 12, 9, 7),
    bold: true, color: badgeColor, align: "center", valign: "middle",
    fontFace: GYS.fontTitle, autoFit: true,
  });

  // ═══════════════════════════════════════════════════════
  // TOP PANELS  — zone: 0.86 → 2.96  (panelH = 2.10)
  // ═══════════════════════════════════════════════════════
  const PANEL_Y   = 0.86;
  const PANEL_H   = 2.10;
  const PANEL_HDR = 0.35;
  const PANEL_BOT = PANEL_Y + PANEL_H;  // 2.96

  // ── LEFT PANEL ───────────────────────────────────────────
  const leftPanel = data.leftPanel || {};
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.18, y: PANEL_Y, w: 4.82, h: PANEL_H,
    fill: { color: GYS.cardWhite }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.1,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.18, y: PANEL_Y, w: 4.82, h: PANEL_HDR,
    fill: { color: GYS.teal }, line: { type: "none" }, rectRadius: 0.1,
  });
  slide.addText(truncateText(String(leftPanel.title || "Assessment Results"), 48), {
    x: 0.32, y: PANEL_Y + 0.01, w: 4.55, h: PANEL_HDR - 0.02,
    fontSize: calcFontSize(String(leftPanel.title || ""), 40, 10.5, 7.5),
    bold: true, color: GYS.white, valign: "middle", fontFace: GYS.fontTitle,
  });

  // Icon flow row
  const leftIcons  = leftPanel.iconFlow || [];
  const ICON_SIZE  = 0.34;
  const LABEL_H    = 0.28;
  const ICON_ROW_Y = PANEL_Y + PANEL_HDR + 0.06;
  const ICON_BOT   = ICON_ROW_Y + ICON_SIZE + LABEL_H + 0.04; // bottom of icon+label area

  if (leftIcons.length > 0) {
    const iconAreaW  = 4.60;
    const iconStartX = 0.20;
    const iconSlotW  = iconAreaW / leftIcons.length;
    const labelW     = Math.min(iconSlotW * 0.92, 1.05);

    leftIcons.forEach((ic, ii) => {
      const slotCX = iconStartX + ii * iconSlotW + iconSlotW / 2;
      const icX    = slotCX - ICON_SIZE / 2;

      slide.addShape(pptx.ShapeType.ellipse, {
        x: icX, y: ICON_ROW_Y, w: ICON_SIZE, h: ICON_SIZE,
        fill: { color: GYS.tealLight }, line: { color: GYS.tealAccent, width: 1 },
      });
      slide.addText(ic.icon || "●", {
        x: icX, y: ICON_ROW_Y, w: ICON_SIZE, h: ICON_SIZE,
        fontSize: 13, align: "center", valign: "middle",
      });
      // Arrow — fits in gap between circles
      if (ii < leftIcons.length - 1) {
        const arrowX = icX + ICON_SIZE + 0.01;
        const arrowW = Math.max(0.05, iconSlotW - ICON_SIZE - 0.04);
        slide.addText("→", {
          x: arrowX, y: ICON_ROW_Y, w: arrowW, h: ICON_SIZE,
          fontSize: 8, color: GYS.mutedText, align: "center", valign: "middle",
        });
      }
      if (ic.label) {
        slide.addText(truncateText(String(ic.label), 20), {
          x: slotCX - labelW / 2, y: ICON_ROW_Y + ICON_SIZE + 0.02,
          w: labelW, h: LABEL_H,
          fontSize: 6, color: GYS.mutedText, align: "center",
          wrap: true, fontFace: GYS.fontBody, autoFit: true,
        });
      }
    });
  }

  // Left panel bullets — strictly capped at PANEL_BOT
  const leftBullets  = leftPanel.bullets || [];
  const BULL_START_Y = leftIcons.length > 0 ? ICON_BOT : PANEL_Y + PANEL_HDR + 0.06;
  const BULL_H       = PANEL_BOT - BULL_START_Y - 0.06;

  if (leftBullets.length > 0 && BULL_H > 0.15) {
    const lbFs = bulletFontSize(leftBullets, BULL_H, 8.5, 6.5, 4.62);
    slide.addText(
      leftBullets.map(b => ({ text: String(b), options: { bullet: true, breakLine: true } })),
      {
        x: 0.28, y: BULL_START_Y, w: 4.62, h: BULL_H,
        fontSize: lbFs, color: GYS.bodyText, fontFace: GYS.fontBody,
        valign: "top", lineSpacingMultiple: 1.12, paraSpaceAfter: 1.5, autoFit: true,
      }
    );
  }

  // ── RIGHT PANEL ──────────────────────────────────────────
  const rightPanel = data.rightPanel || {};
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 5.18, y: PANEL_Y, w: 4.64, h: PANEL_H,
    fill: { color: GYS.cardWhite }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.1,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 5.18, y: PANEL_Y, w: 4.64, h: PANEL_HDR,
    fill: { color: GYS.tealMid }, line: { type: "none" }, rectRadius: 0.1,
  });
  slide.addText(truncateText(String(rightPanel.title || "Vendor Pipeline"), 48), {
    x: 5.30, y: PANEL_Y + 0.01, w: 4.38, h: PANEL_HDR - 0.02,
    fontSize: calcFontSize(String(rightPanel.title || ""), 40, 10.5, 7.5),
    bold: true, color: GYS.white, valign: "middle", fontFace: GYS.fontTitle,
  });

  // Vendor rows — clamp so they never exit the panel
  const vendors = rightPanel.vendors || [];
  let   rY      = PANEL_Y + PANEL_HDR + 0.06;
  const RP_BOT  = PANEL_BOT - 0.06;

  vendors.forEach((v) => {
    if (rY + 0.27 > RP_BOT) return;
    const isSelected = v.selected === true || String(v.status || "").toLowerCase() === "selected";
    const vendorBg   = isSelected ? GYS.tealLight : GYS.offWhite;
    const vendorBdr  = isSelected ? GYS.tealAccent : GYS.grayBorder;
    const textColor  = isSelected ? GYS.teal : GYS.bodyText;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 5.26, y: rY, w: 4.48, h: 0.27,
      fill: { color: vendorBg }, line: { color: vendorBdr, width: 1 }, rectRadius: 0.06,
    });
    const vendorLabel = (isSelected ? "✅ " : "    ") + truncateText(String(v.name || ""), 34);
    slide.addText(vendorLabel, {
      x: 5.30, y: rY + 0.01, w: 3.5, h: 0.25,
      fontSize: 9, bold: isSelected, color: textColor, valign: "middle", fontFace: GYS.fontBody,
    });
    if (isSelected && v.status) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 8.66, y: rY + 0.04, w: 1.0, h: 0.19,
        fill: { color: GYS.teal }, line: { type: "none" }, rectRadius: 0.04,
      });
      slide.addText(truncateText(String(v.status), 12).toUpperCase(), {
        x: 8.66, y: rY + 0.04, w: 1.0, h: 0.19,
        fontSize: 6.5, bold: true, color: GYS.white, align: "center", valign: "middle",
        fontFace: GYS.fontTitle,
      });
    }
    rY += 0.31;
  });

  if (rightPanel.pipelineStage && rY + 0.20 <= RP_BOT) {
    slide.addText("↓  " + truncateText(String(rightPanel.pipelineStage), 50), {
      x: 5.26, y: rY + 0.02, w: 4.48, h: 0.20,
      fontSize: 8, color: GYS.mutedText, italic: true, fontFace: GYS.fontBody,
    });
    rY += 0.26;
  }

  if (rightPanel.note && rY + 0.18 <= RP_BOT) {
    const noteH  = Math.max(0.30, RP_BOT - rY - 0.02);
    const noteFs = calcFontSizeByArea(String(rightPanel.note), 4.40, noteH, 9, 6.5);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 5.26, y: rY + 0.02, w: 4.48, h: noteH,
      fill: { color: GYS.tealLight }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.06,
    });
    slide.addText("💬  " + String(rightPanel.note), {
      x: 5.30, y: rY + 0.04, w: 4.40, h: noteH - 0.06,
      fontSize: noteFs, color: GYS.bodyText, italic: true,
      wrap: true, valign: "middle", fontFace: GYS.fontBody,
      lineSpacingMultiple: 1.12, autoFit: true,
    });
  }

  // ═══════════════════════════════════════════════════════
  // TIMELINE  — zone: 3.00 → 4.36  (header 0.28 + body 1.08)
  // ═══════════════════════════════════════════════════════
  const TL_Y      = 3.00;
  const TL_HDR_H  = 0.28;
  const TL_AREA_H = 1.08;
  const TL_AREA_Y = TL_Y + TL_HDR_H;            // 3.28
  const TL_BOT    = TL_AREA_Y + TL_AREA_H;      // 4.36

  const tlTitle = String(data.timelineTitle || "Current Project Status & Next Steps");
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.18, y: TL_Y, w: 9.64, h: TL_HDR_H,
    fill: { color: GYS.teal }, line: { type: "none" },
  });
  slide.addText(truncateText(tlTitle, 90), {
    x: 0.28, y: TL_Y + 0.01, w: 9.30, h: TL_HDR_H - 0.02,
    fontSize: calcFontSize(tlTitle, 80, 9, 7),
    bold: true, color: GYS.white, valign: "middle", fontFace: GYS.fontTitle,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.18, y: TL_AREA_Y, w: 9.64, h: TL_AREA_H,
    fill: { color: GYS.white }, line: { type: "none" },
  });

  const steps      = (data.milestones || []).slice(0, 6);
  const stepsCount = Math.max(steps.length, 1);
  const padX       = 0.42;
  const lineLen    = GYS.slideW - padX * 2;
  const stepW      = lineLen / stepsCount;
  // lineY at 55% of area gives room for speech bubble above and label below
  const lineY      = TL_AREA_Y + TL_AREA_H * 0.55;

  // Progress line
  let currentIdx = steps.findIndex(s =>
    ["current", "active", "in_progress"].includes(String(s.status || "").toLowerCase())
  );
  if (currentIdx < 0) currentIdx = steps.findLastIndex(s =>
    ["done", "complete", "completed"].includes(String(s.status || "").toLowerCase())
  );

  const solidLen = currentIdx >= 0
    ? (padX + currentIdx * stepW + stepW / 2) - padX
    : 0;
  if (solidLen > 0) {
    slide.addShape(pptx.ShapeType.rect, {
      x: padX, y: lineY - 0.02, w: solidLen, h: 0.04,
      fill: { color: "16A34A" }, line: { type: "none" },
    });
  }
  const dashLen = lineLen - solidLen;
  if (dashLen > 0) {
    slide.addShape(pptx.ShapeType.rect, {
      x: padX + solidLen, y: lineY - 0.015, w: dashLen, h: 0.03,
      fill: { color: GYS.grayBorder }, line: { type: "none" },
    });
  }

  steps.forEach((step, i) => {
    const cx     = padX + i * stepW + stepW / 2;
    const nodeR  = 0.15;
    const nodeX  = cx - nodeR;
    const nodeY  = lineY - nodeR;
    const status = String(step.status || "pending").toLowerCase();

    let nodeFill  = GYS.grayBorder;
    let nodeText  = String(i + 1);
    let nodeColor = GYS.mutedText;

    if (["done", "complete", "completed"].includes(status)) {
      nodeFill = "16A34A"; nodeText = "✓"; nodeColor = GYS.white;
    } else if (["current", "active", "in_progress"].includes(status)) {
      nodeFill = GYS.tealAccent; nodeText = "📍"; nodeColor = GYS.white;
    } else if (["blocked", "red"].includes(status)) {
      nodeFill = "DC2626"; nodeText = "✗"; nodeColor = GYS.white;
    }

    slide.addShape(pptx.ShapeType.ellipse, {
      x: nodeX, y: nodeY, w: nodeR * 2, h: nodeR * 2,
      fill: { color: nodeFill }, line: { type: "none" },
    });
    slide.addText(nodeText, {
      x: nodeX, y: nodeY, w: nodeR * 2, h: nodeR * 2,
      fontSize: 8, bold: true, color: nodeColor,
      align: "center", valign: "middle",
    });

    // Label — below node, Y-clipped to TL_BOT
    const labelY    = lineY + nodeR + 0.03;
    const labelW    = stepW * 0.88;
    const labelX    = cx - labelW / 2;
    const labelMaxH = TL_BOT - labelY - 0.02;
    const labelTxt  = String(step.label || step.title || `Step ${i + 1}`);
    const labelColor = status === "done"    ? "16A34A"
                     : status === "current" ? GYS.tealAccent
                     : status === "blocked" ? "DC2626"
                     : GYS.mutedText;
    if (labelMaxH > 0.10) {
      slide.addText(truncateText(labelTxt, 22), {
        x: labelX, y: labelY, w: labelW, h: labelMaxH,
        fontSize: calcFontSizeByArea(labelTxt, labelW, labelMaxH, 7.5, 5.5),
        color: labelColor, align: "center", wrap: true,
        fontFace: GYS.fontBody, bold: status === "current", autoFit: true,
      });
    }

    // Speech bubble — anchored at TL_AREA_Y+0.03 so it never overlaps header
    if (["current", "active", "in_progress"].includes(status) && step.note) {
      const bH = 0.38;
      const bW = Math.min(stepW * 1.50, 2.50);
      const bX = Math.max(padX, Math.min(cx - bW / 2, GYS.slideW - padX - bW));
      const bY = TL_AREA_Y + 0.03;  // always just inside the area top — never bleeds into timeline header
      slide.addShape(pptx.ShapeType.roundRect, {
        x: bX, y: bY, w: bW, h: bH,
        fill: { color: "FFFBEB" }, line: { color: "D97706", width: 1 }, rectRadius: 0.07,
      });
      slide.addText(truncateText(String(step.note), 60), {
        x: bX + 0.06, y: bY + 0.02, w: bW - 0.12, h: bH - 0.04,
        fontSize: 6.5, color: "92400E", wrap: true, valign: "middle",
        fontFace: GYS.fontBody, italic: true, autoFit: true,
      });
    }
  });

  // ═══════════════════════════════════════════════════════
  // ISSUE CARD  — zone: 4.40 → 5.32  (issueH = 0.92)
  // ═══════════════════════════════════════════════════════
  const issueCard = data.issueCard || {};
  if (issueCard.title || (issueCard.bullets || []).length > 0) {
    const ISSUE_Y   = TL_BOT + 0.04;  // 4.40
    const ISSUE_H   = 5.32 - ISSUE_Y; // 0.92
    const issueBg   = issueCard.color === "red" ? "FEF2F2" : "FFFBEB";
    const issueBdr  = issueCard.color === "red" ? "DC2626" : "D97706";
    const issueHdr  = issueCard.color === "red" ? "B91C1C" : "92400E";

    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.18, y: ISSUE_Y, w: 9.64, h: ISSUE_H,
      fill: { color: issueBg }, line: { color: issueBdr, width: 1 }, rectRadius: 0.08,
    });

    const tagText = String(issueCard.tag || "⚠️ ISSUES & BLOCKERS");
    const TAG_W   = 2.20;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.28, y: ISSUE_Y + 0.05, w: TAG_W, h: 0.22,
      fill: { color: issueBdr }, line: { type: "none" }, rectRadius: 0.05,
    });
    slide.addText(truncateText(tagText, 30), {
      x: 0.28, y: ISSUE_Y + 0.05, w: TAG_W, h: 0.22,
      fontSize: 7, bold: true, color: GYS.white, align: "center", valign: "middle",
      fontFace: GYS.fontTitle,
    });

    if (issueCard.title) {
      slide.addText(truncateText(String(issueCard.title), 80), {
        x: TAG_W + 0.38, y: ISSUE_Y + 0.04, w: 9.64 - TAG_W - 0.48, h: 0.28,
        fontSize: calcFontSize(String(issueCard.title), 70, 10, 7.5),
        bold: true, color: issueHdr, valign: "middle", fontFace: GYS.fontTitle,
      });
    }

    const issueBullets = issueCard.bullets || [];
    if (issueBullets.length > 0) {
      const IB_Y  = ISSUE_Y + 0.34;
      const IB_H  = ISSUE_H - 0.38;
      const ibFs  = bulletFontSize(issueBullets, IB_H, 8.5, 6.5, 9.50);
      slide.addText(
        issueBullets.map((b, idx) => ({
          text: String(b),
          options: { bullet: true, breakLine: idx < issueBullets.length - 1 },
        })),
        {
          x: 0.28, y: IB_Y, w: 9.50, h: IB_H,
          fontSize: ibFs, color: issueHdr, fontFace: GYS.fontBody,
          valign: "top", lineSpacingMultiple: 1.10, paraSpaceAfter: 1,
          autoFit: true,
          // ✅ v1.5.0: use 2 columns when 4+ bullets so they fit vertically
          columns: issueBullets.length >= 4 ? 2 : 1,
        }
      );
    }
  }

  addFooter(slide, pptx, GYS, pageLabel);
}

// ────────────────────────────────────────────────────────────
// ✅ v1.3.0 — Smart image-to-slide assignment (preserved)
// ────────────────────────────────────────────────────────────
function assignImagesToSlides(slides, extractedImages) {
  if (!extractedImages || extractedImages.length === 0) return slides;

  const assigned    = slides.map(s => ({ ...s }));
  const images      = [...extractedImages];
  const usedIdx     = new Set();
  const totalSlides = assigned.length;

  assigned.forEach(slide => {
    if (!slide.imagePath) return;
    const matchIdx = images.findIndex(img => img.path === slide.imagePath);
    if (matchIdx >= 0) usedIdx.add(matchIdx);
  });

  const preAssigned = usedIdx.size;
  if (preAssigned > 0) {
    console.log(`[PPT] ${preAssigned} images pre-assigned, checking remaining...`);
  }

  // Pass 1: assign to slides with needsImage set
  for (let si = 0; si < assigned.length; si++) {
    const availableCount = images.filter((_, ii) => !usedIdx.has(ii)).length;
    if (availableCount === 0) break;

    const slide  = assigned[si];
    const layout = (slide.layout || 'CONTENT').toUpperCase();
    const need   = (slide.needsImage || 'none').toLowerCase();

    if (slide.imagePath && fs.existsSync(slide.imagePath)) continue;
    if (need === 'none' || need === '') continue;
    if (['GRID','STATS','CHART','TIMELINE','TABLE','QUOTE','CLOSING','TITLE','SECTION'].includes(layout)) continue;

    const slideRatio = si / Math.max(totalSlides - 1, 1);
    let bestImgIdx   = -1;
    let bestScore    = Infinity;

    images.forEach((img, ii) => {
      if (usedIdx.has(ii)) return;
      const posRatio  = img.positionRatio !== undefined ? img.positionRatio : (ii / Math.max(images.length - 1, 1));
      const posDist   = Math.abs(posRatio - slideRatio);
      const sizeBonus = (img.isLarge && ['architecture','diagram'].includes(need)) ? -0.15
                      : (img.isMedium && need === 'screenshot') ? -0.08 : 0;
      const score = posDist + sizeBonus;
      if (score < bestScore) { bestScore = score; bestImgIdx = ii; }
    });

    if (bestImgIdx >= 0 && bestScore < 0.55) {
      assigned[si].imagePath = images[bestImgIdx].path;
      assigned[si].caption   = images[bestImgIdx].caption;
      usedIdx.add(bestImgIdx);
      console.log(`[PPT] Slide ${si + 1} ← image[${bestImgIdx}] (score: ${bestScore.toFixed(2)})`);
    }
  }

  // Pass 2: unassigned LARGE images → standalone IMAGE_SLIDE
  images.forEach((img, ii) => {
    if (usedIdx.has(ii)) return;
    if (!img.isLarge) return;

    const closingIdx = assigned.findIndex(s =>
      ['CLOSING','THANKYOU','THANK_YOU'].includes((s.layout || '').toUpperCase())
    );
    const insertAt   = closingIdx > 0 ? closingIdx : assigned.length;
    const diagramTitle = img.caption
      ? img.caption.replace(/Image \d+ from /, 'Diagram from ')
      : 'Architecture Diagram';

    assigned.splice(insertAt, 0, {
      layout:     'IMAGE_SLIDE',
      title:      diagramTitle,
      imagePath:  img.path,
      caption:    img.caption,
      body:       '',
      needsImage: 'none',
    });
    usedIdx.add(ii);
    console.log(`[PPT] Inserted IMAGE_SLIDE for large image[${ii}] before slide ${insertAt + 1}`);
  });

  return assigned;
}

// ────────────────────────────────────────────────────────────
// MAIN generate()
// ────────────────────────────────────────────────────────────
const PptxService = {

  async generate({ pptData, slideContent, title, outputDir, styleDesc, templatePath = null, extractedImages = [] }) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // ── Extract theme colors/fonts from template (for content rendering) ──
    const GYS = templatePath
      ? await extractTemplateTheme(templatePath)
      : { ...GYS_DEFAULTS };

    const pptx = new PptxGenJS();
    pptx.layout  = "LAYOUT_16x9";
    pptx.author  = "GYS Portal AI";
    pptx.company = "PT Garuda Yamato Steel";
    pptx.subject = title || "Presentation";
    pptx.title   = title || "Presentation";

    // Note: PptxGenJS 3.x does not support pptx.load().
    // Template theming is applied via:
    //   1. extractTemplateTheme() — extracts colors, fonts, background from the PPTX file
    //   2. applyTemplateBackground() — applies background image/color to each slide
    //   3. All render functions use GYS theme tokens (colors, fonts) from the template

    let slideCount   = 0;
    let usedFallback = false;

    try {
      if (!pptData?.slides?.length) throw new Error("No slides in pptData");

      const slidesWithImages = assignImagesToSlides(pptData.slides, extractedImages);
      const total = slidesWithImages.length;

      slidesWithImages.forEach((sd, idx) => {
        const slide     = pptx.addSlide();
        const layout    = (sd.layout || "CONTENT").toUpperCase();

        // ✅ Pick the correct template background based on slide layout:
        //   - TITLE / SECTION / CLOSING → slide1Bg (template's title slide)
        //   - All other content layouts  → slide2Bg (template's content slide)
        // Must be called BEFORE any content so it renders behind everything.
        applyTemplateBackground(slide, GYS, pickSlideBg(GYS, layout));

        const pageLabel = `${idx + 1} / ${total}`;
        slideCount++;

        switch (layout) {
          case "TITLE":        renderTitle(pptx, slide, sd, GYS, pageLabel);       break;
          case "SECTION":      renderSection(pptx, slide, sd, GYS, pageLabel);     break;
          case "GRID":
            // Auto-upgrade to GRID_3X3 when there are 5–9 items
            if ((sd.items || []).length >= 5) {
              renderGrid3x3(pptx, slide, sd, GYS, pageLabel);
            } else {
              renderGrid(pptx, slide, sd, GYS, pageLabel);
            }
            break;
          case "GRID_3X3":     renderGrid3x3(pptx, slide, sd, GYS, pageLabel);    break;
          case "CONTENT":      renderContent(pptx, slide, sd, GYS, pageLabel);     break;
          case "TWO_COLUMN":
          case "TWOCOLUMN":    renderTwoColumn(pptx, slide, sd, GYS, pageLabel);   break;
          case "STATS":
          case "NUMBERS":      renderStats(pptx, slide, sd, GYS, pageLabel);       break;
          case "TIMELINE":
          case "ROADMAP":      renderTimeline(pptx, slide, sd, GYS, pageLabel);    break;
          case "CHART":        renderChart(pptx, slide, sd, GYS, pageLabel);       break;
          case "TABLE":        renderTable(pptx, slide, sd, GYS, pageLabel);       break;
          case "QUOTE":        renderQuote(pptx, slide, sd, GYS, pageLabel);       break;
          case "IMAGE_SLIDE":  renderImageSlide(pptx, slide, sd, GYS, pageLabel);  break;
          case "STATUS_SLIDE":
          case "STATUS":       renderStatusSlide(pptx, slide, sd, GYS, pageLabel); break;
          case "CLOSING":
          case "THANKYOU":
          case "THANK_YOU":    renderClosing(pptx, slide, sd, GYS, pageLabel);     break;
          default:             renderContent(pptx, slide, sd, GYS, pageLabel);     break;
        }
      });

    } catch (err) {
      console.warn("⚠️ [PPT] Render error — fallback:", err.message);
      usedFallback = true;
      slideCount   = 1;
      const slide  = pptx.addSlide();
      // Apply title slide background to fallback slide
      applyTemplateBackground(slide, GYS, pickSlideBg(GYS, 'TITLE'));
      renderTitle(pptx, slide, {
        title:    title || "GYS Presentation",
        subtitle: "Generated by GYS Portal AI",
      }, GYS, "1 / 1");
    }

    const safeTitle = (title || "Presentation")
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 40);
    const filename  = `GYS-${safeTitle}-${Date.now()}.pptx`;
    const filepath  = path.join(outputDir, filename);

    await pptx.writeFile({ fileName: filepath });
    console.log(`✅ [PPT] Generated: ${filename} (${slideCount} slides, template: ${templatePath ? 'yes' : 'no'})`);

    return {
      pptxFile:     filepath,
      pptxUrl:      `/api/files/${filename}`,
      pptxName:     filename,
      slideCount,
      usedFallback,
      styleDesc,
      usedTemplate: Boolean(templatePath),
    };
  },

  async generateFromAICode({ aiCode, fallbackContent, title, outputDir, styleDesc }) {
    const pptx  = new PptxGenJS();
    const GYS   = { ...GYS_DEFAULTS };
    pptx.layout  = "LAYOUT_16x9";
    pptx.author  = "GYS Portal AI";
    pptx.company = "PT Garuda Yamato Steel";
    pptx.title   = title || "Presentation";

    const slide = pptx.addSlide();
    renderTitle(pptx, slide, {
      title:    title || "GYS Presentation",
      subtitle: "Generated by GYS Portal AI — " + styleDesc,
    }, GYS, "1 / 1");

    const safeTitle = (title || "Presentation")
      .replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-").substring(0, 40);
    const filename  = `GYS-${safeTitle}-${Date.now()}.pptx`;
    const filepath  = path.join(outputDir, filename);

    await pptx.writeFile({ fileName: filepath });
    return { url: `/api/files/${filename}`, filename, slideCount: 1, usedFallback: false };
  },

  getStyleExamples() {
    return [
      'professional corporate executive',
      'modern minimal clean',
      'bold vibrant creative',
      'dark premium luxury',
    ];
  },
};

export default PptxService;