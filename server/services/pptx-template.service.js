// server/services/pptx-template.service.js
// ============================================================
// REWRITE: True template-based PPTX generation
//
// Strategy:
//   1. Open the template .pptx (which is a ZIP file)
//   2. Read the slide master + slide layouts from the template
//   3. For each AI-generated slide, clone the closest matching
//      layout XML from the template as the base
//   4. Inject AI content into the cloned slide XML
//   5. This means every slide inherits: background, fonts,
//      colors, logo placement, footer, decorative shapes —
//      exactly as defined in the template file
// ============================================================

import AdmZip from 'adm-zip';
import path   from 'path';
import fs     from 'fs';

// ─────────────────────────────────────────────────────────────
// XML HELPERS
// ─────────────────────────────────────────────────────────────

function escapeXml(str = '') {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

// Build a text run with given options
function makeRun(text, opts = {}) {
  const { sz = 1800, bold = false, color = null, typeface = null } = opts;
  const boldAttr  = bold ? ' b="1"' : '';
  const colorEl   = color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : '';
  const fontEl    = typeface ? `<a:latin typeface="${typeface}"/>` : '';
  return `<a:r><a:rPr lang="en-US" sz="${sz}"${boldAttr} dirty="0">${colorEl}${fontEl}</a:rPr><a:t>${escapeXml(text)}</a:t></a:r>`;
}

// Build a paragraph
function makePara(text, opts = {}) {
  const { align = null, marL = 0, indent = 0, bullet = false, spcBef = 0 } = opts;
  const alignAttr = align ? ` algn="${align}"` : '';
  const marAttr   = marL ? ` marL="${marL}"` : '';
  const indAttr   = indent ? ` indent="${indent}"` : '';
  const bulletEl  = bullet
    ? `<a:buChar char="•"/>`
    : `<a:buNone/>`;
  const spcEl = spcBef ? `<a:spcBef><a:spcPts val="${spcBef}"/></a:spcBef>` : '';
  return `<a:p><a:pPr${alignAttr}${marAttr}${indAttr}>${bulletEl}${spcEl}</a:pPr>${makeRun(text, opts)}</a:p>`;
}

// ─────────────────────────────────────────────────────────────
// TEMPLATE ANALYSIS
// Opens the .pptx zip and maps out all available slides,
// layouts, and masters so we can clone from them.
// ─────────────────────────────────────────────────────────────

function analyzeTemplate(zip) {
  // Read presentation manifest
  const presEntry = zip.getEntry('ppt/presentation.xml');
  const relsEntry = zip.getEntry('ppt/_rels/presentation.xml.rels');
  if (!presEntry || !relsEntry) {
    throw new Error('Invalid PPTX: missing presentation.xml or its .rels');
  }

  const presXml = presEntry.getData().toString('utf8');
  const relsXml = relsEntry.getData().toString('utf8');

  // Parse relationships: rId → target path
  const relsMap = {};
  for (const m of relsXml.matchAll(/<Relationship\b([^>]+?)\/>/gs)) {
    const idM     = m[1].match(/\bId="([^"]+)"/);
    const targetM = m[1].match(/\bTarget="([^"]+)"/);
    if (idM && targetM) relsMap[idM[1]] = targetM[1];
  }

  // Parse slide list from sldIdLst
  const slideList = [];
  for (const m of presXml.matchAll(/<p:sldId\b([^>]+?)\/>/gs)) {
    const idM   = m[1].match(/\bid="(\d+)"/);
    const rIdM  = m[1].match(/\br:id="([^"]+)"/);
    if (idM && rIdM) slideList.push({ id: idM[1], rId: rIdM[1] });
  }

  // Resolve a target path to the actual zip entry path
  function resolveTarget(target) {
    if (!target) return null;
    let t = target.replace(/^\//, '');
    if (t.startsWith('../')) t = 'ppt/' + t.replace(/^\.\.\//, '');
    else if (t.startsWith('slides/')) t = 'ppt/' + t;
    else if (!t.startsWith('ppt/')) t = 'ppt/' + t;
    return t;
  }

  function getEntry(...candidates) {
    for (const c of candidates) {
      if (!c) continue;
      const e = zip.getEntry(c) || zip.getEntry(c.replace(/^\//, ''));
      if (e) return e;
    }
    return null;
  }

  // Build slide info list
  const slides = [];
  for (const { id, rId } of slideList) {
    const rawTarget = relsMap[rId];
    if (!rawTarget || !rawTarget.includes('slide')) continue;

    const entryPath = resolveTarget(rawTarget);
    const entry     = getEntry(entryPath, rawTarget, 'ppt/' + rawTarget);
    if (!entry) continue;

    const slideXml  = entry.getData().toString('utf8');

    // Find what layout this slide uses (from its own .rels)
    const slideRelPath  = entry.entryName.replace(/\.xml$/, '.xml.rels')
      .replace('ppt/slides/', 'ppt/slides/_rels/');
    const slideRelEntry = getEntry(slideRelPath);

    let layoutPath = null;
    let layoutEntry = null;
    if (slideRelEntry) {
      const sRelsXml = slideRelEntry.getData().toString('utf8');
      const layoutM  = sRelsXml.match(/Type="[^"]*slideLayout"[^>]*Target="([^"]+)"/);
      if (layoutM) {
        layoutPath  = resolveTarget(layoutM[1]);
        layoutEntry = getEntry(layoutPath);
      }
    }

    // Get shape names in this slide to understand its purpose
    const shapeNames = [...slideXml.matchAll(/cNvPr id="\d+" name="([^"]+)"/g)].map(m => m[1]);

    // Classify slide type by shape names and content
    let slideType = classifySlide(slideXml, shapeNames);

    slides.push({
      index:       slides.length,
      entryPath:   entry.entryName,
      xml:         slideXml,
      relPath:     slideRelEntry ? slideRelEntry.entryName : null,
      layoutPath,
      layoutEntry,
      shapeNames,
      slideType,
    });
  }

  if (slides.length === 0) {
    throw new Error('Template has no slides');
  }

  // Pick representative slides for each layout type we need
  // Priority: find slides that best match each type
  const titleSlide   = slides.find(s => s.slideType === 'TITLE')   || slides[0];
  const closingSlide = slides.find(s => s.slideType === 'CLOSING') || slides[slides.length - 1];
  const contentSlide = slides.find(s => s.slideType === 'CONTENT') || slides[1] || slides[0];

  // For section dividers: pick a slide with minimal text shapes
  const sectionSlide = slides.find(s => s.slideType === 'SECTION') || contentSlide;

  console.log(`[PPT Template] Analyzed ${slides.length} slides:`);
  slides.forEach(s => console.log(`  slide${s.index + 1}: type=${s.slideType} shapes=[${s.shapeNames.slice(0,4).join(',')}]`));

  return {
    slides,
    titleSlide,
    contentSlide,
    closingSlide,
    sectionSlide,
    getEntry,
    resolveTarget,
  };
}

// Classify a slide by examining its content
function classifySlide(xml, names) {
  const lowerNames = names.map(n => n.toLowerCase());
  const lowerXml   = xml.toLowerCase();

  // Look for large centered title-only layout (typically slide 1)
  if (lowerNames.some(n => n.includes('maintitle') || n.includes('main title'))) return 'TITLE';

  // Check text content for closing indicators
  if (lowerXml.includes('thank you') || lowerXml.includes('terima kasih') ||
      lowerXml.includes('thank') || lowerNames.some(n => n.includes('closing'))) {
    return 'CLOSING';
  }

  // Has a title and subtitle/body — generic content layout
  const hasTitle = lowerNames.some(n =>
    n.includes('title') || n.includes('judul') || n === 'title 1' || n === 'title'
  );
  const hasBody = lowerNames.some(n =>
    n.includes('subtitle') || n.includes('content') || n.includes('body') ||
    n.includes('text') || n.includes('placeholder')
  );

  if (hasTitle && hasBody) return 'CONTENT';
  if (hasTitle) return 'SECTION';

  return 'CONTENT';
}

// ─────────────────────────────────────────────────────────────
// INJECT CONTENT INTO TEMPLATE SLIDE XML
//
// This is the key function: instead of building slides from
// scratch, we take the template slide XML as-is and surgically
// replace the text inside named shapes.
//
// The template's backgrounds, decorations, logos, colors,
// and layout all remain untouched.
// ─────────────────────────────────────────────────────────────

function injectIntoSlide(templateXml, slideData, options = {}) {
  let xml = templateXml;

  const layout = (slideData.layout || 'CONTENT').toUpperCase();

  // Build the content paragraphs based on layout type
  const paragraphs = buildParagraphs(slideData, options);

  // Strategy: find text body placeholders in the template and replace their content
  // We look for <p:txBody> inside <p:sp> elements and replace based on position/name

  xml = replaceTextBodies(xml, paragraphs, layout);

  // If slide has an image to inject, add it
  if (slideData.imagePath && fs.existsSync(slideData.imagePath) && options.imageRId) {
    xml = injectImage(xml, slideData.imagePath, options.imageRId);
  }

  return xml;
}

// Build paragraph arrays for each part of the slide
function buildParagraphs(slideData, options = {}) {
  const layout  = (slideData.layout || 'CONTENT').toUpperCase();
  const { primaryColor = '006A4E', accentColor = '00A878', darkColor = '111827', grayColor = '6B7280' } = options;

  switch (layout) {
    case 'TITLE': {
      const title    = slideData.title    || '';
      const subtitle = slideData.subtitle || '';
      const meta     = [slideData.presenter, slideData.date].filter(Boolean).join('   •   ');
      return {
        title: [
          makePara(title, { sz: 4400, bold: true, color: 'FFFFFF', align: 'ctr' }),
        ],
        body: [
          ...(subtitle ? [makePara(subtitle, { sz: 2000, color: 'CCEEDF', align: 'ctr' })] : []),
          ...(meta     ? [makePara(meta,     { sz: 1400, color: 'A8D5C2', align: 'ctr' })] : []),
        ],
      };
    }

    case 'SECTION': {
      return {
        title: [makePara(slideData.title || '', { sz: 3600, bold: true, color: primaryColor })],
        body:  slideData.subtitle
          ? [makePara(slideData.subtitle, { sz: 1800, color: grayColor })]
          : [],
      };
    }

    case 'GRID': {
      const items = (slideData.items || []).slice(0, 4);
      return {
        title: [makePara(slideData.title || '', { sz: 2400, bold: true, color: primaryColor })],
        body: items.flatMap(item => [
          makePara(`${item.icon || '▪'} ${item.title || ''}`, { sz: 1700, bold: true, color: darkColor, spcBef: 200 }),
          makePara(item.text || '', { sz: 1350, color: grayColor, marL: 342900 }),
        ]),
      };
    }

    case 'STATS': {
      const stats = (slideData.stats || []).slice(0, 4);
      return {
        title: [makePara(slideData.title || '', { sz: 2400, bold: true, color: primaryColor })],
        body: stats.flatMap(s => [
          makePara(`${s.icon || '◆'} ${s.value || ''}`, { sz: 3200, bold: true, color: primaryColor, spcBef: 300 }),
          makePara(s.label || '', { sz: 1500, bold: true, color: darkColor }),
          ...(s.sub ? [makePara(s.sub, { sz: 1200, color: grayColor })] : []),
        ]),
      };
    }

    case 'TIMELINE': {
      const steps = slideData.steps || [];
      return {
        title: [makePara(slideData.title || '', { sz: 2400, bold: true, color: primaryColor })],
        body: steps.flatMap((s, i) => [
          makePara(`${i + 1}. ${s.time || ''} — ${s.title || ''}`, { sz: 1600, bold: true, color: primaryColor, spcBef: 200 }),
          makePara(s.text || '', { sz: 1300, color: grayColor, marL: 342900 }),
        ]),
      };
    }

    case 'TWO_COLUMN': {
      const left  = (slideData.leftBullets  || slideData.left  || []).filter(Boolean);
      const right = (slideData.rightBullets || slideData.right || []).filter(Boolean);
      return {
        title: [makePara(slideData.title || '', { sz: 2400, bold: true, color: primaryColor })],
        body: [
          ...(slideData.leftTitle  ? [makePara(slideData.leftTitle,  { sz: 1700, bold: true, color: darkColor, spcBef: 200 })] : []),
          ...left.map(b  => makePara(String(b), { sz: 1400, color: grayColor,    bullet: true, marL: 342900, indent: -342900 })),
          makePara('', { sz: 600 }),
          ...(slideData.rightTitle ? [makePara(slideData.rightTitle, { sz: 1700, bold: true, color: accentColor, spcBef: 200 })] : []),
          ...right.map(b => makePara(String(b), { sz: 1400, color: grayColor,    bullet: true, marL: 342900, indent: -342900 })),
        ],
      };
    }

    case 'TABLE': {
      const headers = slideData.tableHeaders || [];
      const rows    = slideData.tableRows    || [];
      return {
        title: [makePara(slideData.title || '', { sz: 2400, bold: true, color: primaryColor })],
        body: [
          ...(headers.length ? [makePara(headers.join('  |  '), { sz: 1500, bold: true, color: primaryColor })] : []),
          ...rows.map(row =>
            makePara((Array.isArray(row) ? row : [row]).join('  |  '), { sz: 1300, color: grayColor })
          ),
        ],
      };
    }

    case 'CHART': {
      const cfg  = slideData.chartConfig || {};
      const data = cfg.data || [];
      return {
        title: [makePara(slideData.title || '', { sz: 2400, bold: true, color: primaryColor })],
        body: [
          ...(slideData.insightText ? [makePara(`💡 ${slideData.insightText}`, { sz: 1500, bold: true, color: primaryColor })] : []),
          ...data.flatMap(series => [
            makePara(`▸ ${series.name || 'Data'}`, { sz: 1400, bold: true, color: darkColor, spcBef: 200 }),
            ...( series.labels || []).map((l, i) =>
              makePara(`${l}: ${(series.values || [])[i] ?? '—'}`, { sz: 1300, color: grayColor, marL: 342900 })
            ),
          ]),
        ],
      };
    }

    case 'QUOTE': {
      return {
        title: [
          makePara(`"${slideData.quote || slideData.title || ''}"`, { sz: 2800, color: primaryColor, align: 'ctr' }),
          ...(slideData.author ? [makePara(`— ${slideData.author}`, { sz: 1600, color: grayColor, align: 'ctr' })] : []),
        ],
        body: [],
      };
    }

    case 'CLOSING': {
      return {
        title: [makePara(slideData.title || 'Thank You', { sz: 4800, bold: true, color: 'FFFFFF', align: 'ctr' })],
        body: [
          ...(slideData.subtitle ? [makePara(slideData.subtitle, { sz: 2000, color: 'CCEEDF', align: 'ctr' })] : []),
          ...(slideData.contact  ? [makePara(slideData.contact,  { sz: 1500, color: 'A8D5C2', align: 'ctr' })] : []),
        ],
      };
    }

    default: { // CONTENT
      const bullets = (slideData.bullets || []).filter(Boolean);
      return {
        title: [makePara(slideData.title || '', { sz: 2400, bold: true, color: primaryColor })],
        body: bullets.length > 0
          ? bullets.map(b => makePara(String(b), { sz: 1600, color: grayColor, bullet: true, marL: 342900, indent: -342900 }))
          : slideData.body
            ? [makePara(slideData.body, { sz: 1600, color: grayColor })]
            : [],
      };
    }
  }
}

// Replace text bodies in the slide XML
// We find ALL <p:txBody> elements (in order) and replace:
//   - First txBody  → title content
//   - Second txBody → body content
// This works because PowerPoint slides always have title first, body second
function replaceTextBodies(xml, paragraphs, layout) {
  const bodyOpenTag  = '<p:txBody>';
  const bodyCloseTag = '</p:txBody>';

  let replaced = 0;
  let result   = xml;
  let searchFrom = 0;

  while (replaced < 2) {
    const startIdx = result.indexOf(bodyOpenTag, searchFrom);
    if (startIdx === -1) break;

    const endIdx = result.indexOf(bodyCloseTag, startIdx);
    if (endIdx === -1) break;

    const before = result.substring(0, startIdx);
    const after  = result.substring(endIdx + bodyCloseTag.length);

    // Extract the <a:bodyPr> from original to preserve layout/sizing
    const originalBody  = result.substring(startIdx, endIdx + bodyCloseTag.length);
    const bodyPrMatch   = originalBody.match(/<a:bodyPr[^>]*\/>/);
    const lstStyleMatch = originalBody.match(/<a:lstStyle[^>]*(?:\/>|>[\s\S]*?<\/a:lstStyle>)/);

    const bodyPr   = bodyPrMatch   ? bodyPrMatch[0]   : '<a:bodyPr/>';
    const lstStyle = lstStyleMatch ? lstStyleMatch[0] : '<a:lstStyle/>';

    // Get paragraphs for this slot
    const paras = replaced === 0
      ? (paragraphs.title || [])
      : (paragraphs.body  || []);

    // Build new txBody — keep original bodyPr so positioning stays correct
    const newBody = `${bodyOpenTag}${bodyPr}${lstStyle}${paras.join('')}${bodyCloseTag}`;

    result     = before + newBody + after;
    searchFrom = before.length + newBody.length;
    replaced++;
  }

  return result;
}

// Inject an image into the slide (replace existing image placeholder or append)
function injectImage(xml, imagePath, rId) {
  // Look for existing pic element to replace
  const picMatch = xml.match(/<p:pic>[\s\S]*?<\/p:pic>/);
  if (picMatch) {
    // Replace the r:embed attribute in the existing pic
    const newPic = picMatch[0].replace(/(r:embed=")[^"]*(")/g, `$1${rId}$2`);
    return xml.replace(picMatch[0], newPic);
  }

  // No existing pic — insert one before </p:spTree>
  const picXml = `
<p:pic>
  <p:nvPicPr>
    <p:cNvPr id="99" name="Injected Image"/>
    <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
    <p:nvPr/>
  </p:nvPicPr>
  <p:blipFill>
    <a:blip r:embed="${rId}"/>
    <a:stretch><a:fillRect/></a:stretch>
  </p:blipFill>
  <p:spPr>
    <a:xfrm><a:off x="4572000" y="1143000"/><a:ext cx="4000000" cy="2800000"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
  </p:spPr>
</p:pic>`;

  return xml.replace('</p:spTree>', picXml + '</p:spTree>');
}

// ─────────────────────────────────────────────────────────────
// PICK WHICH TEMPLATE SLIDE TO CLONE FOR A GIVEN LAYOUT
// ─────────────────────────────────────────────────────────────

function pickTemplateSlide(analysis, layout) {
  const L = (layout || 'CONTENT').toUpperCase();
  switch (L) {
    case 'TITLE':   return analysis.titleSlide;
    case 'CLOSING': return analysis.closingSlide;
    case 'SECTION': return analysis.sectionSlide;
    default:        return analysis.contentSlide;
  }
}

// ─────────────────────────────────────────────────────────────
// MANIFEST UPDATERS
// ─────────────────────────────────────────────────────────────

function updatePresentationXml(presXml, relsXml, newSlides) {
  // Find max existing slide ID
  const existingIds = [...presXml.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)]
    .map(m => parseInt(m[1])).filter(id => id < 10000);
  let maxId = existingIds.length > 0 ? Math.max(256, ...existingIds) : 256;

  let sldIdBlock = '';
  const newRels  = [];

  newSlides.forEach((s, i) => {
    maxId++;
    const rId  = `rId_new_${i + 1}`;
    s._rId     = rId;
    sldIdBlock += `<p:sldId id="${maxId}" r:id="${rId}"/>`;
    newRels.push(
      `<Relationship Id="${rId}" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" ` +
      `Target="slides/${s.name}"/>`
    );
  });

  const updatedPres = presXml.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${sldIdBlock}</p:sldIdLst>`
  );

  // Remove old slide rels, add new ones
  let updatedRels = relsXml.replace(
    /<Relationship\b[^>]*presentationml\.slide"[^>]*\/>/g, ''
  );
  updatedRels = updatedRels.replace(
    '</Relationships>',
    newRels.join('\n') + '\n</Relationships>'
  );

  return { updatedPres, updatedRels };
}

function updateContentTypes(ctXml, slideNames) {
  let updated = ctXml.replace(
    /<Override[^>]+presentationml\.slide\+xml[^>]+\/>/g, ''
  );
  const overrides = slideNames.map(n =>
    `<Override PartName="/ppt/slides/${n}" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  ).join('\n');
  return updated.replace('</Types>', overrides + '\n</Types>');
}

// Get layout target from slide rels XML
function getLayoutTarget(slideRelXml) {
  const m = slideRelXml?.match(/Type="[^"]*slideLayout"[^>]*Target="([^"]+)"/);
  return m ? m[1] : '../slideLayouts/slideLayout1.xml';
}

// Build a clean slide rels XML (slide → layout, optionally + image)
function buildSlideRels(layoutTarget, imageTarget = null) {
  const imgRel = imageTarget
    ? `<Relationship Id="rId2" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
      `Target="${imageTarget}"/>`
    : '';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" ` +
    `Target="${layoutTarget}"/>` +
    imgRel +
    `</Relationships>`
  );
}

// Mime type → file extension map
function mimeToExt(mime = '') {
  if (mime.includes('png'))  return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpeg';
  if (mime.includes('gif'))  return '.gif';
  if (mime.includes('webp')) return '.webp';
  return '.png';
}

// ─────────────────────────────────────────────────────────────
// MAIN PUBLIC API
// ─────────────────────────────────────────────────────────────

const PptxTemplateService = {

  /**
   * Returns true if templatePath is a valid .pptx file
   */
  isValidTemplate(templatePath) {
    if (!templatePath) return false;
    if (!fs.existsSync(templatePath)) return false;
    if (!/\.pptx?$/i.test(templatePath)) return false;
    try {
      const zip = new AdmZip(templatePath);
      return Boolean(zip.getEntry('ppt/presentation.xml'));
    } catch {
      return false;
    }
  },

  /**
   * Generate a PPTX file using the given template as master.
   *
   * @param {object} params
   * @param {string} params.templatePath  - Path to the .pptx template file
   * @param {object} params.pptData       - { slides: [...] } from AI
   * @param {string} params.title         - Presentation title
   * @param {string} params.outputDir     - Directory to save the output file
   * @param {Array}  params.selectedImages - [{ path, caption, slideIndex }] — images chosen by AI
   *
   * @returns {object} { pptxFile, pptxUrl, pptxName, slideCount, usedTemplate }
   */
  async generate({ templatePath, pptData, title, outputDir, selectedImages = [] }) {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Open template
    let templateZip;
    try {
      templateZip = new AdmZip(templatePath);
    } catch (err) {
      throw new Error(`Cannot open template PPTX: ${err.message}`);
    }

    // Analyze template structure
    const analysis = analyzeTemplate(templateZip);

    // Extract theme colors from template for text injection
    const themeColors = extractThemeColors(templateZip);
    console.log(`[PPT Template] Theme colors: primary=${themeColors.primaryColor} accent=${themeColors.accentColor}`);

    // Create output zip starting from a copy of the template
    // (this preserves ALL template assets: media, fonts, theme, master, layouts)
    const outputZip = new AdmZip(templatePath);

    // Remove all existing content slides (keep everything else: master, layouts, theme, media)
    const toRemove = outputZip.getEntries()
      .filter(e => /^ppt\/slides\/(slide\d+\.xml|_rels\/slide\d+\.xml\.rels)$/.test(e.entryName))
      .map(e => e.entryName);
    toRemove.forEach(name => { try { outputZip.deleteFile(name); } catch {} });
    console.log(`[PPT Template] Removed ${toRemove.length} original slides, generating ${pptData.slides?.length || 0} new slides`);

    // Track new slides for manifest update
    const newSlideInfos = [];
    const slides = pptData.slides || [];

    // Track existing media files to avoid name collisions
    const existingMedia = outputZip.getEntries()
      .filter(e => e.entryName.startsWith('ppt/media/'))
      .map(e => e.entryName);
    let mediaCounter = existingMedia.length + 1;

    // Build a lookup: slideIndex → image info
    const imageBySlide = {};
    for (const img of selectedImages) {
      if (img.slideIndex !== undefined && img.slideIndex !== null) {
        imageBySlide[img.slideIndex] = img;
      }
    }

    for (let i = 0; i < slides.length; i++) {
      const sd       = slides[i];
      const slideNum = i + 1;
      const slideName    = `slide${slideNum}.xml`;
      const slidePath    = `ppt/slides/${slideName}`;
      const slideRelPath = `ppt/slides/_rels/${slideName}.rels`;

      // Pick the best template slide to clone
      const templateSlide = pickTemplateSlide(analysis, sd.layout);

      // Get layout target from the template slide's rels
      let layoutTarget = '../slideLayouts/slideLayout1.xml';
      if (templateSlide.relPath) {
        const tRelEntry = templateZip.getEntry(templateSlide.relPath);
        if (tRelEntry) {
          layoutTarget = getLayoutTarget(tRelEntry.getData().toString('utf8'));
        }
      }

      // Handle image for this slide
      let imageRId    = null;
      let imageTarget = null;
      const imgInfo   = imageBySlide[i];

      if (imgInfo && imgInfo.path && fs.existsSync(imgInfo.path)) {
        const imgBuffer  = fs.readFileSync(imgInfo.path);
        const ext        = mimeToExt(imgInfo.mimeType || '');
        const mediaName  = `img_injected_${mediaCounter}${ext}`;
        const mediaPath  = `ppt/media/${mediaName}`;

        outputZip.addFile(mediaPath, imgBuffer);
        imageRId    = 'rId2';
        imageTarget = `../media/${mediaName}`;
        mediaCounter++;

        console.log(`[PPT Template] Slide ${slideNum}: injecting image ${mediaName}`);
      }

      // Clone template slide XML and inject content
      const clonedXml = injectIntoSlide(
        templateSlide.xml,
        sd,
        { ...themeColors, imageRId }
      );

      // Build slide rels
      const relXml = buildSlideRels(layoutTarget, imageTarget);

      // Add to output zip
      outputZip.addFile(slidePath,    Buffer.from(clonedXml, 'utf8'));
      outputZip.addFile(slideRelPath, Buffer.from(relXml,    'utf8'));
      newSlideInfos.push({ name: slideName });

      console.log(`[PPT Template] Slide ${slideNum} (${sd.layout || 'CONTENT'}) ← cloned from ${path.basename(templateSlide.entryPath)}`);
    }

    if (newSlideInfos.length === 0) {
      throw new Error('No slides were generated');
    }

    // Update presentation.xml and its .rels to reference new slides
    const presXml = outputZip.getEntry('ppt/presentation.xml')?.getData().toString('utf8') || '';
    const relsXml = outputZip.getEntry('ppt/_rels/presentation.xml.rels')?.getData().toString('utf8') || '';
    const ctXml   = outputZip.getEntry('[Content_Types].xml')?.getData().toString('utf8') || '';

    const { updatedPres, updatedRels } = updatePresentationXml(presXml, relsXml, newSlideInfos);
    const updatedCt = updateContentTypes(ctXml, newSlideInfos.map(s => s.name));

    outputZip.updateFile('ppt/presentation.xml',            Buffer.from(updatedPres, 'utf8'));
    outputZip.updateFile('ppt/_rels/presentation.xml.rels', Buffer.from(updatedRels, 'utf8'));
    outputZip.updateFile('[Content_Types].xml',             Buffer.from(updatedCt,   'utf8'));

    // Update document title in core.xml
    const coreEntry = outputZip.getEntry('docProps/core.xml');
    if (coreEntry) {
      let coreXml = coreEntry.getData().toString('utf8');
      const safeTitle = escapeXml(title || 'Presentation');
      if (coreXml.includes('<dc:title>')) {
        coreXml = coreXml.replace(/<dc:title>.*?<\/dc:title>/, `<dc:title>${safeTitle}</dc:title>`);
      } else {
        coreXml = coreXml.replace('</cp:coreProperties>', `<dc:title>${safeTitle}</dc:title></cp:coreProperties>`);
      }
      outputZip.updateFile('docProps/core.xml', Buffer.from(coreXml, 'utf8'));
    }

    // Save output file
    const safeTitle  = (title || 'Presentation').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 40);
    const filename   = `GYS-${safeTitle}-${Date.now()}.pptx`;
    const filepath   = path.join(outputDir, filename);
    outputZip.writeZip(filepath);

    console.log(`✅ [PPT Template] "${filename}" — ${newSlideInfos.length} slides — template: "${path.basename(templatePath)}"`);

    return {
      pptxFile:     filepath,
      pptxUrl:      `/api/files/${filename}`,
      pptxName:     filename,
      slideCount:   newSlideInfos.length,
      usedTemplate: path.basename(templatePath),
      usedFallback: false,
    };
  },
};

// ─────────────────────────────────────────────────────────────
// Extract primary brand colors from template theme XML
// These are used when injecting text so colors match the template
// ─────────────────────────────────────────────────────────────

function extractThemeColors(zip) {
  const defaults = {
    primaryColor: '006A4E',
    accentColor:  '00A878',
    darkColor:    '111827',
    grayColor:    '6B7280',
  };

  try {
    const themeFiles = zip.getEntries()
      .filter(e => /ppt\/theme\/theme\d*\.xml$/.test(e.entryName));
    if (!themeFiles.length) return defaults;

    const themeXml = themeFiles[0].getData().toString('utf8');

    // Extract accent colors
    const accents = [];
    for (const m of themeXml.matchAll(/<a:accent\d[^>]*>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/g)) {
      accents.push(m[1].toUpperCase());
    }

    // Extract dk1 (dark text color)
    const dk1M = themeXml.match(/<a:dk1>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);

    return {
      primaryColor: accents[0] || defaults.primaryColor,
      accentColor:  accents[1] || accents[0] || defaults.accentColor,
      darkColor:    dk1M ? dk1M[1].toUpperCase() : defaults.darkColor,
      grayColor:    defaults.grayColor,
    };
  } catch {
    return defaults;
  }
}

export default PptxTemplateService;