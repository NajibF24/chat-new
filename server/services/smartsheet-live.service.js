// server/services/smartsheet-live.service.js
//
// ✅ LIVE FETCH - Tidak ada cache file lokal
// Setiap request langsung ambil dari Smartsheet API
// menggunakan API Key & Sheet ID dari konfigurasi bot

import axios from 'axios';

class SmartsheetLiveService {
  constructor(apiKey) {
    if (!apiKey) throw new Error('Smartsheet API Key tidak ditemukan di konfigurasi bot');

    this.apiKey = apiKey;
    this.baseURL = 'https://api.smartsheet.com/2.0';
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
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
        params: { include: 'attachments,discussions', level: 2 }
      });

      const sheet = response.data;
      console.log(`✅ [SmartsheetLive] Sheet "${sheet.name}" - ${sheet.rows?.length || 0} rows`);
      return sheet;
    } catch (error) {
      if (error.response?.status === 401) throw new Error('API Key Smartsheet tidak valid atau sudah expired');
      if (error.response?.status === 403) throw new Error('API Key tidak punya akses ke sheet ini');
      if (error.response?.status === 404) throw new Error(`Sheet ID ${sheetId} tidak ditemukan`);
      throw new Error(`Gagal fetch Smartsheet: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PROSES RAW SHEET → FLAT ROWS
  // ─────────────────────────────────────────────────────────────
  processToFlatRows(sheet) {
    if (!sheet.rows || !sheet.columns) return [];

    return sheet.rows.map(row => {
      const flat = {};
      row.cells.forEach(cell => {
        const column = sheet.columns.find(c => c.id === cell.columnId);
        if (column) {
          flat[column.title] = cell.displayValue || cell.value || null;
        }
      });
      return flat;
    });
  }

  // ─────────────────────────────────────────────────────────────
  // BUILD CONTEXT UNTUK AI (SMART FILTER BERDASARKAN PERTANYAAN)
  // ─────────────────────────────────────────────────────────────
  buildAIContext(flatRows, userMessage, sheetName) {
    const today = new Date();
    const msg = (userMessage || '').toLowerCase();

    // Categorize rows
    const categorized = this.categorizeRows(flatRows, today);

    // Detect what user is asking
    const intent = this.detectIntent(msg);

    let context = `=== DATA SMARTSHEET: ${sheetName} ===\n`;
    context += `Tanggal hari ini: ${today.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`;
    context += `Total data: ${flatRows.length} rows\n\n`;

    // Selalu sertakan summary status
    context += `--- RINGKASAN STATUS ---\n`;
    context += `✅ Completed: ${categorized.completed.length}\n`;
    context += `🔴 Overdue: ${categorized.overdue.length}\n`;
    context += `🟢 Active/On Track: ${categorized.active.length}\n`;
    context += `⛔ Canceled: ${categorized.canceled.length}\n\n`;

    // Berikan data yang relevan sesuai intent
    if (intent === 'overdue' || /overdue|terlambat|delay|melewati/i.test(msg)) {
      context += `--- PROYEK OVERDUE (${categorized.overdue.length}) ---\n`;
      context += this.rowsToTable(categorized.overdue, today);

    } else if (intent === 'completed' || /selesai|complete|done|finish/i.test(msg)) {
      context += `--- PROYEK COMPLETED (${categorized.completed.length}) ---\n`;
      context += this.rowsToTable(categorized.completed, today);

    } else if (intent === 'active' || /aktif|active|on.?track|berjalan/i.test(msg)) {
      context += `--- PROYEK ACTIVE (${categorized.active.length}) ---\n`;
      context += this.rowsToTable(categorized.active, today);

    } else if (/budget|biaya|cost|anggaran/i.test(msg)) {
      context += `--- DATA BUDGET PROYEK ---\n`;
      context += this.rowsToTableWithBudget(flatRows);

    } else if (/pm|project manager|siapa|who/i.test(msg)) {
      context += `--- SEMUA PROYEK DENGAN PM ---\n`;
      context += this.rowsToTable(flatRows.filter(r => r['Project Status'] !== 'Complete'), today);

    } else {
      // Default: kirim semua data aktif + overdue
      const relevant = [...categorized.overdue, ...categorized.active];
      context += `--- PROYEK AKTIF & OVERDUE (${relevant.length}) ---\n`;
      context += this.rowsToTable(relevant, today);

      if (categorized.completed.length > 0) {
        context += `\n(${categorized.completed.length} proyek Completed tidak ditampilkan. Minta spesifik untuk melihat.)\n`;
      }
    }

    return context;
  }

  // ─────────────────────────────────────────────────────────────
  // KATEGORISASI ROWS
  // ─────────────────────────────────────────────────────────────
  categorizeRows(flatRows, today) {
    const result = { completed: [], overdue: [], active: [], canceled: [] };

    flatRows.forEach(row => {
      // Support both possible column name variants
      const status = (
        row['Project Status'] ||
        row['Status'] || ''
      ).trim();

      const progressRaw = (
        row['Overall Progress (%)'] ||
        row['Progress'] ||
        row['Overall Progress'] ||
        0
      );

      // Progress bisa berupa float 0-1 (dari Smartsheet) atau 0-100
      const progress = parseFloat(progressRaw) || 0;
      const progressNormalized = progress > 1 ? progress / 100 : progress;

      const targetEnd = this.parseDate(
        row['Target End Date'] ||
        row['Target End'] ||
        row['Due Date'] ||
        null
      );

      // Completed
      if (
        status === 'Complete' ||
        status === 'Completed' ||
        progressNormalized >= 1.0
      ) {
        result.completed.push(row);
        return;
      }

      // Canceled
      if (status === 'Canceled' || status === 'Cancelled') {
        result.canceled.push(row);
        return;
      }

      // Overdue: status aktif tapi tanggal sudah lewat
      if (targetEnd && targetEnd < today) {
        const daysOverdue = Math.floor((today - targetEnd) / (1000 * 60 * 60 * 24));
        row._daysOverdue = daysOverdue;
        result.overdue.push(row);
        return;
      }

      // Active
      result.active.push(row);
    });

    // Sort overdue: paling terlambat dulu
    result.overdue.sort((a, b) => (b._daysOverdue || 0) - (a._daysOverdue || 0));

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // FORMAT ROWS → MARKDOWN TABLE
  // ─────────────────────────────────────────────────────────────
  rowsToTable(rows, today) {
    if (rows.length === 0) return 'Tidak ada data.\n\n';

    let table = `| Project Name | PM | Status | Progress | Target End | Health | Days Overdue |\n`;
    table += `|:---|:---|:---|:---:|:---|:---:|:---:|\n`;

    rows.forEach(row => {
      const name = this.truncate(
        row['Project Name'] || row['Project ID'] || '-', 35
      );
      const pm = this.truncate(
        row['Project Manager'] || row['PM'] || '-', 25
      );
      const status = row['Project Status'] || row['Status'] || '-';

      // Progress: Smartsheet kirim 0-1 float, convert ke %
      const progressRaw = parseFloat(
        row['Overall Progress (%)'] || row['Progress'] || 0
      );
      const progressPct = progressRaw > 1
        ? Math.round(progressRaw)
        : Math.round(progressRaw * 100);
      const progress = `${progressPct}%`;

      const health = row['Schedule Health'] || row['Health'] || '-';
      const healthEmoji = health === 'Green' ? '🟢'
        : health === 'Yellow' ? '🟡'
        : health === 'Red' ? '🔴' : '-';

      const targetEndRaw = row['Target End Date'] || row['Target End'] || null;
      const targetEnd = targetEndRaw ? this.formatDate(targetEndRaw) : '-';

      let daysOverdue = '-';
      if (row._daysOverdue) {
        daysOverdue = `${row._daysOverdue} hari`;
      } else if (today && targetEndRaw) {
        const endDate = this.parseDate(targetEndRaw);
        if (endDate && endDate < today) {
          daysOverdue = `${Math.floor((today - endDate) / (1000 * 60 * 60 * 24))} hari`;
        }
      }

      table += `| ${name} | ${pm} | ${status} | ${progress} | ${targetEnd} | ${healthEmoji} ${health} | ${daysOverdue} |\n`;
    });

    return table + '\n';
  }

  rowsToTableWithBudget(rows) {
    if (rows.length === 0) return 'Tidak ada data.\n\n';

    let table = `| Project Name | PM | Budget Plan | Budget Actual | Currency | Variance |\n`;
    table += `|:---|:---|---:|---:|:---:|---:|\n`;

    rows.forEach(row => {
      const name = this.truncate(row['Project Name'] || '-', 35);
      const pm = this.truncate(row['Project Manager'] || '-', 20);
      const plan = this.formatNumber(row['Budget Plan Total']);
      const actual = this.formatNumber(row['Budget Actual Total']);
      const currency = row['Currency'] || 'IDR';
      const planNum = parseFloat(row['Budget Plan Total']) || 0;
      const actualNum = parseFloat(row['Budget Actual Total']) || 0;
      const variance = this.formatNumber(planNum - actualNum);

      table += `| ${name} | ${pm} | ${plan} | ${actual} | ${currency} | ${variance} |\n`;
    });

    return table + '\n';
  }

  // ─────────────────────────────────────────────────────────────
  // DETECT INTENT
  // ─────────────────────────────────────────────────────────────
  detectIntent(msg) {
    if (/overdue|terlambat|delay|melewati|lewat/i.test(msg)) return 'overdue';
    if (/selesai|complete|done|finish/i.test(msg)) return 'completed';
    if (/aktif|active|on.?track|berjalan|in.?progress/i.test(msg)) return 'active';
    if (/summary|overview|semua|all|dashboard|statistik/i.test(msg)) return 'summary';
    return 'default';
  }

  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────
  parseDate(str) {
    if (!str) return null;
    try {
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    } catch { return null; }
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
    return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
  }
}

export default SmartsheetLiveService;
