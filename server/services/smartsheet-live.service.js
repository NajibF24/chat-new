// server/services/smartsheet-live.service.js
//
// ✅ FULLY DYNAMIC — Tidak ada hardcode kolom
// Semua kolom dibaca langsung dari sheet apapun yang dikonfigurasi di bot.
// Kalau sheet baru ditambahkan dengan kolom berbeda, otomatis terbaca.

import axios from 'axios';

// ─────────────────────────────────────────────────────────────
// COLUMN ALIAS MAP
// Digunakan untuk mengenali kolom "penting" tanpa peduli nama persisnya.
// Key = nama canonical internal, Value = array kemungkinan nama di Smartsheet
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
  // Baris dianggap header jika cell pertama isinya sama dengan nama kolom pertama
  const firstColTitle = sheet.columns[0]?.title || '';

  return sheet.rows
    .filter(row => {
      const firstCell = row.cells?.[0];
      const firstVal  = firstCell?.displayValue ?? firstCell?.value ?? '';
      // Skip jika row ini isinya = nama kolom (header duplikat)
      return String(firstVal).trim() !== firstColTitle.trim();
    })
    .map(row => {
      const flat = {};
      row.cells.forEach(cell => {
        const title = colMap[cell.columnId];
        if (title) {
          // ✅ FIX: displayValue dulu (formula columns), fallback ke value
          flat[title] = cell.displayValue ?? cell.value ?? null;
        }
      });
      return flat;
    });
}

  // ─────────────────────────────────────────────────────────────
  // RESOLVE ALIAS: cari nilai dari flat row berdasarkan alias map
  // ─────────────────────────────────────────────────────────────
  resolveField(row, canonicalKey) {
    const aliases = COLUMN_ALIASES[canonicalKey] || [];
    for (const alias of aliases) {
      if (row[alias] !== undefined && row[alias] !== null) {
        return row[alias];
      }
    }
    return null;
  }

  // Resolve alias + return actual column name found
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
  // Returns object: { hasIssues, hasHealth, hasBudget, hasDepartment, ... }
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
      // Extra: detect any budget columns dynamically
      budgetCols:   allKeys.filter(k => k.toLowerCase().includes('budget') || k.toLowerCase().includes('afe') || k.toLowerCase().includes('cost')),
      // All raw column names (for unknown sheet types)
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

    // ── Detect sheet type ──────────────────────────────────────
    const isDocSheet = cols.allColumns.some(k =>
      ['Activity', 'ActivityTime', 'Activity Time', 'File Name'].includes(k)
    );

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

    // Summary counts
    context += `--- RINGKASAN STATUS ---\n`;
    context += `✅ Completed : ${categorized.completed.length}\n`;
    context += `🔴 Overdue   : ${categorized.overdue.length}\n`;
    context += `🟢 Active    : ${categorized.active.length}\n`;
    context += `⛔ Canceled  : ${categorized.canceled.length}\n\n`;

    // Route by intent
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
      // Show all with issues
      const withIssues = flatRows.filter(row => {
        const issue = this.resolveField(row, 'issues');
        return issue && issue !== '-' && issue.toLowerCase() !== 'no issue' && issue.trim() !== '';
      });
      context += `--- PROYEK DENGAN ISSUES (${withIssues.length}) ---\n`;
      context += this.rowsToTable(withIssues, today, cols, false);

    } else if (/summary|overview|dashboard|semua|all|statistik/i.test(msg)) {
      // Full summary: overdue + active
      const relevant = [...categorized.overdue, ...categorized.active];
      context += `--- SEMUA PROYEK AKTIF & OVERDUE (${relevant.length}) ---\n`;
      context += this.rowsToTable(relevant, today, cols, true);
      if (categorized.completed.length > 0) {
        context += `\n(${categorized.completed.length} proyek Completed tidak ditampilkan untuk ringkas.)\n`;
      }

    } else {
      // Default: overdue + active
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
  // KATEGORISASI ROWS (dinamis via alias)
  // ─────────────────────────────────────────────────────────────
  categorizeRows(flatRows, today, cols) {
    const result = { completed: [], overdue: [], active: [], canceled: [] };

    flatRows.forEach(row => {
      const status    = String(this.resolveField(row, 'status') || '').trim();
      const targetEnd = this.parseDate(this.resolveField(row, 'targetEnd'));

      // Normalize progress: Smartsheet sends 0-1 float OR 0-100
      const progressRaw = parseFloat(this.resolveField(row, 'progress') || 0) || 0;
      const progressPct = progressRaw > 1 ? progressRaw : progressRaw * 100;

      // Completed
      if (
        status.toLowerCase() === 'complete' ||
        status.toLowerCase() === 'completed' ||
        progressPct >= 100
      ) {
        result.completed.push(row);
        return;
      }

      // Canceled
      if (status.toLowerCase() === 'canceled' || status.toLowerCase() === 'cancelled') {
        result.canceled.push(row);
        return;
      }

      // Overdue
      if (targetEnd && targetEnd < today) {
        const daysOverdue = Math.floor((today - targetEnd) / (1000 * 60 * 60 * 24));
        row._daysOverdue  = daysOverdue;
        result.overdue.push(row);
        return;
      }

      // Active
      result.active.push(row);
    });

    // Sort overdue: most days first
    result.overdue.sort((a, b) => (b._daysOverdue || 0) - (a._daysOverdue || 0));

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // FORMAT TABLE — Dinamis: hanya tampilkan kolom yang ada
  // ─────────────────────────────────────────────────────────────
  rowsToTable(rows, today, cols, showDaysOverdue = false) {
    if (!rows.length) return 'Tidak ada data.\n\n';

    // Build header dynamically based on what columns exist
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
    table    += `| ${headers.map((h, i) => {
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

      // Issues: clean up '-' and 'No Issue', truncate long text
      const issueRaw    = this.resolveField(row, 'issues') || '';
      const issues      = (!issueRaw || issueRaw === '-' || issueRaw.toLowerCase() === 'no issue')
                          ? '-'
                          : this.truncate(issueRaw.replace(/\n/g, ' '), 150);

      // Build row values in same order as headers
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
  // BUDGET TABLE — Dinamis: ambil semua kolom budget yang ada
  // ─────────────────────────────────────────────────────────────
  rowsToTableWithBudget(rows, cols) {
    if (!rows.length) return 'Tidak ada data.\n\n';

    // Find all budget columns dynamically
    const allCols   = cols.allColumns;
    const budgetCols = allCols.filter(k => {
      const lower = k.toLowerCase();
      return (lower.includes('budget') || lower.includes('afe') || lower.includes('cost'))
        && !lower.includes('migrated') && !lower.includes('before') && !lower.includes('num');
    }).slice(0, 5); // max 5 budget cols to keep table readable

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
  // CONTEXT: DOCUMENTATION TRACKING SHEET (dinamis)
  // ─────────────────────────────────────────────────────────────
  buildDocContext(flatRows, msg, today, context, cols) {
    // Normalize ActivityTime column name
    const normalizedRows = flatRows.map(row => {
      const norm = { ...row };
      if (!norm['ActivityTime'] && norm['Activity Time']) {
        norm['ActivityTime'] = norm['Activity Time'];
      }
      return norm;
    });

    let filtered = [...normalizedRows];

    // Filter by activity type
    if (/hapus|delete|dihapus|deleted/i.test(msg))        filtered = filtered.filter(r => (r['Activity'] || '').toLowerCase() === 'delete');
    else if (/edit|diubah|modified|changed/i.test(msg))   filtered = filtered.filter(r => (r['Activity'] || '').toLowerCase() === 'edit');
    else if (/upload|add|ditambah|baru|terbaru|latest|recent/i.test(msg)) filtered = filtered.filter(r => (r['Activity'] || '').toLowerCase() === 'add');

    // Filter by date
    if (/minggu ini|this week/i.test(msg)) {
      const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
      filtered = filtered.filter(r => { const d = this.parseDate(r['ActivityTime']); return d && d >= weekAgo; });
    } else if (/hari ini|today/i.test(msg)) {
      filtered = filtered.filter(r => { const d = this.parseDate(r['ActivityTime']); return d && d.toDateString() === today.toDateString(); });
    } else if (/bulan ini|this month/i.test(msg)) {
      filtered = filtered.filter(r => { const d = this.parseDate(r['ActivityTime']); return d && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear(); });
    }

    // Sort newest first
    filtered.sort((a, b) => {
      const da = this.parseDate(a['ActivityTime']) || new Date(0);
      const db = this.parseDate(b['ActivityTime']) || new Date(0);
      return db - da;
    });

    const limited   = filtered.slice(0, 50);
    const truncated = filtered.length > 50;

    const addCount    = normalizedRows.filter(r => r['Activity'] === 'Add').length;
    const editCount   = normalizedRows.filter(r => r['Activity'] === 'Edit').length;
    const deleteCount = normalizedRows.filter(r => r['Activity'] === 'Delete').length;

    context += `--- RINGKASAN AKTIVITAS ---\n`;
    context += `📥 Add: ${addCount} | ✏️ Edit: ${editCount} | 🗑️ Delete: ${deleteCount}\n\n`;
    context += `--- DOKUMEN (${limited.length}${truncated ? ` dari ${filtered.length}` : ''}) ---\n`;

    // Dynamic columns for doc table
    const docCols = cols.allColumns.filter(k =>
      !['Documents Link', 'Link of the document', 'Folder Location'].includes(k)
    ).slice(0, 8);

    const linkCol = cols.allColumns.find(k => k.toLowerCase().includes('link') || k.toLowerCase().includes('url'));

    context += `| ${docCols.join(' | ')}${linkCol ? ' | Link' : ''} |\n`;
    context += `| ${docCols.map(() => ':---').join(' | ')}${linkCol ? ' | :---' : ''} |\n`;

    limited.forEach(row => {
      const vals = docCols.map(col => this.truncate(String(row[col] || '-'), 40));
      if (linkCol) {
        const link = row[linkCol];
        vals.push(link ? `[Buka](${link})` : '-');
      }
      context += `| ${vals.join(' | ')} |\n`;
    });

    if (truncated) context += `\n⚠️ Menampilkan 50 dari ${filtered.length} hasil. Gunakan filter lebih spesifik.\n`;

    return context;
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
    if (!d) return '-';
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
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
