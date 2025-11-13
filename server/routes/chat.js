import express from 'express';
import OpenAI from 'openai';
import Chat from '../models/Chat.js';
import User from '../models/User.js';
import Bot from '../models/Bot.js';
import SmartsheetJSONService from '../services/smartsheet-json.service.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Get user's accessible bots
router.get('/bots', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).populate('assignedBots');
    res.json({ bots: user.assignedBots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get chat history
router.get('/history/:botId', requireAuth, async (req, res) => {
  try {
    const chat = await Chat.findOne({
      userId: req.session.userId,
      botId: req.params.botId
    });

    res.json({ messages: chat ? chat.messages : [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: Get Smartsheet data from JSON cache
async function getSmartsheetData(bot, forceRefresh = false) {
  if (!bot.smartsheetEnabled || !bot.smartsheetConfig?.primarySheetId) {
    return null;
  }

  try {
    const apiKey = bot.smartsheetConfig?.customApiKey || process.env.SMARTSHEET_API_KEY;

    if (!apiKey) {
      console.warn('⚠️  Smartsheet API key not configured');
      return null;
    }

    const service = new SmartsheetJSONService();
    service.apiKey = apiKey;

    const sheetId = bot.smartsheetConfig.primarySheetId;

    console.log(`📊 Getting Smartsheet data (Sheet ID: ${sheetId})`);
    console.log(`   Force refresh: ${forceRefresh}`);

    const data = await service.getData(sheetId, forceRefresh);
    return data;
  } catch (error) {
    console.error('❌ Error getting Smartsheet data:', error.message);
    return null;
  }
}

// Send message
router.post('/message', requireAuth, async (req, res) => {
  try {
    const { botId, message } = req.body;

    console.log('');
    console.log('💬 CHAT MESSAGE');
    console.log(`   Bot ID: ${botId}`);
    console.log(`   Message: ${message.substring(0, 100)}...`);

    // Verify user has access to this bot
    const user = await User.findById(req.session.userId);
    if (!user.assignedBots.includes(botId)) {
      return res.status(403).json({ error: 'Access denied to this bot' });
    }

    const bot = await Bot.findById(botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    console.log(`🤖 Bot: ${bot.name}`);
    console.log(`   Smartsheet enabled: ${bot.smartsheetEnabled}`);

    // Get or create chat
    let chat = await Chat.findOne({
      userId: req.session.userId,
      botId: botId
    });

    if (!chat) {
      chat = new Chat({
        userId: req.session.userId,
        botId: botId,
        messages: []
      });
    }

    // Add user message
    chat.messages.push({
      role: 'user',
      content: message
    });

    // Build conversation history
    const conversationHistory = chat.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    let assistantMessage = '';
    let systemPrompt = '';

    // Check if this is Smartsheet bot
    if (bot.smartsheetEnabled && bot.smartsheetConfig?.primarySheetId) {
      console.log('📊 Smartsheet Bot detected');

      // Check if user wants to refresh data
      const shouldRefresh = message.toLowerCase().includes('refresh') ||
                           message.toLowerCase().includes('update') ||
                           message.toLowerCase().includes('terbaru');

      // Get Smartsheet data from JSON cache
      const sheetData = await getSmartsheetData(bot, shouldRefresh);

      if (sheetData) {
        console.log('✅ Smartsheet data loaded from cache');
        console.log(`   Projects: ${sheetData.projects.length}`);
        console.log(`   Last fetched: ${new Date(sheetData.metadata.fetchedAt).toLocaleString('id-ID')}`);

        // Create service to format data
        const service = new SmartsheetJSONService();
        const formattedContext = service.formatForAI(sheetData);

        // ✅ COMPLETELY REWRITTEN SYSTEM PROMPT - CLEAN FORMAT
        systemPrompt = `Anda adalah ${bot.name}, asisten AI untuk manajemen proyek Garuda Yamato Steel.

Anda memiliki akses ke data proyek REAL-TIME dari Smartsheet yang diperbarui secara berkala.

${formattedContext}

**ATURAN FORMATTING WAJIB - SANGAT PENTING:**

1. JANGAN PERNAH gunakan markdown syntax (**bold**, *italic*, \`code\`, #header)
2. GUNAKAN format plain text yang bersih dan terstruktur
3. Untuk header/judul: Gunakan huruf kapital dan baris kosong
4. Untuk daftar: Gunakan bullet point sederhana (•)
5. Untuk penekanan: Gunakan huruf KAPITAL, bukan **bold**

**CONTOH FORMAT YANG BENAR:**

Saat ditanya "tampilkan semua project":

Berikut adalah daftar semua proyek:

• Employee Meal Vendor Management
• EV BYD Sealion
• Online Assessment
• Overtime
• SMS_Roof, Structure and Building

Total: 5 proyek

---

Saat ditanya detail proyek tertentu:

DETAIL PROYEK: IoT Calipers with Wireless Data Receiver

INFORMASI DASAR
• Project ID: SM-125
• Divisi: Operations GYS
• Departemen: BP (Operations)
• Project Manager: Narintorn Seetanan & Rizal Al Deny

STATUS & PROGRESS
• Progress Keseluruhan: 61%
• Status Proyek: In Progress
• Schedule At Risk: Green (Aman)

TUJUAN PROYEK
• Mengganti pencatatan manual dengan sistem penerimaan data otomatis dari Kaliper Digital
• Menstandarkan proses QC untuk konsistensi dan mengurangi risiko

TIMELINE
• Target Mulai: 2 Juni 2025
• Target Selesai: 15 Januari 2026

**KEMAMPUAN ANDA:**
- Memahami dan menginterpretasi data proyek (nama, owner, status, prioritas, tanggal, risiko)
- Membuat ringkasan yang jelas, laporan progress, dan daftar proyek
- Memberikan rekomendasi prioritas dan mitigasi risiko
- Menjawab pertanyaan tentang timeline, dependencies, dan masalah proyek

**PERILAKU:**
- Presisi, berdasarkan data, dan ringkas
- Selalu gunakan data aktual dari sheet
- Gunakan nama proyek yang tepat
- Saat listing banyak proyek: format bullet sederhana
- Saat detail proyek: gunakan struktur dengan sub-bullets untuk atribut

**INSTRUKSI KHUSUS:**
1. Saat diminta "list project" atau "tampilkan project": Return HANYA nama proyek sebagai bullets
2. Untuk project issues: Hanya tampilkan proyek dengan masalah AKTUAL
   - Abaikan: "No Issue", "None", "-", "n/a", "No Issues", blank
   - Hanya tampilkan: deskripsi masalah atau warning yang spesifik
3. Saat menampilkan detail proyek, organisir berdasarkan bagian:
   - Informasi Dasar (ID, Divisi, Departemen)
   - Status & Progress (Status, Progress %, At Risk)
   - Timeline (Start/End dates, Days since update)
   - Detail Penting (Objective, Next Plan, Issues jika ada)
   - Budget (jika diminta)

**HINDARI:**
- Asumsi tentang data yang tidak ada
- Saran finansial atau legal
- MARKDOWN SYNTAX (**, *, \`, #) - GUNAKAN PLAIN TEXT
- Paragraf panjang - gunakan bullets terstruktur
- Saran template atau best practices generik

**KONTEKS DATA:**
- Terakhir Diperbarui: ${new Date(sheetData.metadata.fetchedAt).toLocaleString('id-ID')}
- Total Proyek: ${sheetData.projects.length}
- Tingkat Penyelesaian: ${sheetData.statistics.completionRate}

Jawab dalam Bahasa Indonesia profesional kecuali diminta bahasa lain.

INGAT: JANGAN gunakan ** untuk bold atau markdown lainnya. Gunakan HURUF KAPITAL untuk penekanan.`;

        if (shouldRefresh) {
          console.log('🔄 User requested data refresh');
        }

      } else {
        console.warn('⚠️  Failed to load Smartsheet data');
        systemPrompt = `Anda adalah ${bot.name} untuk Garuda Yamato Steel.

Maaf, saat ini data Smartsheet tidak dapat diakses.

Kemungkinan penyebab:
• API key tidak valid
• Sheet ID tidak ditemukan
• Koneksi ke Smartsheet bermasalah

Silakan coba lagi nanti atau hubungi administrator untuk bantuan.`;
      }

    } else {
      // General bot - Standard ChatGPT
      console.log('🤖 General Bot - Standard ChatGPT mode');

      systemPrompt = `Anda adalah ${bot.name}. ${bot.description || 'Asisten AI yang membantu.'}

Anda adalah asisten AI general-purpose yang dibuat untuk membantu pengguna dengan berbagai tugas.
Anda dapat:
- Menjawab pertanyaan tentang berbagai topik
- Membantu dengan analisis dan problem-solving
- Memberikan penjelasan dan klarifikasi
- Membantu dengan pertanyaan umum

Bersikaplah membantu, akurat, dan profesional dalam respons Anda.
Berikan jawaban yang jelas dan ringkas.

PENTING: Jangan gunakan markdown syntax (**bold**, *italic*). Gunakan plain text yang bersih.`;
    }

    // Call OpenAI Chat Completions
    console.log('🤖 Calling OpenAI...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        ...conversationHistory
      ],
      temperature: 0.7,
      max_tokens: 2048,
    });

    if (completion.choices && completion.choices[0]?.message?.content) {
      assistantMessage = completion.choices[0].message.content;
      console.log('✅ OpenAI response received');
    } else {
      throw new Error('No response from OpenAI');
    }

    // Add assistant message
    chat.messages.push({
      role: 'assistant',
      content: assistantMessage
    });

    await chat.save();
    console.log('✅ Chat saved');
    console.log('');

    res.json({
      message: assistantMessage,
      chatId: chat._id,
      smartsheetEnabled: bot.smartsheetEnabled
    });

  } catch (error) {
    console.error('');
    console.error('❌ CHAT ERROR');
    console.error('='.repeat(70));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('='.repeat(70));
    console.error('');
    res.status(500).json({ error: error.message });
  }
});

// Clear chat history
router.delete('/history/:botId', requireAuth, async (req, res) => {
  try {
    await Chat.findOneAndDelete({
      userId: req.session.userId,
      botId: req.params.botId
    });

    res.json({ message: 'Chat history cleared' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// NEW: Endpoint to manually refresh Smartsheet cache
router.post('/refresh-smartsheet/:botId', requireAuth, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.botId);

    if (!bot || !bot.smartsheetEnabled) {
      return res.status(400).json({ error: 'Smartsheet not enabled for this bot' });
    }

    console.log('🔄 Manual cache refresh requested');
    const data = await getSmartsheetData(bot, true);

    if (!data) {
      return res.status(500).json({ error: 'Failed to refresh Smartsheet data' });
    }

    res.json({
      success: true,
      message: 'Smartsheet data refreshed successfully',
      data: {
        sheetName: data.metadata.name,
        totalProjects: data.projects.length,
        fetchedAt: data.metadata.fetchedAt,
        statistics: data.statistics
      }
    });

  } catch (error) {
    console.error('Error refreshing Smartsheet:', error);
    res.status(500).json({ error: error.message });
  }
});

// NEW: Get cache status
router.get('/smartsheet-cache-status/:botId', requireAuth, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.botId);

    if (!bot || !bot.smartsheetEnabled) {
      return res.json({
        enabled: false,
        message: 'Smartsheet not enabled for this bot'
      });
    }

    const service = new SmartsheetJSONService();
    const cacheInfo = await service.getCacheInfo();

    res.json({
      enabled: true,
      sheetId: bot.smartsheetConfig.primarySheetId,
      cache: cacheInfo
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
