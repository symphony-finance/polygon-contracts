// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IHandler.sol";
import "../interfaces/mstable/ImAsset.sol";

/// @notice Mstable Handler used to execute an order
contract MstableHandler is IHandler {
    using SafeERC20 for IERC20;

    address public immutable yolo;
    address public immutable musdAddress;

    /**
     * @dev To initialize the contract addresses interacting with this contract
     * @param _musdAddress the address of mUSD token
     * @param _yolo the address of the yolo smart contract
     **/
    constructor(address _musdAddress, address _yolo) {
        yolo = _yolo;
        musdAddress = _musdAddress;
    }

    modifier onlyYolo() {
        require(
            msg.sender == yolo,
            "MstableHandler: only yolo contract can invoke this function"
        );
        _;
    }

    /**
     * @notice Handle an order execution
     */
    function handle(
        IOrderStructs.Order memory order,
        uint256 oracleAmount,
        bytes calldata
    ) external override onlyYolo returns (uint256 actualAmtOut) {
        uint256 minOutputQuantity = 0;
        if (order.inputToken == musdAddress) {
            minOutputQuantity = ImAsset(musdAddress).getRedeemOutput(
                order.outputToken,
                order.inputAmount
            );
        } else {
            minOutputQuantity = ImAsset(musdAddress).getSwapOutput(
                order.inputToken,
                order.outputToken,
                order.inputAmount
            );
        }

        require(
            minOutputQuantity >= order.minReturnAmount ||
                minOutputQuantity <= order.stoplossAmount,
            "MstableHandler: order condition doesn't satisfy."
        );

        require(
            minOutputQuantity >= oracleAmount,
            "MstableHandler: oracle amount doesn't match."
        );

        IERC20(order.inputToken).safeIncreaseAllowance(
            musdAddress,
            order.inputAmount
        );

        if (order.inputToken == musdAddress) {
            actualAmtOut = ImAsset(musdAddress).redeem(
                order.outputToken,
                order.inputAmount,
                minOutputQuantity,
                order.recipient
            );
        } else {
            actualAmtOut = ImAsset(musdAddress).swap(
                order.inputToken,
                order.outputToken,
                order.inputAmount,
                minOutputQuantity,
                order.recipient
            );
        }

        require(
            actualAmtOut >= minOutputQuantity,
            "MstableHandler: actual swap amount less than min output amount"
        );
    }
}
