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
        'terbaru', 'revisi', 'dokumen', 'file', 'tracking', 'update', 'history', 'riwayat',
        'give', 'show', 'find', 'search', 'get', 'document', 'documents', 'version', 'excel', 'sheet', 
        'another', 'other', 'what', 'where', 'have', 'all', 'everything'
    ];
    
    return dataKeywords.some(k => lowerMsg.includes(k)) || message.includes('_') || message.includes('.'); 
  }

  // ===========================================================================
  // 2. UTILS: EKSTRAKSI FILE
  // ===========================================================================
  async extractFileContent(attachedFile) {
      if (!attachedFile || !attachedFile.path) return null;
      
      const mime = attachedFile.mimetype || '';
      const originalName = attachedFile.originalname || '';
      const ext = path.extname(originalName).toLowerCase();
      let content = null;
      const CHAR_LIMIT = 200000; 
      try {
          if (mime === 'application/pdf' || ext === '.pdf') {
              const dataBuffer = fs.readFileSync(attachedFile.path);
              const data = await pdf(dataBuffer);
              content = data.text.replace(/\n\s*\n/g, '\n');
          } else if (ext === '.docx' || mime.includes('word')) {
              try {
                  const result = await mammoth.extractRawText({ path: attachedFile.path });
                  content = result.value;
              } catch (err) {
                  try { content = await officeParser.parseOfficeAsync(attachedFile.path); } catch (e) {}
              }
          } else if (ext === '.xlsx' || ext === '.xls') {
              const workbook = XLSX.readFile(attachedFile.path);
              let allSheetsData = [];
              workbook.SheetNames.forEach(sheetName => {
                  const sheet = workbook.Sheets[sheetName];
                  const csv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' }); 
                  if (csv.trim()) allSheetsData.push(`[SHEET: ${sheetName}]\n${csv}`);
              });
              if (allSheetsData.length > 0) content = allSheetsData.join('\n\n');
          } else {
               content = fs.readFileSync(attachedFile.path, 'utf8');
          }
          if (content && content.trim().length > 0) {
              return `\n\n[FILE: ${originalName}]\n${content.substring(0, CHAR_LIMIT)}\n[END FILE]\n`;
          }
          return `\n[SYSTEM INFO: File ${originalName} kosong.]\n`;
      } catch (e) { return `\n[SYSTEM ERROR reading file]\n`; }
  }

  // ===========================================================================
  // 3. CORE: ROBUST FILTERING (RAW SUBSTRING MATCH)
  // ===========================================================================
  
  // Fungsi untuk membuang kata-kata perintah ("give me") dan menyisakan INTI pencarian
  extractCoreQuery(userMessage) {
      // Daftar kata yang harus dibuang, KECUALI jika kata itu bagian dari nama file (underscore/titik)
      const stopWords = [
          'give', 'me', 'all', 'document', 'documents', 'file', 'files', 'data', 'list', 'show', 
          'find', 'search', 'cari', 'berikan', 'minta', 'daftar', 'semua', 'yang', 'ada', 'versi', 
          'version', 'history', 'riwayat', 'latest', 'terbaru', 'update', 'tracking', 'excel', 'sheet',
          'please', 'tolong', 'you', 'have', 'of', 'this', 'the', 'for', 'about', 'terkait', 'dengan'
      ];
      
      const words = userMessage.trim().split(/\s+/);
      
      // Ambil kata-kata yang BUKAN stopword
      const coreWords = words.filter(w => {
          const lowerW = w.toLowerCase().replace(/[^a-z0-9\._\-]/g, ''); // bersihkan simbol bacaan di ujung
          return !stopWords.includes(lowerW) || w.includes('_') || w.includes('.');
      });

      return coreWords.join(' ').trim();
  }

  filterRelevantData(sheetData, userMessage) {
    let items = [];
    let dataContainer = null; 

    // Handle Structure
    if (Array.isArray(sheetData)) { items = sheetData; } 
    else if (sheetData?.projects && Array.isArray(sheetData.projects)) { items = sheetData.projects; dataContainer = 'projects'; } 
    else if (sheetData?.rows && Array.isArray(sheetData.rows)) { items = sheetData.rows; dataContainer = 'rows'; } 
    else { return sheetData; }

    const rawQuery = userMessage.toLowerCase().trim();
    
    // --- STEP 1: GENERAL REQUEST CHECK ---
    // Jika user minta "give me all document" tanpa menyebut nama file spesifik
    const coreQuery = this.extractCoreQuery(userMessage); // Ambil inti kalimat
    
    // Jika inti kalimat kosong atau sangat pendek (misal: "list"), berarti General Request
    if (coreQuery.length < 3) {
        console.log("🔍 Filter: General Request (No specific filename).");
        const slicedItems = items.slice(0, 50); // Ambil 50 teratas/terbaru
        return Array.isArray(sheetData) ? slicedItems : { ...sheetData, [dataContainer]: slicedItems };
    }

    // --- STEP 2: RAW SUBSTRING MATCH (The Solution) ---
    // Kita cari "coreQuery" (misal: "Garubeka01...MEC") di dalam JSON string setiap baris.
    // Ini akan menemukan string tersebut meskpiun dia ada di tengah-tengah Path Folder atau URL.
    
    const searchString = coreQuery.toLowerCase();
    console.log(`🔍 Searching for substring: [${searchString}] inside data rows.`);

    const deepMatches = items.filter(item => {
        // Konversi seluruh baris data (termasuk path, link, user, dll) menjadi satu string lowercase
        const rowString = JSON.stringify(item).toLowerCase();
        
        // CEK APAKAH STRING PENCARIAN ADA DI DALAMNYA
        return rowString.includes(searchString);
    });

    if (deepMatches.length > 0) {
        console.log(`✅ Deep Match Found: ${deepMatches.length} rows.`);
        // Ambil hingga 150 baris untuk memastikan semua history revisi terangkut
        const resultItems = deepMatches.slice(0, 150); 
        return Array.isArray(sheetData) ? resultItems : { ...sheetData, [dataContainer]: resultItems };
    }

    // --- STEP 3: FALLBACK (KEYWORD MATCH) ---
    // Jika pencarian utuh gagal (mungkin user salah ketik 1 huruf), coba cari per kata
    const keywords = searchString.split(/[\s\_\-\.]+/).filter(w => w.length > 3);
    
    if (keywords.length > 0) {
        const keywordMatches = items.filter(item => {
            const rowString = JSON.stringify(item).toLowerCase();
            // Match jika setidaknya satu keyword ada
            return keywords.some(k => rowString.includes(k));
        });
        console.log(`⚠️ Fuzzy Match Found: ${keywordMatches.length} rows.`);
        const finalItems = keywordMatches.slice(0, 50);
        return Array.isArray(sheetData) ? finalItems : { ...sheetData, [dataContainer]: finalItems };
    }

    // --- STEP 4: SAFETY NET ---
    // Jangan pernah return kosong jika user sudah effort mengetik
    console.log("❌ No matches found. Returning fallback (Top 30).");
    const fallback = items.slice(0, 30);
    return Array.isArray(sheetData) ? fallback : { ...sheetData, [dataContainer]: fallback };
  }

  // ===========================================================================
  // 4. MAIN PROCESS
  // ===========================================================================
  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

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

    // Dashboard Files
    if (this.fileManager.isFileRequest(message || '')) {
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

    // SMARTSHEET LOGIC
    let contextData = "";
    const targetSheetId = bot.smartsheetConfig?.sheetId || bot.smartsheetConfig?.primarySheetId;
    
    if (this.isDataQuery(message) && bot.smartsheetConfig?.enabled && targetSheetId) {
        try {
            const service = new SmartsheetJSONService();
            if (bot.smartsheetConfig.apiKey) service.apiKey = bot.smartsheetConfig.apiKey;
            
            // 1. Fetch
            const fullSheetData = await service.getData(targetSheetId, message.includes('refresh'));
            
            // 2. Filter (NEW RAW LOGIC)
            const filteredData = this.filterRelevantData(fullSheetData, message);

            // 3. Format
            const rawContext = service.formatForAI(filteredData);
            
            contextData = `\n\n=== FILTERED DATA (RAW MATCH) ===\n${rawContext}\n=== END DATA ===\n`;
            
        } catch (e) { 
            console.error("Smartsheet Error:", e); 
            contextData = "\n[SISTEM: Gagal mengambil data.]\n";
        }
    }

    // SYSTEM PROMPT
    let finalSystemPrompt = "";
    const userPrompt = bot.prompt || bot.systemPrompt;
    const isCustomPrompt = userPrompt && userPrompt.length > 20 && !userPrompt.includes("Anda adalah asisten AI profesional");

    if (isCustomPrompt) {
        finalSystemPrompt = userPrompt;
        if (contextData) {
            if (finalSystemPrompt.includes('{{CONTEXT}}')) {
                finalSystemPrompt = finalSystemPrompt.replace('{{CONTEXT}}', contextData);
            } else {
                finalSystemPrompt += `\n\n${contextData}\n(Gunakan data di atas sebagai referensi utama.)`;
            }
        }
    } else {
        finalSystemPrompt = `Anda adalah ${bot.name}, Project Analyst.
${contextData}
**INSTRUKSI:**
1. Jika data mengandung banyak baris (history), tampilkan semuanya dalam TABEL.
2. Periksa kolom 'Folder Location' atau 'Link', seringkali nama file ada di situ.
3. Ikuti bahasa user.`;
    }

    // EXECUTE AI
    let aiResponse = "";
    const messagesPayload = [
        { role: 'system', content: finalSystemPrompt },
        ...history,
        { role: 'user', content: userContent }
    ];

    const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: messagesPayload,
        temperature: 0.1 
    });
    aiResponse = completion.choices[0].message.content;

    let savedAttachments = [];
    if (attachedFile) {
        savedAttachments.push({
            name: attachedFile.originalname || attachedFile.filename,
            path: attachedFile.path,
            type: attachedFile.mimetype?.includes('image') ? 'image' : 'file',
            size: (attachedFile.size / 1024).toFixed(1)
        });
    }

    await new Chat({ userId, botId, threadId, role: 'user', content: message || '', attachedFiles: savedAttachments }).save();
    await new Chat({ userId, botId, threadId, role: 'assistant', content: aiResponse }).save();

    return { response: aiResponse, threadId, title: currentThreadTitle, attachedFiles: savedAttachments };
  }
}

export default new AICoreService();