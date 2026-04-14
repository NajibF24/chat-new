// server/services/pptx.service.js
// ============================================================
// GYS Portal AI — Native PPTX Service
// ✅ PATCH:
//   1. Text overflow prevention — auto-scale font size based on content length
//   2. Table cell text truncation — prevents overflow in narrow columns
//   3. Bullet list auto-sizing — more bullets = smaller font
//   4. Grid card text auto-sizing — more cards = smaller text
//   5. Timeline card text auto-sizing
//   6. Template theme extraction (existing)
//   7. Image injection from knowledge base (existing)
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
// ✅ NEW: Smart font size helpers — prevent overflow
// ────────────────────────────────────────────────────────────

/**
 * Calculate font size for a text block that must fit in a given area.
 * @param {string} text - The text content
 * @param {number} maxChars - Max chars before reducing font
 * @param {number} baseFontSize - Starting font size
 * @param {number} minFontSize - Never go below this
 * @returns {number} font size in pt
 */
function calcFontSize(text, maxChars, baseFontSize, minFontSize = 8) {
  if (!text) return baseFontSize;
  const len = String(text).length;
  if (len <= maxChars) return baseFontSize;
  // Linear reduction: every extra 20% of maxChars → reduce 1pt
  const excess = (len - maxChars) / maxChars;
  const reduced = baseFontSize - Math.floor(excess * baseFontSize * 0.4);
  return Math.max(minFontSize, reduced);
}

/**
 * Truncate text to fit, adding ellipsis if needed.
 * Used for table cells and small card titles.
 */
function truncateText(text, maxLen) {
  if (!text) return '';
  const s = String(text);
  return s.length > maxLen ? s.substring(0, maxLen - 1) + '…' : s;
}

/**
 * Calculate font size for bullet lists based on item count and avg length.
 */
function bulletFontSize(bullets = [], containerH = 4.2, baseSize = 16, minSize = 9) {
  const count  = bullets.length;
  const avgLen = bullets.reduce((a, b) => a + String(b).length, 0) / Math.max(count, 1);

  // Estimate lines needed (rough: 1 line per ~60 chars at base size, 2 lines if longer)
  let estLines = 0;
  for (const b of bullets) {
    const chars = String(b).length;
    estLines += chars > 80 ? 2 : 1;
  }

  // Height per line estimate in inches (at 16pt ≈ 0.25in per line with spacing)
  const lineH = (baseSize / 72) * 1.35;
  const maxLines = Math.floor(containerH / lineH);

  if (estLines <= maxLines) return baseSize;

  // Need to shrink — calculate scale factor
  const scale = maxLines / estLines;
  const scaled = Math.floor(baseSize * scale);
  return Math.max(minSize, scaled);
}

// ────────────────────────────────────────────────────────────
// TEMPLATE PARSER
// ────────────────────────────────────────────────────────────
async function extractTemplateTheme(pptxFilePath) {
  const theme = { ...GYS_DEFAULTS };

  try {
    if (!pptxFilePath || !fs.existsSync(pptxFilePath)) return theme;

    const data   = fs.readFileSync(pptxFilePath);
    const zip    = await JSZip.loadAsync(data);

    const themeFiles = Object.keys(zip.files).filter(f =>
      f.match(/ppt\/theme\/theme\d*\.xml$/)
    );

    if (themeFiles.length > 0) {
      const themeXml = await zip.files[themeFiles[0]].async('string');

      const accentMatches = themeXml.matchAll(/<a:accent\d[^>]*>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/g);
      const accents = [];
      for (const m of accentMatches) accents.push(m[1].toUpperCase());

      if (accents.length > 0) {
        theme.teal       = accents[0];
        theme.tealAccent = accents[1] || accents[0];
        theme.chartColors = accents.slice(0, 6).length >= 2
          ? accents.slice(0, 6)
          : [accents[0], accents[0] + '88', accents[0] + '55', 'CCCCCC', 'AAAAAA', '888888'];
      }

      const dk1Match = themeXml.match(/<a:dk1>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
      const lt1Match = themeXml.match(/<a:lt1>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
      if (dk1Match) theme.darkText = dk1Match[1].toUpperCase();
      if (lt1Match) theme.white    = lt1Match[1].toUpperCase();
    }

    const themeXml2 = themeFiles.length > 0
      ? await zip.files[themeFiles[0]].async('string')
      : '';
    const fontMatch = themeXml2.match(/<a:latin\s+typeface="([^"]+)"/);
    if (fontMatch) {
      theme.fontTitle = fontMatch[1];
      theme.fontBody  = fontMatch[1];
    }

    const layoutFiles = Object.keys(zip.files).filter(f =>
      f.match(/ppt\/slideLayouts\/slideLayout\d+\.xml$/)
    );
    if (layoutFiles.length > 0) {
      const layoutXml = await zip.files[layoutFiles[0]].async('string');
      const bgMatch   = layoutXml.match(/<p:bg>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
      if (bgMatch) theme.offWhite = bgMatch[1].toUpperCase();
    }

    console.log(`[PPT Template] Extracted theme — primary: #${theme.teal}, font: ${theme.fontTitle}`);

  } catch (err) {
    console.warn('[PPT Template] Theme extraction failed, using defaults:', err.message);
  }

  theme.tealDark  = theme.teal;
  theme.tealMid   = theme.tealAccent || theme.teal;
  theme.tealLight = theme.offWhite || 'F0F9F6';

  return theme;
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
  // ✅ Auto-shrink slide title if very long
  const titleStr = String(title || '');
  const titleSize = calcFontSize(titleStr, 50, 24, 14);
  slide.addText(titleStr, {
    x: 0.95, y: 0.1, w: 8.8, h: 0.6,
    fontSize: titleSize, bold: true, color: GYS.darkText, valign: "middle",
    fontFace: GYS.fontTitle,
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

  if (imagePath && fs.existsSync(imagePath)) {
    if (bodyText) {
      slide.addImage({
        path: imagePath,
        x: 0.22, y: 0.95, w: 5.0, h: 4.2,
        sizing: { type: 'contain', w: 5.0, h: 4.2 },
      });
      // ✅ Auto-size body text
      const bodyFs = calcFontSize(bodyText, 200, 14, 9);
      slide.addText(bodyText, {
        x: 5.4, y: 1.0, w: 4.3, h: 3.8,
        fontSize: bodyFs, color: GYS.bodyText, wrap: true, valign: "top",
        fontFace: GYS.fontBody, lineSpacingMultiple: 1.35,
      });
      if (caption) {
        slide.addText(caption, {
          x: 0.22, y: 5.15, w: 5.0, h: 0.18,
          fontSize: 9, color: GYS.mutedText, italic: true, fontFace: GYS.fontBody,
        });
      }
    } else {
      slide.addImage({
        path: imagePath,
        x: 0.3, y: 0.95, w: 9.4, h: 4.1,
        sizing: { type: 'contain', w: 9.4, h: 4.1 },
      });
      if (caption) {
        slide.addText(caption, {
          x: 0.3, y: 5.1, w: 9.4, h: 0.18,
          fontSize: 9, color: GYS.mutedText, align: "center", italic: true,
          fontFace: GYS.fontBody,
        });
      }
    }
  } else {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.3, y: 0.95, w: 9.4, h: 4.1,
      fill: { color: GYS.tealLight }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.1,
    });
    slide.addText('🖼️ Image\n' + (caption || 'Visual'), {
      x: 0.3, y: 0.95, w: 9.4, h: 4.1,
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
  // ✅ Auto-size main title
  const mainTitle = String(data.title || "Presentation Title");
  const titleFs   = calcFontSize(mainTitle, 40, 44, 24);
  slide.addText(mainTitle, {
    x: 0.5, y: 1.75, w: 8.5, h: 1.8,
    fontSize: titleFs, bold: true, color: GYS.white, wrap: true,
    fontFace: GYS.fontTitle, lineSpacingMultiple: 1.1,
  });
  if (data.subtitle) {
    const subFs = calcFontSize(String(data.subtitle), 80, 18, 12);
    slide.addText(data.subtitle, {
      x: 0.5, y: 3.6, w: 7.5, h: 0.65,
      fontSize: subFs, color: "A8D5C2", fontFace: GYS.fontBody, lineSpacingMultiple: 1.2,
    });
  }
  const metaLine = [data.presenter, data.date].filter(Boolean).join("   •   ");
  if (metaLine) {
    slide.addText(metaLine, {
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
  const stFs = calcFontSize(sectionTitle, 30, 36, 20);
  slide.addText(sectionTitle, {
    x: 3.3, y: 1.6, w: 6.3, h: 1.4,
    fontSize: stFs, bold: true, color: GYS.darkText, valign: "middle",
    fontFace: GYS.fontTitle, wrap: true,
  });
  if (data.subtitle) {
    const ssFs = calcFontSize(String(data.subtitle), 100, 16, 10);
    slide.addText(data.subtitle, {
      x: 3.3, y: 3.1, w: 6.3, h: 0.9,
      fontSize: ssFs, color: GYS.bodyText, valign: "top",
      fontFace: GYS.fontBody, wrap: true, lineSpacingMultiple: 1.3,
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

    // ✅ Auto-size card title
    const cardTitle   = truncateText(item.title || "Item", count <= 2 ? 40 : 25);
    const cardTitleFs = count <= 2 ? 16 : 13;
    slide.addText(cardTitle, {
      x: cx + 0.1, y: cardY + 0.88, w: cardW - 0.2, h: 0.55,
      fontSize: cardTitleFs, bold: true, color: GYS.darkText,
      align: "center", wrap: true, fontFace: GYS.fontTitle,
    });

    // ✅ Auto-size card body text based on available area and content length
    const cardText      = String(item.text || "");
    const textAreaH     = 2.15;
    // Estimate max chars per line given card width
    const charsPerLine  = Math.floor((cardW - 0.28) / (0.09 * (count <= 2 ? 13 : 11)));
    const maxCharsForH  = charsPerLine * Math.floor(textAreaH / 0.18);
    const cardBodyFs    = calcFontSize(cardText, maxCharsForH, count <= 2 ? 13 : 11, 8);

    slide.addText(cardText, {
      x: cx + 0.14, y: cardY + 1.48, w: cardW - 0.28, h: textAreaH,
      fontSize: cardBodyFs, color: GYS.bodyText,
      valign: "top", wrap: true, fontFace: GYS.fontBody, lineSpacingMultiple: 1.25,
      // ✅ autoFit tells PptxGenJS to shrink text to fit the box
      autoFit: true,
    });
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
  const textW     = hasImage ? 5.0 : 9.3;
  const textX     = 0.32;
  const textH     = 4.2;

  if (hasImage) {
    slide.addImage({
      path: imagePath,
      x: 5.5, y: 1.0, w: 4.2, h: 4.2,
      sizing: { type: 'contain', w: 4.2, h: 4.2 },
    });
    if (data.caption) {
      slide.addText(data.caption, {
        x: 5.5, y: 5.1, w: 4.2, h: 0.16,
        fontSize: 8, color: GYS.mutedText, italic: true, align: "center",
        fontFace: GYS.fontBody,
      });
    }
  }

  if (bullets.length > 0) {
    // ✅ Auto-size bullets based on count and length
    const baseFontSize = hasImage ? 14 : 16;
    const fs_size = bulletFontSize(bullets, textH, baseFontSize, 9);

    const bulletItems = bullets.map(b => {
      const raw  = typeof b === "string" ? b : String(b);
      const isSub = raw.startsWith("  ") || raw.startsWith("\t") || raw.startsWith("- ");
      const text  = raw.replace(/^[\s\t-]+/, "");
      return {
        text,
        options: {
          bullet:      isSub ? { indent: 20 } : { type: "bullet" },
          color:       isSub ? GYS.mutedText : GYS.bodyText,
          fontSize:    isSub ? Math.max(8, fs_size - 2) : fs_size,
          breakLine:   true,
          indentLevel: isSub ? 1 : 0,
        },
      };
    });
    slide.addText(bulletItems, {
      x: textX, y: 1.0, w: textW, h: textH,
      fontFace: GYS.fontBody, valign: "top",
      paraSpaceAfter: bullets.length > 8 ? 4 : 9,
      lineSpacingMultiple: bullets.length > 8 ? 1.1 : 1.25,
      // ✅ autoFit shrinks if still doesn't fit
      autoFit: true,
    });
  } else if (data.body) {
    const bodyFs = calcFontSize(String(data.body), 300, 16, 10);
    slide.addText(data.body, {
      x: textX, y: 1.0, w: textW, h: textH,
      fontSize: bodyFs, color: GYS.bodyText, wrap: true, valign: "top",
      fontFace: GYS.fontBody, lineSpacingMultiple: 1.4,
      autoFit: true,
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
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.22, y: 1.0, w: 4.6, h: 4.2,
    fill: { color: GYS.cardWhite }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.1,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 5.18, y: 1.0, w: 4.6, h: 4.2,
    fill: { color: GYS.cardWhite }, line: { color: GYS.teal, width: 2 }, rectRadius: 0.1,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.22, y: 1.0, w: 4.6, h: 0.5,
    fill: { color: GYS.tealLight }, line: { type: "none" }, rectRadius: 0.1,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 5.18, y: 1.0, w: 4.6, h: 0.5,
    fill: { color: GYS.teal }, line: { type: "none" }, rectRadius: 0.1,
  });
  if (data.leftTitle) {
    slide.addText(truncateText(data.leftTitle, 35), {
      x: 0.38, y: 1.02, w: 4.3, h: 0.44,
      fontSize: calcFontSize(data.leftTitle, 30, 14, 10), bold: true, color: GYS.teal,
      valign: "middle", fontFace: GYS.fontTitle,
    });
  }
  if (data.rightTitle) {
    slide.addText(truncateText(data.rightTitle, 35), {
      x: 5.3, y: 1.02, w: 4.3, h: 0.44,
      fontSize: calcFontSize(data.rightTitle, 30, 14, 10), bold: true, color: GYS.white,
      valign: "middle", fontFace: GYS.fontTitle,
    });
  }
  const leftBullets  = (data.leftBullets  || data.left  || []).filter(Boolean);
  const rightBullets = (data.rightBullets || data.right || []).filter(Boolean);
  const colH = 3.4;

  if (leftBullets.length) {
    const lfs = bulletFontSize(leftBullets, colH, 14, 9);
    slide.addText(
      leftBullets.map(b => ({ text: String(b), options: { bullet: true, breakLine: true } })),
      { x: 0.38, y: 1.6, w: 4.3, h: colH,
        fontSize: lfs, color: GYS.bodyText, fontFace: GYS.fontBody, valign: "top",
        paraSpaceAfter: leftBullets.length > 6 ? 4 : 9,
        lineSpacingMultiple: leftBullets.length > 6 ? 1.1 : 1.3,
        autoFit: true,
      }
    );
  }
  if (rightBullets.length) {
    const rfs = bulletFontSize(rightBullets, colH, 14, 9);
    slide.addText(
      rightBullets.map(b => ({ text: String(b), options: { bullet: true, breakLine: true } })),
      { x: 5.3, y: 1.6, w: 4.3, h: colH,
        fontSize: rfs, color: GYS.bodyText, fontFace: GYS.fontBody, valign: "top",
        paraSpaceAfter: rightBullets.length > 6 ? 4 : 9,
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
    const textColor = isDark ? GYS.white   : GYS.darkText;
    const subColor  = isDark ? "A8D5C2"   : GYS.mutedText;
    const valColor  = isDark ? GYS.white   : GYS.teal;

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
    const valueY   = s.icon ? cardY + 0.95 : cardY + 0.6;
    // ✅ Auto-size value (big numbers / long text)
    const valStr   = String(s.value || "—");
    const valueFsBase = count <= 2 ? 52 : count === 3 ? 44 : 36;
    const valueFs  = calcFontSize(valStr, 8, valueFsBase, 20);

    slide.addText(valStr, {
      x: cx + 0.08, y: valueY, w: cardW - 0.16, h: 1.1,
      fontSize: valueFs, bold: true, color: valColor, align: "center",
      fontFace: GYS.fontTitle, autoFit: true,
    });
    slide.addText(truncateText(s.label || "", 40), {
      x: cx + 0.08, y: valueY + 1.1, w: cardW - 0.16, h: 0.6,
      fontSize: calcFontSize(s.label || '', 25, 14, 9), bold: true,
      color: textColor, align: "center", wrap: true, fontFace: GYS.fontBody,
    });
    if (s.sub) {
      slide.addText(truncateText(String(s.sub), 60), {
        x: cx + 0.08, y: valueY + 1.72, w: cardW - 0.16, h: 0.8,
        fontSize: calcFontSize(s.sub, 50, 11, 8), color: subColor, align: "center",
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

    // ✅ Auto-size time label
    const timeStr = String(step.time || `Step ${i + 1}`);
    const timeFs  = calcFontSize(timeStr, 12, 10, 7);
    slide.addText(timeStr, {
      x: cx - stepW * 0.44, y: lineY - 0.9, w: stepW * 0.88, h: 0.38,
      fontSize: timeFs, bold: true, color: GYS.tealAccent,
      align: "center", fontFace: GYS.fontTitle, wrap: true,
    });

    const cardX = cx - stepW * 0.44;
    const cardY = lineY + 0.42;
    const cardW = stepW * 0.88;
    const cardH = 2.45;

    slide.addShape(pptx.ShapeType.roundRect, {
      x: cardX, y: cardY, w: cardW, h: cardH,
      fill: { color: GYS.cardWhite }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.1,
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: cardX, y: cardY, w: cardW, h: 0.1,
      fill: { color: GYS.teal }, line: { type: "none" }, rectRadius: 0.05,
    });

    // ✅ Auto-size step title
    const stepTitle = String(step.title || "Phase");
    const stTitleFs = calcFontSize(stepTitle, count <= 3 ? 20 : 15, count <= 3 ? 13 : 11, 8);
    slide.addText(stepTitle, {
      x: cardX + 0.1, y: cardY + 0.12, w: cardW - 0.2, h: 0.55,
      fontSize: stTitleFs, bold: true, color: GYS.darkText,
      wrap: true, fontFace: GYS.fontTitle, valign: "top",
    });

    // ✅ Auto-size step body text
    const stepText   = String(step.text || "");
    const stepBodyFs = calcFontSize(stepText, count <= 3 ? 80 : 60, count <= 3 ? 12 : 10, 7);
    slide.addText(stepText, {
      x: cardX + 0.1, y: cardY + 0.68, w: cardW - 0.2, h: 1.65,
      fontSize: stepBodyFs, color: GYS.bodyText,
      wrap: true, fontFace: GYS.fontBody, valign: "top",
      lineSpacingMultiple: 1.2,
      autoFit: true,
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

  if (hasInsight) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.18, y: 1.0, w: 3.0, h: 4.15,
      fill: { color: GYS.tealLight }, line: { color: GYS.grayBorder, width: 1 }, rectRadius: 0.1,
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.18, y: 1.0, w: 3.0, h: 0.42,
      fill: { color: GYS.teal }, line: { type: "none" }, rectRadius: 0.1,
    });
    slide.addText("Key Insight", {
      x: 0.28, y: 1.02, w: 2.8, h: 0.38,
      fontSize: 12, bold: true, color: GYS.white, valign: "middle", fontFace: GYS.fontTitle,
    });
    // ✅ Auto-size insight text
    const insightFs = calcFontSize(String(data.insightText), 150, 13, 9);
    slide.addText(data.insightText, {
      x: 0.28, y: 1.5, w: 2.8, h: 3.5,
      fontSize: insightFs, color: GYS.bodyText, wrap: true, valign: "top",
      fontFace: GYS.fontBody, lineSpacingMultiple: 1.35,
      autoFit: true,
    });
  }

  const chartX = hasInsight ? 3.4 : 0.25;
  const chartW = hasInsight ? 6.3 : 9.5;

  if (chartData.length > 0) {
    slide.addChart(chartType, chartData, {
      x: chartX, y: 1.0, w: chartW, h: 4.15,
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

  const colCount = Math.max(headers.length, rows[0] ? (Array.isArray(rows[0]) ? rows[0].length : 1) : 1);

  // ✅ Auto font size based on column count and row count
  const totalRows = rows.length + (headers.length ? 1 : 0);
  let headerFs = 12;
  let cellFs   = 11;
  if (colCount >= 5 || totalRows >= 8)  { headerFs = 10; cellFs = 9;  }
  if (colCount >= 6 || totalRows >= 12) { headerFs = 9;  cellFs = 8;  }

  // ✅ Max chars per cell based on column count
  const maxCellChars = Math.floor(120 / colCount);

  const tableData = [];
  if (headers.length) {
    tableData.push(
      headers.map(h => ({
        text: truncateText(String(h), maxCellChars + 10), // headers can be a bit longer
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
        // ✅ Truncate cell text to prevent overflow
        text: truncateText(String(cell ?? ""), maxCellChars),
        options: {
          color: GYS.bodyText, fill: ri % 2 === 0 ? GYS.cardWhite : GYS.offWhite,
          fontSize: cellFs, valign: "middle", align: "left",
          bold: ci === 0, fontFace: GYS.fontBody,
        },
      }))
    );
  });

  const totalTableRows = tableData.length;
  const rowH = Math.min(0.55, 4.15 / Math.max(totalTableRows, 1));
  slide.addTable(tableData, {
    x: 0.25, y: 1.0, w: 9.5, h: 4.15,
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
  const quoteFs   = calcFontSize(quoteText, 100, 24, 14);
  slide.addText(quoteText, {
    x: 0.8, y: 1.5, w: 8.4, h: 2.5,
    fontSize: quoteFs, color: GYS.white, italic: true,
    wrap: true, align: "center", valign: "middle",
    fontFace: "Georgia", lineSpacingMultiple: 1.3,
    autoFit: true,
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
  const ctFs = calcFontSize(closingTitle, 20, 52, 28);
  slide.addText(closingTitle, {
    x: 0.6, y: 1.8, w: 8.8, h: 1.4,
    fontSize: ctFs, bold: true, color: GYS.white, align: "center", fontFace: GYS.fontTitle,
  });
  if (data.subtitle) {
    slide.addText(truncateText(data.subtitle, 80), {
      x: 0.6, y: 3.3, w: 8.8, h: 0.7,
      fontSize: calcFontSize(data.subtitle, 60, 18, 12), color: "A8D5C2",
      align: "center", fontFace: GYS.fontBody,
    });
  }
  if (data.contact) {
    slide.addText(truncateText(data.contact, 80), {
      x: 0.6, y: 4.05, w: 8.8, h: 0.35,
      fontSize: 13, color: "7BC8AD", align: "center", fontFace: GYS.fontBody,
    });
  }
  addFooter(slide, pptx, GYS, pageLabel);
}

// ────────────────────────────────────────────────────────────
// IMAGE PLACEMENT ALGORITHM
// ────────────────────────────────────────────────────────────
function assignImagesToSlides(slides, extractedImages) {
  if (!extractedImages || extractedImages.length === 0) return slides;

  const assigned = [...slides];
  const images   = [...extractedImages];
  let   imgIdx   = 0;

  // Pass 1: Assign images to CONTENT slides that don't yet have images
  for (let i = 0; i < assigned.length; i++) {
    if (imgIdx >= images.length) break;
    const s = assigned[i];
    if (['CONTENT', 'GRID'].includes((s.layout || '').toUpperCase()) && !s.imagePath) {
      assigned[i] = { ...s, imagePath: images[imgIdx].path, caption: images[imgIdx].caption };
      imgIdx++;
    }
  }

  // Pass 2: Remaining images get their own IMAGE_SLIDE
  while (imgIdx < images.length) {
    const img = images[imgIdx];
    const closingIdx = assigned.findIndex(s => ['CLOSING', 'THANKYOU'].includes((s.layout || '').toUpperCase()));
    const insertAt   = closingIdx > 0 ? closingIdx : assigned.length;

    assigned.splice(insertAt, 0, {
      layout:    'IMAGE_SLIDE',
      title:     `Visual: ${img.sourceFile || 'Document'}`,
      imagePath: img.path,
      caption:   img.caption,
      body:      '',
    });
    imgIdx++;
  }

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

    const GYS = templatePath
      ? await extractTemplateTheme(templatePath)
      : { ...GYS_DEFAULTS };

    const pptx = new PptxGenJS();
    pptx.layout  = "LAYOUT_16x9";
    pptx.author  = "GYS Portal AI";
    pptx.company = "PT Garuda Yamato Steel";
    pptx.subject = title || "Presentation";
    pptx.title   = title || "Presentation";

    let slideCount   = 0;
    let usedFallback = false;

    try {
      if (!pptData?.slides?.length) throw new Error("No slides in pptData");

      const slidesWithImages = assignImagesToSlides(pptData.slides, extractedImages);
      const total = slidesWithImages.length;

      slidesWithImages.forEach((sd, idx) => {
        const slide     = pptx.addSlide();
        const pageLabel = `${idx + 1} / ${total}`;
        slideCount++;

        const layout = (sd.layout || "CONTENT").toUpperCase();

        switch (layout) {
          case "TITLE":       renderTitle(pptx, slide, sd, GYS, pageLabel);      break;
          case "SECTION":     renderSection(pptx, slide, sd, GYS, pageLabel);    break;
          case "GRID":        renderGrid(pptx, slide, sd, GYS, pageLabel);       break;
          case "CONTENT":     renderContent(pptx, slide, sd, GYS, pageLabel);    break;
          case "TWO_COLUMN":
          case "TWOCOLUMN":   renderTwoColumn(pptx, slide, sd, GYS, pageLabel);  break;
          case "STATS":
          case "NUMBERS":     renderStats(pptx, slide, sd, GYS, pageLabel);      break;
          case "TIMELINE":
          case "ROADMAP":     renderTimeline(pptx, slide, sd, GYS, pageLabel);   break;
          case "CHART":       renderChart(pptx, slide, sd, GYS, pageLabel);      break;
          case "TABLE":       renderTable(pptx, slide, sd, GYS, pageLabel);      break;
          case "QUOTE":       renderQuote(pptx, slide, sd, GYS, pageLabel);      break;
          case "IMAGE_SLIDE": renderImageSlide(pptx, slide, sd, GYS, pageLabel); break;
          case "CLOSING":
          case "THANKYOU":
          case "THANK_YOU":   renderClosing(pptx, slide, sd, GYS, pageLabel);    break;
          default:            renderContent(pptx, slide, sd, GYS, pageLabel);    break;
        }
      });

    } catch (err) {
      console.warn("⚠️ [PPT] Render error — fallback:", err.message);
      usedFallback = true;
      slideCount = 1;
      const slide = pptx.addSlide();
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

  // Backward compat with routes/pptx.js
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