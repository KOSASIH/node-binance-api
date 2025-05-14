const { Server, Keypair, TransactionBuilder, Operation, Asset, Networks } = require('stellar-sdk');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../utils/logger');

async function main() {
  const server = new Server(process.env.STELLAR_HORIZON_URL);
  const keypair = Keypair.fromSecret(process.env.STELLAR_SECRET_KEY);
  const issuerAddress = keypair.publicKey(); // Starts with 'G'
  logger.info(`Deploying with issuer: ${issuerAddress}`);

  // Build contracts
  logger.info('Building contracts...');
  execSync('npm run soroban:build', { stdio: 'inherit' });

  // Deploy PiCoin
  logger.info('Deploying PiCoin contract...');
  const piCoinContractId = execSync(
    `soroban contract deploy --source-account deployer --rpc-url ${process.env.STELLAR_SOROBAN_RPC_URL} --network ${process.env.STELLAR_NETWORK} --wasm contracts/target/wasm32-unknown-unknown/release/PiCoin.wasm`,
    { encoding: 'utf8' }
  ).trim();
  logger.info(`PiCoin contract deployed: ${piCoinContractId}`);

  // Deploy DEX
  logger.info('Deploying DEX contract...');
  const dexContractId = execSync(
    `soroban contract deploy --source-account deployer --rpc-url ${process.env.STELLAR_SOROBAN_RPC_URL} --network ${process.env.STELLAR_NETWORK} --wasm contracts/target/wasm32-unknown-unknown/release/DEX.wasm`,
    { encoding: 'utf8' }
  ).trim();
  logger.info(`DEX contract deployed: ${dexContractId}`);

  // Initialize contracts (simplified; requires Soroban SDK calls)
  // TODO: Call PiCoin.initialize and DEX.initialize

  // Save addresses
  const addresses = {
    network: process.env.STELLAR_NETWORK,
    issuerAddress,
    piCoinAssetCode: process.env.PICOIN_ASSET_CODE,
    piCoinContractId,
    dexContractId,
  };
  fs.writeFileSync(path.join(__dirname, '../deployed-addresses.json'), JSON.stringify(addresses, null, 2));
  logger.info('Deployed addresses saved');

  console.log(`
    Update .env with:
    PICOIN_ISSUER_ADDRESS=${issuerAddress}
    PICOIN_SOROBAN_CONTRACT_ID=${piCoinContractId}
    DEX_SOROBAN_CONTRACT_ID=${dexContractId}
    REACT_APP_PICOIN_ISSUER_ADDRESS=${issuerAddress}
    REACT_APP_PICOIN_SOROBAN_CONTRACT_ID=${piCoinContractId}
    REACT_APP_DEX_SOROBAN_CONTRACT_ID=${dexContractId}
  `);
}

main().catch((error) => {
  logger.error('Deployment failed:', error);
  process.exit(1);
});
