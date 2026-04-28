import express from 'express';
import AICoreService from '../services/ai-core.service.js';
import Bot from '../models/Bot.js';

const router = express.Router();

// POST /api/newsletter/generate
// Body: { prompt: "...", botId: "..." }
router.post('/generate', async (req, res) => {
  try {
    const { prompt, botId } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    let bot = null;
    if (botId) {
      bot = await Bot.findById(botId).lean();
    }
    
    // If no bot specified or found, fallback to a default configuration
    if (!bot) {
      bot = {
        name: "GYS AI",
        aiProvider: { provider: 'openai', model: 'gpt-4o' }
      };
    }

    const { result, responseMarkdown, newsletterData } = await AICoreService.generateNewsletterDataCore({ 
      bot, 
      message: prompt, 
      history: [] 
    });

    res.json({
      success: true,
      imageFile: result.fileName,
      imageUrl: result.fileUrl,
      newsletterData,
      markdown: responseMarkdown
    });

  } catch (error) {
    console.error('❌ [API] Newsletter Generate Error:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

export default router;
