// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Treasury is Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    constructor(address _admin) {
        transferOwnership(_admin);
    }

    function getBalance(IERC20 asset) public view returns (uint256 balance) {
        balance = asset.balanceOf(address(this));
    }

    function withdraw(
        IERC20 asset,
        address receiver,
        uint256 amount
    ) external onlyOwner {
        asset.safeTransfer(receiver, amount);
    }
}
