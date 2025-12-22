import express from 'express';
import multer from 'multer';
import AICoreService from '../services/ai-core.service.js';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';
import Bot from '../models/Bot.js';
import Chat from '../models/Chat.js';
import Thread from '../models/Thread.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'data/files';
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '---' + file.originalname);
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 20 * 1024 * 1024 } });

// --- ENDPOINTS ---

// 1. Upload
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    filename: req.file.filename,
    originalname: req.file.originalname,
    path: req.file.path,
    mimetype: req.file.mimetype,
    url: `/api/files/${req.file.filename}`,
    size: req.file.size
  });
});

// 2. Get Bots
router.get('/bots', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).populate('assignedBots');
    if (user.isAdmin && (!user.assignedBots || user.assignedBots.length === 0)) {
      const allBots = await Bot.find({});
      return res.json(allBots);
    }
    res.json(user.assignedBots);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. ✅ GET THREADS (SIDEBAR HISTORY)
router.get('/threads', requireAuth, async (req, res) => {
    try {
        const threads = await Thread.find({ userId: req.session.userId })
            .populate('botId', 'name')
            .sort({ lastMessageAt: -1 });
        res.json(threads);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 4. Get Messages
router.get('/thread/:threadId', requireAuth, async (req, res) => {
    try {
        const chats = await Chat.find({ threadId: req.params.threadId }).sort({ createdAt: 1 });
        res.json(chats);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 5. Delete Thread
router.delete('/thread/:threadId', requireAuth, async (req, res) => {
    try {
        await Thread.findOneAndDelete({ _id: req.params.threadId, userId: req.session.userId });
        await Chat.deleteMany({ threadId: req.params.threadId });
        res.json({ message: 'Deleted' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 6. Send Message
router.post('/message', requireAuth, async (req, res) => {
  try {
    const { message, botId, history, threadId } = req.body;
    let attachedFile = req.body.attachedFile || null;

    const result = await AICoreService.processMessage({
        userId: req.session.userId,
        botId,
        message,
        attachedFile,
        threadId,
        history: (history || []).map(m => ({ role: m.role, content: m.content }))
    });

    res.json(result);
  } catch (error) {
    console.error('Chat Error:', error);
    res.status(500).json({ error: error.message });
  }
});

import path from 'path';
export default router;
