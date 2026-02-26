import OpenAI from 'openai';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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


  // ===========================================================================
  // 1. UTILS: FORMAT DATA SMARTSHEET (SUPER ROBUST MODE)
  // ===========================================================================
  formatSmartsheetData(data) {
    // 1. Validasi Awal
    if (!Array.isArray(data) || data.length === 0) return "DATA KOSONG: Server tidak menerima data.";

    // 2. Pembersihan Baris (Agresif)
    const cleanRows = data.filter(row => {
        // Baris dianggap valid jika ada setidaknya satu kolom yang punya isi teks asli
        // dan bukan merupakan duplikasi dari nama kolom itu sendiri (Header Ganda)
        return Object.entries(row).some(([key, val]) => {
            if (val === null || val === undefined) return false;
            const stringVal = String(val).trim();
            return stringVal !== '' && stringVal !== 'null' && stringVal !== key;
        });
    });

    if (cleanRows.length === 0) return "DATA KOSONG: File terbaca tapi tidak ditemukan isi data yang valid (Hanya ditemukan header).";

    // 3. Identifikasi Kolom Utama (Berdasarkan File Project Intake Sheet Anda)
    const firstRow = cleanRows[0];
    const allKeys = Object.keys(firstRow);
    
    // Deteksi apakah ini sheet project atau log dokumen
    const isProjectSheet = allKeys.some(k => k.toLowerCase().includes('project name'));

    let columnsToKeep = [];
    if (isProjectSheet) {
        // Fokus pada kolom yang Anda butuhkan untuk ringkasan project
        columnsToKeep = allKeys.filter(k => {
            const low = k.toLowerCase();
            return low.includes('project name') || 
                   low.includes('status') || 
                   low.includes('progress') || 
                   low.includes('end date') || 
                   low.includes('manager') || 
                   low.includes('health') ||
                   low.includes('issues');
        });
    } else {
        // Fokus pada kolom untuk tracking dokumen
        columnsToKeep = allKeys.filter(k => {
            const low = k.toLowerCase();
            return low.includes('date') || low.includes('title') || low.includes('user') || low.includes('link');
        });
    }

    // Jika filter kolom gagal, ambil semua kolom kecuali ID internal
    if (columnsToKeep.length === 0) {
        columnsToKeep = allKeys.filter(k => !['id', 'rowId', 'createdAt', 'modifiedAt'].includes(k));
    }

    // 4. Bangun Tabel Markdown (GPT-4o sangat mahir membaca format ini)
    const headerStr = `| ${columnsToKeep.join(' | ')} |`;
    const dividerStr = `| ${columnsToKeep.map(() => '---').join(' | ')} |`;
    
    const tableRows = cleanRows.map(row => {
        const values = columnsToKeep.map(col => {
            const val = row[col];
            if (val === null || val === undefined || String(val).trim() === '') return '-';
            // Bersihkan simbol yang bisa merusak tabel markdown
            return String(val).replace(/\|/g, '/').replace(/\n/g, ' ').trim();
        });
        return `| ${values.join(' | ')} |`;
    });

    // 5. Penggabungan & Batasan Ukuran (Token Safety)
    // Utamakan memuat data sebanyak mungkin dalam format ringkas
    let finalTable = [headerStr, dividerStr, ...tableRows].join('\n');
    
    // Jika data terlalu besar (> 100k karakter), ambil 200 baris terbaru
    if (finalTable.length > 100000) {
        const truncated = tableRows.slice(-200);
        finalTable = [headerStr, dividerStr, ...truncated].join('\n') + `\n\n(Note: Data sangat besar, menampilkan 200 baris terbaru).`;
    }

    return `BERIKUT ADALAH DATA SMARTSHEET YANG BERHASIL DIAMBIL:\n\n${finalTable}`;
  }
  // ===========================================================================
  // 2. UTILS: DETEKSI JENIS QUERY
  // ===========================================================================
  isDataQuery(message) {
    const lowerMsg = (message || '').toLowerCase();
    const visualKeywords = ['dashboard', 'gambar', 'image', 'foto', 'screenshot', 'visual', 'pic'];
    if (visualKeywords.some(k => lowerMsg.includes(k)) && lowerMsg.includes('dashboard')) return false;

    const dataKeywords = [
        'berikan', 'cari', 'list', 'daftar', 'semua', 'project', 'status', 'progress', 
        'summary', 'analisa', 'data', 'total', 'berapa', 'mana', 'versi', 'latest', 
        'terbaru', 'revisi', 'dokumen', 'file', 'tracking', 'update', 'history', 'riwayat', 'check',
        'overdue', 'telat', 'deadline', 'siapa', 'health', 'resiko'
    ];
    return dataKeywords.some(k => lowerMsg.includes(k)); 
  }

  // ===========================================================================
  // 3. UTILS: EKSTRAKSI FILE CONTENT
  // ===========================================================================
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

  // ===========================================================================
  // 4. MAIN PROCESS
  // ===========================================================================
  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    if (!threadId) {
        const title = message ? (message.substring(0, 30)) : `Chat with ${bot.name}`;
        const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
        await newThread.save();
        threadId = newThread._id;
    } else {
        await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });
    }

    // FITUR: DASHBOARD FILES
    if (bot.smartsheetConfig?.enabled && !attachedFile && this.fileManager.isFileRequest(message || '')) {
        const query = this.fileManager.extractFileQuery(message || '');
        const foundFiles = await this.fileManager.searchFiles(query);
        if (foundFiles.length > 0) {
            const reply = this.fileManager.generateSmartDescription(foundFiles, query);
            const attachments = foundFiles.map(f => ({ name: f.name, path: f.relativePath, type: f.type, size: f.sizeKB }));
            await new Chat({ userId, botId, threadId, role: 'assistant', content: reply, attachedFiles: attachments }).save();
            return { response: reply, threadId, attachedFiles: attachments };
        }
    }

    let contextData = "";

    // FITUR: KOUVENTA
    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
        try {
            const kouventa = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
            let fullPrompt = message || "";
            if (attachedFile && !attachedFile.mimetype?.startsWith('image/')) {
                const fileText = await this.extractFileContent(attachedFile);
                if (fileText) fullPrompt += fileText;
            }
            const kouventaReply = await kouventa.generateResponse(fullPrompt);
            contextData += `\n\n=== REFERENSI DOKUMEN INTERNAL ===\n${kouventaReply}\n`;
        } catch (error) { console.error("Kouventa Error:", error); }
    }

    // FITUR: SMARTSHEET
    if (this.isDataQuery(message) && bot.smartsheetConfig?.enabled) {
        try {
            const service = new SmartsheetJSONService();
            let targetSheetId = bot.smartsheetConfig.sheetId || process.env.SMARTSHEET_PRIMARY_SHEET_ID;

            console.log(`📊 Fetching Smartsheet Data for Bot: "${bot.name}" | Sheet ID: ${targetSheetId}`);

            if (targetSheetId) {
                const data = await service.getData(targetSheetId);
                
                // ✅ GUNAKAN FORMATTER BARU (FULL DATA, COMPRESSED FORMAT)
                const formattedData = this.formatSmartsheetData(data);
                
                contextData += `\n\n=== DATA SMARTSHEET (ID: ${targetSheetId}) ===\n${formattedData}\n`;
            } 
        } catch (e) { 
            console.error("❌ Smartsheet Error:", e.message); 
            contextData += `\n[Sistem Error: Gagal mengambil data Smartsheet: ${e.message}]\n`;
        }
    }

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
            const extractedText = await this.extractFileContent(attachedFile);
            if (extractedText) userContent.push({ type: "text", text: extractedText });
        }
    }

    // History tetap kita batasi 6 chat terakhir agar fokus
    const limitedHistory = history.slice(-6); 

    const basePrompt = bot.prompt || bot.systemPrompt;
    // Tambahkan info tanggal agar AI bisa hitung Overdue dari full data
    const finalSystemPrompt = `${basePrompt}\n\n[INFO SISTEM: TANGGAL HARI INI ADALAH ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}]\n\n${contextData}\nInstruksi: Gunakan data tabel di atas. Jika data berformat '|', itu adalah tabel kolom.`;
    
    const messagesPayload = [
        { role: 'system', content: finalSystemPrompt },
        ...limitedHistory.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: userContent }
    ];

    const completion = await this.openai.chat.completions.create({ 
        model: 'gpt-4o', 
        messages: messagesPayload,
        temperature: 0.1 // Temperatur rendah untuk akurasi data
    });
    const aiResponse = completion.choices[0].message.content;

    let savedAttachments = [];
    if (attachedFile) {
        savedAttachments.push({
            name: attachedFile.originalname || attachedFile.filename,
            path: attachedFile.url || `/api/files/${attachedFile.filename}`,
            serverPath: attachedFile.path,
            type: attachedFile.mimetype?.includes('image') ? 'image' : (attachedFile.mimetype?.includes('pdf') ? 'pdf' : 'file'),
            size: (attachedFile.size / 1024).toFixed(1)
        });
    }

    await new Chat({ userId, botId, threadId, role: 'user', content: message || '', attachedFiles: savedAttachments }).save();
    await new Chat({ userId, botId, threadId, role: 'assistant', content: aiResponse }).save();

    return { response: aiResponse, threadId, attachedFiles: savedAttachments };
  }
}

export default new AICoreService();
