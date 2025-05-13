const Web3 = require('web3');
const { abi: LiquidityPool_ABI } = require('./LiquidityPool.json'); // Import Liquidity Pool contract ABI
const LIQUIDITY_POOL_ADDRESS = '0xYourLiquidityPoolContractAddress'; // Replace with your Liquidity Pool contract address

const web3 = new Web3(new Web3.providers.HttpProvider('https://your.ethereum.node')); // Replace with your Ethereum node URL

const liquidityPoolContract = new web3.eth.Contract(LiquidityPool_ABI, LIQUIDITY_POOL_ADDRESS);

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

    if (receipt.status) {
        return {
            status: 'success',
            transactionHash: receipt.transactionHash,
            message: 'Liquidity added successfully',
        };
    } else {
        throw new Error('Failed to add liquidity');
    }
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

    if (receipt.status) {
        return {
            status: 'success',
            transactionHash: receipt.transactionHash,
            message: 'Liquidity removed successfully',
        };
    } else {
        throw new Error('Failed to remove liquidity');
    }
}

// Function to fetch user liquidity positions
async function getUser Liquidity(userAddress) {
    const userLiquidity = await liquidityPoolContract.methods.getUser Liquidity(userAddress).call();
    return {
        tokenAAmount: userLiquidity.tokenAAmount,
        tokenBAmount: userLiquidity.tokenBAmount,
        totalLiquidity: userLiquidity.totalLiquidity,
    };
}

// Export the functions for use in other parts of the application
module.exports = {
    addLiquidity,
    removeLiquidity,
    getUser Liquidity,
};
