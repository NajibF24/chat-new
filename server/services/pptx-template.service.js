// server/services/pptx-template.service.js
// ============================================================
// GYS Portal AI — Template-Based PPTX Service
// FIX: Proper path normalization for slide entries in ZIP
// FIX: Robust txBody counting via direct ZIP entry access
// FIX: Better fallback logic when template slides can't be parsed
// ============================================================

import AdmZip  from 'adm-zip';
import path    from 'path';
import fs      from 'fs';
import { v4 as uuidv4 } from 'uuid';

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

function parseSlideList(presentationXml) {
  const matches = [...presentationXml.matchAll(/<p:sldId\s+id="(\d+)"\s+r:id="([^"]+)"/g)];
  return matches.map(m => ({ id: m[1], rId: m[2] }));
}

function parseRels(relsXml) {
  const map = {};
  // Match both self-closing and regular tags, handle extra attributes
  const matches = [...relsXml.matchAll(/Id="([^"]+)"[^/]*Target="([^"]+)"/g)];
  matches.forEach(m => { map[m[1]] = m[2]; });
  return map;
}

function extractTextFromSlideXml(slideXml) {
  const texts = [];
  const matches = [...slideXml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)];
  matches.forEach(m => { if (m[1].trim()) texts.push(m[1].trim()); });
  return texts.join(' ');
}

// ─────────────────────────────────────────────────────────────
// PATH RESOLVER — critical fix
// PPTX rels Target can be:
//   "../slides/slide1.xml"  (relative from _rels folder)
//   "slides/slide1.xml"     (relative from ppt folder)
//   "/ppt/slides/slide1.xml" (absolute)
// AdmZip entries are stored WITHOUT leading slash.
// ─────────────────────────────────────────────────────────────

function resolveSlideEntryName(target) {
  if (!target) return null;

  // Remove leading slash
  let t = target.replace(/^\//, '');

  // Handle relative path from ppt/_rels/presentation.xml.rels
  // "../slides/slide1.xml" → "ppt/slides/slide1.xml"
  if (t.startsWith('../')) {
    t = 'ppt/' + t.replace(/^\.\.\//, '');
  }
  // "slides/slide1.xml" → "ppt/slides/slide1.xml"
  else if (t.startsWith('slides/')) {
    t = 'ppt/' + t;
  }
  // already has ppt/ prefix
  else if (!t.startsWith('ppt/')) {
    t = 'ppt/' + t;
  }

  return t;
}

function resolveRelEntryName(slidePath) {
  // ppt/slides/slide1.xml → ppt/slides/_rels/slide1.xml.rels
  const dir      = path.dirname(slidePath);   // ppt/slides
  const base     = path.basename(slidePath);  // slide1.xml
  return `${dir}/_rels/${base}.rels`;
}

/** Try multiple path variants and return first entry found */
function findEntry(zip, ...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const e = zip.getEntry(c);
    if (e) return e;
    // Also try without leading slash
    const e2 = zip.getEntry(c.replace(/^\//, ''));
    if (e2) return e2;
  }
  return null;
}

function makeParagraph(text, opts = {}) {
  const {
    bold        = false,
    fontSize    = 1800,
    color       = null,
    align       = 'l',
    lineSpacing = 1800,
  } = opts;

  const boldAttr = bold  ? ' b="1"' : '';
  const colorEl  = color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : '';

  return `<a:p>
    <a:pPr algn="${align}">
      <a:lnSpc><a:spcPts val="${lineSpacing}"/></a:lnSpc>
    </a:pPr>
    <a:r>
      <a:rPr lang="id-ID" sz="${fontSize}"${boldAttr} dirty="0">
        ${colorEl}
      </a:rPr>
      <a:t>${escapeXml(text)}</a:t>
    </a:r>
  </a:p>`;
}

function makeBulletParagraph(text, opts = {}) {
  const { fontSize = 1600, color = null, indent = 0 } = opts;
  const colorEl = color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : '';
  return `<a:p>
    <a:pPr marL="${457200 + indent * 228600}" indent="-457200">
      <a:buFont typeface="+mj-lt"/>
      <a:buChar char="&#x2022;"/>
    </a:pPr>
    <a:r>
      <a:rPr lang="id-ID" sz="${fontSize}" dirty="0">
        ${colorEl}
      </a:rPr>
      <a:t>${escapeXml(text)}</a:t>
    </a:r>
  </a:p>`;
}

function buildTxBody(paragraphs) {
  return `<a:txBody>
  <a:bodyPr/>
  <a:lstStyle/>
  ${paragraphs.join('\n  ')}
</a:txBody>`;
}

// ─────────────────────────────────────────────────────────────
// SLIDE CONTENT INJECTOR
// ─────────────────────────────────────────────────────────────

function injectContentIntoSlideXml(templateSlideXml, slideData) {
  let xml = templateSlideXml;
  const layout = (slideData.layout || 'CONTENT').toUpperCase();

  const txBodyRegex = /<a:txBody>([\s\S]*?)<\/a:txBody>/g;
  const txBodies    = [...xml.matchAll(txBodyRegex)];

  if (txBodies.length === 0) {
    // No text boxes — append a basic text box with the title
    const titleBlock = `<p:sp>
      <p:nvSpPr>
        <p:cNvPr id="99" name="Title"/>
        <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
        <p:nvPr><p:ph type="title"/></p:nvPr>
      </p:nvSpPr>
      <p:spPr/>
      ${buildTxBody([makeParagraph(slideData.title || '', { bold: true, fontSize: 2400 })])}
    </p:sp>`;

    xml = xml.replace('</p:spTree>', titleBlock + '</p:spTree>');
    return xml;
  }

  let titleContent = '';
  let bodyContent  = '';

  switch (layout) {
    case 'TITLE': {
      titleContent = buildTxBody([
        makeParagraph(slideData.title || '', { bold: true, fontSize: 4000, align: 'c' }),
        slideData.subtitle  ? makeParagraph(slideData.subtitle,  { fontSize: 2200, align: 'c' }) : '',
        slideData.presenter ? makeParagraph(slideData.presenter, { fontSize: 1600, align: 'c' }) : '',
        slideData.date      ? makeParagraph(slideData.date,      { fontSize: 1400, align: 'c' }) : '',
      ].filter(Boolean));
      break;
    }
    case 'SECTION': {
      titleContent = buildTxBody([
        slideData.sectionNumber ? makeParagraph(String(slideData.sectionNumber), { fontSize: 5000, bold: true }) : '',
        makeParagraph(slideData.title || '', { bold: true, fontSize: 3200 }),
        slideData.subtitle ? makeParagraph(slideData.subtitle, { fontSize: 1800 }) : '',
      ].filter(Boolean));
      break;
    }
    case 'STATS': {
      const stats = (slideData.stats || []).slice(0, 4);
      titleContent = buildTxBody([makeParagraph(slideData.title || '', { bold: true, fontSize: 2400 })]);
      bodyContent  = buildTxBody(stats.map(s =>
        makeParagraph(`${s.icon || ''} ${s.value || ''} — ${s.label || ''}${s.sub ? ` (${s.sub})` : ''}`, { fontSize: 1600 })
      ));
      break;
    }
    case 'TIMELINE': {
      const steps = slideData.steps || [];
      titleContent = buildTxBody([makeParagraph(slideData.title || '', { bold: true, fontSize: 2400 })]);
      bodyContent  = buildTxBody(steps.map((s, i) =>
        makeParagraph(`${i + 1}. ${s.time || ''} — ${s.title || ''}: ${s.text || ''}`, { fontSize: 1500 })
      ));
      break;
    }
    case 'TWO_COLUMN': {
      titleContent = buildTxBody([makeParagraph(slideData.title || '', { bold: true, fontSize: 2400 })]);
      const left   = (slideData.leftBullets  || slideData.left  || []);
      const right  = (slideData.rightBullets || slideData.right || []);
      bodyContent  = buildTxBody([
        slideData.leftTitle  ? makeParagraph(slideData.leftTitle,  { bold: true, fontSize: 1800 }) : '',
        ...left.map(b => makeBulletParagraph(b)),
        makeParagraph('', {}),
        slideData.rightTitle ? makeParagraph(slideData.rightTitle, { bold: true, fontSize: 1800 }) : '',
        ...right.map(b => makeBulletParagraph(b)),
      ].filter(Boolean));
      break;
    }
    case 'QUOTE': {
      titleContent = buildTxBody([
        makeParagraph(`"${slideData.quote || slideData.title || ''}"`, { fontSize: 2400 }),
        slideData.author ? makeParagraph(`— ${slideData.author}`, { fontSize: 1600 }) : '',
      ].filter(Boolean));
      break;
    }
    case 'TABLE': {
      const headers = slideData.tableHeaders || [];
      const rows    = slideData.tableRows    || [];
      titleContent  = buildTxBody([makeParagraph(slideData.title || '', { bold: true, fontSize: 2400 })]);
      const tableLines = [
        headers.join(' | '),
        headers.map(() => '---').join(' | '),
        ...rows.map(r => (Array.isArray(r) ? r : [r]).join(' | ')),
      ];
      bodyContent = buildTxBody(tableLines.map(l => makeParagraph(l, { fontSize: 1300 })));
      break;
    }
    case 'GRID': {
      const items  = (slideData.items || []).slice(0, 4);
      titleContent = buildTxBody([makeParagraph(slideData.title || '', { bold: true, fontSize: 2400 })]);
      bodyContent  = buildTxBody(items.flatMap(item => [
        makeParagraph(`${item.icon || '▪'} ${item.title || ''}`, { bold: true, fontSize: 1700 }),
        item.text ? makeParagraph(item.text, { fontSize: 1400 }) : '',
        makeParagraph('', {}),
      ].filter(Boolean)));
      break;
    }
    case 'CLOSING': {
      titleContent = buildTxBody([
        makeParagraph(slideData.title || 'Thank You', { bold: true, fontSize: 4000, align: 'c' }),
        slideData.subtitle ? makeParagraph(slideData.subtitle, { fontSize: 2000, align: 'c' }) : '',
        slideData.contact  ? makeParagraph(slideData.contact,  { fontSize: 1600, align: 'c' }) : '',
      ].filter(Boolean));
      break;
    }
    case 'CONTENT':
    default: {
      titleContent = buildTxBody([makeParagraph(slideData.title || '', { bold: true, fontSize: 2400 })]);
      const bullets = (slideData.bullets || []).filter(Boolean);
      if (bullets.length > 0) {
        bodyContent = buildTxBody(bullets.map(b => makeBulletParagraph(b, { fontSize: 1600 })));
      } else if (slideData.body) {
        bodyContent = buildTxBody([makeParagraph(slideData.body, { fontSize: 1600 })]);
      }
      break;
    }
  }

  let replaceCount = 0;
  xml = xml.replace(txBodyRegex, (match) => {
    replaceCount++;
    if (replaceCount === 1 && titleContent) return titleContent;
    if (replaceCount === 2 && bodyContent)  return bodyContent;
    return match;
  });

  return xml;
}

// ─────────────────────────────────────────────────────────────
// ANALYZE TEMPLATE SLIDES — FIXED path resolution
// ─────────────────────────────────────────────────────────────

function analyzeTemplateSlides(zip) {
  const presEntry = zip.getEntry('ppt/presentation.xml');
  const relsEntry = zip.getEntry('ppt/_rels/presentation.xml.rels');

  if (!presEntry || !relsEntry) {
    console.error('[PPT Template] Missing presentation.xml or rels');
    return { slides: [], byType: { TITLE: null, SECTION: null, CONTENT: null, CLOSING: null, BLANK: null } };
  }

  const presentationXml = presEntry.getData().toString('utf8');
  const relsXml         = relsEntry.getData().toString('utf8');

  const slideList = parseSlideList(presentationXml);
  const relsMap   = parseRels(relsXml);

  // Debug: log all ZIP entries that look like slides
  const allSlideEntries = zip.getEntries()
    .filter(e => /ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .map(e => e.entryName);
  console.log(`[PPT Template] ZIP slide entries found: [${allSlideEntries.join(', ')}]`);

  const analysis = {
    slides: [],
    byType: { TITLE: null, SECTION: null, CONTENT: null, CLOSING: null, BLANK: null },
  };

  slideList.forEach(({ id, rId }, index) => {
    const rawTarget = relsMap[rId];
    if (!rawTarget) {
      console.warn(`[PPT Template] No target for rId=${rId}`);
      return;
    }

    // Resolve path using the fixed resolver
    const resolvedPath = resolveSlideEntryName(rawTarget);

    // Try to find entry with multiple path variants
    const entry = findEntry(
      zip,
      resolvedPath,
      rawTarget,
      rawTarget.replace(/^\.\.\//, 'ppt/'),
      `ppt/${rawTarget}`,
    );

    if (!entry) {
      console.warn(`[PPT Template] Slide ${index+1}: entry not found for target="${rawTarget}" resolved="${resolvedPath}"`);
      console.warn(`[PPT Template]   Tried: ${[resolvedPath, rawTarget, rawTarget.replace(/^\.\.\//, 'ppt/'), `ppt/${rawTarget}`].join(', ')}`);
      return;
    }

    const actualPath = entry.entryName;
    const slideXml   = entry.getData().toString('utf8');
    const txCount    = (slideXml.match(/<a:txBody>/g) || []).length;
    const text       = extractTextFromSlideXml(slideXml);

    const info = {
      index,
      path: actualPath,  // Use the ACTUAL entry name from ZIP
      rId,
      id: parseInt(id),
      txCount,
      textPreview: text.substring(0, 80),
    };

    analysis.slides.push(info);

    // Classify slides
    if (index === 0) {
      analysis.byType.TITLE = info;
    } else if (index === slideList.length - 1) {
      analysis.byType.CLOSING = info;
    }

    if (txCount >= 2 && !analysis.byType.CONTENT) {
      analysis.byType.CONTENT = info;
    }

    if (txCount <= 2 && !analysis.byType.SECTION && index > 0 && /^\d+/.test(text)) {
      analysis.byType.SECTION = info;
    }

    if (txCount === 0 && !analysis.byType.BLANK) {
      analysis.byType.BLANK = info;
    }
  });

  // Fallbacks
  if (!analysis.byType.SECTION && analysis.byType.CONTENT) {
    analysis.byType.SECTION = analysis.byType.CONTENT;
  }
  if (!analysis.byType.CONTENT && analysis.slides.length > 1) {
    analysis.byType.CONTENT = analysis.slides[1] || analysis.slides[0];
  }
  if (!analysis.byType.CONTENT && analysis.slides.length > 0) {
    analysis.byType.CONTENT = analysis.slides[0];
  }

  console.log(`[PPT Template] Analyzed ${analysis.slides.length} template slides:`);
  Object.entries(analysis.byType).forEach(([type, info]) => {
    if (info) console.log(`  ${type} → slide ${info.index + 1} path="${info.path}" (${info.txCount} txBody)`);
  });

  return analysis;
}

function pickTemplateSlidePath(analysis, layout) {
  const L = layout.toUpperCase();
  switch (L) {
    case 'TITLE':
      return (analysis.byType.TITLE || analysis.slides[0])?.path;
    case 'SECTION':
      return (analysis.byType.SECTION || analysis.byType.CONTENT || analysis.slides[1])?.path;
    case 'CLOSING':
      return (analysis.byType.CLOSING || analysis.byType.TITLE || analysis.slides[analysis.slides.length - 1])?.path;
    default:
      return (analysis.byType.CONTENT || analysis.slides[1] || analysis.slides[0])?.path;
  }
}

// ─────────────────────────────────────────────────────────────
// FIND PPTX TEMPLATE
// ─────────────────────────────────────────────────────────────

function findPptxTemplate(bot) {
  if (!bot?.knowledgeFiles?.length) return null;

  const priorityWords = ['template', 'gys', 'master', 'tema', 'theme'];

  const pptxFiles = bot.knowledgeFiles.filter(f => {
    const isValidExt  = /\.(pptx?)$/i.test(f.originalName);
    const hasPath     = f.path || f.serverPath;
    const pathToCheck = f.path || f.serverPath || '';
    const exists      = pathToCheck ? fs.existsSync(pathToCheck) : false;
    return isValidExt && hasPath && exists;
  });

  if (pptxFiles.length === 0) return null;

  const sorted = pptxFiles.sort((a, b) => {
    const aScore = priorityWords.filter(w => a.originalName.toLowerCase().includes(w)).length;
    const bScore = priorityWords.filter(w => b.originalName.toLowerCase().includes(w)).length;
    return bScore - aScore;
  });

  const chosen   = sorted[0];
  const filePath = chosen.path || chosen.serverPath;
  console.log(`[PPT Template] Using template: "${chosen.originalName}" from knowledge base`);
  return { filePath, fileName: chosen.originalName };
}

// ─────────────────────────────────────────────────────────────
// DUPLICATE SLIDE — uses actual ZIP entry path
// ─────────────────────────────────────────────────────────────

function duplicateAndInjectSlide(zip, templateSlidePath, slideData, newSlideIndex) {
  // Try to find the entry
  const templateEntry = findEntry(zip, templateSlidePath);
  if (!templateEntry) {
    throw new Error(`Template slide not found: "${templateSlidePath}". Available: [${
      zip.getEntries().filter(e => /slides\/slide\d+\.xml$/.test(e.entryName)).map(e => e.entryName).join(', ')
    }]`);
  }

  const originalXml = templateEntry.getData().toString('utf8');
  const injectedXml = injectContentIntoSlideXml(originalXml, slideData);

  const newSlideName    = `slide${newSlideIndex}.xml`;
  const newSlidePath    = `ppt/slides/${newSlideName}`;
  const newSlideRelPath = `ppt/slides/_rels/${newSlideName}.rels`;

  // Try to find the rels file for the template slide
  const templateRelPath = resolveRelEntryName(templateEntry.entryName);
  const templateRelEntry = findEntry(zip, templateRelPath);
  const relXml = templateRelEntry
    ? templateRelEntry.getData().toString('utf8')
    : buildDefaultSlideRels();

  return { newSlidePath, newSlideRelPath, slideXml: injectedXml, relXml, newSlideName };
}

function buildDefaultSlideRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;
}

// ─────────────────────────────────────────────────────────────
// UPDATE presentation.xml & CONTENT_TYPES
// ─────────────────────────────────────────────────────────────

function updatePresentationXml(presentationXml, relsXml, newSlides) {
  const existingIds = [...presentationXml.matchAll(/id="(\d+)"/g)].map(m => parseInt(m[1]));
  let maxId = Math.max(256, ...existingIds);

  let newSldIdEntries = '';
  const newRels       = [];

  newSlides.forEach((slide, i) => {
    maxId++;
    const rId        = `rId_new_${i + 1}`;
    slide.assignedRId = rId;
    newSldIdEntries  += `<p:sldId id="${maxId}" r:id="${rId}"/>`;
    newRels.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/${slide.newSlideName}"/>`);
  });

  let updatedPresXml = presentationXml.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${newSldIdEntries}</p:sldIdLst>`
  );

  // Remove old slide rels, add new ones
  let updatedRels = relsXml.replace(
    /<Relationship[^>]+officeDocument[^>]+slide"[^/>]*\/?>/g,
    ''
  );
  updatedRels = updatedRels.replace('</Relationships>', newRels.join('\n') + '\n</Relationships>');

  return { presentationXml: updatedPresXml, relsXml: updatedRels };
}

function updateContentTypes(contentTypesXml, newSlideNames) {
  const slideOverrides = newSlideNames.map(name =>
    `<Override PartName="/ppt/slides/${name}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  ).join('\n');

  let updated = contentTypesXml.replace(
    /<Override[^>]+presentationml\.slide\+xml[^>]+\/>/g,
    ''
  );
  updated = updated.replace('</Types>', slideOverrides + '\n</Types>');
  return updated;
}

// ─────────────────────────────────────────────────────────────
// MAIN SERVICE
// ─────────────────────────────────────────────────────────────

const PptxTemplateService = {
  async generate({ bot, pptData, title, outputDir }) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const templateInfo = findPptxTemplate(bot);
    if (!templateInfo) {
      console.log('[PPT Template] No PPTX template found in knowledge base');
      return null;
    }

    let zip;
    try {
      zip = new AdmZip(templateInfo.filePath);
    } catch (err) {
      console.error('[PPT Template] Failed to open template ZIP:', err.message);
      return null;
    }

    // Log all entries for debugging
    const allEntries = zip.getEntries().map(e => e.entryName);
    console.log(`[PPT Template] ZIP has ${allEntries.length} total entries`);

    const analysis = analyzeTemplateSlides(zip);
    if (analysis.slides.length === 0) {
      console.error('[PPT Template] No slides found in template — check ZIP structure');
      return null;
    }

    // Clone template to new zip
    const newZip = new AdmZip(templateInfo.filePath);

    // Remove old slides
    const entriesToRemove = newZip.getEntries()
      .filter(e =>
        /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName) ||
        /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(e.entryName)
      )
      .map(e => e.entryName);

    console.log(`[PPT Template] Removing ${entriesToRemove.length} old slide entries`);
    entriesToRemove.forEach(name => {
      try { newZip.deleteFile(name); } catch (e) {
        console.warn(`[PPT Template] Could not delete ${name}:`, e.message);
      }
    });

    // Add new slides
    const slides          = pptData.slides || [];
    const newSlideEntries = [];

    for (let i = 0; i < slides.length; i++) {
      const slideData         = slides[i];
      const slideIndex        = i + 1;
      const templateSlidePath = pickTemplateSlidePath(analysis, slideData.layout || 'CONTENT');

      if (!templateSlidePath) {
        console.warn(`[PPT Template] No template path for layout: ${slideData.layout}`);
        continue;
      }

      try {
        const result = duplicateAndInjectSlide(newZip, templateSlidePath, slideData, slideIndex);
        newZip.addFile(result.newSlidePath,    Buffer.from(result.slideXml, 'utf8'));
        newZip.addFile(result.newSlideRelPath, Buffer.from(result.relXml,   'utf8'));
        newSlideEntries.push({ newSlidePath: result.newSlidePath, newSlideName: result.newSlideName, slideData });
        console.log(`[PPT Template] Slide ${slideIndex} (${slideData.layout}) → from "${templateSlidePath}"`);
      } catch (slideErr) {
        console.error(`[PPT Template] Failed to create slide ${slideIndex}:`, slideErr.message);
        // Add minimal fallback slide
        const fallbackXml = buildFallbackSlideXml(slideData);
        const fallbackRel = buildDefaultSlideRels();
        const newSlideName = `slide${slideIndex}.xml`;
        newZip.addFile(`ppt/slides/${newSlideName}`,           Buffer.from(fallbackXml, 'utf8'));
        newZip.addFile(`ppt/slides/_rels/${newSlideName}.rels`, Buffer.from(fallbackRel, 'utf8'));
        newSlideEntries.push({ newSlidePath: `ppt/slides/${newSlideName}`, newSlideName, slideData });
      }
    }

    if (newSlideEntries.length === 0) {
      console.error('[PPT Template] No slides were generated');
      return null;
    }

    // Update presentation.xml and rels
    const presentationXml = newZip.getEntry('ppt/presentation.xml')?.getData().toString('utf8') || '';
    const relsXml         = newZip.getEntry('ppt/_rels/presentation.xml.rels')?.getData().toString('utf8') || '';
    const contentTypesXml = newZip.getEntry('[Content_Types].xml')?.getData().toString('utf8') || '';

    const { presentationXml: updatedPresXml, relsXml: updatedRels } =
      updatePresentationXml(presentationXml, relsXml, newSlideEntries);

    const updatedContentTypes = updateContentTypes(
      contentTypesXml,
      newSlideEntries.map(e => e.newSlideName)
    );

    newZip.updateFile('ppt/presentation.xml',            Buffer.from(updatedPresXml,      'utf8'));
    newZip.updateFile('ppt/_rels/presentation.xml.rels', Buffer.from(updatedRels,          'utf8'));
    newZip.updateFile('[Content_Types].xml',             Buffer.from(updatedContentTypes,  'utf8'));

    // Update title in core properties
    const coreXmlEntry = newZip.getEntry('docProps/core.xml');
    if (coreXmlEntry) {
      let coreXml = coreXmlEntry.getData().toString('utf8');
      coreXml = coreXml.replace(
        /<dc:title>.*?<\/dc:title>/,
        `<dc:title>${escapeXml(title || 'GYS Presentation')}</dc:title>`
      );
      if (!coreXml.includes('<dc:title>')) {
        coreXml = coreXml.replace(
          '</cp:coreProperties>',
          `<dc:title>${escapeXml(title || 'GYS Presentation')}</dc:title></cp:coreProperties>`
        );
      }
      newZip.updateFile('docProps/core.xml', Buffer.from(coreXml, 'utf8'));
    }

    // Write output
    const safeTitle = (title || 'Presentation')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 40);
    const filename = `GYS-${safeTitle}-${Date.now()}.pptx`;
    const filepath = path.join(outputDir, filename);

    newZip.writeZip(filepath);

    console.log(`✅ [PPT Template] Generated "${filename}" using template "${templateInfo.fileName}" (${newSlideEntries.length} slides)`);

    return {
      pptxFile:    filepath,
      pptxUrl:     `/api/files/${filename}`,
      pptxName:    filename,
      slideCount:  newSlideEntries.length,
      usedTemplate: templateInfo.fileName,
      usedFallback: false,
    };
  },

  hasTemplate(bot) {
    return findPptxTemplate(bot) !== null;
  },
};

/** Minimal fallback slide XML when template slide can't be used */
function buildFallbackSlideXml(slideData) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/><a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="5143500"/></a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="id-ID" dirty="0"/><a:t>${escapeXml(slideData.title || '')}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Content"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="id-ID" dirty="0"/><a:t>${escapeXml((slideData.bullets || []).join(' • ') || slideData.body || '')}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClr/></p:clrMapOvr>
</p:sld>`;
}

export default PptxTemplateService;
