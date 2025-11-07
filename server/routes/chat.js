import express from 'express';
import OpenAI from 'openai';
import Chat from '../models/Chat.js';
import User from '../models/User.js';
import Bot from '../models/Bot.js';
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

// Send message
router.post('/message', requireAuth, async (req, res) => {
  try {
    const { botId, message } = req.body;

    // Verify user has access to this bot
    const user = await User.findById(req.session.userId);
    if (!user.assignedBots.includes(botId)) {
      return res.status(403).json({ error: 'Access denied to this bot' });
    }

    const bot = await Bot.findById(botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

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

    // Build conversation history for OpenAI
    const conversationHistory = chat.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Call OpenAI Responses API
    const response = await openai.responses.create({
      prompt: {
        id: bot.promptId,
        version: "1"
      },
      input: conversationHistory,
      text: {
        format: {
          type: "text"
        }
      },
      reasoning: {},
      tools: [
        {
          type: "file_search",
          vector_store_ids: [bot.vectorStoreId]
        }
      ],
      max_output_tokens: 2048,
      store: true,
      include: ["web_search_call.action.sources"]
    });

    const assistantMessage = response.text || response.content || 'No response';

    // Add assistant message
    chat.messages.push({
      role: 'assistant',
      content: assistantMessage
    });

    await chat.save();

    res.json({
      message: assistantMessage,
      chatId: chat._id
    });
  } catch (error) {
    console.error('Chat error:', error);
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

export default router;
