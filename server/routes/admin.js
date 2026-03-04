// server/routes/admin.js — Enhanced with AI Provider + Knowledge Base management

import express    from 'express';
import bcrypt     from 'bcryptjs';
import multer     from 'multer';
import path       from 'path';
import fs         from 'fs';
import User       from '../models/User.js';
import Bot        from '../models/Bot.js';
import Chat       from '../models/Chat.js';
import Thread     from '../models/Thread.js';
import { requireAdmin } from '../middleware/auth.js';
import AIProviderService, { AI_PROVIDERS } from '../services/ai-provider.service.js';
import KnowledgeBaseService from '../services/knowledge-base.service.js';

const router = express.Router();

// ── Multer: Avatar ────────────────────────────────────────────
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/avatars';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `bot-avatar-${req.params.id}-${Date.now()}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (/image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Hanya file gambar yang diizinkan'));
  },
});

// ── Multer: Knowledge Files ───────────────────────────────────
const knowledgeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = `uploads/knowledge/${req.params.id}`;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext    = path.extname(file.originalname);
    const base   = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});
const knowledgeUpload = multer({
  storage: knowledgeStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
  fileFilter: (_, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/plain',
      'text/csv',
      'text/markdown',
    ];
    const allowedExt = ['.pdf','.docx','.doc','.xlsx','.xls','.txt','.csv','.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) cb(null, true);
    else cb(new Error(`Format file tidak didukung: ${file.originalname}. Gunakan PDF, DOCX, XLSX, TXT, CSV.`));
  },
});

// ============================================================
// 📊 STATS
// ============================================================
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [totalUsers, totalBots, totalChats, totalThreads] = await Promise.all([
      User.countDocuments(),
      Bot.countDocuments(),
      Chat.countDocuments(),
      Thread.countDocuments(),
    ]);

    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const [activityTrend, botPopularity, topUsers] = await Promise.all([
      Chat.aggregate([
        { $match: { createdAt: { $gte: last7Days } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Chat.aggregate([
        { $match: { role: 'assistant', botId: { $exists: true, $ne: null } } },
        { $lookup: { from: 'bots', localField: 'botId', foreignField: '_id', as: 'botDetails' } },
        { $unwind: { path: '$botDetails', preserveNullAndEmptyArrays: false } },
        { $group: { _id: '$botId', name: { $first: '$botDetails.name' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        { $project: { _id: 0, name: 1, count: 1 } },
      ]),
      Chat.aggregate([
        { $match: { role: 'user' } },
        { $group: { _id: '$userId', msgCount: { $sum: 1 } } },
        { $sort: { msgCount: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'userInfo' } },
        { $project: { username: { $arrayElemAt: ['$userInfo.username', 0] }, email: { $arrayElemAt: ['$userInfo.email', 0] }, count: '$msgCount' } },
      ]),
    ]);

    res.json({ totalUsers, totalBots, totalChats, totalThreads, activityTrend, botPopularity, topUsers });
  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 📋 AI PROVIDERS CATALOG (for frontend dropdown)
// ============================================================
router.get('/ai-providers', requireAdmin, (req, res) => {
  res.json(AI_PROVIDERS);
});

// ============================================================
// 🧪 TEST AI PROVIDER CONNECTION
// ============================================================
router.post('/bots/:id/test-ai', requireAdmin, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    const result = await AIProviderService.testConnection(bot.aiProvider || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// Also allow testing with inline config (before saving bot)
router.post('/test-ai-config', requireAdmin, async (req, res) => {
  try {
    const { provider, model, apiKey, endpoint } = req.body;
    const result = await AIProviderService.testConnection({ provider, model, apiKey, endpoint });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ============================================================
// 👥 USER MANAGEMENT
// ============================================================
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().populate('assignedBots').select('-password');
    res.json({ users });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin, assignedBots } = req.body;
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
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
    if (password?.trim()) updateData.password = await bcrypt.hash(password, 10);
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
    res.json({ message: 'User deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// 🤖 BOT MANAGEMENT
// ============================================================

// GET all bots (strip sensitive api keys before sending)
router.get('/bots', async (req, res) => {
  try {
    const bots = await Bot.find({}).lean();
    // Mask API keys for security
    const sanitized = bots.map(b => ({
      ...b,
      aiProvider: b.aiProvider
        ? { ...b.aiProvider, apiKey: b.aiProvider.apiKey ? '***' : '' }
        : {},
      smartsheetConfig: b.smartsheetConfig
        ? { ...b.smartsheetConfig, apiKey: b.smartsheetConfig.apiKey ? '***' : '' }
        : {},
      // Return knowledge file metadata but not full content (for perf)
      knowledgeFiles: (b.knowledgeFiles || []).map(f => ({
        _id: f._id, filename: f.filename, originalName: f.originalName,
        mimetype: f.mimetype, size: f.size, uploadedAt: f.uploadedAt,
        summary: f.summary,
      })),
    }));
    res.json(sanitized);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// CREATE bot
router.post('/bots', requireAdmin, async (req, res) => {
  try {
    const {
      name, description, systemPrompt, prompt,
      starterQuestions, smartsheetConfig, kouventaConfig, onedriveConfig,
      avatar, aiProvider, knowledgeMode,
    } = req.body;

    const newBot = new Bot({
      name, description,
      systemPrompt: systemPrompt || 'Anda adalah asisten AI profesional.',
      prompt: prompt || '',
      starterQuestions: starterQuestions || [],
      knowledgeMode: knowledgeMode || 'relevant',
      aiProvider: {
        provider:    aiProvider?.provider    || 'openai',
        model:       aiProvider?.model       || 'gpt-4o',
        apiKey:      aiProvider?.apiKey      || '',
        endpoint:    aiProvider?.endpoint    || '',
        temperature: aiProvider?.temperature ?? 0.1,
        maxTokens:   aiProvider?.maxTokens   ?? 2000,
      },
      smartsheetConfig: {
        enabled: smartsheetConfig?.enabled || false,
        sheetId: smartsheetConfig?.sheetId || '',
        apiKey:  smartsheetConfig?.apiKey  || '',
      },
      kouventaConfig: {
        enabled:  kouventaConfig?.enabled  || false,
        apiKey:   kouventaConfig?.apiKey   || '',
        endpoint: kouventaConfig?.endpoint || '',
      },
      onedriveConfig: {
        enabled:      onedriveConfig?.enabled      || false,
        folderUrl:    onedriveConfig?.folderUrl    || '',
        tenantId:     onedriveConfig?.tenantId     || '',
        clientId:     onedriveConfig?.clientId     || '',
        clientSecret: onedriveConfig?.clientSecret || '',
      },
      avatar: {
        type:      avatar?.type      || 'emoji',
        emoji:     avatar?.emoji     || '🤖',
        icon:      avatar?.icon      || null,
        bgColor:   avatar?.bgColor   || '#6366f1',
        textColor: avatar?.textColor || '#ffffff',
        imageUrl:  avatar?.imageUrl  || null,
      },
    });

    await newBot.save();
    res.json(newBot);
  } catch (error) {
    console.error('Create Bot Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// UPDATE bot
router.put('/bots/:id', requireAdmin, async (req, res) => {
  try {
    const {
      name, description, systemPrompt, prompt,
      starterQuestions, smartsheetConfig, kouventaConfig, onedriveConfig,
      avatar, aiProvider, knowledgeMode,
    } = req.body;

    const existing = await Bot.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Bot not found' });

    const updateData = {
      name, description, systemPrompt, prompt,
      starterQuestions: starterQuestions || [],
      knowledgeMode: knowledgeMode || 'relevant',
      smartsheetConfig: {
        enabled: smartsheetConfig?.enabled || false,
        sheetId: smartsheetConfig?.sheetId || '',
        apiKey:  smartsheetConfig?.apiKey === '***' ? existing.smartsheetConfig?.apiKey : (smartsheetConfig?.apiKey || ''),
      },
      kouventaConfig: {
        enabled:  kouventaConfig?.enabled  || false,
        apiKey:   kouventaConfig?.apiKey   === '***' ? existing.kouventaConfig?.apiKey : (kouventaConfig?.apiKey || ''),
        endpoint: kouventaConfig?.endpoint || '',
      },
      onedriveConfig: {
        enabled:      onedriveConfig?.enabled      || false,
        folderUrl:    onedriveConfig?.folderUrl    || '',
        tenantId:     onedriveConfig?.tenantId     || '',
        clientId:     onedriveConfig?.clientId     || '',
        clientSecret: onedriveConfig?.clientSecret === '***' ? existing.onedriveConfig?.clientSecret : (onedriveConfig?.clientSecret || ''),
      },
      updatedAt: new Date(),
    };

    // AI Provider — preserve existing apiKey if masked
    if (aiProvider) {
      updateData.aiProvider = {
        provider:    aiProvider.provider    || 'openai',
        model:       aiProvider.model       || 'gpt-4o',
        apiKey:      aiProvider.apiKey === '***' ? existing.aiProvider?.apiKey : (aiProvider.apiKey || ''),
        endpoint:    aiProvider.endpoint    || '',
        temperature: aiProvider.temperature ?? 0.1,
        maxTokens:   aiProvider.maxTokens   ?? 2000,
      };
    }

    // Avatar: only update if not image type (image handled by separate route)
    if (avatar && avatar.type !== 'image') {
      updateData.avatar = {
        type:      avatar.type,
        emoji:     avatar.emoji,
        icon:      avatar.icon      || null,
        bgColor:   avatar.bgColor   || '#6366f1',
        textColor: avatar.textColor || '#ffffff',
        imageUrl:  existing.avatar?.imageUrl || null,
      };
    }

    const updated = await Bot.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json(updated);
  } catch (error) {
    console.error('Update Bot Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE bot
router.delete('/bots/:id', requireAdmin, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (bot?.avatar?.type === 'image' && bot?.avatar?.imageUrl) {
      const imgPath = `uploads/avatars/${path.basename(bot.avatar.imageUrl)}`;
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    // Remove knowledge files folder
    const kDir = `uploads/knowledge/${req.params.id}`;
    if (fs.existsSync(kDir)) fs.rmSync(kDir, { recursive: true });

    await Bot.findByIdAndDelete(req.params.id);
    res.json({ message: 'Bot deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// 🖼️ BOT AVATAR
// ============================================================
router.post('/bots/:id/avatar', requireAdmin, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang di-upload' });
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (bot.avatar?.type === 'image' && bot.avatar?.imageUrl) {
      const oldPath = `uploads/avatars/${path.basename(bot.avatar.imageUrl)}`;
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    bot.avatar = { ...bot.avatar.toObject?.() || bot.avatar, type: 'image', imageUrl: `/api/avatars/${req.file.filename}` };
    await bot.save();
    res.json({ message: 'Avatar berhasil di-upload', bot });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/bots/:id/avatar', requireAdmin, async (req, res) => {
  try {
    const { type, emoji, icon, bgColor, textColor } = req.body;
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    bot.avatar = {
      ...bot.avatar?.toObject?.() || bot.avatar || {},
      type:      type      || 'emoji',
      emoji:     emoji     ?? bot.avatar?.emoji     ?? '🤖',
      icon:      icon      ?? bot.avatar?.icon      ?? null,
      bgColor:   bgColor   ?? bot.avatar?.bgColor   ?? '#6366f1',
      textColor: textColor ?? bot.avatar?.textColor ?? '#ffffff',
    };
    await bot.save();
    res.json({ message: 'Avatar updated', bot });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// 📚 KNOWLEDGE BASE — Upload / Delete / List
// ============================================================

// Upload one or more knowledge files to a bot
router.post('/bots/:id/knowledge', requireAdmin, knowledgeUpload.array('files', 10), async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Tidak ada file yang di-upload' });

    const results = [];

    for (const file of req.files) {
      console.log(`📚 Processing knowledge file: ${file.originalname}`);
      const { content, summary } = await KnowledgeBaseService.extractContent(
        file.path, file.originalname, file.mimetype
      );

      const kFile = {
        filename:     file.filename,
        originalName: file.originalname,
        mimetype:     file.mimetype,
        size:         file.size,
        path:         file.path,
        content,
        summary,
        uploadedAt:   new Date(),
      };

      bot.knowledgeFiles.push(kFile);
      results.push({ originalName: file.originalname, size: file.size, summary });
    }

    await bot.save();
    console.log(`✅ Knowledge files saved for bot "${bot.name}": ${results.length} files`);

    res.json({
      message: `${results.length} file berhasil diproses`,
      files: results,
      totalFiles: bot.knowledgeFiles.length,
    });
  } catch (error) {
    console.error('Knowledge upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a knowledge file
router.delete('/bots/:id/knowledge/:fileId', requireAdmin, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    const fileIndex = bot.knowledgeFiles.findIndex(f => f._id.toString() === req.params.fileId);
    if (fileIndex === -1) return res.status(404).json({ error: 'File not found' });

    const fileRecord = bot.knowledgeFiles[fileIndex];
    // Remove physical file
    if (fileRecord.path && fs.existsSync(fileRecord.path)) {
      fs.unlinkSync(fileRecord.path);
    }

    bot.knowledgeFiles.splice(fileIndex, 1);
    await bot.save();

    res.json({ message: 'File dihapus', totalFiles: bot.knowledgeFiles.length });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Re-process / refresh a knowledge file's extracted content
router.post('/bots/:id/knowledge/:fileId/reprocess', requireAdmin, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    const kFile = bot.knowledgeFiles.id(req.params.fileId);
    if (!kFile) return res.status(404).json({ error: 'File not found' });
    if (!fs.existsSync(kFile.path)) return res.status(400).json({ error: 'Physical file not found, please re-upload' });

    const { content, summary } = await KnowledgeBaseService.extractContent(kFile.path, kFile.originalName, kFile.mimetype);
    kFile.content = content;
    kFile.summary = summary;
    await bot.save();
    res.json({ message: 'File berhasil diproses ulang', summary });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// 👁️ CHAT LOGS & EXPORT
// ============================================================
router.get('/chat-logs', requireAdmin, async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;
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
      const m = parseInt(month); const y = parseInt(year);
      query.createdAt = { $gte: new Date(y, m - 1, 1), $lte: new Date(y, m, 0, 23, 59, 59, 999) };
      fileName = `chat-logs-${y}-${m.toString().padStart(2, '0')}.csv`;
    }
    const chats = await Chat.find(query).populate('userId', 'username').populate('botId', 'name').sort({ createdAt: -1 });
    let csv = 'Timestamp,User,Bot,Role,Message\n';
    chats.forEach(c => {
      const msg = (c.content || '').replace(/"/g, '""').replace(/(\r\n|\n|\r)/g, ' ');
      csv += [`"${new Date(c.createdAt).toLocaleString()}"`, `"${c.userId?.username || ''}"`, `"${c.botId?.name || ''}"`, `"${c.role}"`, `"${msg}"`].join(',') + '\n';
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.send(csv);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

export default router;