<p xmlns:cc="http://creativecommons.org/ns#" xmlns:dct="http://purl.org/dc/terms/"><a property="dct:title" rel="cc:attributionURL" href="https://github.com/KOSASIH/node-binance-api/tree/main/dex-pi-coin">DEX Pi Coin</a> by <a rel="cc:attributionURL dct:creator" property="cc:attributionName" href="https://www.linkedin.com/in/kosasih-81b46b5a">KOSASIH</a> is licensed under <a href="https://creativecommons.org/licenses/by/4.0/?ref=chooser-v1" target="_blank" rel="license noopener noreferrer" style="display:inline-block;">Creative Commons Attribution 4.0 International<img style="height:22px!important;margin-left:3px;vertical-align:text-bottom;" src="https://mirrors.creativecommons.org/presskit/icons/cc.svg?ref=chooser-v1" alt=""><img style="height:22px!important;margin-left:3px;vertical-align:text-bottom;" src="https://mirrors.creativecommons.org/presskit/icons/by.svg?ref=chooser-v1" alt=""></a></p>


# Decentralized Exchange (DEX) for Pi Coin

## Overview
This project implements a decentralized exchange (DEX) that allows users to trade Pi Coin against other cryptocurrencies. The DEX utilizes smart contracts for secure trading, integrates with the Binance API for real-time market data, and features liquidity pools for Pi Coin.

## Project Structure

```
/dex-pi-coin
│
├── /contracts
│   ├── PiCoin.sol          # Smart contract for Pi Coin
│   ├── DEX.sol             # Smart contract for the DEX
│   └── LiquidityPool.sol    # Smart contract for managing liquidity pools
│
├── /backend
│   ├── /controllers
│   │   ├── marketController.js  # Controller for market data
│   │   ├── tradeController.js   # Controller for trade operations
│   │   └── liquidityController.js # Controller for liquidity management
│   ├── /models
│   │   ├── User.js             # User model for MongoDB
│   │   ├── Trade.js            # Trade model for MongoDB
│   │   └── Liquidity.js        # Liquidity model for MongoDB
│   ├── /routes
│   │   ├── marketRoutes.js      # Routes for market data
│   │   ├── tradeRoutes.js       # Routes for trade operations
│   │   └── liquidityRoutes.js    # Routes for liquidity management
│   ├── server.js                # Main server file
│   └── binanceAPI.js           # Module for interacting with the Binance API
│
├── /frontend
│   ├── /components
│   │   ├── TradeForm.js         # Component for trading form
│   │   ├── MarketData.js        # Component for displaying market data
│   │   └── LiquidityPool.js     # Component for managing liquidity pools
│   ├── /pages
│   │   ├── Home.js              # Home page component
│   │   ├── Trade.js             # Trade page component
│   │   └── Liquidity.js         # Liquidity management page component
│   ├── App.js                   # Main application component
│   └── index.js                 # Entry point for the frontend application
│
├── /scripts
│   ├── deploy.js                # Script for deploying smart contracts
│   └── interact.js              # Script for interacting with deployed contracts
│
├── .env                         # Environment variables
├── package.json                 # Project dependencies and scripts
└── README.md                    # Project documentation
```

## Features

- **Real-Time Market Data**: Fetches market data using the Binance API, providing users with up-to-date information on cryptocurrency prices and trading volumes.

- **Smart Contracts**: Implements smart contracts for Pi Coin, the DEX, and liquidity pools to ensure secure and trustless trading.

- **Liquidity Pools**: Allows users to provide liquidity for Pi Coin, enabling seamless trading and reducing slippage.

- **User  Management**: Includes user authentication and management through a MongoDB database.

- **Trade Execution**: Facilitates the execution of trades through a user-friendly interface.

## Getting Started

### Prerequisites
- Node.js and npm installed on your machine.
- MongoDB for data storage.
- An Ethereum wallet (e.g., MetaMask) for interacting with the smart contracts.

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/KOSASIH/node-binance-api.git
   cd node-binance-api/dex-pi-coin
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add the following variables:
   ```plaintext
   BINANCE_API_KEY=your_binance_api_key
   BINANCE_API_SECRET=your_binance_api_secret
   MONGODB_URI=your_mongodb_uri
   JWT_SECRET=your_jwt_secret
   ```

### Running the Application
1. Start the backend server:
   ```bash
   node backend/server.js
   ```

2. Start the frontend application:
   ```bash
   cd frontend
   npm start
   ```

3. Interact with the DEX through the user interface or API endpoints.

### Usage
- **Trading**: Users can connect their wallets, view market data, and execute trades for Pi Coin against other cryptocurrencies.
- **Liquidity Management**: Users can add or remove liquidity for Pi Coin and earn rewards based on their contributions.

## Scripts
- **Deploy Contracts**: Use the `deploy.js` script to deploy the smart contracts to the blockchain.
- **Interact with Contracts** : Use the `interact.js` script to interact with the deployed smart contracts, allowing users to perform actions such as trading and managing liquidity.

## Contributing
Contributions are encouraged! If you have suggestions for improvements or find bugs, please submit a pull request or open an issue in the repository.

## License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.

## Acknowledgments
- Thanks to the Binance API for providing essential market data.
- Appreciation to the Ethereum community for their contributions to smart contract development and decentralized applications.
