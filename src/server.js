require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

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

// Start server
async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();

    // Initialize Monitor Service
    const MonitorService = require('./services/MonitorService');
    const monitorService = new MonitorService(io);

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
        if (website) {
          await monitorService.checkWebsite(website);
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
║   🖥️  Website Uptime Monitor v2.0                            ║
║                                                              ║
║   Server running at: http://${HOST}:${PORT}                     ║
║   API endpoint:      http://${HOST}:${PORT}/api                 ║
║                                                              ║
║   🔐 Authentication: ENABLED                                 ║
║   🛡️  Rate Limiting: ENABLED                                 ║
║   💾 Database: SQLite                                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
      `);

      // Check if first user needs to be created
      const User = require('./models/User');
      const userCount = User.count();
      if (userCount === 0) {
        console.log('⚠️  No users found. Please register the first admin user at:');
        console.log(`   POST http://${HOST}:${PORT}/api/auth/register`);
        console.log('   Body: { "username": "admin", "password": "your-password" }\n');
      }

      // Start monitoring all enabled websites
      monitorService.startAll();
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('\n\n🛑 Shutting down gracefully...');
  
  // Force save database
  forceSave();
  
  // Close database connection
  closeDatabase();
  
  // Close server
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.log('⚠️ Forcing exit...');
    process.exit(1);
  }, 10000);
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
