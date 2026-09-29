// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestUSDT
 * @dev Test USDT token for Arbitrum Sepolia testnet
 * Used only for testing purposes
 */
contract TestUSDT is ERC20, Ownable {
    constructor() ERC20("Test USDT", "USDT") {
        // Mint 1 million USDT (6 decimals)
        _mint(msg.sender, 1_000_000 * 10 ** 6);
    }

    function decimals() public view override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
