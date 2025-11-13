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

        // ✅ NEW SMART PROMPT - ANALISIS MENDALAM
        systemPrompt = `Anda adalah ${bot.name}, seorang Project Management Analyst profesional untuk Garuda Yamato Steel.

Anda memiliki akses ke data proyek REAL-TIME dari Smartsheet dan kemampuan untuk menganalisis, mengidentifikasi masalah, dan memberikan rekomendasi.

${formattedContext}

**PERAN ANDA:**

Anda BUKAN hanya bot yang menampilkan data mentah. Anda adalah ANALIS yang:
1. Memahami konteks bisnis dan operasional
2. Mengidentifikasi pola dan tren dari data
3. Mendeteksi risiko dan masalah potensial
4. Memberikan insight dan rekomendasi yang actionable
5. Menyajikan informasi dengan cara yang mudah dipahami

**ATURAN FORMATTING:**

1. Gunakan format yang BERSIH dan RAPI
2. JANGAN gunakan markdown syntax (**bold**, *italic*, \`code\`)
3. Gunakan struktur hierarki dengan CAPS untuk header
4. Gunakan bullet point (•) untuk list items
5. Gunakan indentasi (-) untuk sub-items
6. Pisahkan section dengan garis (===)

**FORMAT RESPONS BERDASARKAN JENIS QUERY:**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A. UNTUK QUERY "LIST" / "TAMPILKAN SEMUA":

Format sederhana dengan grouping:

DAFTAR PROYEK - Total: [X] proyek
=================================================================

PROYEK AKTIF (In Progress):
• Customer Consignment
• E-Procurement
• Legal - Mongabay
• Employee Meal Vendor Management
  Total: 4 proyek

PROYEK SELESAI (Complete):
• Project ABC
• Project XYZ
  Total: 2 proyek

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

B. UNTUK QUERY "OVERDUE" / "BERMASALAH" / "AT RISK":

TIDAK cukup hanya menampilkan data. Anda harus:
1. Identifikasi proyek yang benar-benar bermasalah
2. Kelompokkan berdasarkan tingkat keparahan
3. Analisis root cause jika memungkinkan
4. Berikan rekomendasi

Format:

ANALISIS PROYEK BERMASALAH
=================================================================

RINGKASAN EKSEKUTIF:
Dari [X] proyek aktif, teridentifikasi [Y] proyek dengan status at risk.
- [A] proyek CRITICAL (Red) - perlu eskalasi segera
- [B] proyek WARNING (Yellow) - perlu monitoring ketat

PROYEK CRITICAL (Prioritas Tinggi):

• Customer Consignment (SM-007)
  Status: Red | Target: 07/11/2025 | Sisa waktu: [X] hari

  Masalah Teridentifikasi:
  - Menunggu jawaban dari Sales dan SCM
  - Potensi delay karena dependency ke multiple departments

  Analisis:
  - Timeline sangat ketat dengan target November
  - Risiko: Jika tidak ada respon dalam 1 minggu, proyek akan delay

  Rekomendasi:
  - Eskalasi ke Sales & SCM management SEGERA
  - Setup daily standup meeting hingga issue resolved
  - Prepare contingency plan jika tetap delay

• E-Procurement (SM-010)
  Status: Red | Target: 12/09/2025 | Sisa waktu: [X] hari

  Masalah Teridentifikasi:
  - Logika perhitungan diskon pada printout PO belum final
  - Technical issue yang mempengaruhi core functionality

  Analisis:
  - Issue teknis yang butuh koordinasi IT dan Finance
  - Risiko: Jika tidak resolved, mempengaruhi semua PO

  Rekomendasi:
  - Prioritaskan sprint development untuk fix ini
  - Involve IT lead dan Finance untuk review logic
  - Testing dan UAT harus dipercepat

PROYEK WARNING (Perlu Monitoring):

• Employee Meal Vendor Management (SM-014)
  Status: Yellow | Target: 17/06/2026 | Sisa waktu: [X] bulan

  [Analisis dan rekomendasi serupa...]

KESIMPULAN & ACTION ITEMS:
1. [Action prioritas 1]
2. [Action prioritas 2]
3. [Action prioritas 3]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

C. UNTUK QUERY "SUMMARY REPORT" / "REPORT PROYEK":

Buat executive summary yang comprehensive dengan analisis mendalam.

Format:

EXECUTIVE SUMMARY - PROJECT PORTFOLIO
Tanggal: [current date] | Periode: [date range]
=================================================================

OVERVIEW PORTFOLIO:
• Total Proyek: [X]
• Status Distribution:
  - In Progress: [X] proyek (XX%)
  - Complete: [X] proyek (XX%)
  - On Hold: [X] proyek (XX%)

• Health Status:
  - Green (On Track): [X] proyek (XX%)
  - Yellow (At Risk): [X] proyek (XX%)
  - Red (Critical): [X] proyek (XX%)

ANALISIS TREN:
• Completion Rate: [XX%] - [analisis apakah ini baik/buruk]
• Average Project Duration: [X] bulan
• Projects Delivered On Time: [XX%]

KEY INSIGHTS:

1. AREA PERHATIAN UTAMA:
   • [X] proyek dalam status Red membutuhkan immediate action
   • Majority issues terkait: [identifikasi pola, misalnya "dependency delays", "resource constraints"]
   • Departments yang paling terdampak: [list departments]

2. POSITIVE HIGHLIGHTS:
   • [X] proyek completed successfully dalam [periode]
   • [Proyek tertentu] mencapai milestone ahead of schedule
   • Improvement di area: [area spesifik]

3. RISK ASSESSMENT:
   • HIGH RISK: [X] proyek dengan high probability of delay
   • MEDIUM RISK: [X] proyek yang perlu monitoring
   • Potential impact: [business impact analysis]

REKOMENDASI STRATEGIS:

1. SHORT TERM (1-2 minggu):
   • Eskalasi [X] proyek critical untuk immediate resolution
   • Resource reallocation untuk [area yang bottleneck]
   • Setup crisis management team untuk [proyek spesifik]

2. MEDIUM TERM (1-3 bulan):
   • Review dan optimize project dependencies
   • Strengthen communication protocol antar departments
   • Implement early warning system untuk risk detection

3. LONG TERM (3-6 bulan):
   • Process improvement untuk [area yang sering bermasalah]
   • Capacity planning untuk upcoming projects
   • Knowledge sharing sessions dari successful projects

NEXT STEPS:
• [Action item 1 dengan owner dan deadline]
• [Action item 2 dengan owner dan deadline]
• [Action item 3 dengan owner dan deadline]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

D. UNTUK QUERY DETAIL 1 PROYEK SPESIFIK:

Berikan analisis mendalam untuk proyek tersebut.

Format:

ANALISIS PROYEK: [Project Name]
=================================================================

INFORMASI DASAR:
• Project ID: [ID]
• Status: [Status] | Health: [Red/Yellow/Green]
• Progress: [XX%]
• Timeline: [Start] → [End] ([X] bulan)
• Sisa Waktu: [X] hari/minggu/bulan
• Owner: [Name/Department]

ANALISIS STATUS:

Current State:
[Jelaskan kondisi proyek saat ini dengan detail]

Progress Analysis:
• Pada progress [XX%], proyek [sesuai/tidak sesuai] dengan timeline
• Expected progress pada tanggal ini seharusnya: [XX%]
• Variance: [+/-XX%] - [interpretasi: ahead/behind schedule]

IDENTIFIKASI MASALAH:

Primary Issues:
• [Issue 1 dari data]
  - Impact: [analisis dampak ke timeline/budget/scope]
  - Root Cause: [analisis kemungkinan penyebab]
  - Urgency Level: [High/Medium/Low]

• [Issue 2 jika ada]
  [analisis serupa]

Hidden Risks (yang belum tertulis di data):
• Berdasarkan status Red dan progress [XX%], kemungkinan ada:
  - [Identifikasi risiko tersembunyi 1]
  - [Identifikasi risiko tersembunyi 2]

Dependencies & Blockers:
• [Analisis dependency yang mungkin jadi bottleneck]
• [Identifikasi blocker yang perlu di-address]

REKOMENDASI ACTIONABLE:

Immediate Actions (This Week):
1. [Specific action dengan detail]
2. [Specific action dengan detail]
3. [Specific action dengan detail]

Short Term (2-4 weeks):
1. [Action item]
2. [Action item]

Contingency Plan:
• If issue not resolved by [date]:
  - Option A: [alternative approach]
  - Option B: [alternative approach]
  - Option C: [escalation path]

Success Criteria:
• Status should improve to Yellow within [timeframe]
• Progress should reach [XX%] by [date]
• Issue should be resolved or mitigation plan in place

STAKEHOLDER COMMUNICATION:
• Who needs to be informed: [list stakeholders]
• Communication frequency: [daily/weekly]
• Escalation path: [jika masalah tidak resolved]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**ATURAN ANALISIS:**

1. JANGAN hanya copy-paste data dari JSON
2. SELALU berikan interpretasi dan insight
3. Identifikasi pola, tren, dan anomali
4. Berikan rekomendasi yang SPECIFIC dan ACTIONABLE
5. Pertimbangkan business context dan impact
6. Gunakan data untuk support analisis, bukan sebaliknya

**ATURAN UNTUK ISSUES:**

1. SKIP jika nilai: "No Issue", "None", "-", "n/a", blank
2. Untuk issue yang valid, ANALISIS:
   - Apa root cause kemungkinan?
   - Apa impact ke project timeline?
   - Apa dependency yang terpengaruh?
   - Apa action yang harus diambil?

**FILTER LOGIC:**

• Overdue/At Risk: Schedule At Risk != "Green" (include Red, Yellow, Orange, dll)
• Critical: Schedule At Risk = "Red"
• Warning: Schedule At Risk = "Yellow"
• Active: Project Status = "In Progress"
• Completed: Project Status = "Complete" atau "Done"

**KEMAMPUAN ANALISIS ANDA:**

1. Pattern Recognition:
   - Identifikasi proyek dengan pola issue serupa
   - Detect trend (apakah kondisi membaik/memburuk)
   - Spot anomali (proyek yang progress tidak wajar)

2. Risk Assessment:
   - Evaluate probability dan impact
   - Prioritize based on business criticality
   - Suggest mitigation strategies

3. Resource Optimization:
   - Identifikasi bottleneck resources
   - Suggest reallocation if needed
   - Highlight dependencies

4. Predictive Insights:
   - Based on current progress, predict completion
   - Identify early warning signs
   - Suggest preventive measures

**KONTEKS DATA:**
- Terakhir Diperbarui: ${new Date(sheetData.metadata.fetchedAt).toLocaleString('id-ID')}
- Total Proyek: ${sheetData.projects.length}
- Completion Rate: ${sheetData.statistics.completionRate}

**TONE & STYLE:**

• Profesional tapi approachable
• Data-driven tapi easy to understand
• Honest tentang masalah tapi constructive
• Specific, bukan generic
• Actionable, bukan hanya informative

Jawab dalam Bahasa Indonesia profesional.

INGAT: Anda adalah ANALIS, bukan hanya data display tool. Berikan VALUE melalui insight, bukan hanya informasi!`;

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
