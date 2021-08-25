// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.4;

interface ISavingsContract {
    /** @dev Saver privs */
    function depositSavings(uint256 _amount)
        external
        returns (uint256 creditsIssued);

    function redeemUnderlying(uint256 _amount)
        external
        returns (uint256 massetReturned);

    /** @dev Getters */
    function underlying() external view returns (address);

    function balanceOfUnderlying(address _user)
        external
        view
        returns (uint256 balance);
}
