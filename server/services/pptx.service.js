// server/services/pptx.service.js
// ============================================================
// GYS Portal AI — Native PPTX Service
// ✅ UPDATED:
//   1. Template PPTX matching — reads colors/fonts from uploaded template
//   2. Image extraction integration — places extracted images from Word/PPTX
//      into slides intelligently based on context
//
// Layouts: TITLE, SECTION, GRID, CONTENT, TWO_COLUMN,
//          STATS, TIMELINE, CHART, TABLE, QUOTE, IMAGE_SLIDE, CLOSING
// ============================================================

import PptxGenJS from "pptxgenjs";
import path from "path";
import fs from "fs";
import JSZip from "jszip";

export const HTML_SLIDE_SYSTEM_PROMPT = "";

// ────────────────────────────────────────────────────────────
// GYS BRAND TOKENS (defaults — overridden if template provided)
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
// TEMPLATE PARSER — Extract brand colors & fonts from uploaded PPTX
// ────────────────────────────────────────────────────────────
async function extractTemplateTheme(pptxFilePath) {
  const theme = { ...GYS_DEFAULTS };

  try {
    if (!pptxFilePath || !fs.existsSync(pptxFilePath)) return theme;

    const data   = fs.readFileSync(pptxFilePath);
    const zip    = await JSZip.loadAsync(data);

    // ── 1. Read theme XML for colors ──────────────────────────
    const themeFiles = Object.keys(zip.files).filter(f =>
      f.match(/ppt\/theme\/theme\d*\.xml$/)
    );

    if (themeFiles.length > 0) {
      const themeXml = await zip.files[themeFiles[0]].async('string');

      // Extract accent colors from <a:accent1> through <a:accent6>
      const accentMatches = themeXml.matchAll(/<a:accent\d[^>]*>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/g);
      const accents = [];
      for (const m of accentMatches) accents.push(m[1].toUpperCase());

      if (accents.length > 0) {
        theme.teal       = accents[0];  // primary accent
        theme.tealAccent = accents[1] || accents[0];
        theme.chartColors = accents.slice(0, 6).length >= 2
          ? accents.slice(0, 6)
          : [accents[0], accents[0] + '88', accents[0] + '55', 'CCCCCC', 'AAAAAA', '888888'];
      }

      // Dark/light background colors
      const dk1Match  = themeXml.match(/<a:dk1>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
      const lt1Match  = themeXml.match(/<a:lt1>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
      if (dk1Match) theme.darkText = dk1Match[1].toUpperCase();
      if (lt1Match) theme.white    = lt1Match[1].toUpperCase();
    }

    // ── 2. Read font from theme ───────────────────────────────
    const themeXml2 = themeFiles.length > 0
      ? await zip.files[themeFiles[0]].async('string')
      : '';
    const fontMatch = themeXml2.match(/<a:latin\s+typeface="([^"]+)"/);
    if (fontMatch) {
      theme.fontTitle = fontMatch[1];
      theme.fontBody  = fontMatch[1];
    }

    // ── 3. Read slide background from first slide layout ──────
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

  // Derive secondary colors from primary
  theme.tealDark  = theme.teal;
  theme.tealMid   = theme.tealAccent || theme.teal;
  theme.tealLight = theme.offWhite || 'F0F9F6';

  return theme;
}

// ────────────────────────────────────────────────────────────
// SHARED HELPERS (use GYS tokens, passed as param)
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
  slide.addText(title || "", {
    x: 0.95, y: 0.1, w: 8.8, h: 0.6,
    fontSize: 24, bold: true, color: GYS.darkText, valign: "middle",
    fontFace: GYS.fontTitle,
  });
}

// ────────────────────────────────────────────────────────────
// NEW: IMAGE_SLIDE layout — for slides that prominently feature
// an extracted image with summary text
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
  const bodyText  = data.body || data.bullets?.join('\n') || '';

  if (imagePath && fs.existsSync(imagePath)) {
    if (bodyText) {
      // Two-column: image left, text right
      slide.addImage({
        path: imagePath,
        x: 0.22, y: 0.95, w: 5.0, h: 4.2,
        sizing: { type: 'contain', w: 5.0, h: 4.2 },
      });

      slide.addText(bodyText, {
        x: 5.4, y: 1.0, w: 4.3, h: 3.8,
        fontSize: 14, color: GYS.bodyText, wrap: true, valign: "top",
        fontFace: GYS.fontBody, lineSpacingMultiple: 1.35,
      });

      if (caption) {
        slide.addText(caption, {
          x: 0.22, y: 5.15, w: 5.0, h: 0.18,
          fontSize: 9, color: GYS.mutedText, italic: true,
          fontFace: GYS.fontBody,
        });
      }
    } else {
      // Full-width image
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
    // Fallback: show placeholder box
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
// SLIDE RENDERERS (all updated to accept GYS token object)
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
  slide.addText(data.title || "Presentation Title", {
    x: 0.5, y: 1.75, w: 8.5, h: 1.8,
    fontSize: 44, bold: true, color: GYS.white, wrap: true,
    fontFace: GYS.fontTitle, lineSpacingMultiple: 1.1,
  });
  if (data.subtitle) {
    slide.addText(data.subtitle, {
      x: 0.5, y: 3.6, w: 7.5, h: 0.65,
      fontSize: 18, color: "A8D5C2", fontFace: GYS.fontBody, lineSpacingMultiple: 1.2,
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
  slide.addText(data.title || "Section", {
    x: 3.3, y: 1.6, w: 6.3, h: 1.4,
    fontSize: 36, bold: true, color: GYS.darkText, valign: "middle",
    fontFace: GYS.fontTitle, wrap: true,
  });
  if (data.subtitle) {
    slide.addText(data.subtitle, {
      x: 3.3, y: 3.1, w: 6.3, h: 0.9,
      fontSize: 16, color: GYS.bodyText, valign: "top",
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

  const items = (data.items || []).slice(0, 4);
  const count = Math.max(items.length, 1);
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
    const iconBgX = cx + (cardW - iconBgSize) / 2;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: iconBgX, y: cardY + 0.22, w: iconBgSize, h: iconBgSize,
      fill: { color: GYS.tealLight }, line: { type: "none" },
    });
    slide.addText(item.icon || "💠", {
      x: iconBgX, y: cardY + 0.22, w: iconBgSize, h: iconBgSize,
      fontSize: count <= 2 ? 22 : 18, align: "center", valign: "middle",
    });
    slide.addText(item.title || "Item", {
      x: cx + 0.12, y: cardY + 0.88, w: cardW - 0.24, h: 0.55,
      fontSize: count <= 2 ? 16 : 14, bold: true, color: GYS.darkText,
      align: "center", wrap: true, fontFace: GYS.fontTitle,
    });
    slide.addText(item.text || "", {
      x: cx + 0.14, y: cardY + 1.48, w: cardW - 0.28, h: 2.15,
      fontSize: count <= 2 ? 13 : 12, color: GYS.bodyText,
      valign: "top", wrap: true, fontFace: GYS.fontBody, lineSpacingMultiple: 1.3,
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

  // ✅ NEW: If slide has an associated image, show it alongside text
  const imagePath = data.imagePath;
  const hasImage  = imagePath && fs.existsSync(imagePath);
  const bullets   = (data.bullets || []).filter(Boolean);
  const textW     = hasImage ? 5.0 : 9.3;
  const textX     = 0.32;

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
    const bulletItems = bullets.map(b => {
      const raw = typeof b === "string" ? b : String(b);
      const isSub = raw.startsWith("  ") || raw.startsWith("\t") || raw.startsWith("- ");
      const text  = raw.replace(/^[\s\t-]+/, "");
      return {
        text,
        options: {
          bullet:      isSub ? { indent: 20 } : { type: "bullet" },
          color:       isSub ? GYS.mutedText : GYS.bodyText,
          fontSize:    isSub ? 13 : 16,
          breakLine:   true,
          indentLevel: isSub ? 1 : 0,
        },
      };
    });
    slide.addText(bulletItems, {
      x: textX, y: 1.0, w: textW, h: 4.2,
      fontFace: GYS.fontBody, valign: "top",
      paraSpaceAfter: 9, lineSpacingMultiple: 1.25,
    });
  } else if (data.body) {
    slide.addText(data.body, {
      x: textX, y: 1.0, w: textW, h: 4.2,
      fontSize: 16, color: GYS.bodyText, wrap: true, valign: "top",
      fontFace: GYS.fontBody, lineSpacingMultiple: 1.4,
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
    slide.addText(data.leftTitle, {
      x: 0.38, y: 1.02, w: 4.3, h: 0.44,
      fontSize: 14, bold: true, color: GYS.teal, valign: "middle", fontFace: GYS.fontTitle,
    });
  }
  if (data.rightTitle) {
    slide.addText(data.rightTitle, {
      x: 5.3, y: 1.02, w: 4.3, h: 0.44,
      fontSize: 14, bold: true, color: GYS.white, valign: "middle", fontFace: GYS.fontTitle,
    });
  }
  const leftBullets  = (data.leftBullets  || data.left  || []).filter(Boolean);
  const rightBullets = (data.rightBullets || data.right || []).filter(Boolean);
  if (leftBullets.length) {
    slide.addText(
      leftBullets.map(b => ({ text: b, options: { bullet: true, breakLine: true } })),
      { x: 0.38, y: 1.6, w: 4.3, h: 3.4, fontSize: 14, color: GYS.bodyText,
        fontFace: GYS.fontBody, valign: "top", paraSpaceAfter: 9, lineSpacingMultiple: 1.3 }
    );
  }
  if (rightBullets.length) {
    slide.addText(
      rightBullets.map(b => ({ text: b, options: { bullet: true, breakLine: true } })),
      { x: 5.3, y: 1.6, w: 4.3, h: 3.4, fontSize: 14, color: GYS.bodyText,
        fontFace: GYS.fontBody, valign: "top", paraSpaceAfter: 9, lineSpacingMultiple: 1.3 }
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
    const textColor = isDark ? GYS.white : GYS.darkText;
    const subColor  = isDark ? "A8D5C2" : GYS.mutedText;
    const valColor  = isDark ? GYS.white : GYS.teal;
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
    const valueY = s.icon ? cardY + 0.95 : cardY + 0.6;
    slide.addText(s.value || "—", {
      x: cx + 0.08, y: valueY, w: cardW - 0.16, h: 1.1,
      fontSize: count <= 2 ? 52 : count === 3 ? 44 : 36,
      bold: true, color: valColor, align: "center", fontFace: GYS.fontTitle,
    });
    slide.addText(s.label || "", {
      x: cx + 0.08, y: valueY + 1.1, w: cardW - 0.16, h: 0.6,
      fontSize: 14, bold: true, color: textColor, align: "center",
      wrap: true, fontFace: GYS.fontBody,
    });
    if (s.sub) {
      slide.addText(s.sub, {
        x: cx + 0.08, y: valueY + 1.72, w: cardW - 0.16, h: 0.8,
        fontSize: 11, color: subColor, align: "center",
        wrap: true, fontFace: GYS.fontBody,
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
  const lineLen = GYS.slideW - padX * 2;
  slide.addShape(pptx.ShapeType.rect, {
    x: padX, y: lineY - 0.025, w: lineLen, h: 0.05,
    fill: { color: GYS.tealLight }, line: { type: "none" },
  });
  const stepW    = lineLen / count;
  const nodeSize = 0.36;
  steps.forEach((step, i) => {
    const cx   = padX + i * stepW + stepW / 2;
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
    slide.addText(step.time || `Step ${i + 1}`, {
      x: cx - stepW * 0.44, y: lineY - 0.9, w: stepW * 0.88, h: 0.38,
      fontSize: 10, bold: true, color: GYS.tealAccent,
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
    slide.addText(step.title || "Phase", {
      x: cardX + 0.1, y: cardY + 0.12, w: cardW - 0.2, h: 0.55,
      fontSize: count <= 3 ? 13 : 11, bold: true, color: GYS.darkText,
      wrap: true, fontFace: GYS.fontTitle, valign: "top",
    });
    slide.addText(step.text || "", {
      x: cardX + 0.1, y: cardY + 0.68, w: cardW - 0.2, h: 1.65,
      fontSize: count <= 3 ? 12 : 10, color: GYS.bodyText,
      wrap: true, fontFace: GYS.fontBody, valign: "top", lineSpacingMultiple: 1.25,
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
  const cfg      = data.chartConfig || {};
  const rawType  = (cfg.type || "bar").toLowerCase();
  let chartType  = pptx.ChartType.bar;
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
    slide.addText(data.insightText, {
      x: 0.28, y: 1.5, w: 2.8, h: 3.5,
      fontSize: 13, color: GYS.bodyText, wrap: true, valign: "top",
      fontFace: GYS.fontBody, lineSpacingMultiple: 1.35,
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
  const tableData = [];
  if (headers.length) {
    tableData.push(
      headers.map(h => ({
        text: String(h),
        options: {
          bold: true, color: GYS.white, fill: GYS.teal,
          align: "left", fontSize: 12, valign: "middle", fontFace: GYS.fontTitle,
        },
      }))
    );
  }
  rows.forEach((row, ri) => {
    tableData.push(
      (Array.isArray(row) ? row : [row]).map((cell, ci) => ({
        text: String(cell ?? ""),
        options: {
          color: GYS.bodyText, fill: ri % 2 === 0 ? GYS.cardWhite : GYS.offWhite,
          fontSize: 11, valign: "middle", align: "left",
          bold: ci === 0, fontFace: GYS.fontBody,
        },
      }))
    );
  });
  const totalRows = tableData.length;
  const rowH = Math.min(0.55, 4.15 / Math.max(totalRows, 1));
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
  slide.addText(data.quote || data.title || "", {
    x: 0.8, y: 1.5, w: 8.4, h: 2.5,
    fontSize: 24, color: GYS.white, italic: true,
    wrap: true, align: "center", valign: "middle",
    fontFace: "Georgia", lineSpacingMultiple: 1.3,
  });
  if (data.author) {
    slide.addText("— " + data.author, {
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
  slide.addText(data.title || "Thank You", {
    x: 0.6, y: 1.8, w: 8.8, h: 1.4,
    fontSize: 52, bold: true, color: GYS.white, align: "center", fontFace: GYS.fontTitle,
  });
  if (data.subtitle) {
    slide.addText(data.subtitle, {
      x: 0.6, y: 3.3, w: 8.8, h: 0.7,
      fontSize: 18, color: "A8D5C2", align: "center", fontFace: GYS.fontBody,
    });
  }
  if (data.contact) {
    slide.addText(data.contact, {
      x: 0.6, y: 4.05, w: 8.8, h: 0.35,
      fontSize: 13, color: "7BC8AD", align: "center", fontFace: GYS.fontBody,
    });
  }
  addFooter(slide, pptx, GYS, pageLabel);
}

// ────────────────────────────────────────────────────────────
// IMAGE PLACEMENT ALGORITHM
// Decides which slides get which images from knowledge base
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
    // Insert IMAGE_SLIDE before the CLOSING slide if possible
    const closingIdx = assigned.findIndex(s => ['CLOSING', 'THANKYOU'].includes((s.layout || '').toUpperCase()));
    const insertAt   = closingIdx > 0 ? closingIdx : assigned.length;

    assigned.splice(insertAt, 0, {
      layout:    'IMAGE_SLIDE',
      title:     `Visual: ${img.sourceFile || 'Document'}`,
      imagePath: img.path,
      caption:   img.caption,
      body:      '', // summary text can be added if AI provides it
    });
    imgIdx++;
  }

  return assigned;
}

// ────────────────────────────────────────────────────────────
// MAIN generate()
// ────────────────────────────────────────────────────────────
const PptxService = {

  /**
   * Generate PPTX from structured slide data.
   * @param {object} pptData      - { slides: [...] }
   * @param {string} slideContent - raw markdown (fallback)
   * @param {string} title        - presentation title
   * @param {string} outputDir    - where to save the file
   * @param {string} styleDesc    - style description
   * @param {string} templatePath - optional: path to template .pptx file
   * @param {Array}  extractedImages - optional: images from knowledge base
   */
  async generate({ pptData, slideContent, title, outputDir, styleDesc, templatePath = null, extractedImages = [] }) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // ── 1. Extract theme from template if provided ────────────
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

      // ── 2. Assign extracted images to slides ────────────────
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
        title: title || "GYS Presentation",
        subtitle: "Generated by GYS Portal AI",
      }, GYS, "1 / 1");
    }

    const safeTitle = (title || "Presentation")
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 40);
    const filename = `GYS-${safeTitle}-${Date.now()}.pptx`;
    const filepath  = path.join(outputDir, filename);

    await pptx.writeFile({ fileName: filepath });
    console.log(`✅ [PPT] Generated: ${filename} (${slideCount} slides, template: ${templatePath ? 'yes' : 'no'})`);

    return {
      pptxFile:    filepath,
      pptxUrl:     `/api/files/${filename}`,
      pptxName:    filename,
      slideCount,
      usedFallback,
      styleDesc,
      usedTemplate: Boolean(templatePath),
    };
  },

  // Keep this for backward compat with routes/pptx.js
  async generateFromAICode({ aiCode, fallbackContent, title, outputDir, styleDesc }) {
    // This method is used by routes/pptx.js — keep existing behavior
    const pptx   = new PptxGenJS();
    const GYS    = { ...GYS_DEFAULTS };
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