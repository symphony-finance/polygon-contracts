// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IOrderStructs.sol";

interface IHandler {
    /// @notice receive ETH
    receive() external payable;

    /**
     * @notice Handle an order execution
     * @param _order - Order structure
     * @param _feePercent - uint256 total execution fee percent
     * @param _protocolFeePercent - uint256 protocol fee percent
     * @param _executor - Address of the order executor
     * @param _treasury - Address of the protocol treasury
     * @param _data - Bytes of arbitrary data
     */
    function handle(
        IOrderStructs.Order memory _order,
        uint256 _feePercent,
        uint256 _protocolFeePercent,
        address _executor,
        address _treasury,
        bytes calldata _data
    ) external;
}
