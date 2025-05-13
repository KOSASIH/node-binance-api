// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract PiCoin is ERC20, Ownable, Pausable, ReentrancyGuard {
    using SafeMath for uint256;

    // Total supply of Pi Coin
    uint256 private constant TOTAL_SUPPLY = 100000000000 * 10**decimals(); // 100 billion tokens
    // Target price in USD
    uint256 public constant TARGET_PRICE = 314159 * 10**18; // $314,159 in wei
    // Price feed address (to be set with a real oracle)
    address public priceFeed;

    // Transaction fee (in basis points, e.g., 100 = 1%)
    uint256 public transactionFee = 100; // 1% fee
    // Total fees collected
    uint256 public totalFeesCollected;

    // Events
    event PriceFeedUpdated(address indexed newPriceFeed);
    event TransactionFeeUpdated(uint256 newFee);
    event FeesCollected(uint256 amount);
    event SupplyAdjusted(uint256 newSupply);

    constructor() ERC20("PiCoin", "PI") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    // Function to set the price feed address
    function setPriceFeed(address _priceFeed) external onlyOwner {
        priceFeed = _priceFeed;
        emit PriceFeedUpdated(_priceFeed);
    }

    // Function to get the current price of Pi Coin from the oracle
    function getCurrentPrice() public view returns (uint256) {
        // This function should call the price feed to get the current price
        // For demonstration, we will return a placeholder value
        // In a real implementation, you would integrate with an oracle like Chainlink
        return TARGET_PRICE; // Placeholder for actual price fetching logic
    }

    // Function to adjust supply based on current price
    function adjustSupply() external onlyOwner {
        uint256 currentPrice = getCurrentPrice();
        if (currentPrice < TARGET_PRICE) {
            // Mint additional tokens to stabilize the price
            uint256 amountToMint = (TARGET_PRICE - currentPrice).div(1e18).mul(1000); // Example logic
            _mint(msg.sender, amountToMint);
            emit SupplyAdjusted(amountToMint);
        } else if (currentPrice > TARGET_PRICE) {
            // Burn tokens to stabilize the price
            uint256 amountToBurn = (currentPrice - TARGET_PRICE).div(1e18).mul(1000); // Example logic
            _burn(msg.sender, amountToBurn);
            emit SupplyAdjusted(amountToBurn);
        }
    }

    // Function to mint new tokens (only owner)
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // Function to burn tokens (only owner)
    function burn(uint256 amount) external onlyOwner {
        _burn(msg.sender, amount);
    }

    // Function to pause all token transfers (only owner)
    function pause() external onlyOwner {
        _pause();
    }

    // Function to unpause all token transfers (only owner)
    function unpause() external onlyOwner {
        _unpause();
    }

    // Override transfer functions to include pause functionality and transaction fees
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal whenNotPaused override {
        super._beforeTokenTransfer(from, to, amount);
        if (from != address(0) && to != address(0)) { // Not a mint or burn
            uint256 fee = amount.mul(transactionFee).div(10000); // Calculate fee
            uint256 amountAfterFee = amount.sub(fee);
            totalFeesCollected = totalFeesCollected .add(fee);
            _transfer(from, to, amountAfterFee);
            _transfer(from, address(this), fee); // Transfer fee to the contract
            emit FeesCollected(fee);
        }
    }

    // Function to withdraw collected fees (only owner)
    function withdrawFees() external onlyOwner {
        uint256 amount = totalFeesCollected;
        totalFeesCollected = 0;
        payable(msg.sender).transfer(amount);
    }

    // Function to update the transaction fee (only owner)
    function updateTransactionFee(uint256 newFee) external onlyOwner {
        require(newFee <= 1000, "Fee cannot exceed 10%");
        transactionFee = newFee;
        emit TransactionFeeUpdated(newFee);
    }

    // Fallback function to receive ETH
    receive() external payable {}
}
