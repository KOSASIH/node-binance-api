const axios = require('axios');
const redis = require('redis');
const WebSocket = require('ws');
const crypto = require('crypto');
const logger = require('./utils/logger');
require('dotenv').config();

// Binance API configuration
const BASE_URL = 'https://api.binance.com';
const WS_URL = 'wss://stream.binance.com:9443/ws';
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

// Initialize Redis client for caching
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch(err => logger.error('Redis connection failed:', err));

// Initialize WebSocket for real-time price updates
const wsClients = new Map(); // Map of symbol to WebSocket client

// Utility to generate HMAC SHA256 signature for authenticated requests
const generateSignature = (queryString) => {
  return crypto
    .createHmac('sha256', API_SECRET)
    .update(queryString)
    .digest('hex');
};

// Utility to cache data in Redis
const cacheData = async (key, data, ttl = 300) => {
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(data));
  } catch (error) {
    logger.error(`Failed to cache data for ${key}:`, error);
  }
};

// Utility to fetch cached data
const getCachedData = async (key) => {
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logger.error(`Failed to fetch cached data for ${key}:`, error);
    return null;
  }
};

// Utility to handle Binance API requests with retries
const makeRequest = async (method, endpoint, params = {}, authenticated = false) => {
  const maxRetries = 3;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const config = {
        method,
        url: `${BASE_URL}${endpoint}`,
        headers: authenticated ? { 'X-MBX-APIKEY': API_KEY } : {},
        params: authenticated ? { ...params, timestamp: Date.now() } : params,
      };

      if (authenticated) {
        const queryString = new URLSearchParams(config.params).toString();
        config.params.signature = generateSignature(queryString);
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      retries++;
      logger.warn(`Binance API request failed (attempt ${retries}/${maxRetries}):`, error.message);
      if (retries === maxRetries) {
        logger.error('Max retries reached:', error);
        throw new Error('Failed to fetch data from Binance API');
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * retries)); // Exponential backoff
    }
  }
};

// Initialize WebSocket stream for a symbol
const startPriceStream = (symbol) => {
  if (wsClients.has(symbol)) return; // Prevent duplicate streams

  const ws = new WebSocket(`${WS_URL}/${symbol.toLowerCase()}@ticker`);
  wsClients.set(symbol, ws);

  ws.on('open', () => {
    logger.info(`WebSocket stream opened for ${symbol}`);
  });

  ws.on('message', (data) => {
    try {
      const priceData = JSON.parse(data);
      const formattedData = {
        symbol: priceData.s,
        price: parseFloat(priceData.c),
        timestamp: priceData.E,
      };
      // Cache real-time price
      cacheData(`binance:price:${symbol}`, formattedData);
      // Broadcast to connected clients
      broadcastPriceUpdate(symbol, formattedData);
    } catch (error) {
      logger.error(`Error processing WebSocket data for ${symbol}:`, error);
    }
  });

  ws.on('error', (error) => {
    logger.error(`WebSocket error for ${symbol}:`, error);
  });

  ws.on('close', () => {
    logger.info(`WebSocket stream closed for ${symbol}`);
    wsClients.delete(symbol);
    // Attempt to reconnect after 5 seconds
    setTimeout(() => startPriceStream(symbol), 5000);
  });
};

// Broadcast price updates to WebSocket clients (route-specific WebSocket)
const broadcastPriceUpdate = (symbol, priceData) => {
  const wss = new WebSocket.Server({ noServer: true }); // Use existing server from routes
  const message = JSON.stringify({ type: 'binance_price', symbol, ...priceData });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

// Binance API class
class BinanceAPI {
  // Fetch current price for a symbol
  static async getPrice(symbol) {
    const cacheKey = `binance:price:${symbol}`;
    const cachedPrice = await getCachedData(cacheKey);
    if (cachedPrice) {
      return cachedPrice;
    }

    try {
      const data = await makeRequest('GET', '/api/v3/ticker/price', { symbol });
      const priceData = {
        symbol: data.symbol,
        price: parseFloat(data.price),
        timestamp: Date.now(),
      };
      await cacheData(cacheKey, priceData);
      return priceData;
    } catch (error) {
      logger.error(`Failed to fetch price for ${symbol}:`, error);
      throw new Error(`Failed to fetch price for ${symbol}`);
    }
  }

  // Fetch order book for a symbol
  static async getOrderBook(symbol, limit = 100) {
    const cacheKey = `binance:orderbook:${symbol}:${limit}`;
    const cachedOrderBook = await getCachedData(cacheKey);
    if (cachedOrderBook) {
      return cachedOrderBook;
    }

    try {
      const data = await makeRequest('GET', '/api/v3/depth', { symbol, limit });
      const orderBook = {
        symbol,
        bids: data.bids.map(([price, qty]) => ({ price: parseFloat(price), quantity: parseFloat(qty) })),
        asks: data.asks.map(([price, qty]) => ({ price: parseFloat(price), quantity: parseFloat(qty) })),
        lastUpdated: data.lastUpdateId,
      };
      await cacheData(cacheKey, orderBook, 60); // Cache for 1 minute
      return orderBook;
    } catch (error) {
      logger.error(`Failed to fetch order book for ${symbol}:`, error);
      throw new Error(`Failed to fetch order book for ${symbol}`);
    }
  }

  // Fetch historical candlestick data (OHLCV)
  static async getKlines(symbol, interval = '1h', startTime, endTime, limit = 500) {
    const cacheKey = `binance:klines:${symbol}:${interval}:${startTime || 'latest'}:${endTime || 'latest'}:${limit}`;
    const cachedKlines = await getCachedData(cacheKey);
    if (cachedKlines) {
      return cachedKlines;
    }

    try {
      const params = { symbol, interval, limit };
      if (startTime) params.startTime = new Date(startTime).getTime();
      if (endTime) params.endTime = new Date(endTime).getTime();

      const data = await makeRequest('GET', '/api/v3/klines', params);
      const klines = data.map(k => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: k[6],
      }));
      await cacheData(cacheKey, klines, 3600); // Cache for 1 hour
      return klines;
    } catch (error) {
      logger.error(`Failed to fetch klines for ${symbol}:`, error);
      throw new Error(`Failed to fetch klines for ${symbol}`);
    }
  }

  // Fetch 24h ticker statistics
  static async get24hStats(symbol) {
    const cacheKey = `binance:24h:${symbol}`;
    const cachedStats = await getCachedData(cacheKey);
    if (cachedStats) {
      return cachedStats;
    }

    try {
      const data = await makeRequest('GET', '/api/v3/ticker/24hr', { symbol });
      const stats = {
        symbol: data.symbol,
        priceChange: parseFloat(data.priceChange),
        priceChangePercent: parseFloat(data.priceChangePercent),
        lastPrice: parseFloat(data.lastPrice),
        volume: parseFloat(data.volume),
        quoteVolume: parseFloat(data.quoteVolume),
        highPrice: parseFloat(data.highPrice),
        lowPrice: parseFloat(data.lowPrice),
        tradeCount: data.count,
      };
      await cacheData(cacheKey, stats, 300); // Cache for 5 minutes
      return stats;
    } catch (error) {
      logger.error(`Failed to fetch 24h stats for ${symbol}:`, error);
      throw new Error(`Failed to fetch 24h stats for ${symbol}`);
    }
  }

  // Start WebSocket stream for a symbol
  static startPriceStream(symbol) {
    startPriceStream(symbol);
  }

  // Stop WebSocket stream for a symbol
  static stopPriceStream(symbol) {
    const ws = wsClients.get(symbol);
    if (ws) {
      ws.close();
      wsClients.delete(symbol);
      logger.info(`WebSocket stream stopped for ${symbol}`);
    }
  }
}

module.exports = BinanceAPI;
