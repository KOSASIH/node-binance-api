const Web3 = require('web3');
const { abi: DEX_ABI } = require('./DEX.json'); // Import DEX contract ABI
const DEX_ADDRESS = '0xYourDEXContractAddress'; // Replace with your DEX contract address

const web3 = new Web3(new Web3.providers.HttpProvider('https://your.ethereum.node')); // Replace with your Ethereum node URL

const dexContract = new web3.eth.Contract(DEX_ABI, DEX_ADDRESS);

// Order structure
let orders = []; // In-memory order storage (for demonstration purposes)

// Function to place a trade order
async function placeOrder(userAddress, tokenIn, tokenOut, amountIn, amountOutMin, privateKey) {
    const orderId = orders.length + 1; // Simple order ID generation
    const order = {
        id: orderId,
        user: userAddress,
        tokenIn,
        tokenOut,
        amountIn,
        amountOutMin,
        status: 'open',
    };
    orders.push(order); // Store the order

    const tx = {
        from: userAddress,
        to: DEX_ADDRESS,
        gas: 2000000,
        data: dexContract.methods.swapTokens(tokenIn, tokenOut, amountIn).encodeABI(),
    };

    const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    // Update order status based on transaction receipt
    if (receipt.status) {
        order.status = 'completed';
    } else {
        order.status = 'failed';
    }

    return {
        orderId,
        status: order.status,
        transactionHash: receipt.transactionHash,
    };
}

// Function to cancel an order
function cancelOrder(orderId, userAddress) {
    const orderIndex = orders.findIndex(order => order.id === orderId && order.user === userAddress);
    if (orderIndex === -1) {
        throw new Error('Order not found or you do not have permission to cancel this order');
    }

    orders[orderIndex].status = 'canceled';
    return { orderId, status: 'canceled' };
}

// Function to fetch trade history for a user
function getTradeHistory(userAddress) {
    return orders.filter(order => order.user === userAddress);
}

// Export the functions for use in other parts of the application
module.exports = {
    placeOrder,
    cancelOrder,
    getTradeHistory,
};
