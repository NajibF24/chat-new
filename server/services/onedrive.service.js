// server/services/onedrive.service.js
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
    // [PERBAIKAN] Tingkatkan batas karakter menjadi 40.000 (~10.000 token) agar detail dokumen terbaca semua
    const MAX_CHARS = 40_000; 

    try {
      if (ext === 'pdf') {
        const { default: pdfParse } = await import('pdf-parse');
        const data = await pdfParse(buffer);
        return data.text.substring(0, MAX_CHARS);
      }

      if (ext === 'docx' || ext === 'doc') {
        const { default: mammoth } = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return result.value.substring(0, MAX_CHARS);
      }

      if (ext === 'xlsx' || ext === 'xls') {
        const { default: XLSX } = await import('xlsx');
        const wb   = XLSX.read(buffer, { type: 'buffer' });
        const text = wb.SheetNames
          .map(n => `[Sheet: ${n}]\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n]))
          .join('\n');
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
        return text.substring(0, MAX_CHARS);
      }

      if (['txt', 'md', 'csv'].includes(ext)) {
        return buffer.toString('utf8').substring(0, MAX_CHARS);
      }

      return `[File: ${fileName} — tipe tidak didukung untuk pembacaan teks]`;

    } catch (parseErr) {
      console.error(`[OneDrive] Parse error "${fileName}":`, parseErr.message);
      return `[Gagal membaca konten ${fileName}: ${parseErr.message}]`;
    }
  }

  // ── 5. Build context untuk AI ────────────────────────────────
  async buildContext(folderUrl, userMessage) {
    try {
      const files = await this.listFiles(folderUrl);

      if (!files.length) {
        return `\n\n=== 📁 ONEDRIVE ===\nFolder kosong atau tidak ada file yang didukung.\n=== AKHIR ONEDRIVE ===\n`;
      }

      // [PERBAIKAN SCORING]: Menggunakan array stop-words. Kata penting seperti "it", "hr", "qa" dengan length <=2 sekarang aman.
      const stopWords = new Set(['yang','dan','atau','di','ke','dari','ini','itu','untuk','dengan','dalam','pada','adalah','bahwa','ada','jika','kalau','saya','kamu','tolong','apa','siapa','kapan','dimana','bagaimana']);
      const keywords = userMessage.toLowerCase().split(/\W+/).filter(w => w.length > 1 && !stopWords.has(w));

      const scored = files.map(f => {
        const nameLower   = f.name.toLowerCase();
        const folderLower = (f.folderPath || '').toLowerCase();
        
        let score = 0;
        keywords.forEach(k => {
          if (nameLower.includes(k)) score += 3;
          if (folderLower.includes(k)) score += 1;
        });
        
        return { ...f, score };
      }).sort((a, b) => b.score - a.score || new Date(b.lastModified) - new Date(a.lastModified));

      // [PERBAIKAN] Ambil hingga 6 file relevan (sebelumnya cuma 3), fallback ke 3 file terbaru jika skor 0
      const toRead = scored[0]?.score > 0
        ? scored.filter(f => f.score > 0).slice(0, 6)
        : scored.slice(0, 3);

      let context  = `\n\n=== 📁 ONEDRIVE / SHAREPOINT ===\n`;
      context     += `Total file tersedia: ${files.length}\n\n`;
      context     += `**Daftar File (semua subfolder):**\n`;

      files.forEach(f => {
        const size = f.size > 1_048_576
          ? `${(f.size / 1_048_576).toFixed(1)} MB`
          : `${Math.round(f.size / 1024)} KB`;
        const date = new Date(f.lastModified).toLocaleDateString('id-ID', {
          day: '2-digit', month: 'short', year: 'numeric',
        });
        const path = f.folderPath && f.folderPath !== '/'
          ? `📂 ${f.folderPath}/`
          : '';
        context += `📄 ${path}${f.name} (${size}, ${date})\n`;
      });

      // Baca isi file yang relevan
      if (toRead.length > 0) {
        context += `\n**Konten File Relevan:**\n`;
        // [PERBAIKAN] Tambahkan perintah tegas agar Bot menjabarkan isi yang ditemukan
        context += `[INSTRUKSI UNTUK AI: Jika informasi yang relevan ditemukan di dalam teks di bawah ini, jabarkan secara spesifik poin-poin/detail dari isi teks tersebut! Jangan hanya mengarahkan user untuk membaca file sendirian.]\n`;
        
        const { driveId } = await this.parseFolderUrl(folderUrl);
        for (const file of toRead) {
          try {
            const content  = await this.readFileContent(driveId, file.id, file.name);
            const docLabel = file.folderPath && file.folderPath !== '/'
              ? `${file.folderPath}/${file.name}`
              : file.name;
            context += `\n--- MULAI DOKUMEN: ${docLabel} ---\n${content}\n--- AKHIR DOKUMEN: ${file.name} ---\n`;
          } catch (e) {
            context += `\n--- MULAI DOKUMEN: ${file.name} ---\n[Gagal membaca: ${e.message}]\n--- AKHIR DOKUMEN: ${file.name} ---\n`;
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

  // ── 6. Test connection ────────────────────────────────────────
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
