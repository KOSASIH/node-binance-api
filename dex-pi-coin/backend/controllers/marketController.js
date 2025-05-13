const Web3 = require('web3');
const { abi: DEX_ABI } = require('./DEX.json'); // Import DEX contract ABI
const { abi: LiquidityPool_ABI } = require('./LiquidityPool.json'); // Import Liquidity Pool contract ABI
const DEX_ADDRESS = '0xYourDEXContractAddress'; // Replace with your DEX contract address
const LIQUIDITY_POOL_ADDRESS = '0xYourLiquidityPoolContractAddress'; // Replace with your Liquidity Pool contract address

const web3 = new Web3(new Web3.providers.HttpProvider('https://your.ethereum.node')); // Replace with your Ethereum node URL

const dexContract = new web3.eth.Contract(DEX_ABI, DEX_ADDRESS);
const liquidityPoolContract = new web3.eth.Contract(LiquidityPool_ABI, LIQUIDITY_POOL_ADDRESS);

// Function to swap tokens
async function swapTokens(userAddress, tokenIn, tokenOut, amountIn, privateKey) {
    const amountOut = await dexContract.methods.getAmountOut(amountIn, tokenIn, tokenOut).call();
    
    const tx = {
        from: userAddress,
        to: DEX_ADDRESS,
        gas: 2000000,
        data: dexContract.methods.swapTokens(tokenIn, tokenOut, amountIn).encodeABI(),
    };

    const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    return receipt;
}

// Function to add liquidity
async function addLiquidity(userAddress, amountA, amountB, privateKey) {
    const tx = {
        from: userAddress,
        to: LIQUIDITY_POOL_ADDRESS,
        gas: 2000000,
        data: liquidityPoolContract.methods.addLiquidity(amountA, amountB).encodeABI(),
    };

    const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    return receipt;
}

// Function to remove liquidity
async function removeLiquidity(userAddress, amountA, amountB, privateKey) {
    const tx = {
        from: userAddress,
        to: LIQUIDITY_POOL_ADDRESS,
        gas: 2000000,
        data: liquidityPoolContract.methods.removeLiquidity(amountA, amountB).encodeABI(),
    };

    const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    return receipt;
}

// Function to fetch market data
async function getMarketData(tokenA, tokenB) {
    const pool = await liquidityPoolContract.methods.liquidityPools(tokenA, tokenB).call();
    return {
        tokenAAmount: pool.tokenAAmount,
        tokenBAmount: pool.tokenBAmount,
        totalLiquidity: pool.totalLiquidity,
    };
}

// Export the functions for use in other parts of the application
module.exports = {
    swapTokens,
    addLiquidity,
    removeLiquidity,
    getMarketData,
};
