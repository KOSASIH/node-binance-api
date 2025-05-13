import React, { useState, useEffect } from 'react';
import { useWeb3React } from '@web3-react/core';
import { injected } from '../utils/web3React';
import {
  Box,
  Typography,
  Grid,
  Paper,
  Alert,
  Button,
  CircularProgress,
} from '@mui/material';
import TradeForm from '../components/TradeForm';
import MarketData from '../components/MarketData';
import logger from '../utils/logger';

const Trade = () => {
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

  return (
    <Box sx={{ p: 4, maxWidth: 1400, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom>
        Trade Tokens
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!active && (
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Connect your wallet to start trading.
          </Typography>
          <Button
            variant="contained"
            color="primary"
            onClick={connectWallet}
            disabled={loading}
            size="large"
          >
            {loading ? <CircularProgress size={24} /> : 'Connect Wallet'}
          </Button>
        </Box>
      )}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper elevation={3} sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Place Order
            </Typography>
            <TradeForm />
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper elevation={3} sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Market Data
            </Typography>
            <MarketData />
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Trade;
