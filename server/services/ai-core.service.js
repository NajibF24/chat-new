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

  // ✅ 1. FUNGSI DETEKSI QUERY DATA
  isDataQuery(message) {
    const lowerMsg = (message || '').toLowerCase();
    
    // Jika user minta gambar/dashboard, return false agar masuk ke logic FileManager
    const visualKeywords = ['dashboard', 'gambar', 'image', 'foto', 'screenshot', 'show', 'tampilkan', 'lihat'];
    if (visualKeywords.some(k => lowerMsg.includes(k)) && lowerMsg.includes('dashboard')) return false;

    // Keyword untuk memicu pembacaan data (Smartsheet/Excel)
    const dataKeywords = ['berikan', 'cari', 'list', 'daftar', 'semua', 'project', 'status', 'progress', 'overdue', 'summary', 'health', 'analisa', 'resume', 'data', 'nilai', 'rows', 'column', 'missing', 'date', 'workstream', 'total', 'berapa', 'mana', 'versi', 'latest', 'terbaru'];
    return dataKeywords.some(k => lowerMsg.includes(k));
  }

  // ✅ 2. UNIVERSAL FILE EXTRACTOR (Tidak Diubah - Tetap Sama)
  async extractFileContent(attachedFile) {
      if (!attachedFile || !attachedFile.path) return null;
      
      const mime = attachedFile.mimetype || '';
      const originalName = attachedFile.originalname || '';
      const ext = path.extname(originalName).toLowerCase();
      let content = null;
      let displayType = 'FILE';
      const CHAR_LIMIT = 200000; 

      console.log(`📂 [FILE START] Processing: ${originalName} (${mime})`);

      try {
          // PDF
          if (mime === 'application/pdf' || ext === '.pdf') {
              const dataBuffer = fs.readFileSync(attachedFile.path);
              const data = await pdf(dataBuffer);
              content = data.text.replace(/\n\s*\n/g, '\n');
              displayType = 'PDF';
          }
          // WORD (.docx)
          else if (ext === '.docx' || mime.includes('word')) {
              try {
                  const result = await mammoth.extractRawText({ path: attachedFile.path });
                  content = result.value;
                  displayType = 'DOCX (Mammoth)';
              } catch (err) {
                  try {
                        content = await officeParser.parseOfficeAsync(attachedFile.path);
                        displayType = 'DOCX (OfficeParser)';
                  } catch (e) { console.error(e); }
              }
          }
          // EXCEL (.xlsx)
          else if (ext === '.xlsx' || ext === '.xls' || mime.includes('spreadsheet')) {
              console.log("📊 Reading Excel file...");
              const workbook = XLSX.readFile(attachedFile.path);
              let allSheetsData = [];
              workbook.SheetNames.forEach(sheetName => {
                  const sheet = workbook.Sheets[sheetName];
                  const csv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' }); 
                  if (csv && csv.trim().length > 0) allSheetsData.push(`[SHEET: ${sheetName}]\n${csv}`);
              });
              if (allSheetsData.length > 0) {
                  content = allSheetsData.join('\n\n====================\n\n');
                  displayType = `EXCEL (${workbook.SheetNames.length} Sheets)`;
              }
          }
          // POWERPOINT (.pptx)
          else if (ext === '.pptx' || ext === '.ppt' || mime.includes('presentation')) {
              try {
                  content = await officeParser.parseOfficeAsync(attachedFile.path, { outputErrorToConsole: true });
                  displayType = 'POWERPOINT';
              } catch (err) {
                  return `[SYSTEM ERROR: Gagal membaca file PPT. ${err.message}.]`;
              }
          }
          // TEXT / CODE
          else {
               const textExts = ['.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.html', '.css', '.js', '.jsx', '.ts', '.py', '.java', '.c', '.sql', '.env'];
               if (textExts.includes(ext) || mime.startsWith('text/') || mime.includes('json')) {
                   content = fs.readFileSync(attachedFile.path, 'utf8');
                   displayType = 'CODE/TEXT';
               }
          }

          if (content && content.trim().length > 0) {
              if (typeof content === 'object') content = JSON.stringify(content, null, 2);
              const trimmedContent = content.substring(0, CHAR_LIMIT);
              return `\n\n[FILE START: ${originalName} (${displayType})]\n${trimmedContent}\n[FILE END]\n`;
          } else {
              return `\n[SYSTEM INFO: File ${originalName} kosong atau tidak terbaca.]\n`;
          }

      } catch (e) {
          console.error(`❌ [FILE ERROR] ${originalName}:`, e);
          return `\n[SYSTEM ERROR: Gagal membaca file ${originalName}. ${e.message}]`;
      }
  }

  // ✅ 3. MAIN PROCESS
  async processMessage({ userId, botId, message, attachedFile, threadId, history = [] }) {
    // A. Validasi Bot
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    // B. Manage Thread
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

    // C. Prepare User Content (Text + Image/File)
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

    // --- D. LOGIC FILE MANAGER (DASHBOARD SEARCH) ---
    // (Cek apakah user minta gambar dashboard lokal)
    const isFileReq = this.fileManager.isFileRequest(message || '');
    if (isFileReq) {
        const query = this.fileManager.extractFileQuery(message || '');
        console.log(`🔎 Searching dashboard files: "${query}"`);
        
        const foundFiles = await this.fileManager.searchFiles(query);
        
        if (foundFiles.length > 0) {
            const reply = this.fileManager.generateSmartDescription(foundFiles, query);
            const attachments = foundFiles.map(f => ({ 
                name: f.name, 
                path: f.relativePath, 
                type: f.type, 
                size: f.sizeKB 
            }));

            await new Chat({ userId, botId, threadId, role: 'user', content: message, attachedFiles: [] }).save();
            await new Chat({ userId, botId, threadId, role: 'assistant', content: reply, attachedFiles: attachments }).save();
            
            return { response: reply, threadId, attachedFiles: attachments };
        }
    }

    // --- E. LOGIC SMARTSHEET FETCH ---
    let contextData = "";
    // Cek config: support sheetId (baru) atau primarySheetId (lama)
    const targetSheetId = bot.smartsheetConfig?.sheetId || bot.smartsheetConfig?.primarySheetId;
    
    if (this.isDataQuery(message) && bot.smartsheetConfig?.enabled && targetSheetId) {
        const apiKey = bot.smartsheetConfig.apiKey || process.env.SMARTSHEET_API_KEY;
        
        if (apiKey && targetSheetId) {
            try {
                const service = new SmartsheetJSONService();
                service.apiKey = apiKey;
                const sheetData = await service.getData(targetSheetId, message.toLowerCase().includes('refresh'));
                
                // Format data menjadi string context
                const rawContext = service.formatForAI(sheetData);
                contextData = rawContext; // Simpan dulu, jangan di-append langsung
            } catch (e) { 
                console.error("⚠️ Smartsheet fetch error", e); 
                contextData = "[SISTEM: Gagal mengambil data real-time Smartsheet.]";
            }
        }
    }

    // ============================================================
    // --- F. LOGIC SYSTEM PROMPT (ANTI-TABRAKAN) ---
    // ============================================================
    
    let finalSystemPrompt = "";

    // 1. Cek apakah User membuat Custom Prompt di Dashboard?
    // Kita cek field 'prompt' (baru) atau 'systemPrompt' (lama)
    // Syarat: Harus cukup panjang (>20 char) dan BUKAN default system ("Anda adalah...")
    const userPrompt = bot.prompt || bot.systemPrompt;
    const isCustom = userPrompt && userPrompt.length > 20 && !userPrompt.includes("Anda adalah asisten AI profesional yang siap membantu");

    if (isCustom) {
        // ✅ KASUS A: CUSTOM BOT (Misal: "BP Revamp Document Controller")
        // Gunakan prompt user sepenuhnya, lalu tempel data di bawahnya.
        
        finalSystemPrompt = userPrompt;

        // Inject Smartsheet Data jika ada (menggantikan placeholder {{CONTEXT}} atau append di bawah)
        if (contextData) {
            if (finalSystemPrompt.includes('{{CONTEXT}}')) {
                finalSystemPrompt = finalSystemPrompt.replace('{{CONTEXT}}', `\n\n=== DATA SOURCE ===\n${contextData}\n=== END DATA ===\n`);
            } else {
                finalSystemPrompt += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📁 DATASET REAL-TIME (DARI SMARTSHEET):\n${contextData}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n(Gunakan data di atas sebagai referensi utama jawaban Anda.)`;
            }
        }

    } else {
        // ✅ KASUS B: DEFAULT SMART BOT (Project Analyst + Versioning Logic)
        // Jika user tidak mengisi prompt, gunakan logika CANGGIH ini.
        
        finalSystemPrompt = `Anda adalah ${bot.name}, Asisten Project Management & Document Control Profesional.

${contextData ? `=== AKSES DATA PROYEK REAL-TIME ===\n${contextData}\n====================================` : ''}

**PERAN ANDA:**
1. **Analisis Proyek:** Monitoring status, health, dan progress.
2. **Document Controller (Cerdas):** Melacak versi dokumen & revisi.

**LOGIKA DETEKSI VERSI DOKUMEN (CRITICAL):**
Jika user mencari dokumen (misal: "Proposal DevSecOps"):
1. **Fuzzy Search:** Kumpulkan semua file dengan nama mirip (contoh: "TechProc_DevSecOps", "DevSecOps_Rev1").
2. **Cek Hierarki Revisi:**
   - Urutan: Draft < v1 < Rev1 < Rev2 < Final.
   - Jika tanpa label, file dengan TANGGAL MODIFIKASI TERBARU = LATEST.
3. **Output:** Selalu sarankan file versi TERBARU (Latest). Tandai file lama sebagai "Outdated/Usang".

**FORMAT JAWABAN:**
- Gunakan Markdown (Tabel, Bold) untuk kerapian.
- Bahasa Indonesia Profesional.
- Jika data tidak ditemukan di sheet, katakan "Data tidak ditemukan".
`;
    }

    // --- G. AI EXECUTION (OPENAI / KOUVENTA) ---
    let aiResponse = "";
    
    // 1. KOUVENTA LOGIC (Jika Enabled)
    if (bot.kouventaConfig?.enabled) {
        console.log(`🤖 Using KOUVENTA for bot: ${bot.name}`);
        const kvService = new KouventaService(bot.kouventaConfig.apiKey, bot.kouventaConfig.endpoint);
        
        // Gabungkan System Prompt + User Message untuk Kouventa
        let finalMessage = `[SYSTEM INSTRUCTION]\n${finalSystemPrompt}\n\n[USER MESSAGE]\n${message || ""}`;

        if (Array.isArray(userContent)) {
            const fileTexts = userContent
                .filter(c => c.type === 'text' && c.text !== message) 
                .map(c => c.text)
                .join("\n");
            if (fileTexts) finalMessage += `\n\n[ATTACHED FILE CONTENT]\n${fileTexts}`;
        }
        aiResponse = await kvService.generateResponse(finalMessage);
    } 
    // 2. OPENAI LOGIC (Default)
    else {
        console.log(`🧠 Using OPENAI for bot: ${bot.name}`);
        const messagesPayload = [
            { role: 'system', content: finalSystemPrompt },
            ...history,
            { role: 'user', content: userContent }
        ];

        const completion = await this.openai.chat.completions.create({
            model: 'gpt-4o', // Gunakan model terbaik
            messages: messagesPayload,
            temperature: 0.5
        });
        aiResponse = completion.choices[0].message.content;
    }

    // --- H. SAVE & RETURN ---
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