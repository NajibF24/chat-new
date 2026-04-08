// server/services/onedrive-index.service.js
// Lightweight local index for OneDrive/SharePoint folders.
//
// Storage layout (total typically < 5MB per bot config):
//   data/onedrive-index/
//     {hash}.json          ← file metadata only (id, name, size, lastModified, path)
//     {hash}/              ← content cache dir
//       {safeFileId}.json  ← { lastModified, content[0..80KB], keywords[20] }
//
// Index TTL  : 2 hours  (refreshes the file list from OneDrive)
// Content TTL: infinite (fresh as long as file.lastModified unchanged in OneDrive)
// Eviction   : LRU at 100 files or 40MB per bot config

import fs   from 'fs';
import path from 'path';
import crypto from 'crypto';

const INDEX_BASE  = path.join(process.cwd(), 'data', 'onedrive-index');
const INDEX_TTL   = 2 * 60 * 60 * 1000;   // 2 hours
const MAX_FILES   = 100;                    // max cached content files per config
const MAX_BYTES   = 40 * 1024 * 1024;      // 40 MB per config
const MAX_CONTENT = 80_000;                // chars stored per file
const MAX_SUMMARY = 400;                   // chars in summary
const MAX_KW      = 25;                    // keywords stored per file

// Common stop words (Indonesian + English)
const STOP = new Set([
  'yang','dan','atau','di','ke','dari','ini','itu','untuk','dengan','dalam',
  'pada','adalah','ada','jika','saya','kamu','mereka','kita','kami','bisa',
  'akan','sudah','belum','lagi','juga','karena','kalau','tapi','namun',
  'the','a','an','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall',
  'of','in','on','at','to','for','and','or','not','this','that','with',
  'by','from','as','it','its','but','if','then','so','about','into','up',
  'out','what','how','when','where','who','which',
]);

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function configHash(tenantId, folderUrl) {
  return crypto.createHash('sha1')
    .update(`${tenantId}::${folderUrl}`)
    .digest('hex')
    .slice(0, 14);
}

function safeFileId(fileId) {
  return Buffer.from(fileId).toString('base64url').slice(0, 48);
}

class OneDriveIndexService {
  constructor() { ensureDir(INDEX_BASE); }

  // ── Paths ─────────────────────────────────────────────────
  _indexPath(hash)       { return path.join(INDEX_BASE, `${hash}.json`); }
  _contentDir(hash)      { return path.join(INDEX_BASE, hash); }
  _contentPath(hash, id) { return path.join(this._contentDir(hash), `${safeFileId(id)}.json`); }

  // ── Hash ──────────────────────────────────────────────────
  hash(tenantId, folderUrl) { return configHash(tenantId, folderUrl); }

  // ── Load index (metadata only) ────────────────────────────
  loadIndex(tenantId, folderUrl) {
    const hash = configHash(tenantId, folderUrl);
    const p = this._indexPath(hash);
    if (!fs.existsSync(p)) return { hash, index: null };
    try {
      return { hash, index: JSON.parse(fs.readFileSync(p, 'utf8')) };
    } catch {
      return { hash, index: null };
    }
  }

  isIndexFresh(index) {
    return Boolean(index?.indexed_at) &&
      (Date.now() - new Date(index.indexed_at).getTime()) < INDEX_TTL;
  }

  // ── Save index (file list, no content) ────────────────────
  saveIndex(hash, folderUrl, fileList) {
    const p = this._indexPath(hash);
    const data = {
      indexed_at: new Date().toISOString(),
      folder_url: folderUrl,
      files: fileList.map(f => ({
        id:           f.id,
        name:         f.name,
        size:         f.size || 0,
        lastModified: f.lastModified,
        folderPath:   f.folderPath || '/',
        webUrl:       f.webUrl || '',
      })),
    };
    try {
      fs.writeFileSync(p, JSON.stringify(data), 'utf8');
      const kb = Math.round(fs.statSync(p).size / 1024);
      console.log(`[ODIndex] Saved index: ${fileList.length} files, ${kb}KB`);
    } catch (e) {
      console.warn('[ODIndex] saveIndex error:', e.message);
    }
    return hash;
  }

  // ── Content cache ─────────────────────────────────────────
  loadContent(hash, fileId) {
    const p = this._contentPath(hash, fileId);
    if (!fs.existsSync(p)) return null;
    try {
      const now = new Date();
      fs.utimesSync(p, now, now); // touch for LRU
      return JSON.parse(fs.readFileSync(p, 'utf8'));
      // returns { lastModified, content, keywords }
    } catch {
      return null;
    }
  }

  isContentFresh(hash, fileId, fileLastModified) {
    const cached = this.loadContent(hash, fileId);
    return cached?.lastModified === fileLastModified;
  }

  saveContent(hash, fileId, lastModified, rawContent) {
    const dir = this._contentDir(hash);
    ensureDir(dir);
    this._evict(dir);

    const content  = (rawContent || '').substring(0, MAX_CONTENT);
    const keywords = this._extractKeywords(content);

    try {
      fs.writeFileSync(
        this._contentPath(hash, fileId),
        JSON.stringify({ lastModified, content, keywords }),
        'utf8'
      );
    } catch (e) {
      console.warn('[ODIndex] saveContent error:', e.message);
    }
    return keywords;
  }

  getContent(hash, fileId) {
    return this.loadContent(hash, fileId)?.content || null;
  }

  getKeywords(hash, fileId) {
    return this.loadContent(hash, fileId)?.keywords || [];
  }

  // ── Scoring helper ────────────────────────────────────────
  scoreFile(file, queryTerms, cachedKeywords = []) {
    const name   = (file.name        || '').toLowerCase();
    const folder = (file.folderPath  || '').toLowerCase();
    const kwSet  = new Set(cachedKeywords.map(k => k.toLowerCase()));
    let score = 0;

    for (const term of queryTerms) {
      if (name.includes(term))   score += 10;
      if (folder.includes(term)) score += 6;
      if (kwSet.has(term))       score += 4;
    }
    return score;
  }

  // ── Keyword extraction ────────────────────────────────────
  _extractKeywords(text = '') {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w));

    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_KW)
      .map(([w]) => w);
  }

  extractSummary(content = '') {
    return content
      .split('\n')
      .filter(l => l.trim().length > 20)
      .slice(0, 5)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, MAX_SUMMARY);
  }

  // ── LRU eviction ──────────────────────────────────────────
  _evict(dir) {
    try {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir)
        .map(name => {
          const fp = path.join(dir, name);
          try { const s = fs.statSync(fp); return { fp, atime: s.atimeMs, size: s.size }; }
          catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => a.atime - b.atime); // oldest first

      let total = entries.reduce((s, e) => s + e.size, 0);
      let count = entries.length;

      while ((count > MAX_FILES || total > MAX_BYTES) && entries.length > 0) {
        const { fp, size } = entries.shift();
        try { fs.unlinkSync(fp); } catch {}
        total -= size;
        count--;
      }
    } catch (e) {
      console.warn('[ODIndex] evict error:', e.message);
    }
  }

  // ── Storage stats ─────────────────────────────────────────
  getStats(tenantId, folderUrl) {
    const hash = configHash(tenantId, folderUrl);
    const indexPath  = this._indexPath(hash);
    const contentDir = this._contentDir(hash);

    let indexSize = 0, contentSize = 0, contentFiles = 0;
    try { indexSize = fs.statSync(indexPath).size; } catch {}
    try {
      if (fs.existsSync(contentDir)) {
        const files = fs.readdirSync(contentDir);
        contentFiles = files.length;
        contentSize  = files.reduce((sum, name) => {
          try { return sum + fs.statSync(path.join(contentDir, name)).size; } catch { return sum; }
        }, 0);
      }
    } catch {}

    return {
      hash,
      indexFiles: fs.existsSync(indexPath) ? 1 : 0,
      indexKB:    Math.round(indexSize / 1024),
      contentFiles,
      contentKB:  Math.round(contentSize / 1024),
      totalKB:    Math.round((indexSize + contentSize) / 1024),
    };
  }

  // ── Force invalidate ──────────────────────────────────────
  invalidate(tenantId, folderUrl) {
    const hash = configHash(tenantId, folderUrl);
    try { fs.unlinkSync(this._indexPath(hash)); } catch {}
    console.log(`[ODIndex] Index invalidated for hash=${hash}`);
  }
}

export default new OneDriveIndexService();
