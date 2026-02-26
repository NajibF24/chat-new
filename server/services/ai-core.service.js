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
import KouventaService from './kouventa.service.js'; //

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
  // 2. UTILS: EKSTRAKSI FILE
  // ===========================================================================
  async extractFileContent(attachedFile) {
      if (!attachedFile || !attachedFile.path) return null;
      const originalName = attachedFile.originalname || '';
      const ext = path.extname(originalName).toLowerCase();
      let content = null;
      try {
          if (ext === '.pdf') {
              const dataBuffer = fs.readFileSync(attachedFile.path);
              const data = await pdf(dataBuffer);
              content = data.text;
          } else if (ext === '.docx') {
              const result = await mammoth.extractRawText({ path: attachedFile.path });
              content = result.value;
          } else if (ext === '.xlsx' || ext === '.xls') {
              const workbook = XLSX.readFile(attachedFile.path);
              content = workbook.SheetNames.map(name => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\n');
          } else {
               content = fs.readFileSync(attachedFile.path, 'utf8');
          }
          return content ? `\n\n[ISI FILE: ${originalName}]\n${content}\n` : "";
      } catch (e) { return ""; }
  }

  // ===========================================================================
  // 3. MAIN PROCESS
  // ===========================================================================
  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    // Setup Thread
    if (!threadId) {
        const title = message ? (message.substring(0, 30)) : `Chat with ${bot.name}`;
        const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
        await newThread.save();
        threadId = newThread._id;
    } else {
        await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });
    }

    // --- DASHBOARD FILES (ISOLASI) ---
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

    // --- KOUVENTA INTEGRATION ---
    if (bot.kouventaConfig?.enabled && bot.kouventaConfig?.endpoint) {
        try {
            console.log("🔍 Mengambil referensi dari Kouventa...");
            const kouventa = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
            
            // Gabungkan teks file (jika ada) ke dalam prompt Kouventa
            let fullPrompt = message || "";
            if (attachedFile) {
                const fileText = await this.extractFileContent(attachedFile);
                if (fileText) fullPrompt += fileText;
            }

            const kouventaReply = await kouventa.generateResponse(fullPrompt);
            contextData += `\n\n=== REFERENSI KOUVENTA ===\n${kouventaReply}\n=== END REFERENSI ===\n`;
        } catch (error) {
            console.error("Kouventa Integration Error:", error);
        }
    }

    // --- SMARTSHEET LOGIC ---
    if (this.isDataQuery(message) && bot.smartsheetConfig?.enabled) {
        try {
            const service = new SmartsheetJSONService();
            const sheetId = bot.smartsheetConfig.sheetId || bot.smartsheetConfig.primarySheetId;
            const data = await service.getData(sheetId);
            contextData += `\n\n=== DATA SMARTSHEET ===\n${JSON.stringify(data)}\n`;
        } catch (e) { console.error("Smartsheet Error:", e); }
    }

    // --- OPENAI EXECUTION ---
    const userContent = [];
    if (message) userContent.push({ type: "text", text: message });
    if (attachedFile && attachedFile.mimetype?.startsWith('image/')) {
        const imgBuffer = fs.readFileSync(attachedFile.path);
        userContent.push({ type: "image_url", image_url: { url: `data:${attachedFile.mimetype};base64,${imgBuffer.toString('base64')}` } });
    }

    const systemPrompt = `${bot.prompt || bot.systemPrompt}\n\n${contextData}`;
    const messagesPayload = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userContent }];

    const completion = await this.openai.chat.completions.create({ model: 'gpt-4o', messages: messagesPayload });
    const aiResponse = completion.choices[0].message.content;

    // Save Attachments
    let savedAttachments = [];
    if (attachedFile) {
        savedAttachments.push({
            name: attachedFile.originalname,
            path: attachedFile.url || `/api/files/${attachedFile.filename}`, 
            type: attachedFile.mimetype?.includes('image') ? 'image' : 'file'
        });
    }

    await new Chat({ userId, botId, threadId, role: 'user', content: message || '', attachedFiles: savedAttachments }).save();
    await new Chat({ userId, botId, threadId, role: 'assistant', content: aiResponse }).save();

    return { response: aiResponse, threadId, attachedFiles: savedAttachments };
  }
}

export default new AICoreService();