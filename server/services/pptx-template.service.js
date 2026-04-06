// server/services/pptx-template.service.js
// ============================================================
// GYS Portal AI — Template-Based PPTX Service
// 
// Pendekatan: 
//   1. Ambil file .pptx dari knowledge base bot (template asli dengan logo, background, dll)
//   2. Extract template menggunakan AdmZip
//   3. Duplikasi slide layout yang sesuai dari template
//   4. Inject konten AI ke dalam XML slide
//   5. Pack kembali menjadi file .pptx
//
// Hasil: File PPTX yang benar-benar menggunakan template GYS asli
//        — bukan hanya meniru warnanya saja
// ============================================================

import AdmZip  from 'adm-zip';
import path    from 'path';
import fs      from 'fs';
import { v4 as uuidv4 } from 'uuid';

// ─────────────────────────────────────────────────────────────
// XML HELPERS
// ─────────────────────────────────────────────────────────────

/** Escape karakter XML agar tidak merusak struktur */
function escapeXml(str = '') {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

/** Parse <p:sldIdLst> dari presentation.xml, return array of {id, r:id} */
function parseSlideList(presentationXml) {
  const matches = [...presentationXml.matchAll(/<p:sldId\s+id="(\d+)"\s+r:id="([^"]+)"/g)];
  return matches.map(m => ({ id: m[1], rId: m[2] }));
}

/** Parse _rels/presentation.xml.rels untuk mapping rId → slide file */
function parseRels(relsXml) {
  const map = {};
  const matches = [...relsXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)];
  matches.forEach(m => { map[m[1]] = m[2]; });
  return map;
}

/** Ambil teks dari semua <a:t> dalam XML slide */
function extractTextFromSlideXml(slideXml) {
  const texts = [];
  const matches = [...slideXml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)];
  matches.forEach(m => { if (m[1].trim()) texts.push(m[1].trim()); });
  return texts.join(' ');
}

/** Buat satu paragraph XML untuk konten slide */
function makeParagraph(text, opts = {}) {
  const {
    bold       = false,
    fontSize   = 1800,  // dalam 100ths of a point, misal 1800 = 18pt
    color      = null,  // hex tanpa #, misal 'FFFFFF'
    align      = 'l',
    lineSpacing = 1800, // dalam 100ths of a point
  } = opts;

  const boldAttr  = bold  ? ' b="1"' : '';
  const colorEl   = color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : '';

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

/** Buat bullet paragraph */
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

// ─────────────────────────────────────────────────────────────
// SLIDE CONTENT BUILDER
// ─────────────────────────────────────────────────────────────

/**
 * Ambil XML slide dari template dan ganti konten placeholder-nya
 * dengan konten dari AI.
 *
 * Cara kerja:
 * - Kita cari text box yang ada di slide template
 * - Ganti isi <a:txBody> dengan konten baru
 * - Pertahankan semua shape lain (background, gambar, logo, dll)
 */
function injectContentIntoSlideXml(templateSlideXml, slideData) {
  let xml = templateSlideXml;

  const layout = (slideData.layout || 'CONTENT').toUpperCase();

  // Strategi: replace semua <a:txBody> satu per satu berdasarkan urutan kemunculan
  // text box pertama = judul, text box kedua = konten
  const txBodyRegex = /<a:txBody>([\s\S]*?)<\/a:txBody>/g;
  const txBodies    = [...xml.matchAll(txBodyRegex)];

  if (txBodies.length === 0) return xml; // slide tanpa text box, return as-is

  // Build replacement content based on layout
  let titleContent   = '';
  let bodyContent    = '';

  switch (layout) {
    case 'TITLE': {
      titleContent = buildTxBody([
        makeParagraph(slideData.title || '', { bold: true, fontSize: 4000, align: 'c' }),
        slideData.subtitle ? makeParagraph(slideData.subtitle, { fontSize: 2200, align: 'c' }) : '',
        slideData.presenter ? makeParagraph(slideData.presenter, { fontSize: 1600, align: 'c' }) : '',
        slideData.date ? makeParagraph(slideData.date, { fontSize: 1400, align: 'c' }) : '',
      ].filter(Boolean));
      break;
    }

    case 'SECTION': {
      titleContent = buildTxBody([
        makeParagraph(slideData.sectionNumber ? `${slideData.sectionNumber}` : '', { fontSize: 5000, bold: true }),
        makeParagraph(slideData.title || '', { bold: true, fontSize: 3200 }),
        slideData.subtitle ? makeParagraph(slideData.subtitle, { fontSize: 1800 }) : '',
      ].filter(Boolean));
      break;
    }

    case 'STATS': {
      const stats = (slideData.stats || []).slice(0, 4);
      titleContent = buildTxBody([makeParagraph(slideData.title || '', { bold: true, fontSize: 2400 })]);
      bodyContent  = buildTxBody(stats.map(s =>
        makeParagraph(`${s.icon || ''} ${s.value || ''} — ${s.label || ''}${s.sub ? ` (${s.sub})` : ''}`,
          { fontSize: 1600 })
      ));
      break;
    }

    case 'TIMELINE': {
      const steps = (slideData.steps || []);
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
        makeParagraph(`"${slideData.quote || slideData.title || ''}"`, { fontSize: 2400, bold: false }),
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

  // Inject: replace txBody pertama dengan title, kedua dengan body
  let replaceCount = 0;
  xml = xml.replace(txBodyRegex, (match) => {
    replaceCount++;
    if (replaceCount === 1 && titleContent) return titleContent;
    if (replaceCount === 2 && bodyContent)  return bodyContent;
    return match; // biarkan text box lain (logo, footer, dll) tidak berubah
  });

  return xml;
}

function buildTxBody(paragraphs) {
  return `<a:txBody>
  <a:bodyPr/>
  <a:lstStyle/>
  ${paragraphs.join('\n  ')}
</a:txBody>`;
}

// ─────────────────────────────────────────────────────────────
// DETERMINE BEST TEMPLATE SLIDE FOR EACH LAYOUT
// ─────────────────────────────────────────────────────────────

/**
 * Analisis slide-slide di template untuk menentukan:
 *  - Slide mana yang cocok untuk title (slide pertama)
 *  - Slide mana yang cocok untuk content (slide dengan 2 txBody)
 *  - Slide mana yang cocok untuk section divider
 *  - Slide mana yang cocok untuk closing (slide terakhir)
 */
function analyzeTemplateSlides(zip) {
  const presentationXml = zip.getEntry('ppt/presentation.xml')?.getData().toString('utf8') || '';
  const relsXml         = zip.getEntry('ppt/_rels/presentation.xml.rels')?.getData().toString('utf8') || '';

  const slideList = parseSlideList(presentationXml);
  const relsMap   = parseRels(relsXml);

  const analysis = {
    slides:  [],
    byType:  {
      TITLE:   null,
      SECTION: null,
      CONTENT: null,
      CLOSING: null,
      BLANK:   null,
    },
  };

  slideList.forEach(({ id, rId }, index) => {
    const slideFile = relsMap[rId];
    if (!slideFile) return;

    // Normalize path
    const slidePath = slideFile.startsWith('slides/') ? `ppt/${slideFile}` : slideFile;
    const entry     = zip.getEntry(slidePath);
    if (!entry) return;

    const slideXml = entry.getData().toString('utf8');
    const text     = extractTextFromSlideXml(slideXml);
    const txCount  = (slideXml.match(/<a:txBody>/g) || []).length;

    const info = {
      index,
      path:    slidePath,
      rId,
      id:      parseInt(id),
      txCount,
      textPreview: text.substring(0, 80),
    };

    analysis.slides.push(info);

    // Heuristic: klasifikasikan slide
    // Slide dengan sedikit text box dan di awal/akhir = title/closing
    // Slide dengan 2+ text box = content
    if (index === 0) {
      analysis.byType.TITLE = info;
    } else if (index === slideList.length - 1) {
      analysis.byType.CLOSING = info;
    } else if (txCount >= 2 && !analysis.byType.SECTION) {
      // Cari section divider — biasanya punya 1-2 tx dan ada angka besar
      if (txCount <= 2 && /^\d+/.test(text)) {
        analysis.byType.SECTION = info;
      }
    }

    // Slide content terbaik: punya >= 2 txBody
    if (txCount >= 2 && !analysis.byType.CONTENT) {
      analysis.byType.CONTENT = info;
    }

    // Slide blank (fallback)
    if (txCount === 0 && !analysis.byType.BLANK) {
      analysis.byType.BLANK = info;
    }
  });

  // Fallback
  if (!analysis.byType.SECTION && analysis.byType.CONTENT) {
    analysis.byType.SECTION = analysis.byType.CONTENT;
  }
  if (!analysis.byType.CONTENT && analysis.slides.length > 1) {
    analysis.byType.CONTENT = analysis.slides[1] || analysis.slides[0];
  }

  console.log(`[PPT Template] Analyzed ${analysis.slides.length} template slides:`);
  Object.entries(analysis.byType).forEach(([type, info]) => {
    if (info) console.log(`  ${type} → slide ${info.index + 1} (${info.txCount} txBody)`);
  });

  return analysis;
}

/** Pilih slide template yang paling cocok untuk layout tertentu */
function pickTemplateSlidePath(analysis, layout) {
  const L = layout.toUpperCase();

  switch (L) {
    case 'TITLE':
      return (analysis.byType.TITLE || analysis.slides[0])?.path;
    case 'SECTION':
      return (analysis.byType.SECTION || analysis.byType.CONTENT || analysis.slides[1])?.path;
    case 'CLOSING':
      return (analysis.byType.CLOSING || analysis.byType.TITLE || analysis.slides[0])?.path;
    case 'BLANK':
      return (analysis.byType.BLANK || analysis.byType.CONTENT || analysis.slides[1])?.path;
    default:
      // CONTENT, GRID, STATS, TIMELINE, TWO_COLUMN, CHART, TABLE, QUOTE
      return (analysis.byType.CONTENT || analysis.slides[1] || analysis.slides[0])?.path;
  }
}

// ─────────────────────────────────────────────────────────────
// FIND PPTX TEMPLATE IN KNOWLEDGE BASE
// ─────────────────────────────────────────────────────────────

/**
 * Cari file .pptx di knowledge base bot.
 * Returns { filePath, fileName } atau null jika tidak ada.
 */
function findPptxTemplate(bot) {
  if (!bot?.knowledgeFiles?.length) return null;

  // Prioritaskan file yang namanya mengandung 'template', 'gys', 'master', 'tema'
  const priorityWords = ['template', 'gys', 'master', 'tema', 'theme'];

  const pptxFiles = bot.knowledgeFiles.filter(f =>
    /\.(pptx?)$/i.test(f.originalName) && f.path && fs.existsSync(f.path)
  );

  if (pptxFiles.length === 0) return null;

  // Cari yang namanya paling cocok
  const sorted = pptxFiles.sort((a, b) => {
    const aScore = priorityWords.filter(w => a.originalName.toLowerCase().includes(w)).length;
    const bScore = priorityWords.filter(w => b.originalName.toLowerCase().includes(w)).length;
    return bScore - aScore;
  });

  const chosen = sorted[0];
  console.log(`[PPT Template] Using template: "${chosen.originalName}" from knowledge base`);
  return { filePath: chosen.path, fileName: chosen.originalName };
}

// ─────────────────────────────────────────────────────────────
// DUPLICATE SLIDE IN ZIP
// ─────────────────────────────────────────────────────────────

/**
 * Duplikasi slide XML dari template dan inject konten baru.
 * Mengembalikan { newSlidePath, newSlideRelPath, newRId, xmlContent }
 */
function duplicateAndInjectSlide(zip, templateSlidePath, slideData, newSlideIndex) {
  const templateEntry = zip.getEntry(templateSlidePath);
  if (!templateEntry) throw new Error(`Template slide not found: ${templateSlidePath}`);

  const originalXml = templateEntry.getData().toString('utf8');
  const injectedXml = injectContentIntoSlideXml(originalXml, slideData);

  const newSlideName    = `slide${newSlideIndex}.xml`;
  const newSlidePath    = `ppt/slides/${newSlideName}`;
  const newSlideRelPath = `ppt/slides/_rels/${newSlideName}.rels`;

  // Copy relationship file dari template slide
  const templateRelPath = templateSlidePath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
  const templateRelEntry = zip.getEntry(templateRelPath);
  const relXml = templateRelEntry
    ? templateRelEntry.getData().toString('utf8')
    : buildDefaultSlideRels();

  return { newSlidePath, newSlideRelPath, newRId: null, slideXml: injectedXml, relXml };
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
  // Cari max slide ID yang sudah ada
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

  // Hapus semua slide lama dari sldIdLst, ganti dengan slide baru saja
  let updatedPresXml = presentationXml.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${newSldIdEntries}</p:sldIdLst>`
  );

  // Update rels: hapus rels slide lama, tambahkan yang baru
  let updatedRels = relsXml.replace(
    /<Relationship[^>]+officeDocument[^>]+slide"[^>]+\/>/g,
    ''
  );
  updatedRels = updatedRels.replace('</Relationships>', newRels.join('\n') + '\n</Relationships>');

  return { presentationXml: updatedPresXml, relsXml: updatedRels };
}

function updateContentTypes(contentTypesXml, newSlideNames) {
  const slideOverrides = newSlideNames.map(name =>
    `<Override PartName="/ppt/slides/${name}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  ).join('\n');

  // Hapus semua override slide lama
  let updated = contentTypesXml.replace(
    /<Override[^>]+presentationml\.slide\+xml[^>]+\/>/g,
    ''
  );
  updated = updated.replace('</Types>', slideOverrides + '\n</Types>');

  return updated;
}

// ─────────────────────────────────────────────────────────────
// MAIN GENERATE FUNCTION
// ─────────────────────────────────────────────────────────────

const PptxTemplateService = {
  /**
   * Generate PPTX menggunakan template dari knowledge base.
   *
   * @param {object}   opts
   * @param {object}   opts.bot          - Bot document dengan knowledgeFiles
   * @param {object}   opts.pptData      - { slides: [...] } dari AI
   * @param {string}   opts.title        - Judul presentasi
   * @param {string}   opts.outputDir    - Folder output
   * @returns {object} { pptxFile, pptxUrl, pptxName, slideCount, usedTemplate }
   */
  async generate({ bot, pptData, title, outputDir }) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // ── 1. Cari template PPTX dari knowledge base ─────────────
    const templateInfo = findPptxTemplate(bot);

    if (!templateInfo) {
      console.log('[PPT Template] No PPTX template found in knowledge base, falling back to pptxgenjs');
      return null; // Signal ke caller untuk fallback ke PptxService biasa
    }

    // ── 2. Load template sebagai zip ──────────────────────────
    let zip;
    try {
      zip = new AdmZip(templateInfo.filePath);
    } catch (err) {
      console.error('[PPT Template] Failed to open template ZIP:', err.message);
      return null;
    }

    // ── 3. Analisis slide template ────────────────────────────
    const analysis = analyzeTemplateSlides(zip);
    if (analysis.slides.length === 0) {
      console.error('[PPT Template] No slides found in template');
      return null;
    }

    // ── 4. Buat zip baru berdasarkan template ─────────────────
    // Kita clone template zip dan replace slide-slide nya
    const newZip = new AdmZip(templateInfo.filePath);

    // Hapus semua slide lama dari zip baru
    const entriesToRemove = newZip.getEntries()
      .filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/) ||
                   e.entryName.match(/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/))
      .map(e => e.entryName);

    entriesToRemove.forEach(name => {
      try { newZip.deleteFile(name); } catch {}
    });

    // ── 5. Tambahkan slide-slide baru ─────────────────────────
    const slides          = pptData.slides || [];
    const newSlideEntries = [];

    slides.forEach((slideData, i) => {
      const slideIndex        = i + 1;
      const templateSlidePath = pickTemplateSlidePath(analysis, slideData.layout || 'CONTENT');

      if (!templateSlidePath) {
        console.warn(`[PPT Template] No template slide found for layout: ${slideData.layout}`);
        return;
      }

      const { newSlidePath, newSlideRelPath, slideXml, relXml } =
        duplicateAndInjectSlide(newZip, templateSlidePath, slideData, slideIndex);

      const newSlideName = `slide${slideIndex}.xml`;

      // Tambahkan ke zip
      newZip.addFile(newSlidePath,    Buffer.from(slideXml, 'utf8'));
      newZip.addFile(newSlideRelPath, Buffer.from(relXml,   'utf8'));

      newSlideEntries.push({ newSlidePath, newSlideName, slideData });
    });

    if (newSlideEntries.length === 0) {
      console.error('[PPT Template] No slides were generated');
      return null;
    }

    // ── 6. Update presentation.xml dan _rels ──────────────────
    const presentationXml = newZip.getEntry('ppt/presentation.xml')?.getData().toString('utf8') || '';
    const relsXml         = newZip.getEntry('ppt/_rels/presentation.xml.rels')?.getData().toString('utf8') || '';
    const contentTypesXml = newZip.getEntry('[Content_Types].xml')?.getData().toString('utf8') || '';

    const { presentationXml: updatedPresXml, relsXml: updatedRels } =
      updatePresentationXml(presentationXml, relsXml, newSlideEntries);

    const updatedContentTypes = updateContentTypes(
      contentTypesXml,
      newSlideEntries.map(e => e.newSlideName)
    );

    newZip.updateFile('ppt/presentation.xml',       Buffer.from(updatedPresXml,      'utf8'));
    newZip.updateFile('ppt/_rels/presentation.xml.rels', Buffer.from(updatedRels,    'utf8'));
    newZip.updateFile('[Content_Types].xml',         Buffer.from(updatedContentTypes, 'utf8'));

    // ── 7. Update judul presentasi di Core Properties ─────────
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

    // ── 8. Simpan file output ─────────────────────────────────
    const safeTitle = (title || 'Presentation')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 40);
    const filename = `GYS-${safeTitle}-${Date.now()}.pptx`;
    const filepath = path.join(outputDir, filename);

    newZip.writeZip(filepath);

    console.log(`✅ [PPT Template] Generated using template "${templateInfo.fileName}": ${filename} (${newSlideEntries.length} slides)`);

    return {
      pptxFile:    filepath,
      pptxUrl:     `/api/files/${filename}`,
      pptxName:    filename,
      slideCount:  newSlideEntries.length,
      usedTemplate: templateInfo.fileName,
      usedFallback: false,
    };
  },

  /**
   * Cek apakah bot punya template PPTX di knowledge base
   */
  hasTemplate(bot) {
    return findPptxTemplate(bot) !== null;
  },
};

export default PptxTemplateService;
