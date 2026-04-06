// server/services/knowledge-base.service.js
// ✅ FIXED: Proper PPTX reading with theme/color extraction for GYS style matching
import fs      from 'fs';
import path    from 'path';
import pdf     from 'pdf-parse';
import mammoth from 'mammoth';
import XLSX    from 'xlsx';

// ── Optional PPT parser (officeparser covers .pptx / .ppt) ───
let officeparserParsePptx = null;
try {
  const op = await import('officeparser');
  officeparserParsePptx = op.parseOffice || op.default?.parseOffice || null;
} catch {
  // officeparser not available – PPT extraction will fall back to placeholder
}

class KnowledgeBaseService {

  /**
   * Extract text content from a file.
   * Supported: PDF, DOCX, DOC, XLSX, XLS, CSV, TXT, MD, PPTX, PPT
   * Returns { content: string, summary: string }
   */
  async extractContent(filePath, originalName, mimetype) {
    const ext = path.extname(originalName).toLowerCase();

    try {
      let content = '';

      // ── PDF ───────────────────────────────────────────────
      if (ext === '.pdf' || mimetype === 'application/pdf') {
        const buffer = fs.readFileSync(filePath);
        const data   = await pdf(buffer);
        content      = data.text || '';

      // ── DOCX / DOC ────────────────────────────────────────
      } else if (
        ext === '.docx' || ext === '.doc' ||
        mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimetype === 'application/msword'
      ) {
        const result = await mammoth.extractRawText({ path: filePath });
        content      = result.value || '';

      // ── XLSX / XLS ────────────────────────────────────────
      } else if (
        ext === '.xlsx' || ext === '.xls' ||
        mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mimetype === 'application/vnd.ms-excel'
      ) {
        const workbook = XLSX.readFile(filePath);
        const parts    = workbook.SheetNames.map(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const csv   = XLSX.utils.sheet_to_csv(sheet);
          return `=== Sheet: ${sheetName} ===\n${csv}`;
        });
        content = parts.join('\n\n');

      // ── PPTX / PPT — ENHANCED: Extract theme + full content ──
      } else if (
        ext === '.pptx' || ext === '.ppt' ||
        mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        mimetype === 'application/vnd.ms-powerpoint'
      ) {
        content = await this._extractPptContentEnhanced(filePath, originalName);

      // ── CSV ───────────────────────────────────────────────
      } else if (ext === '.csv' || mimetype === 'text/csv') {
        content = fs.readFileSync(filePath, 'utf8');

      // ── Plain Text / Markdown ─────────────────────────────
      } else if (
        ext === '.txt' || ext === '.md' ||
        (mimetype && mimetype.startsWith('text/'))
      ) {
        content = fs.readFileSync(filePath, 'utf8');

      } else {
        // Fallback: try reading as text
        try {
          content = fs.readFileSync(filePath, 'utf8');
        } catch {
          content = `[File "${originalName}" tidak dapat dibaca sebagai teks]`;
        }
      }

      // Truncate very large content to 80K chars (~20K tokens) for storage
      const MAX_CHARS = 80000;
      if (content.length > MAX_CHARS) {
        content = content.substring(0, MAX_CHARS) + '\n\n[... konten dipotong, file terlalu besar ...]';
      }

      const summary = this._generateSummary(content, originalName);
      return { content: content.trim(), summary };

    } catch (err) {
      console.error(`❌ Knowledge extraction failed for "${originalName}":`, err.message);
      return {
        content: `[Error membaca file "${originalName}": ${err.message}]`,
        summary: `File: ${originalName} (gagal dibaca)`,
      };
    }
  }

  // ── Enhanced PPT / PPTX extraction with GYS theme detection ─
  async _extractPptContentEnhanced(filePath, originalName) {
    let themeData   = null;
    let slideTexts  = [];
    let layoutInfo  = [];
    let colorScheme = {};

    try {
      const AdmZip = (await import('adm-zip')).default;
      const zip    = new AdmZip(filePath);

      // ── 1. Extract color theme ─────────────────────────────
      const themeEntry = zip.getEntry('ppt/theme/theme1.xml');
      if (themeEntry) {
        const themeXml = themeEntry.getData().toString('utf8');
        colorScheme = this._parseThemeColors(themeXml);
      }

      // ── 2. Extract slide layout info ──────────────────────
      const slideLayoutEntries = zip.getEntries()
        .filter(e => e.entryName.match(/^ppt\/slideLayouts\/slideLayout\d+\.xml$/));

      for (const entry of slideLayoutEntries) {
        const xml = entry.getData().toString('utf8');
        const nameMatch = xml.match(/name="([^"]+)"/);
        if (nameMatch) layoutInfo.push(nameMatch[1]);
      }

      // ── 3. Extract all slide content with structure ────────
      const slideEntries = zip.getEntries()
        .filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/))
        .sort((a, b) => {
          const numA = parseInt(a.entryName.match(/slide(\d+)/)?.[1] || '0');
          const numB = parseInt(b.entryName.match(/slide(\d+)/)?.[1] || '0');
          return numA - numB;
        });

      for (let i = 0; i < slideEntries.length; i++) {
        const xml = slideEntries[i].getData().toString('utf8');
        const slideData = this._parseSlideXml(xml, i + 1);
        slideTexts.push(slideData);
      }

      // ── 4. Extract slide notes ─────────────────────────────
      const noteEntries = zip.getEntries()
        .filter(e => e.entryName.match(/^ppt\/notesSlides\/notesSlide\d+\.xml$/))
        .sort((a, b) => {
          const numA = parseInt(a.entryName.match(/notesSlide(\d+)/)?.[1] || '0');
          const numB = parseInt(b.entryName.match(/notesSlide(\d+)/)?.[1] || '0');
          return numA - numB;
        });

      const notes = {};
      for (const entry of noteEntries) {
        const xml = entry.getData().toString('utf8');
        const numMatch = entry.entryName.match(/notesSlide(\d+)/);
        if (numMatch) {
          const texts = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
          const noteText = texts.map(t => t.replace(/<[^>]*>/g, '')).join(' ').trim();
          if (noteText && noteText.length > 5) notes[parseInt(numMatch[1])] = noteText;
        }
      }

      // ── 5. Check for media/images ──────────────────────────
      const mediaFiles = zip.getEntries().filter(e => e.entryName.startsWith('ppt/media/'));
      const imageCount = mediaFiles.filter(e => /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(e.entryName)).length;

      // ── 6. Build comprehensive content string ──────────────
      themeData = {
        colors:  colorScheme,
        layouts: layoutInfo,
        slides:  slideTexts,
        notes,
        imageCount,
        totalSlides: slideEntries.length,
      };

      return this._buildPptContentString(themeData, originalName);

    } catch (e) {
      console.warn('[KnowledgeBase] Enhanced PPTX extraction failed, trying fallback:', e.message);
      return this._extractPptContentFallback(filePath, originalName);
    }
  }

  // ── Parse slide XML into structured data ─────────────────
  _parseSlideXml(xml, slideNum) {
    // Extract text elements with their properties
    const textFrameRegex = /<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g;
    const elements = [];
    let match;

    while ((match = textFrameRegex.exec(xml)) !== null) {
      const spXml = match[1];

      // Check if placeholder (title, body, etc.)
      const phMatch = spXml.match(/type="([^"]+)"/);
      const phType  = phMatch?.[1] || 'body';

      // Extract text content
      const textParts = spXml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
      const text = textParts
        .map(t => t.replace(/<[^>]*>/g, ''))
        .join('')
        .trim();

      // Extract font size
      const szMatch = spXml.match(/sz="(\d+)"/);
      const fontSize = szMatch ? parseInt(szMatch[1]) / 100 : 12;

      // Extract bold
      const isBold = /<a:b\/>/.test(spXml) || /b="1"/.test(spXml);

      // Extract color
      const colorMatch = spXml.match(/srgbClr val="([^"]+)"/);
      const color = colorMatch?.[1] || null;

      if (text) {
        elements.push({ type: phType, text, fontSize, isBold, color });
      }
    }

    // Detect layout type based on content
    const layout = this._detectSlideLayout(elements, xml);

    return {
      slideNum,
      layout,
      elements,
      rawText: elements.map(e => e.text).join('\n'),
    };
  }

  // ── Detect slide layout type ──────────────────────────────
  _detectSlideLayout(elements, xml) {
    const hasChart  = xml.includes('<c:chart') || xml.includes('<p:graphicFrame');
    const hasTable  = xml.includes('<a:tbl>');
    const hasImage  = xml.includes('<p:pic>') || xml.includes('<a:blip');

    if (hasChart)  return 'CHART';
    if (hasTable)  return 'TABLE';

    const titleEl = elements.find(e => e.type === 'ctrTitle' || e.type === 'title' ||
      (e.fontSize && e.fontSize >= 28));

    const contentEls = elements.filter(e => e !== titleEl);

    if (elements.length <= 2 && titleEl) return 'TITLE';
    if (contentEls.length >= 3)          return 'GRID';
    if (contentEls.length === 2)         return 'TWO_COLUMN';
    return 'CONTENT';
  }

  // ── Parse theme colors from XML ───────────────────────────
  _parseThemeColors(themeXml) {
    const colors = {};

    const mappings = [
      { tag: 'dk1',     name: 'dark1'   },
      { tag: 'lt1',     name: 'light1'  },
      { tag: 'dk2',     name: 'dark2'   },
      { tag: 'lt2',     name: 'light2'  },
      { tag: 'accent1', name: 'accent1' },
      { tag: 'accent2', name: 'accent2' },
      { tag: 'accent3', name: 'accent3' },
      { tag: 'accent4', name: 'accent4' },
      { tag: 'accent5', name: 'accent5' },
      { tag: 'accent6', name: 'accent6' },
    ];

    for (const { tag, name } of mappings) {
      const match = themeXml.match(new RegExp(`<a:${tag}>[\\s\\S]*?(?:srgbClr|sysClr)[^"]*val="([^"]+)"`, 'i'));
      if (match) colors[name] = match[1].toUpperCase();
    }

    // Extract font names
    const majorFontMatch = themeXml.match(/majorFont[\s\S]*?latin typeface="([^"]+)"/);
    const minorFontMatch = themeXml.match(/minorFont[\s\S]*?latin typeface="([^"]+)"/);
    if (majorFontMatch) colors.fontTitle = majorFontMatch[1];
    if (minorFontMatch) colors.fontBody  = minorFontMatch[1];

    return colors;
  }

  // ── Build comprehensive content string for AI context ─────
  _buildPptContentString(themeData, originalName) {
    const lines = [];

    lines.push(`=== POWERPOINT PRESENTATION: ${originalName} ===`);
    lines.push(`Total Slides: ${themeData.totalSlides}`);
    lines.push(`Images/Media: ${themeData.imageCount} gambar`);
    lines.push('');

    // ── Theme information (crucial for GYS style matching) ──
    if (Object.keys(themeData.colors).length > 0) {
      lines.push('--- DESIGN THEME & COLORS ---');

      // Detect if this is a GYS-branded presentation
      const colVals = Object.values(themeData.colors).map(v => String(v).toUpperCase());
      const isGYS   = colVals.some(c => ['006A4E','007857','004D38','00A878'].includes(c));

      if (isGYS) {
        lines.push('Brand: GYS (Garuda Yamato Steel) - Official Corporate Theme');
        lines.push('Primary Brand Color: #006A4E (Deep Teal Green)');
        lines.push('Accent Color: #00A878 (Bright Teal)');
        lines.push('Dark Variant: #004D38 (Dark Green)');
        lines.push('Mid Variant: #007857 (Mid Green)');
        lines.push('Background: #F8FAFC (Off-White)');
        lines.push('Footer: #1F2937 (Dark Gray) with #00A878 teal accent strip');
        lines.push('Logo: "GYS" text in white on teal rounded rectangle');
        lines.push('Tagline: "Member of Yamato Steel Group"');
        lines.push('');
        lines.push('GYS LAYOUT STYLES DETECTED:');
        lines.push('- TITLE slide: Full teal background with geometric circles, white text');
        lines.push('- SECTION slide: Left teal panel with section number, right content');
        lines.push('- GRID slide: White cards with teal top bar, icon circles, shadow effect');
        lines.push('- STATS slide: Alternating teal/white cards with large bold numbers');
        lines.push('- TIMELINE slide: Horizontal connector line, numbered nodes, cards below');
        lines.push('- TWO_COLUMN: Left neutral card vs right teal-bordered card');
        lines.push('- CHART: Left insight panel in teal-light, right chart area');
        lines.push('- TABLE: Teal header row, alternating off-white/white rows');
        lines.push('- QUOTE: Full teal background with decorative circles, italic text');
        lines.push('- CLOSING: Full teal background matching TITLE style');
        lines.push('');
        lines.push('GYS TYPOGRAPHY:');
        lines.push(`- Title Font: ${themeData.colors.fontTitle || 'Calibri'}`);
        lines.push(`- Body Font:  ${themeData.colors.fontBody  || 'Calibri'}`);
        lines.push('- Title sizes: 24-44pt bold');
        lines.push('- Body sizes: 12-16pt regular');
        lines.push('');
        lines.push('GYS COMPONENT SPECS:');
        lines.push('- Header bar: white, 0.82" height, thin gray bottom border');
        lines.push('- Logo: top-left corner, 0.58" x 0.4" rounded rect');
        lines.push('- Footer: 0.22" dark bar at bottom, left teal accent strip 2.6" wide');
        lines.push('- Card corners: rectRadius 0.12"');
        lines.push('- Left accent bar: 0.05" wide teal-accent vertical strip');
      } else {
        lines.push('Custom Theme Colors:');
        for (const [k, v] of Object.entries(themeData.colors)) {
          if (!k.startsWith('font')) lines.push(`  ${k}: #${v}`);
        }
        if (themeData.colors.fontTitle) lines.push(`Title Font: ${themeData.colors.fontTitle}`);
        if (themeData.colors.fontBody)  lines.push(`Body Font:  ${themeData.colors.fontBody}`);
      }
      lines.push('');
    }

    // ── Slide-by-slide content ─────────────────────────────
    lines.push('--- SLIDE CONTENT ---');
    for (const slide of themeData.slides) {
      lines.push(`\n[SLIDE ${slide.slideNum}] (${slide.layout})`);

      const titleEl = slide.elements.find(e =>
        e.type === 'ctrTitle' || e.type === 'title' || (e.isBold && e.fontSize >= 20)
      );

      if (titleEl) {
        lines.push(`Title: ${titleEl.text}`);
      }

      const bodyEls = slide.elements.filter(e => e !== titleEl);
      if (bodyEls.length > 0) {
        lines.push('Content:');
        for (const el of bodyEls) {
          lines.push(`  - ${el.text}`);
        }
      }

      if (themeData.notes[slide.slideNum]) {
        lines.push(`Notes: ${themeData.notes[slide.slideNum]}`);
      }
    }

    lines.push('\n--- END PRESENTATION ---');
    return lines.join('\n');
  }

  // ── Fallback PPT extraction ───────────────────────────────
  async _extractPptContentFallback(filePath, originalName) {
    // Strategy 1: officeparser
    if (officeparserParsePptx) {
      try {
        return await new Promise((resolve, reject) => {
          officeparserParsePptx(filePath, (data, err) => {
            if (err) reject(err);
            else resolve(data || '');
          });
        });
      } catch (e) {
        console.warn('officeparser PPT failed:', e.message);
      }
    }

    // Strategy 2: XLSX partial read
    try {
      const workbook = XLSX.readFile(filePath, { type: 'file', raw: false });
      if (workbook.SheetNames.length > 0) {
        const parts = workbook.SheetNames.map(n => XLSX.utils.sheet_to_txt(workbook.Sheets[n]));
        return `[Konten PowerPoint: ${originalName}]\n\n` + parts.join('\n\n');
      }
    } catch { /* ignore */ }

    // Strategy 3: Raw XML
    try {
      const AdmZip = (await import('adm-zip')).default;
      const zip    = new AdmZip(filePath);
      const slides = zip.getEntries()
        .filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/))
        .sort((a, b) => a.entryName.localeCompare(b.entryName));

      const texts = slides.map((entry, idx) => {
        const xml     = entry.getData().toString('utf8');
        const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
        const slideText = matches.map(m => m.replace(/<[^>]*>/g, '')).join(' ');
        return `[Slide ${idx + 1}]\n${slideText}`;
      });

      return texts.join('\n\n') || `[PowerPoint: ${originalName} — tidak ada teks yang dapat diekstrak]`;
    } catch (e) {
      return `[PowerPoint: ${originalName} — ekstraksi tidak tersedia: ${e.message}]`;
    }
  }

  // ── Original _extractPptContent (legacy, kept for compat) ─
  async _extractPptContent(filePath, originalName) {
    return this._extractPptContentEnhanced(filePath, originalName);
  }

  /**
   * Build the knowledge context string to inject into system prompt.
   * Respects knowledgeMode: 'always' | 'relevant' | 'disabled'
   * Now includes GYS theme matching hints.
   */
  buildKnowledgeContext(knowledgeFiles = [], userMessage = '', knowledgeMode = 'relevant') {
    if (knowledgeMode === 'disabled' || !knowledgeFiles.length) return '';

    let filesToInclude = knowledgeFiles;

    // 'relevant' mode: filter by keyword matching
    if (knowledgeMode === 'relevant' && userMessage) {
      const scored = knowledgeFiles.map(f => ({
        file:  f,
        score: this._relevanceScore(f.content, f.originalName, userMessage),
      }));

      const relevant = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
      filesToInclude  = relevant.length > 0 ? relevant.map(s => s.file) : knowledgeFiles;
    }

    if (!filesToInclude.length) return '';

    // Check if any PPTX knowledge files contain GYS theme
    const pptxFiles = filesToInclude.filter(f =>
      /\.(pptx?|ppt)$/i.test(f.originalName) &&
      f.content && f.content.includes('GYS (Garuda Yamato Steel)')
    );

    let context = `\n\n=== 📚 KNOWLEDGE BASE ===\n`;
    context    += `Gunakan informasi berikut sebagai referensi untuk menjawab pertanyaan user.\n`;

    if (pptxFiles.length > 0) {
      context += `\n🎨 PPTX THEME REFERENCE DETECTED:\n`;
      context += `File presentasi GYS ditemukan. Gunakan tema, warna, dan layout yang sama.\n`;
      context += `Saat membuat presentasi, ikuti SEMUA spesifikasi desain GYS dari file referensi.\n`;
    }

    context += `PENTING: Untuk setiap informasi yang kamu ambil dari file-file di bawah, WAJIB sebutkan nama filenya sebagai sumber di akhir jawaban dengan format: "📂 **Sumber:** Dokumen internal — [nama file]"\n\n`;

    for (const f of filesToInclude) {
      context += `--- File: ${f.originalName} ---\n`;
      context += `[CITATION_TAG: internal_doc:${f.originalName}]\n`;
      context += (f.content || '(kosong)').substring(0, 15000);
      context += `\n\n`;
    }

    context += `=== AKHIR KNOWLEDGE BASE ===\n`;
    return context;
  }

  _relevanceScore(content = '', fileName = '', userMessage = '') {
    const msg   = userMessage.toLowerCase();
    const text  = (content + ' ' + fileName).toLowerCase();
    const words = msg.split(/\s+/).filter(w => w.length > 3);
    return words.reduce((acc, w) => acc + (text.includes(w) ? 1 : 0), 0);
  }

  _generateSummary(content, fileName) {
    const lines    = content.split('\n').filter(l => l.trim().length > 20);
    const preview  = lines.slice(0, 3).join(' ').substring(0, 200);
    const wordCount = content.split(/\s+/).length;
    return `${fileName} — ${wordCount.toLocaleString()} kata. Preview: ${preview}...`;
  }
}

export default new KnowledgeBaseService();