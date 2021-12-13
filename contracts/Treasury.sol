// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract Treasury is Initializable, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    function initialize(address _admin) external initializer {
        __Ownable_init();
        super.transferOwnership(_admin);
    }

    function withdrawMatic(address payable receiver, uint256 amount)
        external
        onlyOwner
    {
        _safeTransferMatic(receiver, amount);
    }

    function withdrawToken(
        IERC20 asset,
        address receiver,
        uint256 amount
    ) external onlyOwner {
        asset.safeTransfer(receiver, amount);
    }

    /**
     * @dev transfer WMATIC to an address, revert if it fails.
     * @param to recipient of the transfer
     * @param value the amount to send
     */
    function _safeTransferMatic(address to, uint256 value) internal {
        (bool success, ) = to.call{value: value}(new bytes(0));
        require(success, "MATIC_TRANSFER_FAILED");
    }

    /// @notice receive WMATIC
    receive() external payable {}
}
