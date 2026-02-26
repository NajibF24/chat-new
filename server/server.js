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

// (Opsional) Kita tidak pakai __dirname untuk static file, tapi tetap berguna untuk hal lain
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.SERVER_PORT || 5000;

connectDB();

app.set('trust proxy', 1);

const allowedOrigins = [
  'https://chat.gyssteel.com',
  'http://chat.gyssteel.com',
  'http://localhost:8080',
  'http://localhost:3000', // Opsional: Tambahan untuk dev frontend
  'http://localhost:5173'  // Opsional: Tambahan untuk dev Vite
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(null, true); 
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
// 📂 FILE SERVING CONFIGURATION (DOCKER COMPATIBLE)
// =================================================================
// Gunakan process.cwd() agar selalu menunjuk ke /usr/src/app di dalam container
const filesPath = path.join(process.cwd(), 'data', 'files');
const generatedPath = path.join(filesPath, 'generated'); // ✅ Tambahan: Path khusus DALL-E

// Log lokasi agar kita tahu di mana server mencari file
console.log('📂 Serving Static Files from:', filesPath); 

// Pastikan folder ada
(async () => {
    try { 
      await fs.mkdir(filesPath, { recursive: true }); 
      await fs.mkdir(generatedPath, { recursive: true }); // ✅ Buat folder generated
      console.log('✅ Directories ensured:', filesPath, generatedPath);
    } catch (e) { 
      console.error('❌ Failed to create directories:', e); 
    }
})();

// ✅ SERVE FILES STATICALLY
app.use('/api/files', (req, res, next) => {
  // Allow cross-origin for images agar bisa dimuat di frontend
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  next();
}, express.static(filesPath));
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