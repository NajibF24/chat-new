// server/routes/embed.js
// Public-facing route for iframe embed — serves bot info without leaking API keys

import express from 'express';
import Bot     from '../models/Bot.js';
import Chat    from '../models/Chat.js';
import Thread  from '../models/Thread.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/embed/bot/:botId
 * Returns sanitized bot info for the embed page.
 * Requires session auth (user must be logged in).
 */
router.get('/bot/:botId', requireAuth, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.botId).lean();
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    // Strip sensitive fields
    const safe = {
      _id:              bot._id,
      name:             bot.name,
      description:      bot.description || '',
      avatar:           bot.avatar || {},
      starterQuestions: bot.starterQuestions || [],
      tone:             bot.tone || 'professional',
    };

    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/embed/bots
 * Returns list of all bots for embed selector (admin or assigned bots).
 */
router.get('/bots', requireAuth, async (req, res) => {
  try {
    const bots = await Bot.find({}, 'name description avatar starterQuestions').lean();
    res.json(bots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
