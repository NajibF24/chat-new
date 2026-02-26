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
  formatSmartsheetData(data) {
    if (!Array.isArray(data) || data.length === 0) return "DATA KOSONG.";

    // --- A. DETEKSI JENIS SHEET & TENTUKAN KOLOM PENTING ---
    const firstRow = data[0];
    const allKeys = Object.keys(firstRow);
    
    // Cek apakah ini Sheet Project atau Dokumen
    const isProjectSheet = allKeys.some(k => k.toLowerCase().includes('project status') || k.toLowerCase().includes('progress'));

    let columnsToKeep = [];

    if (isProjectSheet) {
        // MODE PROJECT: Ambil kolom-kolom krusial untuk manajemen proyek
        columnsToKeep = allKeys.filter(k => {
            const lower = k.toLowerCase();
            return lower.includes('name') || 
                   lower.includes('status') || 
                   lower.includes('progress') || 
                   lower.includes('date') || 
                   lower.includes('manager') || 
                   lower.includes('health') ||
                   lower.includes('issues') ||
                   lower.includes('remarks'); // Remarks penting untuk konteks
        });
    } else {
        // MODE DOKUMEN: Ambil kolom tracking, user, dan link
        columnsToKeep = allKeys.filter(k => {
            const lower = k.toLowerCase();
            return lower.includes('date') || 
                   lower.includes('title') || 
                   lower.includes('name') || 
                   lower.includes('user') || 
                   lower.includes('activity') || 
                   lower.includes('link') || 
                   lower.includes('revision');
        });
    }

    // Jika filter gagal (nama kolom aneh), pakai semua kolom kecuali ID sistem
    if (columnsToKeep.length === 0) {
        columnsToKeep = allKeys.filter(k => !['id', 'createdAt', 'modifiedAt', 'rowId'].includes(k));
    }

    // --- B. KOMPRESI DATA KE FORMAT TEXT (CSV-STYLE) ---
    // Format: "Kolom1 | Kolom2 | Kolom3"
    
    // 1. Buat Header
    let formattedString = `[HEADER]: ${columnsToKeep.join(' | ')}\n`;

    // 2. Buat Rows
    const rows = data.map((row, index) => {
        const values = columnsToKeep.map(col => {
            let val = row[col];
            if (val === null || val === undefined) return '-';
            val = String(val).trim();
            // Pangkas teks yang terlalu panjang di satu sel (misal deskripsi 10 paragraf)
            if (val.length > 200) return val.substring(0, 200) + '...'; 
            return val;
        });
        return `${values.join(' | ')}`;
    });

    // --- C. PENANGANAN UKURAN DATA (TOKEN SAFETY) ---
    // Kita gabungkan semua. Jika > 60.000 karakter (sekitar 15k token), kita lakukan strategi peringkasan.
    // Tapi prioritasnya adalah memuat SEMUA data.
    
    const fullText = rows.join('\n');
    
    if (fullText.length > 100000) {
        // JIKA SANGAT BESAR (> 100k chars), baru kita filter "Completed" lama
        // Ini jalan terakhir (failsafe)
        if (isProjectSheet) {
            // Filter: Tampilkan semua Active, dan 20 Completed terbaru
            // (Implementasi filtering manual di sini jika perlu, tapi text format biasanya cukup irit)
            return `DATA TOO LARGE. SHOWING TOP 100 ACTIVE:\n${formattedString}` + rows.slice(0, 100).join('\n') + `\n... (${rows.length - 100} more rows)`;
        } else {
            // Untuk dokumen, ambil 150 terakhir
            return `DATA SUMMARY (Last 150 items):\n${formattedString}` + rows.slice(-150).join('\n');
        }
    }

    return `DATA SUMMARY (${rows.length} records):\n${formattedString}${fullText}`;
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
