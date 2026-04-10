// server/services/pptx-template.service.js
// ============================================================
// REWRITE: True template-based PPTX generation
//
// ROOT CAUSE FIX (2025-04):
//   The original replaceTextBodies() blindly replaced the 1st
//   and 2nd <p:txBody> in order. But template slides have:
//     txBody[0] = Title  (correct)
//     txBody[1] = Divider (a 0.01in decorative line!) <- WRONG
//     txBody[2] = Subtitle (small)
//     <p:pic>   = large image placeholder (4+ inches tall, unused)
//
//   Result: all body content was crammed into an invisible
//   0.01-inch divider line. Nobody could see anything.
//
// FIX STRATEGY:
//   1. replaceTextBodies() now reads the HEIGHT of each shape
//      before deciding if it's a body slot.
//      - Shapes < MIN_BODY_HEIGHT_EMU (0.1 in = 91440 EMU)
//        are treated as decorative and SKIPPED for body injection.
//   2. After text injection, if no large body slot was found
//      (because all remaining txBody are tiny), we REPLACE the
//      <p:pic> placeholder with a real <p:sp> text box that
//      occupies the same position/size as the picture.
//   3. The title injection is unchanged (always 1st txBody).
// ============================================================

import AdmZip from 'adm-zip';
import path   from 'path';
import fs     from 'fs';

// Minimum height in EMU to count as a "body" text box
// 0.1 inch = 91440 EMU  — Dividers are typically 12700 EMU (0.01 in)
const MIN_BODY_HEIGHT_EMU = 91440;

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

function makeRun(text, opts = {}) {
  const { sz = 1800, bold = false, color = null, typeface = null } = opts;
  const boldAttr  = bold ? ' b="1"' : '';
  const colorEl   = color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : '';
  const fontEl    = typeface ? `<a:latin typeface="${typeface}"/>` : '';
  return `<a:r><a:rPr lang="en-US" sz="${sz}"${boldAttr} dirty="0">${colorEl}${fontEl}</a:rPr><a:t>${escapeXml(text)}</a:t></a:r>`;
}

function makePara(text, opts = {}) {
  const { align = null, marL = 0, indent = 0, bullet = false, spcBef = 0 } = opts;
  const alignAttr = align ? ` algn="${align}"` : '';
  const marAttr   = marL ? ` marL="${marL}"` : '';
  const indAttr   = indent ? ` indent="${indent}"` : '';
  const bulletEl  = bullet ? `<a:buChar char="•"/>` : `<a:buNone/>`;
  const spcEl = spcBef ? `<a:spcBef><a:spcPts val="${spcBef}"/></a:spcBef>` : '';
  return `<a:p><a:pPr${alignAttr}${marAttr}${indAttr}>${bulletEl}${spcEl}</a:pPr>${makeRun(text, opts)}</a:p>`;
}

// ─────────────────────────────────────────────────────────────
// TEMPLATE ANALYSIS
// ─────────────────────────────────────────────────────────────

function analyzeTemplate(zip) {
  const presEntry = zip.getEntry('ppt/presentation.xml');
  const relsEntry = zip.getEntry('ppt/_rels/presentation.xml.rels');
  if (!presEntry || !relsEntry) {
    throw new Error('Invalid PPTX: missing presentation.xml or its .rels');
  }

  const presXml = presEntry.getData().toString('utf8');
  const relsXml = relsEntry.getData().toString('utf8');

  const relsMap = {};
  for (const m of relsXml.matchAll(/<Relationship\b([^>]+?)\/>/gs)) {
    const idM     = m[1].match(/\bId="([^"]+)"/);
    const targetM = m[1].match(/\bTarget="([^"]+)"/);
    if (idM && targetM) relsMap[idM[1]] = targetM[1];
  }

  const slideList = [];
  for (const m of presXml.matchAll(/<p:sldId\b([^>]+?)\/>/gs)) {
    const idM  = m[1].match(/\bid="(\d+)"/);
    const rIdM = m[1].match(/\br:id="([^"]+)"/);
    if (idM && rIdM) slideList.push({ id: idM[1], rId: rIdM[1] });
  }

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

  const slides = [];
  for (const { id, rId } of slideList) {
    const rawTarget = relsMap[rId];
    if (!rawTarget || !rawTarget.includes('slide')) continue;

    const entryPath = resolveTarget(rawTarget);
    const entry     = getEntry(entryPath, rawTarget, 'ppt/' + rawTarget);
    if (!entry) continue;

    const slideXml = entry.getData().toString('utf8');

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

    const shapeNames = [...slideXml.matchAll(/cNvPr id="\d+" name="([^"]+)"/g)].map(m => m[1]);
    const slideType  = classifySlide(slideXml, shapeNames);

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

  const titleSlide   = slides.find(s => s.slideType === 'TITLE')   || slides[0];
  const closingSlide = slides.find(s => s.slideType === 'CLOSING') || slides[slides.length - 1];
  const contentSlide = slides.find(s => s.slideType === 'CONTENT') || slides[1] || slides[0];
  const sectionSlide = slides.find(s => s.slideType === 'SECTION') || contentSlide;

  console.log(`[PPT Template] Analyzed ${slides.length} slides:`);
  slides.forEach(s => console.log(`  slide${s.index + 1}: type=${s.slideType} shapes=[${s.shapeNames.slice(0,4).join(',')}]`));

  return { slides, titleSlide, contentSlide, closingSlide, sectionSlide, getEntry, resolveTarget };
}

function classifySlide(xml, names) {
  const lowerNames = names.map(n => n.toLowerCase());
  const lowerXml   = xml.toLowerCase();

  if (lowerNames.some(n => n.includes('maintitle') || n.includes('main title'))) return 'TITLE';

  if (lowerXml.includes('thank you') || lowerXml.includes('terima kasih') ||
      lowerNames.some(n => n.includes('closing'))) {
    return 'CLOSING';
  }

  const hasTitle = lowerNames.some(n =>
    n.includes('title') || n === 'title 1' || n === 'title'
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
// BUILD PARAGRAPHS (same as before)
// ─────────────────────────────────────────────────────────────

function buildParagraphs(slideData, options = {}) {
  const layout  = (slideData.layout || 'CONTENT').toUpperCase();
  const { primaryColor = '006A4E', accentColor = '00A878', darkColor = '111827', grayColor = '6B7280' } = options;

  switch (layout) {
    case 'TITLE': {
      const title    = slideData.title    || '';
      const subtitle = slideData.subtitle || '';
      const meta     = [slideData.presenter, slideData.date].filter(Boolean).join('   •   ');
      return {
        title: [makePara(title, { sz: 4400, bold: true, color: 'FFFFFF', align: 'ctr' })],
        body: [
          ...(subtitle ? [makePara(subtitle, { sz: 2000, color: 'CCEEDF', align: 'ctr' })] : []),
          ...(meta     ? [makePara(meta,     { sz: 1400, color: 'A8D5C2', align: 'ctr' })] : []),
        ],
      };
    }

    case 'SECTION': {
      return {
        title: [makePara(slideData.title || '', { sz: 3600, bold: true, color: primaryColor })],
        body:  slideData.subtitle ? [makePara(slideData.subtitle, { sz: 1800, color: grayColor })] : [],
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
          ...(slideData.leftTitle  ? [makePara(slideData.leftTitle,  { sz: 1700, bold: true, color: darkColor,    spcBef: 200 })] : []),
          ...left.map(b  => makePara(String(b), { sz: 1400, color: grayColor, bullet: true, marL: 342900, indent: -342900 })),
          makePara('', { sz: 600 }),
          ...(slideData.rightTitle ? [makePara(slideData.rightTitle, { sz: 1700, bold: true, color: accentColor, spcBef: 200 })] : []),
          ...right.map(b => makePara(String(b), { sz: 1400, color: grayColor, bullet: true, marL: 342900, indent: -342900 })),
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
            ...(series.labels || []).map((l, i) =>
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

// ─────────────────────────────────────────────────────────────
// ✅ FIXED: INJECT CONTENT INTO TEMPLATE SLIDE XML
//
// KEY CHANGE: We now parse the height of each <p:sp> element
// before deciding if it qualifies as a "body" text slot.
// Shapes with cy < MIN_BODY_HEIGHT_EMU are decorative (Dividers)
// and are SKIPPED.
//
// If no body-sized txBody is found, we replace the <p:pic>
// image placeholder with a real text box at the same position.
// ─────────────────────────────────────────────────────────────

function injectIntoSlide(templateXml, slideData, options = {}) {
  const paragraphs = buildParagraphs(slideData, options);
  let xml = templateXml;

  xml = replaceTextBodiesFixed(xml, paragraphs, options);

  if (slideData.imagePath && fs.existsSync(slideData.imagePath) && options.imageRId) {
    xml = injectImage(xml, slideData.imagePath, options.imageRId);
  }

  return xml;
}

/**
 * ✅ FIXED replaceTextBodies
 *
 * Strategy:
 *  1. Find all <p:sp> elements in the XML.
 *  2. For the FIRST sp that has a txBody → inject title.
 *  3. For subsequent sp elements:
 *     - Read the cy (height) attribute from <a:ext>
 *     - If cy < MIN_BODY_HEIGHT_EMU → skip (it's a Divider line)
 *     - Otherwise → inject body content here
 *  4. If we never found a body slot big enough:
 *     - Find the <p:pic> element and REPLACE it with a <p:sp>
 *       text box at the same position/size, containing the body.
 */
function replaceTextBodiesFixed(xml, paragraphs, options = {}) {
  // ── STEP 1: Replace title in first txBody ──────────────────
  let result = xml;
  let titleDone = false;
  let bodyDone  = false;

  // We'll work on <p:sp> elements one at a time
  // Use a regex that captures each full <p:sp>...</p:sp>
  const spPattern = /(<p:sp>)([\s\S]*?)(<\/p:sp>)/g;

  result = result.replace(spPattern, (fullMatch, open, inner, close) => {
    // Extract height from <a:ext cy="...">
    const extMatch = inner.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/);
    const cy = extMatch ? parseInt(extMatch[2]) : 999999;

    // Does this sp have a txBody?
    const hasBody = inner.includes('<p:txBody>');
    if (!hasBody) return fullMatch;

    if (!titleDone) {
      // ── Title slot (always the first txBody sp) ──
      titleDone = true;
      const newInner = replaceOneTxBody(inner, paragraphs.title || []);
      return open + newInner + close;
    }

    if (!bodyDone) {
      // ── Body slot — only if height is substantial ──
      if (cy < MIN_BODY_HEIGHT_EMU) {
        // This is a Divider or tiny decorative element — SKIP IT
        console.log(`[PPT Template] Skipping thin shape (cy=${cy} EMU < ${MIN_BODY_HEIGHT_EMU}) for body injection`);
        return fullMatch;
      }
      bodyDone = true;
      const newInner = replaceOneTxBody(inner, paragraphs.body || []);
      return open + newInner + close;
    }

    return fullMatch;
  });

  // ── STEP 2: If body was never injected, replace the <p:pic> ──
  if (!bodyDone && (paragraphs.body || []).length > 0) {
    result = replacePicWithTextBox(result, paragraphs.body, options);
  }

  return result;
}

/**
 * Replace the content paragraphs inside a single txBody,
 * preserving the original <a:bodyPr> and <a:lstStyle>.
 */
function replaceOneTxBody(spInner, paragraphs) {
  return spInner.replace(/(<p:txBody>)([\s\S]*?)(<\/p:txBody>)/, (_, open, body, close) => {
    const bodyPrMatch   = body.match(/<a:bodyPr[^>]*(?:\/>|>[\s\S]*?<\/a:bodyPr>)/);
    const lstStyleMatch = body.match(/<a:lstStyle[^>]*(?:\/>|>[\s\S]*?<\/a:lstStyle>)/);
    const bodyPr   = bodyPrMatch   ? bodyPrMatch[0]   : '<a:bodyPr/>';
    const lstStyle = lstStyleMatch ? lstStyleMatch[0] : '<a:lstStyle/>';
    return open + bodyPr + lstStyle + paragraphs.join('') + close;
  });
}

/**
 * ✅ NEW: Replace the <p:pic> image placeholder with a <p:sp>
 * text box at the SAME position and size, containing body content.
 *
 * This handles templates where the large content area is a picture
 * placeholder rather than a text box (common in branded templates).
 */
function replacePicWithTextBox(xml, bodyParagraphs, options = {}) {
  const { primaryColor = '006A4E' } = options;

  const picMatch = xml.match(/<p:pic>([\s\S]*?)<\/p:pic>/);
  if (!picMatch) {
    console.log('[PPT Template] No <p:pic> found to replace — body content may be missing');
    return xml;
  }

  const picInner = picMatch[1];
  // Extract position from the pic
  const offMatch = picInner.match(/<a:off\s+x="(\d+)"\s+y="(\d+)"/);
  const extMatch = picInner.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/);

  if (!offMatch || !extMatch) {
    console.log('[PPT Template] Cannot read <p:pic> position — body content may be missing');
    return xml;
  }

  const x  = offMatch[1];
  const y  = offMatch[2];
  const cx = extMatch[1];
  const cy = extMatch[2];

  // Build a proper auto-fit text box at the pic's position
  const textBoxXml = `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="901" name="ContentBody"/>
    <p:cNvSpPr txBox="1"><a:spLocks/></p:cNvSpPr>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:noFill/>
    <a:ln><a:noFill/></a:ln>
  </p:spPr>
  <p:txBody>
    <a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720">
      <a:normAutofit/>
    </a:bodyPr>
    <a:lstStyle/>
    ${bodyParagraphs.join('')}
  </p:txBody>
</p:sp>`;

  console.log(`[PPT Template] Replaced <p:pic> with text box at x=${x} y=${y} cx=${cx} cy=${cy} (${(parseInt(cy)/914400).toFixed(2)}in tall)`);

  // Replace the <p:pic> element with our text box
  return xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/, textBoxXml);
}

// ─────────────────────────────────────────────────────────────
// INJECT IMAGE INTO SLIDE
// ─────────────────────────────────────────────────────────────

function injectImage(xml, imagePath, rId) {
  const picMatch = xml.match(/<p:pic>[\s\S]*?<\/p:pic>/);
  if (picMatch) {
    const newPic = picMatch[0].replace(/(r:embed=")[^"]*(")/g, `$1${rId}$2`);
    return xml.replace(picMatch[0], newPic);
  }

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
// PICK TEMPLATE SLIDE FOR LAYOUT TYPE
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

function getLayoutTarget(slideRelXml) {
  const m = slideRelXml?.match(/Type="[^"]*slideLayout"[^>]*Target="([^"]+)"/);
  return m ? m[1] : '../slideLayouts/slideLayout1.xml';
}

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

function mimeToExt(mime = '') {
  if (mime.includes('png'))  return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpeg';
  if (mime.includes('gif'))  return '.gif';
  if (mime.includes('webp')) return '.webp';
  return '.png';
}

// ─────────────────────────────────────────────────────────────
// EXTRACT THEME COLORS
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

    const accents = [];
    for (const m of themeXml.matchAll(/<a:accent\d[^>]*>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/g)) {
      accents.push(m[1].toUpperCase());
    }

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

// ─────────────────────────────────────────────────────────────
// MAIN PUBLIC API
// ─────────────────────────────────────────────────────────────

const PptxTemplateService = {

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

  async generate({ templatePath, pptData, title, outputDir, selectedImages = [] }) {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    let templateZip;
    try {
      templateZip = new AdmZip(templatePath);
    } catch (err) {
      throw new Error(`Cannot open template PPTX: ${err.message}`);
    }

    const analysis    = analyzeTemplate(templateZip);
    const themeColors = extractThemeColors(templateZip);
    console.log(`[PPT Template] Theme colors: primary=${themeColors.primaryColor} accent=${themeColors.accentColor}`);

    const outputZip = new AdmZip(templatePath);

    const toRemove = outputZip.getEntries()
      .filter(e => /^ppt\/slides\/(slide\d+\.xml|_rels\/slide\d+\.xml\.rels)$/.test(e.entryName))
      .map(e => e.entryName);
    toRemove.forEach(name => { try { outputZip.deleteFile(name); } catch {} });
    console.log(`[PPT Template] Removed ${toRemove.length} original slides, generating ${pptData.slides?.length || 0} new slides`);

    const newSlideInfos = [];
    const slides = pptData.slides || [];

    const existingMedia = outputZip.getEntries()
      .filter(e => e.entryName.startsWith('ppt/media/'))
      .map(e => e.entryName);
    let mediaCounter = existingMedia.length + 1;

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

      const templateSlide = pickTemplateSlide(analysis, sd.layout);

      let layoutTarget = '../slideLayouts/slideLayout1.xml';
      if (templateSlide.relPath) {
        const tRelEntry = templateZip.getEntry(templateSlide.relPath);
        if (tRelEntry) {
          layoutTarget = getLayoutTarget(tRelEntry.getData().toString('utf8'));
        }
      }

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

      const clonedXml = injectIntoSlide(
        templateSlide.xml,
        sd,
        { ...themeColors, imageRId }
      );

      const relXml = buildSlideRels(layoutTarget, imageTarget);

      outputZip.addFile(slidePath,    Buffer.from(clonedXml, 'utf8'));
      outputZip.addFile(slideRelPath, Buffer.from(relXml,    'utf8'));
      newSlideInfos.push({ name: slideName });

      console.log(`[PPT Template] Slide ${slideNum} (${sd.layout || 'CONTENT'}) ← template: ${path.basename(templateSlide.entryPath)}`);
    }

    if (newSlideInfos.length === 0) {
      throw new Error('No slides were generated');
    }

    const presXml = outputZip.getEntry('ppt/presentation.xml')?.getData().toString('utf8') || '';
    const relsXml = outputZip.getEntry('ppt/_rels/presentation.xml.rels')?.getData().toString('utf8') || '';
    const ctXml   = outputZip.getEntry('[Content_Types].xml')?.getData().toString('utf8') || '';

    const { updatedPres, updatedRels } = updatePresentationXml(presXml, relsXml, newSlideInfos);
    const updatedCt = updateContentTypes(ctXml, newSlideInfos.map(s => s.name));

    outputZip.updateFile('ppt/presentation.xml',            Buffer.from(updatedPres, 'utf8'));
    outputZip.updateFile('ppt/_rels/presentation.xml.rels', Buffer.from(updatedRels, 'utf8'));
    outputZip.updateFile('[Content_Types].xml',             Buffer.from(updatedCt,   'utf8'));

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

export default PptxTemplateService;
