// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

library TokenUtils {
    using SafeERC20 for IERC20;
    address internal constant ETH_ADDRESS =
        address(0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee);

    /**
     * @notice Get the account's balance of token or ETH
     * @param _token - Address of the token
     * @param _addr - Address of the account
     * @return uint256 - Account's balance of token or ETH
     */
    function balanceOf(IERC20 _token, address _addr)
        internal
        view
        returns (uint256)
    {
        if (ETH_ADDRESS == address(_token)) {
            return _addr.balance;
        }

        return _token.balanceOf(_addr);
    }

    /**
     * @notice Transfer token or ETH to a destinatary
     * @param _token - Address of the token
     * @param _to - Address of the recipient
     * @param _val - Uint256 of the amount to transfer
     */
    function transfer(
        IERC20 _token,
        address _to,
        uint256 _val
    ) internal  {
        if (ETH_ADDRESS == address(_token)) {
            (bool success, ) = _to.call{value: _val}("");
        }

        _token.safeTransfer(_to, _val);
    }
}
