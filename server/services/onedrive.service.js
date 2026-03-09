// server/services/onedrive.service.js
import axios from 'axios';

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
    // Reuse token jika belum expired (5 min buffer)
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
      return this.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     this.clientId,
      client_secret: this.clientSecret,
      scope:         'https://graph.microsoft.com/.default',
    });

    const response = await axios.post(tokenUrl, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });

    this.accessToken = response.data.access_token;
    this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
    return this.accessToken;
  }

  // ── Graph API helper ─────────────────────────────────────────
  async graphGet(endpoint, params = {}) {
    const token = await this.getAccessToken();
    const response = await axios.get(`https://graph.microsoft.com/v1.0${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
      timeout: 20000,
    });
    return response.data;
  }

  // ── 2. Parse folder URL → driveId + itemId ───────────────────
  // Supports:
  //   https://company.sharepoint.com/sites/MySite/Shared%20Documents/MyFolder
  //   https://company-my.sharepoint.com/personal/user_company_com/Documents/MyFolder
  async parseFolderUrl(folderUrl) {
    const url = new URL(folderUrl);
    const hostname = url.hostname; // e.g. company.sharepoint.com
    const pathname = decodeURIComponent(url.pathname);

    // Personal OneDrive (my.sharepoint.com)
    if (hostname.includes('-my.sharepoint.com')) {
      const parts = pathname.split('/');
      // /personal/user_domain_com/Documents/...
      const personalIdx = parts.indexOf('personal');
      if (personalIdx === -1) throw new Error('URL OneDrive personal tidak valid');
      const userPrincipal = parts[personalIdx + 1]; // user_domain_com
      const folderPath    = parts.slice(personalIdx + 3).join('/'); // setelah /Documents/

      const site = await this.graphGet(`/sites/${hostname}:/personal/${userPrincipal}`);
      const drives = await this.graphGet(`/sites/${site.id}/drives`);
      const drive  = drives.value[0];

      return { driveId: drive.id, folderPath, type: 'personal' };
    }

    // SharePoint site
    const siteMatch = pathname.match(/^\/sites\/([^/]+)/);
    if (siteMatch) {
      const siteName  = siteMatch[1];
      const site      = await this.graphGet(`/sites/${hostname}:/sites/${siteName}`);
      const drives    = await this.graphGet(`/sites/${site.id}/drives`);
      const drive     = drives.value.find(d =>
        d.name === 'Documents' || d.name === 'Shared Documents'
      ) || drives.value[0];

      // Extract folder path setelah /Shared Documents/ atau /Documents/
      const folderPath = pathname
        .replace(`/sites/${siteName}/Shared%20Documents`, '')
        .replace(`/sites/${siteName}/Documents`, '')
        .replace(`/sites/${siteName}/Shared Documents`, '')
        .replace(/^\//, '');

      return { driveId: drive.id, siteId: site.id, folderPath, type: 'sharepoint' };
    }

    throw new Error('Format URL OneDrive/SharePoint tidak dikenali');
  }

  // ── 3. List files in a folder ────────────────────────────────
  async listFiles(folderUrl) {
    const { driveId, folderPath } = await this.parseFolderUrl(folderUrl);

    const endpoint = folderPath
      ? `/drives/${driveId}/root:/${folderPath}:/children`
      : `/drives/${driveId}/root/children`;

    const data = await this.graphGet(endpoint, {
      $select: 'id,name,size,lastModifiedDateTime,file,folder,webUrl',
      $top: 100,
      $orderby: 'lastModifiedDateTime desc',
    });

    return (data.value || []).map(item => ({
      id:           item.id,
      name:         item.name,
      size:         item.size || 0,
      lastModified: item.lastModifiedDateTime,
      webUrl:       item.webUrl,
      isFolder:     !!item.folder,
      mimeType:     item.file?.mimeType || null,
    }));
  }

  // ── 4. Download & read file content ─────────────────────────
  async readFileContent(driveId, fileId, fileName) {
    const token = await this.getAccessToken();
    const ext   = (fileName || '').split('.').pop().toLowerCase();

    // Get download URL
    const metaRes = await this.graphGet(`/drives/${driveId}/items/${fileId}`);
    const downloadUrl = metaRes['@microsoft.graph.downloadUrl'];

    if (!downloadUrl) throw new Error('File tidak bisa didownload');

    const fileRes = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: { Authorization: `Bearer ${token}` },
    });

    const buffer = Buffer.from(fileRes.data);

    // Parse berdasarkan tipe file
    if (ext === 'pdf') {
      const pdf = (await import('pdf-parse')).default;
      const data = await pdf(buffer);
      return data.text.substring(0, 15000);
    }

    if (ext === 'docx' || ext === 'doc') {
      const mammoth = (await import('mammoth')).default;
      const result  = await mammoth.extractRawText({ buffer });
      return result.value.substring(0, 15000);
    }

    if (ext === 'xlsx' || ext === 'xls') {
      const XLSX    = (await import('xlsx')).default;
      const wb      = XLSX.read(buffer, { type: 'buffer' });
      return wb.SheetNames.map(n => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n').substring(0, 15000);
    }

    if (['txt', 'md', 'csv'].includes(ext)) {
      return buffer.toString('utf8').substring(0, 15000);
    }

    return `[File: ${fileName} — tipe tidak didukung untuk pembacaan teks]`;
  }

  // ── 5. Build context untuk AI ────────────────────────────────
  async buildContext(folderUrl, userMessage) {
    const files = await this.listFiles(folderUrl);

    if (!files.length) {
      return `\n\n=== 📁 ONEDRIVE ===\nFolder kosong atau tidak ada file.\n`;
    }

    // Cari file yang paling relevan berdasarkan keyword
    const msg = userMessage.toLowerCase();
    const keywords = msg.split(/\s+/).filter(w => w.length > 3);

    const scored = files.map(f => ({
      ...f,
      score: keywords.filter(k => f.name.toLowerCase().includes(k)).length,
    })).sort((a, b) => b.score - a.score);

    let context  = `\n\n=== 📁 ONEDRIVE / SHAREPOINT ===\n`;
    context     += `Total file: ${files.length}\n\n`;

    // List semua file
    context += `**Daftar File:**\n`;
    files.forEach(f => {
      const icon = f.isFolder ? '📂' : '📄';
      const size = f.size > 1048576
        ? `${(f.size / 1048576).toFixed(1)} MB`
        : `${(f.size / 1024).toFixed(0)} KB`;
      const date = new Date(f.lastModified).toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
      context += `${icon} ${f.name} (${size}, diubah: ${date})\n`;
    });

    // Jika ada keyword yang cocok, baca isi file teratas
    const topRelevant = scored.filter(f => f.score > 0 && !f.isFolder).slice(0, 2);
    if (topRelevant.length > 0 && keywords.length > 1) {
      context += `\n**Konten File Relevan:**\n`;
      for (const file of topRelevant) {
        try {
          const { driveId } = await this.parseFolderUrl(folderUrl);
          const content = await this.readFileContent(driveId, file.id, file.name);
          context += `\n--- ${file.name} ---\n${content}\n`;
        } catch (e) {
          context += `\n--- ${file.name} ---\n[Gagal membaca: ${e.message}]\n`;
        }
      }
    }

    context += `\n=== AKHIR ONEDRIVE ===\n`;
    return context;
  }

  // ── 6. Test connection ───────────────────────────────────────
  async testConnection(folderUrl) {
    const token = await this.getAccessToken();
    const files = await this.listFiles(folderUrl);
    return {
      ok:         true,
      fileCount:  files.length,
      sampleFiles: files.slice(0, 3).map(f => f.name),
    };
  }
}

export default OneDriveService;
