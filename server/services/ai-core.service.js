import OpenAI from 'openai';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

import Chat from '../models/Chat.js';
import Thread from '../models/Thread.js';
import Bot from '../models/Bot.js';
import SmartsheetJSONService from './smartsheet-json.service.js';
import SmartsheetContextService from './smartsheet-context.service.js';  // ← NEW
import FileManagerService from './file-manager.service.js';
import KouventaService from './kouventa.service.js';

// Token budget:
// GPT-4o max: 128K tokens
// System prompt + history: ~3-5K
// User message: ~0.5K
// File attachment: ~2K
// → Max untuk data Smartsheet: ~15K tokens (aman)
const MAX_SMARTSHEET_TOKENS = 15000;

class AICoreService {
  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.fileManager = new FileManagerService();
  }

  // Format array ke markdown table — hanya dipakai untuk data NON-Smartsheet
  formatToCompactTable(data) {
    if (!Array.isArray(data) || data.length === 0) return "DATA KOSONG";
    const allKeys = Object.keys(data[0]);
    const columns = allKeys.filter(k => !['id', 'rowId', 'createdAt', 'modifiedAt'].includes(k));
    let table = `| ${columns.join(' | ')} |\n`;
    table += `| ${columns.map(() => '---').join(' | ')} |\n`;
    data.forEach(row => {
      const values = columns.map(col => {
        const val = row[col];
        if (val === null || val === undefined || String(val).trim() === '') return '-';
        return String(val).replace(/\|/g, '/').replace(/\n/g, ' ').trim();
      });
      table += `| ${values.join(' | ')} |\n`;
    });
    return table;
  }

  // Flatten Smartsheet row: {data: {"Col": {value: "x"}}} → {"Col": "x"}
  flattenSmartsheetRows(projects) {
    return projects.map(p => {
      const flat = {};
      Object.entries(p.data || {}).forEach(([colName, cellData]) => {
        flat[colName] = cellData?.value ?? '';
      });
      return flat;
    });
  }

  isDataQuery(message) {
    const lowerMsg = (message || '').toLowerCase();
    const dataKeywords = [
      'berikan', 'cari', 'list', 'daftar', 'semua', 'all', 'tampilkan', 'lihat',
      'show', 'get', 'find', 'temukan', 'search',
      'project', 'dokumen', 'document', 'file', 'tracking', 'revisi', 'version',
      'status', 'progress', 'summary', 'analisa', 'data', 'total', 'berapa',
      'latest', 'terbaru', 'recent', 'this week', 'minggu ini', 'today', 'hari ini',
      'update', 'history', 'riwayat',
      'modified', 'upload', 'added', 'deleted', 'edit', 'activity', 'siapa', 'who',
      'folder', 'workstream', 'category', 'user',
      'overdue', 'delay', 'terlambat', 'laporan', 'report',
      'health', 'red', 'merah', 'kritis', 'critical',
      'versi', 'mana', 'semua proyek', 'all project',
      'statistik', 'stats', 'count', 'jumlah',
    ];
    return dataKeywords.some(k => lowerMsg.includes(k))
      || message.includes('_')
      || message.includes('.');
  }

  async extractFileContent(attachedFile) {
    const physicalPath = attachedFile.serverPath || attachedFile.path;
    if (!physicalPath || !fs.existsSync(physicalPath)) return "";
    const originalName = attachedFile.originalname || '';
    const ext = path.extname(originalName).toLowerCase();
    try {
      if (ext === '.pdf') {
        const data = await pdf(fs.readFileSync(physicalPath));
        return `\n\n[ISI FILE: ${originalName}]\n${data.text.substring(0, 8000)}\n[END FILE]\n`;
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: physicalPath });
        return `\n\n[ISI FILE: ${originalName}]\n${result.value.substring(0, 8000)}\n[END FILE]\n`;
      } else if (ext === '.xlsx' || ext === '.xls') {
        const workbook = XLSX.readFile(physicalPath);
        const content = workbook.SheetNames.map(n => XLSX.utils.sheet_to_csv(workbook.Sheets[n])).join('\n');
        return `\n\n[ISI FILE: ${originalName}]\n${content.substring(0, 8000)}\n[END FILE]\n`;
      } else {
        return `\n\n[ISI FILE: ${originalName}]\n${fs.readFileSync(physicalPath, 'utf8').substring(0, 8000)}\n[END FILE]\n`;
      }
    } catch (e) { return ""; }
  }

  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    if (!threadId) {
      const title = message ? message.substring(0, 30) : `Chat with ${bot.name}`;
      const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
      await newThread.save();
      threadId = newThread._id;
    }

    let contextData = "";

    // ── 1. KOUVENTA ──────────────────────────────────────────────
    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
      try {
        const kouventa = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
        const reply = await kouventa.generateResponse(message || "");
        contextData += `\n\n=== REFERENSI DOKUMEN INTERNAL ===\n${reply}\n`;
      } catch (error) {
        console.error("Kouventa Error:", error);
      }
    }

    // ── 2. SMARTSHEET (TOKEN-SAFE) ───────────────────────────────
    if (this.isDataQuery(message) && bot.smartsheetConfig?.enabled) {
      try {
        const service = new SmartsheetJSONService();

        // ✅ Ambil sheetId dari konfigurasi BOT, bukan dari .env
        const sheetId =
          bot.smartsheetConfig.sheetId ||
          bot.smartsheetConfig.primarySheetId ||
          process.env.SMARTSHEET_PRIMARY_SHEET_ID;

        if (!sheetId) {
          console.warn(`⚠️ Bot "${bot.name}": sheetId tidak dikonfigurasi`);
          contextData += `\n\n=== DATA SMARTSHEET ===\nSheet ID belum dikonfigurasi di bot ini.\n`;
        } else {
          console.log(`📊 Bot "${bot.name}" → Sheet ID: ${sheetId}`);

          const rawData = await service.getData(sheetId);
          const projectsArray = rawData?.projects || [];

          console.log(`📊 Total rows di cache: ${projectsArray.length}`);

          if (projectsArray.length === 0) {
            contextData += `\n\n=== DATA SMARTSHEET ===\nData kosong. Jalankan: node fetch-smartsheet.js\n`;
          } else {
            // ✅ Flatten nested structure
            const flatRows = this.flattenSmartsheetRows(projectsArray);

            // ✅ SMART FILTER: hanya kirim data yang relevan ke AI
            // Ini yang mencegah context_length_exceeded
            const smartContext = SmartsheetContextService.buildContext(flatRows, message);

            // Cek estimasi token sebelum dikirim
            const estimatedTokens = SmartsheetContextService.estimateTokens(smartContext);
            console.log(`📊 Context tokens estimate: ~${estimatedTokens} (limit: ${MAX_SMARTSHEET_TOKENS})`);

            if (estimatedTokens > MAX_SMARTSHEET_TOKENS) {
              // Fallback: kirim summary saja
              console.warn(`⚠️ Context terlalu besar (${estimatedTokens} tokens), fallback ke summary`);
              const fallbackContext = SmartsheetContextService.buildStatsSummary(flatRows, message);
              contextData += `\n\n${fallbackContext}\n`;
              contextData += `\n⚠️ Data terlalu besar untuk ditampilkan penuh. Silakan ajukan pertanyaan yang lebih spesifik (filter per tanggal, user, atau kategori).\n`;
            } else {
              contextData += `\n\n${smartContext}\n`;
            }
          }
        }
      } catch (e) {
        console.error(`❌ Smartsheet Error (bot "${bot.name}"):`, e.message);
        contextData += `\n\n=== DATA SMARTSHEET ===\nGagal memuat data: ${e.message}\n`;
      }
    }

    // ── 3. OPENAI ────────────────────────────────────────────────
    const userContent = [];
    if (message) userContent.push({ type: "text", text: message });

    if (attachedFile) {
      if (attachedFile.mimetype?.startsWith('image/')) {
        const imgBuffer = fs.readFileSync(attachedFile.path);
        userContent.push({
          type: "image_url",
          image_url: { url: `data:${attachedFile.mimetype};base64,${imgBuffer.toString('base64')}` }
        });
      } else {
        const text = await this.extractFileContent(attachedFile);
        if (text) userContent.push({ type: "text", text });
      }
    }

    const today = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const systemPrompt = [
      bot.prompt || bot.systemPrompt || '',
      `[INFO: HARI INI ${today}]`,
      contextData,
      'Gunakan data di atas untuk menjawab pertanyaan user. Jika tidak ada data yang relevan, katakan demikian.',
    ].filter(Boolean).join('\n\n');

    // Log total context size untuk monitoring
    const totalContextChars = systemPrompt.length + (message?.length || 0);
    const totalContextTokensEst = Math.ceil(totalContextChars / 4);
    console.log(`📝 Total context estimate: ~${totalContextTokensEst} tokens`);

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.slice(-4).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: userContent }
      ],
      temperature: 0.1,
      max_tokens: 2000,  // batasi output agar sisa budget cukup
    });

    const aiResponse = completion.choices[0].message.content;

    // ── 4. SAVE ──────────────────────────────────────────────────
    let savedAttachments = [];
    if (attachedFile) {
      savedAttachments.push({
        name: attachedFile.originalname || attachedFile.filename,
        path: `/api/files/${attachedFile.filename}`,
        serverPath: attachedFile.path,
        type: attachedFile.mimetype?.includes('image') ? 'image'
          : attachedFile.mimetype?.includes('pdf') ? 'pdf' : 'file'
      });
    }

    await new Chat({ userId, botId, threadId, role: 'user', content: message || '', attachedFiles: savedAttachments }).save();
    await new Chat({ userId, botId, threadId, role: 'assistant', content: aiResponse }).save();

    return { response: aiResponse, threadId, attachedFiles: savedAttachments };
  }
}

export default new AICoreService();