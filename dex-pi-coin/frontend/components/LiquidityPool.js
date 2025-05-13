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
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
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
import { useWeb3React } from '@web3-react/core';
import { injected } from '../utils/web3React'; // MetaMask connector
import { getContractInstance } from '../utils/contractHelper';
import useWebSocket from '../hooks/useWebSocket'; // Custom WebSocket hook
import logger from '../utils/logger'; // Client-side logger

// Register Chart.js components
ChartJS.register(LineElement, PointElement, LinearScale, TimeScale, Title, Tooltip, Legend);

const LiquidityPool = () => {
  // Web3React hooks for wallet connection
  const { active, account, library, activate, deactivate } = useWeb3React();

  // State for form inputs and data
  const [pair, setPair] = useState('PICOIN-ETH');
  const [action, setAction] = useState('add'); // 'add' or 'remove'
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [liquidityAmount, setLiquidityAmount] = useState('');
  const [slippage, setSlippage] = useState(1); // Default 1%
  const [poolData, setPoolData] = useState(null);
  const [userData, setUserData] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tabValue, setTabValue] = useState(0);

  // WebSocket for real-time updates
  const { data: wsData, connect: connectWebSocket, disconnect: disconnectWebSocket } = useWebSocket(
    process.env.REACT_APP_WS_LIQUIDITY_URL || 'ws://localhost:8083'
  );

  // Available token pairs
  const tokenPairs = [
    {
      pair: 'PICOIN-ETH',
      tokenA: process.env.REACT_APP_PICOIN_ADDRESS,
      tokenB: process.env.REACT_APP_ETH_ADDRESS,
    },
    // Add more pairs as needed
  ];

  // Handle WebSocket updates
  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, [connectWebSocket, disconnectWebSocket]);

  useEffect(() => {
    if (wsData && wsData.pair === pair) {
      setPoolData(prev => ({
        ...prev,
        reserves: wsData.reserves || prev?.reserves,
        totalSupply: wsData.totalSupply || prev?.totalSupply,
      }));
      logger.info(`Received liquidity update for ${pair}`);
    }
  }, [wsData, pair]);

  // Fetch pool and user data
  const fetchPoolData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch pool stats
      const poolResponse = await axios.get(`/api/liquidity/pool/${pair}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` },
      });
      setPoolData(poolResponse.data);

      // Fetch user contributions and rewards
      if (active && account) {
        const userResponse = await axios.get(`/api/liquidity/user/${pair}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` },
        });
        setUserData(userResponse.data);
      }

      // Fetch historical liquidity data for chart (mocked or from backend)
      const chartResponse = await axios.get(`/api/liquidity/history/${pair}`, {
        params: { limit: 100 },
        headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` },
      });
      setChartData(chartResponse.data);
    } catch (err) {
      logger.error('Failed to fetch pool data:', err);
      setError(err.response?.data?.error || 'Failed to load pool data');
    } finally {
      setLoading(false);
    }
  }, [pair, active, account]);

  useEffect(() => {
    fetchPoolData();
  }, [fetchPoolData]);

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

  // Handle form submission for add/remove liquidity
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

    const selectedPair = tokenPairs.find(p => p.pair === pair);
    if (!selectedPair) {
      setError('Invalid token pair');
      setLoading(false);
      return;
    }

    try {
      const signer = library.getSigner();
      const poolContract = await getContractInstance('LiquidityPool', process.env.REACT_APP_PICOIN_ETH_POOL_ADDRESS, signer);

      if (action === 'add') {
        if (!amountA || !amountB) {
          setError('Please enter amounts for both tokens');
          setLoading(false);
          return;
        }

        // Approve tokens
        const tokenAContract = await getContractInstance('PiCoin', selectedPair.tokenA, signer);
        const tokenBContract = await getContractInstance('PiCoin', selectedPair.tokenB, signer);
        const amountAWei = ethers.utils.parseEther(amountA.toString());
        const amountBWei = ethers.utils.parseEther(amountB.toString());

        let tx = await tokenAContract.approve(process.env.REACT_APP_PICOIN_ETH_POOL_ADDRESS, amountAWei, { gasLimit: 100000 });
        await tx.wait();
        tx = await tokenBContract.approve(process.env.REACT_APP_PICOIN_ETH_POOL_ADDRESS, amountBWei, { gasLimit: 100000 });
        await tx.wait();

        // Add liquidity via backend
        const response = await axios.post(
          '/api/liquidity/add',
          {
            pair,
            amountA,
            amountB,
            tokenA: selectedPair.tokenA,
            tokenB: selectedPair.tokenB,
            maxSlippage: slippage,
          },
          { headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` } }
        );

        // Execute on-chain addLiquidity
        tx = await poolContract.addLiquidity(
          selectedPair.tokenA,
          selectedPair.tokenB,
          amountAWei,
          amountBWei,
          0,
          0,
          account,
          Math.floor(Date.now() / 1000) + 60 * 20, // Deadline: 20 minutes
          { gasLimit: 200000 }
        );

        const receipt = await tx.wait();
        setSuccess(`Liquidity added! Tx Hash: ${receipt.transactionHash}`);
        logger.info(`Liquidity added: ${receipt.transactionHash}`);
      } else {
        if (!liquidityAmount) {
          setError('Please enter liquidity amount to remove');
          setLoading(false);
          return;
        }

        // Remove liquidity via backend
        const response = await axios.post(
          '/api/liquidity/remove',
          {
            pair,
            liquidityAmount,
            tokenA: selectedPair.tokenA,
            tokenB: selectedPair.tokenB,
          },
          { headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` } }
        );

        // Execute on-chain removeLiquidity
        const liquidityWei = ethers.utils.parseEther(liquidityAmount.toString());
        const tx = await poolContract.removeLiquidity(
          selectedPair.tokenA,
          selectedPair.tokenB,
          liquidityWei,
          0,
          0,
          account,
          Math.floor(Date.now() / 1000) + 60 * 20,
          { gasLimit: 200000 }
        );

        const receipt = await tx.wait();
        setSuccess(`Liquidity removed! Tx Hash: ${receipt.transactionHash}`);
        logger.info(`Liquidity removed: ${receipt.transactionHash}`);
      }

      // Refresh data
      await fetchPoolData();
    } catch (err) {
      logger.error('Liquidity operation failed:', err);
      setError(err.response?.data?.error || 'Failed to execute liquidity operation');
    } finally {
      setLoading(false);
    }
  };

  // Handle tab change
  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  // Chart configuration for pool reserves
  const chartConfig = {
    data: {
      datasets: [
        {
          label: `${pair.split('-')[0]} Reserves`,
          data: chartData.map(d => ({ x: d.timestamp, y: d.reserve0 })),
          borderColor: '#1976d2',
          backgroundColor: 'rgba(25, 118, 210, 0.2)',
          fill: true,
        },
        {
          label: `${pair.split('-')[1]} Reserves`,
          data: chartData.map(d => ({ x: d.timestamp, y: d.reserve1 })),
          borderColor: '#d32f2f',
          backgroundColor: 'rgba(211, 47, 47, 0.2)',
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: { type: 'time', time: { unit: 'hour' }, title: { display: true, text: 'Time' } },
        y: { title: { display: true, text: 'Reserves' } },
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
        Liquidity Pool: {pair}
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      {loading && <CircularProgress sx={{ display: 'block', mx: 'auto', my: 2 }} />}
      <Tabs value={tabValue} onChange={handleTabChange} centered sx={{ mb: 3 }}>
        <Tab label="Manage Liquidity" />
        <Tab label="Pool Stats" />
        <Tab label="Your Contributions" />
        <Tab label="Reserves Chart" />
      </Tabs>
      {tabValue === 0 && (
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
            <InputLabel>Action</InputLabel>
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <MenuItem value="add">Add Liquidity</MenuItem>
              <MenuItem value="remove">Remove Liquidity</MenuItem>
            </Select>
          </FormControl>
          {action === 'add' ? (
            <>
              <TextField
                label={`Amount ${pair.split('-')[0]}`}
                type="number"
                value={amountA}
                onChange={(e) => setAmountA(e.target.value)}
                fullWidth
                required
                inputProps={{ min: 0, step: 0.0001 }}
              />
              <TextField
                label={`Amount ${pair.split('-')[1]}`}
                type="number"
                value={amountB}
                onChange={(e) => setAmountB(e.target.value)}
                fullWidth
                required
                inputProps={{ min: 0, step: 0.0001 }}
              />
              <Box>
                <Typography gutterBottom>Max Slippage (%)</Typography>
                <Slider
                  value={slippage}
                  onChange={(e, newValue) => setSlippage(newValue)}
                  min={0}
                  max={5}
                  step={0.1}
                  valueLabelDisplay="auto"
                />
              </Box>
            </>
          ) : (
            <TextField
              label="Liquidity Amount"
              type="number"
              value={liquidityAmount}
              onChange={(e) => setLiquidityAmount(e.target.value)}
              fullWidth
              required
              inputProps={{ min: 0, step: 0.0001 }}
            />
          )}
          {!active ? (
            <Button variant="contained" color="primary" onClick={connectWallet}>
              Connect Wallet
            </Button>
          ) : (
            <Button
              variant="contained"
              color="primary"
              type="submit"
              disabled={loading || (action === 'add' && (!amountA || !amountB)) || (action === 'remove' && !liquidityAmount)}
            >
              {loading ? <CircularProgress size={24} /> : action === 'add' ? 'Add Liquidity' : 'Remove Liquidity'}
            </Button>
          )}
        </Box>
      )}
      {tabValue === 1 && poolData && (
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Typography variant="h6">Pool Statistics</Typography>
            <Typography>Reserves: {poolData.reserve0} {pair.split('-')[0]} / {poolData.reserve1} {pair.split('-')[1]}</Typography>
            <Typography>Total Liquidity: {poolData.totalSupply} LP Tokens</Typography>
            <Typography>Liquidity Providers: {poolData.liquidityProviders.length}</Typography>
          </Grid>
        </Grid>
      )}
      {tabValue === 2 && userData && (
        <Box>
          <Typography variant="h6" gutterBottom>Your Contributions</Typography>
          <Typography>Pool Share: {(userData.share * 100).toFixed(2)}%</Typography>
          <Typography>Your Reserves: {userData.userReserve0} {pair.split('-')[0]} / {userData.userReserve1} {pair.split('-')[1]}</Typography>
          <Typography>Fee Share: {userData.feeShare} {pair.split('-')[1]}</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Amount A</TableCell>
                  <TableCell>Amount B</TableCell>
                  <TableCell>Tx Hash</TableCell>
                  <TableCell>Timestamp</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {userData.contributions.map((contrib, index) => (
                  <TableRow key={index}>
                    <TableCell>{contrib.amountA}</TableCell>
                    <TableCell>{contrib.amountB}</TableCell>
                    <TableCell>
                      <a href={`https://etherscan.io/tx/${contrib.txHash}`} target="_blank" rel="noopener noreferrer">
                        {contrib.txHash.slice(0, 8)}...
                      </a>
                    </TableCell>
                    <TableCell>{new Date(contrib.timestamp).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
      {tabValue === 3 && chartData.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>Reserves Chart</Typography>
          <Line data={chartConfig.data} options={chartConfig.options} />
        </Box>
      )}
    </Paper>
  );
};

export default LiquidityPool;
