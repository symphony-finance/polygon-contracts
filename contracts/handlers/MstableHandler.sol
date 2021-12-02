// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../interfaces/ImAsset.sol";
import "../interfaces/IHandler.sol";
import "../libraries/PercentageMath.sol";

/// @notice Mstable Handler used to execute an order
contract MstableHandler is IHandler {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using PercentageMath for uint256;

    address public immutable musdToken;
    address public immutable symphony;

    /**
     * @dev To initialize the contract addresses interacting with this contract
     * @param _musdToken the address of mUSD token
     * @param _symphony the address of the symphony smart contract
     **/
    constructor(address _musdToken, address _symphony) {
        symphony = _symphony;
        musdToken = _musdToken;
    }

    modifier onlySymphony() {
        require(
            msg.sender == symphony,
            "MstableHandler: Only symphony contract can invoke this function"
        );
        _;
    }

    /**
     * @notice Handle an order execution
     */
    function handle(
        IOrderStructs.Order memory order,
        uint256 oracleAmount,
        uint256 feePercent,
        uint256 protcolFeePercent,
        address executor,
        address treasury,
        bytes calldata
    ) external override onlySymphony {
        uint256 minOutputQuantity = 0;
        if (order.inputToken == musdToken) {
            minOutputQuantity = ImAsset(musdToken).getRedeemOutput(
                order.outputToken,
                order.inputAmount
            );
        } else {
            minOutputQuantity = ImAsset(musdToken).getSwapOutput(
                order.inputToken,
                order.outputToken,
                order.inputAmount
            );
        }

        require(
            minOutputQuantity >= order.minReturnAmount ||
                minOutputQuantity <= order.stoplossAmount,
            "MstableHandler: Order condition doesn't satisfy."
        );

        require(
            minOutputQuantity >= oracleAmount,
            "MstableHandler: Oracle amount doesn't match."
        );

        uint256 actualAmtOut = 0;
        if (order.inputToken == musdToken) {
            actualAmtOut = ImAsset(musdToken).redeem(
                order.outputToken,
                order.inputAmount,
                minOutputQuantity,
                address(this)
            );
        } else {
            actualAmtOut = ImAsset(musdToken).swap(
                order.inputToken,
                order.outputToken,
                order.inputAmount,
                minOutputQuantity,
                address(this)
            );
        }

        require(
            actualAmtOut >= minOutputQuantity,
            "MstableHandler: Actual swap amount less than min output amount."
        );

        _transferTokens(
            order.outputToken,
            actualAmtOut,
            order.recipient,
            executor,
            treasury,
            feePercent,
            protcolFeePercent
        );
    }

    function maxApproveAssets(address[] memory tokens) external {
        for (uint8 i = 0; i < tokens.length; i++) {
            require(
                IERC20(tokens[i]).allowance(address(this), musdToken) == 0,
                "MstableHandler::maxApproveAssets: already has allowance"
            );
            IERC20(tokens[i]).safeApprove(musdToken, uint256(-1));
        }
    }

    /**
     * @notice Simulate an order execution
     */
    function simulate(
        address _inputToken,
        address _outputToken,
        uint256 _inputAmount,
        uint256 _minReturnAmount,
        uint256 _stoplossAmount,
        uint256 _oracleAmount,
        bytes calldata
    ) external view override returns (bool success, uint256 amountOut) {}

    function _transferTokens(
        address token,
        uint256 amount,
        address recipient,
        address executor,
        address treasury,
        uint256 feePercent,
        uint256 protcolFeePercent
    ) internal {
        uint256 protocolFee;
        uint256 totalFee = amount.percentMul(feePercent);

        IERC20(token).safeTransfer(recipient, amount.sub(totalFee));

        if (treasury != address(0)) {
            protocolFee = totalFee.percentMul(protcolFeePercent);
            IERC20(token).safeTransfer(treasury, protocolFee);
        }

        IERC20(token).safeTransfer(executor, totalFee.sub(protocolFee));
    }

    receive() external payable override {}
}
