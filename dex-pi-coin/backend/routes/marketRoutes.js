const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const axios = require('axios');
const redis = require('redis');
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const Trade = require('../models/Trade');
const Liquidity = require('../models/Liquidity');
const { getContractInstance } = require('../utils/contractHelper');
const logger = require('../utils/logger');

// Initialize Redis client for caching
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch(err => logger.error('Redis connection failed:', err));

// Initialize WebSocket server for real-time price updates
const wss = new WebSocket.Server({ port: process.env.WS_PORT || 8081 });
const clients = new Set();

// Broadcast price updates to WebSocket clients
const broadcastPriceUpdate = (pair, priceData) => {
  const message = JSON.stringify({ pair, ...priceData });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

// WebSocket connection handler
wss.on('connection', ws => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

// Rate limiter to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit to 100 requests per window
  message: 'Too many requests, please try again later.',
});

// Middleware for JWT authentication
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: No token provided' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Unauthorized: Invalid token' });
    req.user = user;
    next();
  });
};

// Utility to fetch on-chain price from LiquidityPool contract
async function getOnChainPrice(pairAddress, tokenA, tokenB) {
  try {
    const poolContract = await getContractInstance('LiquidityPool', pairAddress);
    const reserves = await poolContract.getReserves();
    const price = reserves[0] / reserves[1]; // tokenA / tokenB
    return { price, timestamp: Date.now(), reserves };
  } catch (error) {
    logger.error(`Failed to fetch on-chain price for ${tokenA}/${tokenB}:`, error);
    throw new Error('Failed to fetch on-chain price');
  }
}

// Utility to fetch Binance price
async function getBinancePrice(symbol) {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
      params: { symbol },
    });
    return parseFloat(response.data.price);
  } catch (error) {
    logger.error(`Failed to fetch Binance price for ${symbol}:`, error);
    return null;
  }
}

// Cache price data in Redis
async function cachePriceData(pair, priceData) {
  await redisClient.setEx(`price:${pair}`, 300, JSON.stringify(priceData)); // Cache for 5 minutes
}

// Route: Get current price for a token pair
router.get(
  '/price/:pair',
  limiter,
  authenticateJWT,
  [
    body('pair').matches(/^[A-Z]{3,10}-[A-Z]{3,10}$/).withMessage('Invalid pair format (e.g., PICOIN-ETH)'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const pair = req.params.pair.toUpperCase();
    const [tokenA, tokenB] = pair.split('-');
    const cacheKey = `price:${pair}`;

    try {
      // Check Redis cache
      const cachedPrice = await redisClient.get(cacheKey);
      if (cachedPrice) {
        return res.json(JSON.parse(cachedPrice));
      }

      // Fetch on-chain price
      const pairAddress = process.env[`${pair}_POOL_ADDRESS`]; // Assumes .env has pool addresses
      if (!pairAddress) {
        return res.status(400).json({ error: 'Invalid token pair' });
      }

      const { price: onChainPrice, reserves } = await getOnChainPrice(pairAddress, tokenA, tokenB);

      // Fetch Binance price for reference (e.g., ETH/USDT for benchmarking)
      const binanceSymbol = `${tokenA}USDT`; // Adjust based on actual pair
      const binancePrice = await getBinancePrice(binanceSymbol);

      const priceData = {
        pair,
        onChainPrice,
        binancePrice,
        reserves,
        timestamp: Date.now(),
      };

      // Cache and broadcast price
      await cachePriceData(pair, priceData);
      broadcastPriceUpdate(pair, priceData);

      res.json(priceData);
    } catch (error) {
      logger.error(`Error fetching price for ${pair}:`, error);
      res.status(500).json({ error: 'Failed to fetch price data' });
    }
  }
);

// Route: Get order book for a token pair
router.get('/orderbook/:pair', limiter, authenticateJWT, async (req, res) => {
  const pair = req.params.pair.toUpperCase();
  try {
    // Fetch trades from MongoDB for order book-like data
    const trades = await Trade.find({ pair })
      .sort({ timestamp: -1 })
      .limit(50)
      .select('price amount type timestamp');

    const buyOrders = trades.filter(t => t.type === 'buy').map(t => ({
      price: t.price,
      amount: t.amount,
      timestamp: t.timestamp,
    }));

    const sellOrders = trades.filter(t => t.type === 'sell').map(t => ({
      price: t.price,
      amount: t.amount,
      timestamp: t.timestamp,
    }));

    res.json({ pair, buyOrders, sellOrders });
  } catch (error) {
    logger.error(`Error fetching order book for ${pair}:`, error);
    res.status(500).json({ error: 'Failed to fetch order book' });
  }
});

// Route: Get historical trades for a token pair
router.get(
  '/trades/:pair',
  limiter,
  authenticateJWT,
  [
    body('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    body('startTime').optional().isISO8601().withMessage('Invalid startTime format'),
    body('endTime').optional().isISO8601().withMessage('Invalid endTime format'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { pair } = req.params;
    const { limit = 50, startTime, endTime } = req.query;

    try {
      const query = { pair: pair.toUpperCase() };
      if (startTime) query.timestamp = { $gte: new Date(startTime) };
      if (endTime) query.timestamp = { ...query.timestamp, $lte: new Date(endTime) };

      const trades = await Trade.find(query)
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .select('price amount type timestamp user');

      res.json(trades);
    } catch (error) {
      logger.error(`Error fetching trades for ${pair}:`, error);
      res.status(500).json({ error: 'Failed to fetch trades' });
    }
  }
);

// Route: Get liquidity pool stats
router.get('/pool/:pair', limiter, authenticateJWT, async (req, res) => {
  const pair = req.params.pair.toUpperCase();
  try {
    const pairAddress = process.env[`${pair}_POOL_ADDRESS`];
    if (!pairAddress) {
      return res.status(400).json({ error: 'Invalid token pair' });
    }

    const poolContract = await getContractInstance('LiquidityPool', pairAddress);
    const reserves = await poolContract.getReserves();
    const totalLiquidity = await poolContract.totalSupply();
    const liquidityData = await Liquidity.find({ pair }).select('user amount timestamp');

    res.json({
      pair,
      reserves,
      totalLiquidity: ethers.utils.formatEther(totalLiquidity),
      liquidityProviders: liquidityData,
    });
  } catch (error) {
    logger.error(`Error fetching pool stats for ${pair}:`, error);
    res.status(500).json({ error: 'Failed to fetch pool stats' });
  }
});

// Route: Get market analytics (e.g., volume, volatility)
router.get('/analytics/:pair', limiter, authenticateJWT, async (req, res) => {
  const pair = req.params.pair.toUpperCase();
  const cacheKey = `analytics:${pair}`;

  try {
    // Check Redis cache
    const cachedAnalytics = await redisClient.get(cacheKey);
    if (cachedAnalytics) {
      return res.json(JSON.parse(cachedAnalytics));
    }

    // Fetch 24h trade data
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const trades = await Trade.find({ pair, timestamp: { $gte: oneDayAgo } });

    const volume = trades.reduce((sum, trade) => sum + trade.amount, 0);
    const prices = trades.map(t => t.price);
    const avgPrice = prices.length ? prices.reduce((sum, p) => sum + p, 0) / prices.length : 0;
    const volatility = prices.length
      ? Math.sqrt(prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length)
      : 0;

    const analytics = { pair, volume, avgPrice, volatility, tradeCount: trades.length };
    await redisClient.setEx(cacheKey, 300, JSON.stringify(analytics)); // Cache for 5 minutes

    res.json(analytics);
  } catch (error) {
    logger.error(`Error fetching analytics for ${pair}:`, error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
