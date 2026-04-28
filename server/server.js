import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { connectDB } from './config/db.js';

import authRoutes      from './routes/auth.js';
import adminRoutes     from './routes/admin.js';
import chatRoutes      from './routes/chat.js';
import smartsheetRoutes from './routes/smartsheet.js';
import embedRoutes     from './routes/embed.js';
import pptxRoutes      from './routes/pptx.js';
import wahaRoutes, { handleBaileysMessage } from './routes/waha.js';
import newsletterRoutes from './routes/newsletter.js';

import { startWahaScheduler } from './services/wahaScheduler.js';
import BaileysService from './services/baileys.service.js';
import CleanupService from './services/cleanup.service.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.SERVER_PORT || 5000;

connectDB();

app.set('trust proxy', 1);

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With', 'X-Api-Key'],
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'gys-secret-key-fallback',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl:       process.env.MONGODB_URI,
    collectionName: 'sessions',
    ttl:            24 * 60 * 60,
  }),
  cookie: {
    secure:   false,
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000,
    sameSite: 'lax',
    path:     '/',
  },
}));

// Logger
app.use((req, res, next) => {
  if (!req.path.includes('/files/') && !req.path.includes('static')) {
    const user = req.session?.userId ? `User:${req.session.userId}` : 'Guest';
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path} | ${user}`);
  }
  next();
});

// =================================================================
// 📂 DIRECTORY SETUP
// =================================================================
const filesPath          = path.join(process.cwd(), 'data', 'files');
const generatedPath      = path.join(filesPath, 'generated');
const extractedImgPath   = path.join(filesPath, 'extracted-images'); // ✅ NEW
const avatarsPath        = path.join(process.cwd(), 'uploads', 'avatars');

console.log('📂 Serving files from:', filesPath);
console.log('🖼️  Serving avatars from:', avatarsPath);

(async () => {
  try {
    await fs.mkdir(filesPath,        { recursive: true });
    await fs.mkdir(generatedPath,    { recursive: true });
    await fs.mkdir(extractedImgPath, { recursive: true }); // ✅ NEW
    await fs.mkdir(avatarsPath,      { recursive: true });
    await fs.mkdir(path.join(process.cwd(), 'data', 'tmp'), { recursive: true });
    console.log('✅ Directories ensured');

    // ✅ Ensure GYS logo is available in server/data/ for newsletter generation
    const logoDestPath = path.join(process.cwd(), 'data', 'gys-logo.webp');
    const logoSrcPaths = [
      path.join(process.cwd(), '../client/public/assets/gys-logo.webp'),
      path.join(__dirname, '../client/public/assets/gys-logo.webp'),
    ];
    try {
      const logoExists = await fs.access(logoDestPath).then(() => true).catch(() => false);
      if (!logoExists) {
        for (const src of logoSrcPaths) {
          const srcExists = await fs.access(src).then(() => true).catch(() => false);
          if (srcExists) {
            await fs.copyFile(src, logoDestPath);
            console.log('✅ GYS logo copied to server/data/');
            break;
          }
        }
      }
    } catch (logoErr) {
      console.warn('⚠️ Could not copy GYS logo (newsletter will use text fallback):', logoErr.message);
    }
  } catch (e) {
    console.error('❌ Failed to create directories:', e);
  }
})();

// Serve file uploads
app.use('/api/files', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static(filesPath));

// Serve avatar images
app.use('/api/avatars', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static(avatarsPath));

// =================================================================
// ROUTES
// =================================================================
app.use('/api/auth',        authRoutes);
app.use('/api/admin',       adminRoutes);
app.use('/api/chat',        chatRoutes);
app.use('/api/smartsheet',  smartsheetRoutes);
app.use('/api/embed',       embedRoutes);
app.use('/api/pptx',        pptxRoutes);
app.use('/api/waha',        wahaRoutes); // ✅ NEW: WAHA webhook receiver
app.use('/api/newsletter',  newsletterRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Baileys Admin Endpoints (must be before 404 handler) ───────────
app.get('/api/admin/baileys/status', (req, res) => {
  res.json({
    status: BaileysService.getStatus(),
    connected: BaileysService.isConnected(),
  });
});

app.get('/api/admin/baileys/qr', (req, res) => {
  const qr = BaileysService.getQRBase64();
  if (!qr) {
    const st = BaileysService.getStatus();
    return res.status(202).json({
      message: st === 'connected' ? 'Already connected — no QR needed' : 'QR not ready yet, wait a moment and refresh',
      status: st,
    });
  }
  res.send(`<!DOCTYPE html>
<html><head><title>GYS WhatsApp QR</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:#fff;font-family:sans-serif}
h1{color:#25D366}p{color:#aaa;font-size:14px}img{border-radius:12px;max-width:300px}</style>
</head><body>
<h1>📱 Scan QR Code</h1>
<p>WhatsApp → Linked Devices → Link a Device</p>
<img src="${qr}" alt="QR Code" />
<p style="margin-top:16px;color:#666">Page auto-refreshes every 30s</p>
</body></html>`);
});

// ── GET /api/admin/baileys/groups — list all groups the bot has joined ─────────
// Use this to find the correct group JID and verify bot membership.
// Fields: id (JID to use in wahaConfig), name, size (member count),
//         announce (true = only admins can send → bot cannot send if not admin)
app.get('/api/admin/baileys/groups', async (req, res) => {
  if (!BaileysService.isConnected()) {
    return res.status(503).json({ error: 'WhatsApp not connected', status: BaileysService.getStatus() });
  }
  try {
    const groups = await BaileysService.getGroups();
    res.json({
      total: groups.length,
      groups,
      hint: 'Copy the "id" field into the wahaConfig.targets[].chatId in your bot settings.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res)       => res.status(404).json({ error: 'Endpoint Not Found' }));
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // 🔹 Start Baileys WhatsApp service
  BaileysService.init().then(() => {
    BaileysService.setMessageHandler(handleBaileysMessage);
  }).catch(err => {
    console.error('❌ Baileys init failed:', err.message);
  });

  // 🔹 Start WhatsApp Scheduler
  startWahaScheduler();

  // 🔹 Start File Cleanup Scheduler
  CleanupService.start();
});