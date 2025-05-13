import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Tabs,
  Tab,
  Button,
} from '@mui/material';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import 'chartjs-adapter-date-fns'; // For time-based charting
import axios from 'axios';
import useWebSocket from '../hooks/useWebSocket'; // Custom WebSocket hook
import logger from '../utils/logger'; // Client-side logger

// Register Chart.js components
ChartJS.register(LineElement, PointElement, LinearScale, TimeScale, Title, Tooltip, Legend);

const MarketData = () => {
  // State
  const [pair, setPair] = useState('PICOIN-ETH');
  const [priceData, setPriceData] = useState(null);
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [] });
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tabValue, setTabValue] = useState(0);

  // WebSocket for real-time updates
  const { data: wsData, connect: connectWebSocket, disconnect: disconnectWebSocket } = useWebSocket(
    process.env.REACT_APP_WS_URL || 'ws://localhost:8081'
  );

  // Available token pairs
  const tokenPairs = ['PICOIN-ETH', 'PICOIN-USDT']; // Extend as needed

  // Fetch market data
  const fetchMarketData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch price
      const priceResponse = await axios.get(`/api/market/price/${pair}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` },
      });
      setPriceData(priceResponse.data);

      // Fetch order book
      const orderBookResponse = await axios.get(`/api/market/orderbook/${pair}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` },
      });
      setOrderBook(orderBookResponse.data);

      // Fetch historical trades
      const tradesResponse = await axios.get(`/api/market/trades/${pair}?limit=20`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` },
      });
      setTrades(tradesResponse.data);

      // Fetch 24h stats
      const statsResponse = await axios.get(`/api/market/analytics/${pair}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` },
      });
      setStats(statsResponse.data);

      // Fetch chart data (historical klines from Binance)
      const klinesResponse = await axios.get(`/api/market/klines/${pair}`, {
        params: { interval: '1h', limit: 100 },
        headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` },
      });
      setChartData(klinesResponse.data);
    } catch (err) {
      logger.error('Failed to fetch market data:', err);
      setError(err.response?.data?.error || 'Failed to load market data');
    } finally {
      setLoading(false);
    }
  }, [pair]);

  // Handle WebSocket updates
  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, [connectWebSocket, disconnectWebSocket]);

  useEffect(() => {
    if (wsData && wsData.pair === pair) {
      setPriceData(prev => ({
        ...prev,
        onChainPrice: wsData.onChainPrice,
        binancePrice: wsData.binancePrice,
        timestamp: wsData.timestamp,
      }));
      logger.info(`Received price update for ${pair}: ${wsData.onChainPrice}`);
    }
  }, [wsData, pair]);

  // Fetch data on pair change
  useEffect(() => {
    fetchMarketData();
  }, [fetchMarketData]);

  // Handle tab change
  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  // Chart configuration
  const chartConfig = {
    data: {
      datasets: [
        {
          label: `${pair} Price`,
          data: chartData.map(k => ({ x: k.openTime, y: k.close })),
          borderColor: '#1976d2',
          backgroundColor: 'rgba(25, 118, 210, 0.2)',
          fill: true,
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: {
          type: 'time',
          time: { unit: 'hour' },
          title: { display: true, text: 'Time' },
        },
        y: { title: { display: true, text: 'Price' } },
      },
      plugins: {
        legend: { display: true },
        tooltip: { mode: 'index', intersect: false },
      },
    },
  };

  return (
    <Paper elevation={3} sx={{ p: 4, maxWidth: 1200, mx: 'auto', mt: 4, borderRadius: 2 }}>
      <Typography variant="h5" gutterBottom>
        Market Data: {pair}
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <CircularProgress sx={{ display: 'block', mx: 'auto', my: 2 }} />}
      <Box sx={{ mb: 3 }}>
        <FormControl fullWidth>
          <InputLabel>Token Pair</InputLabel>
          <Select value={pair} onChange={(e) => setPair(e.target.value)}>
            {tokenPairs.map(p => (
              <MenuItem key={p} value={p}>{p}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Tabs value={tabValue} onChange={handleTabChange} centered sx={{ mb: 3 }}>
        <Tab label="Overview" />
        <Tab label="Order Book" />
        <Tab label="Trades" />
        <Tab label="Chart" />
      </Tabs>
      {tabValue === 0 && priceData && stats && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Typography variant="h6">Price Information</Typography>
            <Typography>DEX Price: {priceData.onChainPrice} {pair.split('-')[1]}</Typography>
            <Typography>Binance Price: {priceData.binancePrice || 'N/A'} USDT</Typography>
            <Typography>Reserves: {priceData.reserves[0]} {pair.split('-')[0]} / {priceData.reserves[1]} {pair.split('-')[1]}</Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="h6">24h Statistics</Typography>
            <Typography>Volume: {stats.volume} {pair.split('-')[0]}</Typography>
            <Typography>Average Price: {stats.avgPrice} {pair.split('-')[1]}</Typography>
            <Typography>Volatility: {(stats.volatility * 100).toFixed(2)}%</Typography>
            <Typography>Trade Count: {stats.tradeCount}</Typography>
          </Grid>
        </Grid>
      )}
      {tabValue === 1 && (
        <Box>
          <Typography variant="h6" gutterBottom>Order Book</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1">Bids</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Price</TableCell>
                      <TableCell>Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {orderBook.bids.slice(0, 10).map((bid, index) => (
                      <TableRow key={index}>
                        <TableCell>{bid.price}</TableCell>
                        <TableCell>{bid.amount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1">Asks</Typography>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Price</TableCell>
                      <TableCell>Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {orderBook.asks.slice(0, 10).map((ask, index) => (
                      <TableRow key={index}>
                        <TableCell>{ask.price}</TableCell>
                        <TableCell>{ask.amount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Grid>
          </Grid>
        </Box>
      )}
      {tabValue === 2 && (
        <Box>
          <Typography variant="h6" gutterBottom>Recent Trades</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Price</TableCell>
                  <TableCell>Amount</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Timestamp</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {trades.map((trade, index) => (
                  <TableRow key={index}>
                    <TableCell>{trade.price}</TableCell>
                    <TableCell>{trade.amount}</TableCell>
                    <TableCell>{trade.type}</TableCell>
                    <TableCell>{new Date(trade.timestamp).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
      {tabValue === 3 && chartData.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>Price Chart</Typography>
          <Line data={chartConfig.data} options={chartConfig.options} />
        </Box>
      )}
      <Button variant="contained" onClick={fetchMarketData} sx={{ mt: 2 }} disabled={loading}>
        Refresh Data
      </Button>
    </Paper>
  );
};

export default MarketData;
