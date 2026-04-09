// scripts/clear-onedrive-cache.js
// Jalankan dengan: node scripts/clear-onedrive-cache.js
// Ini akan menghapus semua cache OneDrive index sehingga konten di-fetch ulang dari OneDrive

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const INDEX_BASE = path.join(process.cwd(), 'data', 'onedrive-index');

function clearOneDriveCache() {
  if (!fs.existsSync(INDEX_BASE)) {
    console.log('✅ Cache directory tidak ada — tidak perlu dibersihkan.');
    return;
  }

  let deletedFiles = 0;
  let deletedDirs  = 0;

  try {
    const entries = fs.readdirSync(INDEX_BASE);
    
    for (const entry of entries) {
      const fullPath = path.join(INDEX_BASE, entry);
      const stat     = fs.statSync(fullPath);
      
      if (stat.isFile() && entry.endsWith('.json')) {
        // Index file
        fs.unlinkSync(fullPath);
        console.log(`🗑️  Deleted index: ${entry}`);
        deletedFiles++;
      } else if (stat.isDirectory()) {
        // Content cache directory
        const subEntries = fs.readdirSync(fullPath);
        for (const sub of subEntries) {
          fs.unlinkSync(path.join(fullPath, sub));
          deletedFiles++;
        }
        fs.rmdirSync(fullPath);
        console.log(`🗑️  Deleted content cache dir: ${entry}/ (${subEntries.length} files)`);
        deletedDirs++;
      }
    }

    console.log(`\n✅ Cache cleared: ${deletedFiles} files, ${deletedDirs} directories`);
    console.log('🔄 Bot akan fetch ulang semua dokumen dari OneDrive pada pertanyaan berikutnya.');
  } catch (err) {
    console.error('❌ Error clearing cache:', err.message);
  }
}

clearOneDriveCache();
