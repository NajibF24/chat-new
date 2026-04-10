// server/services/knowledge-base.service.js
// ✅ FIXED:
//   BUG 1: _extractPptContent used `new JSZip(buffer)` — broken in JSZip v3
//          Fixed to use `await JSZip.loadAsync(data)`
//   BUG 2: extractedImages was extracted but never returned from extractContent()
//          Fixed to include extractedImages in return value
// ✅ ADDED: Comprehensive logging throughout all operations

import fs      from 'fs';
import path    from 'path';
import pdf     from 'pdf-parse';
import mammoth from 'mammoth';
import XLSX    from 'xlsx';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Logger ────────────────────────────────────────────────────
const L = {
  info:  (...a) => console.log( new Date().toISOString(), '[KnowledgeBase] ℹ️ ', ...a),
  ok:    (...a) => console.log( new Date().toISOString(), '[KnowledgeBase] ✅', ...a),
  warn:  (...a) => console.warn(new Date().toISOString(), '[KnowledgeBase] ⚠️ ', ...a),
  error: (...a) => console.error(new Date().toISOString(), '[KnowledgeBase] ❌', ...a),
  step:  (...a) => console.log( new Date().toISOString(), '[KnowledgeBase]  ├─', ...a),
};

// ── Optional PPT parser ───────────────────────────────────────
let officeparserParsePptx = null;
try {
  const op = await import('officeparser');
  officeparserParsePptx = op.parseOffice || op.default?.parseOffice || null;
  if (officeparserParsePptx) L.ok('officeparser loaded successfully');
} catch {
  L.warn('officeparser not available — will use JSZip fallback for PPT text extraction');
}

// ── Image output directory ────────────────────────────────────
const IMAGE_OUTPUT_DIR = path.join(process.cwd(), 'data', 'files', 'extracted-images');

class KnowledgeBaseService {

  /**
   * Extract text content AND images from a file.
   * Returns { content, summary, extractedImages }
   */
  async extractContent(filePath, originalName, mimetype) {
    const ext = path.extname(originalName).toLowerCase();
    const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

    L.info(`─────────────────────────────────────────────`);
    L.info(`extractContent: "${originalName}"`);
    L.step(`path     = ${filePath}`);
    L.step(`ext      = ${ext}`);
    L.step(`mimetype = ${mimetype}`);
    L.step(`size     = ${(fileSize / 1024).toFixed(1)} KB`);

    // Ensure image output dir exists
    if (!fs.existsSync(IMAGE_OUTPUT_DIR)) {
      fs.mkdirSync(IMAGE_OUTPUT_DIR, { recursive: true });
      L.info(`Created image output dir: ${IMAGE_OUTPUT_DIR}`);
    }

    const startTime = Date.now();
    let content = '';
    let extractedImages = [];

    try {
      // ── PDF ─────────────────────────────────────────────────
      if (ext === '.pdf' || mimetype === 'application/pdf') {
        L.step('Parser: pdf-parse');
        const buffer = fs.readFileSync(filePath);
        const data   = await pdf(buffer);
        content      = data.text || '';
        L.step(`PDF extracted: ${content.length} chars | ${data.numpages} pages`);

      // ── DOCX ────────────────────────────────────────────────
      } else if (
        ext === '.docx' || ext === '.doc' ||
        mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimetype === 'application/msword'
      ) {
        L.step('Parser: mammoth (DOCX text)');
        const result = await mammoth.extractRawText({ path: filePath });
        content      = result.value || '';
        L.step(`DOCX text extracted: ${content.length} chars`);

        if (ext === '.docx') {
          L.step('Extracting images from DOCX...');
          extractedImages = await this._extractImagesFromDocx(filePath, originalName);
          L.step(`DOCX images extracted: ${extractedImages.length} images`);
        }

      // ── XLSX ────────────────────────────────────────────────
      } else if (
        ext === '.xlsx' || ext === '.xls' ||
        mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mimetype === 'application/vnd.ms-excel'
      ) {
        L.step('Parser: xlsx (spreadsheet)');
        const workbook = XLSX.readFile(filePath);
        L.step(`Sheets found: ${workbook.SheetNames.join(', ')}`);
        const parts = workbook.SheetNames.map(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const csv   = XLSX.utils.sheet_to_csv(sheet);
          L.step(`  Sheet "${sheetName}": ${csv.length} chars`);
          return `=== Sheet: ${sheetName} ===\n${csv}`;
        });
        content = parts.join('\n\n');
        L.step(`XLSX total extracted: ${content.length} chars`);

      // ── PPTX ────────────────────────────────────────────────
      } else if (
        ext === '.pptx' || ext === '.ppt' ||
        mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        mimetype === 'application/vnd.ms-powerpoint'
      ) {
        L.step('Parser: pptx (text + images)');
        content = await this._extractPptContent(filePath, originalName);
        L.step(`PPTX text extracted: ${content.length} chars`);

        if (ext === '.pptx') {
          L.step('Extracting images from PPTX...');
          extractedImages = await this._extractImagesFromPptx(filePath, originalName);
          L.step(`PPTX images extracted: ${extractedImages.length} images`);
        }

      // ── CSV ──────────────────────────────────────────────────
      } else if (ext === '.csv' || mimetype === 'text/csv') {
        L.step('Parser: plain text (CSV)');
        content = fs.readFileSync(filePath, 'utf8');
        L.step(`CSV extracted: ${content.length} chars`);

      // ── TXT / MD ─────────────────────────────────────────────
      } else if (
        ext === '.txt' || ext === '.md' ||
        (mimetype && mimetype.startsWith('text/'))
      ) {
        L.step('Parser: plain text');
        content = fs.readFileSync(filePath, 'utf8');
        L.step(`Text extracted: ${content.length} chars`);

      } else {
        L.warn(`Unknown file type "${ext}" — attempting UTF-8 read`);
        try {
          content = fs.readFileSync(filePath, 'utf8');
          L.step(`Fallback text read: ${content.length} chars`);
        } catch {
          content = `[File "${originalName}" cannot be read as text]`;
          L.warn(`Cannot read file as text: ${originalName}`);
        }
      }

      // Truncate very large content
      const MAX_CHARS = 80000;
      if (content.length > MAX_CHARS) {
        L.warn(`Content truncated from ${content.length} to ${MAX_CHARS} chars`);
        content = content.substring(0, MAX_CHARS) + '\n\n[... content truncated ...]';
      }

      const summary = this._generateSummary(content, originalName, extractedImages.length);
      const elapsed = Date.now() - startTime;

      L.ok(`extractContent done: "${originalName}" | ${content.length} chars | ${extractedImages.length} images | ${elapsed}ms`);
      extractedImages.forEach((img, i) => {
        L.step(`  Image[${i}]: ${img.filename} (${img.mimeType}) → ${img.url}`);
      });

      return { content: content.trim(), summary, extractedImages };

    } catch (err) {
      const elapsed = Date.now() - startTime;
      L.error(`extractContent FAILED for "${originalName}" after ${elapsed}ms: ${err.message}`);
      L.error(err.stack);
      return {
        content: `[Error reading file "${originalName}": ${err.message}]`,
        summary: `File: ${originalName} (read failed)`,
        extractedImages: [],
      };
    }
  }

  // ── Extract images from DOCX ──────────────────────────────
  async _extractImagesFromDocx(filePath, originalName) {
    const images = [];
    const startTime = Date.now();
    L.info(`_extractImagesFromDocx: "${originalName}"`);

    try {
      const { default: JSZip } = await import('jszip');
      const data = fs.readFileSync(filePath);
      L.step(`DOCX zip loaded: ${data.length} bytes`);

      const zip = await JSZip.loadAsync(data);

      // DOCX images are in word/media/
      const allEntries  = Object.keys(zip.files);
      const mediaEntries = allEntries.filter(name =>
        name.startsWith('word/media/') && !zip.files[name].dir
      );
      L.step(`word/media/ entries: ${mediaEntries.length} total files`);

      const mimeMap = {
        '.png':  'image/png',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif':  'image/gif',
        '.webp': 'image/webp',
        '.bmp':  'image/bmp',
      };

      for (let i = 0; i < mediaEntries.length; i++) {
        const entryName = mediaEntries[i];
        const ext       = path.extname(entryName).toLowerCase();

        if (!mimeMap[ext]) {
          L.step(`  Skipping non-image: ${entryName}`);
          continue;
        }

        const entry     = zip.files[entryName];
        const imgBuffer = await entry.async('nodebuffer');
        const safeBase  = path.basename(originalName, path.extname(originalName))
          .replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
        const imgFilename = `docx_${safeBase}_img${i + 1}${ext}`;
        const imgPath     = path.join(IMAGE_OUTPUT_DIR, imgFilename);
        const imgUrl      = `/api/files/extracted-images/${imgFilename}`;

        fs.writeFileSync(imgPath, imgBuffer);
        L.step(`  Saved image[${i}]: ${entryName} → ${imgFilename} (${imgBuffer.length} bytes)`);

        images.push({
          filename: imgFilename,
          path:     imgPath,
          url:      imgUrl,
          mimeType: mimeMap[ext],
          index:    i,
          caption:  `Image ${i + 1} from ${originalName}`,
        });
      }

      L.ok(`_extractImagesFromDocx: ${images.length} images saved in ${Date.now() - startTime}ms`);
    } catch (err) {
      L.error(`_extractImagesFromDocx failed: ${err.message}`);
      L.error(err.stack);
    }
    return images;
  }

  // ── Extract images from PPTX ──────────────────────────────
  async _extractImagesFromPptx(filePath, originalName) {
    const images = [];
    const startTime = Date.now();
    L.info(`_extractImagesFromPptx: "${originalName}"`);

    try {
      const { default: JSZip } = await import('jszip');
      const data = fs.readFileSync(filePath);
      L.step(`PPTX zip loaded: ${data.length} bytes`);

      const zip = await JSZip.loadAsync(data);

      // PPTX images are in ppt/media/
      const allEntries   = Object.keys(zip.files);
      const mediaEntries = allEntries.filter(name =>
        name.startsWith('ppt/media/') && !zip.files[name].dir
      );
      L.step(`ppt/media/ entries: ${mediaEntries.length} total files`);

      const mimeMap = {
        '.png':  'image/png',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif':  'image/gif',
        '.webp': 'image/webp',
        '.bmp':  'image/bmp',
      };

      for (let i = 0; i < mediaEntries.length; i++) {
        const entryName = mediaEntries[i];
        const ext       = path.extname(entryName).toLowerCase();

        if (!mimeMap[ext]) {
          L.step(`  Skipping non-image: ${entryName} (${ext})`);
          continue;
        }

        const entry     = zip.files[entryName];
        const imgBuffer = await entry.async('nodebuffer');
        const safeBase  = path.basename(originalName, path.extname(originalName))
          .replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
        const imgFilename = `pptx_${safeBase}_img${i + 1}${ext}`;
        const imgPath     = path.join(IMAGE_OUTPUT_DIR, imgFilename);
        const imgUrl      = `/api/files/extracted-images/${imgFilename}`;

        fs.writeFileSync(imgPath, imgBuffer);
        L.step(`  Saved image[${i}]: ${entryName} → ${imgFilename} (${imgBuffer.length} bytes)`);

        images.push({
          filename: imgFilename,
          path:     imgPath,
          url:      imgUrl,
          mimeType: mimeMap[ext],
          index:    i,
          caption:  `Image ${i + 1} from ${path.basename(originalName, '.pptx')}`,
        });
      }

      L.ok(`_extractImagesFromPptx: ${images.length} images saved in ${Date.now() - startTime}ms`);
    } catch (err) {
      L.error(`_extractImagesFromPptx failed: ${err.message}`);
      L.error(err.stack);
    }
    return images;
  }

  // ── PPT text extraction ───────────────────────────────────
  async _extractPptContent(filePath, originalName) {
    L.info(`_extractPptContent: "${originalName}"`);
    const startTime = Date.now();

    // Strategy 1: officeparser
    if (officeparserParsePptx) {
      L.step('Trying officeparser...');
      try {
        const text = await new Promise((resolve, reject) => {
          officeparserParsePptx(filePath, (data, err) => {
            if (err) reject(err);
            else resolve(data || '');
          });
        });
        L.ok(`officeparser extracted: ${text.length} chars in ${Date.now() - startTime}ms`);
        return text;
      } catch (e) {
        L.warn(`officeparser failed: ${e.message} — trying JSZip fallback`);
      }
    }

    // Strategy 2: XLSX (sometimes works for PPT)
    L.step('Trying XLSX fallback...');
    try {
      const workbook = XLSX.readFile(filePath, { type: 'file', raw: false });
      if (workbook.SheetNames.length > 0) {
        const parts = workbook.SheetNames.map(n => XLSX.utils.sheet_to_txt(workbook.Sheets[n]));
        const text = `[PowerPoint Content: ${originalName}]\n\n` + parts.join('\n\n');
        L.ok(`XLSX fallback extracted: ${text.length} chars in ${Date.now() - startTime}ms`);
        return text;
      }
    } catch (e) {
      L.warn(`XLSX fallback failed: ${e.message}`);
    }

    // Strategy 3: JSZip — parse XML directly
    // ✅ FIX: was `new JSZip(buffer)` which is broken in JSZip v3
    //         correct is `await JSZip.loadAsync(buffer)`
    L.step('Trying JSZip XML extraction...');
    try {
      const { default: JSZip } = await import('jszip');
      const data = fs.readFileSync(filePath);
      const zip  = await JSZip.loadAsync(data); // ✅ FIXED

      const allFiles = Object.keys(zip.files);
      const slideFiles = allFiles
        .filter(e => e.match(/^ppt\/slides\/slide\d+\.xml$/))
        .sort((a, b) => {
          const na = parseInt(a.match(/slide(\d+)/)?.[1] || 0);
          const nb = parseInt(b.match(/slide(\d+)/)?.[1] || 0);
          return na - nb;
        });

      L.step(`Found ${slideFiles.length} slide XML files`);

      const texts = [];
      for (let idx = 0; idx < slideFiles.length; idx++) {
        const entry = zip.files[slideFiles[idx]];
        const xml   = await entry.async('string');
        const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
        const slideText = matches
          .map(m => m.replace(/<[^>]*>/g, '').trim())
          .filter(Boolean)
          .join(' ');
        L.step(`  Slide ${idx + 1}: ${slideText.length} chars of text`);
        texts.push(`[Slide ${idx + 1}]\n${slideText}`);
      }

      const result = texts.join('\n\n') || `[PowerPoint: ${originalName} — no text found]`;
      L.ok(`JSZip XML extracted: ${slideFiles.length} slides, ${result.length} chars in ${Date.now() - startTime}ms`);
      return result;

    } catch (e) {
      L.error(`JSZip extraction failed: ${e.message}`);
      return `[PowerPoint: ${originalName} — extraction unavailable: ${e.message}]`;
    }
  }

  /**
   * Build knowledge context string for AI prompt injection.
   */
  buildKnowledgeContext(knowledgeFiles = [], userMessage = '', knowledgeMode = 'relevant') {
    L.info(`buildKnowledgeContext: mode=${knowledgeMode} | files=${knowledgeFiles.length} | query="${(userMessage || '').substring(0, 60)}"`);

    if (knowledgeMode === 'disabled' || !knowledgeFiles.length) {
      L.info(`Knowledge context: disabled or no files`);
      return '';
    }

    let filesToInclude = knowledgeFiles;

    if (knowledgeMode === 'relevant' && userMessage) {
      const scored = knowledgeFiles.map(f => ({
        file:  f,
        score: this._relevanceScore(f.content, f.originalName, userMessage),
      }));
      scored.forEach(s => L.step(`  relevance "${s.file.originalName}": ${s.score}`));

      const relevant = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
      filesToInclude  = relevant.length > 0 ? relevant.map(s => s.file) : knowledgeFiles;
      L.info(`Relevant files selected: ${filesToInclude.length}/${knowledgeFiles.length}`);
    }

    if (!filesToInclude.length) return '';

    let context = `\n\n=== 📚 KNOWLEDGE BASE ===\n`;
    context    += `Use the following as reference:\n\n`;

    let totalChars = 0;
    for (const f of filesToInclude) {
      const fileContent = (f.content || '(empty)').substring(0, 15000);
      context += `--- File: ${f.originalName} ---\n`;
      context += fileContent;
      totalChars += fileContent.length;

      const imgs = f.extractedImages || [];
      if (imgs.length > 0) {
        context += `\n[This file has ${imgs.length} embedded image(s) available for PPT slides]\n`;
      }
      context += `\n\n`;
    }

    context += `=== END KNOWLEDGE BASE ===\n`;
    L.info(`Knowledge context built: ${filesToInclude.length} files, ${totalChars} chars`);
    return context;
  }

  /**
   * Get all extracted images from relevant knowledge files.
   * Used by PPT service to embed images into slides.
   */
  getExtractedImages(knowledgeFiles = [], userMessage = '', knowledgeMode = 'relevant') {
    L.info(`getExtractedImages: mode=${knowledgeMode} | files=${knowledgeFiles.length}`);

    if (knowledgeMode === 'disabled' || !knowledgeFiles.length) return [];

    let filesToInclude = knowledgeFiles;

    if (knowledgeMode === 'relevant' && userMessage) {
      const scored = knowledgeFiles.map(f => ({
        file:  f,
        score: this._relevanceScore(f.content, f.originalName, userMessage),
      }));
      const relevant = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
      filesToInclude  = relevant.length > 0 ? relevant.map(s => s.file) : knowledgeFiles;
    }

    const allImages = [];
    for (const f of filesToInclude) {
      const imgs = (f.extractedImages || []).filter(img => {
        const exists = img.path && fs.existsSync(img.path);
        if (!exists) L.warn(`Image file missing on disk: ${img.path}`);
        return exists;
      });
      if (imgs.length > 0) {
        L.step(`File "${f.originalName}": ${imgs.length} images available`);
        allImages.push(...imgs.map(img => ({ ...img, sourceFile: f.originalName })));
      }
    }

    L.info(`getExtractedImages total: ${allImages.length} images`);
    return allImages;
  }

  _relevanceScore(content = '', fileName = '', userMessage = '') {
    const msg   = userMessage.toLowerCase();
    const text  = (content + ' ' + fileName).toLowerCase();
    const words = msg.split(/\s+/).filter(w => w.length > 3);
    return words.reduce((acc, w) => acc + (text.includes(w) ? 1 : 0), 0);
  }

  _generateSummary(content, fileName, imageCount = 0) {
    const lines     = content.split('\n').filter(l => l.trim().length > 20);
    const preview   = lines.slice(0, 3).join(' ').substring(0, 200);
    const wordCount = content.split(/\s+/).length;
    const imgInfo   = imageCount > 0 ? ` · ${imageCount} image(s)` : '';
    return `${fileName} — ${wordCount.toLocaleString()} words${imgInfo}. Preview: ${preview}...`;
  }
}

export default new KnowledgeBaseService();