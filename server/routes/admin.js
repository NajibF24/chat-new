// server/routes/admin.js
// ✅ FIX: Bot Creator hanya lihat bot miliknya / assigned / bot lama (createdBy null)
// ✅ FIX: API Key tidak auto-generate, tidak tampil otomatis, ada endpoint reveal terpisah
// ✅ FIX: wahaConfig.targets dan wahaConfig.schedules sekarang tersimpan dengan benar
// ✅ FIX: extractedImages dari KnowledgeBaseService.extractContent() sekarang tersimpan ke DB

import express    from 'express';
import bcrypt     from 'bcryptjs';
import multer     from 'multer';
import path       from 'path';
import fs         from 'fs';
import User       from '../models/User.js';
import Bot        from '../models/Bot.js';
import Chat       from '../models/Chat.js';
import Thread     from '../models/Thread.js';
import AuditLog   from '../models/AuditLog.js';
import { requireAdmin, requireAdminOrBotCreator } from '../middleware/auth.js';
import AIProviderService, { AI_PROVIDERS } from '../services/ai-provider.service.js';
import KnowledgeBaseService from '../services/knowledge-base.service.js';
import AuditService from '../services/audit.service.js';
import OneDriveService from '../services/onedrive.service.js';
import crypto     from 'crypto';

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
  limits: { fileSize: 100 * 1024 * 1024 },
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
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});
const knowledgeUpload = multer({
  storage: knowledgeStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'application/mspowerpoint',
      'text/plain',
      'text/csv',
      'text/markdown',
    ];
    const allowedExt = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt', '.csv', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) cb(null, true);
    else cb(new Error(`Format tidak didukung: ${file.originalname}. Gunakan PDF, DOCX, XLSX, PPTX, TXT, CSV.`));
  },
});

// ── Helper: sanitize capabilities ────────────────────────────
const sanitizeCapabilities = (caps = {}) => ({
  webSearch:       Boolean(caps.webSearch),
  codeInterpreter: Boolean(caps.codeInterpreter),
  imageGeneration: Boolean(caps.imageGeneration),
  canvas:          Boolean(caps.canvas),
  fileSearch:      Boolean(caps.fileSearch),
});

// ── Helper: sanitize a single schedule item ───────────────────
function sanitizeScheduleItem(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    // HAPUS baris _id — biarkan Mongoose generate otomatis
    enabled:      Boolean(s.enabled),
    label:        String(s.label || ''),
    prompt:       String(s.prompt || ''),
    scheduleType: ['daily', 'interval', 'times'].includes(s.scheduleType) ? s.scheduleType : 'daily',
    time:         String(s.time || '08:00'),
    intervalMin:  Math.max(15, parseInt(s.intervalMin) || 60),
    times:        Array.isArray(s.times) ? s.times.filter(t => typeof t === 'string') : [],
  };
}

// ── Helper: sanitize a single target item ────────────────────
function sanitizeTarget(t) {
  if (!t || typeof t !== 'object') return null;
  return {
    // HAPUS baris _id — biarkan Mongoose generate otomatis
    label:     String(t.label || ''),
    chatId:    String(t.chatId || ''),
    enabled:   Boolean(t.enabled !== false),
    schedules: Array.isArray(t.schedules)
      ? t.schedules.map(sanitizeScheduleItem).filter(Boolean)
      : [],
  };
}

// ── Helper: sanitize full wahaConfig ─────────────────────────
function sanitizeWahaConfig(wahaConfig, existingWahaConfig) {
  if (!wahaConfig) return existingWahaConfig || {};

  return {
    enabled:         Boolean(wahaConfig.enabled),
    endpoint:        String(wahaConfig.endpoint || ''),
    chatId:          String(wahaConfig.chatId   || ''),
    session:         String(wahaConfig.session  || 'default'),
    // Preserve existing apiKey if incoming value is masked '***'
    apiKey: wahaConfig.apiKey === '***'
      ? (existingWahaConfig?.apiKey || '')
      : String(wahaConfig.apiKey || ''),
    incomingEnabled: Boolean(wahaConfig.incomingEnabled),

    // ✅ FIXED: properly save targets array
    targets: Array.isArray(wahaConfig.targets)
      ? wahaConfig.targets.map(sanitizeTarget).filter(t => t && t.chatId)
      : (existingWahaConfig?.targets || []),

    // ✅ FIXED: properly save global schedules array
    schedules: Array.isArray(wahaConfig.schedules)
      ? wahaConfig.schedules.map(sanitizeScheduleItem).filter(Boolean)
      : (existingWahaConfig?.schedules || []),

    // Legacy single daily schedule (backward compat)
    dailySchedule: {
      enabled: Boolean(wahaConfig.dailySchedule?.enabled),
      time:    String(wahaConfig.dailySchedule?.time    || '08:00'),
      prompt:  String(wahaConfig.dailySchedule?.prompt  || ''),
    },
  };
}

// ── Helper: build diff ────────────────────────────────────────
function buildDiff(before, after, keys) {
  const b = {}, a = {};
  keys.forEach(k => {
    const bv = String(before?.[k] ?? '');
    const av = String(after?.[k]  ?? '');
    if (bv !== av) { b[k] = before?.[k]; a[k] = after?.[k]; }
  });
  return Object.keys(b).length ? { before: b, after: a } : null;
}

// ── Helper: cek akses bot ─────────────────────────────────────
async function canAccessBot(user, botOrId) {
  if (user.isAdmin) return true;

  const botId = typeof botOrId === 'object' ? String(botOrId._id ?? botOrId) : String(botOrId);
  const bot   = typeof botOrId === 'object' ? botOrId : await Bot.findById(botId).select('createdBy').lean();

  if (bot && (bot.createdBy === null || bot.createdBy === undefined)) return true;
  if (bot && String(bot.createdBy) === String(user._id)) return true;

  const dbUser = await User.findById(user._id).select('assignedBots').lean();
  const assigned = (dbUser?.assignedBots || []).map(String);
  return assigned.includes(botId);
}

// ============================================================
// 📊 STATS
// ============================================================
router.get('/stats', requireAdminOrBotCreator, async (req, res) => {
  try {
    const [totalUsers, totalBots, totalChats, totalThreads] = await Promise.all([
      User.countDocuments(), Bot.countDocuments(), Chat.countDocuments(), Thread.countDocuments(),
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
        { $sort: { count: -1 } }, { $limit: 5 }, { $project: { _id: 0, name: 1, count: 1 } },
      ]),
      Chat.aggregate([
        { $match: { role: 'user' } },
        { $group: { _id: '$userId', msgCount: { $sum: 1 } } },
        { $sort: { msgCount: -1 } }, { $limit: 5 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'userInfo' } },
        { $project: { username: { $arrayElemAt: ['$userInfo.username', 0] }, count: '$msgCount' } },
      ]),
    ]);
    res.json({ totalUsers, totalBots, totalChats, totalThreads, activityTrend, botPopularity, topUsers });
  } catch (error) { console.error('Stats Error:', error); res.status(500).json({ error: error.message }); }
});

// ============================================================
// 📋 AI PROVIDERS CATALOG
// ============================================================
router.get('/ai-providers', requireAdminOrBotCreator, (req, res) => { res.json(AI_PROVIDERS); });

// ============================================================
// 🧪 TEST AI CONNECTION
// ============================================================
router.post('/bots/:id/test-ai', requireAdminOrBotCreator, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id).lean();
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!(await canAccessBot(req.user, bot)))
      return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses ke bot ini' });
    const result = await AIProviderService.testConnection(bot.aiProvider || {});
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.post('/test-ai-config', requireAdminOrBotCreator, async (req, res) => {
  try {
    const result = await AIProviderService.testConnection(req.body);
    res.json(result);
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ============================================================
// 🕵️ AUDIT TRAIL
// ============================================================
router.get('/audit-logs', requireAdmin, async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page)  || 1);
    const limit    = Math.min(100, parseInt(req.query.limit) || 30);
    const skip     = (page - 1) * limit;
    const { category, search, dateFrom, dateTo } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ username: re }, { action: re }, { targetName: re }];
    }
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ logs, total, totalPages: Math.ceil(total / limit), currentPage: page });
  } catch (err) {
    console.error('Audit log fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/audit-logs', requireAdmin, async (req, res) => {
  try {
    const { olderThanDays } = req.query;
    const filter = olderThanDays
      ? { createdAt: { $lt: new Date(Date.now() - parseInt(olderThanDays) * 86400000) } }
      : {};
    const result = await AuditLog.deleteMany(filter);
    await AuditService.log({
      req, category: 'system', action: 'AUDIT_PURGE',
      detail: { deleted: result.deletedCount, olderThanDays: olderThanDays || 'all' },
    });
    res.json({ deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    const { username, password, isAdmin, isBotCreator, assignedBots } = req.body;
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      username, password: hashedPassword,
      isAdmin: isAdmin || false,
      isBotCreator: isBotCreator || false,
      assignedBots: assignedBots || [],
    });
    await user.save();
    await user.populate('assignedBots');

    AuditService.log({
      req, category: 'user', action: 'USER_CREATE',
      targetId: user._id, targetName: username,
      detail: { isAdmin: user.isAdmin, assignedBotsCount: user.assignedBots.length },
    });

    res.status(201).json({ user });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin, isBotCreator, assignedBots } = req.body;
    const existing = await User.findById(req.params.id).select('-password');
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const updateData = { username, isAdmin, isBotCreator, assignedBots };
    const passwordChanged = Boolean(password?.trim());
    if (passwordChanged) updateData.password = await bcrypt.hash(password, 10);

    const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true })
      .populate('assignedBots').select('-password');

    AuditService.log({
      req, category: 'user', action: 'USER_UPDATE',
      targetId: user._id, targetName: user.username,
      detail: {
        before: { isAdmin: existing.isAdmin, assignedBotsCount: existing.assignedBots?.length ?? 0 },
        after:  { isAdmin: user.isAdmin,     assignedBotsCount: user.assignedBots?.length  ?? 0 },
        passwordChanged,
      },
    });

    res.json({ user });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('username');
    await User.findByIdAndDelete(req.params.id);
    await Chat.deleteMany({ userId: req.params.id });
    await Thread.deleteMany({ userId: req.params.id });

    AuditService.log({
      req, category: 'user', action: 'USER_DELETE',
      targetId: req.params.id, targetName: user?.username ?? req.params.id,
    });

    res.json({ message: 'User deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// 🤖 BOT MANAGEMENT
// ============================================================

// ── GET /bots — List bot sesuai role ─────────────────────────
router.get('/bots', requireAdminOrBotCreator, async (req, res) => {
  try {
    let query = {};

    if (!req.user.isAdmin) {
      const dbUser = await User.findById(req.user._id).select('assignedBots').lean();
      const assignedIds = dbUser?.assignedBots || [];
      query = {
        $or: [
          { createdBy: req.user._id },
          { _id: { $in: assignedIds } },
          { createdBy: null },
        ],
      };
    }

    const bots = await Bot.find(query).lean();

    const sanitized = bots.map(b => ({
      ...b,
      botApiKey: b.botApiKey ? '***' : '',
      aiProvider: b.aiProvider
        ? { ...b.aiProvider, apiKey: b.aiProvider.apiKey ? '***' : '' }
        : {},
      wahaConfig: b.wahaConfig
        ? { ...b.wahaConfig, apiKey: b.wahaConfig.apiKey ? '***' : '' }
        : {},
      smartsheetConfig: b.smartsheetConfig
        ? { ...b.smartsheetConfig, apiKey: b.smartsheetConfig.apiKey ? '***' : '' }
        : {},
      knowledgeFiles: (b.knowledgeFiles || []).map(f => ({
        _id: f._id, filename: f.filename, originalName: f.originalName,
        mimetype: f.mimetype, size: f.size, uploadedAt: f.uploadedAt, summary: f.summary,
      })),
    }));

    res.json(sanitized);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ── POST /bots — Buat bot baru ───────────────────────────────
router.post('/bots', requireAdminOrBotCreator, async (req, res) => {
  try {
    const {
      name, description, persona, tone,
      systemPrompt, prompt, starterQuestions,
      wahaConfig, smartsheetConfig, kouventaConfig, onedriveConfig, azureSearchConfig,
      avatar, aiProvider, knowledgeMode, capabilities,
    } = req.body;

    const newBot = new Bot({
      name, description, persona: persona || '',
      tone: tone || 'professional',
      systemPrompt: systemPrompt || 'Anda adalah asisten AI profesional.',
      prompt: prompt || '',
      starterQuestions: starterQuestions || [],
      knowledgeMode: knowledgeMode || 'relevant',
      createdBy: req.user._id,
      botApiKey: '',
      aiProvider: {
        provider:    aiProvider?.provider    || 'openai',
        model:       aiProvider?.model       || 'gpt-4.1',
        apiKey:      aiProvider?.apiKey      || '',
        endpoint:    aiProvider?.endpoint    || '',
        temperature: aiProvider?.temperature ?? 0.1,
        maxTokens:   aiProvider?.maxTokens   ?? 2000,
      },
      capabilities: sanitizeCapabilities(capabilities),

      // ✅ FIXED: wahaConfig sekarang menyimpan targets dan schedules
      wahaConfig: sanitizeWahaConfig(wahaConfig, {}),

      smartsheetConfig: { enabled: false, sheetId: '', apiKey: '', ...smartsheetConfig },
      kouventaConfig:   { enabled: false, apiKey: '', endpoint: '', ...kouventaConfig },
      azureSearchConfig: { enabled: false, apiKey: '', endpoint: '' },
      onedriveConfig:   { enabled: false, folderUrl: '', tenantId: '', clientId: '', clientSecret: '', ...onedriveConfig },
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

    AuditService.log({
      req, category: 'bot', action: 'BOT_CREATE',
      targetId: newBot._id, targetName: newBot.name,
      detail: {
        model:    newBot.aiProvider?.model,
        provider: newBot.aiProvider?.provider,
        capabilities: Object.entries(sanitizeCapabilities(capabilities))
          .filter(([, v]) => v).map(([k]) => k),
        createdBy: req.user._id,
        wahaTargets:   (newBot.wahaConfig?.targets   || []).length,
        wahaSchedules: (newBot.wahaConfig?.schedules || []).length,
      },
    });

    const result = newBot.toObject();
    result.botApiKey = '';
    res.json(result);
  } catch (error) {
    console.error('Create Bot Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── PUT /bots/:id — Update bot ───────────────────────────────
router.put('/bots/:id', requireAdminOrBotCreator, async (req, res) => {
  try {
    const existing = await Bot.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Bot not found' });
    if (!(await canAccessBot(req.user, existing.toObject())))
      return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses ke bot ini' });

    const {
      name, description, persona, tone,
      systemPrompt, prompt, starterQuestions,
      wahaConfig, smartsheetConfig, kouventaConfig, onedriveConfig, azureSearchConfig,
      avatar, aiProvider, knowledgeMode, capabilities,
    } = req.body;

    const updateData = {
      name, description, persona: persona || '',
      tone: tone || 'professional',
      systemPrompt, prompt,
      starterQuestions: starterQuestions || [],
      knowledgeMode: knowledgeMode || 'relevant',
      capabilities: sanitizeCapabilities(capabilities),

      // ✅ FIXED: wahaConfig sekarang menyimpan targets dan schedules dengan benar
      wahaConfig: sanitizeWahaConfig(wahaConfig, existing.wahaConfig?.toObject?.() || existing.wahaConfig || {}),

      smartsheetConfig: {
        enabled: smartsheetConfig?.enabled || false,
        sheetId: smartsheetConfig?.sheetId || '',
        apiKey: smartsheetConfig?.apiKey === '***'
          ? existing.smartsheetConfig?.apiKey
          : (smartsheetConfig?.apiKey || ''),
      },
      kouventaConfig: {
        enabled:  kouventaConfig?.enabled  || false,
        apiKey: kouventaConfig?.apiKey === '***'
          ? existing.kouventaConfig?.apiKey
          : (kouventaConfig?.apiKey || ''),
        endpoint: kouventaConfig?.endpoint || '',
      },
      azureSearchConfig: {
        enabled:  azureSearchConfig?.enabled  || false,
        endpoint: azureSearchConfig?.endpoint || '',
        apiKey: azureSearchConfig?.apiKey === '***'
          ? existing.azureSearchConfig?.apiKey
          : (azureSearchConfig?.apiKey || ''),
      },
      onedriveConfig: {
        enabled:      onedriveConfig?.enabled      || false,
        folderUrl:    onedriveConfig?.folderUrl    || '',
        tenantId:     onedriveConfig?.tenantId     || '',
        clientId:     onedriveConfig?.clientId     || '',
        clientSecret: onedriveConfig?.clientSecret === '***'
          ? existing.onedriveConfig?.clientSecret
          : (onedriveConfig?.clientSecret || ''),
      },
      updatedAt: new Date(),
    };

    if (aiProvider) {
      updateData.aiProvider = {
        provider:    aiProvider.provider    || 'openai',
        model:       aiProvider.model       || 'gpt-4.1',
        apiKey: aiProvider.apiKey === '***'
          ? existing.aiProvider?.apiKey
          : (aiProvider.apiKey || ''),
        endpoint:    aiProvider.endpoint    || '',
        temperature: aiProvider.temperature ?? 0.1,
        maxTokens:   aiProvider.maxTokens   ?? 2000,
      };
    }

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

    const diff = buildDiff(
      { name: existing.name, model: existing.aiProvider?.model, provider: existing.aiProvider?.provider, tone: existing.tone, knowledgeMode: existing.knowledgeMode },
      { name: updateData.name, model: updateData.aiProvider?.model, provider: updateData.aiProvider?.provider, tone: updateData.tone, knowledgeMode: updateData.knowledgeMode },
      ['name', 'model', 'provider', 'tone', 'knowledgeMode'],
    );

    // ✅ Log jumlah targets dan schedules untuk debugging
    const newTargets   = (updateData.wahaConfig?.targets   || []).length;
    const newSchedules = (updateData.wahaConfig?.schedules || []).length;
    console.log(`[BOT UPDATE] wahaConfig — targets: ${newTargets}, schedules: ${newSchedules}`);

    const updated = await Bot.findByIdAndUpdate(req.params.id, updateData, { new: true });

    AuditService.log({
      req, category: 'bot', action: 'BOT_UPDATE',
      targetId: updated._id, targetName: updated.name,
      detail: {
        ...(diff ?? { note: 'no field changes' }),
        wahaTargets:   newTargets,
        wahaSchedules: newSchedules,
      },
    });

    const result = updated.toObject();
    result.botApiKey = result.botApiKey ? '***' : '';
    res.json(result);
  } catch (error) {
    console.error('Update Bot Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── DELETE /bots/:id ─────────────────────────────────────────
router.delete('/bots/:id', requireAdminOrBotCreator, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!(await canAccessBot(req.user, bot.toObject())))
      return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses ke bot ini' });

    const botName = bot.name;
    if (bot.avatar?.type === 'image' && bot.avatar?.imageUrl) {
      const imgPath = `uploads/avatars/${path.basename(bot.avatar.imageUrl)}`;
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    const kDir = `uploads/knowledge/${req.params.id}`;
    if (fs.existsSync(kDir)) fs.rmSync(kDir, { recursive: true });

    await Bot.findByIdAndDelete(req.params.id);

    AuditService.log({
      req, category: 'bot', action: 'BOT_DELETE',
      targetId: req.params.id, targetName: botName,
    });

    res.json({ message: 'Bot deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// 🔑 BOT API KEY — Generate & Reveal (Terpisah, Eksplisit)
// ============================================================

router.get('/bots/:id/api-key', requireAdminOrBotCreator, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id).select('botApiKey createdBy name').lean();
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!(await canAccessBot(req.user, bot)))
      return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses ke bot ini' });

    if (!bot.botApiKey) {
      return res.json({ botApiKey: null, message: 'API Key belum di-generate.' });
    }

    AuditService.log({
      req, category: 'bot', action: 'BOT_APIKEY_VIEWED',
      targetId: bot._id, targetName: bot.name,
      detail: { note: 'API Key explicitly revealed by user' },
    });

    res.json({ botApiKey: bot.botApiKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bots/:id/regenerate-key', requireAdminOrBotCreator, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!(await canAccessBot(req.user, bot.toObject())))
      return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses ke bot ini' });

    const newApiKey = 'gys-bot-' + crypto.randomBytes(24).toString('hex');
    const isFirstGenerate = !bot.botApiKey;

    bot.botApiKey = newApiKey;
    await bot.save();

    AuditService.log({
      req, category: 'bot', action: 'BOT_UPDATE',
      targetId: bot._id, targetName: bot.name,
      detail: { note: isFirstGenerate ? 'API Key generated for the first time' : 'API Key regenerated' },
    });

    res.json({
      message: isFirstGenerate ? 'API Key berhasil dibuat' : 'API Key berhasil dibuat ulang',
      botApiKey: newApiKey,
    });
  } catch (error) {
    console.error('Regenerate Key Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 🖼️ BOT AVATAR
// ============================================================
router.post('/bots/:id/avatar', requireAdminOrBotCreator, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang di-upload' });
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!(await canAccessBot(req.user, bot.toObject())))
      return res.status(403).json({ error: 'Forbidden' });

    if (bot.avatar?.type === 'image' && bot.avatar?.imageUrl) {
      const oldPath = `uploads/avatars/${path.basename(bot.avatar.imageUrl)}`;
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    bot.avatar = { ...bot.avatar.toObject?.() || bot.avatar, type: 'image', imageUrl: `/api/avatars/${req.file.filename}` };
    await bot.save();
    res.json({ message: 'Avatar berhasil di-upload', bot });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/bots/:id/avatar', requireAdminOrBotCreator, async (req, res) => {
  try {
    const { type, emoji, icon, bgColor, textColor } = req.body;
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!(await canAccessBot(req.user, bot.toObject())))
      return res.status(403).json({ error: 'Forbidden' });

    bot.avatar = {
      ...bot.avatar?.toObject?.() || bot.avatar || {},
      type: type || 'emoji',
      emoji: emoji ?? bot.avatar?.emoji ?? '🤖',
      icon:  icon  ?? bot.avatar?.icon  ?? null,
      bgColor:   bgColor   ?? bot.avatar?.bgColor   ?? '#6366f1',
      textColor: textColor ?? bot.avatar?.textColor ?? '#ffffff',
    };
    await bot.save();
    res.json({ message: 'Avatar updated', bot });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// 📚 KNOWLEDGE BASE
// ============================================================
router.post('/bots/:id/knowledge', requireAdminOrBotCreator, knowledgeUpload.array('files', 10), async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!(await canAccessBot(req.user, bot.toObject())))
      return res.status(403).json({ error: 'Forbidden' });
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: 'Tidak ada file yang di-upload' });

    // ✅ FIX: extractedImages sekarang di-destructure dan disimpan ke DB
    const results = [];
    for (const file of req.files) {
      console.log(new Date().toISOString(), '[Admin/Knowledge] Processing file:', file.originalname, `(${(file.size / 1024).toFixed(1)} KB)`);

      const { content, summary, extractedImages } = await KnowledgeBaseService.extractContent(
        file.path, file.originalname, file.mimetype
      );
      console.log(
        new Date().toISOString(),
        '[Admin/Knowledge] ✅ Processed:', file.originalname,
        `| chars=${content.length}`,
        `| images=${(extractedImages || []).length}`
      );
      (extractedImages || []).forEach((img, i) => {
        console.log(
          new Date().toISOString(),
          '[Admin/Knowledge]  ├─ Image[' + i + ']:', img.filename,
          '(' + img.mimeType + ')',
          '→', img.url
        );
      });

      bot.knowledgeFiles.push({
        filename:        file.filename,
        originalName:    file.originalname,
        mimetype:        file.mimetype,
        size:            file.size,
        path:            file.path,
        content,
        summary,
        uploadedAt:      new Date(),
        extractedImages: extractedImages || [],   // ✅ NOW SAVED TO DB
      });
      results.push({
        name:       file.originalname,
        size:       file.size,
        summary,
        imageCount: (extractedImages || []).length,   // ✅ Report image count back
      });
    }

    await bot.save();

    AuditService.log({
      req, category: 'knowledge', action: 'KNOWLEDGE_UPLOAD',
      targetId: bot._id, targetName: bot.name,
      detail: { files: results.map(f => ({ name: f.name, size: f.size })) },
    });

    res.json({ message: `${results.length} file berhasil diproses`, files: results, totalFiles: bot.knowledgeFiles.length });
  } catch (error) {
    console.error('Knowledge upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/bots/:id/knowledge/:fileId', requireAdminOrBotCreator, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!(await canAccessBot(req.user, bot.toObject())))
      return res.status(403).json({ error: 'Forbidden' });

    const idx = bot.knowledgeFiles.findIndex(f => f._id.toString() === req.params.fileId);
    if (idx === -1) return res.status(404).json({ error: 'File not found' });

    const fileRecord = bot.knowledgeFiles[idx];
    if (fileRecord.path && fs.existsSync(fileRecord.path)) fs.unlinkSync(fileRecord.path);

    AuditService.log({
      req, category: 'knowledge', action: 'KNOWLEDGE_DELETE',
      targetId: bot._id, targetName: bot.name,
      detail: { fileName: fileRecord.originalName, fileSize: fileRecord.size },
    });

    bot.knowledgeFiles.splice(idx, 1);
    await bot.save();
    res.json({ message: 'File dihapus', totalFiles: bot.knowledgeFiles.length });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/bots/:id/knowledge/:fileId/reprocess', requireAdminOrBotCreator, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!(await canAccessBot(req.user, bot.toObject())))
      return res.status(403).json({ error: 'Forbidden' });

    const kFile = bot.knowledgeFiles.id(req.params.fileId);
    if (!kFile) return res.status(404).json({ error: 'File not found' });
    if (!fs.existsSync(kFile.path))
      return res.status(400).json({ error: 'Physical file not found, please re-upload' });

    const { content, summary } = await KnowledgeBaseService.extractContent(kFile.path, kFile.originalName, kFile.mimetype);
    kFile.content = content; kFile.summary = summary;
    await bot.save();
    res.json({ message: 'File berhasil diproses ulang', summary });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// 💬 CHAT LOGS & EXPORT
// ============================================================
router.get('/chat-logs', requireAdmin, async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;
    const total = await Chat.countDocuments({});
    const chats = await Chat.find({})
      .populate('userId', 'username').populate('botId', 'name')
      .sort({ createdAt: -1 }).skip(skip).limit(limit);
    res.json({ chats, totalPages: Math.ceil(total / limit), currentPage: page, totalLogs: total });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/export-chats', requireAdmin, async (req, res) => {
  try {
    const { month, year } = req.query;
    let query = {};
    let fileName = `chat-logs-all-${new Date().toISOString().slice(0, 10)}.csv`;
    if (month && year) {
      const m = parseInt(month), y = parseInt(year);
      query.createdAt = { $gte: new Date(y, m - 1, 1), $lte: new Date(y, m, 0, 23, 59, 59, 999) };
      fileName = `chat-logs-${y}-${m.toString().padStart(2, '0')}.csv`;
    }
    const chats = await Chat.find(query).populate('userId', 'username').populate('botId', 'name').sort({ createdAt: -1 });
    let csv = 'Timestamp,User,Bot,Role,Message\n';
    chats.forEach(c => {
      const msg = (c.content || '').replace(/"/g, '""').replace(/(\r\n|\n|\r)/g, ' ');
      csv += [`"${new Date(c.createdAt).toLocaleString()}"`, `"${c.userId?.username || ''}"`, `"${c.botId?.name || ''}"`, `"${c.role}"`, `"${msg}"`].join(',') + '\n';
    });
    AuditService.log({ req, category: 'export', action: 'EXPORT_CHATS', detail: { filter: (month && year) ? `${year}-${month}` : 'all', totalRows: chats.length, fileName } });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.send(csv);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// 🔗 TEST ONEDRIVE
// ============================================================
router.post('/bots/:id/test-onedrive', requireAdminOrBotCreator, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!(await canAccessBot(req.user, bot.toObject())))
      return res.status(403).json({ error: 'Forbidden' });

    const cfg = bot.onedriveConfig;
    if (!cfg?.enabled || !cfg?.tenantId || !cfg?.clientId || !cfg?.clientSecret)
      return res.status(400).json({ error: 'OneDrive belum dikonfigurasi lengkap' });

    const svc    = new OneDriveService(cfg.tenantId, cfg.clientId, cfg.clientSecret);
    const result = await svc.testConnection(cfg.folderUrl);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
