// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

interface IOrderStructs {
    // This is not really an interface - it just defines common structs.

    struct Order {
        address creator;
        address recipient;
        address inputToken;
        address outputToken;
        uint256 inputAmount;
        uint256 minReturnAmount;
        uint256 stoplossAmount;
        uint256 shares;
        address executor;
        uint256 executionFee;
    }
}
