import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Web3ReactProvider } from '@web3-react/core';
import { ethers } from 'ethers';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemText,
  Box,
  CssBaseline,
  useMediaQuery,
  Switch,
  Alert,
  Snackbar,
} from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import Home from './pages/Home';
import Trade from './pages/Trade';
import Liquidity from './pages/Liquidity';
import { injected } from './utils/web3React'; // MetaMask connector
import logger from './utils/logger';
import useWebSocket from './hooks/useWebSocket'; // Custom WebSocket hook

// Error Boundary Component
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logger.error('Application error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h5" color="error">
            Something went wrong.
          </Typography>
          <Typography variant="body1" sx={{ mt: 2 }}>
            Please try refreshing the page or contact support.
          </Typography>
          <Button
            variant="contained"
            color="primary"
            onClick={() => window.location.reload()}
            sx={{ mt: 2 }}
          >
            Refresh
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

const App = () => {
  // Web3React hooks for wallet
  const { active, account, activate, deactivate } = useWeb3React();

  // State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [notification, setNotification] = useState({ open: false, message: '', severity: 'info' });
  const isMobile = useMediaQuery('(max-width:600px)');

  // WebSocket for global server events
  const { data: wsData, connect: connectWebSocket, disconnect: disconnectWebSocket } = useWebSocket(
    process.env.REACT_APP_WS_SERVER_URL || 'ws://localhost:3000'
  );

  // Theme configuration
  const theme = createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: { main: '#1976d2' },
      secondary: { main: '#d32f2f' },
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    },
  });

  // Handle WebSocket server events
  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, [connectWebSocket, disconnectWebSocket]);

  useEffect(() => {
    if (wsData && wsData.type === 'server') {
      setNotification({
        open: true,
        message: `Server: ${wsData.event} at ${new Date(wsData.timestamp).toLocaleString()}`,
        severity: wsData.event === 'server_shutdown' ? 'warning' : 'info',
      });
    }
  }, [wsData]);

  // Handle wallet connection
  const connectWallet = useCallback(async () => {
    try {
      await activate(injected);
      logger.info('Wallet connected:', account);
      setNotification({ open: true, message: 'Wallet connected successfully', severity: 'success' });
    } catch (err) {
      logger.error('Wallet connection failed:', err);
      setNotification({ open: true, message: 'Failed to connect wallet', severity: 'error' });
    }
  }, [activate, account]);

  // Handle wallet disconnection
  const disconnectWallet = useCallback(async () => {
    try {
      await deactivate();
      logger.info('Wallet disconnected');
      setNotification({ open: true, message: 'Wallet disconnected', severity: 'info' });
    } catch (err) {
      logger.error('Wallet disconnection failed:', err);
      setNotification({ open: true, message: 'Failed to disconnect wallet', severity: 'error' });
    }
  }, [deactivate]);

  // Toggle theme
  const toggleTheme = () => {
    setDarkMode(!darkMode);
    logger.info(`Theme switched to ${!darkMode ? 'dark' : 'light'} mode`);
  };

  // Toggle drawer
  const toggleDrawer = (open) => (event) => {
    if (event.type === 'keydown' && (event.key === 'Tab' || event.key === 'Shift')) {
      return;
    }
    setDrawerOpen(open);
  };

  // Navigation items
  const navItems = [
    { text: 'Home', path: '/' },
    { text: 'Trade', path: '/trade' },
    { text: 'Liquidity', path: '/liquidity' },
  ];

  // Drawer content
  const drawerContent = (
    <Box sx={{ width: 250 }} role="presentation" onClick={toggleDrawer(false)} onKeyDown={toggleDrawer(false)}>
      <List>
        {navItems.map((item) => (
          <ListItem key={item.text} component={Link} to={item.path} sx={{ color: 'inherit', textDecoration: 'none' }}>
            <ListItemText primary={item.text} />
          </ListItem>
        ))}
      </List>
    </Box>
  );

  // Handle notification close
  const handleNotificationClose = (event, reason) => {
    if (reason === 'clickaway') return;
    setNotification({ ...notification, open: false });
  };

  return (
    <Web3ReactProvider getLibrary={(provider) => new ethers.providers.Web3Provider(provider)}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Router>
          <ErrorBoundary>
            <AppBar position="sticky">
              <Toolbar>
                <IconButton
                  color="inherit"
                  edge="start"
                  onClick={toggleDrawer(true)}
                  sx={{ mr: 2, display: { sm: 'none' } }}
                >
                  <MenuIcon />
                </IconButton>
                <Typography variant="h6" sx={{ flexGrow: 1 }}>
                  Pi Coin DEX
                </Typography>
                <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
                  {navItems.map((item) => (
                    <Button
                      key={item.text}
                      color="inherit"
                      component={Link}
                      to={item.path}
                      sx={{ mx: 1 }}
                    >
                      {item.text}
                    </Button>
                  ))}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <IconButton onClick={toggleTheme} color="inherit">
                    {darkMode ? <Brightness7Icon /> : <Brightness4Icon />}
                  </IconButton>
                  {!active ? (
                    <Button color="inherit" onClick={connectWallet}>
                      Connect Wallet
                    </Button>
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Typography variant="body2" sx={{ mr: 2 }}>
                        {account.slice(0, 6)}...{account.slice(-4)}
                      </Typography>
                      <Button color="inherit" onClick={disconnectWallet}>
                        Disconnect
                      </Button>
                    </Box>
                  )}
                </Box>
              </Toolbar>
            </AppBar>
            <Drawer anchor="left" open={drawerOpen} onClose={toggleDrawer(false)}>
              {drawerContent}
            </Drawer>
            <Snackbar
              open={notification.open}
              autoHideDuration={6000}
              onClose={handleNotificationClose}
            >
              <Alert
                onClose={handleNotificationClose}
                severity={notification.severity}
                sx={{ width: '100%' }}
              >
                {notification.message}
              </Alert>
            </Snackbar>
            <Box sx={{ minHeight: 'calc(100vh - 64px)' }}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/trade" element={<Trade />} />
                <Route path="/liquidity" element={<Liquidity />} />
                <Route path="*" element={<Typography variant="h5" sx={{ p: 4 }}>404 - Page Not Found</Typography>} />
              </Routes>
            </Box>
            <Box sx={{ p: 2, textAlign: 'center', bgcolor: 'background.paper' }}>
              <Typography variant="body2" color="textSecondary">
                © {new Date().getFullYear()} Pi Coin DEX. All rights reserved.
              </Typography>
            </Box>
          </ErrorBoundary>
        </Router>
      </ThemeProvider>
    </Web3ReactProvider>
  );
};

export default App;
