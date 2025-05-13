const express = require('express');
const mongoose = require('mongoose');
const redis = require('redis');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { createServer } = require('http');
const { Server } = require('ws');
const logger = require('./utils/logger');
require('dotenv').config();

// Import routes
const marketRoutes = require('./routes/marketRoutes');
const tradeRoutes = require('./routes/tradeRoutes');
const liquidityRoutes = require('./routes/liquidityRoutes');

// Initialize Express app
const app = express();
const server = createServer(app);

// Initialize WebSocket server for global events (optional centralized WS)
const wss = new Server({ server });
const clients = new Set();

// WebSocket connection handler
wss.on('connection', ws => {
  clients.add(ws);
  logger.info('WebSocket client connected');
  ws.on('close', () => {
    clients.delete(ws);
    logger.info('WebSocket client disconnected');
  });
});

// Broadcast global events (e.g., server status updates)
const broadcastEvent = (eventData) => {
  const message = JSON.stringify({ type: 'server', ...eventData });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

// Initialize Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch(err => logger.error('Redis connection failed:', err));

// Middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000', // Adjust for frontend URL
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } })); // Request logging

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit to 1000 requests per window
  message: 'Too many requests from this IP, please try again later.',
});
app.use(globalLimiter);

// MongoDB connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/dex-pi-coin', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logger.info('MongoDB connected successfully');
    broadcastEvent({ event: 'database_connected', timestamp: Date.now() });
  } catch (error) {
    logger.error('MongoDB connection failed:', error);
    process.exit(1);
  }
};

// Authentication middleware for protected routes
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    logger.warn('Unauthorized request: No token provided');
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      logger.warn('Unauthorized request: Invalid token');
      return res.status(403).json({ error: 'Unauthorized: Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Routes
app.use('/api/market', authenticateJWT, marketRoutes);
app.use('/api/trade', authenticateJWT, tradeRoutes);
app.use('/api/liquidity', authenticateJWT, liquidityRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check MongoDB connection
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    // Check Redis connection
    const redisStatus = await redisClient.ping().then(() => 'connected').catch(() => 'disconnected');

    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: Date.now(),
      services: {
        mongodb: dbStatus,
        redis: redisStatus,
      },
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({ status: 'unhealthy', error: 'Health check failed' });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Pi Coin DEX API', version: '1.0.0' });
});

// 404 handler
app.use((req, res) => {
  logger.warn(`404 - Route not found: ${req.originalUrl}`);
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...');
  broadcastEvent({ event: 'server_shutdown', timestamp: Date.now() });

  // Close WebSocket connections
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  });

  // Close Redis connection
  await redisClient.quit().catch(err => logger.error('Failed to close Redis:', err));

  // Close MongoDB connection
  await mongoose.connection.close().catch(err => logger.error('Failed to close MongoDB:', err));

  // Close HTTP server
  server.close(() => {
    logger.info('Server shut down successfully');
    process.exit(0);
  });
};

// Handle process termination
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
const PORT = process.env.PORT || 3000;
const startServer = async () => {
  try {
    await connectDB();
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      broadcastEvent({ event: 'server_started', timestamp: Date.now(), port: PORT });
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app; // For testing purposes
