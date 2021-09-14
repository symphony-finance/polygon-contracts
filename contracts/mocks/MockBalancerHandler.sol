// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "hardhat/console.sol";
import "../interfaces/IHandler.sol";
import "../libraries/PercentageMath.sol";

enum SwapKind {
    GIVEN_IN,
    GIVEN_OUT
}

struct BatchSwapStep {
    bytes32 poolId;
    uint256 assetInIndex;
    uint256 assetOutIndex;
    uint256 amount;
    bytes userData;
}

struct FundManagement {
    address sender;
    bool fromInternalBalance;
    address payable recipient;
    bool toInternalBalance;
}

struct Order {
    address recipient;
    address inputToken;
    address outputToken;
    uint256 inputAmount;
    uint256 minReturnAmount;
    uint256 stoplossAmount;
    uint256 shares;
}

/// @notice Mock Balancer Handler used to execute an order
contract MockBalancerHandler is IHandler {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using PercentageMath for uint256;

    IVault public immutable vault;
    address public immutable symphony;

    /**
     * @notice Creates the handler
     */
    constructor(IVault _vault, address _symphony) {
        vault = _vault;
        symphony = _symphony;
    }

    modifier onlySymphony() {
        require(
            msg.sender == symphony,
            "BalancerHandler: Only symphony contract can invoke this function"
        );
        _;
    }

    /// @notice receive MATIC
    receive() external payable override {}

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
        bytes calldata handlerdata
    ) external override {
        IERC20(order.inputToken).safeApprove(address(vault), order.inputAmount);

        // Swap Tokens
        uint256 returnAmount = _swap(handlerdata);
        console.log("returnAmount: %s", returnAmount);
        console.log("minReturnAmount: %s", order.minReturnAmount);
        console.log("stoplossAmount: %s", order.stoplossAmount);
        console.log("oracleAmount: %s", oracleAmount);

        require(
            IERC20(order.outputToken).balanceOf(address(this)) >= returnAmount,
            "BalancerHandler: Incorrect output token recieved !!"
        );

        require(
            returnAmount >= order.minReturnAmount ||
                returnAmount <= order.stoplossAmount,
            "BalancerHandler: Order condition doesn't satisfy !!"
        );

        require(
            returnAmount >= oracleAmount,
            "BalancerHandler: Oracle amount doesn't match with return amount !!"
        );

        _transferTokens(
            order.outputToken,
            returnAmount, // Output amount received
            order.recipient,
            executor,
            treasury,
            feePercent,
            protcolFeePercent
        );
    }

    function simulate(
        address _inputToken,
        address _outputToken,
        uint256 _inputAmount,
        uint256 _minReturnAmount,
        uint256 _stoplossAmount,
        uint256 _oracleAmount,
        bytes calldata
    ) external view override returns (bool success, uint256 bought) {}

    /**
     * @notice Swap input token to output token
     */
    function _swap(bytes calldata _data) internal returns (uint256 bought) {
        (
            IAsset[] memory assets,
            BatchSwapStep[] memory swapSteps
        ) = _decodeData(_data);

        FundManagement memory funds = FundManagement(
            address(this),
            false,
            address(this),
            false
        );

        bought = _multiSwap(assets, swapSteps, funds);
    }

    function _multiSwap(
        IAsset[] memory assets,
        BatchSwapStep[] memory swapSteps,
        FundManagement memory funds
    ) internal returns (uint256 bought) {
        int256[] memory limits = new int256[](assets.length);
        for (uint256 i = 0; i < limits.length; i++) {
            limits[i] = type(int256).max;
        }

        int256[] memory assetDeltas = IVault(vault).batchSwap(
            SwapKind.GIVEN_IN,
            swapSteps,
            assets,
            funds,
            limits,
            block.timestamp.add(1800)
        );

        bought = uint256(-assetDeltas[assetDeltas.length - 1]);
    }

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

    function _decodeData(bytes memory _data)
        internal
        view
        returns (IAsset[] memory assets, BatchSwapStep[] memory swapSteps)
    {
        (assets, swapSteps) = abi.decode(_data, (IAsset[], BatchSwapStep[]));
    }
}

interface IAsset {
    // solhint-disable-previous-line no-empty-blocks
}

interface IVault {
    function batchSwap(
        SwapKind kind,
        BatchSwapStep[] memory swaps,
        IAsset[] memory assets,
        FundManagement memory funds,
        int256[] memory limits,
        uint256 deadline
    ) external returns (int256[] memory assetDeltas);
}
