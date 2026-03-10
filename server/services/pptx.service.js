// server/services/pptx.service.js
// ─────────────────────────────────────────────────────────────
// PPT Generator Service — 5 professional styles
// Uses pptxgenjs (pure JS, no Python needed)
// ─────────────────────────────────────────────────────────────

import PptxGenJS from 'pptxgenjs';
import path from 'path';
import fs from 'fs';

// ── Style Definitions ─────────────────────────────────────────
const STYLES = {
  // A: Corporate Navy — dark navy + gold accent, executive feel
  corporate: {
    name: 'Corporate Navy',
    bg: '1E2761',
    bgLight: 'F0F4FF',
    accent: 'D4AF37',
    accentLight: 'F5E6A3',
    text: 'FFFFFF',
    textDark: '1E2761',
    textMuted: 'B0BEC5',
    cardBg: 'FFFFFF',
    titleFont: 'Georgia',
    bodyFont: 'Calibri',
  },
  // B: Modern Teal — clean teal + white, startup/tech feel
  modern: {
    name: 'Modern Teal',
    bg: '028090',
    bgLight: 'F0FAFA',
    accent: '02C39A',
    accentLight: 'CCF5EC',
    text: 'FFFFFF',
    textDark: '021B21',
    textMuted: '607D8B',
    cardBg: 'FFFFFF',
    titleFont: 'Trebuchet MS',
    bodyFont: 'Calibri',
  },
  // C: Bold Red — cherry red + off-white, bold/marketing feel
  bold: {
    name: 'Bold Red',
    bg: '990011',
    bgLight: 'FFF8F8',
    accent: 'FCF6F5',
    accentLight: 'FFE0E0',
    text: 'FFFFFF',
    textDark: '2D0000',
    textMuted: '78909C',
    cardBg: 'FFFFFF',
    titleFont: 'Arial Black',
    bodyFont: 'Arial',
  },
  // D: Minimal Dark — charcoal + off-white, premium minimal
  minimal: {
    name: 'Minimal Dark',
    bg: '1A1A2E',
    bgLight: 'F8F9FA',
    accent: '4FC3F7',
    accentLight: 'E1F5FE',
    text: 'FFFFFF',
    textDark: '1A1A2E',
    textMuted: '90A4AE',
    cardBg: 'FFFFFF',
    titleFont: 'Calibri',
    bodyFont: 'Calibri Light',
  },
  // E: Warm Terracotta — earthy/consultancy feel
  warm: {
    name: 'Warm Terracotta',
    bg: 'B85042',
    bgLight: 'FFF9F5',
    accent: 'E7E8D1',
    accentLight: 'FDF3E7',
    text: 'FFFFFF',
    textDark: '3E1A12',
    textMuted: '8D6E63',
    cardBg: 'FFFFFF',
    titleFont: 'Cambria',
    bodyFont: 'Calibri',
  },
};

// ── Parse AI content into slides ──────────────────────────────
function parseSlides(content) {
  const slides = [];
  // Split by slide separator patterns: "---", "## Slide N", "**Slide N**"
  const chunks = content
    .split(/\n(?=#{1,3}\s|---+|\*\*Slide\s*\d+)/i)
    .filter(c => c.trim().length > 0);

  for (const chunk of chunks) {
    const lines = chunk.trim().split('\n').filter(l => l.trim());
    if (!lines.length) continue;

    // Extract title (first heading or bold line)
    let title = '';
    let bodyLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const headingMatch = line.match(/^#{1,3}\s+(.+)/);
      const boldMatch = line.match(/^\*\*(.+)\*\*$/);
      const slideMarker = line.match(/^---+$/);

      if (slideMarker) continue;
      if (!title && (headingMatch || boldMatch)) {
        title = (headingMatch ? headingMatch[1] : boldMatch[1]).trim();
      } else if (line.length > 0) {
        bodyLines.push(line);
      }
    }

    if (!title && bodyLines.length > 0) {
      title = bodyLines.shift();
    }

    // Parse bullets vs paragraphs
    const bullets = [];
    const paragraphs = [];
    for (const line of bodyLines) {
      const bulletMatch = line.match(/^[-*•]\s+(.+)/);
      const numberedMatch = line.match(/^\d+\.\s+(.+)/);
      if (bulletMatch) bullets.push(bulletMatch[1]);
      else if (numberedMatch) bullets.push(numberedMatch[1]);
      else if (line.trim()) paragraphs.push(line.trim());
    }

    if (title) {
      slides.push({ title, bullets, paragraphs });
    }
  }

  // Fallback: if nothing parsed, create one slide
  if (slides.length === 0) {
    slides.push({ title: 'Presentation', bullets: [], paragraphs: [content.substring(0, 300)] });
  }

  return slides;
}

// ── Build a complete presentation ─────────────────────────────
async function buildPresentation(slides, style, presentationTitle) {
  const s = STYLES[style] || STYLES.corporate;
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  pres.title = presentationTitle;

  const W = 10, H = 5.625;

  // ── Slide builder helpers ──────────────────────────────────

  // TITLE SLIDE
  function addTitleSlide(title, subtitle) {
    const slide = pres.addSlide();
    slide.background = { color: s.bg };

    // Accent bar left
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: 0.25, h: H,
      fill: { color: s.accent },
      line: { color: s.accent },
    });

    // Large decorative circle (background)
    slide.addShape(pres.shapes.OVAL, {
      x: 6.5, y: -1, w: 5, h: 5,
      fill: { color: s.accent, transparency: 88 },
      line: { color: s.accent, transparency: 88 },
    });
    slide.addShape(pres.shapes.OVAL, {
      x: 7.5, y: 0.5, w: 3, h: 3,
      fill: { color: s.accent, transparency: 80 },
      line: { color: s.accent, transparency: 80 },
    });

    // Title
    slide.addText(title, {
      x: 0.7, y: 1.6, w: 7.5, h: 1.5,
      fontSize: 40, bold: true,
      fontFace: s.titleFont,
      color: s.text,
      margin: 0,
    });

    // Accent line
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.7, y: 3.2, w: 1.5, h: 0.06,
      fill: { color: s.accent },
      line: { color: s.accent },
    });

    // Subtitle
    if (subtitle) {
      slide.addText(subtitle, {
        x: 0.7, y: 3.4, w: 7.5, h: 0.8,
        fontSize: 16,
        fontFace: s.bodyFont,
        color: s.textMuted,
        margin: 0,
      });
    }

    // Footer date
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    slide.addText(today, {
      x: 0.7, y: 5.1, w: 4, h: 0.3,
      fontSize: 10,
      fontFace: s.bodyFont,
      color: s.textMuted,
      margin: 0,
    });
  }

  // CONTENT SLIDE — bullets layout
  function addBulletSlide(title, bullets, slideNum, totalSlides) {
    const slide = pres.addSlide();
    slide.background = { color: s.bgLight };

    // Top accent bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: W, h: 0.12,
      fill: { color: s.bg },
      line: { color: s.bg },
    });

    // Left accent stripe
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0.12, w: 0.12, h: H - 0.12,
      fill: { color: s.accent },
      line: { color: s.accent },
    });

    // Title area background
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.12, y: 0.12, w: W - 0.12, h: 1.0,
      fill: { color: s.bg },
      line: { color: s.bg },
    });

    // Slide title
    slide.addText(title, {
      x: 0.4, y: 0.2, w: 8.5, h: 0.8,
      fontSize: 24, bold: true,
      fontFace: s.titleFont,
      color: s.text,
      margin: 0,
    });

    // Slide number badge
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 9.1, y: 0.25, w: 0.6, h: 0.6,
      fill: { color: s.accent },
      line: { color: s.accent },
    });
    slide.addText(`${slideNum}`, {
      x: 9.1, y: 0.25, w: 0.6, h: 0.6,
      fontSize: 14, bold: true,
      fontFace: s.bodyFont,
      color: s.textDark,
      align: 'center', valign: 'middle',
      margin: 0,
    });

    // Content area — bullets
    if (bullets.length > 0) {
      const bulletItems = bullets.map((b, i) => [
        {
          text: '▸ ',
          options: { color: s.accent.replace('#', ''), bold: true, fontSize: 14, fontFace: s.bodyFont, breakLine: false },
        },
        {
          text: b,
          options: { color: s.textDark, fontSize: 14, fontFace: s.bodyFont, breakLine: i < bullets.length - 1 },
        },
      ]).flat();

      slide.addText(bulletItems, {
        x: 0.4, y: 1.4, w: 9.2, h: 3.8,
        valign: 'top',
        paraSpaceAfter: 10,
        margin: [0, 0, 0, 0],
      });
    }

    // Bottom footer bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 5.3, w: W, h: 0.32,
      fill: { color: s.bg },
      line: { color: s.bg },
    });
    slide.addText(presentationTitle, {
      x: 0.3, y: 5.32, w: 6, h: 0.28,
      fontSize: 9, color: s.textMuted, fontFace: s.bodyFont, margin: 0,
    });
    slide.addText(`${slideNum} / ${totalSlides}`, {
      x: 8.5, y: 5.32, w: 1.3, h: 0.28,
      fontSize: 9, color: s.textMuted, fontFace: s.bodyFont,
      align: 'right', margin: 0,
    });
  }

  // CONTENT SLIDE — 2-column card layout
  function addCardSlide(title, bullets, slideNum, totalSlides) {
    const slide = pres.addSlide();
    slide.background = { color: s.bgLight };

    // Top header band
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: W, h: 1.1,
      fill: { color: s.bg },
      line: { color: s.bg },
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: 0.2, h: 1.1,
      fill: { color: s.accent },
      line: { color: s.accent },
    });
    slide.addText(title, {
      x: 0.45, y: 0.15, w: 8.5, h: 0.75,
      fontSize: 26, bold: true,
      fontFace: s.titleFont,
      color: s.text,
      margin: 0,
    });
    slide.addText(`${slideNum} / ${totalSlides}`, {
      x: 8.5, y: 0.35, w: 1.3, h: 0.4,
      fontSize: 11, color: s.accent,
      fontFace: s.bodyFont, align: 'right', margin: 0,
    });

    // Cards — split bullets into 2 columns
    const half = Math.ceil(bullets.length / 2);
    const col1 = bullets.slice(0, half);
    const col2 = bullets.slice(half);

    const cardOpts = { fill: { color: s.cardBg }, line: { color: 'E0E0E0', width: 0.5 } };
    const makeShadow = () => ({ type: 'outer', color: '000000', blur: 8, offset: 3, angle: 135, opacity: 0.08 });

    // Left column
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.3, y: 1.3, w: 4.45, h: 3.9,
      ...cardOpts,
      shadow: makeShadow(),
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.3, y: 1.3, w: 0.12, h: 3.9,
      fill: { color: s.accent }, line: { color: s.accent },
    });
    const col1Items = col1.map((b, i) => [
      { text: b, options: { color: s.textDark, fontSize: 13, fontFace: s.bodyFont, breakLine: i < col1.length - 1 } },
    ]).flat();
    slide.addText(col1Items, {
      x: 0.6, y: 1.4, w: 3.9, h: 3.7,
      valign: 'top', paraSpaceAfter: 14, margin: [8, 8, 8, 8],
    });

    // Right column
    if (col2.length > 0) {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: 5.25, y: 1.3, w: 4.45, h: 3.9,
        ...cardOpts,
        shadow: makeShadow(),
      });
      slide.addShape(pres.shapes.RECTANGLE, {
        x: 5.25, y: 1.3, w: 0.12, h: 3.9,
        fill: { color: s.bg }, line: { color: s.bg },
      });
      const col2Items = col2.map((b, i) => [
        { text: b, options: { color: s.textDark, fontSize: 13, fontFace: s.bodyFont, breakLine: i < col2.length - 1 } },
      ]).flat();
      slide.addText(col2Items, {
        x: 5.55, y: 1.4, w: 3.9, h: 3.7,
        valign: 'top', paraSpaceAfter: 14, margin: [8, 8, 8, 8],
      });
    }
  }

  // PARAGRAPH SLIDE
  function addParagraphSlide(title, paragraphs, slideNum, totalSlides) {
    const slide = pres.addSlide();
    slide.background = { color: s.bgLight };

    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: W, h: 1.1,
      fill: { color: s.bg }, line: { color: s.bg },
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: 0.2, h: 1.1,
      fill: { color: s.accent }, line: { color: s.accent },
    });
    slide.addText(title, {
      x: 0.45, y: 0.15, w: 9, h: 0.75,
      fontSize: 26, bold: true, fontFace: s.titleFont, color: s.text, margin: 0,
    });

    const makeShadow = () => ({ type: 'outer', color: '000000', blur: 6, offset: 2, angle: 135, opacity: 0.07 });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.4, y: 1.25, w: 9.2, h: 4.0,
      fill: { color: s.cardBg }, line: { color: 'E8E8E8', width: 0.5 },
      shadow: makeShadow(),
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.4, y: 1.25, w: 0.1, h: 4.0,
      fill: { color: s.accent }, line: { color: s.accent },
    });

    slide.addText(paragraphs.join('\n\n'), {
      x: 0.7, y: 1.35, w: 8.9, h: 3.8,
      fontSize: 14, fontFace: s.bodyFont, color: s.textDark,
      valign: 'top', wrap: true, margin: [12, 12, 12, 12],
    });

    // Footer
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 5.3, w: W, h: 0.32,
      fill: { color: s.bg }, line: { color: s.bg },
    });
    slide.addText(presentationTitle, {
      x: 0.3, y: 5.32, w: 6, h: 0.28,
      fontSize: 9, color: s.textMuted, fontFace: s.bodyFont, margin: 0,
    });
    slide.addText(`${slideNum} / ${totalSlides}`, {
      x: 8.5, y: 5.32, w: 1.3, h: 0.28,
      fontSize: 9, color: s.textMuted, fontFace: s.bodyFont, align: 'right', margin: 0,
    });
  }

  // CLOSING SLIDE
  function addClosingSlide() {
    const slide = pres.addSlide();
    slide.background = { color: s.bg };

    // Decorative circles
    slide.addShape(pres.shapes.OVAL, {
      x: -1, y: 2.5, w: 5, h: 5,
      fill: { color: s.accent, transparency: 85 },
      line: { color: s.accent, transparency: 85 },
    });
    slide.addShape(pres.shapes.OVAL, {
      x: 7, y: -0.5, w: 4, h: 4,
      fill: { color: s.accent, transparency: 90 },
      line: { color: s.accent, transparency: 90 },
    });

    // Accent bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 3.5, y: 2.6, w: 3, h: 0.08,
      fill: { color: s.accent }, line: { color: s.accent },
    });

    slide.addText('Thank You', {
      x: 1, y: 1.6, w: 8, h: 1.2,
      fontSize: 44, bold: true,
      fontFace: s.titleFont,
      color: s.text,
      align: 'center', margin: 0,
    });
    slide.addText(presentationTitle, {
      x: 1, y: 3.0, w: 8, h: 0.6,
      fontSize: 16,
      fontFace: s.bodyFont,
      color: s.textMuted,
      align: 'center', margin: 0,
    });
  }

  // ── Assemble slides ─────────────────────────────────────────
  const [titleSlide, ...contentSlides] = slides;
  const totalSlides = contentSlides.length + 2; // title + content + closing

  // Title slide
  addTitleSlide(
    titleSlide.title,
    titleSlide.bullets[0] || titleSlide.paragraphs[0] || ''
  );

  // Content slides — alternate between bullet and card layout
  contentSlides.forEach((slide, idx) => {
    const slideNum = idx + 2;
    const hasBullets = slide.bullets.length > 0;
    const useCard = hasBullets && slide.bullets.length > 2 && idx % 2 === 1;

    if (!hasBullets && slide.paragraphs.length > 0) {
      addParagraphSlide(slide.title, slide.paragraphs, slideNum, totalSlides);
    } else if (useCard) {
      addCardSlide(slide.title, slide.bullets, slideNum, totalSlides);
    } else {
      addBulletSlide(slide.title, slide.bullets.length ? slide.bullets : slide.paragraphs, slideNum, totalSlides);
    }
  });

  // Closing slide
  addClosingSlide();

  return pres;
}

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────
const PptxService = {
  STYLES,

  /**
   * Generate a PPTX file from AI-generated content
   * @param {string} content - Markdown-ish slide content from AI
   * @param {string} style - Style key: 'corporate' | 'modern' | 'bold' | 'minimal' | 'warm'
   * @param {string} title - Presentation title
   * @param {string} outputDir - Directory to save the file
   * @returns {Promise<{filename: string, filepath: string, url: string}>}
   */
  async generate(content, style = 'corporate', title = 'Presentation', outputDir) {
    const validStyle = STYLES[style] ? style : 'corporate';
    const slides = parseSlides(content);

    const pres = await buildPresentation(slides, validStyle, title);

    const safeTitle = title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 40);
    const filename = `${safeTitle}-${Date.now()}.pptx`;
    const filepath = path.join(outputDir, filename);

    await pres.writeFile({ fileName: filepath });
    console.log(`✅ [PptxService] Generated: ${filename} | Style: ${validStyle} | Slides: ${slides.length + 1}`);

    return {
      filename,
      filepath,
      url: `/api/files/${filename}`,
      style: STYLES[validStyle].name,
      slideCount: slides.length + 1,
    };
  },

  /**
   * Get style list for display
   */
  getStyleList() {
    return Object.entries(STYLES).map(([key, val]) => ({
      key,
      name: val.name,
      description: `${val.titleFont} · ${val.bg}`,
    }));
  },
};

export default PptxService;
