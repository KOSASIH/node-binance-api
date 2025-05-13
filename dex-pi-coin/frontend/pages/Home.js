import React, { useState, useEffect } from 'react';
import { useWeb3React } from '@web3-react/core';
import { injected } from '../utils/web3React'; // MetaMask connector
import {
  Box,
  Typography,
  Button,
  Grid,
  Paper,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Link } from 'react-router-dom';
import MarketData from '../components/MarketData';
import logger from '../utils/logger';

const Home = () => {
  const { active, account, activate, deactivate } = useWeb3React();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Handle wallet connection
  const connectWallet = async () => {
    setLoading(true);
    setError('');
    try {
      await activate(injected);
      logger.info('Wallet connected:', account);
    } catch (err) {
      logger.error('Wallet connection failed:', err);
      setError('Failed to connect wallet');
    } finally {
      setLoading(false);
    }
  };

  // Handle wallet disconnection
  const disconnectWallet = async () => {
    try {
      await deactivate();
      logger.info('Wallet disconnected');
    } catch (err) {
      logger.error('Wallet disconnection failed:', err);
      setError('Failed to disconnect wallet');
    }
  };

  return (
    <Box sx={{ p: 4, maxWidth: 1400, mx: 'auto' }}>
      <Typography variant="h3" gutterBottom align="center">
        Welcome to Pi Coin DEX
      </Typography>
      <Typography variant="h6" color="textSecondary" align="center" sx={{ mb: 4 }}>
        Trade, swap, and provide liquidity with the most advanced decentralized exchange.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={6}>
          <Paper elevation={3} sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="h5" gutterBottom>
              Start Trading
            </Typography>
            <Typography variant="body1" sx={{ mb: 2 }}>
              Swap tokens or place limit orders with low fees and high liquidity.
            </Typography>
            <Button
              variant="contained"
              color="primary"
              component={Link}
              to="/trade"
              size="large"
            >
              Trade Now
            </Button>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper elevation={3} sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="h5" gutterBottom>
              Provide Liquidity
            </Typography>
            <Typography variant="body1" sx={{ mb: 2 }}>
              Earn fees by adding liquidity to our pools.
            </Typography>
            <Button
              variant="contained"
              color="primary"
              component={Link}
              to="/liquidity"
              size="large"
            >
              Add Liquidity
            </Button>
          </Paper>
        </Grid>
      </Grid>
      <Box sx={{ mb: 4, textAlign: 'center' }}>
        {!active ? (
          <Button
            variant="contained"
            color="secondary"
            onClick={connectWallet}
            disabled={loading}
            size="large"
          >
            {loading ? <CircularProgress size={24} /> : 'Connect Wallet'}
          </Button>
        ) : (
          <Box>
            <Typography variant="body1" sx={{ mb: 1 }}>
              Connected: {account.slice(0, 6)}...{account.slice(-4)}
            </Typography>
            <Button variant="outlined" color="secondary" onClick={disconnectWallet}>
              Disconnect Wallet
            </Button>
          </Box>
        )}
      </Box>
      <Typography variant="h5" gutterBottom>
        Market Overview
      </Typography>
      <MarketData />
    </Box>
  );
};

export default Home;
