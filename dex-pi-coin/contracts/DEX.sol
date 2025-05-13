// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract DEX is Ownable, Pausable, ReentrancyGuard {
    using SafeMath for uint256;

    struct Pool {
        uint256 tokenAAmount;
        uint256 tokenBAmount;
        uint256 totalLiquidity;
    }

    mapping(address => mapping(address => Pool)) public liquidityPools;
    mapping(address => mapping(address => mapping(address => uint256))) public userLiquidity;

    event LiquidityAdded(address indexed tokenA, address indexed tokenB, uint256 amountA, uint256 amountB);
    event LiquidityRemoved(address indexed tokenA, address indexed tokenB, uint256 amountA, uint256 amountB);
    event TokensSwapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event FeesWithdrawn(address indexed token, uint256 amount);

    uint256 public feePercentage = 1; // 1% fee

    // Function to add liquidity to the DEX
    function addLiquidity(address tokenA, address tokenB, uint256 amountA, uint256 amountB) external whenNotPaused nonReentrant {
        require(amountA > 0 && amountB > 0, "Invalid amounts");

        IERC20(tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountB);

        Pool storage pool = liquidityPools[tokenA][tokenB];
        pool.tokenAAmount = pool.tokenAAmount.add(amountA);
        pool.tokenBAmount = pool.tokenBAmount.add(amountB);
        pool.totalLiquidity = pool.totalLiquidity.add(amountA.add(amountB));

        userLiquidity[tokenA][tokenB][msg.sender] = userLiquidity[tokenA][tokenB][msg.sender].add(amountA.add(amountB));

        emit LiquidityAdded(tokenA, tokenB, amountA, amountB);
    }

    // Function to remove liquidity from the DEX
    function removeLiquidity(address tokenA, address tokenB, uint256 amountA, uint256 amountB) external whenNotPaused nonReentrant {
        require(amountA > 0 && amountB > 0, "Invalid amounts");

        Pool storage pool = liquidityPools[tokenA][tokenB];
        require(pool.tokenAAmount >= amountA && pool.tokenBAmount >= amountB, "Insufficient liquidity");

        pool.tokenAAmount = pool.tokenAAmount.sub(amountA);
        pool.tokenBAmount = pool.tokenBAmount.sub(amountB);
        pool.totalLiquidity = pool.totalLiquidity.sub(amountA.add(amountB));

        userLiquidity[tokenA][tokenB][msg.sender] = userLiquidity[tokenA][tokenB][msg.sender].sub(amountA.add(amountB));

        IERC20(tokenA).transfer(msg.sender, amountA);
        IERC20(tokenB).transfer(msg.sender, amountB);

        emit LiquidityRemoved(tokenA, tokenB, amountA, amountB);
    }

    // Function to swap tokens
    function swapTokens(address tokenIn, address tokenOut, uint256 amountIn) external whenNotPaused nonReentrant {
        require(amountIn > 0, "Invalid amount");

        Pool storage pool = liquidityPools[tokenIn][tokenOut];
        require(pool.tokenAAmount > 0 && pool.tokenBAmount > 0, "Liquidity pool does not exist");

        uint256 amountOut = getAmountOut(amountIn, pool.tokenAAmount, pool.tokenBAmount);
        require(amountOut > 0, "Insufficient output amount");

        uint256 fee = amountIn.mul(feePercentage).div(100);
        uint256 amountInAfterFee = amountIn.sub(fee);

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(msg.sender, amountOut);

        pool.tokenAAmount = pool.tokenAAmount.add(amountInAfterFee);
        pool.tokenBAmount = pool.tokenBAmount.sub(amountOut);

        emit TokensSwapped(tokenIn, tokenOut, amountIn, amountOut);
    }

    // Function to calculate output amount based on input amount and reserves
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        require(amountIn > 0, "Amount in must be greater than zero");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        uint256 amountInWithFee = amountIn.mul(997); // 0.3% fee
        uint256 numerator = amountInWithFee.mul(reserveOut);
        uint256 denominator = reserveIn.mul(1000).add(amountInWithFee);
        return numerator / denominator;
    }

    // Function to withdraw fees collected (only owner)
    function withdrawFees(address token) external onlyOwner {
        uint256 amount = IERC20(token).balanceOf(address(this));
        require(amount > 0, "No fees to withdraw");
        IERC20(token).transfer(msg.sender, amount);
        emit FeesWithdrawn(token, amount);
    }

    // Function to update the fee percentage (only owner)
    function updateFeePercentage(uint256 newFee) external onlyOwner {
        require(newFee <= 100, "Fee cannot exceed 100%");
        feePercentage = newFee;
    }

    // Function to pause trading (only owner)
    function pause() external onlyOwner {
        _pause();
    }

    // Function to unpause trading (only owner)
    function unpause() external onlyOwner {
        _unpause();
    }

    // Fallback function to receive ETH
    receive() external payable {}
}
