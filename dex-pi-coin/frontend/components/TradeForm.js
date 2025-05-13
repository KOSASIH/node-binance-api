import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import {
  Box,
  Button,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Typography,
  CircularProgress,
  Alert,
  Slider,
  Paper,
} from '@mui/material';
import axios from 'axios';
import { useWeb3React } from '@web3-react/core';
import { injected } from '../utils/web3React'; // MetaMask connector
import { getContractInstance } from '../utils/contractHelper';
import useWebSocket from '../hooks/useWebSocket'; // Custom hook for WebSocket
import logger from '../utils/logger'; // Client-side logger

const TradeForm = () => {
  // Web3React hooks for wallet connection
  const { active, account, library, activate, deactivate } = useWeb3React();

  // State for form inputs
  const [pair, setPair] = useState('PICOIN-ETH');
  const [orderType, setOrderType] = useState('market');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [slippage, setSlippage] = useState(1); // Default 1%
  const [tradeType, setTradeType] = useState('buy');
  const [tokenIn, setTokenIn] = useState('');
  const [tokenOut, setTokenOut] = useState('');
  const [currentPrice, setCurrentPrice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // WebSocket for real-time price updates
  const { data: wsData, connect: connectWebSocket, disconnect: disconnectWebSocket } = useWebSocket(
    process.env.REACT_APP_WS_URL || 'ws://localhost:8081'
  );

  // Available token pairs (extend as needed)
  const tokenPairs = [
    { pair: 'PICOIN-ETH', tokenIn: process.env.REACT_APP_PICOIN_ADDRESS, tokenOut: process.env.REACT_APP_ETH_ADDRESS },
    // Add more pairs as needed
  ];

  // Handle WebSocket price updates
  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, [connectWebSocket, disconnectWebSocket]);

  useEffect(() => {
    if (wsData && wsData.pair === pair) {
      setCurrentPrice(wsData.onChainPrice);
      logger.info(`Received price update for ${pair}: ${wsData.onChainPrice}`);
    }
  }, [wsData, pair]);

  // Fetch initial price from backend
  const fetchPrice = useCallback(async () => {
    try {
      const response = await axios.get(`/api/market/price/${pair}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` },
      });
      setCurrentPrice(response.data.onChainPrice);
    } catch (err) {
      logger.error('Failed to fetch price:', err);
      setError('Failed to fetch current price');
    }
  }, [pair]);

  useEffect(() => {
    fetchPrice();
  }, [fetchPrice]);

  // Handle wallet connection
  const connectWallet = async () => {
    try {
      await activate(injected);
      logger.info('Wallet connected:', account);
    } catch (err) {
      logger.error('Wallet connection failed:', err);
      setError('Failed to connect wallet');
    }
  };

  // Handle form submission for trade
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (!active || !account) {
      setError('Please connect your wallet');
      setLoading(false);
      return;
    }

    if (!amount || (orderType === 'limit' && !price)) {
      setError('Please fill in all required fields');
      setLoading(false);
      return;
    }

    try {
      const signer = library.getSigner();
      const dexContract = await getContractInstance('DEX', process.env.REACT_APP_DEX_ADDRESS, signer);

      // Get selected pair details
      const selectedPair = tokenPairs.find(p => p.pair === pair);
      if (!selectedPair) {
        setError('Invalid token pair');
        setLoading(false);
        return;
      }

      if (orderType === 'market') {
        // Market order (swap)
        const amountInWei = ethers.utils.parseEther(amount.toString());
        const response = await axios.post(
          '/api/trade/swap',
          {
            pair,
            amountIn: amount,
            tokenIn: tradeType === 'buy' ? selectedPair.tokenOut : selectedPair.tokenIn,
            tokenOut: tradeType === 'buy' ? selectedPair.tokenIn : selectedPair.tokenOut,
            maxSlippage: slippage,
          },
          { headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` } }
        );

        // Execute on-chain swap (assumes token approval done in frontend)
        const tx = await dexContract.swapExactTokensForTokens(
          amountInWei,
          0, // Min amount out
          [tradeType === 'buy' ? selectedPair.tokenOut : selectedPair.tokenIn, tradeType === 'buy' ? selectedPair.tokenIn : selectedPair.tokenOut],
          account,
          Math.floor(Date.now() / 1000) + 60 * 20, // Deadline: 20 minutes
          { gasLimit: 200000 }
        );

        const receipt = await tx.wait();
        setSuccess(`Swap successful! Tx Hash: ${receipt.transactionHash}`);
        logger.info(`Swap executed: ${receipt.transactionHash}`);
      } else {
        // Limit order
        const amountInWei = ethers.utils.parseEther(amount.toString());
        const priceInWei = ethers.utils.parseEther(price.toString());

        const response = await axios.post(
          '/api/trade/limit-order',
          {
            pair,
            amount,
            price,
            type: tradeType,
            tokenIn: tradeType === 'buy' ? selectedPair.tokenOut : selectedPair.tokenIn,
            tokenOut: tradeType === 'buy' ? selectedPair.tokenIn : selectedPair.tokenOut,
          },
          { headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` } }
        );

        // Execute on-chain limit order (if supported by DEX.sol)
        const tx = await dexContract.placeLimitOrder(
          tradeType === 'buy' ? selectedPair.tokenOut : selectedPair.tokenIn,
          tradeType === 'buy' ? selectedPair.tokenIn : selectedPair.tokenOut,
          amountInWei,
          priceInWei,
          tradeType === 'buy',
          { gasLimit: 200000 }
        );

        const receipt = await tx.wait();
        setSuccess(`Limit order placed! Order ID: ${response.data.orderId}, Tx Hash: ${receipt.transactionHash}`);
        logger.info(`Limit order placed: ${response.data.orderId}`);
      }
    } catch (err) {
      logger.error('Trade execution failed:', err);
      setError(err.response?.data?.error || 'Failed to execute trade');
    } finally {
      setLoading(false);
    }
  };

  // Handle token approval
  const handleApprove = async () => {
    if (!active || !account) {
      setError('Please connect your wallet');
      return;
    }

    setLoading(true);
    try {
      const signer = library.getSigner();
      const tokenContract = await getContractInstance('PiCoin', process.env.REACT_APP_PICOIN_ADDRESS, signer);
      const amountInWei = ethers.utils.parseEther(amount.toString());

      const tx = await tokenContract.approve(process.env.REACT_APP_DEX_ADDRESS, amountInWei, { gasLimit: 100000 });
      const receipt = await tx.wait();
      setSuccess(`Token approved! Tx Hash: ${receipt.transactionHash}`);
      logger.info(`Token approved: ${receipt.transactionHash}`);
    } catch (err) {
      logger.error('Token approval failed:', err);
      setError('Failed to approve token');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper elevation={3} sx={{ p: 4, maxWidth: 600, mx: 'auto', mt: 4, borderRadius: 2 }}>
      <Typography variant="h5" gutterBottom>
        Trade Tokens
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <FormControl fullWidth>
          <InputLabel>Token Pair</InputLabel>
          <Select value={pair} onChange={(e) => setPair(e.target.value)}>
            {tokenPairs.map(p => (
              <MenuItem key={p.pair} value={p.pair}>{p.pair}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel>Order Type</InputLabel>
          <Select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
            <MenuItem value="market">Market Order</MenuItem>
            <MenuItem value="limit">Limit Order</MenuItem>
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel>Trade Type</InputLabel>
          <Select value={tradeType} onChange={(e) => setTradeType(e.target.value)}>
            <MenuItem value="buy">Buy</MenuItem>
            <MenuItem value="sell">Sell</MenuItem>
          </Select>
        </FormControl>
        <TextField
          label="Amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          fullWidth
          required
          inputProps={{ min: 0, step: 0.0001 }}
        />
        {orderType === 'limit' && (
          <TextField
            label="Price"
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            fullWidth
            required
            inputProps={{ min: 0, step: 0.0001 }}
          />
        )}
        <Box>
          <Typography gutterBottom>Max Slippage (%)</Typography>
          <Slider
            value={slippage}
            onChange={(e, newValue) => setSlippage(newValue)}
            min={0}
            max={10}
            step={0.1}
            valueLabelDisplay="auto"
          />
        </Box>
        {currentPrice && (
          <Typography variant="body2" color="textSecondary">
            Current Price: {currentPrice} {pair.split('-')[1]}
          </Typography>
        )}
        {!active ? (
          <Button variant="contained" color="primary" onClick={connectWallet}>
            Connect Wallet
          </Button>
        ) : (
          <>
            <Button
              variant="contained"
              color="secondary"
              onClick={handleApprove}
              disabled={loading || !amount}
              sx={{ mb: 2 }}
            >
              {loading ? <CircularProgress size={24} /> : 'Approve Token'}
            </Button>
            <Button
              variant="contained"
              color="primary"
              type="submit"
              disabled={loading || !amount || (orderType === 'limit' && !price)}
            >
              {loading ? <CircularProgress size={24} /> : `Place ${orderType.charAt(0).toUpperCase() + orderType.slice(1)} Order`}
            </Button>
          </>
        )}
      </Box>
    </Paper>
  );
};

export default TradeForm;
