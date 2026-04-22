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
  // Supports:
  //   https://company.sharepoint.com/sites/MySite/Shared%20Documents/MyFolder
  //   https://company-my.sharepoint.com/personal/user/Documents/MyFolder
  //   https://company-my.sharepoint.com/my?id=%2Fpersonal%2Fuser%2FDocuments%2FFolder
  async parseFolderUrl(folderUrl) {
    const url      = new URL(folderUrl);
    const hostname = url.hostname;

    // ── Resolve query-param style URL (?id=/personal/user/Documents/Folder)
    // e.g. https://ptgys-my.sharepoint.com/my?id=%2Fpersonal%2Fadmin_gyssteel_com%2FDocuments%2FGYS%20Procedures
    let pathname = url.pathname;
    if (url.searchParams.has('id')) {
      const idParam = decodeURIComponent(url.searchParams.get('id'));
      // idParam = /personal/admin_gyssteel_com/Documents/GYS Procedures
      pathname = idParam;
    } else {
      pathname = url.pathname.split('/').map(p => decodeURIComponent(p)).join('/');
    }

    console.log(`[OneDrive] Resolving pathname: "${pathname}" on host: ${hostname}`);

    // ── Personal OneDrive: /personal/user_domain_com/Documents/...
    const personalMatch = pathname.match(/^\/personal\/([^/]+)(?:\/Documents)?(?:\/(.*))?$/);
    if (personalMatch || hostname.includes('-my.sharepoint.com')) {
      const parts       = pathname.split('/').filter(Boolean);
      const personalIdx = parts.indexOf('personal');

      if (personalIdx !== -1) {
        const userPrincipal = parts[personalIdx + 1]; // admin_gyssteel_com
        // Setelah /personal/user/Documents/ → folder path
        const afterDocs = parts.slice(personalIdx + 3); // skip personal, user, Documents
        const folderPath = afterDocs.join('/');

        console.log(`[OneDrive] Personal drive user="${userPrincipal}", folderPath="${folderPath}"`);

        const site   = await this.graphGet(`/sites/${hostname}:/personal/${userPrincipal}`);
        const drives = await this.graphGet(`/sites/${site.id}/drives`);
        const drive  = drives.value[0];
        return { driveId: drive.id, folderPath, type: 'personal' };
      }
    }

    // ── SharePoint site: /sites/SiteName/...
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

    // Proses subfolder secara PARALLEL (max 5 concurrent)
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

    try {
      if (ext === 'pdf') {
        const { default: pdfParse } = await import('pdf-parse');
        const data = await pdfParse(buffer);
        return data.text.substring(0, 15_000);
      }

      if (ext === 'docx' || ext === 'doc') {
        const { default: mammoth } = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return result.value.substring(0, 15_000);
      }

      if (ext === 'xlsx' || ext === 'xls') {
        const { default: ExcelJSDyn } = await import('exceljs');
        const wb = new ExcelJSDyn.Workbook();
        await wb.xlsx.load(buffer);
        const parts = [];
        wb.eachSheet(sheet => {
          const rows = [];
          sheet.eachRow(row => {
            rows.push(row.values.slice(1).map(v => (v == null ? '' : String(v))).join(','));
          });
          parts.push(`[Sheet: ${sheet.name}]\n${rows.join('\n')}`);
        });
        return parts.join('\n').substring(0, 15_000);
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
        return text.substring(0, 15_000);
      }

      if (['txt', 'md', 'csv'].includes(ext)) {
        return buffer.toString('utf8').substring(0, 15_000);
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

      // Scoring: cek keyword di nama file (bobot 2x) DAN nama folder (bobot 1x)
      const keywords = userMessage.toLowerCase().split(/\s+/).filter(w => w.length > 2);

      const scored = files.map(f => {
        const nameLower   = f.name.toLowerCase();
        const folderLower = (f.folderPath || '').toLowerCase();
        const nameScore   = keywords.filter(k => nameLower.includes(k)).length * 2;
        const folderScore = keywords.filter(k => folderLower.includes(k)).length;
        return { ...f, score: nameScore + folderScore };
      }).sort((a, b) => b.score - a.score || new Date(b.lastModified) - new Date(a.lastModified));

      // Ambil max 3 file relevan (score > 0), fallback ke file terbaru
      const toRead = scored[0]?.score > 0
        ? scored.filter(f => f.score > 0).slice(0, 3)
        : scored.slice(0, 1);

      // Daftar semua file sebagai referensi untuk AI
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
        const { driveId } = await this.parseFolderUrl(folderUrl);
        for (const file of toRead) {
          try {
            const content  = await this.readFileContent(driveId, file.id, file.name);
            const docLabel = file.folderPath && file.folderPath !== '/'
              ? `${file.folderPath}/${file.name}`
              : file.name;
            context += `\n--- ${docLabel} ---\n${content}\n--- Akhir ${file.name} ---\n`;
          } catch (e) {
            context += `\n--- ${file.name} ---\n[Gagal membaca: ${e.message}]\n`;
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
    await this.getAccessToken(); // pastikan auth berhasil dulu
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
