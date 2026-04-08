// server/services/onedrive.service.js
// FIXED: Lebih agresif membaca konten file, scoring lebih cerdas,
//        fallback ke file terbaru jika tidak ada keyword match

import axios from 'axios';

const SUPPORTED_EXT = ['pdf','docx','doc','xlsx','xls','txt','csv','md','pptx','ppt'];

// ── Keyword expansion untuk query pendek ─────────────────────
const KEYWORD_SYNONYMS = {
  'laptop':     ['notebook', 'computer', 'pc', 'hardware', 'device', 'komputer', 'perangkat'],
  'manajer':    ['manager', 'managerial', 'management', 'jabatan', 'level'],
  'standar':    ['standard', 'specification', 'spesifikasi', 'spec', 'ketentuan', 'kebijakan', 'policy', 'requirement'],
  'it':         ['information technology', 'teknologi informasi', 'helpdesk'],
  'policy':     ['kebijakan', 'standar', 'prosedur', 'procedure', 'ketentuan', 'aturan', 'rule'],
  'hardware':   ['laptop', 'komputer', 'notebook', 'peripheral', 'device', 'perangkat'],
  'karyawan':   ['employee', 'staff', 'pegawai', 'user'],
  'spesifikasi':['specification', 'spec', 'standar', 'standard', 'requirement'],
};

function expandKeywords(keywords) {
  const expanded = new Set(keywords);
  for (const kw of keywords) {
    const syns = KEYWORD_SYNONYMS[kw.toLowerCase()] || [];
    syns.forEach(s => expanded.add(s));
  }
  return [...expanded];
}

class OneDriveService {
  constructor(tenantId, clientId, clientSecret) {
    this.tenantId     = tenantId;
    this.clientId     = clientId;
    this.clientSecret = clientSecret;
    this.accessToken  = null;
    this.tokenExpiry  = null;
  }

  // ── 1. Get Access Token (OAuth2 Client Credentials) ──────────
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300_000) {
      return this.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const params   = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     this.clientId,
      client_secret: this.clientSecret,
      scope:         'https://graph.microsoft.com/.default',
    });

    try {
      const response = await axios.post(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      });
      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + response.data.expires_in * 1000;
      return this.accessToken;
    } catch (err) {
      const msg = err.response?.data?.error_description || err.response?.data?.error || err.message;
      throw new Error(`Azure AD auth failed: ${msg}`);
    }
  }

  // ── Graph API helper ──────────────────────────────────────────
  async graphGet(endpoint, params = {}) {
    const token = await this.getAccessToken();
    const response = await axios.get(`https://graph.microsoft.com/v1.0${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
      timeout: 10_000,
    });
    return response.data;
  }

  // ── 2. Parse folder URL → driveId + folderPath ───────────────
  async parseFolderUrl(folderUrl) {
    const url      = new URL(folderUrl);
    const hostname = url.hostname;

    let pathname = url.pathname;
    if (url.searchParams.has('id')) {
      const idParam = decodeURIComponent(url.searchParams.get('id'));
      pathname = idParam;
    } else {
      pathname = url.pathname.split('/').map(p => decodeURIComponent(p)).join('/');
    }

    console.log(`[OneDrive] Resolving pathname: "${pathname}" on host: ${hostname}`);

    const personalMatch = pathname.match(/^\/personal\/([^/]+)(?:\/Documents)?(?:\/(.*))?$/);
    if (personalMatch || hostname.includes('-my.sharepoint.com')) {
      const parts       = pathname.split('/').filter(Boolean);
      const personalIdx = parts.indexOf('personal');

      if (personalIdx !== -1) {
        const userPrincipal = parts[personalIdx + 1];
        const afterDocs = parts.slice(personalIdx + 3);
        const folderPath = afterDocs.join('/');

        console.log(`[OneDrive] Personal drive user="${userPrincipal}", folderPath="${folderPath}"`);

        const site   = await this.graphGet(`/sites/${hostname}:/personal/${userPrincipal}`);
        const drives = await this.graphGet(`/sites/${site.id}/drives`);
        const drive  = drives.value[0];
        return { driveId: drive.id, folderPath, type: 'personal' };
      }
    }

    const siteMatch = pathname.match(/^\/sites\/([^/]+)(.*)/);
    if (siteMatch) {
      const siteName  = siteMatch[1];
      const afterSite = siteMatch[2] || '';
      const afterParts = afterSite.split('/').filter(Boolean);

      const site   = await this.graphGet(`/sites/${hostname}:/sites/${siteName}`);
      const drives = await this.graphGet(`/sites/${site.id}/drives`);

      const libraryNames = ['shared documents', 'documents', 'dokumen bersama'];
      let drive, folderPath;

      if (afterParts.length > 0 && libraryNames.includes(afterParts[0].toLowerCase())) {
        drive      = drives.value.find(d => d.name.toLowerCase() === afterParts[0].toLowerCase())
                  || drives.value.find(d => d.name === 'Shared Documents' || d.name === 'Documents')
                  || drives.value[0];
        folderPath = afterParts.slice(1).join('/');
      } else {
        drive      = drives.value.find(d => d.name === 'Shared Documents' || d.name === 'Documents')
                  || drives.value[0];
        folderPath = afterParts.join('/');
      }

      console.log(`[OneDrive] SharePoint site="${siteName}", drive="${drive?.name}", folderPath="${folderPath}"`);
      return { driveId: drive.id, siteId: site.id, folderPath, type: 'sharepoint' };
    }

    throw new Error(`Format URL tidak dikenali. Gunakan URL dari address bar SharePoint/OneDrive.`);
  }

  // ── 3a. List isi 1 folder (1 level) ──────────────────────────
  async _listFolderItems(driveId, folderPath) {
    const endpoint = folderPath
      ? `/drives/${driveId}/root:/${folderPath}:/children`
      : `/drives/${driveId}/root/children`;

    const data = await this.graphGet(endpoint, {
      $select: 'id,name,size,lastModifiedDateTime,file,folder,webUrl',
      $top:    200,
    });
    return data.value || [];
  }

  // ── 3b. List files rekursif ───────────────────────────────────
  async _listFilesRecursive(driveId, folderPath, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return [];

    let items;
    try {
      items = await this._listFolderItems(driveId, folderPath);
    } catch (err) {
      console.error(`[OneDrive] Skip folder "${folderPath}":`, err.message);
      return [];
    }

    const files   = [];
    const folders = [];

    for (const item of items) {
      if (item.file) {
        const ext = (item.name.split('.').pop() || '').toLowerCase();
        if (SUPPORTED_EXT.includes(ext)) {
          files.push({
            id:           item.id,
            name:         item.name,
            size:         item.size || 0,
            lastModified: item.lastModifiedDateTime,
            webUrl:       item.webUrl,
            folderPath:   folderPath || '/',
            isFolder:     false,
          });
        }
      } else if (item.folder && depth < maxDepth) {
        folders.push(item.name);
      }
    }

    const CHUNK = 5;
    let subResults = [];
    for (let i = 0; i < folders.length; i += CHUNK) {
      const chunk   = folders.slice(i, i + CHUNK);
      const pending = chunk.map(name => {
        const subPath = folderPath ? `${folderPath}/${name}` : name;
        return this._listFilesRecursive(driveId, subPath, depth + 1, maxDepth);
      });
      const settled = await Promise.allSettled(pending);
      for (const r of settled) {
        if (r.status === 'fulfilled') subResults = subResults.concat(r.value);
      }
    }

    return files.concat(subResults);
  }

  // ── 3. List files ─────────────────────────────────────────────
  async listFiles(folderUrl) {
    const { driveId, folderPath } = await this.parseFolderUrl(folderUrl);
    return await this._listFilesRecursive(driveId, folderPath);
  }

  // ── 4. Download & read file content ──────────────────────────
  async readFileContent(driveId, fileId, fileName) {
    const token = await this.getAccessToken();
    const ext   = (fileName || '').split('.').pop().toLowerCase();

    const meta        = await this.graphGet(`/drives/${driveId}/items/${fileId}`);
    const downloadUrl = meta['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) throw new Error('File tidak bisa didownload');

    const fileRes = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout:      30_000,
      headers:      { Authorization: `Bearer ${token}` },
    });

    const buffer = Buffer.from(fileRes.data);

    try {
      if (ext === 'pdf') {
        const { default: pdfParse } = await import('pdf-parse');
        const data = await pdfParse(buffer);
        return data.text.substring(0, 20_000); // Naikan dari 15K ke 20K
      }

      if (ext === 'docx' || ext === 'doc') {
        const { default: mammoth } = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return result.value.substring(0, 20_000);
      }

      if (ext === 'xlsx' || ext === 'xls') {
        const { default: XLSX } = await import('xlsx');
        const wb   = XLSX.read(buffer, { type: 'buffer' });
        const text = wb.SheetNames
          .map(n => `[Sheet: ${n}]\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n]))
          .join('\n');
        return text.substring(0, 20_000);
      }

      if (ext === 'pptx' || ext === 'ppt') {
        const { default: JSZip } = await import('jszip');
        const zip        = await JSZip.loadAsync(buffer);
        const slideFiles = Object.keys(zip.files)
          .filter(f => /ppt\/slides\/slide\d+\.xml/.test(f))
          .sort();
        let text = '';
        for (const sf of slideFiles.slice(0, 20)) {
          const xml     = await zip.files[sf].async('string');
          const matches = xml.match(/<a:t[^>]*>(.*?)<\/a:t>/g) || [];
          text         += matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ') + '\n';
        }
        return text.substring(0, 20_000);
      }

      if (['txt', 'md', 'csv'].includes(ext)) {
        return buffer.toString('utf8').substring(0, 20_000);
      }

      return `[File: ${fileName} — tipe tidak didukung untuk pembacaan teks]`;

    } catch (parseErr) {
      console.error(`[OneDrive] Parse error "${fileName}":`, parseErr.message);
      return `[Gagal membaca konten ${fileName}: ${parseErr.message}]`;
    }
  }

  // ── 5. Score file relevance terhadap query ────────────────────
  _scoreFile(file, keywords) {
    const nameLower   = file.name.toLowerCase();
    const folderLower = (file.folderPath || '').toLowerCase();

    let score = 0;

    // Exact keyword match di nama file (bobot tinggi)
    for (const kw of keywords) {
      if (nameLower.includes(kw)) score += 3;
      if (folderLower.includes(kw)) score += 1;
    }

    // Bonus untuk file yang sering relevan (policy, SOP, standar, etc.)
    const policyPatterns = [
      'policy', 'kebijakan', 'standar', 'standard', 'sop', 'procedure',
      'prosedur', 'guideline', 'panduan', 'specification', 'spesifikasi',
    ];
    for (const p of policyPatterns) {
      if (nameLower.includes(p)) score += 1;
    }

    // Bonus untuk file yang lebih baru (dalam 1 tahun)
    const ageDays = (Date.now() - new Date(file.lastModified).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 30)  score += 2;
    else if (ageDays < 180) score += 1;

    // Bonus untuk ukuran file yang substansial (lebih besar = lebih banyak konten)
    if (file.size > 100_000) score += 1;

    return score;
  }

  // ── 6. Build context untuk AI ─────────────────────────────────
  // FIXED: Lebih agresif membaca file, fallback selalu ada,
  //        keyword expansion, max file dibaca ditambah
  async buildContext(folderUrl, userMessage) {
    try {
      const files = await this.listFiles(folderUrl);

      if (!files.length) {
        return `\n\n=== 📁 ONEDRIVE ===\nFolder kosong atau tidak ada file yang didukung.\n=== AKHIR ONEDRIVE ===\n`;
      }

      // ── Keyword extraction + expansion ──────────────────────
      const stopWords = new Set([
        'apa', 'bagaimana', 'berapa', 'untuk', 'yang', 'adalah', 'dengan',
        'dari', 'pada', 'ke', 'di', 'dan', 'atau', 'tidak', 'saya', 'kamu',
        'ini', 'itu', 'ada', 'sudah', 'what', 'how', 'for', 'the', 'is',
        'are', 'in', 'of', 'to', 'a', 'an', 'and', 'or', 'about',
      ]);

      const rawKeywords = userMessage
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

      const keywords = expandKeywords(rawKeywords);

      console.log(`[OneDrive] Query keywords: ${rawKeywords.join(', ')}`);
      console.log(`[OneDrive] Expanded keywords: ${keywords.join(', ')}`);

      // ── Score semua file ─────────────────────────────────────
      const scored = files
        .map(f => ({ ...f, score: this._scoreFile(f, keywords) }))
        .sort((a, b) => b.score - a.score || new Date(b.lastModified) - new Date(a.lastModified));

      // ── Pilih file untuk dibaca ───────────────────────────────
      // FIXED: Selalu baca minimal 3 file, bahkan jika score = 0
      const TOP_SCORE_FILES = 5;  // Baca top N file berdasarkan score
      const FALLBACK_FILES  = 3;  // Fallback ke N file terbaru jika tidak ada match

      let toRead;
      const hasRelevantFiles = scored.some(f => f.score > 0);

      if (hasRelevantFiles) {
        // Ada file relevan: ambil semua yang punya score > 0, max TOP_SCORE_FILES
        toRead = scored.filter(f => f.score > 0).slice(0, TOP_SCORE_FILES);
        console.log(`[OneDrive] Found ${toRead.length} relevant files (score > 0)`);
      } else {
        // Tidak ada yang relevan: fallback ke file terbaru
        toRead = scored.slice(0, FALLBACK_FILES);
        console.log(`[OneDrive] No keyword match, falling back to ${toRead.length} most recent files`);
      }

      // Build daftar semua file untuk referensi AI
      let context  = `\n\n=== 📁 ONEDRIVE / SHAREPOINT ===\n`;
      context     += `Total file tersedia: ${files.length}\n`;
      context     += `Query: "${userMessage}"\n`;
      context     += `File relevan dibaca: ${toRead.length}\n\n`;

      // Daftar semua file (untuk referensi)
      context += `**Semua File Tersedia:**\n`;
      files.slice(0, 30).forEach(f => {
        const size = f.size > 1_048_576
          ? `${(f.size / 1_048_576).toFixed(1)} MB`
          : `${Math.round(f.size / 1024)} KB`;
        const date = new Date(f.lastModified).toLocaleDateString('id-ID', {
          day: '2-digit', month: 'short', year: 'numeric',
        });
        const folder = f.folderPath && f.folderPath !== '/'
          ? `📂 ${f.folderPath}/`
          : '';
        context += `📄 ${folder}${f.name} (${size}, ${date})\n`;
      });
      if (files.length > 30) {
        context += `... dan ${files.length - 30} file lainnya\n`;
      }

      // BACA ISI FILE YANG RELEVAN
      if (toRead.length > 0) {
        context += `\n\n**KONTEN FILE RELEVAN:**\n`;
        context += `(Berikut adalah isi lengkap file-file yang berkaitan dengan pertanyaan Anda)\n\n`;

        const { driveId } = await this.parseFolderUrl(folderUrl);

        for (const file of toRead) {
          const docLabel = file.folderPath && file.folderPath !== '/'
            ? `${file.folderPath}/${file.name}`
            : file.name;

          context += `\n${'='.repeat(60)}\n`;
          context += `📄 FILE: ${docLabel}\n`;
          if (file.score > 0) {
            context += `🎯 Relevansi: Score ${file.score} (cocok dengan query)\n`;
          } else {
            context += `📅 File terbaru (tidak ada keyword match spesifik)\n`;
          }
          context += `${'='.repeat(60)}\n`;

          try {
            const content  = await this.readFileContent(driveId, file.id, file.name);
            if (content && content.trim().length > 0) {
              context += content;
            } else {
              context += `[File kosong atau tidak dapat dibaca]\n`;
            }
          } catch (e) {
            context += `[Gagal membaca file: ${e.message}]\n`;
          }

          context += `\n${'='.repeat(60)}\n`;
          context += `(Akhir file: ${file.name})\n\n`;
        }
      }

      // Instruksi eksplisit untuk AI
      context += `\n=== INSTRUKSI UNTUK AI ===\n`;
      context += `PENTING: Jawab pertanyaan user berdasarkan ISI KONTEN FILE di atas.\n`;
      context += `Jika informasi ada di file, kutip/ringkas secara spesifik dari file tersebut.\n`;
      context += `Sebutkan nama file sebagai sumbernya.\n`;
      context += `=== AKHIR ONEDRIVE ===\n`;

      return context;

    } catch (err) {
      console.error('[OneDrive] buildContext error:', err.message);
      return '';
    }
  }

  // ── 7. Test connection ────────────────────────────────────────
  async testConnection(folderUrl) {
    await this.getAccessToken();
    const files = await this.listFiles(folderUrl);

    const fileList = files.slice(0, 15).map(f => {
      const folder = f.folderPath && f.folderPath !== '/' ? `${f.folderPath}/` : '';
      return `${folder}${f.name}`;
    });

    return {
      ok:        true,
      fileCount: files.length,
      files:     fileList,
      message:   files.length === 0
        ? 'Koneksi berhasil, tapi tidak ada file yang didukung (PDF, DOCX, XLSX, dll).'
        : `Berhasil menemukan ${files.length} file (termasuk semua subfolder).`,
    };
  }
}

export default OneDriveService;
