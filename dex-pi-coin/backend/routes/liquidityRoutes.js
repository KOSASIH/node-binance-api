const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const redis = require('redis');
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const Liquidity = require('../models/Liquidity');
const { getContractInstance, estimateGas } = require('../utils/contractHelper');
const logger = require('../utils/logger');

// Initialize Redis client for caching
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch(err => logger.error('Redis connection failed:', err));

// Initialize WebSocket server for real-time liquidity notifications
const wss = new WebSocket.Server({ port: process.env.WS_LIQUIDITY_PORT || 8083 });
const clients = new Set();

// Broadcast liquidity updates to WebSocket clients
const broadcastLiquidityUpdate = (eventData) => {
  const message = JSON.stringify({ type: 'liquidity', ...eventData });
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
  message: 'Too many liquidity requests, please try again later.',
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

// Utility to fetch pool reserves and calculate share
async function getPoolData(pairAddress) {
  try {
    const poolContract = await getContractInstance('LiquidityPool', pairAddress);
    const reserves = await poolContract.getReserves();
    const totalSupply = await poolContract.totalSupply();
    return {
      reserve0: ethers.utils.formatEther(reserves[0]),
      reserve1: ethers.utils.formatEther(reserves[1]),
      totalSupply: ethers.utils.formatEther(totalSupply),
    };
  } catch (error) {
    logger.error('Failed to fetch pool data:', error);
    throw new Error('Failed to fetch pool data');
  }
}

// Utility to calculate user’s share and rewards
async function calculateUserShare(pairAddress, userAddress) {
  try {
    const poolContract = await getContractInstance('LiquidityPool', pairAddress);
    const balance = await poolContract.balanceOf(userAddress);
    const totalSupply = await poolContract.totalSupply();
    const { reserve0, reserve1 } = await getPoolData(pairAddress);

    const share = totalSupply.gt(0) ? balance.mul(100).div(totalSupply).toNumber() : 0;
    const userReserve0 = balance.mul(reserve0).div(totalSupply);
    const userReserve1 = balance.mul(reserve1).div(totalSupply);

    // Calculate accumulated fees (example: 0.3% fee per trade)
    const feeShare = balance.mul(0.003).div(totalSupply).toNumber(); // Simplified fee calculation
    return {
      share: share / 100,
      userReserve0: ethers.utils.formatEther(userReserve0),
      userReserve1: ethers.utils.formatEther(userReserve1),
      feeShare,
    };
  } catch (error) {
    logger.error('Failed to calculate user share:', error);
    throw new Error('Failed to calculate user share');
  }
}

// Route: Add liquidity to a pool
router.post(
  '/add',
  limiter,
  authenticateJWT,
  [
    body('pair').matches(/^[A-Z]{3,10}-[A-Z]{3,10}$/).withMessage('Invalid pair format (e.g., PICOIN-ETH)'),
    body('amountA').isFloat({ min: 0.0001 }).withMessage('AmountA must be a positive number'),
    body('amountB').isFloat({ min: 0.0001 }).withMessage('AmountB must be a positive number'),
    body('tokenA').isString().withMessage('Invalid tokenA address'),
    body('tokenB').isString().withMessage('Invalid tokenB address'),
    body('maxSlippage').isFloat({ min: 0, max: 5 }).withMessage('Max slippage must be between 0 and 5%'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { pair, amountA, amountB, tokenA, tokenB, maxSlippage } = req.body;
    const userAddress = req.user.walletAddress;
    const pairAddress = process.env[`${pair.toUpperCase()}_POOL_ADDRESS`];

    if (!pairAddress) {
      return res.status(400).json({ error: 'Invalid token pair' });
    }

    try {
      const poolContract = await getContractInstance('LiquidityPool', pairAddress);
      const { reserve0, reserve1 } = await getPoolData(pairAddress);
      const expectedRatio = reserve0 / reserve1;
      const providedRatio = amountA / amountB;

      // Check slippage for liquidity ratio
      if (Math.abs((providedRatio - expectedRatio) / expectedRatio) * 100 > maxSlippage) {
        return res.status(400).json({ error: 'Slippage exceeds maximum allowed for liquidity ratio' });
      }

      // Approve tokens (assumes user has approved tokenA and tokenB via frontend)
      const amountAWei = ethers.utils.parseEther(amountA.toString());
      const amountBWei = ethers.utils.parseEther(amountB.toString());

      // Estimate gas for addLiquidity
      const gasEstimate = await estimateGas(poolContract, 'addLiquidity', [
        tokenA,
        tokenB,
        amountAWei,
        amountBWei,
        0, // Min amountA
        0, // Min amountB
        userAddress,
        Math.floor(Date.now() / 1000) + 60 * 20, // Deadline: 20 minutes
      ]);

      // Execute addLiquidity
      const tx = await poolContract.addLiquidity(
        tokenA,
        tokenB,
        amountAWei,
        amountBWei,
        0,
        0,
        userAddress,
        Math.floor(Date.now() / 1000) + 60 * 20,
        { gasLimit: gasEstimate }
      );

      const receipt = await tx.wait();

      // Save liquidity contribution to database
      const liquidity = new Liquidity({
        pair: pair.toUpperCase(),
        user: userAddress,
        amountA,
        amountB,
        txHash: receipt.transactionHash,
        timestamp: Date.now(),
      });
      await liquidity.save();

      // Calculate user’s new share
      const userShare = await calculateUserShare(pairAddress, userAddress);

      // Broadcast liquidity update
      broadcastLiquidityUpdate({
        pair,
        user: userAddress,
        amountA,
        amountB,
        txHash: receipt.transactionHash,
        share: userShare.share,
      });

      res.json({
        success: true,
        txHash: receipt.transactionHash,
        liquidityId: liquidity._id,
        userShare,
      });
    } catch (error) {
      logger.error(`Error adding liquidity for ${pair}:`, error);
      res.status(500).json({ error: 'Failed to add liquidity' });
    }
  }
);

// Route: Remove liquidity from a pool
router.post(
  '/remove',
  limiter,
  authenticateJWT,
  [
    body('pair').matches(/^[A-Z]{3,10}-[A-Z]{3,10}$/).withMessage('Invalid pair format'),
    body('liquidityAmount').isFloat({ min: 0.0001 }).withMessage('Liquidity amount must be a positive number'),
    body('tokenA').isString().withMessage('Invalid tokenA address'),
    body('tokenB').isString().withMessage('Invalid tokenB address'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { pair, liquidityAmount, tokenA, tokenB } = req.body;
    const userAddress = req.user.walletAddress;
    const pairAddress = process.env[`${pair.toUpperCase()}_POOL_ADDRESS`];

    if (!pairAddress) {
      return res.status(400).json({ error: 'Invalid token pair' });
    }

    try {
      const poolContract = await getContractInstance('LiquidityPool', pairAddress);
      const liquidityWei = ethers.utils.parseEther(liquidityAmount.toString());

      // Estimate gas for removeLiquidity
      const gasEstimate = await estimateGas(poolContract, 'removeLiquidity', [
        tokenA,
        tokenB,
        liquidityWei,
        0, // Min amountA
        0, // Min amountB
        userAddress,
        Math.floor(Date.now() / 1000) + 60 * 20, // Deadline: 20 minutes
      ]);

      // Execute removeLiquidity
      const tx = await poolContract.removeLiquidity(
        tokenA,
        tokenB,
        liquidityWei,
        0,
        0,
        userAddress,
        Math.floor(Date.now() / 1000) + 60 * 20,
        { gasLimit: gasEstimate }
      );

      const receipt = await tx.wait();

      // Save liquidity removal to database
      const liquidity = new Liquidity({
        pair: pair.toUpperCase(),
        user: userAddress,
        amountA: -liquidityAmount, // Negative to indicate removal
        amountB: -liquidityAmount, // Simplified, adjust based on actual amounts
        txHash: receipt.transactionHash,
        timestamp: Date.now(),
      });
      await liquidity.save();

      // Calculate user’s updated share
      const userShare = await calculateUserShare(pairAddress, userAddress);

      // Broadcast liquidity update
      broadcastLiquidityUpdate({
        pair,
        user: userAddress,
        liquidityAmount,
        txHash: receipt.transactionHash,
        share: userShare.share,
      });

      res.json({
        success: true,
        txHash: receipt.transactionHash,
        liquidityId: liquidity._id,
        userShare,
      });
    } catch (error) {
      logger.error(`Error removing liquidity for ${pair}:`, error);
      res.status(500).json({ error: 'Failed to remove liquidity' });
    }
  }
);

// Route: Get liquidity pool statistics
router.get(
  '/pool/:pair',
  limiter,
  authenticateJWT,
  [
    body('pair').matches(/^[A-Z]{3,10}-[A-Z]{3,10}$/).withMessage('Invalid pair format'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const pair = req.params.pair.toUpperCase();
    const pairAddress = process.env[`${pair}_POOL_ADDRESS`];
    const cacheKey = `pool:${pair}`;

    if (!pairAddress) {
      return res.status(400).json({ error: 'Invalid token pair' });
    }

    try {
      // Check Redis cache
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        return res.json(JSON.parse(cachedData));
      }

      // Fetch pool data
      const poolData = await getPoolData(pairAddress);
      const liquidityRecords = await Liquidity.find({ pair }).select('user amountA amountB timestamp');

      // Cache result
      const responseData = {
        pair,
        ...poolData,
        liquidityProviders: liquidityRecords,
      };
      await redisClient.setEx(cacheKey, 300, JSON.stringify(responseData)); // Cache for 5 minutes

      res.json(responseData);
    } catch (error) {
      logger.error(`Error fetching pool stats for ${pair}:`, error);
      res.status(500).json({ error: 'Failed to fetch pool stats' });
    }
  }
);

// Route: Get user’s liquidity contributions and rewards
router.get(
  '/user/:pair',
  limiter,
  authenticateJWT,
  [
    body('pair').matches(/^[A-Z]{3,10}-[A-Z]{3,10}$/).withMessage('Invalid pair format'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const pair = req.params.pair.toUpperCase();
    const userAddress = req.user.walletAddress;
    const pairAddress = process.env[`${pair}_POOL_ADDRESS`];

    if (!pairAddress) {
      return res.status(400).json({ error: 'Invalid token pair' });
    }

    try {
      // Fetch user’s liquidity contributions
      const contributions = await Liquidity.find({ pair, user: userAddress })
        .sort({ timestamp: -1 })
        .select('amountA amountB txHash timestamp');

      // Calculate user’s share and rewards
      const userShare = await calculateUserShare(pairAddress, userAddress);

      res.json({
        pair,
        contributions,
        ...userShare,
      });
    } catch (error) {
      logger.error(`Error fetching user liquidity for ${pair}:`, error);
      res.status(500).json({ error: 'Failed to fetch user liquidity' });
    }
  }
);

module.exports = router;
