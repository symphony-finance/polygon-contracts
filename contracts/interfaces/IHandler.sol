// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IOrderStructs.sol";

interface IHandler {
    /**
     * @notice Handle an order execution
     * @param _order - Order structure
     * @param _oracleAmount - Current out amount from oracle
     * @param _data - Bytes of arbitrary data
     */
    function handle(
        IOrderStructs.Order memory _order,
        uint256 _oracleAmount,
        bytes calldata _data
    ) external returns (uint256 returnAmount);
}
