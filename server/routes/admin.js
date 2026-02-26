import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Bot from '../models/Bot.js';
import Chat from '../models/Chat.js';
import Thread from '../models/Thread.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ============================================================================
// 📊 DASHBOARD STATISTICS (UPDATED FOR GYS THEME)
// ============================================================================

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    // 1. Basic Counts
    const totalUsers = await User.countDocuments();
    const totalBots = await Bot.countDocuments();
    const totalChats = await Chat.countDocuments();
    const totalThreads = await Thread.countDocuments();

    // 2. Activity Last 7 Days (Trend Grafik)
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

    // 3. Bot Popularity (Pie/Doughnut Chart)
// 3. Bot Popularity (Pie/Doughnut Chart)
    const botPopularity = await Chat.aggregate([
        { 
          $match: { 
            role: 'assistant', 
            botId: { $exists: true, $ne: null } 
          } 
        },
        {
          $lookup: {
            from: 'bots', // Nama collection bot di MongoDB
            localField: 'botId',
            foreignField: '_id',
            as: 'botDetails'
          }
        },
        { 
          $unwind: {
            path: '$botDetails',
            preserveNullAndEmptyArrays: false // Filter otomatis bot yang sudah dihapus
          }
        },
        { 
          $group: { 
            _id: "$botId", 
            name: { $first: "$botDetails.name" }, 
            count: { $sum: 1 } 
          } 
        },
        { $sort: { count: -1 } },
        { $limit: 5 },
        {
          $project: {
            _id: 0,
            name: 1,
            count: 1
          }
        }
    ]);

    // 4. Top Active Users (Data untuk tabel baru di GYS Dashboard)
    const topUsers = await Chat.aggregate([
      { $match: { role: 'user' } }, // Hanya hitung pesan dari manusia
      {
        $group: {
          _id: "$userId",
          msgCount: { $sum: 1 }
        }
      },
      { $sort: { msgCount: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      {
        $project: {
          username: { $arrayElemAt: ["$userInfo.username", 0] },
          email: { $arrayElemAt: ["$userInfo.email", 0] },
          count: "$msgCount"
        }
      }
    ]);

    // Response disesuaikan dengan kebutuhan AdminDashboard.jsx GYS
    res.json({
        totalUsers,
        totalBots,
        totalChats,
        totalThreads, // Digunakan oleh stats.totalThreads
        activityTrend, // Digunakan oleh Weekly Activity Chart
        botPopularity, // Digunakan oleh Bot Usage Chart
        topUsers       // Digunakan oleh Top Contributors Table
    });

  } catch (error) {
    console.error("Stats Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 👥 USER MANAGEMENT (EXISTING - KEPT AS IS)
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
// 🤖 BOT MANAGEMENT (EXISTING - KEPT AS IS)
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
    // Ambil data dari Body
    const { 
        name, description, systemPrompt, prompt, 
        starterQuestions, smartsheetConfig, kouventaConfig 
    } = req.body;
    
    // ✅ PASTIKAN STRUKTUR DATA TERSIMPAN BENAR
    const newBot = new Bot({
      name,
      description,
      systemPrompt: systemPrompt || "Anda adalah asisten AI.",
      prompt: prompt || "",
      starterQuestions: starterQuestions || [],
      
      // Simpan Config Smartsheet
      smartsheetConfig: {
        enabled: smartsheetConfig?.enabled || false,
        sheetId: smartsheetConfig?.sheetId || '', // ✅ PENTING: Simpan Sheet ID
        apiKey: smartsheetConfig?.apiKey || '',
      },

      // Simpan Config Kouventa
      kouventaConfig: {
        enabled: kouventaConfig?.enabled || false,
        apiKey: kouventaConfig?.apiKey || '',
        endpoint: kouventaConfig?.endpoint || ''
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
        starterQuestions, smartsheetConfig, kouventaConfig 
    } = req.body;

    const updateData = {
        name, 
        description, 
        systemPrompt,
        prompt,
        starterQuestions,
        
        // ✅ UPDATE FIELD SMARTSHEET
        smartsheetConfig: {
            enabled: smartsheetConfig?.enabled || false,
            sheetId: smartsheetConfig?.sheetId || '', // ✅ Update Sheet ID
            apiKey: smartsheetConfig?.apiKey || '',
        },
        
        kouventaConfig: {
            enabled: kouventaConfig?.enabled || false,
            apiKey: kouventaConfig?.apiKey || '',
            endpoint: kouventaConfig?.endpoint || ''
        }
    };

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
    await Bot.findByIdAndDelete(req.params.id);
    res.json({ message: 'Bot deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 👁️ CHAT MONITORING & EXPORT (EXISTING - KEPT AS IS)
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
