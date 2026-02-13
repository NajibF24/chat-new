import express from 'express';
import multer from 'multer';
import path from 'path';
import AICoreService from '../services/ai-core.service.js'; // ✅ Import Default (Fixing SyntaxError)
import { generateImage } from '../services/image.service.js'; // ✅ Untuk fitur gambar
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';
import Bot from '../models/Bot.js';
import Chat from '../models/Chat.js';
import Thread from '../models/Thread.js';

const router = express.Router();

// Config Upload (Tetap sama)
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

// 1. Upload File
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

// 2. Get Bots (Sesuaikan dengan session/auth Anda)
router.get('/bots', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await User.findById(userId).populate('assignedBots');
    if (user.isAdmin && (!user.assignedBots || user.assignedBots.length === 0)) {
      const allBots = await Bot.find({});
      return res.json(allBots);
    }
    res.json(user.assignedBots);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. Get Threads
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

// 6. Send Message (Intersepsi Logika Gambar + Delegate ke AICoreService)
router.post('/message', requireAuth, async (req, res) => {
  try {
    const { message, botId, history, threadId } = req.body;
    const userId = req.session.userId;
    let attachedFile = req.body.attachedFile || null;

    // ---------------------------------------------------------
    // LOGIKA KHUSUS: GENERATE IMAGE (/image)
    // ---------------------------------------------------------
    const cleanMsg = message ? message.trim().toLowerCase() : '';
    if (cleanMsg.startsWith('/image') || cleanMsg.startsWith('/img') || cleanMsg.startsWith('gambarkan')) {
        try {
            let prompt = message.replace(/^\/image|^\/img|^gambarkan/i, '').trim();
            if (!prompt) prompt = "High quality industrial steel art";

            // 1. Dapatkan URL Gambar dari DALL-E
            const imageUrl = await generateImage(prompt);
            const markdownResponse = `![${prompt}](${imageUrl})\n\n*Generated for: "${prompt}"*`;

            // 2. Cari atau Buat Thread (Agar history tersimpan rapi)
            let targetThreadId = threadId;
            if (!targetThreadId) {
                const newThread = new Thread({
                    userId, botId,
                    title: prompt.substring(0, 30),
                    lastMessageAt: new Date()
                });
                await newThread.save();
                targetThreadId = newThread._id;
            }

            // 3. Simpan Pesan User & Respon Bot ke Database
            await new Chat({ userId, botId, threadId: targetThreadId, role: 'user', content: message }).save();
            const botMsg = new Chat({ userId, botId, threadId: targetThreadId, role: 'assistant', content: markdownResponse });
            await botMsg.save();

            return res.json({
                response: markdownResponse,
                threadId: targetThreadId
            });

        } catch (imgError) {
            console.error("Image Service Error:", imgError);
            return res.status(500).json({ error: "Gagal membuat gambar: " + imgError.message });
        }
    }

    // ---------------------------------------------------------
    // LOGIKA UMUM: Delegate ke AICoreService (Text / RAG)
    // ---------------------------------------------------------
    const result = await AICoreService.processMessage({
        userId,
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

export default router;
