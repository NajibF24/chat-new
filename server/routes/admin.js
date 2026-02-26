import express from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import User from '../models/User.js';
import Bot from '../models/Bot.js';
import Chat from '../models/Chat.js';
import Thread from '../models/Thread.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ============================================================================
// 🖼️ MULTER — Avatar Upload Config
// ============================================================================

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/avatars';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `bot-avatar-${req.params.id}-${Date.now()}${ext}`);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // max 2MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg\+xml|svg/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = /image\//.test(file.mimetype);
    if (extOk && mimeOk) cb(null, true);
    else cb(new Error('Hanya file gambar yang diizinkan (jpg, png, gif, webp, svg)'));
  }
});

// ============================================================================
// 📊 DASHBOARD STATISTICS
// ============================================================================

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalBots = await Bot.countDocuments();
    const totalChats = await Chat.countDocuments();
    const totalThreads = await Thread.countDocuments();

    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const activityTrend = await Chat.aggregate([
      { $match: { createdAt: { $gte: last7Days } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const botPopularity = await Chat.aggregate([
      { $match: { role: 'assistant', botId: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'bots',
          localField: 'botId',
          foreignField: '_id',
          as: 'botDetails'
        }
      },
      { $unwind: { path: '$botDetails', preserveNullAndEmptyArrays: false } },
      { $group: { _id: "$botId", name: { $first: "$botDetails.name" }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $project: { _id: 0, name: 1, count: 1 } }
    ]);

    const topUsers = await Chat.aggregate([
      { $match: { role: 'user' } },
      { $group: { _id: "$userId", msgCount: { $sum: 1 } } },
      { $sort: { msgCount: -1 } },
      { $limit: 5 },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "userInfo" } },
      {
        $project: {
          username: { $arrayElemAt: ["$userInfo.username", 0] },
          email: { $arrayElemAt: ["$userInfo.email", 0] },
          count: "$msgCount"
        }
      }
    ]);

    res.json({ totalUsers, totalBots, totalChats, totalThreads, activityTrend, botPopularity, topUsers });
  } catch (error) {
    console.error("Stats Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 👥 USER MANAGEMENT
// ============================================================================

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().populate('assignedBots').select('-password');
    res.json({ users });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin, assignedBots } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword, isAdmin: isAdmin || false, assignedBots: assignedBots || [] });
    await user.save();
    await user.populate('assignedBots');
    res.status(201).json({ user });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin, assignedBots } = req.body;
    const updateData = { username, isAdmin, assignedBots };
    if (password && password.trim() !== '') updateData.password = await bcrypt.hash(password, 10);

    const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).populate('assignedBots').select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await Chat.deleteMany({ userId: req.params.id });
    await Thread.deleteMany({ userId: req.params.id });
    res.json({ message: 'User deleted successfully' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// 🤖 BOT MANAGEMENT
// ============================================================================

// 1. Get All Bots
router.get('/bots', async (req, res) => {
  try {
    const bots = await Bot.find({});
    res.json(bots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Create Bot
router.post('/bots', async (req, res) => {
  try {
    const {
      name, description, systemPrompt, prompt,
      starterQuestions, smartsheetConfig, kouventaConfig,
      avatar
    } = req.body;

    const newBot = new Bot({
      name,
      description,
      systemPrompt: systemPrompt || "Anda adalah asisten AI.",
      prompt: prompt || "",
      starterQuestions: starterQuestions || [],
      smartsheetConfig: {
        enabled: smartsheetConfig?.enabled || false,
        sheetId: smartsheetConfig?.sheetId || '',
        apiKey: smartsheetConfig?.apiKey || '',
      },
      kouventaConfig: {
        enabled: kouventaConfig?.enabled || false,
        apiKey: kouventaConfig?.apiKey || '',
        endpoint: kouventaConfig?.endpoint || ''
      },
      // Avatar default saat create
      avatar: {
        type: avatar?.type || 'emoji',
        emoji: avatar?.emoji || '🤖',
        icon: avatar?.icon || null,
        bgColor: avatar?.bgColor || '#6366f1',
        textColor: avatar?.textColor || '#ffffff',
        imageUrl: avatar?.imageUrl || null,
      }
    });

    await newBot.save();
    res.json(newBot);
  } catch (error) {
    console.error("Create Bot Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Update Bot
router.put('/bots/:id', async (req, res) => {
  try {
    const {
      name, description, systemPrompt, prompt,
      starterQuestions, smartsheetConfig, kouventaConfig,
      avatar
    } = req.body;

    const updateData = {
      name,
      description,
      systemPrompt,
      prompt,
      starterQuestions,
      smartsheetConfig: {
        enabled: smartsheetConfig?.enabled || false,
        sheetId: smartsheetConfig?.sheetId || '',
        apiKey: smartsheetConfig?.apiKey || '',
      },
      kouventaConfig: {
        enabled: kouventaConfig?.enabled || false,
        apiKey: kouventaConfig?.apiKey || '',
        endpoint: kouventaConfig?.endpoint || ''
      },
    };

    // Hanya update avatar non-image jika dikirim (image diupdate via route khusus)
    if (avatar && avatar.type !== 'image') {
      updateData.avatar = {
        type: avatar.type,
        emoji: avatar.emoji,
        icon: avatar.icon || null,
        bgColor: avatar.bgColor || '#6366f1',
        textColor: avatar.textColor || '#ffffff',
      };
    }

    const updatedBot = await Bot.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json(updatedBot);
  } catch (error) {
    console.error("Update Bot Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Delete Bot
router.delete('/bots/:id', async (req, res) => {
  try {
    // Hapus avatar image jika ada
    const bot = await Bot.findById(req.params.id);
    if (bot?.avatar?.type === 'image' && bot?.avatar?.imageUrl) {
      const imgPath = `uploads/avatars/${path.basename(bot.avatar.imageUrl)}`;
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    await Bot.findByIdAndDelete(req.params.id);
    res.json({ message: 'Bot deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 🖼️ BOT AVATAR — Upload & Update
// ============================================================================

// POST /api/admin/bots/:id/avatar — Upload gambar avatar
router.post('/bots/:id/avatar', avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang di-upload' });

    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    // Hapus avatar lama jika ada
    if (bot.avatar?.type === 'image' && bot.avatar?.imageUrl) {
      const oldPath = `uploads/avatars/${path.basename(bot.avatar.imageUrl)}`;
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    bot.avatar = {
      ...bot.avatar,
      type: 'image',
      imageUrl: `/api/avatars/${req.file.filename}`,
    };
    await bot.save();

    res.json({ message: 'Avatar berhasil di-upload', bot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/bots/:id/avatar — Update emoji atau icon
router.patch('/bots/:id/avatar', async (req, res) => {
  try {
    const { type, emoji, icon, bgColor, textColor } = req.body;

    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    bot.avatar = {
      ...bot.avatar?.toObject?.() || bot.avatar || {},
      type: type || 'emoji',
      emoji: emoji ?? bot.avatar?.emoji ?? '🤖',
      icon: icon ?? bot.avatar?.icon ?? null,
      bgColor: bgColor ?? bot.avatar?.bgColor ?? '#6366f1',
      textColor: textColor ?? bot.avatar?.textColor ?? '#ffffff',
    };
    await bot.save();

    res.json({ message: 'Avatar updated', bot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 👁️ CHAT MONITORING & EXPORT
// ============================================================================

router.get('/chat-logs', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const total = await Chat.countDocuments({});
    const chats = await Chat.find({}).populate('userId', 'username').populate('botId', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit);
    res.json({ chats, totalPages: Math.ceil(total / limit), currentPage: page, totalLogs: total });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/export-chats', requireAdmin, async (req, res) => {
  try {
    const { month, year } = req.query;
    let query = {};
    let fileName = `chat-logs-all-${new Date().toISOString().slice(0, 10)}.csv`;

    if (month && year) {
      const m = parseInt(month);
      const y = parseInt(year);
      const startDate = new Date(y, m - 1, 1);
      const endDate = new Date(y, m, 0, 23, 59, 59, 999);
      query.createdAt = { $gte: startDate, $lte: endDate };
      fileName = `chat-logs-${y}-${m.toString().padStart(2, '0')}.csv`;
    }

    const chats = await Chat.find(query)
      .populate('userId', 'username')
      .populate('botId', 'name')
      .sort({ createdAt: -1 });

    let csv = 'Timestamp,User,Bot,Role,Message\n';
    chats.forEach(chat => {
      const cleanContent = (chat.content || '').replace(/"/g, '""').replace(/(\r\n|\n|\r)/g, ' ');
      const row = [
        `"${new Date(chat.createdAt).toLocaleString()}"`,
        `"${chat.userId?.username || 'Unknown'}"`,
        `"${chat.botId?.name || 'Unknown'}"`,
        `"${chat.role}"`,
        `"${cleanContent}"`
      ].join(',');
      csv += row + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.send(csv);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).send('Error exporting data');
  }
});

export default router;