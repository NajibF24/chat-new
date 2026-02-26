import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { connectDB } from './config/db.js';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import chatRoutes from './routes/chat.js';
import smartsheetRoutes from './routes/smartsheet.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.SERVER_PORT || 5000;

connectDB();

app.set('trust proxy', 1);

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],  // ✅ tambah PATCH untuk avatar
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'gys-secret-key-fallback',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60
  }),
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    path: '/'
  }
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
// 📂 FILE & AVATAR DIRECTORY SETUP
// =================================================================

const filesPath = path.join(process.cwd(), 'data', 'files');
const generatedPath = path.join(filesPath, 'generated');
const avatarsPath = path.join(process.cwd(), 'uploads', 'avatars'); // ✅ folder avatar

console.log('📂 Serving files from:', filesPath);
console.log('🖼️  Serving avatars from:', avatarsPath);

// Buat semua folder yang dibutuhkan saat server start
(async () => {
  try {
    await fs.mkdir(filesPath,    { recursive: true });
    await fs.mkdir(generatedPath,{ recursive: true });
    await fs.mkdir(avatarsPath,  { recursive: true }); // ✅ pastikan folder avatar ada
    console.log('✅ Directories ensured');
  } catch (e) {
    console.error('❌ Failed to create directories:', e);
  }
})();

// Serve file uploads biasa
app.use('/api/files', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static(filesPath));

// ✅ Serve avatar images — dipanggil dari frontend via /api/avatars/<filename>
app.use('/api/avatars', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static(avatarsPath));

// =================================================================

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/smartsheet', smartsheetRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((req, res) => res.status(404).json({ error: 'Endpoint Not Found' }));
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});