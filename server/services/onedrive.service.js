// server/services/onedrive.service.js
const axios = require('axios');

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
      timeout: 20_000,
    });
    return response.data;
  }

  // ── 2. Parse folder URL → driveId + folderPath ───────────────
  // Supports:
  //   https://company.sharepoint.com/sites/MySite/Shared%20Documents/MyFolder
  //   https://company-my.sharepoint.com/personal/user_company_com/Documents/MyFolder
  async parseFolderUrl(folderUrl) {
    const url      = new URL(folderUrl);
    const hostname = url.hostname;
    const pathname = decodeURIComponent(url.pathname);

    // Personal OneDrive (my.sharepoint.com)
    if (hostname.includes('-my.sharepoint.com')) {
      const parts       = pathname.split('/');
      const personalIdx = parts.indexOf('personal');
      if (personalIdx === -1) throw new Error('URL OneDrive personal tidak valid');
      const userPrincipal = parts[personalIdx + 1];
      const folderPath    = parts.slice(personalIdx + 3).join('/');

      const site   = await this.graphGet(`/sites/${hostname}:/personal/${userPrincipal}`);
      const drives = await this.graphGet(`/sites/${site.id}/drives`);
      const drive  = drives.value[0];
      return { driveId: drive.id, folderPath, type: 'personal' };
    }

    // SharePoint site
    const siteMatch = pathname.match(/^\/sites\/([^/]+)/);
    if (siteMatch) {
      const siteName = siteMatch[1];
      const site     = await this.graphGet(`/sites/${hostname}:/sites/${siteName}`);
      const drives   = await this.graphGet(`/sites/${site.id}/drives`);
      const drive    = drives.value.find(d =>
        d.name === 'Documents' || d.name === 'Shared Documents'
      ) || drives.value[0];

      // Ambil folder path setelah /Shared Documents/ atau /Documents/
      const folderPath = pathname
        .replace(`/sites/${siteName}/Shared Documents`, '')
        .replace(`/sites/${siteName}/Documents`, '')
        .replace(/^\//, '');

      return { driveId: drive.id, siteId: site.id, folderPath, type: 'sharepoint' };
    }

    throw new Error('Format URL OneDrive/SharePoint tidak dikenali');
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

  // ── 3b. List files rekursif ke semua subfolder ────────────────
  async _listFilesRecursive(driveId, folderPath, depth = 0, maxDepth = 4) {
    if (depth > maxDepth) return [];

    let results = [];
    let items;

    try {
      items = await this._listFolderItems(driveId, folderPath);
    } catch (err) {
      console.error(`[OneDrive] Skip folder "${folderPath}":`, err.message);
      return [];
    }

    for (const item of items) {
      if (item.file) {
        const ext = (item.name.split('.').pop() || '').toLowerCase();
        if (SUPPORTED_EXT.includes(ext)) {
          results.push({
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
        const subPath  = folderPath ? `${folderPath}/${item.name}` : item.name;
        const subFiles = await this._listFilesRecursive(driveId, subPath, depth + 1, maxDepth);
        results        = results.concat(subFiles);
      }
    }

    return results;
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
        const pdfParse = require('pdf-parse');
        const data     = await pdfParse(buffer);
        return data.text.substring(0, 15_000);
      }

      if (ext === 'docx' || ext === 'doc') {
        const mammoth = require('mammoth');
        const result  = await mammoth.extractRawText({ buffer });
        return result.value.substring(0, 15_000);
      }

      if (ext === 'xlsx' || ext === 'xls') {
        const XLSX = require('xlsx');
        const wb   = XLSX.read(buffer, { type: 'buffer' });
        const text = wb.SheetNames
          .map(n => `[Sheet: ${n}]\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n]))
          .join('\n');
        return text.substring(0, 15_000);
      }

      if (ext === 'pptx' || ext === 'ppt') {
        const JSZip      = require('jszip');
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

module.exports = OneDriveService;
