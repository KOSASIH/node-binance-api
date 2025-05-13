import React from 'react';
import ReactDOM from 'react-dom/client';
import { Web3ReactProvider } from '@web3-react/core';
import { ethers } from 'ethers';
import { Provider as ReduxProvider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';
import store from './store'; // Redux store (optional)
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import reportWebVitals from './reportWebVitals';
import logger from './utils/logger';

// Web3React library provider
const getLibrary = (provider) => {
  const library = new ethers.providers.Web3Provider(provider);
  library.pollingInterval = 12000; // Poll every 12 seconds
  return library;
};

// Material-UI theme
const theme = createTheme({
  palette: {
    mode: 'light', // Default; toggled in App.js
    primary: { main: '#1976d2' },
    secondary: { main: '#d32f2f' },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
});

// Initialize the app
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <Web3ReactProvider getLibrary={getLibrary}>
      <ReduxProvider store={store}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <App />
        </ThemeProvider>
      </ReduxProvider>
    </Web3ReactProvider>
  </React.StrictMode>
);

// Register service worker for offline support and updates
serviceWorkerRegistration.register({
  onUpdate: (registration) => {
    const waitingServiceWorker = registration.waiting;
    if (waitingServiceWorker) {
      waitingServiceWorker.addEventListener('statechange', (event) => {
        if (event.target.state === 'activated') {
          logger.info('New service worker activated');
          window.location.reload(); // Reload to apply update
        }
      });
      waitingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
    }
  },
  onSuccess: () => {
    logger.info('Service worker registered successfully');
  },
});

// Report web vitals for performance monitoring
reportWebVitals((metric) => {
  logger.info('Web Vitals:', metric);
  // Optionally send to analytics (e.g., Google Analytics)
});

// Global error handling
window.addEventListener('error', (event) => {
  logger.error('Uncaught error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  logger.error('Unhandled promise rejection:', event.reason);
});
