// server/services/ai-core.service.js
// ✅ Updated: Smartsheet sekarang langsung fetch dari API (no cache)
// API Key & Sheet ID diambil dari konfigurasi bot di MongoDB

import OpenAI from 'openai';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

import Chat from '../models/Chat.js';
import Thread from '../models/Thread.js';
import Bot from '../models/Bot.js';
import SmartsheetLiveService from './smartsheet-live.service.js';  // ✅ LIVE, no cache
import FileManagerService from './file-manager.service.js';
import KouventaService from './kouventa.service.js';

class AICoreService {
  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.fileManager = new FileManagerService();
  }

  // ─────────────────────────────────────────────────────────────
  // Deteksi apakah pertanyaan butuh data dari Smartsheet
  // ─────────────────────────────────────────────────────────────
  isDataQuery(message) {
    const lowerMsg = (message || '').toLowerCase();
    const dataKeywords = [
      'berikan', 'cari', 'list', 'daftar', 'semua', 'all', 'tampilkan', 'lihat',
      'show', 'get', 'find', 'temukan', 'search',
      'project', 'proyek', 'dokumen', 'document', 'file', 'tracking',
      'status', 'progress', 'summary', 'analisa', 'data', 'total', 'berapa',
      'latest', 'terbaru', 'recent', 'this week', 'minggu ini', 'today', 'hari ini',
      'update', 'history', 'riwayat',
      'modified', 'upload', 'added', 'deleted', 'edit', 'activity', 'siapa', 'who',
      'overdue', 'delay', 'terlambat', 'laporan', 'report',
      'health', 'red', 'merah', 'kritis', 'critical',
      'budget', 'biaya', 'cost', 'anggaran',
      'statistik', 'stats', 'count', 'jumlah',
      'pm', 'manager', 'department',
    ];
    return dataKeywords.some(k => lowerMsg.includes(k))
      || message.includes('_')
      || message.includes('.');
  }

  // ─────────────────────────────────────────────────────────────
  // Extract content dari file attachment
  // ─────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────
  // MAIN: Process message dari user
  // ─────────────────────────────────────────────────────────────
  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    // Buat thread baru jika belum ada
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
        const kouventa = new KouventaService(
          bot.kouventaConfig.apiKey,
          bot.kouventaConfig.endpoint
        );
        const reply = await kouventa.generateResponse(message || "");
        contextData += `\n\n=== REFERENSI DOKUMEN INTERNAL ===\n${reply}\n`;
      } catch (error) {
        console.error("Kouventa Error:", error.message);
      }
    }

    // ── 2. SMARTSHEET LIVE FETCH ─────────────────────────────────
    if (bot.smartsheetConfig?.enabled && this.isDataQuery(message)) {
      try {
        // ✅ Ambil API Key dari bot config, fallback ke .env
        const apiKey =
          bot.smartsheetConfig.apiKey ||
          process.env.SMARTSHEET_API_KEY;

        // ✅ Ambil Sheet ID dari bot config, fallback ke .env
        const sheetId =
          bot.smartsheetConfig.sheetId ||
          bot.smartsheetConfig.primarySheetId ||
          process.env.SMARTSHEET_PRIMARY_SHEET_ID;

        if (!apiKey) {
          console.warn(`⚠️ Bot "${bot.name}": Smartsheet API Key tidak dikonfigurasi`);
          contextData += `\n\n=== DATA SMARTSHEET ===\n⚠️ API Key belum dikonfigurasi di bot ini.\n`;
        } else if (!sheetId) {
          console.warn(`⚠️ Bot "${bot.name}": Sheet ID tidak dikonfigurasi`);
          contextData += `\n\n=== DATA SMARTSHEET ===\n⚠️ Sheet ID belum dikonfigurasi di bot ini.\n`;
        } else {
          console.log(`📊 Bot "${bot.name}" → Fetching Sheet ID: ${sheetId}`);

          // ✅ LIVE FETCH - langsung dari API
          const smartsheet = new SmartsheetLiveService(apiKey);
          const sheet = await smartsheet.fetchSheet(sheetId);
          const flatRows = smartsheet.processToFlatRows(sheet);

          console.log(`📊 Total rows fetched: ${flatRows.length}`);

          if (flatRows.length === 0) {
            contextData += `\n\n=== DATA SMARTSHEET ===\nSheet ditemukan tapi tidak ada data.\n`;
          } else {
            // ✅ Build context yang relevan dengan pertanyaan user
            const aiContext = smartsheet.buildAIContext(flatRows, message, sheet.name);
            contextData += `\n\n${aiContext}\n`;

            console.log(`📊 Context built: ~${Math.ceil(aiContext.length / 4)} tokens`);
          }
        }
      } catch (e) {
        console.error(`❌ Smartsheet Error (bot "${bot.name}"):`, e.message);
        contextData += `\n\n=== DATA SMARTSHEET ===\n❌ Gagal memuat data: ${e.message}\n`;
      }
    }

    // ── 3. BUILD MESSAGES UNTUK OPENAI ──────────────────────────
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
      `[HARI INI: ${today}]`,
      contextData,
      contextData
        ? 'Gunakan data di atas untuk menjawab pertanyaan user secara akurat. Hitung berdasarkan data yang tersedia, jangan mengarang.'
        : '',
    ].filter(Boolean).join('\n\n');

    // Log total context size
    console.log(`📝 Total context: ~${Math.ceil(systemPrompt.length / 4)} tokens`);

    // ── 4. CALL OPENAI ───────────────────────────────────────────
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.slice(-4).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: userContent }
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const aiResponse = completion.choices[0].message.content;

    // ── 5. SAVE CHAT ─────────────────────────────────────────────
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

    await new Chat({
      userId, botId, threadId,
      role: 'user',
      content: message || '',
      attachedFiles: savedAttachments
    }).save();

    await new Chat({
      userId, botId, threadId,
      role: 'assistant',
      content: aiResponse
    }).save();

    return { response: aiResponse, threadId, attachedFiles: savedAttachments };
  }
}

export default new AICoreService();
