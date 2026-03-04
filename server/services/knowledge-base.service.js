import fs    from 'fs';
import path  from 'path';
import pdf   from 'pdf-parse';
import mammoth from 'mammoth';
import XLSX  from 'xlsx';

class KnowledgeBaseService {

  /**
   * Extract text content from a file.
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

      // ── CSV ───────────────────────────────────────────────
      } else if (ext === '.csv' || mimetype === 'text/csv') {
        content = fs.readFileSync(filePath, 'utf8');

      // ── Plain Text ────────────────────────────────────────
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

  /**
   * Build the knowledge context string to inject into system prompt.
   * Respects knowledgeMode: 'always' | 'relevant' | 'disabled'
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

      // Include if score > 0, else fall back to all files
      const relevant = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
      filesToInclude  = relevant.length > 0 ? relevant.map(s => s.file) : knowledgeFiles;
    }

    if (!filesToInclude.length) return '';

    let context = `\n\n=== 📚 KNOWLEDGE BASE ===\n`;
    context    += `Gunakan informasi berikut sebagai referensi untuk menjawab pertanyaan user:\n\n`;

    for (const f of filesToInclude) {
      context += `--- File: ${f.originalName} ---\n`;
      context += (f.content || '(kosong)').substring(0, 15000); // max 15K chars per file in context
      context += `\n\n`;
    }

    context += `=== AKHIR KNOWLEDGE BASE ===\n`;
    return context;
  }

  /**
   * Simple relevance score: count keyword hits in content
   */
  _relevanceScore(content = '', fileName = '', userMessage = '') {
    const msg   = userMessage.toLowerCase();
    const text  = (content + ' ' + fileName).toLowerCase();
    const words = msg.split(/\s+/).filter(w => w.length > 3);
    return words.reduce((acc, w) => acc + (text.includes(w) ? 1 : 0), 0);
  }

  /**
   * Create a short summary of extracted content
   */
  _generateSummary(content, fileName) {
    const lines    = content.split('\n').filter(l => l.trim().length > 20);
    const preview  = lines.slice(0, 3).join(' ').substring(0, 200);
    const wordCount = content.split(/\s+/).length;
    return `${fileName} — ${wordCount.toLocaleString()} kata. Preview: ${preview}...`;
  }
}

export default new KnowledgeBaseService();
