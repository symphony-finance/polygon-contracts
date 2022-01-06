// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

interface IOracle {
    function get(
        address inputToken,
        address outputToken,
        uint256 inputAmount
    ) external view returns (uint256 amountOut, uint256 amountOutWithSlippage);

    function isOracle() external view returns (bool);
}
