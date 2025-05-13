const mongoose = require('mongoose');

// Define the Liquidity schema
const liquiditySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User ', // Reference to the User model
    },
    tokenA: {
        type: String,
        required: true,
    },
    tokenB: {
        type: String,
        required: true,
    },
    amountA: {
        type: Number,
        required: true,
    },
    amountB: {
        type: Number,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

// Method to add liquidity
liquiditySchema.statics.addLiquidity = async function (userId, tokenA, tokenB, amountA, amountB) {
    const liquidity = new this({
        userId,
        tokenA,
        tokenB,
        amountA,
        amountB,
    });
    await liquidity.save();
    return liquidity;
};

// Method to remove liquidity
liquiditySchema.statics.removeLiquidity = async function (liquidityId) {
    const liquidity = await this.findByIdAndDelete(liquidityId);
    return liquidity;
};

// Method to find liquidity by user
liquiditySchema.statics.findLiquidityByUser  = async function (userId) {
    return await this.find({ userId }).populate('userId', 'username email'); // Populate user details
};

// Create the Liquidity model
const Liquidity = mongoose.model('Liquidity', liquiditySchema);

module.exports = Liquidity;
