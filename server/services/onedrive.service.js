// server/services/onedrive.service.js
// FIXES:
//   ✅ FIX 1: Keyword matching lebih toleran — partial match & substring
//   ✅ FIX 2: PDF threshold turun dari 20 → 5 char, clean text lebih agresif
//   ✅ FIX 3: MAX_FILES_TO_FETCH naik jadi 12, MAX_TOTAL_CHARS 150K, MAX_PER_FILE 40K
//   ✅ FIX 4: Instruksi AI jauh lebih tegas — wajib kutip isi dokumen
//   ✅ FIX 5: Fallback scoring: jika tidak ada folder match, tetap ambil semua file relevan
//   ✅ FIX 6: Context header lebih informatif — beritahu AI isi dokumen ADA
//   ✅ FIX 7: Hapus sparse PDF skip — tetap masukkan ke context walaupun terbatas
//   ✅ FIX 8: maxDepth dikurangi 5 → 3 agar tidak terlalu banyak API calls
//   ✅ FIX 9: Parallel file content fetch dengan timeout per-file (12 detik) dan global (20 detik)
//   ✅ FIX 10: Subfolder batch size naik 5 → 10 untuk traversal lebih cepat

import axios   from 'axios';
import odIndex from './onedrive-index.service.js';

const SUPPORTED_EXT = ['pdf','docx','doc','xlsx','xls','txt','csv','md','pptx','ppt'];

const FOLDER_KEYWORD_MAP = {
  // IT & Hardware
  'it':           ['it system', 'it', 'information technology'],
  'laptop':       ['it system', 'it', 'hardware', 'aset', 'asset', 'procurement', 'standarisasi', 'spesifikasi'],
  'komputer':     ['it system', 'it', 'hardware', 'aset'],
  'computer':     ['it system', 'it', 'hardware', 'asset'],
  'hardware':     ['it system', 'it', 'hardware', 'aset'],
  'software':     ['it system', 'it', 'software'],
  'network':      ['it system', 'it', 'network', 'jaringan'],
  'jaringan':     ['it system', 'it', 'network'],
  'server':       ['it system', 'it', 'server'],
  'email':        ['it system', 'it'],
  'sistem':       ['it system', 'it'],
  'system':       ['it system', 'it'],
  'spesifikasi':  ['it system', 'it', 'hardware', 'procurement', 'standarisasi'],
  'standarisasi': ['it system', 'it', 'hrga', 'standard', 'procurement'],
  'standard':     ['it system', 'it', 'hrga', 'standard'],
  'aset':         ['it system', 'it', 'asset', 'aset'],
  'asset':        ['it system', 'it', 'asset', 'aset'],
  'digital':      ['it system', 'it'],
  'data':         ['it system', 'it', 'finance', 'data'],
  'backup':       ['it system', 'it', 'backup'],
  'restore':      ['it system', 'it', 'backup'],
  'recovery':     ['it system', 'it'],
  'access':       ['it system', 'it', 'legal'],
  'akses':        ['it system', 'it', 'legal'],
  'keamanan':     ['it system', 'it', 'legal', 'security'],
  'security':     ['it system', 'it', 'security'],
  'pusat':        ['it system', 'it', 'data center'],
  'kebijakan':    ['policy', 'it system', 'it', 'hrga', 'legal', 'finance', 'procurement'],
  'policy':       ['policy', 'it system', 'it', 'hrga', 'legal', 'finance', 'procurement'],
  'pol':          ['policy', 'it system', 'it', 'hrga', 'legal', 'finance', 'procurement'],
  'prosedur':     ['procedure', 'it system', 'it', 'hrga', 'legal', 'finance', 'procurement'],
  'procedure':    ['procedure', 'it system', 'it', 'hrga', 'legal', 'finance', 'procurement'],
  'pro':          ['procedure', 'sop'],
  'sop':          ['procedure', 'sop', 'it system', 'it', 'hrga', 'legal', 'finance', 'procurement', 'sms', 'steel'],
  'standar':      ['it system', 'it', 'hrga', 'standard', 'procurement'],
  // HR
  'hr':           ['hrga'],
  'hrd':          ['hrga'],
  'hrga':         ['hrga'],
  'karyawan':     ['hrga'],
  'employee':     ['hrga'],
  'cuti':         ['hrga'],
  'recruitment':  ['hrga'],
  'gaji':         ['hrga'],
  'salary':       ['hrga'],
  'absensi':      ['hrga'],
  'attendance':   ['hrga'],
  'supervisor':   ['hrga', 'it system', 'it', 'standarisasi'],
  'staff':        ['hrga', 'it system'],
  'jabatan':      ['hrga'],
  // Finance
  'finance':      ['finance', 'accounting'],
  'keuangan':     ['finance', 'accounting'],
  'akuntansi':    ['finance', 'accounting'],
  'invoice':      ['finance', 'accounting'],
  'pembayaran':   ['finance', 'accounting'],
  'budget':       ['finance', 'accounting'],
  // Procurement
  'procurement':  ['procurement', 'prc'],
  'pengadaan':    ['procurement', 'prc'],
  'vendor':       ['procurement', 'prc'],
  'purchase':     ['procurement', 'prc'],
  // Quality
  'quality':      ['qaqc', 'qa', 'qc', 'iso'],
  'kualitas':     ['qaqc', 'qa', 'qc'],
  'iso':          ['iso', 'qaqc'],
  // Legal
  'legal':        ['legal', 'lgl'],
  'kontrak':      ['legal', 'lgl'],
  'contract':     ['legal', 'lgl'],
  // SCM
  'scm':          ['scm', 'gdu'],
  'logistik':     ['scm', 'gdu'],
  'warehouse':    ['scm', 'gdu'],
  'gudang':       ['scm', 'gdu'],
  // Sales
  'sales':        ['sales', 'sls'],
  'penjualan':    ['sales', 'sls'],
  // Steel / Production
  'steel':        ['sms', 'steel', 'production', 'manufaktur', 'pabrik'],
  'baja':         ['sms', 'steel', 'production', 'baja'],
  'sms':          ['sms', 'steel'],
  'melting':      ['sms', 'steel', 'melting'],
  'rolling':      ['rolling', 'steel', 'production'],
  'produksi':     ['production', 'sms', 'steel', 'manufaktur'],
  'production':   ['production', 'sms', 'steel'],
};

// ✅ FIX 3: Limit yang sudah dinaikkan
const MAX_TOTAL_CHARS    = 150_000;
const MAX_PER_FILE_CHARS = 40_000;
const MAX_FILES_TO_FETCH = 12;

// ✅ FIX 9: Timeout constants
const FETCH_TIMEOUT_PER_FILE_MS = 12_000;  // 12 detik per file
const FETCH_TIMEOUT_GLOBAL_MS   = 20_000;  // 20 detik total untuk semua file

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
      $top: 500,
    });
    return data.value || [];
  }

  // ✅ FIX 8: maxDepth default dikurangi dari 5 → 3
  // ✅ FIX 10: Subfolder batch size naik dari 5 → 10
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

    // ✅ FIX 10: Batch size naik ke 10
    for (let i = 0; i < subFolders.length; i += 10) {
      const chunk = subFolders.slice(i, i + 10);
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

  // ✅ FIX 8: listFiles juga pakai maxDepth=3
  async listFiles(folderUrl) {
    const { driveId, folderPath } = await this.parseFolderUrl(folderUrl);
    return await this._listFilesRecursive(driveId, folderPath, 0, 3);
  }

  // ── Content extraction ────────────────────────────────────
  async readFileContent(driveId, fileId, fileName) {
    const token = await this.getAccessToken();
    const ext   = (fileName || '').split('.').pop().toLowerCase();

    const directUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${fileId}/content`;
    let fileRes;

    try {
      console.log(`[OneDrive] Downloading: "${fileName}"...`);
      fileRes = await axios.get(directUrl, {
        responseType: 'arraybuffer',
        timeout: 60_000,
        maxRedirects: 10,
        headers: { Authorization: `Bearer ${token}`, Accept: '*/*' },
      });
      console.log(`[OneDrive] Download OK: "${fileName}" — ${fileRes.data.byteLength} bytes`);
    } catch (directErr) {
      console.warn(`[OneDrive] Direct failed for "${fileName}": ${directErr.message} — trying fallback...`);
      try {
        const meta = await this.graphGet(`/drives/${driveId}/items/${fileId}`, {
          $select: 'id,name,@microsoft.graph.downloadUrl',
        });
        const dlUrl = meta['@microsoft.graph.downloadUrl'];
        if (!dlUrl) throw new Error(`Tidak ada downloadUrl untuk "${fileName}"`);
        fileRes = await axios.get(dlUrl, {
          responseType: 'arraybuffer',
          timeout: 60_000,
          maxRedirects: 10,
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log(`[OneDrive] Fallback OK: "${fileName}" — ${fileRes.data.byteLength} bytes`);
      } catch (fallbackErr) {
        throw new Error(`Gagal download "${fileName}". Direct: ${directErr.message} | Fallback: ${fallbackErr.message}`);
      }
    }

    const buffer    = Buffer.from(fileRes.data);
    const MAX_CHARS = 80_000;

    try {
      if (ext === 'pdf') {
        const { default: pdfParse } = await import('pdf-parse');
        const data = await pdfParse(buffer, { max: 0 });
        const text = (data.text || '').trim();

        // ✅ FIX 2: Threshold turun dari 20 → 5 char
        if (!text || text.length < 5) {
          console.warn(`[OneDrive] PDF "${fileName}" — teks sangat minim (${text.length} chars), kemungkinan scan`);
          return `[PDF SCAN: "${fileName}" — ${data.numpages || '?'} halaman. Dokumen ini adalah scan/gambar dan tidak dapat diekstrak teksnya secara otomatis. Silakan buka dokumen langsung untuk melihat isinya.]`;
        }

        // ✅ FIX 2: Clean up extracted text lebih agresif
        const cleanedText = text
          .replace(/\n{3,}/g, '\n\n')
          .replace(/[ \t]{2,}/g, ' ')
          .replace(/\f/g, '\n\n--- HALAMAN BARU ---\n\n')
          .replace(/[^\S\n]+/g, ' ')
          .trim();

        console.log(`[OneDrive] PDF parsed: "${fileName}" — ${cleanedText.length} chars, ${data.numpages} pages`);
        return cleanedText.substring(0, MAX_CHARS);
      }

      if (['docx','doc'].includes(ext)) {
        const { default: mammoth } = await import('mammoth');
        const r = await mammoth.extractRawText({ buffer });
        const text = (r.value || '').trim();
        if (!text || text.length < 5) return `[DOCX "${fileName}" tidak ada teks yang dapat diekstrak]`;
        console.log(`[OneDrive] DOCX parsed: "${fileName}" — ${text.length} chars`);
        return text.substring(0, MAX_CHARS);
      }

      if (['xlsx','xls'].includes(ext)) {
        const { default: XLSX } = await import('xlsx');
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const text = wb.SheetNames.map(n => `[${n}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n');
        console.log(`[OneDrive] XLSX parsed: "${fileName}" — ${text.length} chars`);
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
        console.log(`[OneDrive] PPTX parsed: "${fileName}" — ${text.length} chars`);
        return text.substring(0, MAX_CHARS);
      }

      if (['txt','md','csv'].includes(ext)) {
        const text = buffer.toString('utf8');
        return text.substring(0, MAX_CHARS);
      }

      return `[Tipe tidak didukung: ${fileName}]`;
    } catch (parseErr) {
      console.error(`[OneDrive] Parse error "${fileName}": ${parseErr.message}`);
      return `[File "${fileName}" gagal diparsing: ${parseErr.message}]`;
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  _extractKeywords(msg) {
    const stop = new Set([
      'yang','dan','atau','di','ke','dari','ini','itu','untuk','dengan','dalam',
      'pada','adalah','ada','jika','saya','kamu','tolong','apa','siapa','kapan',
      'bagaimana','berikan','tampilkan','tentang','terkait','mohon','bisa','boleh',
      'jelaskan','ceritakan','tolong','please','the','a','an','is','are',
      'have','do','will','to','of','in','on','at','by','for','with','about','from',
      'what','how','show','me','tell','give','please','find','get','provide',
      'sebutkan','jelaskan','berikan','apa','saja','dan','bagaimana','cara',
    ]);
    return msg.toLowerCase()
      .replace(/[^\w\s\-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stop.has(w))
      .filter((w, i, a) => a.indexOf(w) === i);
  }

  _scoreFile(file, keywords, cachedKws = []) {
    return odIndex.scoreFile(file, keywords, cachedKws);
  }

  // ✅ FIX 1: Keyword matching jauh lebih toleran — gunakan substring + partial match
  _getRelevantFolderPrefixes(files, keywords) {
    const allFolderPaths = new Set(
      files.map(f => (f.folderPath || '/').toLowerCase())
    );

    const relevant = new Set();

    for (const kw of keywords) {
      for (const folderPath of allFolderPaths) {
        const segments = folderPath.split('/').filter(Boolean);

        // ✅ FIX: gunakan includes() bukan === agar partial match bekerja
        if (segments.some(seg => seg.includes(kw) || kw.includes(seg))) {
          relevant.add(folderPath);
        }

        if (folderPath.includes(kw)) {
          relevant.add(folderPath);
        }
      }

      // Cek alias dari FOLDER_KEYWORD_MAP
      const mappedFragments = FOLDER_KEYWORD_MAP[kw] || [];
      for (const fragment of mappedFragments) {
        for (const folderPath of allFolderPaths) {
          const segments = folderPath.split('/').filter(Boolean);
          if (segments.some(seg => seg.includes(fragment) || fragment.includes(seg))) {
            relevant.add(folderPath);
          }
          if (folderPath.includes(fragment)) {
            relevant.add(folderPath);
          }
        }
      }
    }

    return relevant;
  }

  // ✅ FIX 1b: Score file berdasarkan nama file juga
  _scoreFileByName(file, keywords) {
    const nameLower = file.name.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (nameLower.includes(kw)) score += 15;
      const aliases = FOLDER_KEYWORD_MAP[kw] || [];
      for (const alias of aliases) {
        if (nameLower.includes(alias)) score += 8;
      }
    }
    return score;
  }

  async buildIndex(folderUrl) {
    const { driveId, folderPath } = await this.parseFolderUrl(folderUrl);
    odIndex.invalidate(this.tenantId, folderUrl);
    const files = await this._listFilesRecursive(driveId, folderPath);
    const hash  = odIndex.saveIndex(odIndex.hash(this.tenantId, folderUrl), folderUrl, files);
    return { hash, fileCount: files.length };
  }

  // ── Main context builder ──────────────────────────────────
  async buildContext(folderUrl, userMessage) {
    // ✅ FIX 9: Track overall start time
    const overallStartTime = Date.now();

    try {
      const { driveId, folderPath } = await this.parseFolderUrl(folderUrl);

      // Step 1: get/refresh file list
      let { hash, index } = odIndex.loadIndex(this.tenantId, folderUrl);
      let allFiles;

      if (index && odIndex.isIndexFresh(index)) {
        allFiles = index.files;
        console.log(`[OneDrive] Using cached index (${allFiles.length} files)`);
      } else {
        console.log(`[OneDrive] Index stale/missing — refreshing...`);
        allFiles = await this._listFilesRecursive(driveId, folderPath, 0, 3);
        hash     = odIndex.saveIndex(odIndex.hash(this.tenantId, folderUrl), folderUrl, allFiles);
        console.log(`[OneDrive] Index refreshed: ${allFiles.length} files`);
      }

      if (!allFiles.length) {
        return '';
      }

      // Step 2: extract keywords & score files
      const keywords = this._extractKeywords(userMessage);
      console.log(`[OneDrive] Search keywords: [${keywords.join(', ')}]`);

      // ✅ FIX: Score berdasarkan NAMA FILE juga, bukan hanya folder + cached keywords
      const scored = allFiles.map(f => {
        const cachedKws  = odIndex.getKeywords(hash, f.id);
        const folderScore = this._scoreFile(f, keywords, cachedKws);
        const nameScore   = this._scoreFileByName(f, keywords);
        return { ...f, score: folderScore + nameScore };
      }).sort((a, b) => b.score - a.score || new Date(b.lastModified) - new Date(a.lastModified));

      // Step 3: ✅ FIX — gunakan full path matching dengan substring
      const relevantFolderPaths = this._getRelevantFolderPrefixes(allFiles, keywords);
      let toFetch = [];

      console.log(`[OneDrive] Relevant folder paths found: ${relevantFolderPaths.size}`);
      if (relevantFolderPaths.size > 0) {
        console.log(`[OneDrive] Relevant paths:`, [...relevantFolderPaths].slice(0, 5));
      }

      if (relevantFolderPaths.size > 0) {
        const folderFiltered = scored.filter(f => {
          const fullPath = (f.folderPath || '/').toLowerCase();
          return relevantFolderPaths.has(fullPath);
        });

        console.log(`[OneDrive] Folder-match: ${folderFiltered.length} files in relevant folders`);

        const highScoreFromFolder = folderFiltered.slice(0, MAX_FILES_TO_FETCH);
        const highScoreByName = scored.filter(f => {
          const nameScore = this._scoreFileByName(f, keywords);
          return nameScore > 0;
        }).slice(0, Math.ceil(MAX_FILES_TO_FETCH / 2));

        const seen = new Set();
        for (const f of [...highScoreFromFolder, ...highScoreByName]) {
          if (!seen.has(f.id)) {
            seen.add(f.id);
            toFetch.push(f);
          }
          if (toFetch.length >= MAX_FILES_TO_FETCH) break;
        }

        if (toFetch.length < MAX_FILES_TO_FETCH) {
          for (const f of folderFiltered) {
            if (!seen.has(f.id)) {
              seen.add(f.id);
              toFetch.push(f);
            }
            if (toFetch.length >= MAX_FILES_TO_FETCH) break;
          }
        }

      } else {
        const byNameScore = scored.filter(f => this._scoreFileByName(f, keywords) > 0);

        if (byNameScore.length > 0) {
          toFetch = byNameScore.slice(0, MAX_FILES_TO_FETCH);
          console.log(`[OneDrive] Fallback: ${toFetch.length} files by name score`);
        } else if (scored.filter(f => f.score > 0).length > 0) {
          toFetch = scored.filter(f => f.score > 0).slice(0, MAX_FILES_TO_FETCH);
          console.log(`[OneDrive] Fallback: ${toFetch.length} files by combined score`);
        } else {
          toFetch = scored.slice(0, MAX_FILES_TO_FETCH);
          console.log(`[OneDrive] Last resort: ${toFetch.length} most recent files`);
        }
      }

      if (!toFetch.length) return '';

      console.log(`[OneDrive] Files to fetch (${toFetch.length}):`);
      toFetch.forEach((f, i) => console.log(`  ${i+1}. [score:${f.score}] ${f.folderPath}/${f.name}`));

      // Step 4: build context header
      // ✅ FIX 4 & 6: Instruksi AI jauh lebih tegas
      let context  = `\n\n=== DOKUMEN INTERNAL PT GARUDA YAMATO STEEL ===\n`;
      context     += `Query user: "${userMessage}"\n`;
      context     += `Keywords pencarian: [${keywords.join(', ')}]\n`;
      context     += `Dokumen yang ditemukan dan sudah dibaca: ${toFetch.length} file\n\n`;
      context     += `⚠️ INSTRUKSI WAJIB UNTUK AI:\n`;
      context     += `1. Konten dokumen sudah tersedia lengkap di bawah ini. BACA dan KUTIP isinya.\n`;
      context     += `2. JANGAN katakan "tidak menemukan informasi" jika konten dokumen sudah ada di bawah.\n`;
      context     += `3. JAWAB secara DETAIL dan LENGKAP berdasarkan ISI DOKUMEN — bukan hanya menyebut nama file.\n`;
      context     += `4. KUTIP bagian-bagian penting dari dokumen secara langsung.\n`;
      context     += `5. Jika ada nomor kebijakan/SOP/prosedur, sebutkan secara eksplisit.\n`;
      context     += `6. Struktur jawaban dengan heading yang jelas.\n\n`;

      // ✅ FIX 9: PARALLEL fetch dengan timeout per-file dan global deadline
      console.log(`[OneDrive] Starting parallel fetch for ${toFetch.length} files...`);
      const fetchDeadline = Date.now() + FETCH_TIMEOUT_GLOBAL_MS;

      const fetchResults = await Promise.allSettled(
        toFetch.map(async (file) => {
          // Cek apakah masih dalam budget waktu global
          if (Date.now() > fetchDeadline) {
            console.warn(`[OneDrive] Global timeout reached, skipping "${file.name}"`);
            return { file, content: `[SKIP: global timeout tercapai untuk "${file.name}"]`, fromCache: false, skipped: true };
          }

          // ── Cek cache dulu (sangat cepat, tidak perlu timeout) ──
          if (odIndex.isContentFresh(hash, file.id, file.lastModified)) {
            const cached = odIndex.getContent(hash, file.id);
            if (cached) {
              console.log(`[OneDrive] Cache hit: "${file.name}" (${cached.length} chars)`);
              return { file, content: cached, fromCache: true, skipped: false };
            }
          }

          // ── Fetch dari OneDrive dengan per-file timeout ──
          const fetchWithTimeout = new Promise(async (resolve) => {
            const timer = setTimeout(() => {
              console.warn(`[OneDrive] Per-file timeout (${FETCH_TIMEOUT_PER_FILE_MS}ms) for "${file.name}"`);
              resolve({ file, content: `[TIMEOUT: "${file.name}" tidak merespons dalam ${FETCH_TIMEOUT_PER_FILE_MS/1000} detik]`, fromCache: false, skipped: true });
            }, FETCH_TIMEOUT_PER_FILE_MS);

            try {
              const content = await this.readFileContent(driveId, file.id, file.name);
              clearTimeout(timer);

              const isScanPdf = content?.startsWith('[PDF SCAN:');
              if (content && content.length > 5 && !isScanPdf) {
                odIndex.saveContent(hash, file.id, file.lastModified, content);
                console.log(`[OneDrive] ✅ Fetched & cached: "${file.name}" (${content.length} chars)`);
              } else if (isScanPdf) {
                console.log(`[OneDrive] ⚠️ Scan PDF: "${file.name}" — tetap ditampilkan`);
              }

              resolve({ file, content: content || '', fromCache: false, skipped: false });
            } catch (e) {
              clearTimeout(timer);
              console.error(`[OneDrive] ❌ Failed "${file.name}": ${e.message}`);
              resolve({ file, content: `[GAGAL MEMBACA: ${e.message}]`, fromCache: false, skipped: false });
            }
          });

          return fetchWithTimeout;
        })
      );

      // ── Build context dari hasil parallel fetch ──
      let totalChars   = 0;
      let fetchSuccess = 0;
      let fetchFail    = 0;
      let fetchSkipped = 0;

      for (const result of fetchResults) {
        if (totalChars >= MAX_TOTAL_CHARS) {
          context += `\n[Budget konteks tercapai — file sisanya tidak ditampilkan]\n`;
          break;
        }

        const { file, content, fromCache, skipped } = result.status === 'fulfilled'
          ? result.value
          : { file: {}, content: '[Promise rejected]', fromCache: false, skipped: false };

        if (skipped) {
          fetchSkipped++;
          continue; // Jangan masukkan ke context jika di-skip karena timeout
        }

        const isError = content.startsWith('[GAGAL') || content.startsWith('[TIMEOUT') || content.startsWith('[ERROR') || content.startsWith('[SKIP');

        if (!isError) {
          fetchSuccess++;
        } else {
          fetchFail++;
          continue; // Skip error entries dari context
        }

        // Truncate jika terlalu panjang
        const truncated = content.length > MAX_PER_FILE_CHARS
          ? content.substring(0, MAX_PER_FILE_CHARS) + `\n\n[... konten dipotong — ${content.length - MAX_PER_FILE_CHARS} chars tidak ditampilkan]`
          : content;

        const label = file.folderPath && file.folderPath !== '/'
          ? `${file.folderPath}/${file.name}` : (file.name || 'unknown');

        const cacheLabel = fromCache ? ' [cache]' : ' [fresh]';
        const scoreLabel = file.score > 0 ? ` [skor:${file.score}]` : '';

        context += `${'═'.repeat(70)}\n`;
        context += `📄 DOKUMEN: ${label}${cacheLabel}${scoreLabel}\n`;
        context += `${'═'.repeat(70)}\n`;
        context += `${truncated}\n\n`;

        totalChars += truncated.length;
      }

      context += `\n${'═'.repeat(70)}\n`;
      context += `=== AKHIR DOKUMEN INTERNAL ===\n\n`;
      context += `PENGINGAT: Jawab pertanyaan "${userMessage}" secara LENGKAP dan DETAIL `;
      context += `berdasarkan konten dokumen di atas. Kutip informasi spesifik dari dokumen. `;
      context += `Jangan lewatkan detail penting seperti nomor kebijakan, prosedur, atau persyaratan.\n`;

      const elapsedMs = Date.now() - overallStartTime;
      console.log(`[OneDrive] buildContext selesai dalam ${elapsedMs}ms — success: ${fetchSuccess}, fail: ${fetchFail}, skipped: ${fetchSkipped}, chars: ${totalChars}`);

      return context;

    } catch (err) {
      const elapsedMs = Date.now() - overallStartTime;
      console.error(`[OneDrive] buildContext error setelah ${elapsedMs}ms:`, err.message);
      return '';
    }
  }

  // ── Test connection ───────────────────────────────────────
  async testConnection(folderUrl) {
    await this.getAccessToken();
    const files = await this.listFiles(folderUrl);
    const stats = odIndex.getStats(this.tenantId, folderUrl);
    let readTestResult = 'Tidak diuji';
    if (files.length > 0) {
      const { driveId } = await this.parseFolderUrl(folderUrl);
      try {
        const testFile    = files[0];
        const testContent = await this.readFileContent(driveId, testFile.id, testFile.name);
        readTestResult = testContent && !testContent.startsWith('[') && testContent.length > 50
          ? `✅ OK — "${testFile.name}" (${testContent.length} chars)`
          : `⚠️ Konten terbatas: ${testContent?.substring(0, 100)}`;
      } catch (e) {
        readTestResult = `❌ GAGAL: ${e.message}`;
      }
    }
    return {
      ok: true,
      fileCount: files.length,
      indexStats: stats,
      readTest: readTestResult,
      files: files.slice(0, 15).map(f => {
        const folder = f.folderPath && f.folderPath !== '/' ? `${f.folderPath}/` : '';
        return `${folder}${f.name}`;
      }),
      message: `${files.length} file ditemukan. Read test: ${readTestResult}`,
    };
  }
}

export default OneDriveService;
