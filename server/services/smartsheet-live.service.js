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

            // ✅ PATCH v1.5.3: Number cells → always use rawVal (the actual number).
            // Using displayValue for numbers is dangerous: Smartsheet formats numbers
            // using the sheet's regional locale (e.g. Indonesian/European sheets use
            // dots as thousand separators: 450000001 → "450.000.001").
            // When this string reaches the AI, it reads "450.000.001" as 450 or 666.4.
            // Fix: use rawVal for numbers, displayValue only for dates/text/formulas.
            const isNumberCell  = typeof rawVal === 'number';
            const isBooleanCell = typeof rawVal === 'boolean';
            const isDateCell    = typeof rawVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(displayVal || '');

            let cellValue;
            if (isNumberCell) {
              // Always use the raw number — format it ourselves with en-US locale
              cellValue = rawVal;
            } else if (isBooleanCell) {
              cellValue = displayVal ?? rawVal;
            } else if (rawVal === null && displayVal !== null) {
              // No raw value (formula result, date, etc.) — use display
              cellValue = displayVal;
            } else {
              // Text cells: prefer rawVal (full text), fallback to displayVal
              cellValue = rawVal ?? displayVal ?? null;
            }

            // ✅ FIX: Strip HTML from string values at source.
            // Smartsheet stores rich-text (Issues, Remarks, etc.) as HTML with <br>, <b>, etc.
            // We clean it here so ALL downstream consumers get plain text automatically.
            if (typeof cellValue === 'string') {
              cellValue = this.stripHtml(cellValue);
            }

            flat[title] = cellValue;
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
    context     += `Today: ${today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`;
    context     += `Total data: ${flatRows.length} rows\n`;
    context     += `Available columns: ${cols.allColumns.join(', ')}\n\n`;

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
    // ═══════════════════════════════════════════════════════════
    // ✅ v2.0 — UNIVERSAL FILTER ENGINE
    // Supports ANY combination of filters extracted from natural language:
    //   • Department / Dept / Divisi
    //   • PM / Project Manager / PIC
    //   • Status (active, complete, overdue, canceled, not started, in progress)
    //   • Schedule Health (red, yellow, green)
    //   • Target End Date / deadline range (before/after/in month/year)
    //   • Budget (show budget columns, filter has-budget, group by dept)
    //   • Vendor
    //   • Classification (strategic, operational, essential)
    //   • Issues (projects with issues)
    //   • Single project name (detail view)
    //   • Free-text fallback (active+overdue default)
    // Filters are applied in combination — e.g. "budget project by Rizal in dept IT"
    // ═══════════════════════════════════════════════════════════

    const allRows = flatRows.filter(row => {
      const name = String(this.resolveField(row, 'projectName') || '');
      return name && name !== 'Project Name' && name !== '-';
    });

    // ── STEP 1: Extract all active filters from message ──────────────────────

    // 1a. Department filter
    const deptPatterns = [
      /(?:department|dept|divisi|division)\s+(?:is\s+|=\s*|:\s*|dari\s+|from\s+)?([a-zA-Z0-9 &()\/]+?)(?:\s*$|\s+(?:and|or|by|with|where|yang|project|status|pm|budget|vendor)\b)/i,
      /(?:project[s]?\s+(?:where|with|yang|dari)\s+)?(?:department|dept|divisi)\s*[=:]\s*([a-zA-Z0-9 &()\/]+?)(?:\s*$|\s+(?:and|or|by|with)\b)/i,
    ];
    let deptFilter = null;
    for (const pat of deptPatterns) {
      const m = msg.match(pat);
      if (m && m[1] && m[1].trim().length >= 2) {
        deptFilter = m[1].trim();
        break;
      }
    }

    // 1b. PM filter
    const pmPatterns = [
      /(?:pm|project\s*manager|pic|manager|handled\s*by|managed\s*by|by\s+pm|oleh\s+pm|oleh)\s+([A-Za-z][a-zA-Z\s\/&]+?)(?:\s*$|\s+(?:and|or|in|at|with|where|department|dept|status|budget)\b)/i,
      /(?:project[s]?\s+(?:by|from|milik|managed\s*by))\s+([A-Za-z][a-zA-Z\s\/&]+?)(?:\s*$|\s+(?:and|or|in|at|with|where|department|dept|status|budget)\b)/i,
    ];
    let pmFilter = null;
    for (const pat of pmPatterns) {
      const m = msg.match(pat);
      if (m && m[1] && m[1].trim().length >= 2) {
        pmFilter = m[1].trim();
        break;
      }
    }

    // 1c. Status filter (explicit keyword)
    let statusFilter = null;
    if (/\b(in[\s-]?progress|berjalan|aktif|active|on[\s-]?track)\b/i.test(msg)) statusFilter = 'active';
    else if (/\b(complete[d]?|selesai|done|finish(?:ed)?)\b/i.test(msg)) statusFilter = 'complete';
    else if (/\b(overdue|terlambat|delay(?:ed)?|melewati|lewat)\b/i.test(msg)) statusFilter = 'overdue';
    else if (/\b(cancel(?:ed|led)?|dibatal(?:kan)?)\b/i.test(msg)) statusFilter = 'canceled';
    else if (/\b(not[\s-]?started|belum\s*dimulai|belum\s*mulai)\b/i.test(msg)) statusFilter = 'not_started';

    // 1d. Health / RAG filter
    let healthFilter = null;
    if (/\b(red|merah|kritis|critical|at[\s-]?risk)\b/i.test(msg)) healthFilter = 'Red';
    else if (/\b(yellow|kuning|warning|waspada)\b/i.test(msg)) healthFilter = 'Yellow';
    else if (/\b(green|hijau|on[\s-]?track)\b/i.test(msg)) healthFilter = 'Green';

    // 1e. Date filter — target end date
    //   "due before March 2026", "ending in April", "deadline this month", "overdue since Jan"
    let dateFilter = null;
    const monthNames = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
      januari:0,februari:1,maret:2,april:3,mei:4,juni:5,juli:6,agustus:7,september:8,oktober:9,november:10,desember:11 };
    const dateMatch = msg.match(/(?:before|sebelum|by|due|deadline|ending|berakhir|end)\s+(?:in\s+)?([a-z]+)\s*(\d{4})?/i)
      || msg.match(/(?:in|pada|bulan)\s+([a-z]+)\s*(\d{4})?/i)
      || msg.match(/(?:this\s+month|bulan\s+ini)/i);
    if (dateMatch) {
      if (/this\s+month|bulan\s+ini/i.test(msg)) {
        dateFilter = { month: today.getMonth(), year: today.getFullYear(), type: 'month' };
      } else {
        const mName = (dateMatch[1] || '').toLowerCase().substring(0, 3);
        const mIdx = monthNames[mName] ?? monthNames[Object.keys(monthNames).find(k => k.startsWith(mName))] ?? null;
        const yr = dateMatch[2] ? parseInt(dateMatch[2]) : today.getFullYear();
        if (mIdx !== null) {
          const isBefore = /before|sebelum|by\s/i.test(msg);
          const isAfter  = /after|setelah|since/i.test(msg);
          dateFilter = { month: mIdx, year: yr, type: isBefore ? 'before' : isAfter ? 'after' : 'month' };
        }
      }
    }

    // 1f. Vendor filter
    const vendorMatch = msg.match(/(?:vendor|contractor|kontraktor)\s+(?:is\s+|=\s*|:\s*|dari\s+|from\s+)?([A-Za-z][a-zA-Z0-9\s.&]+?)(?:\s*$|\s+(?:and|or|in|with|where|department|status|budget)\b)/i);
    let vendorFilter = vendorMatch ? vendorMatch[1].trim() : null;

    // 1g. Classification filter
    let classFilter = null;
    if (/\b(strategic|growth|strategis)\b/i.test(msg)) classFilter = 'strategic';
    else if (/\b(operational|efficiency|operasional|efisiensi)\b/i.test(msg)) classFilter = 'operational';
    else if (/\b(essential|compliance|esensial|kepatuhan)\b/i.test(msg)) classFilter = 'essential';

    // 1h. Budget mode & issues mode
    const isBudgetQuery  = /\b(budget|biaya|cost|anggaran|afe|expenditure|spend)\b/i.test(msg);
    const isIssueQuery   = /\b(issue|masalah|kendala|risk|problem|blocker)\b/i.test(msg);
    const isShowAll      = /\b(all|semua)\b/i.test(msg) && !deptFilter && !pmFilter && !statusFilter;
    const isSummaryQuery = /\b(summary|overview|dashboard|statistik|rekap)\b/i.test(msg);
    const groupByDept    = /group.*dept|dept.*group|by\s+dept|per\s+dept|per\s+department|by\s+department/i.test(msg);

    // ── STEP 2: Check for single-project name match ──────────────────────────
    // Only run if no strong structural filters present
    const hasStructuralFilter = deptFilter || pmFilter || statusFilter || healthFilter || dateFilter || vendorFilter || classFilter || isBudgetQuery || isIssueQuery || isShowAll || isSummaryQuery;

    if (!hasStructuralFilter) {
      const stopWords = new Set([
        'give','show','status','project','proyek','please','what','the','and',
        'for','dari','me','is','are','how','ada','apa','yang','dengan','ini',
        'nya','saya','get','tell','find','tampilkan','cari','lihat','bagaimana',
        'gimana','update','latest','terbaru','info','informasi','detail','about',
        'tentang','mengenai','regarding','current','terkini','sekarang','progress',
        'all','semua','overdue','delay','terlambat','active','aktif','complete',
        'selesai','done','finish','dashboard','summary','overview','statistik',
        'report','laporan','issue','masalah','kendala','risk','budget','biaya',
        'cost','anggaran','health','red','merah','kritis','critical','today',
        'hari','minggu','bulan','week','month','year','tahun','list','daftar',
      ]);
      const idToEnMap = { 'aset':'asset','sistem':'system','jaringan':'network','gudang':'warehouse','keuangan':'finance','pembelian':'procurement','penjualan':'sales','sdm':'hr','kepegawaian':'hr' };
      const normalizeStr = (s) => String(s||'').toLowerCase().split(/[-\s]+/).map(t=>t.replace(/[^a-z0-9]/g,'')).filter(Boolean).map(t=>idToEnMap[t]||t).join('');
      const genericWords = new Set(['implementation','system','project','management','monitoring','improvement','development','integration','upgrade','migration','installation','deployment','aplikasi','sistem','proyek','manajemen','pengembangan','implementasi','new']);
      const words = msg.replace(/[^a-z0-9\s]/gi,' ').split(/\s+/).filter(w=>w.length>=3);
      const searchWords = words.filter(w=>!stopWords.has(w.toLowerCase()));

      let bestScore = 0, singleMatch = null;
      if (searchWords.length > 0) {
        for (const row of allRows) {
          const rawName  = String(this.resolveField(row,'projectName')||'');
          const normName = normalizeStr(rawName);
          const nameParts = rawName.toLowerCase().replace(/-/g,' ').split(/\s+/).filter(p=>p.length>=2).map(p=>normalizeStr(p));
          let score = 0;
          for (const w of searchWords) {
            const normW = normalizeStr(w);
            if (!normW||normW.length<2) continue;
            const weight = genericWords.has(normW)?1:3;
            if (normName.includes(normW)||nameParts.some(p=>p.includes(normW))) score+=weight;
          }
          if (score>bestScore){ bestScore=score; singleMatch=row; }
        }
        if (bestScore<2) singleMatch=null;
      }

      if (singleMatch) {
        const safeNum = (v) => { if(v===null||v===undefined||v==='')return null; const n=typeof v==='number'?v:parseFloat(String(v).replace(/[^0-9.-]/g,'')); return isNaN(n)?null:n; };
        const issueRaw    = this.stripHtml(this.resolveField(singleMatch,'issues')||'-');
        const projectName = this.resolveField(singleMatch,'projectName')||'-';
        const pm          = this.resolveField(singleMatch,'pm')||'-';
        const status      = this.resolveField(singleMatch,'status')||'-';
        const progressRaw = parseFloat(this.resolveField(singleMatch,'progress')||0)||0;
        const progressPct = progressRaw>1?Math.round(progressRaw):Math.round(progressRaw*100);
        const health      = this.resolveField(singleMatch,'health')||'-';
        const targetEnd   = this.formatDate(this.resolveField(singleMatch,'targetEnd'))||'-';
        const dept        = this.resolveField(singleMatch,'department')||'-';
        const vendor      = this.resolveField(singleMatch,'vendor')||'-';
        const remarks     = this.stripHtml(this.resolveField(singleMatch,'remarks')||'-');
        const healthEmoji = health==='Green'?'🟢':health==='Yellow'?'🟡':health==='Red'?'🔴':'⚪';
        const daysOverdue = singleMatch._daysOverdue?`${singleMatch._daysOverdue} hari`:'-';
        const lastModified = this.formatDate(this.resolveField(singleMatch,'lastModified'))||'-';
        const daysSinceRaw = this.resolveField(singleMatch,'daysSinceUpdate');
        const daysSinceNum = parseFloat(daysSinceRaw);
        const daysSince    = !isNaN(daysSinceNum)?`${Math.round(daysSinceNum)} hari${daysSinceNum>30?' ⚠️':''}`:'-';
        const currency     = singleMatch['Currency']||null;
        const planNum      = safeNum(singleMatch['Budget Plan Total']);
        const commitNum    = safeNum(singleMatch['Budget Commitment Total']);
        const actualNum    = safeNum(singleMatch['Budget Actual Total']);
        const cur          = currency||'IDR';
        const hasBudget    = planNum!==null&&planNum>0||actualNum!==null&&actualNum>0;
        const fmtMoney     = (n)=>n===null?'N/A':`${cur} ${this.formatNumber(n)}`;
        const varianceNum  = (planNum!==null&&actualNum!==null)?planNum-actualNum:null;
        const varianceFmt  = varianceNum===null?'N/A':`${cur} ${this.formatNumber(varianceNum)}${varianceNum<0?' 🔴 OVER BUDGET':' ✅'}`;
        context+=`--- PROJECT DETAIL: ${projectName} ---\n`;
        context+=`Project Name        : ${projectName}\n`;
        context+=`PM                  : ${pm}\n`;
        context+=`Department          : ${dept}\n`;
        context+=`Status              : ${status}\n`;
        context+=`Progress            : ${progressPct}%\n`;
        context+=`Health              : ${healthEmoji} ${health}\n`;
        context+=`Target End          : ${targetEnd}\n`;
        context+=`Days Overdue        : ${daysOverdue}\n`;
        context+=`Last Modified       : ${lastModified}\n`;
        context+=`Days Since Update   : ${daysSince}\n`;
        context+=`Vendor              : ${vendor}\n`;
        if (hasBudget) {
          context+=`\n--- BUDGET ---\n`;
          context+=`Currency            : ${cur}\n`;
          context+=`Budget Plan Total   : ${fmtMoney(planNum)}\n`;
          context+=`Budget Commitment   : ${fmtMoney(commitNum)}\n`;
          context+=`Budget Actual Total : ${fmtMoney(actualNum)}\n`;
          context+=`Variance (Plan-Act) : ${varianceFmt}\n`;
        } else {
          context+=`Budget              : No budget data entered\n`;
        }
        context+=`\n--- ISSUES & REMARKS ---\n`;
        context+=`Remarks             : ${remarks}\n`;
        context+=`Issues              :\n${issueRaw}\n`;
        return context;
      }
    }

    // ── STEP 3: Apply all filters to get the working row set ─────────────────
    let filtered = [...allRows];
    const activeFilters = [];

    if (deptFilter) {
      const dl = deptFilter.toLowerCase();
      filtered = filtered.filter(row => {
        const dept = String(this.resolveField(row,'department')||'').toLowerCase();
        return dept.includes(dl) || dl.split('(')[0].trim().split(/\s+/).every(w => dept.includes(w));
      });
      activeFilters.push(`Department: "${deptFilter}"`);
    }

    // Guard: if pmFilter accidentally captured "department X", discard it
    if (pmFilter && /^(?:department|dept|divisi|division|status|budget|vendor)/i.test(pmFilter)) {
      pmFilter = null;
    }
    if (pmFilter) {
      const pl = pmFilter.toLowerCase();
      filtered = filtered.filter(row => {
        const pm = String(this.resolveField(row,'pm')||'').toLowerCase();
        return pm.includes(pl) || pl.split(/\s+/).some(w => w.length>=3 && pm.includes(w));
      });
      activeFilters.push(`PM: "${pmFilter}"`);
    }

    if (statusFilter) {
      const categorized = this.categorizeRows(filtered, today, cols);
      if      (statusFilter==='active')      filtered = categorized.active;
      else if (statusFilter==='complete')    filtered = categorized.completed;
      else if (statusFilter==='overdue')     filtered = categorized.overdue;
      else if (statusFilter==='canceled')    filtered = categorized.canceled;
      else if (statusFilter==='not_started') filtered = filtered.filter(r=>String(this.resolveField(r,'status')||'').toLowerCase().includes('not started'));
      activeFilters.push(`Status: "${statusFilter}"`);
    }

    if (healthFilter) {
      filtered = filtered.filter(row => {
        const h = String(this.resolveField(row,'health')||'');
        return h.toLowerCase()===healthFilter.toLowerCase();
      });
      activeFilters.push(`Health: "${healthFilter}"`);
    }

    if (dateFilter) {
      filtered = filtered.filter(row => {
        const d = this.parseDate(this.resolveField(row,'targetEnd'));
        if (!d) return false;
        if (dateFilter.type==='month') return d.getMonth()===dateFilter.month && d.getFullYear()===dateFilter.year;
        if (dateFilter.type==='before') return d<=new Date(dateFilter.year,dateFilter.month+1,0);
        if (dateFilter.type==='after')  return d>=new Date(dateFilter.year,dateFilter.month,1);
        return true;
      });
      const mNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      activeFilters.push(`Target End ${dateFilter.type}: "${mNames[dateFilter.month]} ${dateFilter.year}"`);
    }

    if (vendorFilter) {
      const vl = vendorFilter.toLowerCase();
      filtered = filtered.filter(row => {
        const v = String(this.resolveField(row,'vendor')||'').toLowerCase();
        return v.includes(vl);
      });
      activeFilters.push(`Vendor: "${vendorFilter}"`);
    }

    if (classFilter) {
      filtered = filtered.filter(row => {
        const cl = String(row['Classification']||'').toLowerCase();
        return cl.includes(classFilter);
      });
      activeFilters.push(`Classification: "${classFilter}"`);
    }

    if (isIssueQuery && !statusFilter) {
      filtered = filtered.filter(row => {
        const issue = this.resolveField(row,'issues');
        return issue && issue!=='-' && issue.toLowerCase()!=='no issue' && String(issue).trim()!=='';
      });
      activeFilters.push('Has Issues');
    }

    // ── STEP 4: Build context header ─────────────────────────────────────────
    const filterLabel = activeFilters.length>0 ? ` [Filter: ${activeFilters.join(' | ')}]` : '';

    // Status summary (always show)
    if (!statusFilter && !dateFilter) {
      const cat = this.categorizeRows(filtered, today, cols);
      context += `--- STATUS SUMMARY${filterLabel} ---\n`;
      context += `✅ Completed : ${cat.completed.length}\n`;
      context += `🔴 Overdue   : ${cat.overdue.length}\n`;
      context += `🟢 Active    : ${cat.active.length}\n`;
      context += `⛔ Canceled  : ${cat.canceled.length}\n\n`;
    }

    // ── STEP 5: Render table in the right mode ───────────────────────────────
    if (filtered.length===0) {
      context += `No projects found matching your filter.\n`;
      if (activeFilters.length>0) {
        // Suggest available values for the filter used
        if (deptFilter) {
          const depts = [...new Set(allRows.map(r=>String(this.resolveField(r,'department')||'').trim()).filter(Boolean))].sort();
          context += `\nAvailable departments:\n${depts.map(d=>`  • ${d}`).join('\n')}\n`;
        }
        if (pmFilter) {
          const pms = [...new Set(allRows.map(r=>String(this.resolveField(r,'pm')||'').trim()).filter(Boolean))].sort();
          context += `\nAvailable PMs:\n${pms.map(p=>`  • ${p}`).join('\n')}\n`;
        }
      }
      return context;
    }

    if (isBudgetQuery) {
      context += `--- PROJECT BUDGET DATA${filterLabel} (${filtered.length} projects) ---\n`;
      context += `NOTE: Display the table below exactly. Numeric values are the actual budget amounts. Value 0 means no spending yet (not missing data).\n\n`;
      if (groupByDept) {
        context += this.rowsToTableBudgetByDepartment(filtered, cols);
      } else {
        context += this.rowsToTableWithBudget(filtered, cols);
      }
    } else if (isShowAll) {
      context += `--- ALL PROJECTS${filterLabel} (${filtered.length}) ---\n`;
      context += this.rowsToTable(filtered, today, cols, false);
    } else if (isSummaryQuery) {
      const cat = this.categorizeRows(filtered, today, cols);
      const relevant = [...cat.overdue, ...cat.active];
      context += `--- ACTIVE & OVERDUE PROJECTS${filterLabel} (${relevant.length}) ---\n`;
      context += this.rowsToTable(relevant, today, cols, true);
      if (cat.completed.length>0) context += `\n(${cat.completed.length} completed projects not shown for brevity.)\n`;
    } else if (statusFilter || healthFilter || dateFilter || vendorFilter || classFilter || deptFilter || pmFilter || isIssueQuery) {
      // Any filter active — show all matching rows
      context += `--- PROJECTS${filterLabel} (${filtered.length} found) ---\n`;
      context += this.rowsToTable(filtered, today, cols, statusFilter==='overdue');
    } else {
      // Default: show active + overdue
      const cat = this.categorizeRows(filtered, today, cols);
      const relevant = [...cat.overdue, ...cat.active];
      context += `--- ACTIVE & OVERDUE PROJECTS (${relevant.length}) ---\n`;
      context += this.rowsToTable(relevant, today, cols, true);
      if (cat.completed.length>0) context += `\n(${cat.completed.length} completed projects not shown.)\n`;
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
    if (!rows.length) return 'No data found.\n\n';

    const headers = ['Project Name'];
    if (cols.pm)              headers.push('PM');
    if (cols.department)      headers.push('Dept');
    headers.push('Status');
    if (cols.progress)        headers.push('Progress');
    if (cols.targetEnd)       headers.push('Target End');
    if (cols.health)          headers.push('Health');
    if (showDaysOverdue)      headers.push('Days Overdue');
    if (cols.lastModified)    headers.push('Last Modified');
    if (cols.daysSinceUpdate) headers.push('Days Since Update');
    if (cols.issues)          headers.push('Issues');

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

      const issueRaw    = this.stripHtml(this.resolveField(row, 'issues') || '');
      // ✅ FIX: stripHtml() removes <br>/<b>/etc. from Smartsheet rich-text.
      // Then collapse newlines to ' | ' for compact table display.
      const issues      = (!issueRaw || issueRaw === '-' || issueRaw.toLowerCase() === 'no issue')
                          ? '-'
                          : this.truncate(issueRaw.replace(/\r?\n/g, ' | '), 600);

      const lastModifiedRaw = this.resolveField(row, 'lastModified');
      const lastModified    = lastModifiedRaw ? this.formatDate(lastModifiedRaw) : '-';

      const values = [name];
      if (cols.pm)              values.push(pm);
      if (cols.department)      values.push(dept);
      values.push(status);
      if (cols.progress)        values.push(progress);
      if (cols.targetEnd)       values.push(targetEnd);
      if (cols.health)          values.push(`${healthEmoji} ${health}`);
      if (showDaysOverdue)      values.push(daysOverdue);
      if (cols.lastModified)    values.push(lastModified);
      if (cols.daysSinceUpdate) {
        const days    = this.resolveField(row, 'daysSinceUpdate');
        const daysNum = parseFloat(days);
        const daysStr = !isNaN(daysNum)
          ? `${Math.round(daysNum)}d ${daysNum > 30 ? '⚠️' : ''}`
          : '-';
        values.push(daysStr);
      }
      if (cols.issues)          values.push(issues);

      table += `| ${values.join(' | ')} |\n`;
    });

    return table + '\n';
  }

  // ─────────────────────────────────────────────────────────────
  // BUDGET TABLE
  // ─────────────────────────────────────────────────────────────
  rowsToTableWithBudget(rows, cols) {
    if (!rows.length) return 'No data.\n\n';

    const allCols = cols.allColumns;

    // ✅ FIX: Prioritize "Total" columns first (Budget Plan Total, Budget Actual Total, etc.)
    const totalCols = allCols.filter(k => {
      const lower = k.toLowerCase();
      return lower.includes('budget') && lower.includes('total')
        && !lower.includes('migrated') && !lower.includes('before') && !lower.includes('num');
    });
    const budgetCols = totalCols.length > 0
      ? totalCols.slice(0, 4)
      : allCols.filter(k => {
          const lower = k.toLowerCase();
          return (lower.includes('budget') || lower.includes('afe'))
            && !lower.includes('migrated') && !lower.includes('before') && !lower.includes('num');
        }).slice(0, 4);

    const headers = ['Project Name', 'PM', 'Dept', 'Currency', ...budgetCols];
    let table = `| ${headers.join(' | ')} |\n`;
    table    += `| ${headers.map((_, i) => i < 3 ? ':---' : '---:').join(' | ')} |\n`;

    rows.forEach(row => {
      const name     = this.truncate(this.resolveField(row, 'projectName') || '-', 35);
      const pm       = this.truncate(this.resolveField(row, 'pm') || '-', 20);
      const dept     = this.truncate(this.resolveField(row, 'department') || '-', 25);
      // ✅ FIX: Never hardcode 'IDR' — use actual Currency value from row
      const currency = row['Currency'] && row['Currency'] !== 'Currency' ? row['Currency'] : '-';

      const budgetVals = budgetCols.map(col => {
        const raw = row[col];
        if (raw === null || raw === undefined || raw === '' || raw === col) return 'N/A';
        // ✅ PATCH v1.5.3: Strip ALL locale separators before parsing
        // Handles both en-US commas (1,000) and id-ID/EU dots (1.000)
        const cleaned = String(raw).replace(/[.,]/g, (m, i, s) => {
          // Keep only if it's a decimal point (followed by exactly 2 digits at end)
          return /\.\d{1,2}$/.test(s.slice(i)) && m === '.' ? '.' : '';
        });
        const val = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
        if (isNaN(val)) return 'N/A';
        // Show 0 as actual 0 (means no spending yet, not missing data)
        return this.formatNumber(val);
      });

      table += `| ${[name, pm, dept, currency, ...budgetVals].join(' | ')} |\n`;
    });

    return table + '\n';
  }

  // ─────────────────────────────────────────────────────────────
  // BUDGET GROUPED BY DEPARTMENT
  // ─────────────────────────────────────────────────────────────
  rowsToTableBudgetByDepartment(rows, cols) {
    if (!rows.length) return 'No data.\n\n';

    const allCols = cols.allColumns;

    // Prioritize "Total" columns (Budget Plan Total, Budget Actual Total, etc.)
    const totalCols = allCols.filter(k => {
      const lower = k.toLowerCase();
      return lower.includes('budget') && lower.includes('total')
        && !lower.includes('migrated') && !lower.includes('before') && !lower.includes('num');
    });
    const budgetCols = totalCols.length > 0
      ? totalCols.slice(0, 3)
      : allCols.filter(k => {
          const lower = k.toLowerCase();
          return lower.includes('budget') && !lower.includes('migrated')
            && !lower.includes('before') && !lower.includes('num')
            && !lower.includes('afe') && !lower.includes('(usd)');
        }).slice(0, 3);

    // Group rows by department — handle multi-dept rows (e.g. "HR\nGA")
    const groups = {};
    rows.forEach(row => {
      const deptRaw = this.resolveField(row, 'department') || 'No Department';
      const depts   = String(deptRaw).split('\n').map(d => d.trim()).filter(Boolean);
      depts.forEach(dept => {
        if (!groups[dept]) groups[dept] = [];
        groups[dept].push(row);
      });
    });

    const sorted = Object.keys(groups).filter(d => d !== 'No Department').sort();
    if (groups['No Department']) sorted.push('No Department');

    let result = '';

    // Summary table
    const summaryHeaders = ['Department', '# Projects', ...budgetCols];
    result += `| ${summaryHeaders.join(' | ')} |\n`;
    result += `| :--- | :---: | ${budgetCols.map(() => '---:').join(' | ')} |\n`;

    const grand = {};
    budgetCols.forEach(c => { grand[c] = { IDR: 0, USD: 0 }; });

    sorted.forEach(dept => {
      const deptRows = groups[dept];
      const tots = {};
      budgetCols.forEach(col => {
        let idr = 0, usd = 0;
        deptRows.forEach(row => {
          const v = parseFloat(String(row[col] || '').replace(/,/g, ''));
          if (!isNaN(v) && v !== 0) {
            const cur = String(row['Currency'] || '').toUpperCase();
            if (cur === 'USD') usd += v; else idr += v;
          }
        });
        tots[col] = { idr, usd };
        grand[col].IDR += idr;
        grand[col].USD += usd;
      });
      const vals = budgetCols.map(col => {
        const parts = [];
        if (tots[col].idr > 0) parts.push(`IDR ${this.formatNumber(tots[col].idr)}`);
        if (tots[col].usd > 0) parts.push(`USD ${this.formatNumber(tots[col].usd)}`);
        return parts.length ? parts.join(' / ') : '-';
      });
      result += `| ${dept} | ${deptRows.length} | ${vals.join(' | ')} |\n`;
    });

    const grandVals = budgetCols.map(col => {
      const parts = [];
      if (grand[col].IDR > 0) parts.push(`IDR ${this.formatNumber(grand[col].IDR)}`);
      if (grand[col].USD > 0) parts.push(`USD ${this.formatNumber(grand[col].USD)}`);
      return parts.length ? `**${parts.join(' / ')}**` : '-';
    });
    result += `| **TOTAL** | **${rows.length}** | ${grandVals.join(' | ')} |\n\n`;

    sorted.forEach(dept => {
      const deptRows = groups[dept];
      result += `\n**${dept}** (${deptRows.length} projects)\n`;
      const hdr = ['Project Name', 'PM', 'Currency', ...budgetCols];
      result += `| ${hdr.join(' | ')} |\n`;
      result += `| :--- | :--- | :---: | ${budgetCols.map(() => '---:').join(' | ')} |\n`;
      deptRows.forEach(row => {
        const name = this.truncate(this.resolveField(row, 'projectName') || '-', 38);
        const pm   = this.truncate(this.resolveField(row, 'pm') || '-', 20);
        const cur  = row['Currency'] && row['Currency'] !== 'Currency' ? row['Currency'] : '-';
        const vals = budgetCols.map(col => {
          const v = parseFloat(String(row[col] || '').replace(/,/g, ''));
          return isNaN(v) || v === 0 ? '-' : this.formatNumber(v);
        });
        result += `| ${[name, pm, cur, ...vals].join(' | ')} |\n`;
      });
    });

    return result + '\n';
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
    context += `--- ACTIVITY SUMMARY ---\n`;
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
        mergedContext += `\n=== SHEET: ${sheet.name} ===\n(No data)\n`;
        continue;
      }
      mergedContext += `\n${this.buildAIContext(flatRows, userMessage, sheet.name)}\n`;
    }

    const header = `=== SMARTSHEET DATA (${successfulSheets.length} sheet dimuat) ===\n` +
      `Sheet: ${successfulSheets.map(s => s.name).join(' | ')}\n` +
      `Date: ${today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;

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
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── NEW: format tanggal + jam untuk Activity Time
  formatDateTime(str) {
    const d = this.parseDate(str);
    if (!d) return null;
    return d.toLocaleString('en-GB', {
      day:    '2-digit',
      month:  'short',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    });
  }

  formatNumber(num) {
    if (!num && num !== 0) return '-';
    return Number(num).toLocaleString('en-US');
  }

  truncate(str, maxLen) {
    if (!str) return '-';
    str = String(str).replace(/\n/g, ' ').trim();
    return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
  }

  /**
   * Strip HTML tags from Smartsheet rich-text values.
   * Smartsheet stores multi-line text as HTML (<br>, <b>, <ul><li>…</li></ul>).
   * Converts structural tags to plain-text equivalents so the AI sees clean text.
   *
   *   <br>, <br/>, <br />  → \n
   *   <p>, </p>            → \n
   *   <li>                 → \n•
   *   All other tags       → stripped
   *   &amp; &lt; &gt; &nbsp; → decoded
   */
  stripHtml(str) {
    if (!str || typeof str !== 'string') return str;
    // Quick exit — no HTML present
    if (!str.includes('<') && !str.includes('&')) return str;

    return str
      // <br> variants → newline
      .replace(/<br\s*\/?>/gi, '\n')
      // </p> → newline, <p …> → nothing
      .replace(/<\/p>/gi, '\n')
      .replace(/<p[^>]*>/gi, '')
      // <li> → bullet point
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '')
      // list containers
      .replace(/<\/?[uo]l[^>]*>/gi, '')
      // inline formatting — strip tags, keep text
      .replace(/<\/?(b|strong|i|em|u|s|span|div|h[1-6])[^>]*>/gi, '')
      // any remaining tags
      .replace(/<[^>]+>/g, '')
      // HTML entities
      .replace(/&amp;/gi,  '&')
      .replace(/&lt;/gi,   '<')
      .replace(/&gt;/gi,   '>')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi,  "'")
      // collapse 3+ consecutive newlines → 2
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

export default SmartsheetLiveService;