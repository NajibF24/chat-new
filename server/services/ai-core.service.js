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
  // 1. UTILS: FORMAT DATA SMARTSHEET (COMPRESSION MODE - NO DATA LOSS)
  // ===========================================================================
 // ===========================================================================
  // 1. UTILS: FORMAT DATA SMARTSHEET (AGRESSIVE CLEANING & DETECTION)
  // ===========================================================================
  formatSmartsheetData(data) {
    // 1. Validasi Dasar
    if (!Array.isArray(data) || data.length === 0) return "DATA KOSONG: Server tidak menerima data dari Smartsheet.";

    // 2. Filter Baris Sampah
    // Terkadang Smartsheet mengirim baris yang kelihatannya ada (objek ada) tapi semua nilainya null/empty.
    const cleanRows = data.filter(row => {
        return Object.values(row).some(val => 
            val !== null && 
            val !== undefined && 
            String(val).trim() !== '' &&
            String(val).trim() !== 'null'
        );
    });

    if (cleanRows.length === 0) return "DATA KOSONG: Sheet terbaca tapi tidak ada isi teks di dalamnya.";

    // 3. Ambil Sampel Baris Pertama untuk Deteksi Kolom
    const firstRow = cleanRows[0];
    const allKeys = Object.keys(firstRow);
    
    // 4. Deteksi Jenis Sheet (Project vs Document)
    const keysLower = allKeys.map(k => k.toLowerCase());
    const isProjectSheet = keysLower.some(k => k.includes('project name') || k.includes('project status'));

    let columnsToKeep = [];

    if (isProjectSheet) {
        // Kolom Prioritas untuk Ringkasan Project
        columnsToKeep = allKeys.filter(k => {
            const low = k.toLowerCase();
            return low.includes('project name') || 
                   low.includes('status') || 
                   low.includes('progress') || 
                   low.includes('end date') || 
                   low.includes('manager') || 
                   low.includes('health');
        });
    } else {
        // Kolom Prioritas untuk Tracking Dokumen
        columnsToKeep = allKeys.filter(k => {
            const low = k.toLowerCase();
            return low.includes('date') || 
                   low.includes('title') || 
                   low.includes('user') || 
                   low.includes('activity') || 
                   low.includes('link') || 
                   low.includes('ref id');
        });
    }

    // Jika filter kolom terlalu ketat sehingga kosong, ambil semua kolom kecuali ID sistem
    if (columnsToKeep.length === 0) {
        columnsToKeep = allKeys.filter(k => !['id', 'rowId', 'createdAt', 'modifiedAt'].includes(k));
    }

    // 5. Konstruksi Header & Body (Format Pipa '|')
    const headerStr = `| ${columnsToKeep.join(' | ')} |`;
    const separatorStr = `| ${columnsToKeep.map(() => '---').join(' | ')} |`;
    
    const tableRows = cleanRows.map(row => {
        const values = columnsToKeep.map(col => {
            let val = row[col];
            if (val === null || val === undefined || String(val).trim() === '') return '-';
            // Bersihkan line breaks agar tidak merusak tabel markdown
            return String(val).replace(/\n/g, ' ').trim();
        });
        return `| ${values.join(' | ')} |`;
    });

    // 6. Gabungkan dengan Limit Karakter (Safety Measure)
    // Kita kirim 300 baris terbaru/aktif jika data sangat besar
    let finalTable = [headerStr, separatorStr, ...tableRows].join('\n');
    
    if (finalTable.length > 120000) {
        const truncatedRows = tableRows.slice(-150); // Ambil 150 baris terakhir jika terlalu besar
        finalTable = [headerStr, separatorStr, ...truncatedRows].join('\n') + `\n\n(Note: Data truncated due to size. Showing last 150 records.)`;
    }

    return `BERIKUT ADALAH DATA DARI SMARTSHEET:\n\n${finalTable}`;
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
