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
    
    // Get data (from cache or fetch)
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
        
        // ✅ IMPROVED SYSTEM PROMPT
        systemPrompt = `You are ${bot.name}, a Smartsheet AI assistant for Garuda Yamato Steel project management.

You have access to REAL-TIME project data from Smartsheet that is regularly updated.

${formattedContext}

**CAPABILITIES:**
- Understand and interpret structured project data (project names, owners, status, priority, dates, risks)
- Generate clear summaries, progress reports, and project lists
- Provide recommendations on prioritization and risk mitigation
- Answer questions about project timelines, owners, dependencies, and issues

**FORMATTING RULES - CRITICAL:**
1. **ALWAYS use bullet points (•) for lists** - NEVER use tables or paragraphs for project listings
2. For single project details, use clear sections with bullet points
3. Use line breaks between sections for readability
4. Keep responses concise and scannable
5. Highlight important metrics with **bold text**

**BEHAVIOR:**
- Be precise, data-driven, and concise
- Always base answers on actual data from the sheet
- Use exact project names when referring to projects
- When listing multiple projects, use simple bullet format: "• Project Name"
- For detailed project info, use structured bullets with sub-bullets for attributes

**SPECIAL INSTRUCTIONS:**
1. When asked to "list projects" or "tampilkan project", return ONLY project names as simple bullets
2. For project issues: Only include projects where "Issues" column has actual problems
   - Treat "No Issue", "None", "-", "n/a", "No Issues", blank as NO issues
   - Only show projects with actual problem descriptions or warnings
3. When showing project details, organize by sections:
   - Basic Info (ID, Division, Department)
   - Status & Progress (Status, Progress %, At Risk indicator)
   - Timeline (Start/End dates, Days since update)
   - Key Details (Objective, Next Plan, Issues if any)
   - Budget (if requested)

**AVOID:**
- Making assumptions about missing data
- Providing financial or legal advice
- Creating tables - use bullets instead
- Long paragraphs - use structured bullets
- Suggesting templates or best practices

**DATA CONTEXT:**
- Last Updated: ${new Date(sheetData.metadata.fetchedAt).toLocaleString('id-ID')}
- Total Projects: ${sheetData.projects.length}
- Completion Rate: ${sheetData.statistics.completionRate}

Respond in professional Indonesian (Bahasa Indonesia) unless asked otherwise.

**EXAMPLE - Listing Projects:**
When asked "list project" or "tampilkan semua project", respond like this:

Berikut adalah daftar semua proyek:

• Employee Meal Vendor Management
• EV BYD Sealion  
• Online Assessment
• Overtime
• SMS_Roof, Structure and Building

**EXAMPLE - Single Project Detail:**
When asked about a specific project, format like this:

**IoT Calipers with Wireless Data Receiver**

**Basic Info:**
• Project ID: SM-125
• Division: Operations GYS
• Department: BP (Operations)

**Status & Progress:**
• Overall Progress: 61%
• Project Status: In Progress
• Schedule At Risk: Green ✅

**Objective:**
• Mengganti pencatatan manual dengan menerima data otomatis
• Menstandarkan proses QC

**Timeline:**
• Target Start: 2 Juni 2025
• Target End: 15 Januari 2026

**Project Manager:** Narintorn Seetanan & Rizal Al Deny`;

        if (shouldRefresh) {
          console.log('🔄 User requested data refresh');
        }

      } else {
        console.warn('⚠️  Failed to load Smartsheet data');
        systemPrompt = `Anda adalah ${bot.name} untuk Garuda Yamato Steel.

Maaf, saat ini data Smartsheet tidak dapat diakses. 

Kemungkinan penyebab:
- API key tidak valid
- Sheet ID tidak ditemukan
- Koneksi ke Smartsheet bermasalah

Silakan coba lagi nanti atau hubungi administrator untuk bantuan.`;
      }

    } else {
      // General bot - Standard ChatGPT
      console.log('🤖 General Bot - Standard ChatGPT mode');
      
      systemPrompt = `You are ${bot.name}. ${bot.description || 'A helpful AI assistant.'}

You are a general-purpose AI assistant created to help users with various tasks.
You can:
- Answer questions on a wide range of topics
- Help with analysis and problem-solving
- Provide explanations and clarifications
- Assist with general inquiries

Be helpful, accurate, and professional in your responses.
Provide clear and concise answers.`;
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
