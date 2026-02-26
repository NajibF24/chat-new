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
  // 1. UTILS: DETEKSI JENIS QUERY
  // ===========================================================================
  isDataQuery(message) {
    const lowerMsg = (message || '').toLowerCase();
    
    // Pengecualian: Jika user minta visual/dashboard, jangan anggap data query
    const visualKeywords = ['dashboard', 'gambar', 'image', 'foto', 'screenshot', 'visual', 'pic'];
    if (visualKeywords.some(k => lowerMsg.includes(k)) && lowerMsg.includes('dashboard')) return false;

    // Kata kunci indikasi minta data
    const dataKeywords = [
        'berikan', 'cari', 'list', 'daftar', 'semua', 'project', 'status', 'progress', 
        'summary', 'analisa', 'data', 'total', 'berapa', 'mana', 'versi', 'latest', 
        'terbaru', 'revisi', 'dokumen', 'file', 'tracking', 'update', 'history', 'riwayat', 'check'
    ];
    return dataKeywords.some(k => lowerMsg.includes(k)); 
  }

  // ===========================================================================
  // 2. UTILS: EKSTRAKSI FILE CONTENT
  // ===========================================================================
  async extractFileContent(attachedFile) {
      // Prioritaskan serverPath (path fisik)
      const physicalPath = attachedFile.serverPath || attachedFile.path;
      
      if (!physicalPath || !fs.existsSync(physicalPath)) {
          return "";
      }

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
          
          return content ? `\n\n[ISI FILE: ${originalName}]\n${content.substring(0, 50000)}\n[END FILE]\n` : "";
      } catch (e) { 
          console.error("❌ Error reading file content:", e.message);
          return ""; 
      }
  }

  // ===========================================================================
  // 3. MAIN PROCESS
  // ===========================================================================
  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    // 1. Validasi Bot
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    // 2. Setup Thread (Buat baru atau update)
    if (!threadId) {
        const title = message ? (message.substring(0, 30)) : `Chat with ${bot.name}`;
        const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
        await newThread.save();
        threadId = newThread._id;
    } else {
        await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });
    }

    // 3. FITUR: DASHBOARD FILES (ISOLASI)
    // Jika user minta "lihat dashboard X", cari file fisik di folder dashboard
    if (bot.smartsheetConfig?.enabled && !attachedFile && this.fileManager.isFileRequest(message || '')) {
        const query = this.fileManager.extractFileQuery(message || '');
        const foundFiles = await this.fileManager.searchFiles(query);
        
        if (foundFiles.length > 0) {
            const reply = this.fileManager.generateSmartDescription(foundFiles, query);
            const attachments = foundFiles.map(f => ({ 
                name: f.name, 
                path: f.relativePath, 
                type: f.type, 
                size: f.sizeKB 
            }));
            
            // Simpan respon assistant langsung (tanpa ke OpenAI)
            await new Chat({ userId, botId, threadId, role: 'assistant', content: reply, attachedFiles: attachments }).save();
            return { response: reply, threadId, attachedFiles: attachments };
        }
    }

    let contextData = "";

    // 4. FITUR: KOUVENTA (Enterprise Search)
    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
        try {
            const kouventa = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
            let fullPrompt = message || "";
            
            // Jika ada file teks terlampir, sertakan dalam pencarian context
            if (attachedFile && !attachedFile.mimetype?.startsWith('image/')) {
                const fileText = await this.extractFileContent(attachedFile);
                if (fileText) fullPrompt += fileText;
            }
            
            const kouventaReply = await kouventa.generateResponse(fullPrompt);
            contextData += `\n\n=== REFERENSI DOKUMEN INTERNAL ===\n${kouventaReply}\n`;
        } catch (error) { 
            console.error("Kouventa Error:", error); 
        }
    }

    // 5. FITUR: SMARTSHEET (DATA LOOKUP) - FIXED LOGIC
    if (this.isDataQuery(message) && bot.smartsheetConfig?.enabled) {
        try {
            const service = new SmartsheetJSONService();
            
            // ✅ PRIORITAS PENGAMBILAN SHEET ID
            // 1. Ambil dari Config Bot (Specific ID untuk Bot ini)
            // 2. Jika kosong, Fallback ke ENV (Default ID)
            let targetSheetId = bot.smartsheetConfig.sheetId; 
            
            if (!targetSheetId) {
                console.log(`⚠️ Bot ${bot.name} tidak memiliki Sheet ID khusus. Menggunakan Default ENV.`);
                targetSheetId = process.env.SMARTSHEET_PRIMARY_SHEET_ID;
            }

            console.log(`📊 Fetching Smartsheet Data for Bot: "${bot.name}" | Sheet ID: ${targetSheetId}`);

            if (targetSheetId) {
                const data = await service.getData(targetSheetId);
                // Convert JSON ke string context
                contextData += `\n\n=== DATA REAL-TIME DARI SMARTSHEET (ID: ${targetSheetId}) ===\n${JSON.stringify(data)}\n`;
            } else {
                console.warn('❌ No Sheet ID provided for Smartsheet lookup.');
            }

        } catch (e) { 
            console.error("❌ Smartsheet Error:", e.message); 
            contextData += `\n[Sistem Error: Gagal mengambil data Smartsheet: ${e.message}]\n`;
        }
    }

    // 6. PERSIAPAN OPENAI PAYLOAD
    const userContent = [];
    if (message) userContent.push({ type: "text", text: message });

    if (attachedFile) {
        if (attachedFile.mimetype?.startsWith('image/')) {
            // Jika gambar, kirim sebagai base64 ke GPT-4 Vision
            const imgBuffer = fs.readFileSync(attachedFile.path);
            userContent.push({ 
                type: "image_url", 
                image_url: { url: `data:${attachedFile.mimetype};base64,${imgBuffer.toString('base64')}` } 
            });
        } else {
            // Jika dokumen (PDF/Doc/Excel), ekstrak teksnya
            const extractedText = await this.extractFileContent(attachedFile);
            if (extractedText) {
                userContent.push({ type: "text", text: extractedText });
            }
        }
    }

    // Gabungkan System Prompt + Context Data
    // Menggunakan 'prompt' (field baru) jika ada, fallback ke 'systemPrompt' (lama)
    const basePrompt = bot.prompt || bot.systemPrompt;
    const finalSystemPrompt = `${basePrompt}\n\n${contextData}\nInstruksi: Jawablah pertanyaan user. Gunakan data/referensi di atas jika relevan. Jika tidak ada data yang cocok, jawab berdasarkan pengetahuan umum atau minta detail lebih lanjut.`;
    
    const messagesPayload = [
        { role: 'system', content: finalSystemPrompt },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: userContent }
    ];

    // 7. EKSEKUSI OPENAI
    const completion = await this.openai.chat.completions.create({ 
        model: 'gpt-4o', 
        messages: messagesPayload,
        temperature: 0.2 // Rendah agar lebih akurat membaca data
    });
    const aiResponse = completion.choices[0].message.content;

    // 8. SIMPAN HISTORI CHAT & ATTACHMENT
    let savedAttachments = [];
    if (attachedFile) {
        savedAttachments.push({
            name: attachedFile.originalname || attachedFile.filename,
            // URL Web (untuk diklik di frontend)
            path: attachedFile.url || `/api/files/${attachedFile.filename}`,
            // Path Fisik (untuk keperluan backend lain)
            serverPath: attachedFile.path,
            type: attachedFile.mimetype?.includes('image') ? 'image' : (attachedFile.mimetype?.includes('pdf') ? 'pdf' : 'file'),
            size: (attachedFile.size / 1024).toFixed(1)
        });
    }

    // Simpan pesan User
    await new Chat({ 
        userId, botId, threadId, 
        role: 'user', 
        content: message || '', 
        attachedFiles: savedAttachments 
    }).save();

    // Simpan balasan Assistant
    await new Chat({ 
        userId, botId, threadId, 
        role: 'assistant', 
        content: aiResponse 
    }).save();

    return { response: aiResponse, threadId, attachedFiles: savedAttachments };
  }
}

export default new AICoreService();
