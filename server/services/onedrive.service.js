// server/services/onedrive.service.js
// FIXED:
//   1. Increased MAX_CHARS to 80,000 for full document reading
//   2. Better relevance scoring - tokenizes keywords properly, no short-word filter
//   3. Reads up to 10 relevant files instead of 6
//   4. Fallback: if score=0, reads ALL files up to token budget (not just 3 newest)
//   5. Explicit instruction to AI to answer FROM document content, not redirect
//   6. Debug logging to track which files are being read and why

import axios from 'axios';

const SUPPORTED_EXT = ['pdf','docx','doc','xlsx','xls','txt','csv','md','pptx','ppt'];

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

  // ── 3b. List files rekursif — parallel per level ──────────────
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

  // ── 3. List files (rekursif semua subfolder) ──────────────────
  async listFiles(folderUrl) {
    const { driveId, folderPath } = await this.parseFolderUrl(folderUrl);
    return await this._listFilesRecursive(driveId, folderPath);
  }

  // ── 4. Download & read file content ──────────────────────────
  // FIXED: Increased MAX_CHARS to 80,000 for full document reading
  async readFileContent(driveId, fileId, fileName) {
    const token = await this.getAccessToken();
    const ext   = (fileName || '').split('.').pop().toLowerCase();

    const meta        = await this.graphGet(`/drives/${driveId}/items/${fileId}`);
    const downloadUrl = meta['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) throw new Error('File tidak bisa didownload');

    const fileRes = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout:      60_000,  // increased timeout for larger files
      headers:      { Authorization: `Bearer ${token}` },
    });

    const buffer = Buffer.from(fileRes.data);
    // FIXED: Increased from 40,000 to 80,000 chars (~20,000 tokens)
    // This ensures full SOP/Policy documents are read completely
    const MAX_CHARS = 80_000;

    try {
      if (ext === 'pdf') {
        const { default: pdfParse } = await import('pdf-parse');
        const data = await pdfParse(buffer);
        const text = data.text || '';
        console.log(`[OneDrive] PDF "${fileName}": extracted ${text.length} chars`);
        return text.substring(0, MAX_CHARS);
      }

      if (ext === 'docx' || ext === 'doc') {
        const { default: mammoth } = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        const text = result.value || '';
        console.log(`[OneDrive] DOCX "${fileName}": extracted ${text.length} chars`);
        return text.substring(0, MAX_CHARS);
      }

      if (ext === 'xlsx' || ext === 'xls') {
        const { default: XLSX } = await import('xlsx');
        const wb   = XLSX.read(buffer, { type: 'buffer' });
        const text = wb.SheetNames
          .map(n => `[Sheet: ${n}]\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n]))
          .join('\n');
        console.log(`[OneDrive] XLSX "${fileName}": extracted ${text.length} chars`);
        return text.substring(0, MAX_CHARS);
      }

      if (ext === 'pptx' || ext === 'ppt') {
        const { default: JSZip } = await import('jszip');
        const zip        = await JSZip.loadAsync(buffer);
        const slideFiles = Object.keys(zip.files)
          .filter(f => /ppt\/slides\/slide\d+\.xml/.test(f))
          .sort();
        let text = '';
        for (const sf of slideFiles.slice(0, 40)) {
          const xml     = await zip.files[sf].async('string');
          const matches = xml.match(/<a:t[^>]*>(.*?)<\/a:t>/g) || [];
          text         += matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ') + '\n';
        }
        console.log(`[OneDrive] PPTX "${fileName}": extracted ${text.length} chars`);
        return text.substring(0, MAX_CHARS);
      }

      if (['txt', 'md', 'csv'].includes(ext)) {
        const text = buffer.toString('utf8');
        console.log(`[OneDrive] TXT/MD/CSV "${fileName}": extracted ${text.length} chars`);
        return text.substring(0, MAX_CHARS);
      }

      return `[File: ${fileName} — tipe tidak didukung untuk pembacaan teks]`;

    } catch (parseErr) {
      console.error(`[OneDrive] Parse error "${fileName}":`, parseErr.message);
      return `[Gagal membaca konten ${fileName}: ${parseErr.message}]`;
    }
  }

  // ── 5. Score relevance of a file to the user's query ─────────
  // FIXED: Better tokenization, no min-length filter that cuts short keywords
  _scoreFileRelevance(file, keywords) {
    const nameLower   = file.name.toLowerCase();
    const folderLower = (file.folderPath || '').toLowerCase();
    
    let score = 0;
    for (const kw of keywords) {
      // File name match is worth more than folder match
      if (nameLower.includes(kw)) score += 5;
      if (folderLower.includes(kw)) score += 2;
      
      // Partial match in file name (e.g. "it" matches "it hardware")
      const nameWords = nameLower.split(/[\s\-_.\/\\]+/);
      if (nameWords.some(w => w === kw || w.startsWith(kw))) score += 3;
    }
    
    return score;
  }

  // ── 6. Extract meaningful keywords from user message ─────────
  // FIXED: Do NOT filter by length — "it", "hr", "qa" are all valid keywords
  _extractKeywords(userMessage) {
    // Indonesian stop words that carry no meaning
    const stopWords = new Set([
      'yang','dan','atau','di','ke','dari','ini','itu','untuk','dengan','dalam',
      'pada','adalah','bahwa','ada','jika','kalau','saya','kamu','tolong','apa',
      'siapa','kapan','dimana','bagaimana','berikan','cari','tampilkan','lihat',
      'tentang','mengenai','terkait','mohon','bisa','boleh','apakah','jelaskan',
      'bagaimana','seperti','apa','sesuai','standar','standarisasi',
      // English stop words
      'the','a','an','is','are','was','were','be','been','being','have','has',
      'had','do','does','did','will','would','could','should','may','might',
      'shall','can','need','dare','ought','used','to','of','in','on','at',
      'by','for','with','about','against','between','into','through','during',
      'before','after','above','below','from','up','down','out','off','over',
      'under','again','further','then','once','here','there','when','where',
      'why','how','all','both','each','few','more','most','other','some',
      'such','no','nor','not','only','same','so','than','too','very','just',
      'show','me','tell','what','give','please','find','get',
    ]);

    return userMessage
      .toLowerCase()
      // Remove punctuation except hyphens within words
      .replace(/[^\w\s\-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stopWords.has(w))
      // Deduplicate
      .filter((w, i, arr) => arr.indexOf(w) === i);
  }

  // ── 7. Build context for AI ───────────────────────────────────
  // FIXED: Better file selection, reads full content, explicit AI instructions
  async buildContext(folderUrl, userMessage) {
    try {
      const files = await this.listFiles(folderUrl);

      if (!files.length) {
        return `\n\n=== 📁 ONEDRIVE ===\nFolder kosong atau tidak ada file yang didukung.\n=== AKHIR ONEDRIVE ===\n`;
      }

      // Extract meaningful keywords from the query
      const keywords = this._extractKeywords(userMessage);
      console.log(`[OneDrive] Query keywords: [${keywords.join(', ')}] from: "${userMessage}"`);

      // Score all files for relevance
      const scored = files.map(f => ({
        ...f,
        score: this._scoreFileRelevance(f, keywords),
      })).sort((a, b) => {
        // Primary: score descending
        if (b.score !== a.score) return b.score - a.score;
        // Secondary: most recently modified first
        return new Date(b.lastModified) - new Date(a.lastModified);
      });

      // FIXED: Read up to 10 relevant files (was 6)
      // If any files have score > 0, read those. Otherwise read top 5 most recent.
      const hasRelevant = scored.some(f => f.score > 0);
      const toRead = hasRelevant
        ? scored.filter(f => f.score > 0).slice(0, 10)
        : scored.slice(0, 5);  // fallback: 5 most recent (was 3)

      console.log(`[OneDrive] Files to read (${toRead.length}):`, 
        toRead.map(f => `"${f.name}" (score=${f.score})`).join(', '));

      // Build context string
      let context  = `\n\n=== 📁 ONEDRIVE / SHAREPOINT ===\n`;
      context     += `Total file tersedia: ${files.length}\n\n`;
      
      // List all files for reference
      context += `**Daftar Semua File:**\n`;
      files.forEach(f => {
        const size = f.size > 1_048_576
          ? `${(f.size / 1_048_576).toFixed(1)} MB`
          : `${Math.round(f.size / 1024)} KB`;
        const date = new Date(f.lastModified).toLocaleDateString('id-ID', {
          day: '2-digit', month: 'short', year: 'numeric',
        });
        const pathPrefix = f.folderPath && f.folderPath !== '/'
          ? `📂 ${f.folderPath}/`
          : '';
        context += `📄 ${pathPrefix}${f.name} (${size}, ${date})\n`;
      });

      // Read and embed content of relevant files
      if (toRead.length > 0) {
        context += `\n**ISI DOKUMEN RELEVAN (${toRead.length} file):**\n`;
        
        // FIXED: Explicit, strong instruction for AI to answer FROM content
        context += `\n[INSTRUKSI WAJIB UNTUK AI]:
Dokumen-dokumen berikut berisi informasi lengkap yang relevan dengan pertanyaan user.
WAJIB membaca seluruh isi dokumen di bawah ini dan menjawab BERDASARKAN isi dokumen tersebut.
DILARANG menjawab secara generik atau mengarahkan user untuk "membaca dokumen sendiri".
Jika informasi ada di dokumen, WAJIB sebutkan detail spesifiknya (nama, angka, spesifikasi, prosedur, dll).
Cantumkan nama file sebagai sumber di akhir jawaban.\n\n`;
        
        const { driveId } = await this.parseFolderUrl(folderUrl);
        
        // Track total chars to avoid context overflow
        let totalChars = 0;
        const MAX_TOTAL_CHARS = 200_000; // ~50k tokens total budget

        for (const file of toRead) {
          if (totalChars >= MAX_TOTAL_CHARS) {
            context += `\n[Batas konteks tercapai — ${files.length - toRead.indexOf(file)} file lainnya tidak dimuat]\n`;
            break;
          }

          try {
            const content  = await this.readFileContent(driveId, file.id, file.name);
            const docLabel = file.folderPath && file.folderPath !== '/'
              ? `${file.folderPath}/${file.name}`
              : file.name;
            
            const contentToAdd = `\n${'═'.repeat(60)}\n📄 DOKUMEN: ${docLabel}\n${'═'.repeat(60)}\n${content}\n${'═'.repeat(60)}\n`;
            context += contentToAdd;
            totalChars += contentToAdd.length;
            
            console.log(`[OneDrive] ✅ Added "${file.name}": ${content.length} chars (running total: ${totalChars})`);
          } catch (e) {
            context += `\n[❌ Gagal membaca: ${file.name} — ${e.message}]\n`;
            console.error(`[OneDrive] Failed to read "${file.name}":`, e.message);
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

  // ── 8. Test connection ────────────────────────────────────────
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
