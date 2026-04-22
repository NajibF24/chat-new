// server/services/smartsheet-live.service.js
//
// ✅ FULLY DYNAMIC — Tidak ada hardcode kolom
// Semua kolom dibaca langsung dari sheet apapun yang dikonfigurasi di bot.
// Kalau sheet baru ditambahkan dengan kolom berbeda, otomatis terbaca.
//
// CHANGELOG (patch):
//   + Tambah COLUMN_ALIASES untuk: user, fileDate, fileName, activityTime, docLink
//   + Fix isDocSheet detection: pakai kolom 'User' dan 'Activity' (lebih robust)
//   + Rewrite buildDocContext: tampilkan 6 kolom yang diminta (File Date, File Name,
//     Activity, User, Activity Time, Document Link)
//   + Fix normalisasi ActivityTime: handle 'Activity Time' (dengan spasi)
//   + Null safety: kolom kosong tampil sebagai '-'

import axios from 'axios';

// ─────────────────────────────────────────────────────────────
// COLUMN ALIAS MAP
// ─────────────────────────────────────────────────────────────
const COLUMN_ALIASES = {
  projectName:  ['Project Name', 'Name', 'Nama Proyek', 'Project Title', 'Title'],
  projectId:    ['Project ID', 'ID', 'No', 'No.'],
  pm:           ['Project Manager', 'PM', 'PIC', 'Person In Charge', 'Owner', 'Assigned To'],
  status:       ['Project Status', 'Status'],
  progress:     ['Overall Progress (%)', 'Progress (%)', 'Progress', 'Overall Progress', 'Completion (%)'],
  health:       ['Schedule Health', 'Health', 'RAG Status', 'Health Status'],
  targetEnd:    ['Target End Date', 'Target End', 'Due Date', 'End Date', 'Deadline', 'Finish Date'],
  targetStart:  ['Target Start Date', 'Target Start', 'Start Date', 'Kick Off Date'],
  issues:       ['Issues', 'Issue', 'Risks & Issues', 'Risk', 'Blockers', 'Kendala'],
  department:   ['Department', 'Dept', 'Division', 'Division Account'],
  vendor:       ['Project Vendor', 'Vendor', 'Contractor'],
  remarks:      ['Remarks', 'Notes', 'Catatan', 'Comment'],
  lastModified: ['Last Modified Overall', 'Last Modified', 'Modified At', 'Last Updated'],
  daysSinceUpdate: ['Days Since Last Update', 'Days Since Update', 'Days Since Modified', 'Days Since Last Modified', 'Last Update (Days)', 'Stale Days'],
  // ── Doc Tracking columns (BP Revamp & similar) ───────────
  user:         ['User', 'Modified By', 'Changed By', 'Uploaded By', 'Editor'],
  fileDate:     ['File Date', 'FileDate', 'Date', 'Tanggal'],
  fileName:     ['File Name', 'FileName', 'Document Name', 'Doc Name', 'Nama File'],
  activityTime: ['Activity Time', 'ActivityTime', 'Timestamp', 'Time', 'Date Time', 'DateTime'],
  docLink:      ['Documents Link', 'Document Link', 'Link of the document', 'Link', 'URL', 'Doc Link'],
};

class SmartsheetLiveService {
  constructor(apiKey) {
    if (!apiKey) throw new Error('Smartsheet API Key tidak ditemukan di konfigurasi bot');

    this.apiKey   = apiKey;
    this.baseURL  = 'https://api.smartsheet.com/2.0';
    this.client   = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      timeout: 30000,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // FETCH SHEET LANGSUNG DARI API
  // ─────────────────────────────────────────────────────────────
  async fetchSheet(sheetId) {
    if (!sheetId) throw new Error('Sheet ID tidak dikonfigurasi di bot ini');

    console.log(`📡 [SmartsheetLive] Fetching sheet ${sheetId}...`);
    try {
      const response = await this.client.get(`/sheets/${sheetId}`, {
        params: { include: 'attachments,discussions', level: 2 },
      });
      const sheet = response.data;
      console.log(`✅ [SmartsheetLive] Sheet "${sheet.name}" — ${sheet.rows?.length || 0} rows, ${sheet.columns?.length || 0} cols`);
      return sheet;
    } catch (error) {
      if (error.response?.status === 401) throw new Error('API Key Smartsheet tidak valid atau sudah expired');
      if (error.response?.status === 403) throw new Error('API Key tidak punya akses ke sheet ini');
      if (error.response?.status === 404) throw new Error(`Sheet ID ${sheetId} tidak ditemukan`);
      throw new Error(`Gagal fetch Smartsheet: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PROSES RAW SHEET → FLAT ROWS (dinamis, semua kolom)
  // ─────────────────────────────────────────────────────────────
  processToFlatRows(sheet) {
    if (!sheet.rows || !sheet.columns) return [];

    const colMap = {};
    sheet.columns.forEach(col => { colMap[col.id] = col.title; });

    // ✅ FIX: Detect & skip duplicate header rows
    const firstColTitle = sheet.columns[0]?.title || '';

    return sheet.rows
      .filter(row => {
        const firstCell = row.cells?.[0];
        const firstVal  = firstCell?.displayValue ?? firstCell?.value ?? '';
        return String(firstVal).trim() !== firstColTitle.trim();
      })
      .map(row => {
        const flat = {};
        row.cells.forEach(cell => {
          const title = colMap[cell.columnId];
          if (title) {
            // ✅ FIX v1.2.0: Untuk cell teks biasa, gunakan `value` sebagai prioritas utama
            // karena `displayValue` dari Smartsheet API bisa terpotong pada teks panjang
            // (misal: kolom Issues, Remarks yang berisi multi-line text).
            // `displayValue` tetap dipakai sebagai fallback untuk date/formula/currency
            // yang memang butuh format display (bukan raw value).
            const rawVal     = cell.value ?? null;
            const displayVal = cell.displayValue ?? null;

            // Pakai displayValue hanya jika: tidak ada rawVal, ATAU rawVal adalah angka/boolean
            // (tanggal dari Smartsheet datang sebagai string ISO di displayValue, bukan number)
            const useDisplay = displayVal !== null && (
              rawVal === null ||
              typeof rawVal === 'number' ||
              typeof rawVal === 'boolean'
            );

            flat[title] = useDisplay ? displayVal : (rawVal ?? displayVal ?? null);
          }
        });
        return flat;
      });
  }

  // ─────────────────────────────────────────────────────────────
  // RESOLVE ALIAS
  // ─────────────────────────────────────────────────────────────
  resolveField(row, canonicalKey) {
    const aliases = COLUMN_ALIASES[canonicalKey] || [];
    for (const alias of aliases) {
      if (row[alias] !== undefined && row[alias] !== null && row[alias] !== '') {
        return row[alias];
      }
    }
    return null;
  }

  resolveFieldName(row, canonicalKey) {
    const aliases = COLUMN_ALIASES[canonicalKey] || [];
    for (const alias of aliases) {
      if (row[alias] !== undefined && row[alias] !== null) {
        return alias;
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // DETECT COLUMNS AVAILABLE IN THIS SHEET
  // ─────────────────────────────────────────────────────────────
  detectAvailableColumns(flatRows) {
    if (!flatRows.length) return {};
    const sampleRow = flatRows[0];
    const allKeys = Object.keys(sampleRow);

    const has = (canonicalKey) => {
      const aliases = COLUMN_ALIASES[canonicalKey] || [];
      return aliases.some(a => allKeys.includes(a));
    };

    return {
      projectName:  has('projectName'),
      projectId:    has('projectId'),
      pm:           has('pm'),
      status:       has('status'),
      progress:     has('progress'),
      health:       has('health'),
      targetEnd:    has('targetEnd'),
      targetStart:  has('targetStart'),
      issues:       has('issues'),
      department:   has('department'),
      vendor:       has('vendor'),
      remarks:      has('remarks'),
      lastModified: has('lastModified'),
      daysSinceUpdate: has('daysSinceUpdate'),
      // Doc tracking
      user:         has('user'),
      fileDate:     has('fileDate'),
      fileName:     has('fileName'),
      activityTime: has('activityTime'),
      docLink:      has('docLink'),
      budgetCols:   allKeys.filter(k => k.toLowerCase().includes('budget') || k.toLowerCase().includes('afe') || k.toLowerCase().includes('cost')),
      allColumns:   allKeys,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // BUILD AI CONTEXT — Smart router berdasarkan sheet type
  // ─────────────────────────────────────────────────────────────
  buildAIContext(flatRows, userMessage, sheetName) {
    const today = new Date();
    const msg   = (userMessage || '').toLowerCase();
    const cols  = this.detectAvailableColumns(flatRows);

    let context  = `=== DATA SMARTSHEET: ${sheetName} ===\n`;
    context     += `Tanggal hari ini: ${today.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`;
    context     += `Total data: ${flatRows.length} rows\n`;
    context     += `Kolom tersedia: ${cols.allColumns.join(', ')}\n\n`;

    // ✅ FIX v1.4.0: isDocSheet detection yang lebih ketat.
    // Project sheet sering punya kolom "Activity" atau "User" untuk audit trail,
    // tapi PASTI punya kolom project (Status, Progress, Target End Date).
    // Doc tracking sheet TIDAK punya kolom project tersebut.
    // Rule: isDocSheet = true HANYA jika ada Activity+User/ActivityTime
    //       DAN tidak ada satupun kolom project utama.
    const hasActivityCols = cols.allColumns.some(k => k === 'Activity') &&
      (cols.allColumns.some(k => k === 'User') ||
       cols.allColumns.some(k => k === 'Activity Time' || k === 'ActivityTime'));

    const hasProjectCols = cols.status || cols.progress || cols.targetEnd || cols.health;

    const isDocSheet = hasActivityCols && !hasProjectCols;

    if (isDocSheet) {
      return this.buildDocContext(flatRows, msg, today, context, cols);
    } else {
      return this.buildProjectContext(flatRows, msg, today, context, cols);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // CONTEXT: PROJECT SHEET (dinamis)
  // ─────────────────────────────────────────────────────────────
  buildProjectContext(flatRows, msg, today, context, cols) {
    const categorized = this.categorizeRows(flatRows, today, cols);

    // ✅ FIX v1.3.0: Deteksi single-project query PERTAMA, sebelum branch lainnya.
    // Query seperti "status project e-asset" atau "show me e-asset" harus langsung
    // menampilkan detail satu project dengan Issues PENUH — tidak masuk rowsToTable.
    const allRows   = [...categorized.completed, ...categorized.overdue, ...categorized.active, ...categorized.canceled];
    // ✅ FIX v1.4.1: Extended stopWords — tambahkan query-type words agar tidak
    // salah dicocokkan ke nama project (misal: "all" → "EV BYD Sealion" via "al").
    const stopWords = new Set([
      'give','show','status','project','proyek','please','what','the','and',
      'for','dari','me','is','are','how','ada','apa','yang','dengan','ini',
      'nya','saya','get','tell','find','tampilkan','cari','lihat','bagaimana',
      'gimana','update','latest','terbaru','info','informasi','detail','about',
      'tentang','mengenai','regarding','current','terkini','sekarang','progress',
      // ✅ NEW: query-type words that must never be treated as project name tokens
      'all','semua','overdue','delay','terlambat','active','aktif','complete',
      'selesai','done','finish','dashboard','summary','overview','statistik',
      'report','laporan','issue','masalah','kendala','risk','budget','biaya',
      'cost','anggaran','health','red','merah','kritis','critical','today',
      'hari','minggu','bulan','week','month','year','tahun','list','daftar',
    ]);
    const words       = msg.replace(/[^a-z0-9\s]/gi, ' ').split(/\s+/).filter(w => w.length >= 3);
    const searchWords = words.filter(w => !stopWords.has(w.toLowerCase()));

    // ✅ FIX v1.4.1: normalizeStr — split hyphenated words BEFORE alias mapping
    // so "e-aset" → ["e","aset"] → ["e","asset"] → "easset" (correct)
    // instead of "e-aset" → "easet" → no alias match (wrong).
    const idToEnMap = {
      'aset': 'asset', 'sistem': 'system', 'jaringan': 'network',
      'gudang': 'warehouse', 'keuangan': 'finance', 'pembelian': 'procurement',
      'penjualan': 'sales', 'sdm': 'hr', 'kepegawaian': 'hr',
    };
    const normalizeStr = (s) => {
      // Split on hyphens/spaces first, map each token through alias, then join
      const tokens = String(s || '').toLowerCase()
        .split(/[-\s]+/)
        .map(t => t.replace(/[^a-z0-9]/g, ''))
        .filter(Boolean)
        .map(t => idToEnMap[t] || t);
      return tokens.join('');
    };

    // Kata generik yang sering muncul di banyak nama project — bobot lebih rendah
    const genericProjectWords = new Set([
      'implementation','system','project','management','monitoring','improvement',
      'development','integration','upgrade','migration','installation','deployment',
      'aplikasi','sistem','proyek','manajemen','pengembangan','implementasi','new',
    ]);

    let singleMatch = null;
    if (searchWords.length > 0) {
      let bestScore = 0;

      for (const row of allRows) {
        const rawName   = String(this.resolveField(row, 'projectName') || '');
        const normName  = normalizeStr(rawName);
        // nameParts: each word of the project name, normalized individually
        const nameParts = rawName.toLowerCase().replace(/-/g, ' ').split(/\s+/)
          .filter(p => p.length >= 2)
          .map(p => normalizeStr(p));

        let score = 0;
        for (const w of searchWords) {
          const normW = normalizeStr(w);
          if (!normW || normW.length < 2) continue;
          // Kata spesifik (tidak generik) diberi bobot 3, kata generik bobot 1
          const weight = genericProjectWords.has(normW) ? 1 : 3;
          // ✅ FIX v1.4.1: ONE-DIRECTIONAL match only.
          // normName/namePart must CONTAIN the search word — NOT the reverse.
          // Old: normW.includes(p) caused "ev" (from "EV BYD") to match inside "devsecops".
          if (normName.includes(normW)) {
            score += weight;
          } else if (nameParts.some(p => p.includes(normW))) {
            score += weight;
          }
        }

        if (score > bestScore) {
          bestScore   = score;
          singleMatch = row;
        }
      }

      // Threshold: minimal score 2 (1 kata spesifik, atau 2 kata generik)
      // Tanpa threshold, kata tunggal generik seperti "system" bisa salah match
      if (bestScore < 2) singleMatch = null;
    }

    if (singleMatch) {
      // Tampilkan detail lengkap satu project — Issues PENUH tanpa truncate
      const issueRaw    = this.resolveField(singleMatch, 'issues') || '-';
      const projectName = this.resolveField(singleMatch, 'projectName') || '-';
      const pm          = this.resolveField(singleMatch, 'pm') || '-';
      const status      = this.resolveField(singleMatch, 'status') || '-';
      const progressRaw = parseFloat(this.resolveField(singleMatch, 'progress') || 0) || 0;
      const progressPct = progressRaw > 1 ? Math.round(progressRaw) : Math.round(progressRaw * 100);
      const health      = this.resolveField(singleMatch, 'health') || '-';
      const targetEnd   = this.formatDate(this.resolveField(singleMatch, 'targetEnd')) || '-';
      const dept        = this.resolveField(singleMatch, 'department') || '-';
      const vendor      = this.resolveField(singleMatch, 'vendor') || '-';
      const remarks     = this.resolveField(singleMatch, 'remarks') || '-';
      const healthEmoji = health === 'Green' ? '🟢' : health === 'Yellow' ? '🟡' : health === 'Red' ? '🔴' : '⚪';
      const daysOverdue = singleMatch._daysOverdue ? `${singleMatch._daysOverdue} hari` : '-';

      context += `--- DETAIL PROYEK: ${projectName} ---\n`;
      context += `Project Name  : ${projectName}\n`;
      context += `PM            : ${pm}\n`;
      context += `Department    : ${dept}\n`;
      context += `Status        : ${status}\n`;
      context += `Progress      : ${progressPct}%\n`;
      context += `Health        : ${healthEmoji} ${health}\n`;
      context += `Target End    : ${targetEnd}\n`;
      context += `Days Overdue  : ${daysOverdue}\n`;
      context += `Vendor        : ${vendor}\n`;
      context += `Remarks       : ${remarks}\n`;
      context += `Issues        :\n${issueRaw}\n`;
      return context;
    }

    // Bukan single-project query — lanjut ke branch generik
    context += `--- RINGKASAN STATUS ---\n`;
    context += `✅ Completed : ${categorized.completed.length}\n`;
    context += `🔴 Overdue   : ${categorized.overdue.length}\n`;
    context += `🟢 Active    : ${categorized.active.length}\n`;
    context += `⛔ Canceled  : ${categorized.canceled.length}\n\n`;

    if (/overdue|terlambat|delay|melewati|lewat/i.test(msg)) {
      context += `--- PROYEK OVERDUE (${categorized.overdue.length}) ---\n`;
      context += this.rowsToTable(categorized.overdue, today, cols, true);
    } else if (/selesai|complete|done|finish/i.test(msg)) {
      context += `--- PROYEK COMPLETED (${categorized.completed.length}) ---\n`;
      context += this.rowsToTable(categorized.completed, today, cols, false);
    } else if (/aktif|active|on.?track|berjalan|in.?progress/i.test(msg)) {
      context += `--- PROYEK ACTIVE (${categorized.active.length}) ---\n`;
      context += this.rowsToTable(categorized.active, today, cols, false);
    } else if (/budget|biaya|cost|anggaran/i.test(msg)) {
      context += `--- DATA BUDGET PROYEK ---\n`;
      context += this.rowsToTableWithBudget(flatRows, cols);
    } else if (/issue|masalah|kendala|risk|problem/i.test(msg)) {
      const withIssues = flatRows.filter(row => {
        const issue = this.resolveField(row, 'issues');
        return issue && issue !== '-' && issue.toLowerCase() !== 'no issue' && issue.trim() !== '';
      });
      context += `--- PROYEK DENGAN ISSUES (${withIssues.length}) ---\n`;
      context += this.rowsToTable(withIssues, today, cols, false);
    } else if (/summary|overview|dashboard|semua|all|statistik/i.test(msg)) {
      const relevant = [...categorized.overdue, ...categorized.active];
      context += `--- SEMUA PROYEK AKTIF & OVERDUE (${relevant.length}) ---\n`;
      context += this.rowsToTable(relevant, today, cols, true);
      if (categorized.completed.length > 0) {
        context += `\n(${categorized.completed.length} proyek Completed tidak ditampilkan untuk ringkas.)\n`;
      }
    } else {
      const relevant = [...categorized.overdue, ...categorized.active];
      context += `--- PROYEK AKTIF & OVERDUE (${relevant.length}) ---\n`;
      context += this.rowsToTable(relevant, today, cols, true);
      if (categorized.completed.length > 0) {
        context += `\n(${categorized.completed.length} proyek Completed tidak ditampilkan.)\n`;
      }
    }

    return context;
  }

  // ─────────────────────────────────────────────────────────────
  // KATEGORISASI ROWS
  // ─────────────────────────────────────────────────────────────
  categorizeRows(flatRows, today, cols) {
    const result = { completed: [], overdue: [], active: [], canceled: [] };

    flatRows.forEach(row => {
      const status    = String(this.resolveField(row, 'status') || '').trim();
      const targetEnd = this.parseDate(this.resolveField(row, 'targetEnd'));

      const progressRaw = parseFloat(this.resolveField(row, 'progress') || 0) || 0;
      const progressPct = progressRaw > 1 ? progressRaw : progressRaw * 100;

      if (
        status.toLowerCase() === 'complete' ||
        status.toLowerCase() === 'completed' ||
        progressPct >= 100
      ) { result.completed.push(row); return; }

      if (status.toLowerCase() === 'canceled' || status.toLowerCase() === 'cancelled') {
        result.canceled.push(row); return;
      }

      if (targetEnd && targetEnd < today) {
        const daysOverdue = Math.floor((today - targetEnd) / (1000 * 60 * 60 * 24));
        row._daysOverdue  = daysOverdue;
        result.overdue.push(row);
        return;
      }

      result.active.push(row);
    });

    result.overdue.sort((a, b) => (b._daysOverdue || 0) - (a._daysOverdue || 0));
    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // FORMAT TABLE — Project
  // ─────────────────────────────────────────────────────────────
  rowsToTable(rows, today, cols, showDaysOverdue = false) {
    if (!rows.length) return 'Tidak ada data.\n\n';

    const headers = ['Project Name'];
    if (cols.pm)         headers.push('PM');
    if (cols.department) headers.push('Dept');
    headers.push('Status');
    if (cols.progress)   headers.push('Progress');
    if (cols.targetEnd)  headers.push('Target End');
    if (cols.health)     headers.push('Health');
    if (showDaysOverdue) headers.push('Days Overdue');
    if (cols.issues)     headers.push('Issues');
    if (cols.daysSinceUpdate) headers.push('Days Since Update');

    let table = `| ${headers.join(' | ')} |\n`;
    table    += `| ${headers.map(h => {
      if (h === 'Progress' || h === 'Health' || h === 'Days Overdue') return ':---:';
      return ':---';
    }).join(' | ')} |\n`;

    rows.forEach(row => {
      const name        = this.truncate(this.resolveField(row, 'projectName') || this.resolveField(row, 'projectId') || '-', 40);
      const pm          = this.truncate(this.resolveField(row, 'pm') || '-', 25);
      const dept        = this.truncate(this.resolveField(row, 'department') || '-', 20);
      const status      = this.resolveField(row, 'status') || '-';

      const progressRaw = parseFloat(this.resolveField(row, 'progress') || 0) || 0;
      const progressPct = progressRaw > 1 ? Math.round(progressRaw) : Math.round(progressRaw * 100);
      const progress    = `${progressPct}%`;

      const health      = this.resolveField(row, 'health') || '-';
      const healthEmoji = health === 'Green'  ? '🟢'
                        : health === 'Yellow' ? '🟡'
                        : health === 'Red'    ? '🔴' : '⚪';

      const targetEndRaw = this.resolveField(row, 'targetEnd');
      const targetEnd    = targetEndRaw ? this.formatDate(targetEndRaw) : '-';
      const daysOverdue  = row._daysOverdue ? `${row._daysOverdue} hari` : '-';

      const issueRaw    = this.resolveField(row, 'issues') || '';
      // ✅ FIX v1.1.0: Naikkan limit Issues dari 150 → 600 char agar konten detail
      // (multi-line roadmap, milestone list, dll) tidak terpotong di tengah.
      // \n diganti <br> agar lebih readable di tabel, bukan dihapus.
      const issues      = (!issueRaw || issueRaw === '-' || issueRaw.toLowerCase() === 'no issue')
                          ? '-'
                          : this.truncate(issueRaw.replace(/\r?\n/g, ' | '), 600);

      const values = [name];
      if (cols.pm)         values.push(pm);
      if (cols.department) values.push(dept);
      values.push(status);
      if (cols.progress)   values.push(progress);
      if (cols.targetEnd)  values.push(targetEnd);
      if (cols.health)     values.push(`${healthEmoji} ${health}`);
      if (showDaysOverdue) values.push(daysOverdue);
      if (cols.issues)     values.push(issues);
      if (cols.daysSinceUpdate) {
        const days = this.resolveField(row, 'daysSinceUpdate');
        const daysNum = parseFloat(days);
        const daysStr = !isNaN(daysNum)
          ? `${Math.round(daysNum)}d ${daysNum > 30 ? '⚠️' : ''}`
          : '-';
        values.push(daysStr);
      }

      table += `| ${values.join(' | ')} |\n`;
    });

    return table + '\n';
  }

  // ─────────────────────────────────────────────────────────────
  // BUDGET TABLE
  // ─────────────────────────────────────────────────────────────
  rowsToTableWithBudget(rows, cols) {
    if (!rows.length) return 'Tidak ada data.\n\n';

    const allCols   = cols.allColumns;
    const budgetCols = allCols.filter(k => {
      const lower = k.toLowerCase();
      return (lower.includes('budget') || lower.includes('afe') || lower.includes('cost'))
        && !lower.includes('migrated') && !lower.includes('before') && !lower.includes('num');
    }).slice(0, 5);

    const headers = ['Project Name', 'PM', 'Currency', ...budgetCols];
    let table = `| ${headers.join(' | ')} |\n`;
    table    += `| ${headers.map((_, i) => i < 2 ? ':---' : '---:').join(' | ')} |\n`;

    rows.forEach(row => {
      const name     = this.truncate(this.resolveField(row, 'projectName') || '-', 35);
      const pm       = this.truncate(this.resolveField(row, 'pm') || '-', 20);
      const currency = row['Currency'] || 'IDR';

      const budgetVals = budgetCols.map(col => {
        const val = parseFloat(row[col]);
        return isNaN(val) ? '-' : this.formatNumber(val);
      });

      table += `| ${[name, pm, currency, ...budgetVals].join(' | ')} |\n`;
    });

    return table + '\n';
  }

  // ─────────────────────────────────────────────────────────────
  // CONTEXT: DOCUMENTATION TRACKING SHEET
  // ── FIXED: Tampilkan 6 kolom yang diminta:
  //    File Date | File Name | Activity | User | Activity Time | Document Link
  // ─────────────────────────────────────────────────────────────
  buildDocContext(flatRows, msg, today, context, cols) {
    // ── Normalize baris: pastikan semua alias activityTime terbaca dengan key standar
    const normalizedRows = flatRows.map(row => {
      const norm = { ...row };
      // Normalize 'Activity Time' (spasi) → juga bisa diakses via resolveField('activityTime')
      if (!norm['ActivityTime'] && norm['Activity Time']) {
        norm['ActivityTime'] = norm['Activity Time'];
      }
      return norm;
    });

    let filtered = [...normalizedRows];

    // ── Filter berdasarkan tipe aktivitas
    if (/hapus|delete|dihapus|deleted/i.test(msg))
      filtered = filtered.filter(r => (r['Activity'] || '').toLowerCase() === 'delete');
    else if (/edit|diubah|modified|changed/i.test(msg))
      filtered = filtered.filter(r => (r['Activity'] || '').toLowerCase() === 'edit');
    else if (/upload|add|ditambah|baru|terbaru|latest|recent/i.test(msg))
      filtered = filtered.filter(r => (r['Activity'] || '').toLowerCase() === 'add');

    // ── Filter berdasarkan waktu
    if (/minggu ini|this week/i.test(msg)) {
      const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
      filtered = filtered.filter(r => {
        const d = this.parseDate(this.resolveField(r, 'activityTime'));
        return d && d >= weekAgo;
      });
    } else if (/hari ini|today/i.test(msg)) {
      filtered = filtered.filter(r => {
        const d = this.parseDate(this.resolveField(r, 'activityTime'));
        return d && d.toDateString() === today.toDateString();
      });
    } else if (/bulan ini|this month/i.test(msg)) {
      filtered = filtered.filter(r => {
        const d = this.parseDate(this.resolveField(r, 'activityTime'));
        return d && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
      });
    }

    // ── Filter berdasarkan nama user (jika disebut di pesan)
    const userMatch = msg.match(/(?:dari|by|oleh|user)\s+([a-z]+(?:\s+[a-z]+)?)/i);
    if (userMatch) {
      const searchName = userMatch[1].toLowerCase();
      filtered = filtered.filter(r => {
        const user = String(this.resolveField(r, 'user') || '').toLowerCase();
        return user.includes(searchName);
      });
    }

    // ── Sort: terbaru dulu
    filtered.sort((a, b) => {
      const da = this.parseDate(this.resolveField(a, 'activityTime')) || new Date(0);
      const db = this.parseDate(this.resolveField(b, 'activityTime')) || new Date(0);
      return db - da;
    });

    const limited   = filtered.slice(0, 50);
    const truncated = filtered.length > 50;

    // ── Hitung statistik
    const addCount    = normalizedRows.filter(r => String(r['Activity'] || '').toLowerCase() === 'add').length;
    const editCount   = normalizedRows.filter(r => String(r['Activity'] || '').toLowerCase() === 'edit').length;
    const deleteCount = normalizedRows.filter(r => String(r['Activity'] || '').toLowerCase() === 'delete').length;

    // ── Ringkasan
    context += `--- RINGKASAN AKTIVITAS ---\n`;
    context += `📥 Add: ${addCount} | ✏️ Edit: ${editCount} | 🗑️ Delete: ${deleteCount}\n`;
    context += `👥 Total Records: ${normalizedRows.length}\n\n`;

    if (limited.length === 0) {
      context += `Tidak ada data yang cocok dengan filter.\n`;
      return context;
    }

    context += `--- DOKUMEN (${limited.length}${truncated ? ` dari ${filtered.length}` : ''}) ---\n`;

    // ── Tabel dengan 6 kolom yang diminta: File Date | File Name | Activity | User | Activity Time | Document Link
    context += `| File Date | File Name | Activity | User | Activity Time | Document Link |\n`;
    context += `| :--- | :--- | :---: | :--- | :--- | :--- |\n`;

    limited.forEach(row => {
      // File Date — bisa kosong, fallback '-'
      const fileDate    = this.formatDate(this.resolveField(row, 'fileDate')) || '-';

      // File Name — truncate panjang
      const fileNameRaw = this.resolveField(row, 'fileName') || '-';
      const fileName    = this.truncate(String(fileNameRaw), 50);

      // Activity — Add / Edit / Delete
      const activityRaw = row['Activity'] || '-';
      const actEmoji    = activityRaw.toLowerCase() === 'add'    ? '📥 Add'
                        : activityRaw.toLowerCase() === 'edit'   ? '✏️ Edit'
                        : activityRaw.toLowerCase() === 'delete' ? '🗑️ Delete'
                        : activityRaw;

      // User — FIX: sebelumnya kosong karena alias tidak terdaftar
      const user        = this.truncate(String(this.resolveField(row, 'user') || '-'), 30);

      // Activity Time — format tanggal + jam
      const actTimeRaw  = this.resolveField(row, 'activityTime');
      const actTime     = this.formatDateTime(actTimeRaw) || '-';

      // Document Link — buat markdown link jika ada
      const linkRaw     = this.resolveField(row, 'docLink');
      const docLink     = linkRaw ? `[🔗 Buka](${linkRaw})` : '-';

      context += `| ${fileDate} | ${fileName} | ${actEmoji} | ${user} | ${actTime} | ${docLink} |\n`;
    });

    if (truncated) {
      context += `\n⚠️ Menampilkan 50 dari ${filtered.length} hasil. Gunakan filter lebih spesifik (contoh: "edit minggu ini", "add oleh Felix").\n`;
    }

    return context;
  }

  // ─────────────────────────────────────────────────────────────
  // MULTI-SHEET: Fetch all sheets and build merged context
  // ─────────────────────────────────────────────────────────────
  /**
   * Fetch multiple sheets in parallel and build a merged AI context.
   * Each sheet is fetched independently; errors on individual sheets are
   * logged but do not abort the whole operation.
   *
   * @param {string[]} sheetIds   - Array of Smartsheet sheet IDs to fetch
   * @param {string}   userMessage - The user's query
   * @returns {string} merged context string ready to inject into AI prompt
   */
  async buildMultiSheetContext(sheetIds, userMessage) {
    if (!sheetIds || sheetIds.length === 0) {
      throw new Error('No sheet IDs provided');
    }

    // Deduplicate
    const uniqueIds = [...new Set(sheetIds.filter(Boolean))];
    console.log(`📡 [SmartsheetLive] Fetching ${uniqueIds.length} sheet(s): ${uniqueIds.join(', ')}`);

    // Fetch all sheets in parallel
    const results = await Promise.allSettled(
      uniqueIds.map(id => this.fetchSheet(id))
    );

    const successfulSheets = [];
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        successfulSheets.push(result.value);
      } else {
        console.error(`❌ [SmartsheetLive] Failed to fetch sheet ${uniqueIds[idx]}: ${result.reason?.message}`);
      }
    });

    if (successfulSheets.length === 0) {
      throw new Error(`Gagal memuat semua sheet (${uniqueIds.length} sheet dicoba)`);
    }

    // Build context for each sheet and merge
    const msg = (userMessage || '').toLowerCase();

    // ── Step 1: Try to find a single-project match across ALL sheets first ──
    // Collect all flat rows from all sheets with sheet metadata
    const allSheetData = successfulSheets.map(sheet => {
      const flatRows = this.processToFlatRows(sheet);
      return { sheet, flatRows };
    });

    // ── Step 2: Check if any sheet has a direct project match ──
    // ✅ FIX v1.4.1: Same 3 fixes as buildProjectContext (stopWords, normalizeStr, one-directional match)
    const stopWords = new Set([
      'give','show','status','project','proyek','please','what','the','and',
      'for','dari','me','is','are','how','ada','apa','yang','dengan','ini',
      'nya','saya','get','tell','find','tampilkan','cari','lihat','bagaimana',
      'gimana','update','latest','terbaru','info','informasi','detail','about',
      'tentang','mengenai','regarding','current','terkini','sekarang','progress',
      // ✅ NEW: query-type words that must never be treated as project name tokens
      'all','semua','overdue','delay','terlambat','active','aktif','complete',
      'selesai','done','finish','dashboard','summary','overview','statistik',
      'report','laporan','issue','masalah','kendala','risk','budget','biaya',
      'cost','anggaran','health','red','merah','kritis','critical','today',
      'hari','minggu','bulan','week','month','year','tahun','list','daftar',
    ]);
    const words       = msg.replace(/[^a-z0-9\s]/gi, ' ').split(/\s+/).filter(w => w.length >= 3);
    const searchWords = words.filter(w => !stopWords.has(w.toLowerCase()));

    const idToEnMap = {
      'aset': 'asset', 'sistem': 'system', 'jaringan': 'network',
      'gudang': 'warehouse', 'keuangan': 'finance', 'pembelian': 'procurement',
      'penjualan': 'sales', 'sdm': 'hr', 'kepegawaian': 'hr',
    };
    // ✅ FIX v1.4.1: Split on hyphens/spaces BEFORE alias mapping
    const normalizeStr = (s) => {
      const tokens = String(s || '').toLowerCase()
        .split(/[-\s]+/)
        .map(t => t.replace(/[^a-z0-9]/g, ''))
        .filter(Boolean)
        .map(t => idToEnMap[t] || t);
      return tokens.join('');
    };
    const genericProjectWords = new Set([
      'implementation','system','project','management','monitoring','improvement',
      'development','integration','upgrade','migration','installation','deployment',
      'aplikasi','sistem','proyek','manajemen','pengembangan','implementasi','new',
    ]);

    // Find best match across all sheets
    let globalBestScore = 0;
    let globalBestRow   = null;
    let globalBestSheet = null;

    if (searchWords.length > 0) {
      for (const { sheet, flatRows } of allSheetData) {
        if (!flatRows.length) continue;
        const cols = this.detectAvailableColumns(flatRows);
        // Only search project sheets (not doc tracking sheets)
        const hasProjectCols = cols.status || cols.progress || cols.targetEnd || cols.health;
        if (!hasProjectCols) continue;

        for (const row of flatRows) {
          const rawName  = String(this.resolveField(row, 'projectName') || '');
          const normName = normalizeStr(rawName);
          const nameParts = rawName.toLowerCase().replace(/-/g, ' ').split(/\s+/)
            .filter(p => p.length >= 2)
            .map(p => normalizeStr(p));

          let score = 0;
          for (const w of searchWords) {
            const normW  = normalizeStr(w);
            if (!normW || normW.length < 2) continue;
            const weight = genericProjectWords.has(normW) ? 1 : 3;
            // ✅ FIX v1.4.1: ONE-DIRECTIONAL — project name must contain search word, not reverse
            if (normName.includes(normW)) {
              score += weight;
            } else if (nameParts.some(p => p.includes(normW))) {
              score += weight;
            }
          }

          if (score > globalBestScore) {
            globalBestScore = score;
            globalBestRow   = row;
            globalBestSheet = sheet;
          }
        }
      }
    }

    // ── Step 3: If strong single-project match found, return detail from that sheet ──
    if (globalBestScore >= 2 && globalBestRow && globalBestSheet) {
      console.log(`✅ [SmartsheetLive] Cross-sheet match found in "${globalBestSheet.name}" (score=${globalBestScore})`);
      const flatRows = this.processToFlatRows(globalBestSheet);
      return this.buildAIContext(flatRows, userMessage, globalBestSheet.name);
    }

    // ── Step 4: No single match — build context from all sheets and merge ──
    const today = new Date();
    let mergedContext = '';

    for (const { sheet, flatRows } of allSheetData) {
      if (!flatRows.length) {
        mergedContext += `\n=== SHEET: ${sheet.name} ===\n(Tidak ada data)\n`;
        continue;
      }
      mergedContext += `\n${this.buildAIContext(flatRows, userMessage, sheet.name)}\n`;
    }

    const header = `=== SMARTSHEET DATA (${successfulSheets.length} sheet dimuat) ===\n` +
      `Sheet: ${successfulSheets.map(s => s.name).join(' | ')}\n` +
      `Tanggal: ${today.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;

    return header + mergedContext;
  }

  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────
  parseDate(str) {
    if (!str) return null;
    try { const d = new Date(str); return isNaN(d.getTime()) ? null : d; } catch { return null; }
  }

  formatDate(str) {
    const d = this.parseDate(str);
    if (!d) return null;
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── NEW: format tanggal + jam untuk Activity Time
  formatDateTime(str) {
    const d = this.parseDate(str);
    if (!d) return null;
    return d.toLocaleString('id-ID', {
      day:    '2-digit',
      month:  'short',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    });
  }

  formatNumber(num) {
    if (!num && num !== 0) return '-';
    return Number(num).toLocaleString('id-ID');
  }

  truncate(str, maxLen) {
    if (!str) return '-';
    str = String(str).replace(/\n/g, ' ').trim();
    return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
  }
}

export default SmartsheetLiveService;