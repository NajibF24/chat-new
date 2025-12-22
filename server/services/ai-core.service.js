import OpenAI from 'openai';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
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

  isDataQuery(message) {
    const lowerMsg = (message || '').toLowerCase();
    const visualKeywords = ['dashboard', 'gambar', 'image', 'foto', 'screenshot'];
    if (visualKeywords.some(k => lowerMsg.includes(k))) return false;
    const dataKeywords = ['berikan', 'tampilkan', 'cari', 'list', 'daftar', 'semua', 'project', 'status', 'progress', 'overdue', 'summary', 'health', 'analisa', 'resume', 'data', 'nilai', 'code', 'coding', 'script', 'excel', 'word', 'pembayaran', 'termin', 'kontrak', 'top'];
    return dataKeywords.some(k => lowerMsg.includes(k));
  }

  // --- 1. UNIVERSAL FILE EXTRACTOR (200k LIMIT) ---
  async extractFileContent(attachedFile) {
      if (!attachedFile || !attachedFile.path) return null;
      
      const mime = attachedFile.mimetype || '';
      const originalName = attachedFile.originalname || '';
      const ext = path.extname(originalName).toLowerCase();
      let content = null;
      let displayType = 'FILE';
      
      // ✅ UPDATE: Limit 200.000 karakter agar Annex/Lampiran terbaca
      const CHAR_LIMIT = 200000; 

      try {
          if (mime === 'application/pdf') {
              const dataBuffer = fs.readFileSync(attachedFile.path);
              const data = await pdf(dataBuffer);
              content = data.text.replace(/\n\s*\n/g, '\n').substring(0, CHAR_LIMIT);
              displayType = 'PDF';
          }
          else if (mime.includes('wordprocessingml') || ext === '.docx') {
              const result = await mammoth.extractRawText({ path: attachedFile.path });
              content = result.value.substring(0, CHAR_LIMIT);
              displayType = 'DOCX';
          }
          else if (ext === '.xlsx' || ext === '.xls') {
              const workbook = XLSX.readFile(attachedFile.path);
              const sheetName = workbook.SheetNames[0]; 
              const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
              content = csv.substring(0, CHAR_LIMIT);
              displayType = `EXCEL (${sheetName})`;
          }
          else {
              const textExts = ['.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.html', '.css', '.js', '.jsx', '.ts', '.py', '.java', '.c', '.cpp', '.sql', '.log', '.env'];
              if (textExts.includes(ext) || mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript')) {
                  content = fs.readFileSync(attachedFile.path, 'utf8').substring(0, CHAR_LIMIT);
                  displayType = 'CODE/TEXT';
              }
          }

          if (content) {
              return `\n\n[FILE START: ${originalName} (${displayType})]\n${content}\n[FILE END]\n`;
          }
      } catch (e) {
          console.error(`File extraction failed: ${e.message}`);
          return `\n[SYSTEM ERROR: Gagal membaca file ${originalName}. ${e.message}]`;
      }
      return null;
  }

  // --- 2. MAIN PROCESS ---
  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    // Manage Thread
    let currentThreadTitle;
    if (!threadId) {
        const title = message ? (message.length > 30 ? message.substring(0, 30) + '...' : message) : `Chat with ${bot.name}`;
        const newThread = new Thread({ userId, botId, title, lastMessageAt: new Date() });
        await newThread.save();
        threadId = newThread._id;
        currentThreadTitle = title;
    } else {
        await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });
    }

    // Prepare User Content
    let userContent = [];
    if (message) userContent.push({ type: "text", text: message });

    if (attachedFile) {
        if (attachedFile.mimetype?.startsWith('image/')) {
             const imgBuffer = fs.readFileSync(attachedFile.path);
             userContent.push({ type: "image_url", image_url: { url: `data:${attachedFile.mimetype};base64,${imgBuffer.toString('base64')}` } });
        } else {
             const fileText = await this.extractFileContent(attachedFile);
             if (fileText) userContent.push({ type: "text", text: fileText });
        }
    }

    // 3. Logic Smartsheet (Khusus OpenAI)
    let contextData = "";
    if (bot.smartsheetConfig?.enabled) {
        // Visual Request (Dashboard Screenshot)
        const isFileReq = this.fileManager.isFileRequest(message || '');
        if (isFileReq) {
            const query = this.fileManager.extractFileQuery(message || '');
            const foundFiles = await this.fileManager.searchFiles(query);
            if (foundFiles.length > 0) {
                const reply = this.fileManager.generateSmartDescription(foundFiles, query);
                const attachments = foundFiles.map(f => ({ name: f.name, path: f.relativePath, type: f.type, size: f.sizeKB }));
                await new Chat({ userId, botId, threadId, role: 'user', content: message, attachedFiles: [] }).save();
                await new Chat({ userId, botId, threadId, role: 'assistant', content: reply, attachedFiles: attachments }).save();
                return { response: reply, threadId, attachedFiles: attachments };
            }
        }

        // Data Query
        if (this.isDataQuery(message)) {
            const apiKey = (bot.smartsheetConfig.apiKey && bot.smartsheetConfig.apiKey.trim() !== '') ? bot.smartsheetConfig.apiKey : process.env.SMARTSHEET_API_KEY;
            const sheetId = (bot.smartsheetConfig.sheetId && bot.smartsheetConfig.sheetId.trim() !== '') ? bot.smartsheetConfig.sheetId : process.env.SMARTSHEET_PRIMARY_SHEET_ID;
            
            if (apiKey && sheetId) {
                try {
                    const service = new SmartsheetJSONService();
                    service.apiKey = apiKey;
                    const sheetData = await service.getData(sheetId, message.includes('refresh'));
                    const rawContext = service.formatForAI(sheetData);
                    contextData = `\n\n=== SMARTSHEET DATA ===\n${rawContext}\n=== END DATA ===\n`;
                } catch (e) { console.error("Smartsheet fetch error", e); }
            }
        }
    }

    // 4. Construct System Prompt (Khusus OpenAI)
    let systemPrompt = bot.systemPrompt || "Anda adalah asisten AI.";
    if (contextData) {
        if (systemPrompt.includes('{{CONTEXT}}')) systemPrompt = systemPrompt.replace('{{CONTEXT}}', contextData);
        else systemPrompt += `\n\n${contextData}`;
    }

    // 5. AI EXECUTION
    let aiResponse = "";
    
    // ✅ KOUVENTA LOGIC
    if (bot.kouventaConfig?.enabled) {
        console.log(`🤖 Using KOUVENTA for bot: ${bot.name}`);
        
        const kvService = new KouventaService(
            bot.kouventaConfig.apiKey, 
            bot.kouventaConfig.endpoint // URL FULL
        );

        // ✅ GABUNGKAN PESAN + FILE JADI SATU STRING PANJANG
        // Ini memastikan teks PDF 200k karakter terkirim dalam field "message"
        let finalMessage = message || "";
        
        if (Array.isArray(userContent)) {
            // Ambil semua teks dari file extraction
            const fileTexts = userContent
                .filter(c => c.type === 'text' && c.text !== message) 
                .map(c => c.text)
                .join("\n");
            
            if (fileTexts) {
                finalMessage += `\n\n${fileTexts}`;
            }
        }

        aiResponse = await kvService.generateResponse(finalMessage);
    
    } 
    // ✅ OPENAI LOGIC
    else {
        console.log(`🧠 Using OPENAI for bot: ${bot.name}`);
        const messagesPayload = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: userContent }
        ];

        const completion = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: messagesPayload,
            temperature: 0.5
        });
        aiResponse = completion.choices[0].message.content;
    }

    // 6. Save & Return
    let savedAttachments = [];
    if (attachedFile) {
        savedAttachments.push({
            name: attachedFile.originalname || attachedFile.filename,
            path: attachedFile.url || attachedFile.path,
            type: attachedFile.mimetype?.includes('image') ? 'image' : 'file',
            size: (attachedFile.size / 1024).toFixed(1)
        });
    }

    await new Chat({ userId, botId, threadId, role: 'user', content: message || '', attachedFiles: savedAttachments }).save();
    await new Chat({ userId, botId, threadId, role: 'assistant', content: aiResponse, attachedFiles: [] }).save();

    return { response: aiResponse, threadId, title: currentThreadTitle, attachedFiles: savedAttachments };
  }
}

export default new AICoreService();
