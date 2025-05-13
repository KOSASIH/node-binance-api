// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract LiquidityPool is Ownable, Pausable, ReentrancyGuard {
    using SafeMath for uint256;

    IERC20 public token; // The token that will be used in the liquidity pool
    uint256 public totalSupply; // Total supply of liquidity tokens
    mapping(address => uint256) public balances; // User balances

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);

    constructor(IERC20 _token) {
        token = _token;
    }

    // Function to deposit tokens into the liquidity pool
    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Amount must be greater than zero");

        // Transfer tokens from user to the contract
        token.transferFrom(msg.sender, address(this), amount);

        // Update user balance and total supply
        balances[msg.sender] = balances[msg.sender].add(amount);
        totalSupply = totalSupply.add(amount);

        emit Deposited(msg.sender, amount);
    }

    // Function to withdraw tokens from the liquidity pool
    function withdraw(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Amount must be greater than zero");
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // Update user balance and total supply
        balances[msg.sender] = balances[msg.sender].sub(amount);
        totalSupply = totalSupply.sub(amount);

        // Transfer tokens back to the user
        token.transfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // Function to claim rewards (for demonstration purposes, rewards are simply the user's balance)
    function claimRewards() external whenNotPaused nonReentrant {
        uint256 rewardAmount = balances[msg.sender];
        require(rewardAmount > 0, "No rewards to claim");

        // Reset user's balance to zero before transferring rewards
        balances[msg.sender] = 0;

        // Transfer rewards to the user
        token.transfer(msg.sender, rewardAmount);

        emit RewardsClaimed(msg.sender, rewardAmount);
    }

    // Function to pause the contract (only owner)
    function pause() external onlyOwner {
        _pause();
    }

    // Function to unpause the contract (only owner)
    function unpause() external onlyOwner {
        _unpause();
    }

    // Function to get the user's balance in the liquidity pool
    function getUser Balance(address user) external view returns (uint256) {
        return balances[user];
    }

    // Function to get the total supply of liquidity tokens
    function getTotalSupply() external view returns (uint256) {
        return totalSupply;
    }
}
