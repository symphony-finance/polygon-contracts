// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "hardhat/console.sol";

import "../interfaces/IWETH.sol";
import "../interfaces/IOracle.sol";
import "../interfaces/IHandler.sol";
import "../libraries/PercentageMath.sol";

enum SwapKind {
    GIVEN_IN,
    GIVEN_OUT
}

struct SingleSwap {
    bytes32 poolId;
    SwapKind kind;
    IAsset assetIn;
    IAsset assetOut;
    uint256 amount;
    bytes userData;
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

/// @notice Balancer Handler used to execute an order
contract BalancerHandler is IHandler {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using PercentageMath for uint256;

    IOracle public oracle;
    IVault public immutable vault;

    uint256 private constant never = uint256(-1);

    /**
     * @notice Creates the handler
     * @param _vault - Address of V2 vault
     */
    constructor(IVault _vault, IOracle _oracle) {
        vault = _vault;
        oracle = _oracle;
    }

    /// @notice receive ETH
    receive() external payable override {
        require(
            msg.sender != tx.origin,
            "UniswapV1Handler#receive: NO_SEND_ETH_PLEASE"
        );
    }

    /**
     * @notice Handle an order execution
     */
    function handle(
        IOrderStructs.Order memory order,
        uint256 feePercent,
        uint256 protcolFeePercent,
        address executor,
        address treasury,
        bytes calldata handlerdata
    ) external override {
        IERC20(order.inputToken).safeApprove(address(vault), order.inputAmount);

        // Swap Tokens
        uint256 returnAmount = _swap(
            order.inputToken,
            order.outputToken,
            order.inputAmount,
            handlerdata
        );

        uint256 oracleAmount = oracle.get(
            order.inputToken,
            order.outputToken,
            order.inputAmount
        );

        require(
            (returnAmount >= order.minReturnAmount &&
                returnAmount >= oracleAmount) ||
                (returnAmount <= order.stoplossAmount &&
                    oracleAmount <= order.stoplossAmount),
            "BalancerHandler: Amount mismatch !!"
        );

        transferTokens(
            order.outputToken,
            returnAmount, // Output amount received
            order.recipient,
            executor,
            treasury,
            feePercent,
            protcolFeePercent
        );
    }

    /**
     * @notice Check whether can handle an order execution
     * @return bool - Whether the execution can be handled or not
     */
    function canHandle(
        address,
        address,
        uint256,
        uint256,
        uint256,
        uint256,
        bytes calldata
    ) external view override returns (bool) {
        return true;
    }

    function simulate(
        address _inputToken,
        address _outputToken,
        uint256 _inputAmount,
        uint256 _minReturnAmount,
        uint256 _stoplossAmount,
        uint256 _feePercent,
        bytes calldata
    ) external view override returns (bool success, uint256 bought) {}

    /**
     * @notice Swap input token to output token
     * @param _inputToken - Address of the input token
     * @param _outputToken - Address of the output token
     * @param _inputAmount - uint256 of the input token amount
     * @return bought - Amount of output token bought
     */
    function _swap(
        address _inputToken,
        address _outputToken,
        uint256 _inputAmount,
        bytes calldata data
    ) internal returns (uint256 bought) {
        (
            address _intermidiate,
            uint256 _intermidiateAmount,
            bytes32 poolA,
            bytes32 poolB
        ) = abi.decode(data, (address, uint256, bytes32, bytes32));

        FundManagement memory funds = FundManagement(
            address(this),
            false,
            address(this),
            false
        );

        console.logBytes32(poolA);

        if (_intermidiate != address(0)) {
            IAsset[] memory assets = new IAsset[](3);
            assets[0] = IAsset(_inputToken);
            assets[1] = IAsset(_intermidiate);
            assets[2] = IAsset(_outputToken);

            BatchSwapStep memory batchSwap0 = BatchSwapStep(
                poolA,
                0,
                1,
                _inputAmount,
                ""
            );

            BatchSwapStep memory batchSwap1 = BatchSwapStep(
                poolB,
                1,
                2,
                _intermidiateAmount,
                ""
            );

            BatchSwapStep[] memory batchSwapSteps = new BatchSwapStep[](2);
            batchSwapSteps[0] = batchSwap0;
            batchSwapSteps[1] = batchSwap1;

            int256[] memory limits = new int256[](3);
            limits[0] = type(int256).max;
            limits[1] = type(int256).max;
            limits[2] = type(int256).max;

            int256[] memory assetDeltas = IVault(vault).batchSwap(
                SwapKind.GIVEN_IN,
                batchSwapSteps,
                assets,
                funds,
                limits,
                block.timestamp.add(1800)
            );

            bought = uint256(-assetDeltas[assetDeltas.length - 1]);

            console.log("bought %s", uint256(assetDeltas[0]));
            console.log("bought %s", uint256(-assetDeltas[1]));
            console.log("bought %s", uint256(-assetDeltas[2]));
        } else {
            SingleSwap memory singleSwap = SingleSwap(
                poolA,
                SwapKind.GIVEN_IN,
                IAsset(_inputToken),
                IAsset(_outputToken),
                _inputAmount,
                ""
            );

            bought = IVault(vault).swap(
                singleSwap,
                funds,
                0, // minAmountOut
                block.timestamp.add(1800)
            );

            console.log("bought %s", bought);
        }
    }

    function transferTokens(
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
}

interface IAsset {
    // solhint-disable-previous-line no-empty-blocks
}

interface IVault {
    function swap(
        SingleSwap calldata singleSwap,
        FundManagement calldata funds,
        uint256 limit,
        uint256 deadline
    ) external returns (uint256 amountCalculated);

    function batchSwap(
        SwapKind kind,
        BatchSwapStep[] memory swaps,
        IAsset[] memory assets,
        FundManagement memory funds,
        int256[] memory limits,
        uint256 deadline
    ) external returns (int256[] memory assetDeltas);
}
