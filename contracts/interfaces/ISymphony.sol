// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

interface ISymphony {
    function createOrder(
        address recipient,
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minReturnAmount,
        uint256 stoplossAmount
    ) external returns (bytes32 orderId);
}
