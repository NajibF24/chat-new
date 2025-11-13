import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import chatRoutes from './routes/chat.js';
import smartsheetRoutes from './routes/smartsheet.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// ✅ IMPROVED CORS Configuration
const allowedOrigins = [
  'http://localhost',
  'http://localhost:80',
  'http://localhost:3000',
  'http://16.79.23.146',
  'http://16.79.23.146:80',
  'http://16.78.93.247',
  'http://16.78.93.247:80',
  'https://16.79.23.146',
  'https://16.78.93.247'
];

// Add custom origins from env
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}
if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach(origin => {
    allowedOrigins.push(origin.trim());
  });
}

console.log('🌐 Allowed CORS origins:', allowedOrigins);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) {
      console.log('✅ CORS: No origin (allowed)');
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log('✅ CORS allowed:', origin);
      callback(null, true);
    } else {
      console.log('❌ CORS blocked:', origin);
      console.log('   Allowed origins:', allowedOrigins);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With'],
  exposedHeaders: ['set-cookie'],
  maxAge: 86400
}));

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy
app.set('trust proxy', 1);

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-to-a-secure-random-string',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: false, // ✅ Set to false for HTTP
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
    domain: undefined // ✅ Don't set domain for IP-based access
  }
}));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const origin = req.get('origin') || 'none';
  const method = req.method;
  const path = req.path;
  
  console.log(`[${timestamp}] ${method} ${path} - Origin: ${origin}`);
  
  // Log session info for auth endpoints
  if (path.startsWith('/api/auth')) {
    console.log(`   Session ID: ${req.sessionID || 'none'}`);
    console.log(`   User ID: ${req.session?.userId || 'none'}`);
  }
  
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/smartsheet', smartsheetRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    mongodb: 'connected',
    smartsheet: process.env.SMARTSHEET_API_KEY ? 'configured' : 'not configured',
    openai: process.env.OPENAI_API_KEY ? 'configured' : 'not configured',
    uptime: process.uptime(),
    server: {
      port: PORT,
      ip: '0.0.0.0'
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Internal Chat API Server with Smartsheet Integration',
    version: '2.0.0',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: '/health',
      auth: '/api/auth/*',
      admin: '/api/admin/*',
      chat: '/api/chat/*',
      smartsheet: '/api/smartsheet/*'
    },
    status: 'running'
  });
});

// CORS preflight
app.options('*', cors());

// 404 handler
app.use((req, res) => {
  console.log('❌ 404 Not Found:', req.method, req.path);
  res.status(404).json({ 
    error: 'Not Found',
    path: req.path,
    method: req.method,
    message: 'The requested resource does not exist'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      error: 'CORS Error',
      message: 'Origin not allowed',
      origin: req.get('origin'),
      allowedOrigins: process.env.NODE_ENV === 'development' ? allowedOrigins : undefined
    });
  }
  
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Start server - bind to 0.0.0.0 for external access
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('='.repeat(70));
  console.log(`🚀 INTERNAL CHAT SERVER WITH SMARTSHEET INTEGRATION`);
  console.log('='.repeat(70));
  console.log(`📍 Environment:       ${process.env.NODE_ENV || 'development'}`);
  console.log(`📍 Server Port:       ${PORT}`);
  console.log(`📍 Binding:           0.0.0.0 (accessible from external IPs)`);
  console.log(`📍 Access URLs:`);
  console.log(`   - http://localhost:${PORT}`);
  console.log(`   - http://16.79.23.146:${PORT}`);
  console.log(`   - http://16.78.93.247:${PORT}`);
  console.log('');
  console.log(`🗄️  MongoDB:           ${process.env.MONGODB_URI ? 'Connected ✓' : 'Missing ✗'}`);
  console.log(`🤖 OpenAI API:        ${process.env.OPENAI_API_KEY ? 'Configured ✓' : 'Not configured ⚠️'}`);
  console.log(`📊 Smartsheet API:    ${process.env.SMARTSHEET_API_KEY ? 'Configured ✓' : 'Not configured ⚠️'}`);
  console.log(`📋 Sheet ID:          ${process.env.SMARTSHEET_PRIMARY_SHEET_ID || 'Not set'}`);
  console.log('');
  console.log(`🌐 CORS Allowed Origins: ${allowedOrigins.length}`);
  allowedOrigins.forEach(origin => console.log(`   - ${origin}`));
  console.log('');
  console.log(`⏱️  Started at:        ${new Date().toISOString()}`);
  console.log('='.repeat(70));
  console.log('');
  
  if (!process.env.SMARTSHEET_API_KEY) {
    console.log('⚠️  WARNING: Smartsheet API key not configured!');
    console.log('   Add SMARTSHEET_API_KEY to your .env file');
    console.log('');
  }
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️  WARNING: OpenAI API key not configured!');
    console.log('   Add OPENAI_API_KEY to your .env file');
    console.log('');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});
