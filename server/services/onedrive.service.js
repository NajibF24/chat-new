// server/services/onedrive.service.js
// ROOT CAUSE FIX:
//   File "001.POL.IT.GYS-IT Hardware.pdf" has score=0 for query "laptop supervisor"
//   because neither word appears in the filename.
//   Old fallback: only read 5 newest files → wrong files → generic answer.
//
// FIX: Score by FOLDER PATH using a keyword→folder map.
//   "laptop" → maps to IT folder → reads ALL files in IT folder.
//   This way the IT Hardware policy gets read even though its name has no "laptop".

import axios from 'axios';

const SUPPORTED_EXT = ['pdf','docx','doc','xlsx','xls','txt','csv','md','pptx','ppt'];

// Maps query keywords → folder name fragments to look for
const FOLDER_KEYWORD_MAP = {
  // IT
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
  // HRGA
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
  // Finance
  'finance':    ['finance', 'accounting'],
  'keuangan':   ['finance', 'accounting'],
  'akuntansi':  ['finance', 'accounting'],
  'invoice':    ['finance', 'accounting'],
  'pembayaran': ['finance', 'accounting'],
  'budget':     ['finance', 'accounting'],
  // Procurement
  'procurement':['procurement', 'prc'],
  'pengadaan':  ['procurement', 'prc'],
  'vendor':     ['procurement', 'prc'],
  'purchase':   ['procurement', 'prc'],
  // QA/QC
  'quality':    ['qaqc', 'qa', 'qc', 'iso'],
  'kualitas':   ['qaqc', 'qa', 'qc'],
  'iso':        ['iso', 'qaqc'],
  // Legal
  'legal':      ['legal', 'lgl'],
  'kontrak':    ['legal', 'lgl'],
  'contract':   ['legal', 'lgl'],
  // SCM
  'scm':        ['scm', 'gdu'],
  'logistik':   ['scm', 'gdu'],
  'warehouse':  ['scm', 'gdu'],
  'gudang':     ['scm', 'gdu'],
  // Sales
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
      const r = await axios.post(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      });
      this.accessToken = r.data.access_token;
      this.tokenExpiry = Date.now() + r.data.expires_in * 1000;
      return this.accessToken;
    } catch (err) {
      throw new Error(`Azure AD auth failed: ${err.response?.data?.error_description || err.message}`);
    }
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
            id: item.id, name: item.name, size: item.size || 0,
            lastModified: item.lastModifiedDateTime,
            webUrl: item.webUrl, folderPath: folderPath || '/',
          });
        }
      } else if (item.folder && depth < maxDepth) {
        subFolders.push(item.name);
      }
    }
    for (let i = 0; i < subFolders.length; i += 5) {
      const chunk = subFolders.slice(i, i + 5);
      const results = await Promise.allSettled(
        chunk.map(name => this._listFilesRecursive(driveId, folderPath ? `${folderPath}/${name}` : name, depth + 1, maxDepth))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') files.push(...r.value);
      }
    }
    return files;
  }

  async listFiles(folderUrl) {
    const { driveId, folderPath } = await this.parseFolderUrl(folderUrl);
    return await this._listFilesRecursive(driveId, folderPath);
  }

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
    const buffer   = Buffer.from(fileRes.data);
    const MAX_CHARS = 80_000;

    try {
      if (ext === 'pdf') {
        const { default: pdfParse } = await import('pdf-parse');
        const data = await pdfParse(buffer);
        console.log(`[OneDrive] PDF "${fileName}": ${(data.text||'').length} chars`);
        return (data.text || '').substring(0, MAX_CHARS);
      }
      if (['docx','doc'].includes(ext)) {
        const { default: mammoth } = await import('mammoth');
        const r = await mammoth.extractRawText({ buffer });
        console.log(`[OneDrive] DOCX "${fileName}": ${(r.value||'').length} chars`);
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

  // Score a file using BOTH filename AND folder path
  _scoreFile(file, keywords) {
    const name   = file.name.toLowerCase();
    const folder = (file.folderPath || '').toLowerCase();
    let score = 0;

    for (const kw of keywords) {
      if (name.includes(kw))   score += 8;
      if (folder.includes(kw)) score += 4;

      // Check keyword→folder mapping
      for (const fragment of (FOLDER_KEYWORD_MAP[kw] || [])) {
        if (folder.includes(fragment)) { score += 6; break; }
      }

      // Partial word match in name
      const parts = name.split(/[\s\-_.()]+/);
      if (parts.some(p => p === kw || p.startsWith(kw))) score += 3;
    }
    return score;
  }

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

  // Find which folder categories are relevant for the query
  _getRelevantFolderPrefixes(files, keywords) {
    const allFolderPrefixes = new Set(
      files.map(f => (f.folderPath || '/').split('/')[0].toLowerCase())
    );
    const relevant = new Set();

    for (const kw of keywords) {
      // Direct folder name contains keyword
      for (const prefix of allFolderPrefixes) {
        if (prefix.includes(kw)) relevant.add(prefix);
      }
      // Keyword→folder mapping
      for (const fragment of (FOLDER_KEYWORD_MAP[kw] || [])) {
        for (const prefix of allFolderPrefixes) {
          if (prefix.includes(fragment)) relevant.add(prefix);
        }
      }
    }
    return relevant;
  }

  async buildContext(folderUrl, userMessage) {
    try {
      const files = await this.listFiles(folderUrl);
      if (!files.length) {
        return `\n\n=== 📁 ONEDRIVE ===\nFolder kosong.\n=== AKHIR ONEDRIVE ===\n`;
      }

      const keywords = this._extractKeywords(userMessage);
      console.log(`[OneDrive] Keywords: [${keywords.join(', ')}] | Files: ${files.length}`);

      // Score all files
      const scored = files.map(f => ({ ...f, score: this._scoreFile(f, keywords) }))
        .sort((a, b) => b.score - a.score || new Date(b.lastModified) - new Date(a.lastModified));

      // Find relevant folder prefixes (top-level folder names)
      const relevantPrefixes = this._getRelevantFolderPrefixes(files, keywords);
      console.log(`[OneDrive] Relevant folder prefixes: [${[...relevantPrefixes].join(', ')}]`);

      let toRead = [];

      if (relevantPrefixes.size > 0) {
        // Read ALL files from matched folders
        const folderFiles = scored.filter(f => {
          const prefix = (f.folderPath || '/').split('/')[0].toLowerCase();
          return relevantPrefixes.has(prefix);
        });
        // Plus top-scored files from other folders
        const otherFiles = scored.filter(f => {
          const prefix = (f.folderPath || '/').split('/')[0].toLowerCase();
          return !relevantPrefixes.has(prefix) && f.score > 0;
        }).slice(0, 5);

        toRead = [...folderFiles, ...otherFiles].slice(0, 20);
        console.log(`[OneDrive] Reading ${folderFiles.length} folder-matched + ${Math.min(otherFiles.length,5)} other files`);
      } else {
        // Fallback: top scored, or newest
        const hasScore = scored.some(f => f.score > 0);
        toRead = hasScore ? scored.filter(f => f.score > 0).slice(0, 15) : scored.slice(0, 10);
        console.log(`[OneDrive] Fallback: reading top ${toRead.length} files`);
      }

      let context = `\n\n=== 📁 ONEDRIVE / SHAREPOINT ===\n`;
      context    += `Total file tersedia: ${files.length} | Membaca: ${toRead.length} file relevan\n\n`;

      context += `**Daftar Semua File:**\n`;
      for (const f of files) {
        const size = f.size > 1_048_576
          ? `${(f.size/1_048_576).toFixed(1)} MB` : `${Math.round(f.size/1024)} KB`;
        const date = new Date(f.lastModified).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
        const p    = f.folderPath && f.folderPath !== '/' ? `📂 ${f.folderPath}/` : '';
        context   += `📄 ${p}${f.name} (${size}, ${date})\n`;
      }

      if (toRead.length > 0) {
        context += `\n${'═'.repeat(60)}\n`;
        context += `ISI DOKUMEN RELEVAN (${toRead.length} file)\n`;
        context += `${'═'.repeat(60)}\n`;
        context += `
[INSTRUKSI WAJIB UNTUK AI]:
Berikut adalah ISI LENGKAP dari dokumen-dokumen yang relevan dengan pertanyaan user.
WAJIB menjawab BERDASARKAN isi dokumen berikut ini secara SPESIFIK dan DETAIL.
Sebutkan spesifikasi, angka, persyaratan, prosedur secara lengkap dari dokumen.
DILARANG menjawab dengan kalimat generik seperti "silakan hubungi IT" atau "lihat dokumen".
Jika ada spesifikasi laptop/perangkat → sebutkan merk, RAM, storage, processor, dll.
Cantumkan nama file sumber di akhir jawaban.
\n`;

        const { driveId } = await this.parseFolderUrl(folderUrl);
        let totalChars = 0;
        const MAX_TOTAL = 200_000;

        for (const file of toRead) {
          if (totalChars >= MAX_TOTAL) {
            context += `\n[Budget konteks tercapai]\n`;
            break;
          }
          try {
            const content = await this.readFileContent(driveId, file.id, file.name);
            const label   = file.folderPath && file.folderPath !== '/'
              ? `${file.folderPath}/${file.name}` : file.name;
            const block   = `\n${'─'.repeat(60)}\n📄 FILE: ${label}\n${'─'.repeat(60)}\n${content}\n`;
            context      += block;
            totalChars   += block.length;
            console.log(`[OneDrive] ✅ "${file.name}": ${content.length} chars (total: ${totalChars})`);
          } catch (e) {
            context += `\n[❌ Gagal baca "${file.name}": ${e.message}]\n`;
          }
        }
      }

      context += `\n=== AKHIR ONEDRIVE ===\n`;
      return context;

    } catch (err) {
      console.error('[OneDrive] buildContext error:', err.message);
      return '';
    }
  }

  async testConnection(folderUrl) {
    await this.getAccessToken();
    const files = await this.listFiles(folderUrl);
    return {
      ok: true,
      fileCount: files.length,
      files: files.slice(0, 15).map(f => {
        const folder = f.folderPath && f.folderPath !== '/' ? `${f.folderPath}/` : '';
        return `${folder}${f.name}`;
      }),
      message: files.length === 0
        ? 'Koneksi berhasil, tapi tidak ada file yang didukung.'
        : `Berhasil menemukan ${files.length} file.`,
    };
  }
}

export default OneDriveService;
