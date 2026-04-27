import fs from 'fs';
import path from 'path';

class CleanupService {
  constructor() {
    this.filesDir = path.join(process.cwd(), 'data', 'files');
    this.uploadsDir = path.join(process.cwd(), 'data', 'uploads');
    this.retentionDays = 14; // 2 weeks
    this.retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;
  }

  start() {
    // Jalankan pertama kali saat server start
    this.cleanup();
    // Kemudian jalankan setiap 24 jam (86400000 ms)
    setInterval(() => this.cleanup(), 24 * 60 * 60 * 1000);
  }

  cleanup() {
    console.log(`[CLEANUP] Memulai pengecekan file usang (> ${this.retentionDays} hari)...`);
    const now = Date.now();

    [this.filesDir, this.uploadsDir].forEach(dir => {
      if (!fs.existsSync(dir)) return;
      
      fs.readdir(dir, (err, files) => {
        if (err) {
          console.error(`[CLEANUP] Gagal membaca direktori ${dir}:`, err);
          return;
        }

        let deletedCount = 0;
        files.forEach(file => {
          // Abaikan file tersembunyi seperti .gitkeep
          if (file.startsWith('.')) return;

          const filePath = path.join(dir, file);
          fs.stat(filePath, (err, stats) => {
            if (err) return;

            // Hapus file jika umur modifikasinya lebih dari 14 hari
            if (now - stats.mtimeMs > this.retentionMs) {
              fs.unlink(filePath, err => {
                if (err) {
                  console.error(`[CLEANUP] Gagal menghapus file ${filePath}:`, err);
                } else {
                  console.log(`[CLEANUP] File usang dihapus: ${file}`);
                  deletedCount++;
                }
              });
            }
          });
        });
      });
    });
  }
}

export default new CleanupService();
