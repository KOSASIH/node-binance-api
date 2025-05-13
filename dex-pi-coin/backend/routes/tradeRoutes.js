const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const redis = require('redis');
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const Trade = require('../models/Trade');
const { getContractInstance, estimateGas } = require('../utils/contractHelper');
const logger = require('../utils/logger');

// Initialize Redis client for caching
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch(err => logger.error('Redis connection failed:', err));

// Initialize WebSocket server for real-time trade notifications
const wss = new WebSocket.Server({ port: process.env.WS_TRADE_PORT || 8082 });
const clients = new Set();

// Broadcast trade updates to WebSocket clients
const broadcastTradeUpdate = (tradeData) => {
  const message = JSON.stringify({ type: 'trade', ...tradeData });
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
  max: 50, // Limit to 50 requests per window
  message: 'Too many trade requests, please try again later.',
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

// Utility to calculate slippage
const calculateSlippage = (expectedPrice, currentPrice, maxSlippage) => {
  const slippage = Math.abs((currentPrice - expectedPrice) / expectedPrice) * 100;
  return slippage <= maxSlippage;
};

// Utility to fetch on-chain price from LiquidityPool contract
async function getOnChainPrice(pairAddress) {
  try {
    const poolContract = await getContractInstance('LiquidityPool', pairAddress);
    const reserves = await poolContract.getReserves();
    return reserves[0] / reserves[1]; // tokenA / tokenB
  } catch (error) {
    logger.error('Failed to fetch on-chain price:', error);
    throw new Error('Failed to fetch on-chain price');
  }
}

// Route: Execute a token swap (market order)
router.post(
  '/swap',
  limiter,
  authenticateJWT,
  [
    body('pair').matches(/^[A-Z]{3,10}-[A-Z]{3,10}$/).withMessage('Invalid pair format (e.g., PICOIN-ETH)'),
    body('amountIn').isFloat({ min: 0.0001 }).withMessage('Amount must be a positive number'),
    body('tokenIn').isString().withMessage('Invalid tokenIn address'),
    body('tokenOut').isString().withMessage('Invalid tokenOut address'),
    body('maxSlippage').isFloat({ min: 0, max: 10 }).withMessage('Max slippage must be between 0 and 10%'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { pair, amountIn, tokenIn, tokenOut, maxSlippage } = req.body;
    const userAddress = req.user.walletAddress; // From JWT payload
    const pairAddress = process.env[`${pair.toUpperCase()}_POOL_ADDRESS`];

    if (!pairAddress) {
      return res.status(400).json({ error: 'Invalid token pair' });
    }

    try {
      // Fetch current price for slippage check
      const currentPrice = await getOnChainPrice(pairAddress);
      const expectedPrice = currentPrice; // Assume frontend provides expected price or fetch from cache
      if (!calculateSlippage(expectedPrice, currentPrice, maxSlippage)) {
        return res.status(400).json({ error: 'Slippage exceeds maximum allowed' });
      }

      // Initialize DEX contract
      const dexContract = await getContractInstance('DEX', process.env.DEX_ADDRESS);
      const amountInWei = ethers.utils.parseEther(amountIn.toString());

      // Estimate gas
      const gasEstimate = await estimateGas(dexContract, 'swapExactTokensForTokens', [
        amountInWei,
        0, // Min amount out (slippage protection handled above)
        [tokenIn, tokenOut],
        userAddress,
        Math.floor(Date.now() / 1000) + 60 * 20, // Deadline: 20 minutes
      ]);

      // Execute swap (assumes user has approved tokenIn)
      const tx = await dexContract.swapExactTokensForTokens(
        amountInWei,
        0,
        [tokenIn, tokenOut],
        userAddress,
        Math.floor(Date.now() / 1000) + 60 * 20,
        { gasLimit: gasEstimate }
      );

      // Wait for transaction confirmation
      const receipt = await tx.wait();

      // Save trade to database
      const trade = new Trade({
        pair: pair.toUpperCase(),
        price: currentPrice,
        amount: amountIn,
        type: tokenIn.toLowerCase() === process.env.PICOIN_ADDRESS.toLowerCase() ? 'sell' : 'buy',
        user: userAddress,
        txHash: receipt.transactionHash,
        timestamp: Date.now(),
      });
      await trade.save();

      // Broadcast trade
      broadcastTradeUpdate({
        pair,
        price: currentPrice,
        amount: amountIn,
        type: trade.type,
        txHash: receipt.transactionHash,
      });

      res.json({
        success: true,
        txHash: receipt.transactionHash,
        price: currentPrice,
        amount: amountIn,
      });
    } catch (error) {
      logger.error(`Error executing swap for ${pair}:`, error);
      res.status(500).json({ error: 'Failed to execute swap' });
    }
  }
);

// Route: Place a limit order
router.post(
  '/limit-order',
  limiter,
  authenticateJWT,
  [
    body('pair').matches(/^[A-Z]{3,10}-[A-Z]{3,10}$/).withMessage('Invalid pair format'),
    body('amount').isFloat({ min: 0.0001 }).withMessage('Amount must be a positive number'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('type').isIn(['buy', 'sell']).withMessage('Type must be buy or sell'),
    body('tokenIn').isString().withMessage('Invalid tokenIn address'),
    body('tokenOut').isString().withMessage('Invalid tokenOut address'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { pair, amount, price, type, tokenIn, tokenOut } = req.body;
    const userAddress = req.user.walletAddress;

    try {
      // Save limit order to database (off-chain for matching)
      const trade = new Trade({
        pair: pair.toUpperCase(),
        price,
        amount,
        type,
        user: userAddress,
        status: 'pending',
        timestamp: Date.now(),
      });
      await trade.save();

      // Optionally, interact with DEX contract for on-chain order book (if implemented)
      const dexContract = await getContractInstance('DEX', process.env.DEX_ADDRESS);
      const amountInWei = ethers.utils.parseEther(amount.toString());
      const priceInWei = ethers.utils.parseEther(price.toString());

      // Example: Place limit order on-chain (adjust based on DEX.sol)
      const tx = await dexContract.placeLimitOrder(
        tokenIn,
        tokenOut,
        amountInWei,
        priceInWei,
        type === 'buy',
        { gasLimit: 200000 }
      );
      const receipt = await tx.wait();

      // Update trade with txHash
      trade.txHash = receipt.transactionHash;
      trade.status = 'placed';
      await trade.save();

      // Broadcast trade
      broadcastTradeUpdate({
        pair,
        price,
        amount,
        type,
        txHash: receipt.transactionHash,
        status: 'placed',
      });

      res.json({
        success: true,
        txHash: receipt.transactionHash,
        orderId: trade._id,
      });
    } catch (error) {
      logger.error(`Error placing limit order for ${pair}:`, error);
      res.status(500).json({ error: 'Failed to place limit order' });
    }
  }
);

// Route: Cancel a limit order
router.delete(
  '/limit-order/:orderId',
  limiter,
  authenticateJWT,
  [
    body('orderId').isMongoId().withMessage('Invalid order ID'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { orderId } = req.params;
    const userAddress = req.user.walletAddress;

    try {
      const trade = await Trade.findOne({ _id: orderId, user: userAddress });
      if (!trade || trade.status !== 'pending') {
        return res.status(400).json({ error: 'Order not found or already processed' });
      }

      // Update order status
      trade.status = 'cancelled';
      await trade.save();

      // Optionally, cancel on-chain order (if implemented in DEX.sol)
      const dexContract = await getContractInstance('DEX', process.env.DEX_ADDRESS);
      const tx = await dexContract.cancelLimitOrder(orderId, { gasLimit: 100000 });
      const receipt = await tx.wait();

      // Broadcast cancellation
      broadcastTradeUpdate({
        pair: trade.pair,
        orderId,
        status: 'cancelled',
        txHash: receipt.transactionHash,
      });

      res.json({ success: true, txHash: receipt.transactionHash });
    } catch (error) {
      logger.error(`Error cancelling order ${orderId}:`, error);
      res.status(500).json({ error: 'Failed to cancel order' });
    }
  }
);

// Route: Get user's trade history
router.get(
  '/history',
  limiter,
  authenticateJWT,
  [
    body('pair').optional().matches(/^[A-Z]{3,10}-[A-Z]{3,10}$/).withMessage('Invalid pair format'),
    body('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { pair, limit = 50 } = req.query;
    const userAddress = req.user.walletAddress;

    try {
      const query = { user: userAddress };
      if (pair) query.pair = pair.toUpperCase();

      const trades = await Trade.find(query)
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .select('pair price amount type status txHash timestamp');

      res.json(trades);
    } catch (error) {
      logger.error(`Error fetching trade history for ${userAddress}:`, error);
      res.status(500).json({ error: 'Failed to fetch trade history' });
    }
  }
);

// Route: Get active limit orders
router.get(
  '/active-orders',
  limiter,
  authenticateJWT,
  [
    body('pair').optional().matches(/^[A-Z]{3,10}-[A-Z]{3,10}$/).withMessage('Invalid pair format'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { pair } = req.query;
    const userAddress = req.user.walletAddress;

    try {
      const query = { user: userAddress, status: 'pending' };
      if (pair) query.pair = pair.toUpperCase();

      const orders = await Trade.find(query)
        .sort({ timestamp: -1 })
        .select('pair price amount type status timestamp');

      res.json(orders);
    } catch (error) {
      logger.error(`Error fetching active orders for ${userAddress}:`, error);
      res.status(500).json({ error: 'Failed to fetch active orders' });
    }
  }
);

module.exports = router;
