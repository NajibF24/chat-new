import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class FileManagerService {
  constructor() {
    this.baseDir = path.join(__dirname, '../data/files');
    this.contractsDir = path.join(this.baseDir, 'contracts'); // 👈 Path khusus kontrak

    // ✅ MAPPING FOLDER DASHBOARD
    this.dashboardFolders = {
      'iot': 'dashboard-iot-caliper',
      'caliper': 'dashboard-iot-caliper',
      'calipers': 'dashboard-iot-caliper',
      'iot caliper': 'dashboard-iot-caliper',
      
      'web-application-firewall-xdr': 'dashboard-web-application-firewall-xdr',
      'firewall': 'dashboard-web-application-firewall-xdr',
      'waf': 'dashboard-web-application-firewall-xdr',
      'xdr': 'dashboard-web-application-firewall-xdr',
      'wafxdr': 'dashboard-web-application-firewall-xdr'
    };
  }

  /**
   * ✅ IMPROVED: Check if message is requesting dashboard/files
   * Dibuat lebih ketat agar tidak "bentrok" dengan pertanyaan tentang gambar yang diupload.
   */
  isFileRequest(message) {
    const lowerMsg = message.toLowerCase();
    
    // Kata kunci utama untuk Dashboard
    const dashboardKeywords = ['dashboard', 'visualisasi', 'tampilan', 'grafik', 'screenshot'];
    
    // Kata kunci aksi (permintaan)
    const actionKeywords = ['lihat', 'tampilkan', 'berikan', 'minta', 'ambil', 'show', 'get', 'mana', 'cari', 'carikan'];
    
    // 1. Cek apakah ada kata kunci dashboard secara eksplisit
    const hasExplicitDashboard = dashboardKeywords.some(k => lowerMsg.includes(k));
    
    // 2. Cek apakah ada kata "gambar"/"foto"/"file" TAPI harus dibarengi dengan kata aksi
    // Ini mencegah kalimat "ini gambar tentang apa" memicu dashboard karena tidak ada kata aksi (minta tampilkan)
    const hasImageAction = ['gambar', 'foto', 'file'].some(k => lowerMsg.includes(k)) && 
                           actionKeywords.some(k => lowerMsg.includes(k));

    // 3. Filter Analisa: Jika user bertanya "tentang apa", "maksudnya", atau "jelaskan", jangan kirim dashboard
    const isAnalyzing = ['tentang apa', 'maksud', 'jelaskan', 'apa ini', 'artinya'].some(k => lowerMsg.includes(k));

    if (isAnalyzing) return false;

    return hasExplicitDashboard || hasImageAction;
  }

  /**
   * Extract project name/query from message
   */
  extractFileQuery(message) {
    const lowerMsg = message.toLowerCase();
    
    // Remove ONLY action words, keep content words
    const cleaned = lowerMsg
      .replace(/tampilkan|lihat|berikan|minta|tolong|dong|untuk|saya|yang|ada|semua|all/g, '')
      .trim();
    
    console.log('🔍 Query extraction:', {
      original: message,
      cleaned: cleaned
    });
    
    if (!cleaned || lowerMsg.includes('semua') || lowerMsg.includes('all')) {
      return 'all';
    }
    
    return cleaned;
  }

  /**
   * Extract project name specifically for contract search
   */
  extractProjectName(message) {
    const lowerMsg = message.toLowerCase();
    console.log('🔍 Extracting project name from:', message);
    
    let cleaned = lowerMsg
      .replace(/\b(analisa|berikan|terkait|dari|untuk|proyek|project)\b/g, '')
      .replace(/\b(top|term|payment|termin|pembayaran|bayar|invoice|tagih)\b/g, '')
      .replace(/\b(kontrak|klausul|perjanjian|agreement)\b/g, '')
      .replace(/\b(jadwal|schedule|kapan|when|waktu|time|tanggal|date)\b/g, '')
      .replace(/\b(nilai|value|harga|price|biaya|cost)\b/g, '')
      .replace(/\b(apa|siapa|berapa|dimana|bagaimana|kenapa)\b/g, '')
      .replace(/\b(saya|kita|kami|mereka|dia)\b/g, '')
      .replace(/\b(yang|ada|sudah|belum|akan|telah)\b/g, '')
      .trim();
    
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    if (!cleaned || cleaned.length < 3) {
      const projectKeywords = [
        'hyperconverged', 'hci', 'iot', 'caliper', 'sap', 'company', 'currency',
        'e-procurement', 'procurement', 'ai', 'management', 'portal', 'firewall', 'waf', 'xdr'
      ];
      for (const keyword of projectKeywords) {
        if (lowerMsg.includes(keyword)) {
          cleaned = keyword;
          break;
        }
      }
    }
    return cleaned || '';
  }

  /**
   * MAIN SEARCH FUNCTION
   */
  async searchFiles(query) {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery === 'all' || lowerQuery === 'semua' || !query) {
      return await this.getAllDashboards();
    }

    let targetDashboard = null;
    for (const [key, folderName] of Object.entries(this.dashboardFolders)) {
      if (lowerQuery.includes(key) || key.includes(lowerQuery)) {
        targetDashboard = folderName;
        break;
      }
    }

    if (targetDashboard) {
      const targetPath = path.join(this.baseDir, targetDashboard);
      const allFiles = await this.getFilesFromFolder(targetPath, targetDashboard);
      
      if (query !== 'iot' && query !== 'caliper' && query !== 'firewall' && query !== 'waf') {
        const keywords = this.extractKeywords(query);
        if (keywords.length > 0) {
          const filtered = allFiles.filter(file => {
            const fileName = file.name.toLowerCase();
            return keywords.some(keyword => fileName.includes(keyword));
          });
          if (filtered.length > 0) return filtered;
        }
      }
      return allFiles;
    }

    const allResults = await this.getAllDashboards();
    const keywords = this.extractKeywords(query);
    if (keywords.length > 0) {
      const filtered = allResults.filter(file => {
        const fileName = file.name.toLowerCase();
        return keywords.some(keyword => fileName.includes(keyword));
      });
      if (filtered.length > 0) return filtered;
    }
    
    return allResults;
  }

  extractKeywords(query) {
    const stopWords = ['dashboard', 'gambar', 'saya', 'terkait', 'untuk', 'di', 'pada', 'yang', 'dari'];
    return query.toLowerCase().split(/[\s-_]+/).filter(word => word.length > 2 && !stopWords.includes(word));
  }

  async getFilesFromFolder(folderPath, folderName) {
    if (!fs.existsSync(folderPath)) return [];
    try {
      const files = fs.readdirSync(folderPath);
      return files
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'].includes(ext);
        })
        .map(file => {
          const filePath = path.join(folderPath, file);
          const stat = fs.statSync(filePath);
          return {
            name: file,
            folder: folderName,
            relativePath: `/api/files/${folderName}/${file}`,
            type: this.getFileType(file),
            sizeKB: (stat.size / 1024).toFixed(1),
            modifiedAt: stat.mtime
          };
        })
        .sort((a, b) => b.modifiedAt - a.modifiedAt);
    } catch (err) { return []; }
  }

  async getAllDashboards() {
    const allFiles = [];
    const uniqueFolders = [...new Set(Object.values(this.dashboardFolders))];
    for (const folderName of uniqueFolders) {
      const folderPath = path.join(this.baseDir, folderName);
      const files = await this.getFilesFromFolder(folderPath, folderName);
      allFiles.push(...files);
    }
    return allFiles;
  }

  getFileType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return 'image';
    if (['.pdf'].includes(ext)) return 'pdf';
    return 'other';
  }

  generateSmartDescription(files, query) {
    if (files.length === 0) return `Maaf, tidak ada dashboard yang ditemukan.`;
    const grouped = files.reduce((acc, file) => {
      if (!acc[file.folder]) acc[file.folder] = [];
      acc[file.folder].push(file);
      return acc;
    }, {});

    let description = '';
    if (Object.keys(grouped).length === 1) {
      const folderName = Object.keys(grouped)[0];
      const title = folderName.replace('dashboard-', '').replace(/-/g, ' ').toUpperCase();
      description = `📊 **${title}**\n\nBerikut adalah visualisasi dashboard terbaru (${files.length} file):`;
    } else {
      description = `📊 **Dashboard Smartsheet**\n\nDitemukan ${files.length} file visualisasi.`;
    }
    return description;
  }

  listAvailableDashboards() {
    const uniqueDashboards = [...new Set(Object.values(this.dashboardFolders))];
    return uniqueDashboards.map(folder => ({
      folder: folder,
      name: folder.replace('dashboard-', '').replace(/-/g, ' ').toUpperCase()
    }));
  }

  findContractFile(projectName) {
    if (!fs.existsSync(this.contractsDir)) {
      fs.mkdirSync(this.contractsDir, { recursive: true });
      return null;
    }
    try {
      const files = fs.readdirSync(this.contractsDir);
      const lowerProject = projectName.toLowerCase().trim();
      let foundFile = files.find(file => file.toLowerCase().includes(lowerProject) && file.toLowerCase().endsWith('.pdf'));
      
      if (!foundFile && lowerProject.includes(' ')) {
        const keywords = lowerProject.split(' ').filter(w => w.length > 2);
        foundFile = files.find(file => {
          const lowerFile = file.toLowerCase();
          return lowerFile.endsWith('.pdf') && keywords.filter(kw => lowerFile.includes(kw)).length >= Math.ceil(keywords.length / 2);
        });
      }
      
      if (foundFile) return { filename: foundFile, path: path.join(this.contractsDir, foundFile) };
      return null;
    } catch (error) { return null; }
  }

  generateProjectVariations(projectName) {
    const variations = [projectName];
    const abbrevMap = { 'hyperconverged': ['hci'], 'infrastructure': ['infra'], 'firewall': ['fw'] };
    Object.entries(abbrevMap).forEach(([full, abbrevs]) => {
      if (projectName.includes(full)) abbrevs.forEach(abbr => variations.push(projectName.replace(full, abbr)));
    });
    return [...new Set(variations)];
  }
}

export default FileManagerService;
