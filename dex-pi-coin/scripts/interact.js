const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const logger = require("../utils/logger");

async function main() {
  // Load deployed addresses
  const addressesPath = path.join(__dirname, "../deployed-addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("Deployed addresses not found. Run deploy.js first.");
  }
  const { PiCoin, DEX, LiquidityPool } = JSON.parse(fs.readFileSync(addressesPath));
  logger.info(`Interacting with contracts on ${hre.network.name}`);
  logger.info(`PiCoin: ${PiCoin}, DEX: ${DEX}, LiquidityPool: ${LiquidityPool}`);

  // Get signer
  const [signer] = await hre.ethers.getSigners();
  const signerAddress = await signer.getAddress();
  logger.info(`Using signer: ${signerAddress}`);

  // Get contract instances
  const piCoin = await hre.ethers.getContractAt("PiCoin", PiCoin, signer);
  const dex = await hre.ethers.getContractAt("DEX", DEX, signer);
  const liquidityPool = await hre.ethers.getContractAt("LiquidityPool", LiquidityPool, signer);

  // Interaction functions
  const interactions = {
    // Add liquidity to PiCoin-ETH pool
    async addLiquidity(amountA, amountB) {
      logger.info(`Adding liquidity: ${amountA} PiCoin, ${amountB} ETH`);
      const amountAWei = ethers.utils.parseEther(amountA.toString());
      const amountBWei = ethers.utils.parseEther(amountB.toString());

      // Approve PiCoin
      let tx = await piCoin.approve(LiquidityPool, amountAWei);
      await tx.wait();
      logger.info("PiCoin approved");

      // Add liquidity
      tx = await liquidityPool.addLiquidity(
        PiCoin,
        ethers.constants.AddressZero,
        amountAWei,
        amountBWei,
        0, // minAmountA
        0, // minAmountB
        signerAddress,
        Math.floor(Date.now() / 1000) + 60 * 20, // Deadline: 20 minutes
        { value: amountBWei, gasLimit: 300000 }
      );
      const receipt = await tx.wait();
      logger.info(`Liquidity added: Tx Hash ${receipt.transactionHash}`);
      return receipt;
    },

    // Swap PiCoin for ETH
    async swapPiCoinForETH(amountIn) {
      logger.info(`Swapping ${amountIn} PiCoin for ETH`);
      const amountInWei = ethers.utils.parseEther(amountIn.toString());

      // Approve PiCoin
      let tx = await piCoin.approve(DEX, amountInWei);
      await tx.wait();
      logger.info("PiCoin approved for swap");

      // Swap
      tx = await dex.swapExactTokensForTokens(
        amountInWei,
        0, // minAmountOut
        [PiCoin, ethers.constants.AddressZero],
        signerAddress,
        Math.floor(Date.now() / 1000) + 60 * 20,
        { gasLimit: 200000 }
      );
      const receipt = await tx.wait();
      logger.info(`Swap completed: Tx Hash ${receipt.transactionHash}`);
      return receipt;
    },

    // Place limit order
    async placeLimitOrder(isBuy, amount, price) {
      logger.info(`Placing ${isBuy ? 'buy' : 'sell'} limit order: ${amount} PiCoin at ${price} ETH`);
      const amountWei = ethers.utils.parseEther(amount.toString());
      const priceWei = ethers.utils.parseEther(price.toString());

      // Approve PiCoin for sell orders
      if (!isBuy) {
        let tx = await piCoin.approve(DEX, amountWei);
        await tx.wait();
        logger.info("PiCoin approved for limit order");
      }

      // Place order
      const tx = await dex.placeLimitOrder(
        PiCoin,
        ethers.constants.AddressZero,
        amountWei,
        priceWei,
        isBuy,
        { gasLimit: 200000, value: isBuy ? amountWei : 0 }
      );
      const receipt = await tx.wait();
      logger.info(`Limit order placed: Tx Hash ${receipt.transactionHash}`);
      return receipt;
    },

    // Query pool reserves
    async getPoolReserves() {
      const [reserveA, reserveB] = await liquidityPool.getReserves();
      logger.info(`Pool reserves: ${ethers.utils.formatEther(reserveA)} PiCoin, ${ethers.utils.formatEther(reserveB)} ETH`);
      return { reserveA, reserveB };
    },

    // Query user balance
    async getUserBalance() {
      const piCoinBalance = await piCoin.balanceOf(signerAddress);
      const ethBalance = await signer.getBalance();
      logger.info(`User balance: ${ethers.utils.formatEther(piCoinBalance)} PiCoin, ${ethers.utils.formatEther(ethBalance)} ETH`);
      return { piCoinBalance, ethBalance };
    },
  };

  // Example interactions (uncomment to run)
  try {
    // Add liquidity
    await interactions.addLiquidity(100, 0.1); // 100 PiCoin, 0.1 ETH

    // Swap tokens
    await interactions.swapPiCoinForETH(10); // 10 PiCoin for ETH

    // Place buy limit order
    await interactions.placeLimitOrder(true, 50, 0.01); // Buy 50 PiCoin at 0.01 ETH

    // Query reserves
    await interactions.getPoolReserves();

    // Query balance
    await interactions.getUserBalance();
  } catch (error) {
    logger.error("Interaction failed:", error.message);
  }

  // Export interactions for external use
  return interactions;
}

main()
  .then((interactions) => {
    logger.info("Interaction script completed");
    // Keep process alive for manual testing
    // process.exit(0);
  })
  .catch((error) => {
    logger.error("Interaction script failed:", error);
    process.exit(1);
  });

module.exports = main;
