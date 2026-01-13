import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Bot from '../models/Bot.js';
import Chat from '../models/Chat.js';
import Thread from '../models/Thread.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ============================================================================
// 📊 DASHBOARD STATISTICS (BARU)
// ============================================================================

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    // 1. Basic Counts (Total Data)
    const totalUsers = await User.countDocuments();
    const totalBots = await Bot.countDocuments();
    const totalChats = await Chat.countDocuments();
    const activeThreads = await Thread.countDocuments();

    // 2. Activity Last 7 Days (Grafik Garis)
    // Mengambil data 7 hari ke belakang
    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const dailyActivity = await Chat.aggregate([
      { $match: { createdAt: { $gte: last7Days } } },
      { 
        $group: { 
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, 
          count: { $sum: 1 } 
        } 
      },
      { $sort: { _id: 1 } }
    ]);

    // 3. Bot Popularity (Pie Chart)
    // Menghitung bot mana yang paling sering menjawab (role: assistant)
    const botUsage = await Chat.aggregate([
        { $match: { role: 'assistant', botId: { $exists: true, $ne: null } } },
        { $group: { _id: "$botId", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 } // Ambil Top 5
    ]);

    // Populate Nama Bot (karena aggregate hanya mengembalikan ID)
    const botStats = await Bot.populate(botUsage, { path: "_id", select: "name" });
    const formattedBotStats = botStats.map(b => ({
        name: b._id ? b._id.name : 'Unknown Bot',
        count: b.count
    }));

    res.json({
        counts: { totalUsers, totalBots, totalChats, activeThreads },
        dailyActivity,
        botUsage: formattedBotStats
    });

  } catch (error) {
    console.error("Stats Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 👥 USER MANAGEMENT (EXISTING)
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
// 🤖 BOT MANAGEMENT (EXISTING)
// ============================================================================

router.get('/bots', requireAdmin, async (req, res) => {
  try {
    const bots = await Bot.find();
    res.json({ bots });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/bots', requireAdmin, async (req, res) => {
  try {
    const newBot = new Bot(req.body);
    await newBot.save();
    res.status(201).json({ bot: newBot });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/bots/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, systemPrompt, starterQuestions, smartsheetConfig, kouventaConfig, onedriveConfig } = req.body;
    const bot = await Bot.findByIdAndUpdate(
      req.params.id,
      { name, description, systemPrompt, starterQuestions, smartsheetConfig, kouventaConfig, onedriveConfig },
      { new: true }
    );
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    res.json({ bot });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/bots/:id', requireAdmin, async (req, res) => {
  try {
    await Bot.findByIdAndDelete(req.params.id);
    res.json({ message: 'Bot deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// 👁️ CHAT MONITORING & EXPORT (EXISTING)
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
        let fileName = `chat-logs-all-${new Date().toISOString().slice(0,10)}.csv`;

        if (month && year) {
            const m = parseInt(month); // 1-12
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