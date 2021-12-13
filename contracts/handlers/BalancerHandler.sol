// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IHandler.sol";

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

/// @notice Balancer Handler used to execute an order
contract BalancerHandler is IHandler {
    using SafeERC20 for IERC20;

    IVault public immutable vault;
    address public immutable yolo;

    /**
     * @notice Creates the handler
     */
    constructor(IVault _vault, address _yolo) {
        vault = _vault;
        yolo = _yolo;
    }

    modifier onlyYolo() {
        require(
            msg.sender == yolo,
            "BalancerHandler: Only yolo contract can invoke this function"
        );
        _;
    }

    /**
     * @notice Handle an order execution
     */
    function handle(
        IOrderStructs.Order memory order,
        uint256 oracleAmount,
        bytes calldata handlerdata
    ) external override onlyYolo returns (uint256 actualAmtOut) {
        IERC20(order.inputToken).safeIncreaseAllowance(
            address(vault),
            order.inputAmount
        );

        uint256 balBeforeSwap = IERC20(order.outputToken).balanceOf(
            order.recipient
        );

        // Swap Tokens
        actualAmtOut = _swap(handlerdata, order.recipient);

        uint256 balAfterSwap = IERC20(order.outputToken).balanceOf(
            order.recipient
        );
        require(
            balAfterSwap - balBeforeSwap >= actualAmtOut,
            "BalancerHandler: Incorrect output token amount recieved !!"
        );

        require(
            actualAmtOut >= order.minReturnAmount ||
                actualAmtOut <= order.stoplossAmount,
            "BalancerHandler: Order condition doesn't satisfy !!"
        );

        require(
            actualAmtOut >= oracleAmount,
            "BalancerHandler: Oracle amount doesn't match with return amount !!"
        );
    }

    /**
     * @notice Swap input token to output token
     */
    function _swap(bytes calldata _handlerData, address recipient)
        internal
        returns (uint256 bought)
    {
        (
            IAsset[] memory assets,
            BatchSwapStep[] memory swapSteps
        ) = _decodeData(_handlerData);

        FundManagement memory funds = FundManagement(
            address(this),
            false,
            payable(recipient),
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
            block.timestamp
        );

        bought = uint256(-assetDeltas[assetDeltas.length - 1]);
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
