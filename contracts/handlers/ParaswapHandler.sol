// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IHandler.sol";
import {IWETH as IWMATIC} from "../interfaces/IWETH.sol";

/// @notice Paraswap Handler used to execute an order
contract ParaswapHandler is IHandler {
    using SafeERC20 for IERC20;

    address public immutable yolo;
    address public constant augustusSwapper =
        0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57;
    address public constant tokenTransferProxy =
        0x216B4B4Ba9F3e719726886d34a177484278Bfcae;
    address internal constant WMATIC =
        0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;

    constructor(address _yolo) {
        yolo = _yolo;
    }

    modifier onlyYolo() {
        require(
            msg.sender == yolo,
            "ParaswapHandler: only yolo contract can invoke this function"
        );
        _;
    }

    /**
     * @notice Handle an order execution
     */
    function handle(
        IOrderStructs.Order memory order,
        uint256 oracleAmount,
        bytes calldata handlerData
    ) external override onlyYolo returns (uint256 actualAmtOut) {
        uint256 contractBalBeforeSwap = IERC20(order.outputToken).balanceOf(
            address(this)
        );

        IERC20(order.inputToken).safeIncreaseAllowance(
            address(tokenTransferProxy),
            order.inputAmount
        );

        (bool success, ) = augustusSwapper.call{value: 0}(handlerData);
        require(success, "ParaswapHandler: external swap failed");

        uint256 contractBalAfterSwap = IERC20(order.outputToken).balanceOf(
            address(this)
        );
        actualAmtOut = contractBalAfterSwap - contractBalBeforeSwap;

        require(
            actualAmtOut >= order.minReturnAmount ||
                actualAmtOut <= order.stoplossAmount,
            "ParaswapHandler: order condition doesn't satisfy"
        );

        require(
            actualAmtOut >= oracleAmount,
            "ParaswapHandler: oracle amount doesn't match with return amount"
        );

        if (order.outputToken == WMATIC) {
            IWMATIC(order.outputToken).withdraw(actualAmtOut);
            _safeTransferMatic(order.recipient, actualAmtOut);
        } else {
            IERC20(order.outputToken).safeTransfer(
                order.recipient,
                actualAmtOut
            );
        }
    }

    function _safeTransferMatic(address to, uint256 value) internal {
        (bool success, ) = to.call{value: value}(new bytes(0));
        require(success, "MATIC_TRANSFER_FAILED");
    }

    /// @notice receive MATIC
    receive() external payable {}
}
