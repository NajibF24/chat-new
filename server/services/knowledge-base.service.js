// server/services/knowledge-base.service.js
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

      // ── PPTX / PPT ────────────────────────────────────────
      } else if (
        ext === '.pptx' || ext === '.ppt' ||
        mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        mimetype === 'application/vnd.ms-powerpoint'
      ) {
        content = await this._extractPptContent(filePath, originalName);

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

  // ── PPT / PPTX extraction ─────────────────────────────────
  async _extractPptContent(filePath, originalName) {
    // Strategy 1: officeparser (best for PPTX)
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

    // Strategy 2: XLSX can partially read PPTX (extracts shared strings)
    try {
      const workbook = XLSX.readFile(filePath, { type: 'file', raw: false });
      if (workbook.SheetNames.length > 0) {
        const parts = workbook.SheetNames.map(n => XLSX.utils.sheet_to_txt(workbook.Sheets[n]));
        return `[Konten PowerPoint: ${originalName}]\n\n` + parts.join('\n\n');
      }
    } catch { /* ignore */ }

    // Strategy 3: Read raw XML from PPTX (it's a zip)
    try {
      const AdmZip = (await import('adm-zip')).default;
      const zip    = new AdmZip(filePath);
      const slides = zip.getEntries()
        .filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/))
        .sort((a, b) => a.entryName.localeCompare(b.entryName));

      const texts = slides.map((entry, idx) => {
        const xml   = entry.getData().toString('utf8');
        // Extract text between <a:t> tags
        const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
        const slideText = matches.map(m => m.replace(/<[^>]*>/g, '')).join(' ');
        return `[Slide ${idx + 1}]\n${slideText}`;
      });

      return texts.join('\n\n') || `[PowerPoint: ${originalName} — tidak ada teks yang dapat diekstrak]`;
    } catch (e) {
      return `[PowerPoint: ${originalName} — ekstraksi tidak tersedia: ${e.message}]`;
    }
  }

  /**
   * Build the knowledge context string to inject into system prompt.
   * Respects knowledgeMode: 'always' | 'relevant' | 'disabled'
   * Now includes citation hints for each file.
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

    let context = `\n\n=== 📚 KNOWLEDGE BASE ===\n`;
    context    += `Gunakan informasi berikut sebagai referensi untuk menjawab pertanyaan user.\n`;
    context    += `PENTING: Untuk setiap informasi yang kamu ambil dari file-file di bawah, WAJIB sebutkan nama filenya sebagai sumber di akhir jawaban dengan format: "📂 **Sumber:** Dokumen internal — [nama file]"\n\n`;

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
