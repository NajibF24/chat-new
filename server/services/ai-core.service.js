import OpenAI from 'openai';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import officeParser from 'officeparser';

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
    const visualKeywords = ['dashboard', 'gambar', 'image', 'foto', 'screenshot', 'visual', 'pic'];
    if (visualKeywords.some(k => lowerMsg.includes(k)) && lowerMsg.includes('dashboard')) return false;

    const dataKeywords = [
        'berikan', 'cari', 'list', 'daftar', 'semua', 'project', 'status', 'progress', 
        'summary', 'analisa', 'data', 'total', 'berapa', 'mana', 'versi', 'latest', 
        'terbaru', 'revisi', 'dokumen', 'file', 'tracking', 'update', 'history', 'riwayat'
    ];
    return dataKeywords.some(k => lowerMsg.includes(k)) || message.includes('_') || message.includes('.'); 
  }

  // ===========================================================================
  // 2. UTILS: EKSTRAKSI FILE (FIX: Memastikan Path Fisik yang dibaca)
  // ===========================================================================
  async extractFileContent(attachedFile) {
      // Gunakan serverPath (lokasi lokal) jika ada, jika tidak gunakan path asli
      const physicalPath = attachedFile.serverPath || attachedFile.path;
      
      if (!physicalPath || !fs.existsSync(physicalPath)) {
          console.error("❌ File tidak ditemukan di server:", physicalPath);
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
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    // 1. Setup Thread
    if (!threadId) {
        const title = message ? (message.substring(0, 30)) : `Chat with ${bot.name}`;
        const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
        await newThread.save();
        threadId = newThread._id;
    } else {
        await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });
    }

    // 2. DASHBOARD FILES (ISOLASI)
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

    // 3. KOUVENTA INTEGRATION
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

    // 4. SMARTSHEET LOGIC
    if (this.isDataQuery(message) && bot.smartsheetConfig?.enabled) {
        try {
            const service = new SmartsheetJSONService();
            const sheetId = bot.smartsheetConfig.sheetId || bot.smartsheetConfig.primarySheetId;
            const data = await service.getData(sheetId);
            contextData += `\n\n=== DATA SMARTSHEET ===\n${JSON.stringify(data)}\n`;
        } catch (e) { console.error("Smartsheet Error:", e); }
    }

    // 5. OPENAI EXECUTION (FIX: Mengirimkan teks PDF ke AI)
    const userContent = [];
    if (message) userContent.push({ type: "text", text: message });

    if (attachedFile) {
        if (attachedFile.mimetype?.startsWith('image/')) {
            const imgBuffer = fs.readFileSync(attachedFile.path);
            userContent.push({ type: "image_url", image_url: { url: `data:${attachedFile.mimetype};base64,${imgBuffer.toString('base64')}` } });
        } else {
            // EKSTRAK TEKS PDF/DOCX DAN MASUKKAN KE PROMPT
            const extractedText = await this.extractFileContent(attachedFile);
            if (extractedText) {
                userContent.push({ type: "text", text: extractedText });
            }
        }
    }

    const systemPrompt = `${bot.prompt || bot.systemPrompt}\n\n${contextData}\nGunkan data/referensi di atas jika relevan dengan pertanyaan user.`;
    const messagesPayload = [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: userContent }
    ];

    const completion = await this.openai.chat.completions.create({ 
        model: 'gpt-4o', 
        messages: messagesPayload,
        temperature: 0.2
    });
    const aiResponse = completion.choices[0].message.content;

    // 6. SAVE ATTACHMENTS (FIX: Memisahkan URL Browser dan Path Server)
    let savedAttachments = [];
    if (attachedFile) {
        savedAttachments.push({
            name: attachedFile.originalname || attachedFile.filename,
            path: attachedFile.url || `/api/files/${attachedFile.filename}`, // URL untuk Browser (Klik)
            serverPath: attachedFile.path, // PATH asli untuk AI (Baca)
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
