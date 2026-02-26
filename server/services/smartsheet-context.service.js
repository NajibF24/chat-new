// server/services/smartsheet-context.service.js
//
// Masalah: 733 rows full table = 231K token → melebihi limit 128K GPT-4o
// Solusi:  Filter data SEBELUM dikirim ke OpenAI:
//          1. Hanya ambil kolom yang relevan (buang URL panjang)
//          2. Filter baris berdasarkan intent pertanyaan user
//          3. Batasi max rows yang dikirim ke AI
//          4. Sisipkan link hanya untuk hasil yang relevan

class SmartsheetContextService {

  // ── KOLOM DEFAULT yang dikirim (tanpa URL panjang) ──────────
  // Link bisa menyumbang ~500 token per baris → kita exclude dari tabel
  // dan hanya tampilkan jika user spesifik minta link dokumen tertentu
  SAFE_COLUMNS = [
    'File Name',      // nama file, avg 44 chars
    'Category',       // GEN/RHF/TRM/BD, avg 3 chars
    'Workstream',     // ELE/CIV/MEC/GEN, avg 3 chars
    'Activity',       // Add/Edit/Delete, avg 4 chars
    'ActivityTime',   // datetime, avg 19 chars
    'User',           // nama user, avg 19 chars
    'Folder',         // folder singkat
  ];

  // Kolom tambahan yang hanya disertakan jika user minta link/detail
  LINK_COLUMNS = ['Documents Link', 'Link of the document', 'Folder Location'];

  // ── MAX ROWS per query type ──────────────────────────────────
  MAX_ROWS = {
    recent:   30,    // dokumen terbaru → 30 cukup
    search:   20,    // hasil pencarian nama → 20
    user:     25,    // per user activity → 25
    category: 40,    // per kategori → 40
    stats:    null,  // statistik → tidak perlu baris, hanya summary
    default:  50,    // default → 50
  };

  // ─────────────────────────────────────────────────────────────
  // MAIN METHOD: Proses data berdasarkan pertanyaan user
  // ─────────────────────────────────────────────────────────────
  buildContext(flatRows, userMessage) {
    const msg = (userMessage || '').toLowerCase();
    const intent = this.detectIntent(msg);
    const needsLinks = this.needsLinks(msg);

    // Pilih kolom yang akan ditampilkan
    const columns = needsLinks
      ? [...this.SAFE_COLUMNS, 'Documents Link']
      : this.SAFE_COLUMNS;

    // Filter dan limit baris berdasarkan intent
    let filtered = this.filterRows(flatRows, msg, intent);
    const totalFound = filtered.length;
    const maxRows = this.MAX_ROWS[intent] || this.MAX_ROWS.default;
    const truncated = maxRows && filtered.length > maxRows;
    filtered = maxRows ? filtered.slice(0, maxRows) : filtered;

    // Untuk intent stats, return summary saja tanpa tabel penuh
    if (intent === 'stats') {
      return this.buildStatsSummary(flatRows, msg);
    }

    // Build tabel compact
    const table = this.buildTable(filtered, columns);

    // Build context string
    const totalAll = flatRows.length;
    let context = `=== DATA SMARTSHEET ===\n`;
    context += `Total database: ${totalAll} aktivitas | Ditampilkan: ${Math.min(totalFound, maxRows || totalFound)} dari ${totalFound} hasil yang relevan\n`;
    if (truncated) {
      context += `⚠️ Hasil dibatasi ${maxRows} baris terbaru. Minta filter lebih spesifik untuk hasil lengkap.\n`;
    }
    context += `\n${table}\n`;

    if (needsLinks && filtered.length > 0) {
      context += `\n💡 Link SharePoint tersedia di kolom "Documents Link" di atas.\n`;
    }

    return context;
  }

  // ─────────────────────────────────────────────────────────────
  // DETECT INTENT dari pesan user
  // ─────────────────────────────────────────────────────────────
  detectIntent(msg) {
    if (/minggu ini|this week|week|recent|terbaru|latest|baru/i.test(msg) && !/cari|search|find|nama/i.test(msg)) return 'recent';
    if (/cari|search|find|nama|bernama|file|dokumen.*[a-z]{3,}/i.test(msg)) return 'search';
    if (/siapa|who|user|by|oleh|upload.*oleh|modified.*by/i.test(msg)) return 'user';
    if (/kategori|category|workstream|ele|civ|mec|gen|rhf|trm|bd/i.test(msg)) return 'category';
    if (/total|jumlah|berapa|count|statistik|stats|summary|rangkuman/i.test(msg)) return 'stats';
    return 'default';
  }

  // Apakah user minta link?
  needsLinks(msg) {
    return /link|url|buka|open|akses|access|sharepoint|download/i.test(msg);
  }

  // ─────────────────────────────────────────────────────────────
  // FILTER ROWS berdasarkan intent & keywords
  // ─────────────────────────────────────────────────────────────
  filterRows(rows, msg, intent) {
    let filtered = [...rows];

    // ── Filter by date: "minggu ini", "hari ini", "bulan ini" ──
    if (/minggu ini|this week/i.test(msg)) {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      filtered = filtered.filter(r => this.parseDate(r['ActivityTime']) >= oneWeekAgo);
    } else if (/hari ini|today/i.test(msg)) {
      const today = new Date().toDateString();
      filtered = filtered.filter(r => this.parseDate(r['ActivityTime'])?.toDateString() === today);
    } else if (/bulan ini|this month/i.test(msg)) {
      const now = new Date();
      filtered = filtered.filter(r => {
        const d = this.parseDate(r['ActivityTime']);
        return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
    } else if (/desember|december/i.test(msg)) {
      filtered = filtered.filter(r => /12\//i.test(r['ActivityTime'] || ''));
    } else if (/januari|january/i.test(msg)) {
      filtered = filtered.filter(r => /1\//i.test(r['ActivityTime'] || ''));
    } else if (/februari|february/i.test(msg)) {
      filtered = filtered.filter(r => /2\//i.test(r['ActivityTime'] || ''));
    }

    // ── Filter by Activity type ────────────────────────────────
    if (/dihapus|deleted|delete/i.test(msg)) {
      filtered = filtered.filter(r => r['Activity'] === 'Delete');
    } else if (/diedit|edited|edit|modified|diubah/i.test(msg)) {
      filtered = filtered.filter(r => r['Activity'] === 'Edit');
    } else if (/upload|ditambah|added|baru/i.test(msg) && !/terbaru/i.test(msg)) {
      filtered = filtered.filter(r => r['Activity'] === 'Add');
    }

    // ── Filter by Category ────────────────────────────────────
    const catMatch = msg.match(/\b(gen|rhf|trm|bd main drive|bd)\b/i);
    if (catMatch) {
      const cat = catMatch[1].toUpperCase();
      filtered = filtered.filter(r => (r['Category'] || '').toUpperCase().includes(cat));
    }

    // ── Filter by Workstream ──────────────────────────────────
    const wsMatch = msg.match(/\b(ele|civ|mec|electrical|civil|mechanical)\b/i);
    if (wsMatch) {
      const wsMap = { electrical: 'ELE', civil: 'CIV', mechanical: 'MEC' };
      const ws = wsMap[wsMatch[1].toLowerCase()] || wsMatch[1].toUpperCase();
      filtered = filtered.filter(r => (r['Workstream'] || '').toUpperCase().includes(ws));
    }

    // ── Filter by User name ────────────────────────────────────
    const byMatch = msg.match(/(?:by|oleh|dari|user)\s+([a-z][\w\s]{2,20})/i);
    if (byMatch) {
      const nameQuery = byMatch[1].trim().toLowerCase();
      filtered = filtered.filter(r => (r['User'] || '').toLowerCase().includes(nameQuery));
    }
    // "siapa yang" → return all, AI akan group by user
    // (tidak filter, cukup sort)

    // ── Search by file/document name ──────────────────────────
    if (intent === 'search') {
      // Ekstrak search terms (abaikan stopwords)
      const stopwords = ['cari', 'search', 'find', 'dokumen', 'file', 'yang', 'bernama', 'dengan', 'nama', 'temukan'];
      const terms = msg.split(/\s+/).filter(w => w.length > 2 && !stopwords.includes(w));

      if (terms.length > 0) {
        filtered = filtered.filter(r => {
          const haystack = [r['File Name'], r['Document Name'], r['Document Title']]
            .join(' ').toLowerCase();
          return terms.some(term => haystack.includes(term));
        });
      }
    }

    // ── Sort: terbaru dulu ────────────────────────────────────
    filtered.sort((a, b) => {
      const da = this.parseDate(a['ActivityTime']) || new Date(0);
      const db = this.parseDate(b['ActivityTime']) || new Date(0);
      return db - da;
    });

    return filtered;
  }

  // ─────────────────────────────────────────────────────────────
  // STATS SUMMARY (tanpa tabel penuh)
  // ─────────────────────────────────────────────────────────────
  buildStatsSummary(rows, msg) {
    const total = rows.length;
    const byActivity = this.groupCount(rows, 'Activity');
    const byCategory = this.groupCount(rows, 'Category');
    const byWorkstream = this.groupCount(rows, 'Workstream');
    const byUser = this.groupCount(rows, 'User');

    // Top 5 users
    const topUsers = Object.entries(byUser)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([u, c]) => `${u}: ${c}`)
      .join(', ');

    // Recent 7 days
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const recentCount = rows.filter(r => this.parseDate(r['ActivityTime']) >= weekAgo).length;

    return `=== STATISTIK SMARTSHEET ===
Total aktivitas: ${total}
Minggu ini: ${recentCount} aktivitas

Breakdown by Activity:
${Object.entries(byActivity).map(([k,v]) => `  - ${k}: ${v}`).join('\n')}

Breakdown by Category:
${Object.entries(byCategory).map(([k,v]) => `  - ${k}: ${v}`).join('\n')}

Breakdown by Workstream:
${Object.entries(byWorkstream).map(([k,v]) => `  - ${k}: ${v}`).join('\n')}

Top 5 Users: ${topUsers}
`;
  }

  // ─────────────────────────────────────────────────────────────
  // BUILD MARKDOWN TABLE dari rows yang sudah difilter
  // ─────────────────────────────────────────────────────────────
  buildTable(rows, columns) {
    if (rows.length === 0) return 'Tidak ada data yang sesuai dengan filter.';

    // Hanya gunakan kolom yang ada di data
    const availableCols = columns.filter(c =>
      rows.some(r => r[c] !== undefined && r[c] !== null && String(r[c]).trim() !== '')
    );

    let table = `| ${availableCols.join(' | ')} |\n`;
    table += `| ${availableCols.map(() => '---').join(' | ')} |\n`;

    rows.forEach(row => {
      const values = availableCols.map(col => {
        let val = row[col] ?? '-';
        val = String(val).replace(/\|/g, '/').replace(/\n/g, ' ').trim();
        // Truncate URL supaya tidak terlalu panjang di tabel
        if (val.startsWith('http') && val.length > 60) {
          val = val.substring(0, 57) + '...';
        }
        return val || '-';
      });
      table += `| ${values.join(' | ')} |\n`;
    });

    return table;
  }

  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────
  parseDate(str) {
    if (!str) return null;
    try { return new Date(str); } catch { return null; }
  }

  groupCount(rows, field) {
    return rows.reduce((acc, r) => {
      const key = r[field] || 'Unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  // ─────────────────────────────────────────────────────────────
  // ESTIMATE TOKEN COUNT (kasar, untuk logging)
  // ─────────────────────────────────────────────────────────────
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }
}

export default new SmartsheetContextService();
