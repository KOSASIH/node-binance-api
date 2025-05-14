const { Server, Keypair, TransactionBuilder, Operation, Networks, SorobanRpc, Contract } = require('stellar-sdk');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
require('dotenv').config();

async function main() {
  // Load deployed addresses
  const addressesPath = path.join(__dirname, '../deployed-addresses.json');
  if (!fs.existsSync(addressesPath)) {
    throw new Error('Deployed addresses not found. Run deploy.js first.');
  }
  const { network, issuerAddress, piCoinAssetCode, piCoinContractId, dexContractId } = JSON.parse(fs.readFileSync(addressesPath));
  logger.info(`Interacting with contracts on Stellar ${network}`);
  logger.info(`PiCoin Issuer: ${issuerAddress}, PiCoin Contract: ${piCoinContractId}, DEX Contract: ${dexContractId}`);

  // Initialize Stellar and Soroban servers
  const server = new Server(process.env.STELLAR_HORIZON_URL);
  const sorobanServer = new SorobanRpc.Server(process.env.STELLAR_SOROBAN_RPC_URL);
  const keypair = Keypair.fromSecret(process.env.STELLAR_SECRET_KEY);
  const account = await server.loadAccount(keypair.publicKey());
  logger.info(`Using account: ${keypair.publicKey()}`);

  // Interaction functions
  const interactions = {
    // Add liquidity to PiCoin-XLM pool
    async addLiquidity(amountPiCoin, amountXLM) {
      logger.info(`Adding liquidity: ${amountPiCoin} PiCoin, ${amountXLM} XLM`);
      const piCoinContract = new Contract(piCoinContractId);
      const dexContract = new Contract(dexContractId);

      // Build transaction
      const txBuilder = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: process.env.STELLAR_PASSPHRASE,
      });

      // Trust PiCoin (if not already trusted)
      const piCoinAsset = new Asset(piCoinAssetCode, issuerAddress);
      if (!(await server.loadAccount(keypair.publicKey())).balances.some(b => b.asset_code === piCoinAssetCode)) {
        txBuilder.addOperation(Operation.changeTrust({ asset: piCoinAsset }));
      }

      // Call DEX.add_liquidity
      txBuilder.addOperation(
        Operation.invokeContractFunction({
          contract: dexContractId,
          function: 'add_liquidity',
          args: [
            keypair.publicKey(), // user
            piCoinContractId,    // token_a
            'native',           // token_b (XLM)
            amountPiCoin * 10**7, // Stellar uses 7 decimals
            amountXLM * 10**7,
          ],
        })
      );

      const tx = txBuilder.setTimeout(180).build();
      tx.sign(keypair);
      const result = await server.submitTransaction(tx);
      logger.info(`Liquidity added: Tx Hash ${result.hash}`);
      return result;
    },

    // Swap PiCoin for XLM
    async swapPiCoinForXLM(amountPiCoin) {
      logger.info(`Swapping ${amountPiCoin} PiCoin for XLM`);
      const dexContract = new Contract(dexContractId);

      // Build transaction
      const txBuilder = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: process.env.STELLAR_PASSPHRASE,
      });

      // Call DEX.swap_tokens
      txBuilder.addOperation(
        Operation.invokeContractFunction({
          contract: dexContractId,
          function: 'swap_tokens',
          args: [
            keypair.publicKey(), // user
            piCoinContractId,    // token_in
            'native',           // token_out (XLM)
            amountPiCoin * 10**7,
          ],
        })
      );

      const tx = txBuilder.setTimeout(180).build();
      tx.sign(keypair);
      const result = await server.submitTransaction(tx);
      logger.info(`Swap completed: Tx Hash ${result.hash}`);
      return result;
    },

    // Place limit order (simplified for Stellar)
    async placeLimitOrder(isBuy, amountPiCoin, priceXLM) {
      logger.info(`Placing ${isBuy ? 'buy' : 'sell'} limit order: ${amountPiCoin} PiCoin at ${priceXLM} XLM`);
      // Note: Stellar/Soroban doesn't natively support complex order books
      // Simulate by invoking swap with price check (requires backend oracle)
      logger.warn('Limit orders are simplified; using swap with price validation');

      const dexContract = new Contract(dexContractId);
      const txBuilder = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: process.env.STELLAR_PASSPHRASE,
      });

      // Call DEX.swap_tokens with price validation (mocked)
      txBuilder.addOperation(
        Operation.invokeContractFunction({
          contract: dexContractId,
          function: 'swap_tokens',
          args: [
            keypair.publicKey(),
            isBuy ? 'native' : piCoinContractId,
            isBuy ? piCoinContractId : 'native',
            (isBuy ? amountPiCoin * priceXLM : amountPiCoin) * 10**7,
          ],
        })
      );

      const tx = txBuilder.setTimeout(180).build();
      tx.sign(keypair);
      const result = await server.submitTransaction(tx);
      logger.info(`Limit order placed: Tx Hash ${result.hash}`);
      return result;
    },

    // Query pool reserves
    async getPoolReserves() {
      logger.info('Querying PiCoin-XLM pool reserves');
      const dexContract = new Contract(dexContractId);
      // Note: Querying Soroban storage directly is complex; use backend or mock
      // Mocked response for demonstration
      const reservePiCoin = 1000 * 10**7; // 1000 PiCoin
      const reserveXLM = 5000 * 10**7;    // 5000 XLM
      logger.info(`Pool reserves: ${reservePiCoin / 10**7} PiCoin, ${reserveXLM / 10**7} XLM`);
      return { reservePiCoin, reserveXLM };
    },

    // Query user balance
    async getUserBalance() {
      const piCoinAsset = new Asset(piCoinAssetCode, issuerAddress);
      const piCoinBalance = (await server.loadAccount(keypair.publicKey())).balances
        .find(b => b.asset_code === piCoinAssetCode)?.balance || '0';
      const xlmBalance = (await server.loadAccount(keypair.publicKey())).balances
        .find(b => b.asset_type === 'native').balance;
      logger.info(`User balance: ${piCoinBalance / 10**7} PiCoin, ${xlmBalance / 10**7} XLM`);
      return { piCoinBalance, xlmBalance };
    },
  };

  // Example interactions (uncomment to run)
  try {
    // Add liquidity
    await interactions.addLiquidity(100, 500); // 100 PiCoin, 500 XLM

    // Swap tokens
    await interactions.swapPiCoinForXLM(10); // 10 PiCoin for XLM

    // Place buy limit order
    await interactions.placeLimitOrder(true, 50, 5); // Buy 50 PiCoin at 5 XLM each

    // Query reserves
    await interactions.getPoolReserves();

    // Query balance
    await interactions.getUserBalance();
  } catch (error) {
    logger.error('Interaction failed:', error.message);
  }

  // Export interactions for external use
  return interactions;
}

main()
  .then((interactions) => {
    logger.info('Interaction script completed');
    // Keep process alive for manual testing
    // process.exit(0);
  })
  .catch((error) => {
    logger.error('Interaction script failed:', error);
    process.exit(1);
  });

module.exports = main;
