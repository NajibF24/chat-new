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
import FileManagerService from './file-manager.service.js';
import KouventaService from './kouventa.service.js';

class AICoreService {
  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.fileManager = new FileManagerService();
  }

  // --- HELPER: MENGUBAH JSON KE TABEL RINGKAS (Hemat 80% Token) ---
  formatToCompactTable(data) {
    if (!Array.isArray(data) || data.length === 0) return "DATA KOSONG";

    const allKeys = Object.keys(data[0]);
    // Filter kolom sampah agar tabel tidak terlalu lebar
    const columns = allKeys.filter(k => !['id', 'rowId', 'createdAt', 'modifiedAt'].includes(k));

    // Header
    let table = `| ${columns.join(' | ')} |\n`;
    table += `| ${columns.map(() => '---').join(' | ')} |\n`;

    // Baris Data (Semua Baris Dimasukkan)
    data.forEach((row) => {
        const values = columns.map(col => {
            const val = row[col];
            if (val === null || val === undefined || String(val).trim() === '') return '-';
            // Pastikan baris duplikat header tidak dianggap data kosong
            return String(val).replace(/\|/g, '/').replace(/\n/g, ' ').trim();
        });
        table += `| ${values.join(' | ')} |\n`;
    });

    return table;
  }

  isDataQuery(message) {
    const lowerMsg = (message || '').toLowerCase();
    const dataKeywords = ['berikan', 'cari', 'list', 'daftar', 'semua', 'project', 'status', 'progress', 'summary', 'analisa', 'data', 'total', 'berapa', 'mana', 'versi', 'latest', 'terbaru', 'revisi', 'dokumen', 'file', 'tracking', 'update', 'history', 'riwayat', 'overdue'];
    return dataKeywords.some(k => lowerMsg.includes(k)) || message.includes('_') || message.includes('.');
  }

  async extractFileContent(attachedFile) {
      const physicalPath = attachedFile.serverPath || attachedFile.path;
      if (!physicalPath || !fs.existsSync(physicalPath)) return "";
      const originalName = attachedFile.originalname || '';
      const ext = path.extname(originalName).toLowerCase();
      let content = null;
      try {
          if (ext === '.pdf') {
              const dataBuffer = fs.readFileSync(physicalPath);
              const data = await pdf(dataBuffer);
              content = data.text;
          } else if (ext === '.docx') {
              const result = await mammoth.extractRawText({ path: physicalPath });
              content = result.value;
          } else if (ext === '.xlsx' || ext === '.xls') {
              const workbook = XLSX.readFile(physicalPath);
              content = workbook.SheetNames.map(name => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\n');
          } else {
               content = fs.readFileSync(physicalPath, 'utf8');
          }
          return content ? `\n\n[ISI FILE: ${originalName}]\n${content.substring(0, 30000)}\n[END FILE]\n` : "";
      } catch (e) { return ""; }
  }

  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    if (!threadId) {
        const title = message ? (message.substring(0, 30)) : `Chat with ${bot.name}`;
        const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
        await newThread.save();
        threadId = newThread._id;
    }

    let contextData = "";

    // 1. KOUVENTA
    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
        try {
            const kouventa = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
            const kouventaReply = await kouventa.generateResponse(message || "");
            contextData += `\n\n=== REFERENSI DOKUMEN INTERNAL ===\n${kouventaReply}\n`;
        } catch (error) { console.error("Kouventa Error:", error); }
    }

    // 2. SMARTSHEET LOGIC (FIXED: READ ALL AS TABLE)
    if (this.isDataQuery(message) && bot.smartsheetConfig?.enabled) {
        try {
            const service = new SmartsheetJSONService();
            const sheetId = bot.smartsheetConfig.sheetId || bot.smartsheetConfig.primarySheetId;
            const rawData = await service.getData(sheetId);
            
            // ✅ Ubah JSON ke Tabel agar muat banyak data
            const compactTable = this.formatToCompactTable(rawData);
            contextData += `\n\n=== DATA SMARTSHEET (Source: ${sheetId}) ===\n${compactTable}\n`;
        } catch (e) { console.error("Smartsheet Error:", e); }
    }

    // 3. OPENAI EXECUTION
    const userContent = [];
    if (message) userContent.push({ type: "text", text: message });
    if (attachedFile) {
        if (attachedFile.mimetype?.startsWith('image/')) {
            const imgBuffer = fs.readFileSync(attachedFile.path);
            userContent.push({ type: "image_url", image_url: { url: `data:${attachedFile.mimetype};base64,${imgBuffer.toString('base64')}` } });
        } else {
            const text = await this.extractFileContent(attachedFile);
            if (text) userContent.push({ type: "text", text });
        }
    }

    const systemPrompt = `${bot.prompt || bot.systemPrompt}\n\n[INFO: TANGGAL HARI INI ${new Date().toDateString()}]\n\n${contextData}\nGunkan data tabel di atas jika tersedia.`;
    
    const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: systemPrompt },
            ...history.slice(-5).map(h => ({ role: h.role, content: h.content })), // Ambil 5 riwayat terakhir
            { role: 'user', content: userContent }
        ],
        temperature: 0.1
    });
    const aiResponse = completion.choices[0].message.content;

    // 4. SAVE
    let savedAttachments = [];
    if (attachedFile) {
        savedAttachments.push({
            name: attachedFile.originalname || attachedFile.filename,
            path: `/api/files/${attachedFile.filename}`,
            serverPath: attachedFile.path,
            type: attachedFile.mimetype?.includes('image') ? 'image' : (attachedFile.mimetype?.includes('pdf') ? 'pdf' : 'file')
        });
    }

    await new Chat({ userId, botId, threadId, role: 'user', content: message || '', attachedFiles: savedAttachments }).save();
    await new Chat({ userId, botId, threadId, role: 'assistant', content: aiResponse }).save();

    return { response: aiResponse, threadId, attachedFiles: savedAttachments };
  }
}

export default new AICoreService();
