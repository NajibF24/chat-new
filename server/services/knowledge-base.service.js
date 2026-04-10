// server/services/knowledge-base.service.js
// ============================================================
// PATCH CHANGES:
//   - buildKnowledgeContext() — hapus mention gambar dari context string
//     (gambar untuk PPT sudah tidak dari knowledge base)
//   - getExtractedImages() — tetap ada tapi tidak dipanggil untuk PPT
//     (masih bisa dipakai untuk keperluan lain di masa depan)
//   - extractContent() — tidak berubah, masih extract gambar saat upload
//     knowledge base (untuk keperluan selain PPT)
// ============================================================

import fs      from 'fs';
import path    from 'path';
import pdf     from 'pdf-parse';
import mammoth from 'mammoth';
import XLSX    from 'xlsx';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Optional PPT parser ───────────────────────────────────────
let officeparserParsePptx = null;
try {
  const op = await import('officeparser');
  officeparserParsePptx = op.parseOffice || op.default?.parseOffice || null;
} catch {
  // officeparser not available
}

// ── Image output directory ────────────────────────────────────
const IMAGE_OUTPUT_DIR = path.join(process.cwd(), 'data', 'files', 'extracted-images');

class KnowledgeBaseService {

  /**
   * Extract text content AND images from a file.
   * Returns { content: string, summary: string, extractedImages: [] }
   * 
   * NOTE: extractedImages disimpan ke DB untuk keperluan knowledge base.
   * Untuk PPT generation, gambar diambil dari file attachment chat (bukan sini).
   */
  async extractContent(filePath, originalName, mimetype) {
    const ext = path.extname(originalName).toLowerCase();

    if (!fs.existsSync(IMAGE_OUTPUT_DIR)) {
      fs.mkdirSync(IMAGE_OUTPUT_DIR, { recursive: true });
    }

    try {
      let content = '';
      let extractedImages = [];

      if (ext === '.pdf' || mimetype === 'application/pdf') {
        const buffer = fs.readFileSync(filePath);
        const data   = await pdf(buffer);
        content      = data.text || '';

      } else if (
        ext === '.docx' || ext === '.doc' ||
        mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimetype === 'application/msword'
      ) {
        const result = await mammoth.extractRawText({ path: filePath });
        content      = result.value || '';
        if (ext === '.docx') {
          extractedImages = await this._extractImagesFromDocx(filePath, originalName);
        }

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

      } else if (
        ext === '.pptx' || ext === '.ppt' ||
        mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        mimetype === 'application/vnd.ms-powerpoint'
      ) {
        content = await this._extractPptContent(filePath, originalName);
        if (ext === '.pptx') {
          extractedImages = await this._extractImagesFromPptx(filePath, originalName);
        }

      } else if (ext === '.csv' || mimetype === 'text/csv') {
        content = fs.readFileSync(filePath, 'utf8');

      } else if (
        ext === '.txt' || ext === '.md' ||
        (mimetype && mimetype.startsWith('text/'))
      ) {
        content = fs.readFileSync(filePath, 'utf8');

      } else {
        try {
          content = fs.readFileSync(filePath, 'utf8');
        } catch {
          content = `[File "${originalName}" tidak dapat dibaca sebagai teks]`;
        }
      }

      const MAX_CHARS = 80000;
      if (content.length > MAX_CHARS) {
        content = content.substring(0, MAX_CHARS) + '\n\n[... konten dipotong ...]';
      }

      const summary = this._generateSummary(content, originalName, extractedImages.length);
      return { content: content.trim(), summary, extractedImages };

    } catch (err) {
      console.error(`❌ Knowledge extraction failed for "${originalName}":`, err.message);
      return {
        content: `[Error membaca file "${originalName}": ${err.message}]`,
        summary: `File: ${originalName} (gagal dibaca)`,
        extractedImages: [],
      };
    }
  }

  async _extractImagesFromDocx(filePath, originalName) {
    const images = [];
    try {
      const JSZip = (await import('jszip')).default;
      const data   = fs.readFileSync(filePath);
      const zip    = await JSZip.loadAsync(data);

      const imageEntries = Object.keys(zip.files).filter(name =>
        name.startsWith('word/media/') && !zip.files[name].dir
      );

      for (let i = 0; i < imageEntries.length; i++) {
        const entry    = zip.files[imageEntries[i]];
        const origName = path.basename(imageEntries[i]);
        const ext      = path.extname(origName).toLowerCase();

        if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) continue;

        const mimeMap = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        };

        const imgBuffer   = await entry.async('nodebuffer');
        const safeBase    = path.basename(originalName, path.extname(originalName))
          .replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
        const imgFilename = `docx_${safeBase}_img${i + 1}${ext}`;
        const imgPath     = path.join(IMAGE_OUTPUT_DIR, imgFilename);
        const imgUrl      = `/api/files/extracted-images/${imgFilename}`;

        fs.writeFileSync(imgPath, imgBuffer);

        images.push({
          filename: imgFilename,
          path:     imgPath,
          url:      imgUrl,
          mimeType: mimeMap[ext] || 'image/png',
          index:    i,
          caption:  `Image ${i + 1} from ${originalName}`,
        });
      }

      console.log(`[KnowledgeBase] Extracted ${images.length} images from "${originalName}"`);
    } catch (err) {
      console.error(`[KnowledgeBase] Image extraction error (DOCX):`, err.message);
    }
    return images;
  }

  async _extractImagesFromPptx(filePath, originalName) {
    const images = [];
    try {
      const JSZip = (await import('jszip')).default;
      const data   = fs.readFileSync(filePath);
      const zip    = await JSZip.loadAsync(data);

      const imageEntries = Object.keys(zip.files).filter(name =>
        name.startsWith('ppt/media/') && !zip.files[name].dir
      );

      const mimeMap = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      };

      for (let i = 0; i < imageEntries.length; i++) {
        const entry = zip.files[imageEntries[i]];
        const ext   = path.extname(imageEntries[i]).toLowerCase();
        if (!mimeMap[ext]) continue;

        const imgBuffer   = await entry.async('nodebuffer');
        const safeBase    = path.basename(originalName, path.extname(originalName))
          .replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
        const imgFilename = `pptx_${safeBase}_img${i + 1}${ext}`;
        const imgPath     = path.join(IMAGE_OUTPUT_DIR, imgFilename);
        const imgUrl      = `/api/files/extracted-images/${imgFilename}`;

        fs.writeFileSync(imgPath, imgBuffer);

        images.push({
          filename: imgFilename,
          path:     imgPath,
          url:      imgUrl,
          mimeType: mimeMap[ext],
          index:    i,
          caption:  `Image ${i + 1} from ${path.basename(originalName, '.pptx')}`,
        });
      }

      console.log(`[KnowledgeBase] Extracted ${images.length} images from "${originalName}"`);
    } catch (err) {
      console.error(`[KnowledgeBase] Image extraction error (PPTX):`, err.message);
    }
    return images;
  }

  async _extractPptContent(filePath, originalName) {
    if (officeparserParsePptx) {
      try {
        return await new Promise((resolve, reject) => {
          officeparserParsePptx(filePath, (data, err) => {
            if (err) reject(err);
            else resolve(data || '');
          });
        });
      } catch (e) {
        console.warn('officeparser PPT failed, trying XLSX fallback:', e.message);
      }
    }

    try {
      const workbook = XLSX.readFile(filePath, { type: 'file', raw: false });
      if (workbook.SheetNames.length > 0) {
        const parts = workbook.SheetNames.map(n => XLSX.utils.sheet_to_txt(workbook.Sheets[n]));
        return `[Konten PowerPoint: ${originalName}]\n\n` + parts.join('\n\n');
      }
    } catch { /* ignore */ }

    try {
      const JSZip = (await import('jszip')).default;
      const zip    = new JSZip(fs.readFileSync(filePath));
      const slides = zip.getEntries()
        .filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/))
        .sort((a, b) => a.entryName.localeCompare(b.entryName));

      const texts = slides.map((entry, idx) => {
        const xml     = entry.getData().toString('utf8');
        const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
        const slideText = matches.map(m => m.replace(/<[^>]*>/g, '')).join(' ');
        return `[Slide ${idx + 1}]\n${slideText}`;
      });

      return texts.join('\n\n') || `[PowerPoint: ${originalName} — tidak ada teks]`;
    } catch (e) {
      return `[PowerPoint: ${originalName} — ekstraksi tidak tersedia: ${e.message}]`;
    }
  }

  /**
   * Build knowledge context string for AI prompt injection.
   * ✅ UPDATED: Tidak lagi menyebut gambar — gambar untuk PPT dari attachment chat
   */
  buildKnowledgeContext(knowledgeFiles = [], userMessage = '', knowledgeMode = 'relevant') {
    if (knowledgeMode === 'disabled' || !knowledgeFiles.length) return '';

    let filesToInclude = knowledgeFiles;

    if (knowledgeMode === 'relevant' && userMessage) {
      const scored = knowledgeFiles.map(f => ({
        file:  f,
        score: this._relevanceScore(f.content, f.originalName, userMessage),
      }));
      const relevant = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
      filesToInclude  = relevant.length > 0 ? relevant.map(s => s.file) : knowledgeFiles;
    }

    if (!filesToInclude.length) return '';

    let context = `\n\n=== 📚 KNOWLEDGE BASE ===\n`;
    context    += `Gunakan informasi berikut sebagai referensi:\n\n`;

    for (const f of filesToInclude) {
      context += `--- File: ${f.originalName} ---\n`;
      context += (f.content || '(kosong)').substring(0, 15000);
      context += `\n\n`;
    }

    context += `=== AKHIR KNOWLEDGE BASE ===\n`;
    return context;
  }

  /**
   * Get extracted images from knowledge base files.
   * ✅ NOTE: Untuk PPT generation, JANGAN panggil ini.
   *          Gambar PPT diambil dari file attachment chat user.
   *          Method ini tetap ada untuk keperluan lain di masa depan.
   */
  getExtractedImages(knowledgeFiles = [], userMessage = '', knowledgeMode = 'relevant') {
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
        return img.path && fs.existsSync(img.path);
      });
      allImages.push(...imgs.map(img => ({ ...img, sourceFile: f.originalName })));
    }

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
    const imgInfo   = imageCount > 0 ? ` · ${imageCount} gambar` : '';
    return `${fileName} — ${wordCount.toLocaleString()} kata${imgInfo}. Preview: ${preview}...`;
  }
}

export default new KnowledgeBaseService();
