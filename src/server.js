require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

// Auto-generate a secure JWT_SECRET if the default placeholder is still in use
(function ensureJwtSecret() {
  const defaultSecret = 'your-super-secret-jwt-key-change-this-in-production';
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === defaultSecret) {
    const generated = crypto.randomBytes(48).toString('hex');
    process.env.JWT_SECRET = generated;
    // Persist it to .env so the same secret survives restarts
    const envPath = path.join(__dirname, '../.env');
    try {
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      if (envContent.includes('JWT_SECRET=')) {
        envContent = envContent.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${generated}`);
      } else {
        envContent += `\nJWT_SECRET=${generated}`;
      }
      fs.writeFileSync(envPath, envContent);
    } catch (e) { /* non-fatal */ }
  }
})();

// Initialize database first
const { initializeDatabase, closeDatabase, forceSave } = require('./config/database');

// Create Express app
const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { success: false, error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 login attempts per windowMs
  message: { success: false, error: 'Too many login attempts, please try again later.' }
});

app.use('/api/', limiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Body parser
app.use(express.json({ limit: '10kb' })); // Limit body size
app.use(express.static(path.join(__dirname, '../public')));

const io = new Server(server, {
  cors: corsOptions
});
let monitorService;
let shuttingDown = false;

// Start server
async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();

    // Initialize Monitor Service
    const MonitorService = require('./services/MonitorService');
    monitorService = new MonitorService(io);

    // Routes
    const authRoutes = require('./routes/auth');
    const apiRoutes = require('./routes/api')(monitorService);

    app.use('/api/auth', authRoutes);
    app.use('/api', apiRoutes);

    // Socket.io connection handling
    const Website = require('./models/Website');
    
    io.on('connection', (socket) => {
      console.log(`📱 Client connected: ${socket.id}`);

      const websites = Website.getWithLatestStatus();
      socket.emit('initial-status', websites);

      socket.on('disconnect', () => {
        console.log(`📴 Client disconnected: ${socket.id}`);
      });

      socket.on('check-website', async (websiteId) => {
        const website = Website.findById(websiteId);
        if (website?.enabled && !shuttingDown) {
          try {
            await monitorService.checkWebsite(website);
          } catch (error) {
            console.error('Manual check failed:', error.message);
          }
        }
      });
    });

    // Serve frontend
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    app.get('/login', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/login.html'));
    });

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({ success: false, error: 'Not found' });
    });

    // Error handler
    app.use((err, req, res, next) => {
      console.error('Error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    });

    // Start listening
    const PORT = process.env.PORT || 3000;
    const HOST = process.env.HOST || 'localhost';

    server.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🖥️  Website Uptime Monitor - Kokoro                        ║
║                                                              ║
║   ✅ ระบบพร้อมใช้งานแล้ว!                                   ║
║                                                              ║
║   🌐 เปิดเบราว์เซอร์ไปที่:                                  ║
║      http://${HOST}:${PORT}                                      ║
║                                                              ║
║   💡 ยังไม่มีบัญชี? ลงทะเบียนที่หน้าเว็บได้เลย            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
      `);

      // Check if first user needs to be created
      const User = require('./models/User');
      const userCount = User.count();
      if (userCount === 0) {
        console.log('⚠️  ยังไม่มีบัญชีผู้ใช้ — เปิดเบราว์เซอร์แล้วสร้างบัญชี Admin ได้เลย!');
      }

      // Start monitoring all enabled websites
      monitorService.startAll();

      // Auto-open browser
      const url = `http://${HOST}:${PORT}`;
      console.log(`\n🌐 กำลังเปิดเบราว์เซอร์ที่ ${url} ...`);
      try {
        const platform = process.platform;
        if (platform === 'win32') execSync(`start ${url}`, { stdio: 'ignore' });
        else if (platform === 'darwin') execSync(`open ${url}`, { stdio: 'ignore' });
        else execSync(`xdg-open ${url}`, { stdio: 'ignore' });
      } catch (e) { /* ไม่สามารถเปิดเบราว์เซอร์อัตโนมัติได้ กรุณาเปิดเอง */ }
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n\n🛑 Shutting down gracefully...');

  const deadline = setTimeout(() => process.exit(1), 15000);
  deadline.unref();
  // Stop accepting work before draining checks and notification writes.
  server.close();
  io.disconnectSockets(true);
  if (monitorService) await monitorService.stopAll();
  
  // Force save database
  forceSave();
  
  // Close database connection
  closeDatabase();
  
  clearTimeout(deadline);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  shutdown();
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
startServer();
