// server/services/onedrive.service.js
// UPDATED: buildContext() now uses local index + content cache.
//   - First call: lists files from OneDrive, saves index (fast ~1-2s)
//   - Subsequent calls: uses cached index, only fetches content for relevant files
//   - Content cached per-file based on lastModified → no unnecessary re-downloads
//   - Storage stays small (see onedrive-index.service.js for limits)

import axios   from 'axios';
import odIndex from './onedrive-index.service.js';

const SUPPORTED_EXT = ['pdf','docx','doc','xlsx','xls','txt','csv','md','pptx','ppt'];

// Maps query keywords → folder name fragments to prioritize
const FOLDER_KEYWORD_MAP = {
  'it':         ['it system', 'it'],
  'laptop':     ['it system', 'it'],
  'komputer':   ['it system', 'it'],
  'computer':   ['it system', 'it'],
  'hardware':   ['it system', 'it'],
  'software':   ['it system', 'it'],
  'network':    ['it system', 'it'],
  'jaringan':   ['it system', 'it'],
  'server':     ['it system', 'it'],
  'email':      ['it system', 'it'],
  'sistem':     ['it system', 'it'],
  'system':     ['it system', 'it'],
  'standarisasi': ['it system', 'it', 'hrga'],
  'hr':         ['hrga'],
  'hrd':        ['hrga'],
  'hrga':       ['hrga'],
  'karyawan':   ['hrga'],
  'employee':   ['hrga'],
  'cuti':       ['hrga'],
  'recruitment':['hrga'],
  'gaji':       ['hrga'],
  'salary':     ['hrga'],
  'absensi':    ['hrga'],
  'attendance': ['hrga'],
  'finance':    ['finance', 'accounting'],
  'keuangan':   ['finance', 'accounting'],
  'akuntansi':  ['finance', 'accounting'],
  'invoice':    ['finance', 'accounting'],
  'pembayaran': ['finance', 'accounting'],
  'budget':     ['finance', 'accounting'],
  'procurement':['procurement', 'prc'],
  'pengadaan':  ['procurement', 'prc'],
  'vendor':     ['procurement', 'prc'],
  'purchase':   ['procurement', 'prc'],
  'quality':    ['qaqc', 'qa', 'qc', 'iso'],
  'kualitas':   ['qaqc', 'qa', 'qc'],
  'iso':        ['iso', 'qaqc'],
  'legal':      ['legal', 'lgl'],
  'kontrak':    ['legal', 'lgl'],
  'contract':   ['legal', 'lgl'],
  'scm':        ['scm', 'gdu'],
  'logistik':   ['scm', 'gdu'],
  'warehouse':  ['scm', 'gdu'],
  'gudang':     ['scm', 'gdu'],
  'sales':      ['sales', 'sls'],
  'penjualan':  ['sales', 'sls'],
};

class OneDriveService {
  constructor(tenantId, clientId, clientSecret) {
    this.tenantId     = tenantId;
    this.clientId     = clientId;
    this.clientSecret = clientSecret;
    this.accessToken  = null;
    this.tokenExpiry  = null;
  }

  // ── Auth ──────────────────────────────────────────────────
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
    const r = await axios.post(tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });
    this.accessToken = r.data.access_token;
    this.tokenExpiry = Date.now() + r.data.expires_in * 1000;
    return this.accessToken;
  }

  async graphGet(endpoint, params = {}) {
    const token = await this.getAccessToken();
    const r = await axios.get(`https://graph.microsoft.com/v1.0${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
      timeout: 10_000,
    });
    return r.data;
  }

  // ── URL parsing ───────────────────────────────────────────
  async parseFolderUrl(folderUrl) {
    const url      = new URL(folderUrl);
    const hostname = url.hostname;
    let pathname   = url.pathname;
    if (url.searchParams.has('id')) {
      pathname = decodeURIComponent(url.searchParams.get('id'));
    } else {
      pathname = pathname.split('/').map(p => decodeURIComponent(p)).join('/');
    }

    if (hostname.includes('-my.sharepoint.com') || pathname.includes('/personal/')) {
      const parts       = pathname.split('/').filter(Boolean);
      const personalIdx = parts.indexOf('personal');
      if (personalIdx !== -1) {
        const userPrincipal = parts[personalIdx + 1];
        const folderPath    = parts.slice(personalIdx + 3).join('/');
        const site   = await this.graphGet(`/sites/${hostname}:/personal/${userPrincipal}`);
        const drives = await this.graphGet(`/sites/${site.id}/drives`);
        return { driveId: drives.value[0].id, folderPath, type: 'personal' };
      }
    }

    const siteMatch = pathname.match(/^\/sites\/([^/]+)(.*)/);
    if (siteMatch) {
      const siteName   = siteMatch[1];
      const afterParts = (siteMatch[2] || '').split('/').filter(Boolean);
      const site   = await this.graphGet(`/sites/${hostname}:/sites/${siteName}`);
      const drives = await this.graphGet(`/sites/${site.id}/drives`);
      const libraryNames = ['shared documents', 'documents', 'dokumen bersama'];
      let drive, folderPath;
      if (afterParts.length > 0 && libraryNames.includes(afterParts[0].toLowerCase())) {
        drive      = drives.value.find(d => d.name.toLowerCase() === afterParts[0].toLowerCase())
                  || drives.value.find(d => ['Shared Documents','Documents'].includes(d.name))
                  || drives.value[0];
        folderPath = afterParts.slice(1).join('/');
      } else {
        drive      = drives.value.find(d => ['Shared Documents','Documents'].includes(d.name))
                  || drives.value[0];
        folderPath = afterParts.join('/');
      }
      return { driveId: drive.id, siteId: site.id, folderPath, type: 'sharepoint' };
    }

    throw new Error(`Format URL tidak dikenali.`);
  }

  // ── File listing ──────────────────────────────────────────
  async _listFolderItems(driveId, folderPath) {
    const endpoint = folderPath
      ? `/drives/${driveId}/root:/${folderPath}:/children`
      : `/drives/${driveId}/root/children`;
    const data = await this.graphGet(endpoint, {
      $select: 'id,name,size,lastModifiedDateTime,file,folder,webUrl',
      $top: 200,
    });
    return data.value || [];
  }

  async _listFilesRecursive(driveId, folderPath, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return [];
    let items;
    try {
      items = await this._listFolderItems(driveId, folderPath);
    } catch (err) {
      console.error(`[OneDrive] Skip "${folderPath}": ${err.message}`);
      return [];
    }
    const files = [], subFolders = [];
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
          });
        }
      } else if (item.folder && depth < maxDepth) {
        subFolders.push(item.name);
      }
    }
    for (let i = 0; i < subFolders.length; i += 5) {
      const chunk = subFolders.slice(i, i + 5);
      const results = await Promise.allSettled(
        chunk.map(name => this._listFilesRecursive(
          driveId, folderPath ? `${folderPath}/${name}` : name, depth + 1, maxDepth
        ))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') files.push(...r.value);
      }
    }
    return files;
  }

  // ── File listing (public) ─────────────────────────────────
  async listFiles(folderUrl) {
    const { driveId, folderPath } = await this.parseFolderUrl(folderUrl);
    return await this._listFilesRecursive(driveId, folderPath);
  }

  // ── Content extraction ────────────────────────────────────
  async readFileContent(driveId, fileId, fileName) {
    const token = await this.getAccessToken();
    const ext   = (fileName || '').split('.').pop().toLowerCase();
    const meta  = await this.graphGet(`/drives/${driveId}/items/${fileId}`);
    const dlUrl = meta['@microsoft.graph.downloadUrl'];
    if (!dlUrl) throw new Error('File tidak bisa didownload');

    const fileRes = await axios.get(dlUrl, {
      responseType: 'arraybuffer',
      timeout: 60_000,
      headers: { Authorization: `Bearer ${token}` },
    });
    const buffer    = Buffer.from(fileRes.data);
    const MAX_CHARS = 80_000;

    try {
      if (ext === 'pdf') {
        const { default: pdfParse } = await import('pdf-parse');
        const data = await pdfParse(buffer);
        return (data.text || '').substring(0, MAX_CHARS);
      }
      if (['docx','doc'].includes(ext)) {
        const { default: mammoth } = await import('mammoth');
        const r = await mammoth.extractRawText({ buffer });
        return (r.value || '').substring(0, MAX_CHARS);
      }
      if (['xlsx','xls'].includes(ext)) {
        const { default: XLSX } = await import('xlsx');
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const text = wb.SheetNames.map(n => `[${n}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n');
        return text.substring(0, MAX_CHARS);
      }
      if (['pptx','ppt'].includes(ext)) {
        const { default: JSZip } = await import('jszip');
        const zip = await JSZip.loadAsync(buffer);
        const slides = Object.keys(zip.files).filter(f => /ppt\/slides\/slide\d+\.xml/.test(f)).sort();
        let text = '';
        for (const s of slides.slice(0, 40)) {
          const xml = await zip.files[s].async('string');
          text += (xml.match(/<a:t[^>]*>(.*?)<\/a:t>/g) || []).map(m => m.replace(/<[^>]+>/g,'')).join(' ') + '\n';
        }
        return text.substring(0, MAX_CHARS);
      }
      if (['txt','md','csv'].includes(ext)) {
        return buffer.toString('utf8').substring(0, MAX_CHARS);
      }
      return `[Tipe tidak didukung: ${fileName}]`;
    } catch (e) {
      return `[Gagal membaca ${fileName}: ${e.message}]`;
    }
  }

  // ── Keyword extraction ────────────────────────────────────
  _extractKeywords(msg) {
    const stop = new Set([
      'yang','dan','atau','di','ke','dari','ini','itu','untuk','dengan','dalam',
      'pada','adalah','ada','jika','saya','kamu','tolong','apa','siapa','kapan',
      'bagaimana','berikan','tampilkan','tentang','terkait','mohon','bisa','boleh',
      'jelaskan','sesuai','level','tingkat','jabatan','posisi',
      'the','a','an','is','are','have','do','will','to','of','in','on','at','by',
      'for','with','about','from','what','how','show','me','tell','give','please',
      'find','get','provide',
    ]);
    return msg.toLowerCase()
      .replace(/[^\w\s\-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stop.has(w))
      .filter((w, i, a) => a.indexOf(w) === i);
  }

  // ── Score file by metadata + cached keywords ──────────────
  _scoreFile(file, keywords, cachedKws = []) {
    return odIndex.scoreFile(file, keywords, cachedKws);
  }

  // ── Get relevant folder prefixes ──────────────────────────
  _getRelevantFolderPrefixes(files, keywords) {
    const allPrefixes = new Set(
      files.map(f => (f.folderPath || '/').split('/')[0].toLowerCase())
    );
    const relevant = new Set();

    for (const kw of keywords) {
      for (const prefix of allPrefixes) {
        if (prefix.includes(kw)) relevant.add(prefix);
      }
      for (const fragment of (FOLDER_KEYWORD_MAP[kw] || [])) {
        for (const prefix of allPrefixes) {
          if (prefix.includes(fragment)) relevant.add(prefix);
        }
      }
    }
    return relevant;
  }

  // ── Force rebuild index (call e.g. from admin route) ──────
  async buildIndex(folderUrl) {
    const { driveId, folderPath } = await this.parseFolderUrl(folderUrl);
    odIndex.invalidate(this.tenantId, folderUrl);
    const files = await this._listFilesRecursive(driveId, folderPath);
    const hash  = odIndex.saveIndex(
      odIndex.hash(this.tenantId, folderUrl),
      folderUrl,
      files
    );
    return { hash, fileCount: files.length };
  }

  // ── Main context builder (INDEX-POWERED) ──────────────────
  async buildContext(folderUrl, userMessage) {
    try {
      // Step 1: get driveId (needed for content reads)
      const { driveId, folderPath } = await this.parseFolderUrl(folderUrl);

      // Step 2: get/refresh file list
      let { hash, index } = odIndex.loadIndex(this.tenantId, folderUrl);
      let allFiles;

      if (index && odIndex.isIndexFresh(index)) {
        allFiles = index.files;
        console.log(`[OneDrive] Using index (${allFiles.length} files, hash=${hash})`);
      } else {
        console.log(`[OneDrive] Index stale/missing — refreshing file list...`);
        allFiles = await this._listFilesRecursive(driveId, folderPath);
        hash     = odIndex.saveIndex(
          odIndex.hash(this.tenantId, folderUrl),
          folderUrl,
          allFiles
        );
        console.log(`[OneDrive] Index refreshed: ${allFiles.length} files`);
      }

      if (!allFiles.length) {
        return `\n\n=== 📁 ONEDRIVE ===\nFolder kosong atau tidak ada file yang didukung.\n=== AKHIR ONEDRIVE ===\n`;
      }

      // Step 3: score files by metadata + cached keywords
      const keywords = this._extractKeywords(userMessage);
      const scored   = allFiles.map(f => {
        const cachedKws = odIndex.getKeywords(hash, f.id);
        return { ...f, score: this._scoreFile(f, keywords, cachedKws) };
      }).sort((a, b) => b.score - a.score || new Date(b.lastModified) - new Date(a.lastModified));

      // Step 4: determine which files to read
      const relevantPrefixes = this._getRelevantFolderPrefixes(allFiles, keywords);
      let toFetch = [];

      if (relevantPrefixes.size > 0) {
        const folderMatches = scored.filter(f => {
          const prefix = (f.folderPath || '/').split('/')[0].toLowerCase();
          return relevantPrefixes.has(prefix);
        }).slice(0, 15);

        const otherMatches = scored.filter(f => {
          const prefix = (f.folderPath || '/').split('/')[0].toLowerCase();
          return !relevantPrefixes.has(prefix) && f.score > 0;
        }).slice(0, 5);

        toFetch = [...folderMatches, ...otherMatches];
        console.log(`[OneDrive] ${folderMatches.length} folder-match + ${otherMatches.length} other-match files to read`);
      } else {
        const hasScore = scored.some(f => f.score > 0);
        toFetch = hasScore ? scored.filter(f => f.score > 0).slice(0, 12) : scored.slice(0, 8);
        console.log(`[OneDrive] Fallback: reading top ${toFetch.length} files`);
      }

      // Step 5: build context
      let context  = `\n\n=== 📁 ONEDRIVE / SHAREPOINT ===\n`;
      context     += `Total file: ${allFiles.length} | Memuat konten: ${toFetch.length} file relevan\n\n`;

      // File list (just names, no content)
      context += `**Daftar File Tersedia:**\n`;
      for (const f of allFiles) {
        const sizeStr = f.size > 1_048_576
          ? `${(f.size / 1_048_576).toFixed(1)}MB`
          : `${Math.round(f.size / 1024)}KB`;
        const date = f.lastModified
          ? new Date(f.lastModified).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
          : '';
        const prefix = f.folderPath && f.folderPath !== '/'
          ? `📂 ${f.folderPath}/` : '';
        context += `📄 ${prefix}${f.name} (${sizeStr}${date ? ', ' + date : ''})\n`;
      }

      // Relevant file contents
      if (toFetch.length > 0) {
        context += `\n${'═'.repeat(60)}\n`;
        context += `ISI DOKUMEN RELEVAN (${toFetch.length} file)\n`;
        context += `${'═'.repeat(60)}\n`;
        context += `[INSTRUKSI WAJIB]: Jawab BERDASARKAN isi dokumen berikut secara SPESIFIK.\n`;
        context += `Sebutkan angka, spesifikasi, prosedur, persyaratan dari dokumen.\n`;
        context += `Cantumkan nama file sumber di akhir jawaban.\n\n`;

        let totalChars = 0;
        const MAX_TOTAL = 160_000;

        for (const file of toFetch) {
          if (totalChars >= MAX_TOTAL) {
            context += `\n[Budget konteks tercapai, ${toFetch.length - toFetch.indexOf(file)} file tidak ditampilkan]\n`;
            break;
          }

          let content = null;

          // Check content cache first
          if (odIndex.isContentFresh(hash, file.id, file.lastModified)) {
            content = odIndex.getContent(hash, file.id);
            if (content) {
              console.log(`[OneDrive] Cache hit: "${file.name}"`);
            }
          }

          // Fetch from OneDrive if not cached / stale
          if (!content) {
            try {
              console.log(`[OneDrive] Fetching: "${file.name}"...`);
              content = await this.readFileContent(driveId, file.id, file.name);
              odIndex.saveContent(hash, file.id, file.lastModified, content);
              console.log(`[OneDrive] Fetched & cached: "${file.name}" (${content.length} chars)`);
            } catch (e) {
              console.warn(`[OneDrive] Read failed "${file.name}": ${e.message}`);
              continue;
            }
          }

          const label = file.folderPath && file.folderPath !== '/'
            ? `${file.folderPath}/${file.name}` : file.name;
          const block = `\n${'─'.repeat(50)}\n📄 FILE: ${label}\n${'─'.repeat(50)}\n${content}\n`;
          context    += block;
          totalChars += block.length;
        }
      }

      context += `\n=== AKHIR ONEDRIVE ===\n`;
      return context;

    } catch (err) {
      console.error('[OneDrive] buildContext error:', err.message);
      return '';
    }
  }

  // ── Test connection ───────────────────────────────────────
  async testConnection(folderUrl) {
    await this.getAccessToken();
    const files = await this.listFiles(folderUrl);
    const stats = odIndex.getStats(this.tenantId, folderUrl);
    return {
      ok: true,
      fileCount: files.length,
      indexStats: stats,
      files: files.slice(0, 15).map(f => {
        const folder = f.folderPath && f.folderPath !== '/' ? `${f.folderPath}/` : '';
        return `${folder}${f.name}`;
      }),
      message: files.length === 0
        ? 'Koneksi berhasil, tapi tidak ada file yang didukung.'
        : `Berhasil menemukan ${files.length} file. Index: ${stats.totalKB}KB`,
    };
  }
}

export default OneDriveService;