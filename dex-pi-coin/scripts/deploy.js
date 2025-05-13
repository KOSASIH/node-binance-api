const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const logger = require("../utils/logger"); // Shared logger

async function main() {
  // Get network and signer
  const [deployer] = await hre.ethers.getSigners();
  const networkName = hre.network.name;
  const deployerAddress = await deployer.getAddress();
  logger.info(`Deploying contracts to ${networkName} with account: ${deployerAddress}`);

  // Deployment configuration
  const config = {
    piCoin: {
      name: "PiCoin",
      symbol: "PICOIN",
      initialSupply: ethers.utils.parseEther("1000000"), // 1M tokens
    },
    dex: {
      fee: 30, // 0.3% fee (30 basis points)
    },
    liquidityPool: {
      tokenA: null, // Set after PiCoin deployment
      tokenB: ethers.constants.AddressZero, // ETH (or WETH for non-Ethereum chains)
    },
  };

  // Deploy PiCoin
  logger.info("Deploying PiCoin...");
  const PiCoin = await hre.ethers.getContractFactory("PiCoin");
  const piCoin = await PiCoin.deploy(
    config.piCoin.name,
    config.piCoin.symbol,
    config.piCoin.initialSupply
  );
  await piCoin.deployed();
  logger.info(`PiCoin deployed to: ${piCoin.address}`);

  // Deploy DEX
  logger.info("Deploying DEX...");
  const DEX = await hre.ethers.getContractFactory("DEX");
  const dex = await DEX.deploy(config.dex.fee);
  await dex.deployed();
  logger.info(`DEX deployed to: ${dex.address}`);

  // Set tokenA for LiquidityPool (PiCoin)
  config.liquidityPool.tokenA = piCoin.address;

  // Deploy LiquidityPool (PiCoin-ETH pair)
  logger.info("Deploying LiquidityPool...");
  const LiquidityPool = await hre.ethers.getContractFactory("LiquidityPool");
  const liquidityPool = await LiquidityPool.deploy(
    config.liquidityPool.tokenA,
    config.liquidityPool.tokenB,
    dex.address
  );
  await liquidityPool.deployed();
  logger.info(`LiquidityPool (PiCoin-ETH) deployed to: ${liquidityPool.address}`);

  // Initialize DEX with LiquidityPool
  logger.info("Initializing DEX with LiquidityPool...");
  const tx = await dex.addPool(piCoin.address, ethers.constants.AddressZero, liquidityPool.address);
  await tx.wait();
  logger.info("DEX initialized with PiCoin-ETH pool");

  // Save deployed addresses
  const addresses = {
    network: networkName,
    deployer: deployerAddress,
    PiCoin: piCoin.address,
    DEX: dex.address,
    LiquidityPool: liquidityPool.address,
    timestamp: new Date().toISOString(),
  };
  const outputPath = path.join(__dirname, "../deployed-addresses.json");
  fs.writeFileSync(outputPath, JSON.stringify(addresses, null, 2));
  logger.info(`Deployed addresses saved to ${outputPath}`);

  // Verify contracts on Etherscan (if not local network)
  if (networkName !== "hardhat" && networkName !== "localhost") {
    try {
      logger.info("Verifying contracts on Etherscan...");
      await hre.run("verify:verify", {
        address: piCoin.address,
        constructorArguments: [
          config.piCoin.name,
          config.piCoin.symbol,
          config.piCoin.initialSupply,
        ],
      });
      await hre.run("verify:verify", {
        address: dex.address,
        constructorArguments: [config.dex.fee],
      });
      await hre.run("verify:verify", {
        address: liquidityPool.address,
        constructorArguments: [
          config.liquidityPool.tokenA,
          config.liquidityPool.tokenB,
          dex.address,
        ],
      });
      logger.info("Contracts verified on Etherscan");
    } catch (error) {
      logger.error("Etherscan verification failed:", error.message);
    }
  }

  // Log final instructions
  logger.info("Deployment complete! Update your .env files with the following:");
  console.log(`
    REACT_APP_PICOIN_ADDRESS=${piCoin.address}
    REACT_APP_ETH_ADDRESS=${ethers.constants.AddressZero}
    REACT_APP_DEX_ADDRESS=${dex.address}
    REACT_APP_PICOIN_ETH_POOL_ADDRESS=${liquidityPool.address}
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error("Deployment failed:", error);
    process.exit(1);
  });
