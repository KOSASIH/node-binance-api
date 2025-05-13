const mongoose = require('mongoose');

// Define the Trade schema
const tradeSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User ', // Reference to the User model
    },
    tokenIn: {
        type: String,
        required: true,
    },
    tokenOut: {
        type: String,
        required: true,
    },
    amountIn: {
        type: Number,
        required: true,
    },
    amountOut: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'canceled'],
        default: 'pending',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

// Method to create a new trade
tradeSchema.statics.createTrade = async function (userId, tokenIn, tokenOut, amountIn, amountOut) {
    const trade = new this({
        userId,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
    });
    await trade.save();
    return trade;
};

// Method to find trades by user
tradeSchema.statics.findTradesByUser  = async function (userId) {
    return await this.find({ userId }).populate('userId', 'username email'); // Populate user details
};

// Method to update trade status
tradeSchema.methods.updateStatus = async function (newStatus) {
    this.status = newStatus;
    await this.save();
    return this;
};

// Create the Trade model
const Trade = mongoose.model('Trade', tradeSchema);

module.exports = Trade;
