import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import chatRoutes from './routes/chat.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// ✅ FLEXIBLE CORS Configuration
// Supports: localhost, AWS, on-premise, domain, IP
const buildAllowedOrigins = () => {
  const origins = [
    'http://localhost',
    'http://localhost:80',
    'http://localhost:3000',
    'https://localhost',
    'https://localhost:443',
  ];

  // Add FRONTEND_URL from env
  if (process.env.FRONTEND_URL) {
    origins.push(process.env.FRONTEND_URL);
    origins.push(process.env.FRONTEND_URL.replace('http://', 'https://'));
  }

  // Add ADDITIONAL ORIGINS from env (comma-separated)
  if (process.env.ALLOWED_ORIGINS) {
    const additionalOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    origins.push(...additionalOrigins);
  }

  // Remove duplicates and filter empty
  return [...new Set(origins)].filter(Boolean);
};

const allowedOrigins = buildAllowedOrigins();

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman, etc)
    if (!origin) return callback(null, true);
    
    // Check if origin is allowed
    const isAllowed = allowedOrigins.some(allowed => {
      // Exact match
      if (origin === allowed) return true;
      
      // Wildcard subdomain support (*.domain.com)
      if (allowed.includes('*')) {
        const regex = new RegExp('^' + allowed.replace('*', '.*') + '$');
        return regex.test(origin);
      }
      
      return false;
    });
    
    if (isAllowed) {
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
  maxAge: 86400 // 24 hours
}));

// Parse JSON bodies
app.use(express.json());

// Trust proxy (important for AWS/behind load balancer)
app.set('trust proxy', 1);

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-super-secret-session-key-change-this',
  resave: false,
  saveUninitialized: false,
  proxy: true, // Important for production
  cookie: {
    secure: process.env.NODE_ENV === 'production' && process.env.USE_HTTPS === 'true',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined
  }
}));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const origin = req.get('origin') || 'none';
  console.log(`[${timestamp}] ${req.method} ${req.path} - Origin: ${origin}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    mongodb: 'connected',
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Internal Chat API Server',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: '/health',
      auth: '/api/auth/*',
      admin: '/api/admin/*',
      chat: '/api/chat/*'
    }
  });
});

// CORS preflight
app.options('*', cors());

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    path: req.path,
    message: 'The requested resource does not exist'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  
  // CORS error
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

// Start server - bind to 0.0.0.0 untuk accessibility
app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log(`🚀 Internal Chat Server`);
  console.log('='.repeat(50));
  console.log(`📍 Port:              ${PORT}`);
  console.log(`🌍 Environment:       ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Frontend URL:      ${process.env.FRONTEND_URL || 'Not set'}`);
  console.log(`📡 Allowed Origins:   ${allowedOrigins.length} configured`);
  allowedOrigins.forEach(origin => console.log(`   - ${origin}`));
  console.log(`🗄️  MongoDB:           ${process.env.MONGODB_URI ? 'Connected ✓' : 'Missing ✗'}`);
  console.log(`🔐 Session Secret:    ${process.env.SESSION_SECRET && process.env.SESSION_SECRET !== 'your-super-secret-session-key-change-this' ? 'Set ✓' : 'Using default ⚠️'}`);
  console.log(`🤖 OpenAI API Key:    ${process.env.OPENAI_API_KEY ? 'Set ✓' : 'Missing ✗'}`);
  console.log(`🔒 HTTPS Mode:        ${process.env.USE_HTTPS === 'true' ? 'Enabled' : 'Disabled'}`);
  console.log(`⏱️  Started at:        ${new Date().toISOString()}`);
  console.log('='.repeat(50));
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
