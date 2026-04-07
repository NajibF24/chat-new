// server/services/pptx-template.service.js

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

function buildTxBody(bodyPrAttrs, paragraphs) {
  return `<p:txBody><a:bodyPr ${bodyPrAttrs}/><a:lstStyle/>${paragraphs.join('')}</p:txBody>`;
}

function makePara(text, opts = {}) {
  const {
    sz       = 1800,
    bold     = false,
    color    = null,
    align    = null,
    typeface = 'Tahoma',
    spcBef   = 100,
    marL     = 12700,
  } = opts;

  const boldAttr  = bold  ? ' b="1"' : '';
  const colorEl   = color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : '';
  const alignAttr = align ? ` algn="${align}"` : '';

  return `<a:p><a:pPr marL="${marL}"${alignAttr}><a:buNone/><a:spcBef><a:spcPts val="${spcBef}"/></a:spcBef></a:pPr><a:r><a:rPr lang="en-US" sz="${sz}"${boldAttr} spc="-95" dirty="0">${colorEl}<a:latin typeface="${typeface}"/></a:rPr><a:t>${escapeXml(text)}</a:t></a:r></a:p>`;
}

function makeBulletPara(text, opts = {}) {
  const { sz = 1400, color = '555555', typeface = 'Tahoma' } = opts;
  return `<a:p><a:pPr marL="228600" indent="-228600"><a:spcBef><a:spcPts val="100"/></a:spcBef><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" sz="${sz}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${typeface}"/></a:rPr><a:t>${escapeXml(text)}</a:t></a:r></a:p>`;
}

// ─────────────────────────────────────────────────────────────
// REPLACE TEXT IN NAMED SHAPE
// ─────────────────────────────────────────────────────────────

function replaceShapeText(slideXml, shapeName, newParagraphs, bodyPrAttrs = 'wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"') {
  const spRegex = /(<p:sp>)([\s\S]*?)(<\/p:sp>)/g;
  return slideXml.replace(spRegex, (fullMatch, open, inner, close) => {
    if (!inner.includes(`name="${shapeName}"`)) return fullMatch;
    const newTxBody = buildTxBody(bodyPrAttrs, newParagraphs);
    const replaced  = inner.replace(/<p:txBody>[\s\S]*?<\/p:txBody>/, newTxBody);
    return open + replaced + close;
  });
}

// ─────────────────────────────────────────────────────────────
// REPLACE IMAGE IN NAMED SHAPE (p:blipFill)
// Replaces r:embed on the first blipFill inside the named pic shape
// ─────────────────────────────────────────────────────────────

function replaceShapeImage(slideXml, shapeName, newRId) {
  // Target p:pic (not p:sp) that contains the given name
  const picRegex = /(<p:pic>)([\s\S]*?)(<\/p:pic>)/g;
  return slideXml.replace(picRegex, (fullMatch, open, inner, close) => {
    if (!inner.includes(`name="${shapeName}"`)) return fullMatch;
    // Replace r:embed="..." inside p:blipFill
    const replaced = inner.replace(/(r:embed=")[^"]*(")/g, `$1${newRId}$2`);
    return open + replaced + close;
  });
}

// ─────────────────────────────────────────────────────────────
// BUILD SLIDE XML — inject AI content into cloned template
// ─────────────────────────────────────────────────────────────

function buildSlideXml(templateXml, slideData, imageRId = null) {
  const layout = (slideData.layout || 'CONTENT').toUpperCase();
  let xml      = templateXml;

  // Always clear Divider placeholder so no stale template text shows
  xml = replaceShapeText(xml, 'Divider', [makePara('', { sz: 100 })]);

  const TEAL = '01775A';
  const DARK = '1F1F1F';
  const GRAY = '555555';

  switch (layout) {

    case 'TITLE': {
      // FIX: auto-shrink font based on title length to prevent overflow into TextBox 3
      const titleText = (slideData.title || '').substring(0, 100);
      const titleLen  = titleText.length;
      const titleSz   = titleLen > 60 ? 2800 : titleLen > 40 ? 3400 : 4400;

      xml = replaceShapeText(xml, 'MainTitle', [
        makePara(titleText, { sz: titleSz, typeface: 'Inter SemiBold', marL: 0, align: 'ctr', spcBef: 600 }),
      ], 'spcFirstLastPara="1" wrap="square" lIns="91425" tIns="91425" rIns="91425" bIns="91425" anchor="ctr" anchorCtr="1"');

      const subLines = [
        slideData.subtitle,
        slideData.presenter,
        slideData.date,
      ].filter(Boolean).map(t => makePara(t, { sz: 1600, color: 'FFFFFF', align: 'ctr', marL: 12700 }));

      if (subLines.length) {
        xml = replaceShapeText(xml, 'TextBox 3', subLines, 'wrap="square"');
      }
      break;
    }

    case 'SECTION': {
      xml = replaceShapeText(xml, 'Title', [
        makePara(slideData.title || '', { sz: 2800, bold: true, color: TEAL }),
        ...(slideData.subtitle ? [makePara(slideData.subtitle, { sz: 1600, color: GRAY })] : []),
      ]);
      xml = replaceShapeText(xml, 'Subtitle', [makePara('', { sz: 1000 })]);
      break;
    }

    case 'CLOSING': {
      xml = replaceShapeText(xml, 'Title', [
        makePara(slideData.title || 'Thank You', { sz: 2200, bold: true, color: TEAL }),
        ...(slideData.subtitle ? [makePara(slideData.subtitle, { sz: 1600, color: GRAY })] : []),
        ...(slideData.contact  ? [makePara(slideData.contact,  { sz: 1400, color: GRAY })] : []),
      ]);
      break;
    }

    case 'GRID': {
      const items = (slideData.items || []).slice(0, 4);
      xml = replaceShapeText(xml, 'Title', [
        makePara(slideData.title || '', { sz: 2200, bold: true, color: TEAL }),
      ]);
      const bodyParas = items.flatMap(item => [
        makePara(`${item.icon || '▪'} ${item.title || ''}`, { sz: 1600, bold: true, color: DARK }),
        ...(item.text ? [makePara(item.text, { sz: 1300, color: GRAY, marL: 342900 })] : []),
        makePara('', { sz: 600 }),
      ]);
      xml = replaceShapeText(xml, 'Subtitle', bodyParas, 'wrap="square" lIns="91440" tIns="0"');
      break;
    }

    case 'STATS': {
      const stats = (slideData.stats || []).slice(0, 4);
      xml = replaceShapeText(xml, 'Title', [
        makePara(slideData.title || '', { sz: 2200, bold: true, color: TEAL }),
      ]);
      const bodyParas = stats.flatMap(s => [
        makePara(`${s.icon || '📊'} ${s.value || ''} — ${s.label || ''}`, { sz: 2000, bold: true, color: TEAL }),
        ...(s.sub ? [makePara(s.sub, { sz: 1300, color: GRAY, marL: 342900 })] : []),
        makePara('', { sz: 600 }),
      ]);
      xml = replaceShapeText(xml, 'Subtitle', bodyParas, 'wrap="square" lIns="91440" tIns="0"');
      break;
    }

    case 'TIMELINE': {
      const steps = slideData.steps || [];
      xml = replaceShapeText(xml, 'Title', [
        makePara(slideData.title || '', { sz: 2200, bold: true, color: TEAL }),
      ]);
      const bodyParas = steps.flatMap((s, i) => [
        makePara(`${i + 1}. ${s.time || ''} — ${s.title || ''}`, { sz: 1600, bold: true, color: TEAL }),
        ...(s.text ? [makePara(s.text, { sz: 1300, color: GRAY, marL: 342900 })] : []),
        makePara('', { sz: 600 }),
      ]);
      xml = replaceShapeText(xml, 'Subtitle', bodyParas, 'wrap="square" lIns="91440" tIns="0"');
      break;
    }

    case 'TWO_COLUMN': {
      const left  = (slideData.leftBullets  || slideData.left  || []).filter(Boolean);
      const right = (slideData.rightBullets || slideData.right || []).filter(Boolean);
      xml = replaceShapeText(xml, 'Title', [
        makePara(slideData.title || '', { sz: 2200, bold: true, color: TEAL }),
      ]);
      const bodyParas = [
        ...(slideData.leftTitle  ? [makePara(slideData.leftTitle,  { sz: 1600, bold: true, color: DARK })] : []),
        ...left.map(b  => makeBulletPara(String(b))),
        makePara('', { sz: 800 }),
        ...(slideData.rightTitle ? [makePara(slideData.rightTitle, { sz: 1600, bold: true, color: TEAL })] : []),
        ...right.map(b => makeBulletPara(String(b), { color: TEAL })),
      ];
      xml = replaceShapeText(xml, 'Subtitle', bodyParas, 'wrap="square" lIns="91440" tIns="0"');
      break;
    }

    case 'TABLE': {
      const headers = slideData.tableHeaders || [];
      const rows    = slideData.tableRows    || [];
      xml = replaceShapeText(xml, 'Title', [
        makePara(slideData.title || '', { sz: 2200, bold: true, color: TEAL }),
      ]);
      const bodyParas = [
        ...(headers.length ? [makePara(headers.join('  |  '), { sz: 1400, bold: true, color: TEAL })] : []),
        ...(headers.length ? [makePara('─'.repeat(50), { sz: 800, color: GRAY })] : []),
        ...rows.map(row => makePara(
          (Array.isArray(row) ? row : [row]).join('  |  '),
          { sz: 1300, color: GRAY }
        )),
      ];
      xml = replaceShapeText(xml, 'Subtitle', bodyParas, 'wrap="square" lIns="91440" tIns="0"');
      break;
    }

    case 'CHART': {
      const cfg  = slideData.chartConfig || {};
      const data = cfg.data || [];
      xml = replaceShapeText(xml, 'Title', [
        makePara(slideData.title || '', { sz: 2200, bold: true, color: TEAL }),
      ]);
      const bodyParas = [
        ...(slideData.insightText ? [makePara(`💡 ${slideData.insightText}`, { sz: 1500, bold: true, color: TEAL })] : []),
        makePara('', { sz: 600 }),
        ...data.flatMap(series => {
          const labels = series.labels || [];
          const values = series.values || [];
          return [
            makePara(`📊 ${series.name || 'Data'}`, { sz: 1400, bold: true, color: DARK }),
            ...labels.map((l, i) => makePara(`${l}: ${values[i] ?? '—'}`, { sz: 1300, color: GRAY, marL: 342900 })),
          ];
        }),
      ];
      xml = replaceShapeText(xml, 'Subtitle', bodyParas, 'wrap="square" lIns="91440" tIns="0"');
      break;
    }

    case 'QUOTE': {
      xml = replaceShapeText(xml, 'Title', [
        makePara(`"${slideData.quote || slideData.title || ''}"`, { sz: 2400, color: TEAL, align: 'ctr', marL: 0 }),
        ...(slideData.author ? [makePara(`— ${slideData.author}`, { sz: 1600, color: GRAY, align: 'ctr', marL: 0 })] : []),
      ]);
      break;
    }

    case 'IMAGE': {
      xml = replaceShapeText(xml, 'Title', [
        makePara(slideData.title || '', { sz: 2200, bold: true, color: TEAL }),
      ]);
      // Replace caption in Subtitle shape
      if (slideData.caption) {
        xml = replaceShapeText(xml, 'Subtitle', [
          makePara(slideData.caption, { sz: 1300, color: GRAY }),
        ], 'wrap="square" lIns="91440" tIns="0"');
      }
      // FIX: inject actual image into "Image 0" shape if imageRId provided
      if (imageRId) {
        xml = replaceShapeImage(xml, 'Image 0', imageRId);
      }
      break;
    }

    case 'CONTENT':
    default: {
      xml = replaceShapeText(xml, 'Title', [
        makePara(slideData.title || '', { sz: 2200, bold: true, color: TEAL }),
      ]);
      const bullets = (slideData.bullets || []).filter(Boolean);
      const body    = bullets.length > 0
        ? bullets.map(b => makeBulletPara(String(b)))
        : slideData.body ? [makePara(slideData.body, { sz: 1400, color: GRAY })] : [];
      if (body.length) {
        xml = replaceShapeText(xml, 'Subtitle', body, 'wrap="square" lIns="91440" tIns="0"');
      }
      break;
    }
  }

  return xml;
}

// ─────────────────────────────────────────────────────────────
// RELS PARSING
// ─────────────────────────────────────────────────────────────

function parseRels(relsXml) {
  const map  = {};
  const tags = [...relsXml.matchAll(/<Relationship\b([^>]+?)\/>/gs)];
  for (const tag of tags) {
    const attrs   = tag[1];
    const idM     = attrs.match(/\bId="([^"]+)"/);
    const targetM = attrs.match(/\bTarget="([^"]+)"/);
    if (idM && targetM) map[idM[1]] = targetM[1];
  }
  return map;
}

function parseSlideList(presXml) {
  const tags = [...presXml.matchAll(/<p:sldId\b([^>]+?)\/>/gs)];
  return tags.map(tag => {
    const attrs = tag[1];
    const idM   = attrs.match(/\bid="(\d+)"/);
    const rIdM  = attrs.match(/\br:id="([^"]+)"/);
    return { id: idM?.[1] || '0', rId: rIdM?.[1] || '' };
  }).filter(s => s.rId);
}

function resolveTarget(target) {
  if (!target) return null;
  let t = target.replace(/^\//, '');
  if (t.startsWith('../')) return 'ppt/' + t.replace(/^\.\.\//, '');
  if (t.startsWith('slides/')) return 'ppt/' + t;
  if (!t.startsWith('ppt/')) return 'ppt/' + t;
  return t;
}

function findEntry(zip, ...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const e = zip.getEntry(c) || zip.getEntry(c.replace(/^\//, ''));
    if (e) return e;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// ANALYZE TEMPLATE
// ─────────────────────────────────────────────────────────────

function analyzeTemplate(zip) {
  const presEntry = zip.getEntry('ppt/presentation.xml');
  const relsEntry = zip.getEntry('ppt/_rels/presentation.xml.rels');
  if (!presEntry || !relsEntry) return null;

  const presXml   = presEntry.getData().toString('utf8');
  const relsXml   = relsEntry.getData().toString('utf8');
  const slideList = parseSlideList(presXml);
  const relsMap   = parseRels(relsXml);

  console.log(`[PPT Template] Found ${slideList.length} slides in sldIdLst`);
  console.log(`[PPT Template] Slide rels: ${Object.entries(relsMap).filter(([,v]) => v.includes('slide')).map(([k,v])=>`${k}→${v}`).join(', ')}`);

  const slides = [];
  for (const { id, rId } of slideList) {
    const rawTarget = relsMap[rId];
    if (!rawTarget || !rawTarget.includes('slide')) continue;

    const entry = findEntry(zip,
      resolveTarget(rawTarget),
      rawTarget,
      'ppt/' + rawTarget,
    );

    if (!entry) {
      console.warn(`[PPT Template] Entry not found for rId=${rId} target="${rawTarget}"`);
      continue;
    }

    const slideXml = entry.getData().toString('utf8');
    const txCount  = (slideXml.match(/<p:txBody>/g) || []).length;
    const names    = [...slideXml.matchAll(/cNvPr id="\d+" name="([^"]+)"/g)].map(m => m[1]);
    const hasPic   = slideXml.includes('<p:blipFill>');

    slides.push({ index: slides.length, path: entry.entryName, rId, txCount, names, hasPic });
    console.log(`[PPT Template] slide${slides.length}: txBody=${txCount} names=[${names.slice(0,5).join(',')}] hasPic=${hasPic}`);
  }

  if (slides.length === 0) return null;

  const titleSlide   = slides[0];
  const closingSlide = slides[slides.length - 1];
  const contentSlide = slides.find(s => s.names.includes('Title') && s.names.includes('Subtitle'))
                    || slides.find(s => s.names.includes('Title'))
                    || (slides.length > 1 ? slides[1] : slides[0]);

  console.log(`[PPT Template] TITLE=slide${titleSlide.index+1}(${titleSlide.path}) CONTENT=slide${contentSlide.index+1}(${contentSlide.path}) CLOSING=slide${closingSlide.index+1}(${closingSlide.path})`);
  const imageSlide = slides.find(s => s.hasPic && s.names.includes('Image 0'))
               || slides.find(s => s.hasPic)
               || contentSlide;

  return { slides, titleSlide, contentSlide, closingSlide, imageSlide };

}

function pickTemplateSlide(analysis, layout) {
  const L = layout.toUpperCase();
  if (L === 'TITLE')   return analysis.titleSlide;
  if (L === 'CLOSING') return analysis.closingSlide;
  if (L === 'IMAGE')   return analysis.imageSlide; 
  return analysis.contentSlide;
}

// ─────────────────────────────────────────────────────────────
// FIND TEMPLATE PPTX IN KNOWLEDGE BASE
// ─────────────────────────────────────────────────────────────

function findPptxTemplate(bot) {
  if (!bot?.knowledgeFiles?.length) return null;

  const priorityWords = ['template', 'gys', 'master', 'tema', 'theme'];
  const pptxFiles = bot.knowledgeFiles.filter(f => {
    const filePath = f.path || f.serverPath || '';
    return /\.(pptx?)$/i.test(f.originalName) && filePath && fs.existsSync(filePath);
  });

  if (!pptxFiles.length) return null;

  const sorted = [...pptxFiles].sort((a, b) => {
    const aS = priorityWords.filter(w => a.originalName.toLowerCase().includes(w)).length;
    const bS = priorityWords.filter(w => b.originalName.toLowerCase().includes(w)).length;
    return bS - aS;
  });

  const chosen   = sorted[0];
  const filePath = chosen.path || chosen.serverPath;
  console.log(`[PPT Template] Template: "${chosen.originalName}" at "${filePath}"`);
  return { filePath, fileName: chosen.originalName };
}

// ─────────────────────────────────────────────────────────────
// UPDATE MANIFEST FILES
// ─────────────────────────────────────────────────────────────

function updatePresentationXml(presXml, relsXml, newSlides) {
  // FIX Bug 1: hanya ambil ID dari p:sldId, bukan semua atribut id="..."
  // Filter id < 400 untuk menghindari slideMasterId yang sangat besar (>2147483647)
  const existingSlideIds = [...presXml.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)]
    .map(m => parseInt(m[1]))
    .filter(id => id < 400);
  let maxId = existingSlideIds.length > 0 ? Math.max(256, ...existingSlideIds) : 256;

  let sldIdBlock = '';
  const newRels  = [];

  newSlides.forEach((slide, i) => {
    maxId++;
    const rId   = `rId_gen_${i + 1}`;
    slide._rId  = rId;
    sldIdBlock += `<p:sldId id="${maxId}" r:id="${rId}"/>`;
    newRels.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/${slide.name}"/>`);
  });

  const updatedPres = presXml.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${sldIdBlock}</p:sldIdLst>`
  );

  let updatedRels = relsXml.replace(
    /<Relationship\b[^>]*\/slide"[^>]*\/>/g, ''
  );
  updatedRels = updatedRels.replace('</Relationships>', newRels.join('\n') + '\n</Relationships>');

  return { updatedPres, updatedRels };
}

function updateContentTypes(ctXml, slideNames) {
  let updated = ctXml.replace(/<Override[^>]+presentationml\.slide\+xml[^>]+\/>/g, '');
  const overrides = slideNames.map(n =>
    `<Override PartName="/ppt/slides/${n}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  ).join('\n');
  return updated.replace('</Types>', overrides + '\n</Types>');
}

function buildDefaultRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
}

// FIX Bug 2: buat rels bersih per slide, tanpa image ref sisa dari template
function buildCleanRels(slideLayoutTarget = '../slideLayouts/slideLayout2.xml', imageTarget = null) {
  const imageRel = imageTarget
    ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${imageTarget}"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${slideLayoutTarget}"/>${imageRel}</Relationships>`;
}

// ─────────────────────────────────────────────────────────────
// MIME → extension map
// ─────────────────────────────────────────────────────────────

function mimeToExt(mime = '') {
  if (mime.includes('png'))  return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpeg';
  if (mime.includes('gif'))  return '.gif';
  if (mime.includes('webp')) return '.webp';
  return '.png';
}

// ─────────────────────────────────────────────────────────────
// MAIN SERVICE
// ─────────────────────────────────────────────────────────────

const PptxTemplateService = {

  hasTemplate(bot) {
    return findPptxTemplate(bot) !== null;
  },

  async generate({ bot, pptData, title, outputDir, docxImages = [] }) {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const templateInfo = findPptxTemplate(bot);
    if (!templateInfo) return null;

    let zip;
    try {
      zip = new AdmZip(templateInfo.filePath);
    } catch (err) {
      console.error('[PPT Template] Cannot open ZIP:', err.message);
      return null;
    }

    // FIX Bug B: simpan template ZIP terpisah untuk referensi closing/title slide
    // karena newZip akan delete semua slide lama
    const analysis = analyzeTemplate(zip);
    if (!analysis) {
      console.error('[PPT Template] Template analysis failed');
      return null;
    }

    const newZip   = new AdmZip(templateInfo.filePath);
    const toRemove = newZip.getEntries()
      .filter(e => /^ppt\/slides\/(slide\d+\.xml|_rels\/slide\d+\.xml\.rels)$/.test(e.entryName))
      .map(e => e.entryName);

    toRemove.forEach(name => { try { newZip.deleteFile(name); } catch {} });
    console.log(`[PPT Template] Removed ${toRemove.length} old slide entries, generating ${pptData.slides?.length || 0} new slides`);

    const slides       = pptData.slides || [];
    const newSlideInfo = [];

    // Track next available media index for injected images
    const existingMedia = newZip.getEntries()
      .filter(e => e.entryName.startsWith('ppt/media/'))
      .map(e => e.entryName);
    let mediaCounter = existingMedia.length + 1;

    for (let i = 0; i < slides.length; i++) {
      const slideData = slides[i];
      const slideNum  = i + 1;
      const slideName    = `slide${slideNum}.xml`;
      const slidePath    = `ppt/slides/${slideName}`;
      const slideRelPath = `ppt/slides/_rels/${slideName}.rels`;

      const templateSlide = pickTemplateSlide(analysis, slideData.layout || 'CONTENT');

      // FIX Bug B: selalu ambil dari zip asli (bukan newZip) karena slide lama sudah dihapus
      const templateEntry = findEntry(zip, templateSlide.path);
      const templateXml   = templateEntry
        ? templateEntry.getData().toString('utf8')
        : buildMinimalSlideXml();

      // Determine layout target dari rels template
      const templateRelPath  = `ppt/slides/_rels/${path.basename(templateSlide.path)}.rels`;
      const templateRelEntry = findEntry(zip, templateRelPath);
      let layoutTarget = '../slideLayouts/slideLayout2.xml';
      if (templateRelEntry) {
        const tRels = templateRelEntry.getData().toString('utf8');
        const lm = tRels.match(/Target="(\.\.\/slideLayouts\/[^"]+)"/);
        if (lm) layoutTarget = lm[1];
      }

      // FIX: inject image untuk layout IMAGE
      let imageRId    = null;
      let imageTarget = null;

      if ((slideData.layout || '').toUpperCase() === 'IMAGE' && docxImages.length > 0) {
        const imgIndex = typeof slideData.imageIndex === 'number'
          ? slideData.imageIndex
          : 0;
        const img = docxImages[imgIndex] || docxImages[0];

        if (img) {
          const ext       = mimeToExt(img.mime);
          const mediaName = `image_injected_${mediaCounter}${ext}`;
          const mediaPath = `ppt/media/${mediaName}`;
          const imgBuffer = img.data || Buffer.from(img.base64 || '', 'base64');

          newZip.addFile(mediaPath, imgBuffer);
          imageRId    = `rId2`;
          imageTarget = `../media/${mediaName}`;
          mediaCounter++;

          console.log(`[PPT Template] Slide ${slideNum} IMAGE: injected ${mediaName} (index=${imgIndex})`);
        }
      }

      const newSlideXml = buildSlideXml(templateXml, slideData, imageRId);
      const relXml      = buildCleanRels(layoutTarget, imageTarget);

      newZip.addFile(slidePath,    Buffer.from(newSlideXml, 'utf8'));
      newZip.addFile(slideRelPath, Buffer.from(relXml, 'utf8'));
      newSlideInfo.push({ name: slideName });

      console.log(`[PPT Template] Slide ${slideNum} (${slideData.layout || 'CONTENT'}) ← ${path.basename(templateSlide.path)}`);
    }

    if (!newSlideInfo.length) {
      console.error('[PPT Template] No slides generated');
      return null;
    }

    // Update manifest
    const presXml = newZip.getEntry('ppt/presentation.xml')?.getData().toString('utf8') || '';
    const relsXml = newZip.getEntry('ppt/_rels/presentation.xml.rels')?.getData().toString('utf8') || '';
    const ctXml   = newZip.getEntry('[Content_Types].xml')?.getData().toString('utf8') || '';

    const { updatedPres, updatedRels } = updatePresentationXml(presXml, relsXml, newSlideInfo);
    const updatedCt = updateContentTypes(ctXml, newSlideInfo.map(s => s.name));

    newZip.updateFile('ppt/presentation.xml',            Buffer.from(updatedPres, 'utf8'));
    newZip.updateFile('ppt/_rels/presentation.xml.rels', Buffer.from(updatedRels, 'utf8'));
    newZip.updateFile('[Content_Types].xml',             Buffer.from(updatedCt,   'utf8'));

    // Update title in core.xml
    const coreEntry = newZip.getEntry('docProps/core.xml');
    if (coreEntry) {
      let coreXml = coreEntry.getData().toString('utf8');
      coreXml = coreXml.includes('<dc:title>')
        ? coreXml.replace(/<dc:title>.*?<\/dc:title>/, `<dc:title>${escapeXml(title)}</dc:title>`)
        : coreXml.replace('</cp:coreProperties>', `<dc:title>${escapeXml(title)}</dc:title></cp:coreProperties>`);
      newZip.updateFile('docProps/core.xml', Buffer.from(coreXml, 'utf8'));
    }

    // Register injected images in [Content_Types].xml
    // (png/jpeg/gif already have Default entries in most PPTX — skip if already there)

    const safeTitle = (title || 'Presentation').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 40);
    const filename  = `GYS-${safeTitle}-${Date.now()}.pptx`;
    const filepath  = path.join(outputDir, filename);
    newZip.writeZip(filepath);

    console.log(`✅ [PPT Template] "${filename}" — ${newSlideInfo.length} slides — template: "${templateInfo.fileName}"`);

    return {
      pptxFile:     filepath,
      pptxUrl:      `/api/files/${filename}`,
      pptxName:     filename,
      slideCount:   newSlideInfo.length,
      usedTemplate: templateInfo.fileName,
      usedFallback: false,
    };
  },
};

function buildMinimalSlideXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="10" name="Title"/><p:cNvSpPr txBox="1"><a:spLocks/></p:cNvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1260430" y="360712"/><a:ext cx="7500000" cy="380000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2200" b="1" dirty="0"/><a:t>Slide</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="12" name="Subtitle"/><p:cNvSpPr txBox="1"><a:spLocks/></p:cNvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="822000" y="800000"/><a:ext cx="7500000" cy="3900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1400" dirty="0"/><a:t></a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

export default PptxTemplateService;
